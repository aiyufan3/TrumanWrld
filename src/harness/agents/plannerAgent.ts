import { Signal } from '../../schemas/models';
import { PromptCatalog } from '../promptCatalog';
import { HarnessPlan, HarnessPlanSchema } from '../schemas';

export class PlannerAgent {
  constructor(private readonly promptCatalog = new PromptCatalog()) {}

  async createPlan(signal: Signal): Promise<HarnessPlan> {
    await this.promptCatalog.compose([
      'global-operating-rules.md',
      'security-rules.md',
      'persona.system.md',
      'product-rules.md'
    ]);

    const contextDigest = signal.content.replace(/\s+/g, ' ').trim().slice(0, 240);

    return HarnessPlanSchema.parse({
      objective:
        'Turn the ingested signal into an approval-gated, persona-aligned draft package for X and Threads.',
      contextDigest,
      contextPointers: [
        'agent.md',
        'docs/architecture.md',
        'prompts/system/global-operating-rules.md',
        'prompts/system/security-rules.md',
        'prompts/system/persona.system.md',
        'prompts/system/product-rules.md',
        'prompts/system/ranking.system.md',
        'prompts/system/drafting.system.md',
        'prompts/system/guardian.system.md'
      ],
      steps: [
        {
          name: 'ingestion',
          purpose: 'Normalize the incoming signal and lock a recoverable artifact.'
        },
        {
          name: 'planner',
          purpose: 'Define acceptance criteria and point the generator to the right context.'
        },
        {
          name: 'ranking',
          purpose: 'Score the signal against persona fit, novelty, timeliness, and risk.'
        },
        {
          name: 'drafting',
          purpose: 'Generate multi-platform drafts using only the distilled planner context.'
        },
        {
          name: 'evaluation',
          purpose: 'Run guardian and deterministic checks before anything reaches approval.'
        },
        {
          name: 'approval',
          purpose: 'Pause for explicit human approval before any publishing step.'
        },
        {
          name: 'publishing',
          purpose: 'Execute mocked side-effects and capture auditable receipts.'
        },
        {
          name: 'analytics',
          purpose: 'Persist post-publish telemetry placeholders for later optimization.'
        },
        {
          name: 'learning',
          purpose: 'Write structured feedback to improve future runs.'
        }
      ],
      acceptanceCriteria: [
        'Ranked topic score must exceed 50 before a run can be considered useful.',
        'Draft package must include both X and Threads variants.',
        'X variant must stay within 280 characters.',
        'No draft, prompt, or outbound payload may include credential-like material, cookies, or session secrets.',
        'Guardian checks must pass without robotic phrasing or risky investment language.',
        'Publishing remains blocked until a human explicitly approves the run.'
      ]
    });
  }
}
