import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OAuthTokenStoreLike,
  PublisherClient,
  RealPublisherAdapter
} from '../src/modules/publishing';
import { OAuthTokenRecord } from '../src/auth/schemas';

class MemoryTokenStore implements OAuthTokenStoreLike {
  public record: OAuthTokenRecord | null;
  public readonly saved: OAuthTokenRecord[] = [];

  constructor(record: OAuthTokenRecord | null) {
    this.record = record;
  }

  async getProviderToken(): Promise<OAuthTokenRecord | null> {
    return this.record;
  }

  async saveProviderToken(record: OAuthTokenRecord): Promise<void> {
    this.record = record;
    this.saved.push(record);
  }
}

describe('RealPublisherAdapter', () => {
  const originalRealPosts = process.env.ALLOW_REAL_POSTS;
  const originalSideEffects = process.env.ALLOW_EXTERNAL_SIDE_EFFECTS;

  beforeEach(() => {
    process.env.ALLOW_REAL_POSTS = 'true';
    process.env.ALLOW_EXTERNAL_SIDE_EFFECTS = 'true';
  });

  afterEach(() => {
    process.env.ALLOW_REAL_POSTS = originalRealPosts;
    process.env.ALLOW_EXTERNAL_SIDE_EFFECTS = originalSideEffects;
  });

  it('retries transient provider failures and records attempt count', async () => {
    const tokenStore = new MemoryTokenStore({
      provider: 'x',
      accessToken: 'token-1',
      refreshToken: 'refresh-1',
      obtainedAt: new Date().toISOString()
    });

    const publishText = vi
      .fn<PublisherClient['publishText']>()
      .mockRejectedValueOnce(new Error('X publish failed: HTTP 429 rate limited'))
      .mockRejectedValueOnce(new Error('X publish failed: HTTP 503 upstream unavailable'))
      .mockResolvedValueOnce({ externalId: '123', url: 'https://x.com/i/web/status/123' });

    const xClient: PublisherClient = {
      refreshToken: vi.fn(async (record) => record),
      publishText
    };

    const adapter = new RealPublisherAdapter({
      tokenStore,
      xClient,
      threadsClient: xClient,
      maxAttempts: 3,
      initialBackoffMs: 1,
      sleep: async () => {}
    });

    const result = await adapter.publish({
      platform: 'x',
      content: 'Builders need deterministic release rails.'
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.externalId).toBe('123');
    expect(publishText).toHaveBeenCalledTimes(3);
  });

  it('refreshes the token after an auth failure before retrying', async () => {
    const tokenStore = new MemoryTokenStore({
      provider: 'x',
      accessToken: 'stale-token',
      refreshToken: 'refresh-1',
      obtainedAt: new Date().toISOString()
    });

    const publishText = vi
      .fn<PublisherClient['publishText']>()
      .mockImplementationOnce(async () => {
        throw new Error('X publish failed: HTTP 401 token expired');
      })
      .mockImplementationOnce(async (record) => {
        expect(record.accessToken).toBe('fresh-token');
        return { externalId: '999' };
      });

    const refreshedToken: OAuthTokenRecord = {
      provider: 'x',
      accessToken: 'fresh-token',
      refreshToken: 'refresh-2',
      obtainedAt: new Date().toISOString()
    };

    const xClient: PublisherClient = {
      refreshToken: vi.fn(async () => refreshedToken),
      publishText
    };

    const adapter = new RealPublisherAdapter({
      tokenStore,
      xClient,
      threadsClient: xClient,
      maxAttempts: 3,
      initialBackoffMs: 1,
      sleep: async () => {}
    });

    const result = await adapter.publish({
      platform: 'x',
      content: 'Authorization should stay inside token refresh lanes.'
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(tokenStore.saved).toHaveLength(1);
    expect(tokenStore.saved[0]?.accessToken).toBe('fresh-token');
  });
});
