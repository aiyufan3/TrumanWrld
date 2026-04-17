import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { EncryptedTokenStore } from '../src/auth/tokenStore';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('EncryptedTokenStore', () => {
  it('encrypts stored provider tokens at rest', async () => {
    const tempRoot = await fs.mkdtemp(path.join(process.cwd(), 'tmp-token-store-'));
    tempRoots.push(tempRoot);
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

    const filePath = path.join(tempRoot, 'oauth.enc');
    const store = new EncryptedTokenStore(filePath);
    await store.saveProviderToken({
      provider: 'x',
      accessToken: 'very-secret-token',
      obtainedAt: new Date().toISOString(),
      username: 'example'
    });

    const raw = await fs.readFile(filePath, 'utf8');
    expect(raw).not.toContain('very-secret-token');

    const token = await store.getProviderToken('x');
    expect(token?.accessToken).toBe('very-secret-token');
  });
});
