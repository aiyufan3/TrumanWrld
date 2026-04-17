import { OpenAICompatibleProvider } from './openaiCompatibleProvider';
import { getEnv } from '../../utils/secrets';

/**
 * Minimax Provider Preset using OpenAI compatible adapter.
 */
export class MinimaxProvider extends OpenAICompatibleProvider {
  constructor() {
    super(getEnv('OPENAI_BASE_URL', true), getEnv('OPENAI_API_KEY', true));
  }

  async complete(prompt: string, modelName?: string): Promise<string> {
    const model = modelName || getEnv('MODEL_PRIMARY') || 'MiniMax-M2.7';
    return super.complete(prompt, model);
  }

  /**
   * Use the `MODEL_PRIMARY` for complex analytical tasks.
   */
  async completePrimary(prompt: string): Promise<string> {
    const model = getEnv('MODEL_PRIMARY') || 'MiniMax-M2.7';
    return this.complete(prompt, model);
  }

  /**
   * Use the `MODEL_FAST` for light categorizations or rankings.
   */
  async completeFast(prompt: string): Promise<string> {
    const model = getEnv('MODEL_FAST') || 'MiniMax-M2.7-highspeed';
    return this.complete(prompt, model);
  }

  /**
   * Use the `MODEL_REASONING` for complex logical verifications.
   */
  async completeReasoning(prompt: string): Promise<string> {
    const model = getEnv('MODEL_REASONING') || 'MiniMax-M2.7';
    return this.complete(prompt, model);
  }
}
