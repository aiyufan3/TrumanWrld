import { logger } from '../utils/logger';
import { getEnv } from '../utils/secrets';
import { createDefaultHarnessRunner } from '../harness/harnessRunner';
import { MinimaxProvider } from '../adapters/model/minimaxProvider';
import { SignalDiscoveryService } from '../modules/discovery/signalDiscovery';
import { EngagementAgent } from '../modules/engagement/engagementAgent';
import { LearningService } from '../modules/learning';

export interface HermesCycleReport {
  cycleId: string;
  startedAt: string;
  finishedAt: string;
  signalSource: string;
  signalContent: string;
  harnessRunId?: string;
  harnessStatus: string;
  engagementActions: number;
  engagementSuccesses: number;
  error?: string;
}

export class HermesOrchestrator {
  private readonly discovery: SignalDiscoveryService;
  private readonly engagement: EngagementAgent;
  private readonly learning: LearningService;

  constructor() {
    let provider: MinimaxProvider;
    try {
      provider = new MinimaxProvider();
    } catch {
      throw new Error('Model provider is required for autonomous mode.');
    }

    this.learning = new LearningService();
    this.discovery = new SignalDiscoveryService(provider);
    this.engagement = new EngagementAgent(provider, this.learning);
  }

  async runCycle(): Promise<HermesCycleReport> {
    const cycleId = `cycle-${Date.now()}`;
    const startedAt = new Date().toISOString();
    logger.info({ cycleId }, 'Starting Hermes autonomous cycle');

    let signalSource = 'unknown';
    let signalContent = '';
    let harnessRunId: string | undefined;
    let harnessStatus = 'skipped';
    let engagementActions = 0;
    let engagementSuccesses = 0;
    let error: string | undefined;

    try {
      // Memory Lookup for injection into Harness
      const playbookMemories = this.learning.getRelevantSkills('general');
      const memoryContext = playbookMemories.length > 0 
        ? `\n\n[Hermes Memory Playbooks]:\n${playbookMemories.join('\n')}`
        : '';

      const signal = await this.discovery.discoverSignal();
      signalSource = signal.source;
      signalContent = signal.content;
      logger.info(
        { source: signalSource, contentLength: signalContent.length },
        'Signal discovered'
      );

      // We append Memory Context to signalContent for simplistic robust prompt injection
      const injectedSignalContent = signalContent + memoryContext;

      try {
        const runner = createDefaultHarnessRunner();
        const result = await runner.execute({
          signalContent: injectedSignalContent,
          approve: getEnv('HERMES_AUTO_APPROVE').trim().toLowerCase() !== 'false'
        });

        harnessRunId = result.runId;
        harnessStatus = result.status;
        logger.info({ runId: result.runId, status: result.status }, 'Harness pipeline completed');

        // Note: HarnessRunner internally triggers LearningService.learnFromOutcomes if integrated,
        // but we'll record the cycle directly here.
      } catch (harnessError: any) {
        harnessStatus = 'failed';
        logger.error(
          { error: harnessError.message },
          'Harness pipeline failed in autonomous cycle'
        );
      }

      try {
        const records = await this.engagement.runCycle();
        engagementActions = records.length;
        engagementSuccesses = records.filter((r) => r.success).length;
      } catch (engagementError: any) {
        logger.error({ error: engagementError.message }, 'Engagement cycle failed');
      }
    } catch (err: any) {
      error = err.message;
      logger.error({ cycleId, error: err.message }, 'Hermes cycle failed');
    }

    const finishedAt = new Date().toISOString();
    const report: HermesCycleReport = {
      cycleId,
      startedAt,
      finishedAt,
      signalSource,
      signalContent: signalContent.slice(0, 200),
      harnessRunId,
      harnessStatus,
      engagementActions,
      engagementSuccesses,
      error
    };

    this.learning.recordCycle(report);
    logger.info(
      { cycleId, harnessStatus, engagementActions, engagementSuccesses },
      'Hermes autonomous cycle completed'
    );

    return report;
  }
}

function isEnabled(name: string): boolean {
  return !['', '0', 'false', 'off', 'no'].includes(getEnv(name).trim().toLowerCase());
}
