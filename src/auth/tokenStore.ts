import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { getEnv } from '../utils/secrets';
import {
  ConnectedProvider,
  ConnectionStatus,
  OAuthTokenRecord,
  OAuthTokenStorePayload,
  OAuthTokenStorePayloadSchema
} from './schemas';

const DEFAULT_TOKEN_STORE: OAuthTokenStorePayload = {
  version: 1,
  providers: {}
};

export class EncryptedTokenStore {
  constructor(
    private readonly filePath = path.resolve(
      process.cwd(),
      getEnv('OAUTH_TOKEN_STORE_PATH') || 'runtime/secure/oauth-tokens.enc'
    )
  ) {}

  async saveProviderToken(record: OAuthTokenRecord): Promise<void> {
    const store = await this.readStore();
    store.providers[record.provider] = record;
    await this.writeStore(store);
  }

  async getProviderToken(provider: ConnectedProvider): Promise<OAuthTokenRecord | null> {
    const store = await this.readStore();
    return store.providers[provider] || null;
  }

  async deleteProviderToken(provider: ConnectedProvider): Promise<void> {
    const store = await this.readStore();
    delete store.providers[provider];
    await this.writeStore(store);
  }

  async getStatuses(): Promise<ConnectionStatus[]> {
    const store = await this.readStore();
    return (['x', 'threads'] as const).map((provider) => {
      const record = store.providers[provider];
      return {
        provider,
        connected: Boolean(record),
        username: record?.username,
        displayName: record?.displayName,
        expiresAt: record?.expiresAt,
        obtainedAt: record?.obtainedAt
      };
    });
  }

  async readStore(): Promise<OAuthTokenStorePayload> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as {
        iv: string;
        tag: string;
        ciphertext: string;
      };
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        getEncryptionKey(),
        Buffer.from(parsed.iv, 'base64url')
      );
      decipher.setAuthTag(Buffer.from(parsed.tag, 'base64url'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(parsed.ciphertext, 'base64url')),
        decipher.final()
      ]).toString('utf8');
      return OAuthTokenStorePayloadSchema.parse(JSON.parse(plaintext));
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return structuredClone(DEFAULT_TOKEN_STORE);
      }

      logger.error({ message: error.message }, 'Failed to read encrypted OAuth token store');
      throw new Error('OAuth token store could not be read.');
    }
  }

  private async writeStore(store: OAuthTokenStorePayload): Promise<void> {
    const normalized = OAuthTokenStorePayloadSchema.parse(store);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
    const plaintext = JSON.stringify(normalized, null, 2);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(
      this.filePath,
      `${JSON.stringify(
        {
          iv: iv.toString('base64url'),
          tag: tag.toString('base64url'),
          ciphertext: ciphertext.toString('base64url')
        },
        null,
        2
      )}\n`,
      'utf8'
    );
  }
}

function getEncryptionKey(): Buffer {
  const raw =
    getEnv('OAUTH_TOKEN_ENCRYPTION_KEY') ||
    getEnv('TOKEN_ENCRYPTION_KEY') ||
    getEnv('APP_ENCRYPTION_KEY');

  if (!raw) {
    throw new Error(
      'Missing OAUTH_TOKEN_ENCRYPTION_KEY. Generate 32 random bytes and store them as base64.'
    );
  }

  const trimmed = raw.trim();
  const candidates = [
    () => Buffer.from(trimmed, 'base64'),
    () => Buffer.from(trimmed, 'base64url'),
    () => Buffer.from(trimmed, 'hex'),
    () => Buffer.from(trimmed, 'utf8')
  ];

  for (const candidate of candidates) {
    const key = candidate();
    if (key.length === 32) {
      return key;
    }
  }

  throw new Error('OAUTH_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.');
}
