export const SENSITIVE_KEYS = [
  'OPENAI_API_KEY',
  'MODEL_PRIMARY',
  'MODEL_FAST',
  'MODEL_REASONING',
  'OPENAI_BASE_URL',
  'OAUTH_TOKEN_ENCRYPTION_KEY',
  'X_API_KEY',
  'X_API_KEY_SECRET',
  'X_CLIENT_ID',
  'X_CLIENT_SECRET',
  'THREADS_APP_ID',
  'THREADS_APP_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'SLACK_WEBHOOK_URL',
  'BROWSERBASE_API_KEY',
  'PLAYWRIGHT_STORAGE_STATE_PATH',
  'X_ACCESS_TOKEN',
  'X_ACCESS_TOKEN_SECRET',
  'X_BEARER_TOKEN',
  'THREADS_ACCESS_TOKEN'
];

export function redactSensitiveData(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  const redacted = Array.isArray(obj) ? [...obj] : { ...obj };

  for (const [key, value] of Object.entries(redacted)) {
    const normalizedKey = key.toUpperCase();
    const looksSensitiveByName =
      normalizedKey.includes('TOKEN') ||
      normalizedKey.includes('SECRET') ||
      normalizedKey.includes('KEY') ||
      normalizedKey.includes('PASSWORD') ||
      normalizedKey.includes('COOKIE') ||
      normalizedKey.includes('SESSION') ||
      normalizedKey.includes('AUTH');
    const isKnownSensitiveKey = SENSITIVE_KEYS.some((candidate) => normalizedKey === candidate);

    if (looksSensitiveByName || isKnownSensitiveKey) {
      if (typeof value === 'string' && value.length > 0) {
        redacted[key] = '[REDACTED]';
      }
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveData(value);
    }
  }

  return redacted;
}

export function getEnv(key: string, required: boolean = false): string {
  const val = process.env[key];
  if (!val && required) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val || '';
}
