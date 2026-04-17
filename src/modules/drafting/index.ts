import { ICompletionProvider } from '../../adapters/model/openaiCompatibleProvider';
import { ContentDraft, TopicScore, ContentDraftSchema } from '../../schemas/models';
import { logger } from '../../utils/logger';
import crypto from 'crypto';
import { PromptCatalog } from '../../harness/promptCatalog';

export class DraftingService {
  constructor(
    private readonly provider: ICompletionProvider,
    private readonly promptCatalog = new PromptCatalog()
  ) {}

  async draftFromScore(topic: TopicScore, revisionFeedback: string[] = []): Promise<ContentDraft> {
    logger.info({ topic: topic.topic_title }, 'Drafting content');

    const systemPrompt = await this.promptCatalog.compose([
      'global-operating-rules.md',
      'security-rules.md',
      'persona.system.md',
      'drafting.system.md'
    ]);
    const feedbackBlock = revisionFeedback.length
      ? `\n\n## Evaluator Feedback To Fix\n${revisionFeedback
          .map((item) => `- ${item}`)
          .join('\n')}`
      : '';

    const xDraft = await this.provider.complete(`${systemPrompt}

## Topic
${topic.topic_title}

## Score Summary
Total score: ${topic.total_score}
${feedbackBlock}

Write exactly one sharp X post under 280 characters.`);

    const threadsDraft = await this.provider.complete(`${systemPrompt}

## Topic
${topic.topic_title}

## Score Summary
Total score: ${topic.total_score}
${feedbackBlock}

Write exactly one Threads hot take. MUST BE UNDER 200 CHARACTERS. Be controversial, be sharp, be internet-native. No filler. Just the take.`);

    return ContentDraftSchema.parse({
      id: crypto.randomUUID(),
      topic: topic.topic_title,
      status: 'draft',
      versions: [
        { platform: 'x', content: stripThinkTags(xDraft), tone: 'sharp' },
        { platform: 'threads', content: stripThinkTags(threadsDraft), tone: 'conversational' }
      ]
    });
  }
}

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
}
