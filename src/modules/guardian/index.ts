import { ContentDraft } from '../../schemas/models';
import { logger } from '../../utils/logger';
import { securityGuard } from '../security';

export class GuardianService {
  async reviewDraft(draft: ContentDraft): Promise<{ passed: boolean; reason?: string }> {
    logger.info({ draftId: draft.id }, 'Guardian reviewing draft...');

    for (const v of draft.versions) {
      const securityAudit = securityGuard.auditText(v.content);
      if (securityAudit.blocked) {
        return {
          passed: false,
          reason: `Sensitive credential-like material detected in ${v.platform} content.`
        };
      }
      if (v.content.toLowerCase().includes('as an ai')) {
        return { passed: false, reason: 'Robotic phrasing detected: "as an ai"' };
      }
      if (v.content.toLowerCase().includes('not financial advice')) {
        return { passed: false, reason: 'Cliche investment disclaimer detected' };
      }
    }

    return { passed: true };
  }
}
