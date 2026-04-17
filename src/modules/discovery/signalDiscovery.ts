import { TwitterApi } from 'twitter-api-v2';
import { ICompletionProvider } from '../../adapters/model/openaiCompatibleProvider';
import { logger } from '../../utils/logger';
import { getEnv } from '../../utils/secrets';
import { SIGNAL_BANK } from './signalBank';
import fs from 'fs';
import path from 'path';

interface DiscoveryResult {
  source: 'x_trends' | 'rss' | 'signal_bank';
  content: string;
}

export class SignalDiscoveryService {
  private usedSignalIndices = new Set<number>();

  constructor(private readonly provider: ICompletionProvider) {}

  /**
   * Main entry: discover the best signal for the current cycle.
   * Tries X trends first, then RSS, then curated signal bank.
   */
  async discoverSignal(): Promise<DiscoveryResult> {
    // Try X trending search
    try {
      const xSignals = await this.fetchXTrends();
      if (xSignals.length > 0) {
        const best = await this.selectBestSignal(xSignals);
        if (best) {
          logger.info({ source: 'x_trends' }, 'Signal discovered from X trending topics');
          return { source: 'x_trends', content: best };
        }
      }
    } catch (error: any) {
      logger.warn({ error: error.message }, 'X trend discovery failed, trying RSS');
    }

    // Try RSS feeds
    try {
      const rssSignals = await this.fetchRSSSignals();
      if (rssSignals.length > 0) {
        const best = await this.selectBestSignal(rssSignals);
        if (best) {
          logger.info({ source: 'rss' }, 'Signal discovered from RSS feeds');
          return { source: 'rss', content: best };
        }
      }
    } catch (error: any) {
      logger.warn({ error: error.message }, 'RSS discovery failed, using signal bank');
    }

    // Fallback: curated signal bank
    const signal = this.pickFromSignalBank();
    logger.info({ source: 'signal_bank' }, 'Signal selected from curated bank');
    return { source: 'signal_bank', content: signal };
  }

  /**
   * Search X for high-engagement tweets about AI, tech, and capital.
   */
  async fetchXTrends(): Promise<string[]> {
    const apiKey = getEnv('X_API_KEY');
    const apiSecret = getEnv('X_API_KEY_SECRET');
    const accessToken = getEnv('X_ACCESS_TOKEN');
    const accessSecret = getEnv('X_ACCESS_TOKEN_SECRET');

    if (!apiKey || !accessToken) {
      return [];
    }

    const client = new TwitterApi({
      appKey: apiKey,
      appSecret: apiSecret,
      accessToken,
      accessSecret
    });

    const queries = [
      'AI agent infrastructure',
      'LLM deployment production',
      'startup capital moat'
    ];

    const signals: string[] = [];
    // Only use one query per cycle to conserve API credits
    const query = queries[Math.floor(Math.random() * queries.length)];

    try {
      const results = await client.v2.search(query, {
        max_results: 10,
        'tweet.fields': ['public_metrics', 'text']
      });

      for (const tweet of results.data?.data || []) {
        const metrics = (tweet as any).public_metrics;
        // Only consider tweets with meaningful engagement
        if (metrics && (metrics.like_count > 20 || metrics.retweet_count > 5)) {
          signals.push(tweet.text);
        }
      }
    } catch (error: any) {
      logger.warn({ query, error: error.message }, 'X search query failed');
    }

    return signals;
  }

  /**
   * Fetch recent article titles/descriptions from RSS feeds.
   */
  async fetchRSSSignals(): Promise<string[]> {
    const feedsPath = path.resolve(process.cwd(), 'config/rssFeeds.json');
    if (!fs.existsSync(feedsPath)) {
      return [];
    }

    const feeds: string[] = JSON.parse(fs.readFileSync(feedsPath, 'utf-8'));
    const signals: string[] = [];

    for (const feedUrl of feeds.slice(0, 3)) {
      try {
        const response = await fetch(feedUrl, {
          signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) continue;

        const text = await response.text();
        // Extract titles and descriptions for richer signals
        const items = extractRSSItems(text);
        signals.push(...items.slice(0, 3));
      } catch (error: any) {
        logger.warn({ feedUrl, error: error.message }, 'RSS feed fetch failed');
      }
    }

    // Filter out signals that are too short to be useful
    return signals.filter((s) => s.length >= 60);
  }

  /**
   * Use MiniMax to select the best signal from a list of candidates.
   */
  async selectBestSignal(candidates: string[]): Promise<string | null> {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    try {
      const numbered = candidates.map((c, i) => `${i + 1}. ${c}`).join('\n');
      const response = await this.provider.complete(
        `You are a content strategist for an "AI × Capital × Taste" personal brand called TrumanWrld.

Given these candidate signals, pick the ONE with the highest potential for a sharp, high-signal social media post. Return ONLY the number (1, 2, 3, etc.) of your choice. Nothing else.

${numbered}`
      );

      const index = parseInt(response.trim(), 10) - 1;
      if (index >= 0 && index < candidates.length) {
        return candidates[index];
      }
      return candidates[0];
    } catch {
      return candidates[0];
    }
  }

  /**
   * Pick from the curated signal bank, avoiding repeats.
   */
  private pickFromSignalBank(): string {
    if (this.usedSignalIndices.size >= SIGNAL_BANK.length) {
      this.usedSignalIndices.clear();
    }

    let index: number;
    do {
      index = Math.floor(Math.random() * SIGNAL_BANK.length);
    } while (this.usedSignalIndices.has(index));

    this.usedSignalIndices.add(index);
    return SIGNAL_BANK[index];
  }
}

/**
 * Extract title + description pairs from RSS XML items.
 */
function extractRSSItems(xml: string): string[] {
  const items: string[] = [];
  // Match each <item>...</item> block
  const itemRegex = /<item[^>]*>(.*?)<\/item>/gs;
  let itemMatch: RegExpExecArray | null;

  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const block = itemMatch[1];
    const title = extractTag(block, 'title');
    const description = extractTag(block, 'description');

    if (title && title.length > 10 && !title.includes('RSS') && !title.includes('Feed')) {
      // Combine title + description for a richer signal
      const signal =
        description && description.length > 20 ? `${title}. ${description.slice(0, 300)}` : title;
      items.push(signal);
    }
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  // Handle CDATA and plain text
  const regex = new RegExp(
    `<${tag}[^>]*><!\\[CDATA\\[(.+?)\\]\\]>|<${tag}[^>]*>([^<]+)<\\/${tag}>`,
    's'
  );
  const match = regex.exec(xml);
  return (match?.[1] || match?.[2] || '').replace(/<[^>]+>/g, '').trim();
}
