import { z } from 'zod';

export const ConnectedProviderSchema = z.enum(['x', 'threads']);
export type ConnectedProvider = z.infer<typeof ConnectedProviderSchema>;

export const OAuthTokenRecordSchema = z.object({
  provider: ConnectedProviderSchema,
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  tokenType: z.string().optional(),
  scope: z.string().optional(),
  userId: z.string().optional(),
  username: z.string().optional(),
  displayName: z.string().optional(),
  expiresAt: z.string().optional(),
  obtainedAt: z.string(),
  metadata: z.record(z.any()).optional()
});
export type OAuthTokenRecord = z.infer<typeof OAuthTokenRecordSchema>;

export const OAuthTokenStorePayloadSchema = z.object({
  version: z.literal(1),
  providers: z.object({
    x: OAuthTokenRecordSchema.optional(),
    threads: OAuthTokenRecordSchema.optional()
  })
});
export type OAuthTokenStorePayload = z.infer<typeof OAuthTokenStorePayloadSchema>;

export const ConnectionStatusSchema = z.object({
  provider: ConnectedProviderSchema,
  connected: z.boolean(),
  username: z.string().optional(),
  displayName: z.string().optional(),
  expiresAt: z.string().optional(),
  obtainedAt: z.string().optional()
});
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;
