import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { getEnv } from '../utils/secrets';
import { createInitialRunState, HarnessRunState, HarnessRunStateSchema } from './schemas';

export class HarnessWorkspace {
  constructor(
    private readonly baseDir = path.resolve(
      process.cwd(),
      getEnv('HARNESS_RUNTIME_PATH') || 'runtime/harness'
    )
  ) {}

  createRunId(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${stamp}-${crypto.randomUUID().slice(0, 8)}`;
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  getRunDir(runId: string): string {
    return path.join(this.baseDir, 'runs', runId);
  }

  async initializeRun(runId: string, maxDraftAttempts: number): Promise<HarnessRunState> {
    await this.ensureRunDirectories(runId);
    const state = createInitialRunState(runId, maxDraftAttempts);
    return this.saveRunState(state);
  }

  async loadRunState(runId: string): Promise<HarnessRunState> {
    const raw = await fs.readFile(this.getStatePath(runId), 'utf8');
    return HarnessRunStateSchema.parse(JSON.parse(raw));
  }

  async listRunStates(): Promise<HarnessRunState[]> {
    const runsDir = path.join(this.baseDir, 'runs');

    try {
      const entries = await fs.readdir(runsDir, { withFileTypes: true });
      const states = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            try {
              return await this.loadRunState(entry.name);
            } catch {
              return null;
            }
          })
      );

      return states
        .filter((state): state is HarnessRunState => Boolean(state))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  async saveRunState(state: HarnessRunState): Promise<HarnessRunState> {
    const nextState = HarnessRunStateSchema.parse({
      ...state,
      updatedAt: new Date().toISOString()
    });
    await this.ensureRunDirectories(nextState.runId);
    await fs.writeFile(
      this.getStatePath(nextState.runId),
      `${JSON.stringify(nextState, null, 2)}\n`,
      'utf8'
    );
    await fs.writeFile(
      path.join(this.baseDir, 'latest-run.json'),
      `${JSON.stringify({ runId: nextState.runId, updatedAt: nextState.updatedAt }, null, 2)}\n`,
      'utf8'
    );
    return nextState;
  }

  async writeArtifact(runId: string, fileName: string, payload: unknown): Promise<string> {
    const artifactPath = path.join(this.getRunDir(runId), 'artifacts', fileName);
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return path.relative(this.getRunDir(runId), artifactPath);
  }

  async readArtifact<T>(runId: string, relativePath: string, schema: z.ZodType<T>): Promise<T> {
    const artifactPath = path.join(this.getRunDir(runId), relativePath);
    const raw = await fs.readFile(artifactPath, 'utf8');
    return schema.parse(JSON.parse(raw));
  }

  async appendEvent(runId: string, payload: Record<string, unknown>): Promise<void> {
    const logPath = path.join(this.getRunDir(runId), 'events.ndjson');
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    const record = {
      at: new Date().toISOString(),
      ...payload
    };
    await fs.appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8');
  }

  private async ensureRunDirectories(runId: string): Promise<void> {
    await fs.mkdir(path.join(this.getRunDir(runId), 'artifacts'), { recursive: true });
  }

  private getStatePath(runId: string): string {
    return path.join(this.getRunDir(runId), 'progress.json');
  }
}
