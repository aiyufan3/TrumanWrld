import crypto from 'crypto';
import { logger } from '../utils/logger';
import { getEnv } from '../utils/secrets';
import { OAuthTokenRecord, ConnectedProvider } from './schemas';

interface OAuthCallbackArgs {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

interface ProviderPublishResult {
  externalId?: string;
  url?: string;
}

export interface OAuthProviderClient {
  readonly provider: ConnectedProvider;
  readonly callbackPath: string;
  isConfigured(): boolean;
  getAuthorizeUrl(args: { state: string; codeChallenge?: string; redirectUri: string }): string;
  exchangeCode(args: OAuthCallbackArgs): Promise<OAuthTokenRecord>;
  refreshToken(record: OAuthTokenRecord): Promise<OAuthTokenRecord>;
  publishText(record: OAuthTokenRecord, content: string): Promise<ProviderPublishResult>;
}

const X_AUTHORIZATION_URL = 'https://x.com/i/oauth2/authorize';
const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const X_ME_URL = 'https://api.x.com/2/users/me?user.fields=username,name';
const X_CREATE_POST_URL = 'https://api.x.com/2/tweets';

const THREADS_AUTHORIZATION_URL = 'https://threads.net/oauth/authorize';
const THREADS_TOKEN_URL = 'https://graph.threads.net/oauth/access_token';
const THREADS_LONG_LIVED_URL = 'https://graph.threads.net/access_token';
const THREADS_REFRESH_URL = 'https://graph.threads.net/refresh_access_token';
const THREADS_PROFILE_URL = 'https://graph.threads.net/me?fields=id,username,name';

export class XOAuthClient implements OAuthProviderClient {
  readonly provider = 'x' as const;
  readonly callbackPath = '/auth/x/callback';

  isConfigured(): boolean {
    return Boolean(getEnv('X_CLIENT_ID'));
  }

  getAuthorizeUrl(args: { state: string; codeChallenge?: string; redirectUri: string }): string {
    const url = new URL(X_AUTHORIZATION_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', getEnv('X_CLIENT_ID', true));
    url.searchParams.set('redirect_uri', args.redirectUri);
    url.searchParams.set('scope', getXScopes());
    url.searchParams.set('state', args.state);
    url.searchParams.set('code_challenge', args.codeChallenge || '');
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeCode(args: OAuthCallbackArgs): Promise<OAuthTokenRecord> {
    const body = new URLSearchParams({
      code: args.code,
      grant_type: 'authorization_code',
      client_id: getEnv('X_CLIENT_ID', true),
      redirect_uri: args.redirectUri,
      code_verifier: args.codeVerifier || ''
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded'
    };
    const clientSecret = getEnv('X_CLIENT_SECRET');
    if (clientSecret) {
      headers.Authorization = buildBasicAuth(getEnv('X_CLIENT_ID', true), clientSecret);
    }

    const response = await fetch(X_TOKEN_URL, {
      method: 'POST',
      headers,
      body
    });
    if (!response.ok) {
      throw await makeProviderError('X token exchange failed', response);
    }

    const tokenPayload = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      token_type?: string;
      expires_in?: number;
      scope?: string;
    };

    const profile = await this.fetchProfile(tokenPayload.access_token);
    return {
      provider: 'x',
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token,
      tokenType: tokenPayload.token_type,
      scope: tokenPayload.scope,
      userId: profile.userId,
      username: profile.username,
      displayName: profile.displayName,
      obtainedAt: new Date().toISOString(),
      expiresAt: toExpiry(tokenPayload.expires_in),
      metadata: {
        authType: 'oauth2_pkce'
      }
    };
  }

  async refreshToken(record: OAuthTokenRecord): Promise<OAuthTokenRecord> {
    if (!record.refreshToken) {
      throw new Error('X refresh token is missing. Reconnect the account.');
    }

    const body = new URLSearchParams({
      refresh_token: record.refreshToken,
      grant_type: 'refresh_token',
      client_id: getEnv('X_CLIENT_ID', true)
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded'
    };
    const clientSecret = getEnv('X_CLIENT_SECRET');
    if (clientSecret) {
      headers.Authorization = buildBasicAuth(getEnv('X_CLIENT_ID', true), clientSecret);
    }

    const response = await fetch(X_TOKEN_URL, {
      method: 'POST',
      headers,
      body
    });
    if (!response.ok) {
      throw await makeProviderError('X token refresh failed', response);
    }

    const payload = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      token_type?: string;
      expires_in?: number;
      scope?: string;
    };

    return {
      ...record,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || record.refreshToken,
      tokenType: payload.token_type || record.tokenType,
      scope: payload.scope || record.scope,
      obtainedAt: new Date().toISOString(),
      expiresAt: toExpiry(payload.expires_in)
    };
  }

  async publishText(record: OAuthTokenRecord, content: string): Promise<ProviderPublishResult> {
    const response = await fetch(X_CREATE_POST_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${record.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text: content })
    });
    if (!response.ok) {
      throw await makeProviderError('X publish failed', response);
    }

    const payload = (await response.json()) as {
      data?: {
        id?: string;
      };
    };
    const externalId = payload.data?.id;
    return {
      externalId,
      url:
        record.username && externalId
          ? `https://x.com/${record.username}/status/${externalId}`
          : externalId
            ? `https://x.com/i/web/status/${externalId}`
            : undefined
    };
  }

  private async fetchProfile(accessToken: string): Promise<{
    userId?: string;
    username?: string;
    displayName?: string;
  }> {
    try {
      const response = await fetch(X_ME_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      if (!response.ok) {
        return {};
      }

      const payload = (await response.json()) as {
        data?: {
          id?: string;
          username?: string;
          name?: string;
        };
      };
      return {
        userId: payload.data?.id,
        username: payload.data?.username,
        displayName: payload.data?.name
      };
    } catch (error: any) {
      logger.warn({ message: error.message }, 'Failed to fetch X profile during OAuth callback');
      return {};
    }
  }
}

export class ThreadsOAuthClient implements OAuthProviderClient {
  readonly provider = 'threads' as const;
  readonly callbackPath = '/auth/threads/callback';

  isConfigured(): boolean {
    return Boolean(getEnv('THREADS_APP_ID') && getEnv('THREADS_APP_SECRET'));
  }

  getAuthorizeUrl(args: { state: string; redirectUri: string }): string {
    const url = new URL(THREADS_AUTHORIZATION_URL);
    url.searchParams.set('client_id', getEnv('THREADS_APP_ID', true));
    url.searchParams.set('redirect_uri', args.redirectUri);
    url.searchParams.set('scope', getThreadsScopes());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', args.state);
    return url.toString();
  }

  async exchangeCode(args: OAuthCallbackArgs): Promise<OAuthTokenRecord> {
    const response = await fetch(THREADS_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: getEnv('THREADS_APP_ID', true),
        client_secret: getEnv('THREADS_APP_SECRET', true),
        code: args.code,
        grant_type: 'authorization_code',
        redirect_uri: args.redirectUri
      })
    });
    if (!response.ok) {
      throw await makeProviderError('Threads token exchange failed', response);
    }

    const shortLived = (await response.json()) as {
      access_token: string;
      user_id?: string;
    };

    const longLived = await this.exchangeLongLivedToken(shortLived.access_token);
    const profile = await this.fetchProfile(longLived.accessToken);
    return {
      provider: 'threads',
      accessToken: longLived.accessToken,
      tokenType: longLived.tokenType,
      userId: String(shortLived.user_id || profile.userId),
      username: profile.username,
      displayName: profile.displayName,
      obtainedAt: new Date().toISOString(),
      expiresAt: longLived.expiresAt,
      scope: getThreadsScopes(),
      metadata: {
        authType: 'oauth2_authorization_code'
      }
    };
  }

  async refreshToken(record: OAuthTokenRecord): Promise<OAuthTokenRecord> {
    const url = new URL(THREADS_REFRESH_URL);
    url.searchParams.set('grant_type', 'th_refresh_token');
    url.searchParams.set('access_token', record.accessToken);

    const response = await fetch(url);
    if (!response.ok) {
      throw await makeProviderError('Threads token refresh failed', response);
    }

    const payload = (await response.json()) as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
    };

    return {
      ...record,
      accessToken: payload.access_token || record.accessToken,
      tokenType: payload.token_type || record.tokenType,
      obtainedAt: new Date().toISOString(),
      expiresAt: toExpiry(payload.expires_in)
    };
  }

  async publishText(record: OAuthTokenRecord, content: string): Promise<ProviderPublishResult> {
    const userId = record.userId || 'me';
    const createResponse = await fetch(`https://graph.threads.net/${userId}/threads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        access_token: record.accessToken,
        media_type: 'TEXT',
        text: content
      })
    });
    if (!createResponse.ok) {
      throw await makeProviderError('Threads container creation failed', createResponse);
    }

    const container = (await createResponse.json()) as { id?: string };
    if (!container.id) {
      throw new Error('Threads container creation returned no id.');
    }

    const publishResponse = await fetch(`https://graph.threads.net/${userId}/threads_publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        access_token: record.accessToken,
        creation_id: container.id
      })
    });
    if (!publishResponse.ok) {
      throw await makeProviderError('Threads publish failed', publishResponse);
    }

    const payload = (await publishResponse.json()) as { id?: string };
    return {
      externalId: payload.id,
      url:
        record.username && payload.id
          ? `https://www.threads.net/@${record.username}/post/${payload.id}`
          : undefined
    };
  }

  private async exchangeLongLivedToken(shortLivedToken: string): Promise<{
    accessToken: string;
    tokenType?: string;
    expiresAt?: string;
  }> {
    const url = new URL(THREADS_LONG_LIVED_URL);
    url.searchParams.set('grant_type', 'th_exchange_token');
    url.searchParams.set('client_secret', getEnv('THREADS_APP_SECRET', true));
    url.searchParams.set('access_token', shortLivedToken);

    const response = await fetch(url);
    if (!response.ok) {
      throw await makeProviderError('Threads long-lived token exchange failed', response);
    }

    const payload = (await response.json()) as {
      access_token: string;
      token_type?: string;
      expires_in?: number;
    };
    return {
      accessToken: payload.access_token,
      tokenType: payload.token_type,
      expiresAt: toExpiry(payload.expires_in)
    };
  }

  private async fetchProfile(accessToken: string): Promise<{
    userId?: string;
    username?: string;
    displayName?: string;
  }> {
    try {
      const response = await fetch(THREADS_PROFILE_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      if (!response.ok) {
        return {};
      }

      const payload = (await response.json()) as {
        id?: string;
        username?: string;
        name?: string;
      };
      return {
        userId: payload.id,
        username: payload.username,
        displayName: payload.name
      };
    } catch (error: any) {
      logger.warn(
        { message: error.message },
        'Failed to fetch Threads profile during OAuth callback'
      );
      return {};
    }
  }
}

export class XStaticOAuth1Client implements OAuthProviderClient {
  readonly provider = 'x' as const;
  readonly callbackPath = '';
  readonly isStatic = true;

  isConfigured(): boolean {
    return Boolean(getEnv('X_API_KEY') && getEnv('X_ACCESS_TOKEN'));
  }

  getAuthorizeUrl(args: { state: string; redirectUri: string }): string {
    throw new Error('Static OAuth1 client does not support getAuthorizeUrl');
  }

  async exchangeCode(args: OAuthCallbackArgs): Promise<OAuthTokenRecord> {
    throw new Error('Static OAuth1 client does not support exchangeCode');
  }

  async refreshToken(record: OAuthTokenRecord): Promise<OAuthTokenRecord> {
    return record;
  }

  async publishText(_record: OAuthTokenRecord, content: string): Promise<ProviderPublishResult> {
    const { TwitterApi } = await import('twitter-api-v2');
    const client = new TwitterApi({
      appKey: getEnv('X_API_KEY', true),
      appSecret: getEnv('X_API_KEY_SECRET', true),
      accessToken: getEnv('X_ACCESS_TOKEN', true),
      accessSecret: getEnv('X_ACCESS_TOKEN_SECRET', true)
    });

    const response = await client.v2.tweet(content);
    return {
      externalId: response.data.id,
      url: `https://x.com/i/web/status/${response.data.id}`
    };
  }
}

export class ThreadsStaticClient implements OAuthProviderClient {
  readonly provider = 'threads' as const;
  readonly callbackPath = '';
  readonly isStatic = true;

  isConfigured(): boolean {
    return Boolean(getEnv('THREADS_ACCESS_TOKEN'));
  }

  getAuthorizeUrl(): string {
    throw new Error('Static Threads client does not support getAuthorizeUrl');
  }

  async exchangeCode(): Promise<OAuthTokenRecord> {
    throw new Error('Static Threads client does not support exchangeCode');
  }

  async refreshToken(record: OAuthTokenRecord): Promise<OAuthTokenRecord> {
    return record;
  }

  async publishText(_record: OAuthTokenRecord, content: string): Promise<ProviderPublishResult> {
    const accessToken = getEnv('THREADS_ACCESS_TOKEN', true);
    const userId = getEnv('THREADS_USER_ID') || 'me';

    // Step 1: Create media container
    const createResponse = await fetch(`https://graph.threads.net/${userId}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: accessToken,
        media_type: 'TEXT',
        text: content
      })
    });
    if (!createResponse.ok) {
      const body = await createResponse.text().catch(() => '');
      throw new Error(`Threads container creation failed: HTTP ${createResponse.status} ${body}`);
    }

    const container = (await createResponse.json()) as { id?: string };
    if (!container.id) {
      throw new Error('Threads container creation returned no id.');
    }

    // Step 2: Publish the container
    const publishResponse = await fetch(`https://graph.threads.net/${userId}/threads_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: accessToken,
        creation_id: container.id
      })
    });
    if (!publishResponse.ok) {
      const body = await publishResponse.text().catch(() => '');
      throw new Error(`Threads publish failed: HTTP ${publishResponse.status} ${body}`);
    }

    const payload = (await publishResponse.json()) as { id?: string };
    return {
      externalId: payload.id,
      url: payload.id ? `https://www.threads.net/post/${payload.id}` : undefined
    };
  }
}

export function generateOauthState(): string {
  return crypto.randomBytes(16).toString('base64url');
}

export function generateCodeVerifier(): string {
  return crypto.randomBytes(48).toString('base64url');
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function buildBasicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

function getXScopes(): string {
  return getEnv('X_OAUTH_SCOPES') || 'tweet.read tweet.write users.read offline.access';
}

function getThreadsScopes(): string {
  return getEnv('THREADS_OAUTH_SCOPES') || 'threads_basic,threads_content_publish,threads_manage_replies,threads_read_replies,threads_manage_mentions,threads_keyword_search';
}

function toExpiry(expiresInSeconds?: number): string | undefined {
  if (!expiresInSeconds) {
    return undefined;
  }

  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

async function makeProviderError(prefix: string, response: Response): Promise<Error> {
  const body = await safeReadBody(response);
  return new Error(`${prefix}: HTTP ${response.status}${body ? ` ${body}` : ''}`);
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return truncate(await response.text());
  } catch {
    return '';
  }
}

function truncate(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}
