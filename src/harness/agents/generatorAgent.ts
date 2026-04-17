import crypto from 'crypto';
import { ContentDraft, ContentDraftSchema, Signal, TopicScore } from '../../schemas/models';
import { DraftingService } from '../../modules/drafting';
import { RankingService } from '../../modules/ranking';
import { logger } from '../../utils/logger';
import { HarnessPlan } from '../schemas';

export class GeneratorAgent {
  constructor(
    private readonly rankingService: RankingService,
    private readonly draftingService: DraftingService
  ) {}

  async rankSignal(signal: Signal, plan: HarnessPlan): Promise<TopicScore> {
    const planningBrief = [
      `Objective: ${plan.objective}`,
      `Signal digest: ${plan.contextDigest}`,
      'Acceptance criteria:',
      ...plan.acceptanceCriteria.map((criterion) => `- ${criterion}`)
    ].join('\n');

    try {
      return await this.rankingService.evaluateSignal(signal, planningBrief);
    } catch (error: any) {
      logger.warn(
        { signalId: signal.id, error: error.message },
        'Ranking failed, falling back to deterministic score'
      );
      return {
        topic_title: signal.content.split(/\s+/).slice(0, 10).join(' ').trim() || 'Fallback Topic',
        source_type: 'other',
        source_summary: 'Evaluation failed',
        recommended_bucket: 'ignore',
        primary_angle: 'None',
        best_platform: 'x',
        content_archetype: 'operator_note',
        scores: {
          brand_fit: 8,
          originality_potential: 7,
          discussion_potential: 7,
          reach_potential: 5,
          positioning_value: 8,
          timeliness: 6,
          signal_density: 7,
          risk_level: 2
        },
        total_score: 70,
        why_now: 'Fallback trigger',
        why_trumanwrld: 'Fallback handling',
        draftability: 'medium',
        notes: ['Fallback deterministic score']
      };
    }
  }

  async draftCandidate(topic: TopicScore, feedback: string[] = []): Promise<ContentDraft> {
    try {
      return await this.draftingService.draftFromScore(topic, feedback);
    } catch (error: any) {
      logger.warn(
        { topic: topic.topic_title, error: error.message },
        'Drafting failed, falling back to deterministic copy'
      );

      return ContentDraftSchema.parse({
        id: crypto.randomUUID(),
        topic: topic.topic_title,
        status: 'draft',
        versions: [
          {
            platform: 'x',
            content:
              `${topic.topic_title}: model access is no longer the moat. ` +
              `Operational taste, distribution, and feedback loops are. [${Date.now()}]`,
            tone: 'sharp'
          },
          {
            platform: 'threads',
            content:
              `${topic.topic_title} is not a model story anymore. The edge is how fast you can ` +
              `turn signals into drafts, let an evaluator tear them down, and recover from failures. [${Date.now()}]`,
            tone: 'conversational'
          }
        ]
      });
    }
  }
}
