import { AnalyticsService } from '../modules/analytics';
import { MinimaxProvider } from '../adapters/model/minimaxProvider';
import { ICompletionProvider } from '../adapters/model/openaiCompatibleProvider';
import { ApprovalQueue } from '../modules/approval';
import { DraftingService } from '../modules/drafting';
import { GuardianService } from '../modules/guardian';
import { IngestionService } from '../modules/ingestion';
import { LearningService } from '../modules/learning';
import { createDefaultPublisherAdapter, IPublisherAdapter } from '../modules/publishing';
import { RankingService } from '../modules/ranking';
import {
  ContentDraft,
  ContentDraftSchema,
  Signal,
  SignalSchema,
  TopicScore,
  TopicScoreSchema
} from '../schemas/models';
import { logger } from '../utils/logger';
import { getEnv } from '../utils/secrets';
import { GeneratorAgent } from './agents/generatorAgent';
import { EvaluatorAgent } from './agents/evaluatorAgent';
import { PlannerAgent } from './agents/plannerAgent';
import {
  ApprovalRequest,
  ApprovalRequestSchema,
  EvaluationReport,
  EvaluationReportSchema,
  HarnessArtifactKey,
  HarnessPlan,
  HarnessPlanSchema,
  HarnessRunState,
  HarnessRunStatus,
  HarnessStepName,
  PublishReceipt,
  PublishReport,
  PublishReportSchema
} from './schemas';
import { HarnessWorkspace } from './workspace';
import { z } from 'zod';

export interface HarnessRunnerDependencies {
  ingestion: IngestionService;
  planner: PlannerAgent;
  generator: GeneratorAgent;
  evaluator: EvaluatorAgent;
  approvalQueue: ApprovalQueue;
  publisher: IPublisherAdapter;
  analytics: AnalyticsService;
  learning: LearningService;
  workspace?: HarnessWorkspace;
  maxDraftAttempts?: number;
}

export interface HarnessExecuteOptions {
  signalContent?: string;
  signalMetadata?: Record<string, unknown>;
  runId?: string;
  resume?: boolean;
  approve?: boolean;
}

export interface HarnessRunResult {
  runId: string;
  status: HarnessRunStatus;
  runDirectory: string;
  reason?: string;
}

export class HarnessRunner {
  private readonly workspace: HarnessWorkspace;
  private readonly maxDraftAttempts: number;

  constructor(private readonly deps: HarnessRunnerDependencies) {
    this.workspace = deps.workspace || new HarnessWorkspace();
    const envAttempts = Number.parseInt(getEnv('HARNESS_MAX_DRAFT_RETRIES') || '', 10);
    this.maxDraftAttempts =
      deps.maxDraftAttempts || (Number.isNaN(envAttempts) ? 3 : Math.max(envAttempts, 1));
  }

  async execute(options: HarnessExecuteOptions): Promise<HarnessRunResult> {
    let state = await this.bootstrapState(options);
    const runDirectory = this.workspace.getRunDir(state.runId);

    await this.workspace.appendEvent(state.runId, {
      event: 'run_started',
      resume: Boolean(options.resume),
      approve: Boolean(options.approve)
    });

    try {
      const signalResult = await this.runCachedArtifact({
        state,
        step: 'ingestion',
        artifactKey: 'signal',
        fileName: 'signal.json',
        schema: SignalSchema,
        run: async () => {
          if (!options.signalContent) {
            throw new Error('signalContent is required when starting a new run.');
          }
          return this.deps.ingestion.ingestLocalMarkdown(
            options.signalContent,
            options.signalMetadata
          );
        }
      });
      state = signalResult.state;
      const signal = signalResult.value;

      const planResult = await this.runCachedArtifact({
        state,
        step: 'planner',
        artifactKey: 'plan',
        fileName: 'plan.json',
        schema: HarnessPlanSchema,
        run: async () => this.deps.planner.createPlan(signal)
      });
      state = planResult.state;
      const plan = planResult.value;

      const scoreResult = await this.runCachedArtifact({
        state,
        step: 'ranking',
        artifactKey: 'score',
        fileName: 'score.json',
        schema: TopicScoreSchema,
        run: async () => this.deps.generator.rankSignal(signal, plan)
      });
      state = scoreResult.state;
      const score = scoreResult.value;

      const loopResult = await this.runDraftLoop(state, score, plan);
      state = loopResult.state;

      if (!loopResult.evaluation.passed) {
        state = await this.persistState({
          ...state,
          status: 'failed',
          currentStep: 'evaluation'
        });
        return {
          runId: state.runId,
          status: state.status,
          runDirectory,
          reason: loopResult.evaluation.summary
        };
      }

      const approvalResult = await this.handleApproval(
        state,
        loopResult.draft,
        Boolean(options.approve)
      );
      state = approvalResult.state;

      if (approvalResult.status === 'awaiting_approval') {
        return {
          runId: state.runId,
          status: state.status,
          runDirectory,
          reason: 'Run paused for human approval.'
        };
      }

      const publishResult = await this.runCachedArtifact({
        state,
        step: 'publishing',
        artifactKey: 'publishing',
        fileName: 'publishing.json',
        schema: PublishReportSchema,
        run: async () => {
          const receipts: PublishReceipt[] = [];
          for (const version of loopResult.draft.versions) {
            const published = await this.deps.publisher.publish({
              platform: version.platform,
              content: version.content
            });
            receipts.push({
              platform: version.platform,
              success: published.success,
              contentPreview: version.content.slice(0, 120),
              publishedAt: new Date().toISOString(),
              attempts: published.attempts,
              externalId: published.externalId,
              url: published.url
            });
          }
          return { receipts };
        }
      });
      state = publishResult.state;

      const analyticsResult = await this.runCachedArtifact({
        state,
        step: 'analytics',
        artifactKey: 'analytics',
        fileName: 'analytics.json',
        schema: z.object({
          recordedAt: z.string(),
          publishedCount: z.number().int().nonnegative()
        }),
        run: async () => {
          this.deps.analytics.recordPublishEvent(loopResult.draft);
          return {
            recordedAt: new Date().toISOString(),
            publishedCount: publishResult.value.receipts.length
          };
        }
      });
      state = analyticsResult.state;

      const learningResult = await this.runCachedArtifact({
        state,
        step: 'learning',
        artifactKey: 'learning',
        fileName: 'learning.json',
        schema: z.object({
          learnedAt: z.string(),
          note: z.string()
        }),
        run: async () => {
          await this.deps.learning.learnFromOutcomes(loopResult.draft);
          return {
            learnedAt: new Date().toISOString(),
            note: 'Learning loop completed for the current draft package.'
          };
        }
      });
      state = learningResult.state;

      state = await this.persistState({
        ...state,
        status: 'succeeded',
        currentStep: 'learning'
      });

      await this.workspace.appendEvent(state.runId, {
        event: 'run_completed',
        status: 'succeeded'
      });

      return {
        runId: state.runId,
        status: state.status,
        runDirectory
      };
    } catch (error: any) {
      const failedStep = state.currentStep || 'ingestion';
      state = await this.persistState({
        ...state,
        status: 'failed',
        steps: state.steps.map((step) =>
          step.name === failedStep
            ? {
                ...step,
                status: 'failed',
                lastError: error.message,
                updatedAt: new Date().toISOString()
              }
            : step
        )
      });

      await this.workspace.appendEvent(state.runId, {
        event: 'run_failed',
        step: failedStep,
        error: error.message
      });

      logger.error({ error: error.message, runId: state.runId }, 'Harness run failed');

      return {
        runId: state.runId,
        status: state.status,
        runDirectory,
        reason: error.message
      };
    }
  }

  private async bootstrapState(options: HarnessExecuteOptions): Promise<HarnessRunState> {
    if (options.resume) {
      if (!options.runId) {
        throw new Error('runId is required when resuming a harness run.');
      }
      return this.workspace.loadRunState(options.runId);
    }

    const runId = options.runId || this.workspace.createRunId();
    return this.workspace.initializeRun(runId, this.maxDraftAttempts);
  }

  private async runDraftLoop(
    state: HarnessRunState,
    score: TopicScore,
    plan: HarnessPlan
  ): Promise<{ state: HarnessRunState; draft: ContentDraft; evaluation: EvaluationReport }> {
    const canReuseApprovedArtifacts =
      state.status === 'awaiting_approval' &&
      Boolean(state.latestArtifacts.draft) &&
      Boolean(state.latestArtifacts.evaluation);

    if (canReuseApprovedArtifacts) {
      return {
        state,
        draft: await this.workspace.readArtifact(
          state.runId,
          state.latestArtifacts.draft!,
          ContentDraftSchema
        ),
        evaluation: await this.workspace.readArtifact(
          state.runId,
          state.latestArtifacts.evaluation!,
          EvaluationReportSchema
        )
      };
    }

    const firstAttempt = this.getNextDraftAttempt(state);
    let draft: ContentDraft | null = null;
    let evaluation: EvaluationReport | null = null;

    for (let attempt = firstAttempt; attempt <= state.maxDraftAttempts; attempt += 1) {
      state = await this.persistState({
        ...state,
        status: 'running',
        draftAttempt: attempt,
        currentStep: 'drafting'
      });

      const shouldReuseDraftFromCrash =
        attempt === state.draftAttempt &&
        this.getStepStatus(state, 'drafting') === 'completed' &&
        this.getStepStatus(state, 'evaluation') !== 'completed' &&
        Boolean(state.latestArtifacts.draft);

      if (shouldReuseDraftFromCrash) {
        draft = await this.workspace.readArtifact(
          state.runId,
          state.latestArtifacts.draft!,
          ContentDraftSchema
        );
      } else {
        state = await this.persistState(
          this.patchStep(state, 'drafting', {
            status: 'in_progress',
            attempts: attempt
          })
        );
        draft = await this.deps.generator.draftCandidate(score, state.latestFeedback);
        const draftArtifact = await this.workspace.writeArtifact(
          state.runId,
          `draft.attempt-${attempt}.json`,
          draft
        );
        state = await this.persistState(
          this.patchStep(
            state,
            'drafting',
            {
              status: 'completed',
              artifact: draftArtifact,
              attempts: attempt,
              lastError: undefined
            },
            'draft',
            draftArtifact
          )
        );
      }

      state = await this.persistState(
        this.patchStep(state, 'evaluation', {
          status: 'in_progress',
          attempts: attempt
        })
      );
      evaluation = await this.deps.evaluator.evaluateCandidate({ score, draft, plan });
      const evaluationArtifact = await this.workspace.writeArtifact(
        state.runId,
        `evaluation.attempt-${attempt}.json`,
        evaluation
      );
      state = await this.persistState(
        this.patchStep(
          state,
          'evaluation',
          {
            status: 'completed',
            artifact: evaluationArtifact,
            attempts: attempt,
            lastError: undefined
          },
          'evaluation',
          evaluationArtifact
        )
      );

      if (evaluation.passed) {
        return { state, draft, evaluation };
      }

      if (!evaluation.retryable) {
        return { state, draft, evaluation };
      }

      state = await this.persistState({
        ...state,
        latestFeedback: evaluation.feedback,
        currentStep: 'drafting'
      });

      await this.workspace.appendEvent(state.runId, {
        event: 'draft_retry_scheduled',
        attempt,
        feedback: evaluation.feedback
      });
    }

    if (!draft || !evaluation) {
      throw new Error('Draft loop terminated before producing draft artifacts.');
    }

    return { state, draft, evaluation };
  }

  private async handleApproval(
    state: HarnessRunState,
    draft: ContentDraft,
    approve: boolean
  ): Promise<{ state: HarnessRunState; status: HarnessRunStatus }> {
    const now = new Date().toISOString();
    let approvalRecord: ApprovalRequest;

    if (state.latestArtifacts.approval) {
      approvalRecord = await this.workspace.readArtifact(
        state.runId,
        state.latestArtifacts.approval,
        ApprovalRequestSchema
      );
    } else {
      approvalRecord = {
        draftId: draft.id,
        status: 'pending',
        requestedAt: now
      };
    }

    this.deps.approvalQueue.enqueue(draft);

    if (!approve) {
      const artifact = await this.workspace.writeArtifact(
        state.runId,
        'approval.json',
        approvalRecord
      );
      state = await this.persistState({
        ...this.patchStep(
          state,
          'approval',
          {
            status: 'blocked',
            artifact,
            attempts: Math.max(this.getStepAttempts(state, 'approval'), 1)
          },
          'approval',
          artifact
        ),
        status: 'awaiting_approval',
        currentStep: 'approval'
      });

      await this.workspace.appendEvent(state.runId, {
        event: 'awaiting_approval',
        draftId: draft.id
      });

      return { state, status: 'awaiting_approval' };
    }

    this.deps.approvalQueue.approve(draft.id);
    approvalRecord = {
      ...approvalRecord,
      status: 'approved',
      approvedAt: now
    };

    const artifact = await this.workspace.writeArtifact(
      state.runId,
      'approval.json',
      approvalRecord
    );
    state = await this.persistState({
      ...this.patchStep(
        state,
        'approval',
        {
          status: 'completed',
          artifact,
          attempts: Math.max(this.getStepAttempts(state, 'approval'), 1),
          lastError: undefined
        },
        'approval',
        artifact
      ),
      status: 'running',
      currentStep: 'publishing'
    });

    await this.workspace.appendEvent(state.runId, {
      event: 'approval_granted',
      draftId: draft.id
    });

    return { state, status: 'running' };
  }

  private async runCachedArtifact<T>(params: {
    state: HarnessRunState;
    step: HarnessStepName;
    artifactKey: HarnessArtifactKey;
    fileName: string;
    schema: z.ZodType<T>;
    run: () => Promise<T>;
  }): Promise<{ state: HarnessRunState; value: T }> {
    const existingArtifact = params.state.latestArtifacts[params.artifactKey];
    if (existingArtifact && this.getStepStatus(params.state, params.step) === 'completed') {
      return {
        state: params.state,
        value: await this.workspace.readArtifact(
          params.state.runId,
          existingArtifact,
          params.schema
        )
      };
    }

    let state = await this.persistState(
      this.patchStep(params.state, params.step, {
        status: 'in_progress',
        attempts: this.getStepAttempts(params.state, params.step) + 1,
        lastError: undefined
      })
    );

    try {
      const value = params.schema.parse(await params.run());
      const artifact = await this.workspace.writeArtifact(state.runId, params.fileName, value);
      state = await this.persistState(
        this.patchStep(
          state,
          params.step,
          {
            status: 'completed',
            artifact,
            attempts: this.getStepAttempts(state, params.step),
            lastError: undefined
          },
          params.artifactKey,
          artifact
        )
      );

      await this.workspace.appendEvent(state.runId, {
        event: 'step_completed',
        step: params.step,
        artifact
      });

      return { state, value };
    } catch (error: any) {
      state = await this.persistState(
        this.patchStep(state, params.step, {
          status: 'failed',
          lastError: error.message
        })
      );
      console.error("HARNESS ERR:", error); throw error;
    }
  }

  private patchStep(
    state: HarnessRunState,
    stepName: HarnessStepName,
    patch: Partial<HarnessRunState['steps'][number]>,
    artifactKey?: HarnessArtifactKey,
    artifact?: string
  ): HarnessRunState {
    const steps = state.steps.map((step) =>
      step.name === stepName
        ? {
            ...step,
            ...patch,
            updatedAt: new Date().toISOString()
          }
        : step
    );

    return {
      ...state,
      currentStep: stepName,
      latestArtifacts:
        artifactKey && artifact
          ? {
              ...state.latestArtifacts,
              [artifactKey]: artifact
            }
          : state.latestArtifacts,
      steps
    };
  }

  private getNextDraftAttempt(state: HarnessRunState): number {
    const draftingStatus = this.getStepStatus(state, 'drafting');
    const evaluationStatus = this.getStepStatus(state, 'evaluation');

    if (draftingStatus === 'in_progress' || evaluationStatus === 'in_progress') {
      return Math.max(state.draftAttempt, 1);
    }

    if (state.draftAttempt > 0 && state.latestArtifacts.evaluation) {
      return state.draftAttempt + 1;
    }

    return 1;
  }

  private getStepStatus(state: HarnessRunState, stepName: HarnessStepName) {
    return state.steps.find((step) => step.name === stepName)?.status || 'pending';
  }

  private getStepAttempts(state: HarnessRunState, stepName: HarnessStepName) {
    return state.steps.find((step) => step.name === stepName)?.attempts || 0;
  }

  private async persistState(state: HarnessRunState): Promise<HarnessRunState> {
    return this.workspace.saveRunState(state);
  }
}

export function createDefaultHarnessRunner(): HarnessRunner {
  let provider: ICompletionProvider;

  try {
    provider = new MinimaxProvider();
  } catch (error: any) {
    logger.warn(
      { error: error.message },
      'Model provider configuration missing, falling back to deterministic generator stubs.'
    );
    provider = {
      async complete() {
        throw new Error('Model provider is unavailable in the current environment.');
      }
    };
  }

  const ranking = new RankingService(provider);
  const drafting = new DraftingService(provider);

  return new HarnessRunner({
    ingestion: new IngestionService(),
    planner: new PlannerAgent(),
    generator: new GeneratorAgent(ranking, drafting),
    evaluator: new EvaluatorAgent(new GuardianService()),
    approvalQueue: new ApprovalQueue(),
    publisher: createDefaultPublisherAdapter(),
    analytics: new AnalyticsService(),
    learning: new LearningService()
  });
}
