import { ICompletionProvider } from '../../adapters/model/openaiCompatibleProvider';
import { Signal, TopicScore, TopicScoreSchema } from '../../schemas/models';
import { logger } from '../../utils/logger';
import { PromptCatalog } from '../../harness/promptCatalog';

export class RankingService {
  constructor(
    private readonly provider: ICompletionProvider,
    private readonly promptCatalog = new PromptCatalog()
  ) {}

  async evaluateSignal(signal: Signal, planningBrief?: string): Promise<TopicScore> {
    logger.info({ signalId: signal.id }, 'Evaluating topic ranking');

    const systemPrompt = await this.promptCatalog.compose([
      'global-operating-rules.md',
      'security-rules.md',
      'persona.system.md',
      'ranking.system.md'
    ]);

    const plannerSection = planningBrief ? `\n\n## Planner Brief\n${planningBrief}` : '';

    const prompt = `${systemPrompt}${plannerSection}

## Signal
${signal.content.substring(0, 2000)}

Respond ONLY with a valid JSON object that strictly adheres to the requested schema.`;

    const response = await this.provider.complete(prompt);

    try {
      const rawObj = JSON.parse(extractJsonPayload(response));
      return TopicScoreSchema.parse({
        topic_title: `Topic from Signal ${signal.id.substring(0, 6)}`,
        ...rawObj
      });
    } catch (e: any) {
      logger.error('Failed to parse ranking model JSON payload');
      return {
        topic_title: 'Parse Error Callback',
        source_type: 'other',
        source_summary: 'Evaluation failed',
        recommended_bucket: 'ignore',
        primary_angle: 'None',
        best_platform: 'x',
        content_archetype: 'operator_note',
        scores: {
          brand_fit: 0,
          originality_potential: 0,
          discussion_potential: 0,
          reach_potential: 0,
          positioning_value: 0,
          timeliness: 0,
          signal_density: 0,
          risk_level: 0
        },
        total_score: 0,
        why_now: '',
        why_trumanwrld: '',
        draftability: 'low',
        notes: ['Parse failure during model invocation.']
      };
    }
  }
}

function extractJsonPayload(response: string): string {
  const fenceMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  return response.trim();
}
