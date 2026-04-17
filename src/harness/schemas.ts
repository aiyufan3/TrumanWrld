import { z } from 'zod';

export const DEFAULT_STEP_SEQUENCE = [
  'ingestion',
  'planner',
  'ranking',
  'drafting',
  'evaluation',
  'approval',
  'publishing',
  'analytics',
  'learning'
] as const;

export const HarnessStepNameSchema = z.enum(DEFAULT_STEP_SEQUENCE);
export type HarnessStepName = z.infer<typeof HarnessStepNameSchema>;

export const HarnessStepStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'failed',
  'blocked'
]);
export type HarnessStepStatus = z.infer<typeof HarnessStepStatusSchema>;

export const HarnessArtifactKeySchema = z.enum([
  'signal',
  'plan',
  'score',
  'draft',
  'evaluation',
  'approval',
  'publishing',
  'analytics',
  'learning'
]);
export type HarnessArtifactKey = z.infer<typeof HarnessArtifactKeySchema>;

export const HarnessStepStateSchema = z.object({
  name: HarnessStepNameSchema,
  status: HarnessStepStatusSchema,
  attempts: z.number().int().nonnegative(),
  artifact: z.string().optional(),
  lastError: z.string().optional(),
  updatedAt: z.string()
});
export type HarnessStepState = z.infer<typeof HarnessStepStateSchema>;

export const HarnessPlanSchema = z.object({
  objective: z.string(),
  contextDigest: z.string(),
  contextPointers: z.array(z.string()),
  steps: z.array(
    z.object({
      name: HarnessStepNameSchema,
      purpose: z.string()
    })
  ),
  acceptanceCriteria: z.array(z.string())
});
export type HarnessPlan = z.infer<typeof HarnessPlanSchema>;

export const EvaluationIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
  retryable: z.boolean()
});
export type EvaluationIssue = z.infer<typeof EvaluationIssueSchema>;

export const EvaluationReportSchema = z.object({
  passed: z.boolean(),
  retryable: z.boolean(),
  summary: z.string(),
  issues: z.array(EvaluationIssueSchema),
  feedback: z.array(z.string())
});
export type EvaluationReport = z.infer<typeof EvaluationReportSchema>;

export const ApprovalRequestSchema = z.object({
  draftId: z.string(),
  status: z.enum(['pending', 'approved']),
  requestedAt: z.string(),
  approvedAt: z.string().optional()
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const PublishReceiptSchema = z.object({
  platform: z.string(),
  success: z.boolean(),
  contentPreview: z.string(),
  publishedAt: z.string(),
  attempts: z.number().int().positive().optional(),
  externalId: z.string().optional(),
  url: z.string().optional()
});
export type PublishReceipt = z.infer<typeof PublishReceiptSchema>;

export const PublishReportSchema = z.object({
  receipts: z.array(PublishReceiptSchema)
});
export type PublishReport = z.infer<typeof PublishReportSchema>;

export const HarnessRunStatusSchema = z.enum([
  'running',
  'awaiting_approval',
  'succeeded',
  'failed'
]);
export type HarnessRunStatus = z.infer<typeof HarnessRunStatusSchema>;

export const HarnessArtifactMapSchema = z.object({
  signal: z.string().optional(),
  plan: z.string().optional(),
  score: z.string().optional(),
  draft: z.string().optional(),
  evaluation: z.string().optional(),
  approval: z.string().optional(),
  publishing: z.string().optional(),
  analytics: z.string().optional(),
  learning: z.string().optional()
});
export type HarnessArtifactMap = z.infer<typeof HarnessArtifactMapSchema>;

export const HarnessRunStateSchema = z.object({
  runId: z.string(),
  status: HarnessRunStatusSchema,
  startedAt: z.string(),
  updatedAt: z.string(),
  currentStep: HarnessStepNameSchema.optional(),
  maxDraftAttempts: z.number().int().positive(),
  draftAttempt: z.number().int().nonnegative(),
  latestArtifacts: HarnessArtifactMapSchema.default({}),
  latestFeedback: z.array(z.string()).default([]),
  steps: z.array(HarnessStepStateSchema)
});
export type HarnessRunState = z.infer<typeof HarnessRunStateSchema>;

export function createInitialRunState(runId: string, maxDraftAttempts: number): HarnessRunState {
  const now = new Date().toISOString();
  return HarnessRunStateSchema.parse({
    runId,
    status: 'running',
    startedAt: now,
    updatedAt: now,
    currentStep: 'ingestion',
    maxDraftAttempts,
    draftAttempt: 0,
    latestArtifacts: {},
    latestFeedback: [],
    steps: DEFAULT_STEP_SEQUENCE.map((name) => ({
      name,
      status: 'pending',
      attempts: 0,
      updatedAt: now
    }))
  });
}
