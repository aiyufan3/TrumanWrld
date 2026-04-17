import { ContentDraft } from '../../schemas/models';
import { logger } from '../../utils/logger';

export class ApprovalQueue {
  private queue: ContentDraft[] = [];

  enqueue(draft: ContentDraft) {
    if (!this.queue.find((item) => item.id === draft.id)) {
      draft.status = 'pending_approval';
      this.queue.push(draft);
      logger.info({ draftId: draft.id }, 'Draft added to approval queue');
    }
  }

  getPending(): ContentDraft[] {
    return this.queue.filter((draft) => draft.status === 'pending_approval');
  }

  approve(draftId: string) {
    const draft = this.queue.find((d) => d.id === draftId);
    if (draft) {
      draft.status = 'approved';
      logger.info({ draftId }, 'Draft approved');
    }
  }
}
