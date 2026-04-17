import { promises as fs } from 'fs';
import path from 'path';

export class PromptCatalog {
  private readonly cache = new Map<string, string>();

  constructor(private readonly systemPromptDir = path.resolve(process.cwd(), 'prompts/system')) {}

  async load(name: string): Promise<string> {
    if (this.cache.has(name)) {
      return this.cache.get(name)!;
    }

    const fullPath = path.resolve(this.systemPromptDir, name);
    const content = (await fs.readFile(fullPath, 'utf8')).trim();
    this.cache.set(name, content);
    return content;
  }

  async compose(names: string[]): Promise<string> {
    const prompts = await Promise.all(names.map((name) => this.load(name)));
    return prompts.join('\n\n');
  }
}
