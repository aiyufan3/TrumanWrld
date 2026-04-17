import { logger } from '../utils/logger';
import { createDefaultHarnessRunner } from '../harness/harnessRunner';
import * as dotenv from 'dotenv';
dotenv.config();

const DEFAULT_SIGNAL =
  'Recent advancements in large language models suggest that scaling laws are holding, meaning we might be closer to generalized reasoning than previously thought.';

async function main() {
  logger.info('Starting TrumanWrld Harness Runtime');

  const runner = createDefaultHarnessRunner();
  const args = process.argv.slice(2);
  const resume = args.includes('--resume');
  const approve = args.includes('--approve');
  const authServer = args.includes('--auth-server');
  const runId = readArgValue(args, '--run-id');
  const signalContent = readArgValue(args, '--signal') || (resume ? undefined : DEFAULT_SIGNAL);

  if (authServer) {
    const { LocalAuthServer } = await import('../server/authServer');
    const server = new LocalAuthServer();
    await server.listen();
    return;
  }

  const result = await runner.execute({
    signalContent,
    runId: runId || undefined,
    resume,
    approve
  });

  if (result.status === 'awaiting_approval') {
    logger.info(
      { runId: result.runId, runDirectory: result.runDirectory },
      'Run paused for human approval. Resume from the local control console or with `npm run start -- --resume --run-id <id> --approve`.'
    );
    return;
  }

  if (result.status === 'failed') {
    logger.error(
      { runId: result.runId, reason: result.reason, runDirectory: result.runDirectory },
      'Harness execution failed'
    );
    return;
  }

  logger.info(
    { runId: result.runId, runDirectory: result.runDirectory },
    'Harness execution completed successfully.'
  );
}

main();

function readArgValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}
