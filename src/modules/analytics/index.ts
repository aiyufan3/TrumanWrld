import { ContentDraft } from '../../schemas/models';
import { logger } from '../../utils/logger';

export class AnalyticsService {
  recordPublishEvent(draft: ContentDraft, platformUrl?: string) {
    logger.info(
      { draftId: draft.id, topic: draft.topic, status: 'mock_published' },
      'Recording publish metrics placeholder. Awaiting real cron processing.'
    );
  }
}
