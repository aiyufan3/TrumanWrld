import { describe, expect, it } from 'vitest';
import { securityGuard } from '../src/modules/security';
import { GuardianService } from '../src/modules/guardian';
import { ContentDraft } from '../src/schemas/models';

describe('SecurityGuardService', () => {
  it('blocks credential-like material before model egress', () => {
    expect(() =>
      securityGuard.assertSafeForModelPrompt(
        'Authorization: Bearer sk-secretvalue1234567890 should never leave the machine.'
      )
    ).toThrow(/Security guard blocked model prompt/i);
  });

  it('does not block benign security guidance text', () => {
    expect(() =>
      securityGuard.assertSafeForModelPrompt(
        'Use a password manager and never commit tokens to git.'
      )
    ).not.toThrow();
  });

  it('makes guardian reject secret-like draft content', async () => {
    const guardian = new GuardianService();
    const draft: ContentDraft = {
      id: 'draft-1',
      topic: 'Security hygiene',
      status: 'draft',
      versions: [
        {
          platform: 'x',
          content: 'password=supersecret123',
          tone: 'sharp'
        }
      ]
    };

    await expect(guardian.reviewDraft(draft)).resolves.toEqual({
      passed: false,
      reason: 'Sensitive credential-like material detected in x content.'
    });
  });
});
