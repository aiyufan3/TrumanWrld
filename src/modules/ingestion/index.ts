import { Signal, SignalSchema } from '../../schemas/models';
import { logger } from '../../utils/logger';
import crypto from 'crypto';
import { securityGuard } from '../security';

export class IngestionService {
  async ingestLocalMarkdown(content: string, metadata?: any): Promise<Signal> {
    securityGuard.assertSafeForIngestion(content);
    logger.info({ charCount: content.length }, 'Ingesting local markdown signal');
    return SignalSchema.parse({
      id: crypto.randomUUID(),
      source: 'local',
      content,
      receivedAt: new Date(),
      metadata
    });
  }
}
