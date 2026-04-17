import { TwitterApi } from 'twitter-api-v2';
import { ICompletionProvider } from '../../adapters/model/openaiCompatibleProvider';
import { PromptCatalog } from '../../harness/promptCatalog';
import { logger } from '../../utils/logger';
import { getEnv } from '../../utils/secrets';
import { securityGuard } from '../security';
import { LearningService } from '../learning';
import { EncryptedTokenStore } from '../../auth/tokenStore';

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
      logger.warn('X API credentials or token not configured. Skipping engagement.');
      return [];
    }

    // Threads API limitation detection
    if (isEnabled('HERMES_THREADS_ENGAGEMENT_ENABLED')) {
      logger.info('Threads REST API does not officially support timeline search or user engagement interactions yet. Gracefully skipping Threads engagement.');
    }

    const records: EngagementRecord[] = [];
    let remaining = this.maxPerCycle;

    // Load allowances using SQLite Memory
    const hourlyComments = this.learning.getRecentActionCount(['reply', 'quote'], 1);
    this.currentCommentAllowance = Math.max(0, 10 - hourlyComments);

    const hourlyLikes = this.learning.getRecentActionCount(['like'], 1);
    this.currentLikeAllowance = Math.max(0, this.maxLikesPerHour - hourlyLikes);

    if (this.currentCommentAllowance <= 0) {
      logger.info('Hourly comment limit reached. Reposts and likes only.');
    }
    if (this.currentLikeAllowance <= 0) {
      logger.info('Hourly like limit reached.');
    }

    // Phase 1: Reply to mentions (comments use allowance)
    try {
      const mentionRecords = await this.replyToMentions(client, Math.min(2, remaining));
      records.push(...mentionRecords);
      remaining -= mentionRecords.filter((r) => r.success).length;
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Mention replies failed');
    }

    // Phase 2: Timeline Engagement
    if (remaining > 0) {
      try {
        const timelineRecords = await this.engageTimeline(client, userId, remaining);
        records.push(...timelineRecords);
      } catch (error: any) {
        logger.warn({ error: error.message }, 'Timeline engagement failed');
      }
    }

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
    const queries = ['silicon valley startup', 'building in public', 'product design taste', 'indie hacker pipeline', 'solopreneur reality'];
    const query = queries[Math.floor(Math.random() * queries.length)];

    const results = await client.v2.search(query, {
      max_results: 30,
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
    })).filter(c => c.metrics.likeCount > 5 || c.metrics.retweetCount > 2);

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
      return 'skip';
    } catch {
      return 'skip';
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
}

function getEnvNumber(name: string, fallback: number): number {
  const value = parseInt(getEnv(name), 10);
  return isNaN(value) ? fallback : Math.max(value, 1);
}

function isEnabled(name: string): boolean {
  return !['', '0', 'false', 'off', 'no'].includes(getEnv(name).trim().toLowerCase());
}
