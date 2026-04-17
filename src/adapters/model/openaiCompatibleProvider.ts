import { logger } from '../../utils/logger';
import { securityGuard } from '../../modules/security';

export interface ICompletionProvider {
  complete(prompt: string, modelName?: string): Promise<string>;
}

export class OpenAICompatibleProvider implements ICompletionProvider {
  constructor(
    protected readonly baseUrl: string,
    protected readonly apiKey: string
  ) {}

  async complete(prompt: string, modelName: string = 'gpt-3.5-turbo'): Promise<string> {
    try {
      securityGuard.assertSafeForModelPrompt(prompt);
      const resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Note: Headers will not be logged out safely automatically, so we
          // deliberately keep them entirely inside the isolated try scope
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!resp.ok) {
        throw new Error(`Provider API Error: HTTP ${resp.status}`);
      }

      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content || '';
    } catch (error: any) {
      // Intentionally omitting error stack which might dump full request blocks
      logger.error({ message: error.message }, 'Failed to call OpenAI compatible provider');
      throw new Error('Completion provider execution failed.');
    }
  }
}
