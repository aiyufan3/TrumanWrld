import { getEnv } from '../../utils/secrets';

export interface SecurityFinding {
  code: string;
  message: string;
  matchPreview: string;
}

export interface SecurityAuditResult {
  blocked: boolean;
  findings: SecurityFinding[];
  summary: string;
}

const SECRET_PATTERNS: Array<{
  code: string;
  message: string;
  regex: RegExp;
}> = [
  {
    code: 'private_key_block',
    message: 'Private key material detected.',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/i
  },
  {
    code: 'bearer_header',
    message: 'Authorization bearer header detected.',
    regex: /authorization\s*:\s*bearer\s+[a-z0-9._~+/-]{16,}/i
  },
  {
    code: 'credential_assignment',
    message: 'Credential-like assignment detected.',
    regex:
      /\b(?:access[_ -]?token|refresh[_ -]?token|api[_ -]?key|client[_ -]?secret|password|passwd|pwd|cookie|session(?:id)?|otp|backup[_ -]?code|recovery[_ -]?code)\b\s*[:=]\s*["']?[a-z0-9._~+/-]{8,}["']?/i
  },
  {
    code: 'secret_in_url',
    message: 'Sensitive query parameter detected in URL.',
    regex:
      /https?:\/\/[^\s]+[?&](?:token|access_token|refresh_token|api_key|apikey|client_secret|password|code)=([a-z0-9._~+%/-]{8,})/i
  },
  {
    code: 'common_api_token',
    message: 'Common API token signature detected.',
    regex:
      /\b(?:sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|xox[baprs]-[a-z0-9-]{10,}|AKIA[0-9A-Z]{16}|EA[A-Za-z0-9]{16,})\b/
  },
  {
    code: 'cookie_header',
    message: 'Cookie or set-cookie header detected.',
    regex: /\b(?:cookie|set-cookie)\s*:\s*[^;\n]{6,}=/i
  }
];

export class SecurityGuardService {
  auditText(text: string): SecurityAuditResult {
    if (!text.trim()) {
      return {
        blocked: false,
        findings: [],
        summary: 'No content provided.'
      };
    }

    const findings = SECRET_PATTERNS.flatMap((pattern) => {
      const match = text.match(pattern.regex);
      if (!match?.[0]) {
        return [];
      }

      return [
        {
          code: pattern.code,
          message: pattern.message,
          matchPreview: truncate(match[0])
        }
      ];
    });

    return {
      blocked: findings.length > 0,
      findings,
      summary:
        findings.length > 0
          ? findings.map((finding) => finding.code).join(', ')
          : 'No credential-like material detected.'
    };
  }

  assertSafeForIngestion(text: string): void {
    if (!isEnabled('BLOCK_SENSITIVE_INGESTION', true)) {
      return;
    }

    this.assertSafe(text, 'ingestion');
  }

  assertSafeForModelPrompt(text: string): void {
    if (!isEnabled('BLOCK_MODEL_PROMPTS_WITH_SECRETS', true)) {
      return;
    }

    this.assertSafe(text, 'model prompt');
  }

  assertSafeForPublishing(text: string): void {
    if (!isEnabled('BLOCK_PUBLISH_PAYLOADS_WITH_SECRETS', true)) {
      return;
    }

    this.assertSafe(text, 'publishing payload');
  }

  private assertSafe(text: string, channel: string): void {
    const audit = this.auditText(text);
    const strictMode = (getEnv('SECURITY_MODE') || 'strict').toLowerCase() !== 'permissive';

    if (strictMode && audit.blocked) {
      throw new Error(
        `Security guard blocked ${channel} because credential-like material was detected (${audit.summary}).`
      );
    }
  }
}

export const securityGuard = new SecurityGuardService();

function truncate(value: string, maxLength = 80): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function isEnabled(name: string, defaultValue: boolean): boolean {
  const raw = getEnv(name).trim().toLowerCase();
  if (!raw) {
    return defaultValue;
  }

  return !['0', 'false', 'off', 'no'].includes(raw);
}
