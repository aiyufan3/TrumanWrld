import { logger } from '../utils/logger';
import { getEnv } from '../utils/secrets';
import { createDefaultHarnessRunner } from '../harness/harnessRunner';
import { MinimaxProvider } from '../adapters/model/minimaxProvider';
import { SignalDiscoveryService } from '../modules/discovery/signalDiscovery';
import { EngagementAgent } from '../modules/engagement/engagementAgent';
import fs from 'fs';
import path from 'path';

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

  constructor() {
    let provider: MinimaxProvider;
    try {
      provider = new MinimaxProvider();
    } catch {
      throw new Error('Model provider is required for autonomous mode.');
    }

    this.discovery = new SignalDiscoveryService(provider);
    this.engagement = new EngagementAgent(provider);
  }

  /**
   * Run a single autonomous cycle:
   * 1. Discover a signal
   * 2. Run the full harness pipeline
   * 3. Run engagement actions
   */
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
      // Phase 1: Discover signal
      const signal = await this.discovery.discoverSignal();
      signalSource = signal.source;
      signalContent = signal.content;
      logger.info(
        { source: signalSource, contentLength: signalContent.length },
        'Signal discovered'
      );

      // Phase 2: Run harness pipeline
      try {
        const runner = createDefaultHarnessRunner();
        const autoApprove = isEnabled('HERMES_AUTO_APPROVE');
        const result = await runner.execute({
          signalContent,
          approve: autoApprove
        });

        harnessRunId = result.runId;
        harnessStatus = result.status;
        logger.info({ runId: result.runId, status: result.status }, 'Harness pipeline completed');
      } catch (harnessError: any) {
        harnessStatus = 'failed';
        logger.error(
          { error: harnessError.message },
          'Harness pipeline failed in autonomous cycle'
        );
      }

      // Phase 3: Run engagement
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

    await this.persistCycleReport(report);
    logger.info(
      { cycleId, harnessStatus, engagementActions, engagementSuccesses },
      'Hermes autonomous cycle completed'
    );

    return report;
  }

  private async persistCycleReport(report: HermesCycleReport): Promise<void> {
    const dir = path.resolve(process.cwd(), 'runtime/hermes');
    fs.mkdirSync(dir, { recursive: true });
    const logPath = path.join(dir, 'cycles.ndjson');
    fs.appendFileSync(logPath, JSON.stringify(report) + '\n', 'utf-8');
  }
}

function isEnabled(name: string): boolean {
  return !['', '0', 'false', 'off', 'no'].includes(getEnv(name).trim().toLowerCase());
}
