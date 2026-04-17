import { EncryptedTokenStore } from '../../auth/tokenStore';
import { OAuthTokenRecord } from '../../auth/schemas';
import {
  ThreadsOAuthClient,
  XOAuthClient,
  XStaticOAuth1Client,
  ThreadsStaticClient
} from '../../auth/providers';
import { DraftVersion } from '../../schemas/models';
import { logger } from '../../utils/logger';
import { getEnv } from '../../utils/secrets';
import { securityGuard } from '../security';

export interface PublishResponse {
  success: boolean;
  externalId?: string;
  url?: string;
  attempts?: number;
}

export interface IPublisherAdapter {
  publish(request: {
    platform: DraftVersion['platform'];
    content: string;
  }): Promise<PublishResponse>;
}

export interface OAuthTokenStoreLike {
  getProviderToken(provider: 'x' | 'threads'): Promise<OAuthTokenRecord | null>;
  saveProviderToken(record: OAuthTokenRecord): Promise<void>;
}

export interface PublisherClient {
  refreshToken(record: OAuthTokenRecord): Promise<OAuthTokenRecord>;
  publishText(
    record: OAuthTokenRecord,
    content: string
  ): Promise<{ externalId?: string; url?: string }>;
}

export interface RealPublisherAdapterOptions {
  tokenStore?: OAuthTokenStoreLike;
  xClient?: PublisherClient;
  threadsClient?: PublisherClient;
  maxAttempts?: number;
  initialBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class MockPublisherAdapter implements IPublisherAdapter {
  async publish(request: {
    platform: DraftVersion['platform'];
    content: string;
  }): Promise<PublishResponse> {
    securityGuard.assertSafeForPublishing(request.content);
    logger.info(
      { platform: request.platform, mockContent: request.content },
      '[MOCK PUBLISHER] Pretending to publish to social platform'
    );
    return { success: true, attempts: 1 };
  }
}

export class RealPublisherAdapter implements IPublisherAdapter {
  private readonly tokenStore: OAuthTokenStoreLike;
  private readonly xClient: PublisherClient;
  private readonly threadsClient: PublisherClient;
  private readonly maxAttempts: number;
  private readonly initialBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: RealPublisherAdapterOptions = {}) {
    this.tokenStore = options.tokenStore || new EncryptedTokenStore();
    this.xClient =
      options.xClient || (getEnv('X_API_KEY') ? new XStaticOAuth1Client() : new XOAuthClient());
    this.threadsClient =
      options.threadsClient ||
      (getEnv('THREADS_ACCESS_TOKEN') ? new ThreadsStaticClient() : new ThreadsOAuthClient());
    this.maxAttempts = options.maxAttempts || getEnvNumber('PUBLISH_MAX_ATTEMPTS', 3);
    this.initialBackoffMs =
      options.initialBackoffMs || getEnvNumber('PUBLISH_RETRY_BACKOFF_MS', 1200);
    this.sleep = options.sleep || delay;
  }

  async publish(request: {
    platform: DraftVersion['platform'];
    content: string;
  }): Promise<PublishResponse> {
    securityGuard.assertSafeForPublishing(request.content);
    assertPublishingEnabled();

    if (request.platform === 'x' || request.platform === 'x-thread') {
      return this.publishWithProvider('x', this.xClient, request.content);
    }

    if (request.platform === 'threads') {
      try {
        return await this.publishWithProvider('threads', this.threadsClient, request.content);
      } catch (error: any) {
        if (/No stored OAuth token/i.test(error.message)) {
          logger.warn(
            { platform: 'threads' },
            'Threads account not connected yet — skipping Threads publish.'
          );
          return { success: false };
        }
        throw error;
      }
    }

    throw new Error(`Unsupported platform: ${request.platform}`);
  }

  private async publishWithProvider(
    provider: 'x' | 'threads',
    client: PublisherClient,
    content: string
  ): Promise<PublishResponse> {
    let forceRefresh = false;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const isStatic = (client as any).isStatic;
        const token = isStatic
          ? ({} as OAuthTokenRecord)
          : await this.getFreshToken(provider, client, forceRefresh);
        const published = await client.publishText(token, content);
        return {
          success: true,
          attempts: attempt,
          ...published
        };
      } catch (error: any) {
        const message = error.message || 'Unknown publishing failure';
        if (attempt >= this.maxAttempts || !isRetryablePublishError(message)) {
          throw error;
        }

        forceRefresh = isAuthPublishError(message);
        const waitMs = this.initialBackoffMs * attempt;
        logger.warn(
          { provider, attempt, waitMs, forceRefresh, error: message },
          'Publishing attempt failed, retrying.'
        );
        await this.sleep(waitMs);
      }
    }

    throw new Error(`Publishing failed for ${provider} after ${this.maxAttempts} attempts.`);
  }

  private async getFreshToken(
    provider: 'x' | 'threads',
    client: PublisherClient,
    forceRefresh = false
  ): Promise<OAuthTokenRecord> {
    const record = await this.tokenStore.getProviderToken(provider);
    if (!record) {
      throw new Error(`No stored OAuth token found for ${provider}. Connect the account first.`);
    }

    if (!forceRefresh && !shouldRefresh(record.expiresAt)) {
      return record;
    }

    if (!record.refreshToken && provider === 'x') {
      throw new Error(`Stored ${provider} token cannot be refreshed. Reconnect the account.`);
    }

    const refreshed = await client.refreshToken(record);
    await this.tokenStore.saveProviderToken(refreshed);
    return refreshed;
  }
}

export function createDefaultPublisherAdapter(): IPublisherAdapter {
  if (isEnabled('ALLOW_REAL_POSTS') && isEnabled('ALLOW_EXTERNAL_SIDE_EFFECTS')) {
    return new RealPublisherAdapter();
  }

  return new MockPublisherAdapter();
}

function shouldRefresh(expiresAt?: string): boolean {
  if (!expiresAt) {
    return false;
  }

  return Date.now() >= new Date(expiresAt).getTime() - 5 * 60 * 1000;
}

function assertPublishingEnabled(): void {
  if (!isEnabled('ALLOW_REAL_POSTS') || !isEnabled('ALLOW_EXTERNAL_SIDE_EFFECTS')) {
    throw new Error(
      'Real publishing is disabled. Set ALLOW_REAL_POSTS=true and ALLOW_EXTERNAL_SIDE_EFFECTS=true to enable it.'
    );
  }
}

function isEnabled(name: string): boolean {
  return !['', '0', 'false', 'off', 'no'].includes(getEnv(name).trim().toLowerCase());
}

function getEnvNumber(name: string, fallback: number): number {
  const value = Number.parseInt(getEnv(name), 10);
  return Number.isNaN(value) ? fallback : Math.max(value, 1);
}

function isRetryablePublishError(message: string): boolean {
  return (
    isAuthPublishError(message) ||
    /\bHTTP (408|409|425|429)\b/i.test(message) ||
    /\bHTTP 5\d\d\b/i.test(message) ||
    /timeout|temporar|connection reset|network/i.test(message)
  );
}

function isAuthPublishError(message: string): boolean {
  return (
    /\bHTTP (401|403)\b/i.test(message) || /expired|invalid token|authorization/i.test(message)
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
