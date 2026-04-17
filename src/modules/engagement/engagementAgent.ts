import { TwitterApi } from 'twitter-api-v2';
import { ICompletionProvider } from '../../adapters/model/openaiCompatibleProvider';
import { PromptCatalog } from '../../harness/promptCatalog';
import { logger } from '../../utils/logger';
import { getEnv } from '../../utils/secrets';
import { securityGuard } from '../security';
import { LearningService } from '../learning';
import { EncryptedTokenStore } from '../../auth/tokenStore';
import { ThreadsApiClient, ThreadsTweet } from '../../adapters/threadsApiClient';

type EngagementAction = 'repost' | 'quote' | 'reply' | 'like' | 'skip';

interface EngagementRecord {
  tweetId: string;
  authorId: string;
  action: EngagementAction;
  generatedContent?: string;
  executedAt: string;
  success: boolean;
  error?: string;
}

interface TweetCandidate {
  id: string;
  text: string;
  authorId: string;
  authorUsername?: string;
  metrics?: {
    likeCount: number;
    retweetCount: number;
    replyCount: number;
  };
}

export class EngagementAgent {
  private readonly maxPerCycle: number;
  private readonly maxLikesPerHour: number;
  private currentCommentAllowance = 10;
  private currentLikeAllowance = 30;
  private tokenStore = new EncryptedTokenStore();

  constructor(
    private readonly provider: ICompletionProvider,
    private readonly learning: LearningService,
    private readonly promptCatalog = new PromptCatalog()
  ) {
    this.maxPerCycle = getEnvNumber('ENGAGEMENT_MAX_PER_CYCLE', 15);
    this.maxLikesPerHour = getEnvNumber('HERMES_LIKES_PER_HOUR', 30);
  }

  async runCycle(): Promise<EngagementRecord[]> {
    if (!isEnabled('ENGAGEMENT_ENABLED') && !isEnabled('HERMES_X_ENGAGEMENT_ENABLED')) {
      logger.info('Engagement is disabled. Skipping cycle.');
      return [];
    }

    const { client, userId } = await this.createXClient();
    if (!client || !userId) {
      logger.warn('X API credentials or token not configured. Skipping ALL engagement.');
      return [];
    }

    let threadsClientRes = null;
    if (isEnabled('HERMES_THREADS_ENGAGEMENT_ENABLED')) {
      threadsClientRes = await this.createThreadsClient();
      if (!threadsClientRes.client) {
        logger.warn('Threads API credentials not configured but engagement enabled. Skipping Threads.');
      }
    }

    const records: EngagementRecord[] = [];
    let remaining = this.maxPerCycle;

    // Load allowances using SQLite Memory
    const hourlyComments = this.learning.getRecentActionCount(['reply', 'quote'], 1);
    this.currentCommentAllowance = Math.max(0, 10 - hourlyComments);

    const hourlyLikes = this.learning.getRecentActionCount(['like'], 1);
    this.currentLikeAllowance = Math.max(0, this.maxLikesPerHour - hourlyLikes);

    logger.info({
      commentAllowance: this.currentCommentAllowance,
      likeAllowance: this.currentLikeAllowance,
      maxPerCycle: this.maxPerCycle,
      xUserId: userId,
      threadsEngaged: !!threadsClientRes?.client
    }, 'Engagement cycle budgets loaded');

    // Phase 1: Reply to mentions (comments use allowance)
    try {
      const mentionRecords = await this.replyToMentions(client, Math.min(2, remaining));
      records.push(...mentionRecords);
      remaining -= mentionRecords.filter((r) => r.success).length;
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Mention replies failed');
    }

    // Phase 1.5: Threads Mentions
    if (threadsClientRes && threadsClientRes.client && remaining > 0) {
      try {
        const tMentionRecords = await this.replyToThreadsMentions(threadsClientRes.client, threadsClientRes.userId!, Math.min(2, remaining));
        records.push(...tMentionRecords);
        remaining -= tMentionRecords.filter((r) => r.success).length;
      } catch (error: any) {
        logger.warn({ error: error.message }, 'Threads Mention replies failed');
      }
    }

    // Phase 2: X Timeline Engagement
    if (remaining > 0 && client && userId) {
      try {
        const timelineRecords = await this.engageTimeline(client, userId, remaining);
        records.push(...timelineRecords);
        remaining -= timelineRecords.filter((r) => r.success).length;
      } catch (error: any) {
        logger.warn({ error: error.message }, 'X Timeline engagement failed');
      }
    }

    // Phase 3: Threads Timeline Engagement
    if (remaining > 0 && threadsClientRes && threadsClientRes.client) {
      try {
        const tTimelineRecords = await this.engageThreadsTimeline(threadsClientRes.client, threadsClientRes.userId!, remaining);
        records.push(...tTimelineRecords);
        remaining -= tTimelineRecords.filter((r) => r.success).length;
      } catch (error: any) {
        logger.warn({ error: error.message }, 'Threads Timeline engagement failed');
      }
    }

    logger.info({ total: records.length, successful: records.filter(r => r.success).length }, 'Engagement cycle completed');
    return records;
  }

  private async replyToMentions(client: TwitterApi, maxReplies: number): Promise<EngagementRecord[]> {
    const records: EngagementRecord[] = [];
    try {
      const me = await client.v2.me();
      const mentions = await client.v2.userMentionTimeline(me.data.id, {
        max_results: 5,
        'tweet.fields': ['text', 'author_id', 'created_at']
      });

      for (const mention of mentions.data?.data?.slice(0, maxReplies) || []) {
        if (this.learning.hasEngagedWithTarget('reply', mention.id)) continue;

        try {
          if (this.currentCommentAllowance <= 0) continue;

          const replyText = await this.generateText(mention.text, 'reply');
          if (!replyText) continue;

          securityGuard.assertSafeForPublishing(replyText);
          await client.v2.reply(replyText, mention.id);

          this.learning.recordEngagementAction('reply', mention.id, mention.author_id!, 'x', true);
          this.currentCommentAllowance--;

          records.push({
            tweetId: mention.id,
            authorId: mention.author_id!,
            action: 'reply',
            generatedContent: replyText,
            executedAt: new Date().toISOString(),
            success: true
          });
        } catch (error: any) {
          this.learning.recordEngagementAction('reply', mention.id, mention.author_id!, 'x', false);
          logger.warn({ error: error.message }, 'Failed mention reply');
        }
      }
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to fetch mentions');
    }
    return records;
  }

  private async engageTimeline(client: TwitterApi, myUserId: string, maxEngagements: number): Promise<EngagementRecord[]> {
    const records: EngagementRecord[] = [];
    const queries = [
      'AI startup', 'building in public', 'startup founder',
      'product design', 'indie hacker', 'solopreneur',
      'AI agent', 'SaaS startup', 'tech startup funding',
      'YC startup', 'founder life', 'startup advice'
    ];
    const query = queries[Math.floor(Math.random() * queries.length)];

    const results = await client.v2.search(query, {
      max_results: 50,
      'tweet.fields': ['public_metrics', 'author_id']
    });

    const candidates = (results.data?.data || []).map((tweet: any) => ({
      id: tweet.id,
      text: tweet.text,
      authorId: tweet.author_id,
      metrics: {
        likeCount: tweet.public_metrics?.like_count || 0,
        retweetCount: tweet.public_metrics?.retweet_count || 0,
        replyCount: tweet.public_metrics?.reply_count || 0
      }
    })).filter(c => c.metrics.likeCount > 1 || c.metrics.retweetCount > 0);

    logger.info({ query, rawResults: (results.data?.data || []).length, afterFilter: candidates.length }, 'X timeline search results');

    let engaged = 0;
    for (const candidate of candidates) {
      if (engaged >= maxEngagements) break;

      try {
        const decision = await this.getEngagementDecision(candidate.text);

        if ((decision === 'quote' || decision === 'reply') && this.currentCommentAllowance <= 0) continue;
        if (decision === 'like' && this.currentLikeAllowance <= 0) continue;
        if (decision === 'skip') continue;
        
        // Dedupe checks via SQLite
        if (this.learning.hasEngagedWithTarget(decision, candidate.id)) continue;

        const record = await this.executeEngagement(client, myUserId, candidate, decision);
        records.push(record);

        if (record.success) {
          engaged++;
          this.learning.recordEngagementAction(decision, candidate.id, candidate.authorId, 'x', true);
          if (decision === 'quote' || decision === 'reply') this.currentCommentAllowance--;
          if (decision === 'like') this.currentLikeAllowance--;
        } else {
          this.learning.recordEngagementAction(decision, candidate.id, candidate.authorId, 'x', false);
        }
      } catch (error: any) {
        logger.warn({ tweetId: candidate.id, error: error.message }, 'Engagement action failed');
      }
    }
    return records;
  }

  private async replyToThreadsMentions(client: ThreadsApiClient, myUserId: string, maxReplies: number): Promise<EngagementRecord[]> {
    const records: EngagementRecord[] = [];
    try {
      const mentions = await client.getMentions(myUserId);
      for (const mention of mentions.slice(0, maxReplies)) {
        if (this.learning.hasEngagedWithTarget('reply', mention.id)) continue;

        try {
          if (this.currentCommentAllowance <= 0) continue;

          const replyText = await this.generateText(mention.text, 'reply');
          if (!replyText) continue;

          securityGuard.assertSafeForPublishing(replyText);
          await client.reply(replyText, mention.id, myUserId);

          this.learning.recordEngagementAction('reply', mention.id, mention.authorId!, 'threads', true);
          this.currentCommentAllowance--;

          records.push({
            tweetId: mention.id,
            authorId: mention.authorId!,
            action: 'reply',
            generatedContent: replyText,
            executedAt: new Date().toISOString(),
            success: true
          });
        } catch (error: any) {
          this.learning.recordEngagementAction('reply', mention.id, mention.authorId!, 'threads', false);
        }
      }
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to process Threads mentions');
    }
    return records;
  }

  private async engageThreadsTimeline(client: ThreadsApiClient, myUserId: string, maxEngagements: number): Promise<EngagementRecord[]> {
    const records: EngagementRecord[] = [];
    const queries = ['silicon valley startup', 'building in public', 'product design taste', 'indie hacker pipeline', 'solopreneur reality'];
    const query = queries[Math.floor(Math.random() * queries.length)];

    const candidates = await client.searchTimeline(query);
    const filtered = candidates.filter(c => (c.likeCount || 0) > 2); // Lower threshold slightly for Threads

    let engaged = 0;
    for (const candidate of filtered) {
      if (engaged >= maxEngagements) break;

      try {
        // Evaluate for Threads (only skip or reply)
        const systemPrompt = await this.promptCatalog.compose(['persona.system.md', 'engagement.system.md']);
        const response = await this.provider.complete(
          `${systemPrompt}\n\n## Target to Evaluate\n"${candidate.text.slice(0, 500)}"\n\nRespond with exactly ONE word: reply, or skip. (Threads does not support like or quote currently).`
        );
        const decision = response.trim().toLowerCase().replace(/[^a-z]/g, '');
        
        if (decision !== 'reply') continue;
        if (this.currentCommentAllowance <= 0) continue;
        if (this.learning.hasEngagedWithTarget('reply', candidate.id)) continue;

        const text = await this.generateText(candidate.text, 'reply');
        if (!text) continue;
        securityGuard.assertSafeForPublishing(text);

        await client.reply(text, candidate.id, myUserId);
        this.learning.recordEngagementAction('reply', candidate.id, candidate.authorId || 'unknown', 'threads', true);
        this.currentCommentAllowance--;
        engaged++;

        records.push({
          tweetId: candidate.id,
          authorId: candidate.authorId || 'unknown',
          action: 'reply',
          generatedContent: text,
          executedAt: new Date().toISOString(),
          success: true
        });
      } catch (error: any) {
        this.learning.recordEngagementAction('reply', candidate.id, candidate.authorId || 'unknown', 'threads', false);
        logger.warn({ threadId: candidate.id, error: error.message }, 'Threads engagement action failed');
      }
    }
    return records;
  }

  private async getEngagementDecision(tweetText: string): Promise<EngagementAction> {
    try {
      const systemPrompt = await this.promptCatalog.compose(['persona.system.md', 'engagement.system.md']);
      const response = await this.provider.complete(
        `${systemPrompt}\n\n## Tweet to Evaluate\n"${tweetText.slice(0, 500)}"\n\nRespond with exactly ONE word: repost, quote, reply, like, or skip.`
      );
      const cleaned = response.trim().toLowerCase().replace(/[^a-z]/g, '');
      if (['repost', 'quote', 'reply', 'like', 'skip'].includes(cleaned)) {
        return cleaned as EngagementAction;
      }
      return 'like';
    } catch (err: any) {
      // When model is down (529 etc), default to liking — safe, silent, and builds the algorithm footprint
      logger.info({ error: err?.message }, 'Engagement decision model unavailable, falling back to like');
      return 'like';
    }
  }

  private async executeEngagement(client: TwitterApi, myUserId: string, candidate: TweetCandidate, action: EngagementAction): Promise<EngagementRecord> {
    const now = new Date().toISOString();
    try {
      if (action === 'like') {
        await client.v2.like(myUserId, candidate.id);
        logger.info({ tweetId: candidate.id }, 'Liked tweet');
        return { tweetId: candidate.id, authorId: candidate.authorId, action, executedAt: now, success: true };
      }
      if (action === 'repost') {
        await client.v2.retweet(myUserId, candidate.id);
        logger.info({ tweetId: candidate.id }, 'Reposted tweet');
        return { tweetId: candidate.id, authorId: candidate.authorId, action, executedAt: now, success: true };
      }
      if (action === 'quote' || action === 'reply') {
        const text = await this.generateText(candidate.text, action);
        if (!text) throw new Error('Generation failed');
        securityGuard.assertSafeForPublishing(text);
        
        if (action === 'quote') {
          await client.v2.quote(text, candidate.id);
          logger.info({ tweetId: candidate.id }, 'Quote tweeted');
        } else {
          await client.v2.reply(text, candidate.id);
          logger.info({ tweetId: candidate.id }, 'Replied to tweet');
        }
        return { tweetId: candidate.id, authorId: candidate.authorId, action, generatedContent: text, executedAt: now, success: true };
      }
      return { tweetId: candidate.id, authorId: candidate.authorId, action: 'skip', executedAt: now, success: false };
    } catch (error: any) {
      logger.warn({ tweetId: candidate.id, action, error: error.message }, 'Engagement execution failed');
      return { tweetId: candidate.id, authorId: candidate.authorId, action, executedAt: now, success: false, error: error.message };
    }
  }

  private async generateText(tweetText: string, type: 'quote' | 'reply'): Promise<string | null> {
    try {
      const systemPrompt = await this.promptCatalog.compose(['persona.system.md', 'engagement.system.md']);
      const instruction = type === 'quote' 
        ? 'Write a sharp quote-tweet take under 200 characters. Add a unique angle.'
        : 'Write a sharp, concise reply under 200 characters.';
        
      const response = await this.provider.complete(`${systemPrompt}\n\n## Target\n"${tweetText.slice(0, 500)}"\n\n${instruction} Return ONLY the text.`);
      const cleaned = response.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
      return cleaned.length > 0 && cleaned.length <= 280 ? cleaned : null;
    } catch {
      return null;
    }
  }

  private async createXClient(): Promise<{ client: TwitterApi | null, userId?: string }> {
    const token = await this.tokenStore.getProviderToken('x');
    if (token && token.accessToken) {
      // Unified secure OAuth store support
      return { client: new TwitterApi(token.accessToken), userId: token.userId };
    }
    
    // Fallback support for older static api keys if explicitly set
    const appKey = getEnv('X_API_KEY');
    const appSecret = getEnv('X_API_KEY_SECRET');
    const accessToken = getEnv('X_ACCESS_TOKEN');
    const accessSecret = getEnv('X_ACCESS_TOKEN_SECRET');

    if (appKey && accessToken) {
      const client = new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
      try {
        const me = await client.v2.me();
        return { client, userId: me.data.id };
      } catch {
        return { client };
      }
    }
    
    return { client: null };
  }

  private async createThreadsClient(): Promise<{ client: ThreadsApiClient | null, userId?: string }> {
    const token = await this.tokenStore.getProviderToken('threads');
    if (token && token.accessToken) {
      return { client: new ThreadsApiClient(token.accessToken), userId: token.userId };
    }
    const envToken = getEnv('THREADS_ACCESS_TOKEN');
    if (envToken) {
      return { client: new ThreadsApiClient(envToken), userId: 'me' };
    }
    return { client: null };
  }
}

function getEnvNumber(name: string, fallback: number): number {
  const value = parseInt(getEnv(name), 10);
  return isNaN(value) ? fallback : Math.max(value, 1);
}

function isEnabled(name: string): boolean {
  return !['', '0', 'false', 'off', 'no'].includes(getEnv(name).trim().toLowerCase());
}
