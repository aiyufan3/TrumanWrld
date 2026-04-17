import * as dotenv from 'dotenv';
dotenv.config();

import { logger } from '../utils/logger';
import { LocalAuthServer } from './authServer';

async function main() {
  const server = new LocalAuthServer();
  await server.listen();

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((error: any) => {
  logger.error({ message: error.message }, 'Failed to start local auth server');
  process.exit(1);
});
