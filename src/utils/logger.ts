import pino from 'pino';
import { redactSensitiveData } from './secrets';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    log: (obj) => {
      return redactSensitiveData(obj) as Record<string, unknown>;
    }
  },
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname'
    }
  }
});

// Avoid leaking entirely unhandled promise rejections that might have tokens inside them
process.on('unhandledRejection', (reason) => {
  logger.error({ error: reason }, 'Unhandled Rejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ error: err }, 'Uncaught Exception');
});
