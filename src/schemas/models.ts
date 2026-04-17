import { z } from 'zod';

export const SignalSchema = z.object({
  id: z.string(),
  source: z.enum(['rss', 'url', 'local']),
  url: z.string().optional(),
  content: z.string(),
  receivedAt: z.coerce.date(),
  metadata: z.record(z.any()).optional()
});
export type Signal = z.infer<typeof SignalSchema>;

export const TopicScoreSchema = z.object({
  topic_title: z.string(),
  source_type: z.enum(['rss', 'markdown', 'url', 'other']),
  source_summary: z.string(),
  recommended_bucket: z.enum([
    'ignore',
    'watchlist',
    'positioning_play',
    'reach_play',
    'reach_and_positioning',
    'evergreen_archive',
    'high_risk_review'
  ]),
  primary_angle: z.string(),
  best_platform: z.enum(['x', 'threads', 'both']),
  content_archetype: z.enum([
    'sharp_insight',
    'operator_note',
    'contrarian_take',
    'cultural_signal',
    'taste_strategy',
    'structural_thread'
  ]),
  scores: z.object({
    brand_fit: z.number().min(0).max(10),
    originality_potential: z.number().min(0).max(10),
    discussion_potential: z.number().min(0).max(10),
    reach_potential: z.number().min(0).max(10),
    positioning_value: z.number().min(0).max(10),
    timeliness: z.number().min(0).max(10),
    signal_density: z.number().min(0).max(10),
    risk_level: z.number().min(0).max(10)
  }),
  total_score: z.number(),
  why_now: z.string(),
  why_trumanwrld: z.string(),
  draftability: z.enum(['low', 'medium', 'high']),
  notes: z.array(z.string())
});
export type TopicScore = z.infer<typeof TopicScoreSchema>;

export const DraftVersionSchema = z.object({
  platform: z.enum(['x', 'x-thread', 'threads']),
  content: z.string(),
  tone: z.string()
});
export type DraftVersion = z.infer<typeof DraftVersionSchema>;

export const ContentDraftSchema = z.object({
  id: z.string(),
  topic: z.string(),
  versions: z.array(DraftVersionSchema),
  status: z.enum([
    'draft',
    'needs_revision',
    'pending_approval',
    'approved',
    'rejected',
    'published',
    'archived'
  ])
});
export type ContentDraft = z.infer<typeof ContentDraftSchema>;
