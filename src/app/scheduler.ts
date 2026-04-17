import * as dotenv from 'dotenv';
dotenv.config();

import { logger } from '../utils/logger';
import { getEnv } from '../utils/secrets';
import { HermesOrchestrator } from './hermesOrchestrator';

const MIN_HOURS = parseFloat(getEnv('HERMES_INTERVAL_MIN_HOURS') || '4');
const MAX_HOURS = parseFloat(getEnv('HERMES_INTERVAL_MAX_HOURS') || '6');

function randomIntervalMs(): number {
  const hours = MIN_HOURS + Math.random() * (MAX_HOURS - MIN_HOURS);
  return Math.round(hours * 60 * 60 * 1000);
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

async function main() {
  logger.info({ minHours: MIN_HOURS, maxHours: MAX_HOURS }, 'Starting TrumanWrld Hermes Daemon');

  const orchestrator = new HermesOrchestrator();
  let cycleCount = 0;
  let running = true;

  const shutdown = () => {
    logger.info('Hermes Daemon shutting down gracefully...');
    running = false;
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Run first cycle immediately
  while (running) {
    cycleCount++;
    logger.info({ cycle: cycleCount }, '--- Hermes Cycle Starting ---');

    try {
      const report = await orchestrator.runCycle();
      logger.info(
        {
          cycle: cycleCount,
          harnessStatus: report.harnessStatus,
          engagementActions: report.engagementActions,
          engagementSuccesses: report.engagementSuccesses
        },
        '--- Hermes Cycle Complete ---'
      );
    } catch (error: any) {
      logger.error(
        { cycle: cycleCount, error: error.message },
        '--- Hermes Cycle Failed (will retry next interval) ---'
      );
    }

    if (!running) break;

    const sleepMs = randomIntervalMs();
    logger.info(
      { nextIn: formatDuration(sleepMs), cycle: cycleCount },
      'Hermes Daemon sleeping until next cycle'
    );

    // Interruptible sleep
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, sleepMs);
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
