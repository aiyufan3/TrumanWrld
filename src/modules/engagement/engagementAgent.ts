import { TwitterApi } from 'twitter-api-v2';
import { ICompletionProvider } from '../../adapters/model/openaiCompatibleProvider';
import { PromptCatalog } from '../../harness/promptCatalog';
import { logger } from '../../utils/logger';
import { getEnv } from '../../utils/secrets';
import { securityGuard } from '../security';
import fs from 'fs';
import path from 'path';

type EngagementAction = 'repost' | 'quote' | 'reply' | 'skip';

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
  private readonly cooldownAccounts = new Map<string, number>();
  private readonly cooldownHours = 24;

  constructor(
    private readonly provider: ICompletionProvider,
    private readonly promptCatalog = new PromptCatalog()
  ) {
    this.maxPerCycle = getEnvNumber('ENGAGEMENT_MAX_PER_CYCLE', 5);
  }

  /**
   * Run a full engagement cycle: reply to mentions + engage with timeline.
   */
  async runCycle(): Promise<EngagementRecord[]> {
    if (!isEnabled('ENGAGEMENT_ENABLED')) {
      logger.info('Engagement is disabled. Skipping cycle.');
      return [];
    }

    const client = this.createXClient();
    if (!client) {
      logger.warn('X API credentials not configured. Skipping engagement.');
      return [];
    }

    const records: EngagementRecord[] = [];
    let remaining = this.maxPerCycle;

    // Phase 1: Reply to recent mentions
    try {
      const mentionRecords = await this.replyToMentions(client, Math.min(2, remaining));
      records.push(...mentionRecords);
      remaining -= mentionRecords.filter((r) => r.success).length;
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Mention replies failed');
    }

    // Phase 2: Engage with timeline content
    if (remaining > 0) {
      try {
        const timelineRecords = await this.engageTimeline(client, remaining);
        records.push(...timelineRecords);
      } catch (error: any) {
        logger.warn({ error: error.message }, 'Timeline engagement failed');
      }
    }

    // Persist engagement log
    await this.persistRecords(records);

    logger.info(
      { total: records.length, successful: records.filter((r) => r.success).length },
      'Engagement cycle completed'
    );
    return records;
  }

  /**
   * Fetch recent @mentions and reply with TrumanWrld-persona responses.
   */
  private async replyToMentions(
    client: TwitterApi,
    maxReplies: number
  ): Promise<EngagementRecord[]> {
    const records: EngagementRecord[] = [];

    try {
      const me = await client.v2.me();
      const mentions = await client.v2.userMentionTimeline(me.data.id, {
        max_results: 5,
        'tweet.fields': ['text', 'author_id', 'created_at']
      });

      for (const mention of mentions.data?.data?.slice(0, maxReplies) || []) {
        if (this.isOnCooldown(mention.author_id!)) continue;

        try {
          const replyText = await this.generateReply(mention.text);
          if (!replyText) continue;

          securityGuard.assertSafeForPublishing(replyText);
          await client.v2.reply(replyText, mention.id);
          this.markCooldown(mention.author_id!);

          records.push({
            tweetId: mention.id,
            authorId: mention.author_id!,
            action: 'reply',
            generatedContent: replyText,
            executedAt: new Date().toISOString(),
            success: true
          });

          logger.info({ tweetId: mention.id, replyLength: replyText.length }, 'Replied to mention');
        } catch (error: any) {
          records.push({
            tweetId: mention.id,
            authorId: mention.author_id!,
            action: 'reply',
            executedAt: new Date().toISOString(),
            success: false,
            error: error.message
          });
        }
      }
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to fetch mentions');
    }

    return records;
  }

  /**
   * Search for high-signal tweets and engage via repost, quote, or reply.
   */
  private async engageTimeline(
    client: TwitterApi,
    maxEngagements: number
  ): Promise<EngagementRecord[]> {
    const records: EngagementRecord[] = [];
    const queries = [
      'AI agent infrastructure',
      'startup moat defensibility',
      'product design taste'
    ];

    const query = queries[Math.floor(Math.random() * queries.length)];
    let candidates: TweetCandidate[] = [];

    try {
      const results = await client.v2.search(query, {
        max_results: 15,
        'tweet.fields': ['public_metrics', 'author_id']
      });

      candidates = (results.data?.data || [])
        .filter((tweet: any) => {
          const metrics = tweet.public_metrics;
          return metrics && (metrics.like_count > 10 || metrics.retweet_count > 3);
        })
        .map((tweet: any) => ({
          id: tweet.id,
          text: tweet.text,
          authorId: tweet.author_id,
          metrics: tweet.public_metrics
            ? {
                likeCount: tweet.public_metrics.like_count,
                retweetCount: tweet.public_metrics.retweet_count,
                replyCount: tweet.public_metrics.reply_count
              }
            : undefined
        }));
    } catch (error: any) {
      logger.warn({ query, error: error.message }, 'Timeline search failed');
      return records;
    }

    let engaged = 0;
    for (const candidate of candidates) {
      if (engaged >= maxEngagements) break;
      if (this.isOnCooldown(candidate.authorId)) continue;

      try {
        const decision = await this.getEngagementDecision(candidate.text);
        if (decision === 'skip') continue;

        const record = await this.executeEngagement(client, candidate, decision);
        records.push(record);
        if (record.success) {
          engaged++;
          this.markCooldown(candidate.authorId);
        }
      } catch (error: any) {
        logger.warn({ tweetId: candidate.id, error: error.message }, 'Engagement action failed');
      }
    }

    return records;
  }

  /**
   * Ask MiniMax to decide: repost, quote, reply, or skip.
   */
  private async getEngagementDecision(tweetText: string): Promise<EngagementAction> {
    try {
      const systemPrompt = await this.promptCatalog.compose([
        'persona.system.md',
        'engagement.system.md'
      ]);

      const response = await this.provider.complete(
        `${systemPrompt}

## Tweet to Evaluate
"${tweetText.slice(0, 500)}"

Respond with exactly ONE word: repost, quote, reply, or skip.`
      );

      const cleaned = response
        .trim()
        .toLowerCase()
        .replace(/[^a-z]/g, '');
      if (['repost', 'quote', 'reply', 'skip'].includes(cleaned)) {
        return cleaned as EngagementAction;
      }
      return 'skip';
    } catch {
      return 'skip';
    }
  }

  /**
   * Execute the chosen engagement action on X.
   */
  private async executeEngagement(
    client: TwitterApi,
    candidate: TweetCandidate,
    action: EngagementAction
  ): Promise<EngagementRecord> {
    const now = new Date().toISOString();

    try {
      if (action === 'repost') {
        const me = await client.v2.me();
        await client.v2.retweet(me.data.id, candidate.id);
        logger.info({ tweetId: candidate.id }, 'Reposted tweet');
        return {
          tweetId: candidate.id,
          authorId: candidate.authorId,
          action: 'repost',
          executedAt: now,
          success: true
        };
      }

      if (action === 'quote') {
        const quoteText = await this.generateQuote(candidate.text);
        if (!quoteText) {
          return {
            tweetId: candidate.id,
            authorId: candidate.authorId,
            action: 'skip',
            executedAt: now,
            success: false,
            error: 'Quote generation failed'
          };
        }
        securityGuard.assertSafeForPublishing(quoteText);
        await client.v2.quote(quoteText, candidate.id);
        logger.info({ tweetId: candidate.id, quoteLength: quoteText.length }, 'Quote tweeted');
        return {
          tweetId: candidate.id,
          authorId: candidate.authorId,
          action: 'quote',
          generatedContent: quoteText,
          executedAt: now,
          success: true
        };
      }

      if (action === 'reply') {
        const replyText = await this.generateReply(candidate.text);
        if (!replyText) {
          return {
            tweetId: candidate.id,
            authorId: candidate.authorId,
            action: 'skip',
            executedAt: now,
            success: false,
            error: 'Reply generation failed'
          };
        }
        securityGuard.assertSafeForPublishing(replyText);
        await client.v2.reply(replyText, candidate.id);
        logger.info({ tweetId: candidate.id, replyLength: replyText.length }, 'Replied to tweet');
        return {
          tweetId: candidate.id,
          authorId: candidate.authorId,
          action: 'reply',
          generatedContent: replyText,
          executedAt: now,
          success: true
        };
      }

      return {
        tweetId: candidate.id,
        authorId: candidate.authorId,
        action: 'skip',
        executedAt: now,
        success: false
      };
    } catch (error: any) {
      return {
        tweetId: candidate.id,
        authorId: candidate.authorId,
        action,
        executedAt: now,
        success: false,
        error: error.message
      };
    }
  }

  private async generateReply(tweetText: string): Promise<string | null> {
    try {
      const systemPrompt = await this.promptCatalog.compose([
        'persona.system.md',
        'engagement.system.md'
      ]);

      const response = await this.provider.complete(
        `${systemPrompt}

## Tweet to Reply To
"${tweetText.slice(0, 500)}"

Write a sharp, concise reply under 200 characters. No hashtags, no emojis. Start with the insight, not "I".
Return ONLY the reply text.`
      );

      const cleaned = stripThinkTags(response);
      return cleaned.length > 0 && cleaned.length <= 280 ? cleaned : null;
    } catch {
      return null;
    }
  }

  private async generateQuote(tweetText: string): Promise<string | null> {
    try {
      const systemPrompt = await this.promptCatalog.compose([
        'persona.system.md',
        'engagement.system.md'
      ]);

      const response = await this.provider.complete(
        `${systemPrompt}

## Tweet to Quote
"${tweetText.slice(0, 500)}"

Write a sharp quote-tweet take under 200 characters. Add a unique angle the original didn't cover. No hashtags, no emojis.
Return ONLY the quote text.`
      );

      const cleaned = stripThinkTags(response);
      return cleaned.length > 0 && cleaned.length <= 280 ? cleaned : null;
    } catch {
      return null;
    }
  }

  private createXClient(): TwitterApi | null {
    const apiKey = getEnv('X_API_KEY');
    const apiSecret = getEnv('X_API_KEY_SECRET');
    const accessToken = getEnv('X_ACCESS_TOKEN');
    const accessSecret = getEnv('X_ACCESS_TOKEN_SECRET');

    if (!apiKey || !accessToken) return null;

    return new TwitterApi({
      appKey: apiKey,
      appSecret: apiSecret,
      accessToken,
      accessSecret
    });
  }

  private isOnCooldown(authorId: string): boolean {
    const lastEngaged = this.cooldownAccounts.get(authorId);
    if (!lastEngaged) return false;
    return Date.now() - lastEngaged < this.cooldownHours * 60 * 60 * 1000;
  }

  private markCooldown(authorId: string): void {
    this.cooldownAccounts.set(authorId, Date.now());
  }

  private async persistRecords(records: EngagementRecord[]): Promise<void> {
    if (records.length === 0) return;

    const dir = path.resolve(process.cwd(), 'runtime/hermes');
    fs.mkdirSync(dir, { recursive: true });

    const logPath = path.join(dir, 'engagement.ndjson');
    const lines =
      records.map((r) => JSON.stringify({ ...r, loggedAt: new Date().toISOString() })).join('\n') +
      '\n';
    fs.appendFileSync(logPath, lines, 'utf-8');
  }
}

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
}

function getEnvNumber(name: string, fallback: number): number {
  const value = parseInt(getEnv(name), 10);
  return isNaN(value) ? fallback : Math.max(value, 1);
}

function isEnabled(name: string): boolean {
  return !['', '0', 'false', 'off', 'no'].includes(getEnv(name).trim().toLowerCase());
}
