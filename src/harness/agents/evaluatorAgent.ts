import { ContentDraft, TopicScore } from '../../schemas/models';
import { GuardianService } from '../../modules/guardian';
import { PromptCatalog } from '../promptCatalog';
import { EvaluationIssue, EvaluationReport, EvaluationReportSchema, HarnessPlan } from '../schemas';

export class EvaluatorAgent {
  constructor(
    private readonly guardianService: GuardianService,
    private readonly promptCatalog = new PromptCatalog()
  ) {}

  async evaluateCandidate(params: {
    score: TopicScore;
    draft: ContentDraft;
    plan: HarnessPlan;
  }): Promise<EvaluationReport> {
    await this.promptCatalog.load('guardian.system.md');

    const { score, draft, plan } = params;
    const issues: EvaluationIssue[] = [];

    if (score.total_score <= 50) {
      issues.push({
        code: 'score_below_threshold',
        message: `Topic score ${score.total_score} is below the minimum viable threshold of 50.`,
        severity: 'error',
        retryable: false
      });
    }

    const guardianResult = await this.guardianService.reviewDraft(draft);
    if (!guardianResult.passed) {
      issues.push({
        code: 'guardian_rejected',
        message: guardianResult.reason || 'Guardian rejected the draft package.',
        severity: 'error',
        retryable: true
      });
    }

    const platforms = new Set(draft.versions.map((version) => version.platform));
    if (!platforms.has('x')) {
      issues.push({
        code: 'missing_x_variant',
        message: 'Draft package is missing an X variant.',
        severity: 'error',
        retryable: true
      });
    }

    if (!platforms.has('threads')) {
      issues.push({
        code: 'missing_threads_variant',
        message: 'Draft package is missing a Threads variant.',
        severity: 'error',
        retryable: true
      });
    }

    for (const version of draft.versions) {
      const trimmed = version.content.trim();
      if (!trimmed) {
        issues.push({
          code: 'empty_variant',
          message: `Platform ${version.platform} returned empty content.`,
          severity: 'error',
          retryable: true
        });
      }

      if (version.platform === 'x' && trimmed.length > 280) {
        // Auto-truncate rather than rejecting — we want autonomous posting
        version.content = trimmed.slice(0, 277) + '...';
        issues.push({
          code: 'x_auto_truncated',
          message: `X draft was ${trimmed.length} chars, auto-truncated to 280.`,
          severity: 'warning',
          retryable: false
        });
      }

      if (version.platform === 'threads' && trimmed.length > 500) {
        issues.push({
          code: 'threads_character_limit',
          message: `Threads draft is ${trimmed.length} characters, exceeding the 500 character limit.`,
          severity: 'error',
          retryable: true
        });
      }
    }

    const uniqueContents = new Set(draft.versions.map((version) => version.content.trim()));
    if (uniqueContents.size < draft.versions.length) {
      issues.push({
        code: 'duplicate_variants',
        message: 'X and Threads variants should not be identical copy.',
        severity: 'warning',
        retryable: true
      });
    }

    const blockingIssues = issues.filter((issue) => issue.severity === 'error');
    const feedback = issues.filter((issue) => issue.retryable).map((issue) => issue.message);

    return EvaluationReportSchema.parse({
      passed: blockingIssues.length === 0,
      retryable:
        blockingIssues.length > 0 ? blockingIssues.every((issue) => issue.retryable) : true,
      summary:
        blockingIssues.length === 0
          ? `Draft package satisfies the planner goal: ${plan.objective}`
          : `Draft package failed ${blockingIssues.length} blocking checks against the planner acceptance criteria.`,
      issues,
      feedback
    });
  }
}
