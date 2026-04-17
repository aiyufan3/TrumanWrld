import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { ContentDraft } from '../../schemas/models';
import { logger } from '../../utils/logger';
import crypto from 'crypto';
import { PublishReport } from '../../harness/schemas';

export class LearningService {
  private db: Database.Database;

  constructor(dbPathOverride?: string) {
    if (dbPathOverride === ':memory:') {
      this.db = new Database(':memory:');
    } else {
      const dir = path.resolve(process.cwd(), 'runtime/hermes');
      fs.mkdirSync(dir, { recursive: true });
      const dbPath = dbPathOverride || path.join(dir, 'hermes.db');
      this.db = new Database(dbPath);
    }
    this.db.pragma('journal_mode = WAL');
    this.initDb();
  }

  private initDb() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        topic TEXT,
        insight TEXT,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS workflow_skills (
        id TEXT PRIMARY KEY,
        domain TEXT,
        playbook TEXT,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS cycle_reports (
        cycleId TEXT PRIMARY KEY,
        startedAt TEXT,
        finishedAt TEXT,
        harnessStatus TEXT,
        engagementActions INTEGER,
        engagementSuccesses INTEGER,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS engagement_actions (
        id TEXT PRIMARY KEY,
        action TEXT,
        targetId TEXT,
        authorId TEXT,
        platform TEXT,
        success INTEGER,
        executedAt TEXT
      );
      CREATE TABLE IF NOT EXISTS publish_history (
        id TEXT PRIMARY KEY,
        platform TEXT,
        externalId TEXT,
        content TEXT,
        publishedAt TEXT
      );
    `);
  }

  async learnFromOutcomes(draft: ContentDraft, report?: PublishReport) {
    logger.info(
      { draftId: draft.id, topic: draft.topic },
      'Writing memory notes on style evolution and topic performance.'
    );
    const insertMemory = this.db.prepare(
      'INSERT OR REPLACE INTO memory_entries (id, topic, insight, created_at) VALUES (?, ?, ?, ?)'
    );
    insertMemory.run(
      crypto.randomUUID(),
      draft.topic,
      'Successfully drafted and evaluated topic.',
      new Date().toISOString()
    );

    if (report && report.receipts.length > 0) {
      const insertHistory = this.db.prepare(
        'INSERT OR REPLACE INTO publish_history (id, platform, externalId, content, publishedAt) VALUES (?, ?, ?, ?, ?)'
      );
      for (const rec of report.receipts) {
        if (rec.success) {
          const content = draft.versions.find(v => v.platform === rec.platform)?.content || '';
          insertHistory.run(crypto.randomUUID(), rec.platform, rec.url || '', content, rec.publishedAt || new Date().toISOString());
        }
      }
    }
  }

  getRelevantSkills(domain: string): string[] {
    try {
      const rows = this.db.prepare(
        'SELECT playbook FROM workflow_skills WHERE domain = ? ORDER BY created_at DESC LIMIT 5'
      ).all(domain) as { playbook: string }[];
      return rows.map((r) => r.playbook);
    } catch {
      return [];
    }
  }

  recordCycle(report: any) {
    try {
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO cycle_reports (cycleId, startedAt, finishedAt, harnessStatus, engagementActions, engagementSuccesses, error) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      stmt.run(
        report.cycleId,
        report.startedAt,
        report.finishedAt || new Date().toISOString(),
        report.harnessStatus,
        report.engagementActions,
        report.engagementSuccesses,
        report.error || null
      );
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to record cycle to SQLite');
    }
  }

  recordEngagementAction(action: string, targetId: string, authorId: string, platform: string, success: boolean) {
    try {
      const stmt = this.db.prepare(
        'INSERT INTO engagement_actions (id, action, targetId, authorId, platform, success, executedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      stmt.run(
        crypto.randomUUID(),
        action,
        targetId,
        authorId,
        platform,
        success ? 1 : 0,
        new Date().toISOString()
      );
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to log engagement action to SQLite');
    }
  }

  getRecentActionCount(actions: string[], hoursBack: number): number {
    try {
      const timeThreshold = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
      const placeholders = actions.map(() => '?').join(',');
      const stmt = this.db.prepare(
        `SELECT COUNT(*) as cnt FROM engagement_actions WHERE action IN (${placeholders}) AND success = 1 AND executedAt >= ?`
      );
      const row = stmt.get(...actions, timeThreshold) as { cnt: number };
      return row.cnt;
    } catch {
      return 0;
    }
  }

  hasEngagedWithTarget(action: string, targetId: string): boolean {
    try {
      const stmt = this.db.prepare(
        'SELECT COUNT(*) as cnt FROM engagement_actions WHERE action = ? AND targetId = ? AND success = 1'
      );
      const row = stmt.get(action, targetId) as { cnt: number };
      return row.cnt > 0;
    } catch {
      return false;
    }
  }
}
