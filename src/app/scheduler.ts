import * as dotenv from 'dotenv';
dotenv.config();

import { logger } from '../utils/logger';
import { getEnv } from '../utils/secrets';
import { HermesOrchestrator } from './hermesOrchestrator';
import fs from 'fs';
import path from 'path';

const INTERVAL_MINS = parseInt(getEnv('HERMES_CYCLE_INTERVAL_MINUTES') || '10', 10);
const SLEEP_MS = INTERVAL_MINS * 60 * 1000;

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function persistDaemonStatus(cycleCount: number, nextInMs: number, customStatus?: string) {
  try {
    const dir = path.resolve(process.cwd(), 'runtime/hermes');
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      status: customStatus || 'running',
      lastHeartbeat: new Date().toISOString(),
      cycleCount,
      nextCycleAt: new Date(Date.now() + nextInMs).toISOString()
    };
    fs.writeFileSync(path.join(dir, 'daemon_status.json'), JSON.stringify(payload, null, 2));
  } catch (error) {
    // Graceful fail
  }
}

async function main() {
  logger.info({ intervalMins: INTERVAL_MINS }, 'Starting TrumanWrld Hermes Daemon (Scheduled Loop)');
  const orchestrator = new HermesOrchestrator();
  let cycleCount = 0;
  let running = true;

  const shutdown = () => {
    logger.info('Hermes Daemon shutting down gracefully...');
    running = false;
    persistDaemonStatus(cycleCount, 0, 'stopped');
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Initialize status on daemon boot
  persistDaemonStatus(cycleCount, 0, 'booting');

  while (running) {
    cycleCount++;
    logger.info({ cycle: cycleCount }, '--- Hermes Cycle Starting ---');
    persistDaemonStatus(cycleCount, 0, 'active');

    try {
      const report = await orchestrator.runCycle();
      logger.info(
        { cycle: cycleCount, harnessStatus: report.harnessStatus, likes: report.engagementSuccesses },
        '--- Hermes Cycle Complete ---'
      );
    } catch (error: any) {
      logger.error(
        { cycle: cycleCount, error: error.message },
        '--- Hermes Cycle Failed ---'
      );
    }

    if (!running) break;

    persistDaemonStatus(cycleCount, SLEEP_MS, 'sleeping');
    logger.info(
      { nextIn: formatDuration(SLEEP_MS), cycle: cycleCount },
      'Hermes Daemon sleeping until next cycle'
    );

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, SLEEP_MS);
      const check = setInterval(() => {
        if (!running) {
          clearTimeout(timer);
          clearInterval(check);
          resolve();
        }
      }, 5000);
    });
  }

  logger.info({ totalCycles: cycleCount }, 'Hermes Daemon stopped.');
}

main().catch((error: any) => {
  logger.error({ error: error.message }, 'Hermes Daemon crashed');
  process.exit(1);
});
