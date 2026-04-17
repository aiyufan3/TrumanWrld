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
import { LocalAuthServer } from '../src/server/authServer';

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

  async publish(request: { content: string; platform: 'x' | 'x-thread' | 'threads' }): Promise<{
    success: boolean;
    attempts?: number;
  }> {
    this.published.push(request.content);
    return { success: true, attempts: 1 };
  }
}

const tempRoots: string[] = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('LocalAuthServer approval console', () => {
  it('lists pending approvals and resumes a run from the local dashboard', async () => {
    const tempRoot = await fs.mkdtemp(path.join(process.cwd(), 'tmp-auth-server-test-'));
    tempRoots.push(tempRoot);

    const provider = new SequenceProvider([
      JSON.stringify({
        relevance_to_persona: 8,
        novelty: 7,
        timeliness: 7,
        discussion_potential: 8,
        brand_fit: 8,
        risk_level: 2,
        total_score: 79
      }),
      'Operator-grade AI systems need approval gates that survive crashes.',
      'Threads readers want the operating model, not generic automation hype.'
    ]);

    const workspace = new HarnessWorkspace(tempRoot);
    const publisher = new RecordingPublisher();
    const runner = new HarnessRunner({
      ingestion: new IngestionService(),
      planner: new PlannerAgent(),
      generator: new GeneratorAgent(new RankingService(provider), new DraftingService(provider)),
      evaluator: new EvaluatorAgent(new GuardianService()),
      approvalQueue: new ApprovalQueue(),
      publisher,
      analytics: new AnalyticsService(),
      learning: new LearningService(),
      workspace,
      maxDraftAttempts: 3
    });

    const pending = await runner.execute({
      signalContent: 'Approval should move through a local UI instead of raw CLI flags.',
      approve: false
    });

    expect(pending.status).toBe('awaiting_approval');

    const server = new LocalAuthServer({
      workspace,
      runnerFactory: () => runner
    });

    const page = await server.renderConsoleHtml();
    expect(page).toContain(pending.runId);
    expect(page).toContain('Approve & Resume');

    await server.approveRun(pending.runId);

    await waitFor(async () => {
      const payload = (await server.getApprovalStatusPayload()) as {
        jobs: Array<{ runId: string; status: string }>;
      };
      const job = payload.jobs.find((entry) => entry.runId === pending.runId);
      expect(job?.status).toBe('succeeded');
    });

    expect(publisher.published).toHaveLength(2);

    const detailPage = await server.getRunDetailHtml(pending.runId);
    expect(detailPage).toContain('Publish Receipts');
    expect(detailPage).toContain('Run resumed and completed successfully.');
  });
});

async function waitFor(assertion: () => Promise<void>, attempts = 30): Promise<void> {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  throw lastError;
}
