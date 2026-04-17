import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { AnalyticsService } from '../src/modules/analytics';
import { ApprovalQueue } from '../src/modules/approval';
import { DraftingService } from '../src/modules/drafting';
import { GuardianService } from '../src/modules/guardian';
import { IngestionService } from '../src/modules/ingestion';
import { LearningService } from '../src/modules/learning';
import { MockPublisherAdapter } from '../src/modules/publishing';
import { RankingService } from '../src/modules/ranking';
import { ICompletionProvider } from '../src/adapters/model/openaiCompatibleProvider';
import { GeneratorAgent } from '../src/harness/agents/generatorAgent';
import { EvaluatorAgent } from '../src/harness/agents/evaluatorAgent';
import { PlannerAgent } from '../src/harness/agents/plannerAgent';
import { HarnessRunner } from '../src/harness/harnessRunner';
import { HarnessWorkspace } from '../src/harness/workspace';
import { ApprovalRequestSchema, HarnessRunStateSchema } from '../src/harness/schemas';

class SequenceProvider implements ICompletionProvider {
  constructor(private readonly responses: string[]) {}

  async complete(): Promise<string> {
    const next = this.responses.shift();
    if (!next) {
      throw new Error('No mock responses left in provider queue.');
    }
    return next;
  }
}

class RecordingPublisher extends MockPublisherAdapter {
  public readonly published: string[] = [];

  async publish(request: { content: string }): Promise<{ success: boolean }> {
    this.published.push(request.content);
    return { success: true };
  }
}

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('HarnessRunner', () => {
  it('persists artifacts and retries after evaluator feedback', async () => {
    const { runner, workspace, publisher } = await createHarnessHarness([
      JSON.stringify({
        relevance_to_persona: 8,
        novelty: 8,
        timeliness: 7,
        discussion_potential: 8,
        brand_fit: 9,
        risk_level: 2,
        total_score: 82
      }),
      'As an AI, the real moat is capital allocation.',
      'Builders who compound taste and tooling create harder-to-copy leverage.',
      'Taste turns model output into a product edge people actually feel.',
      'Cheap intelligence rewires distribution. Builders who keep taste and capital discipline in the loop capture the upside.'
    ]);

    const result = await runner.execute({
      signalContent: 'Agent harnesses matter when non-deterministic models need stable systems.',
      approve: true
    });

    expect(result.status).toBe('succeeded');
    expect(publisher.published).toHaveLength(2);

    const state = HarnessRunStateSchema.parse(
      JSON.parse(
        await fs.readFile(path.join(workspace.getRunDir(result.runId), 'progress.json'), 'utf8')
      )
    );

    expect(state.draftAttempt).toBe(2);
    expect(state.latestArtifacts.evaluation).toContain('evaluation.attempt-2.json');
    await expect(
      fs.readFile(
        path.join(workspace.getRunDir(result.runId), 'artifacts', 'draft.attempt-1.json'),
        'utf8'
      )
    ).resolves.toContain('As an AI');
  });

  it('pauses for approval and resumes from persisted state', async () => {
    const { runner, workspace, publisher } = await createHarnessHarness([
      JSON.stringify({
        relevance_to_persona: 8,
        novelty: 7,
        timeliness: 7,
        discussion_potential: 8,
        brand_fit: 8,
        risk_level: 2,
        total_score: 78
      }),
      'Operational taste matters more than raw model access.',
      'Threads audiences reward clear operator insight over generic AI hype.'
    ]);

    const pending = await runner.execute({
      signalContent: 'Human approval must remain the barrier before publishing.',
      approve: false
    });

    expect(pending.status).toBe('awaiting_approval');
    expect(publisher.published).toHaveLength(0);

    const approval = ApprovalRequestSchema.parse(
      JSON.parse(
        await fs.readFile(
          path.join(workspace.getRunDir(pending.runId), 'artifacts', 'approval.json'),
          'utf8'
        )
      )
    );
    expect(approval.status).toBe('pending');

    const resumed = await runner.execute({
      runId: pending.runId,
      resume: true,
      approve: true
    });

    expect(resumed.status).toBe('succeeded');
    expect(publisher.published).toHaveLength(2);
  });
});

async function createHarnessHarness(responses: string[]) {
  const tempRoot = await fs.mkdtemp(path.join(process.cwd(), 'tmp-harness-test-'));
  tempRoots.push(tempRoot);

  const provider = new SequenceProvider(responses);
  const ranking = new RankingService(provider);
  const drafting = new DraftingService(provider);
  const publisher = new RecordingPublisher();
  const workspace = new HarnessWorkspace(tempRoot);

  const runner = new HarnessRunner({
    ingestion: new IngestionService(),
    planner: new PlannerAgent(),
    generator: new GeneratorAgent(ranking, drafting),
    evaluator: new EvaluatorAgent(new GuardianService()),
    approvalQueue: new ApprovalQueue(),
    publisher,
    analytics: new AnalyticsService(),
    learning: new LearningService(),
    workspace,
    maxDraftAttempts: 3
  });

  return {
    runner,
    workspace,
    publisher
  };
}
