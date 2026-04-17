import http from 'http';
import { URL } from 'url';
import { EncryptedTokenStore } from '../auth/tokenStore';
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateOauthState,
  OAuthProviderClient,
  ThreadsOAuthClient,
  XOAuthClient
} from '../auth/providers';
import {
  ApprovalRequest,
  ApprovalRequestSchema,
  EvaluationReport,
  EvaluationReportSchema,
  HarnessRunStatus,
  PublishReport,
  PublishReportSchema
} from '../harness/schemas';
import { createDefaultHarnessRunner, HarnessRunResult } from '../harness/harnessRunner';
import { HarnessWorkspace } from '../harness/workspace';
import { ContentDraft, ContentDraftSchema } from '../schemas/models';
import { logger } from '../utils/logger';
import { getEnv } from '../utils/secrets';
import { z } from 'zod';

interface PendingAuthState {
  provider: 'x' | 'threads';
  state: string;
  codeVerifier?: string;
  createdAt: number;
}

interface ApprovalJobState {
  runId: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt?: string;
  message?: string;
}

interface RunConsoleEntry {
  runId: string;
  stateStatus: HarnessRunStatus;
  currentStep?: string;
  updatedAt: string;
  startedAt: string;
  runDirectory: string;
  topic?: string;
  approvalStatus?: 'pending' | 'approved';
  requestedAt?: string;
  approvedAt?: string;
  evaluationSummary?: string;
  evaluationPassed?: boolean;
  previews: Array<{
    platform: string;
    content: string;
  }>;
  receipts: Array<{
    platform: string;
    success: boolean;
    publishedAt: string;
    attempts?: number;
    url?: string;
  }>;
  lastError?: string;
}

interface LocalAuthServerOptions {
  host?: string;
  port?: number;
  workspace?: HarnessWorkspace;
  runnerFactory?: () => {
    execute(options: {
      runId: string;
      resume: boolean;
      approve: boolean;
    }): Promise<HarnessRunResult>;
  };
  tokenStore?: EncryptedTokenStore;
  providers?: Record<'x' | 'threads', OAuthProviderClient>;
}

export class LocalAuthServer {
  private readonly pendingStates = new Map<string, PendingAuthState>();
  private readonly approvalJobs = new Map<string, ApprovalJobState>();
  private readonly tokenStore: EncryptedTokenStore;
  private readonly providers: Record<'x' | 'threads', OAuthProviderClient>;
  private readonly workspace: HarnessWorkspace;
  private readonly runnerFactory: LocalAuthServerOptions['runnerFactory'];
  private readonly host: string;
  private readonly requestedPort: number;
  private resolvedPort: number;
  private server?: http.Server;

  constructor(options: LocalAuthServerOptions = {}) {
    this.host = options.host || getEnv('AUTH_SERVER_HOST') || '127.0.0.1';
    this.requestedPort = options.port ?? Number.parseInt(getEnv('AUTH_SERVER_PORT') || '8788', 10);
    this.resolvedPort = this.requestedPort;
    this.workspace = options.workspace || new HarnessWorkspace();
    this.runnerFactory = options.runnerFactory || (() => createDefaultHarnessRunner());
    this.tokenStore = options.tokenStore || new EncryptedTokenStore();
    this.providers = options.providers || {
      x: new XOAuthClient(),
      threads: new ThreadsOAuthClient()
    };
  }

  async listen(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = http.createServer((req, res) => {
      this.route(req, res).catch((error: any) => {
        logger.error({ message: error.message }, 'Auth server request failed');
        this.respondHtml(
          res,
          500,
          renderResultPage('Request failed', error.message, this.baseUrl())
        );
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.requestedPort, this.host, () => {
        const address = this.server!.address();
        if (address && typeof address === 'object') {
          this.resolvedPort = address.port;
        }
        logger.info({ url: this.baseUrl() }, 'Local OAuth server is listening.');
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    this.server = undefined;
  }

  baseUrl(): string {
    return getEnv('AUTH_BASE_URL') || `http://${this.host}:${this.resolvedPort}`;
  }

  async renderConsoleHtml(): Promise<string> {
    const statuses = await this.tokenStore.getStatuses();
    const entries = await this.loadRunEntries();
    return renderIndexPage({
      baseUrl: this.baseUrl(),
      statuses,
      xConfigured: this.providers.x.isConfigured(),
      threadsConfigured: this.providers.threads.isConfigured(),
      pendingApprovals: entries.filter((entry) => entry.stateStatus === 'awaiting_approval'),
      recentRuns: entries.filter((entry) => entry.stateStatus !== 'awaiting_approval').slice(0, 6),
      jobs: Array.from(this.approvalJobs.values()),
      publishingEnabled: isEnabled('ALLOW_REAL_POSTS') && isEnabled('ALLOW_EXTERNAL_SIDE_EFFECTS')
    });
  }

  async getApprovalStatusPayload(): Promise<{
    pendingApprovals: RunConsoleEntry[];
    recentRuns: RunConsoleEntry[];
    jobs: ApprovalJobState[];
  }> {
    const entries = await this.loadRunEntries();
    return {
      pendingApprovals: entries.filter((entry) => entry.stateStatus === 'awaiting_approval'),
      recentRuns: entries.filter((entry) => entry.stateStatus !== 'awaiting_approval').slice(0, 12),
      jobs: Array.from(this.approvalJobs.values())
    };
  }

  async getRunDetailHtml(runId: string): Promise<string> {
    if (!isSafeRunId(runId)) {
      throw new Error('Invalid run id');
    }

    const entry = await this.loadRunEntry(runId);
    if (!entry) {
      throw new Error(`Run not found: ${runId}`);
    }

    return renderRunDetailPage({
      baseUrl: this.baseUrl(),
      entry,
      job: this.approvalJobs.get(runId)
    });
  }

  async approveRun(runId: string): Promise<void> {
    if (!isSafeRunId(runId)) {
      throw new Error('Invalid run id');
    }

    const entry = await this.loadRunEntry(runId);
    if (!entry) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (entry.stateStatus !== 'awaiting_approval') {
      return;
    }

    if (!this.approvalJobs.has(runId) || this.approvalJobs.get(runId)?.status !== 'running') {
      this.approvalJobs.set(runId, {
        runId,
        status: 'running',
        startedAt: new Date().toISOString(),
        message: 'Approval accepted. Resuming the harness run now.'
      });
      void this.resumeApprovedRun(runId);
    }
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', this.baseUrl());
    this.prunePendingStates();

    if (url.pathname === '/favicon.ico') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (url.pathname === '/') {
      this.respondHtml(res, 200, await this.renderConsoleHtml());
      return;
    }

    if (url.pathname === '/auth/status') {
      this.respondJson(res, 200, {
        baseUrl: this.baseUrl(),
        statuses: await this.tokenStore.getStatuses()
      });
      return;
    }

    if (url.pathname === '/approval/status') {
      this.respondJson(res, 200, await this.getApprovalStatusPayload());
      return;
    }

    if (method === 'GET' && url.pathname === '/auth/x/start') {
      await this.handleStartAuth('x', res);
      return;
    }

    if (method === 'GET' && url.pathname === '/auth/threads/start') {
      await this.handleStartAuth('threads', res);
      return;
    }

    if (method === 'GET' && url.pathname === '/auth/x/callback') {
      await this.handleCallback('x', url, res);
      return;
    }

    if (method === 'GET' && url.pathname === '/auth/threads/callback') {
      await this.handleCallback('threads', url, res);
      return;
    }

    if (method === 'GET' && url.pathname === '/auth/x/disconnect') {
      await this.tokenStore.deleteProviderToken('x');
      this.redirect(res, '/');
      return;
    }

    if (method === 'GET' && url.pathname === '/auth/threads/disconnect') {
      await this.tokenStore.deleteProviderToken('threads');
      this.redirect(res, '/');
      return;
    }

    if (method === 'POST' && url.pathname === '/approval/approve') {
      await this.handleApproveRun(req, res);
      return;
    }

    const runId = extractRunId(url.pathname);
    if (method === 'GET' && runId) {
      await this.handleRunDetail(runId, res);
      return;
    }

    this.respondHtml(res, 404, renderResultPage('Not found', 'Unknown route.', this.baseUrl()));
  }

  private async handleStartAuth(
    providerName: 'x' | 'threads',
    res: http.ServerResponse
  ): Promise<void> {
    const provider = this.providers[providerName];
    if (!provider.isConfigured()) {
      this.respondHtml(
        res,
        400,
        renderResultPage(
          'Provider not configured',
          `Missing environment variables for ${providerName}.`,
          this.baseUrl()
        )
      );
      return;
    }

    const state = generateOauthState();
    const codeVerifier = providerName === 'x' ? generateCodeVerifier() : undefined;
    this.pendingStates.set(state, {
      provider: providerName,
      state,
      codeVerifier,
      createdAt: Date.now()
    });

    const authorizeUrl = provider.getAuthorizeUrl({
      state,
      codeChallenge: codeVerifier ? generateCodeChallenge(codeVerifier) : undefined,
      redirectUri: `${this.baseUrl()}${provider.callbackPath}`
    });
    this.redirect(res, authorizeUrl);
  }

  private async handleCallback(
    providerName: 'x' | 'threads',
    url: URL,
    res: http.ServerResponse
  ): Promise<void> {
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');
    if (error) {
      this.respondHtml(
        res,
        400,
        renderResultPage(
          `${providerName.toUpperCase()} authorization failed`,
          errorDescription || error,
          this.baseUrl()
        )
      );
      return;
    }

    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    logger.info(
      {
        provider: providerName,
        fullUrl: url.toString(),
        hasState: !!state,
        hasCode: !!code,
        params: Object.fromEntries(url.searchParams.entries())
      },
      'OAuth callback received'
    );
    if (!state || !code) {
      this.respondHtml(
        res,
        400,
        renderResultPage(
          'Invalid callback',
          `Missing state or code in OAuth callback. Full URL received: ${url.toString()}`,
          this.baseUrl()
        )
      );
      return;
    }

    const pending = this.pendingStates.get(state);
    if (!pending || pending.provider !== providerName) {
      this.respondHtml(
        res,
        400,
        renderResultPage('Invalid state', 'OAuth state verification failed.', this.baseUrl())
      );
      return;
    }
    this.pendingStates.delete(state);

    const record = await this.providers[providerName].exchangeCode({
      code,
      redirectUri: `${this.baseUrl()}${this.providers[providerName].callbackPath}`,
      codeVerifier: pending.codeVerifier
    });
    await this.tokenStore.saveProviderToken(record);

    this.respondHtml(
      res,
      200,
      renderResultPage(
        `${providerName.toUpperCase()} connected`,
        `Stored an encrypted token for ${record.username || record.displayName || providerName}.`,
        this.baseUrl()
      )
    );
  }

  private async handleApproveRun(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const form = await this.readForm(req);
    const runId = form.get('runId') || '';
    await this.approveRun(runId);
    this.redirect(res, `/runs/${encodeURIComponent(runId)}`);
  }

  private async handleRunDetail(runId: string, res: http.ServerResponse): Promise<void> {
    if (!isSafeRunId(runId)) {
      this.respondHtml(
        res,
        400,
        renderResultPage('Invalid run id', 'The run identifier is invalid.', this.baseUrl())
      );
      return;
    }

    const entry = await this.loadRunEntry(runId);
    if (!entry) {
      this.respondHtml(
        res,
        404,
        renderResultPage('Run not found', `No run was found for ${runId}.`, this.baseUrl())
      );
      return;
    }

    this.respondHtml(res, 200, await this.getRunDetailHtml(runId));
  }

  private async resumeApprovedRun(runId: string): Promise<void> {
    try {
      const runner = this.runnerFactory!();
      const result = await runner.execute({
        runId,
        resume: true,
        approve: true
      });

      this.approvalJobs.set(runId, {
        runId,
        status: result.status === 'succeeded' ? 'succeeded' : 'failed',
        startedAt: this.approvalJobs.get(runId)?.startedAt || new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        message:
          result.status === 'succeeded'
            ? 'Run resumed and completed successfully.'
            : result.reason || `Run resumed but ended in ${result.status}.`
      });
    } catch (error: any) {
      this.approvalJobs.set(runId, {
        runId,
        status: 'failed',
        startedAt: this.approvalJobs.get(runId)?.startedAt || new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        message: error.message
      });
    }
  }

  private async loadRunEntries(): Promise<RunConsoleEntry[]> {
    const states = await this.workspace.listRunStates();
    const entries = await Promise.all(
      states.map((state) => this.buildRunEntry(state.runId, state))
    );
    return entries;
  }

  private async loadRunEntry(runId: string): Promise<RunConsoleEntry | null> {
    try {
      const state = await this.workspace.loadRunState(runId);
      return await this.buildRunEntry(runId, state);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private async buildRunEntry(
    runId: string,
    state: Awaited<ReturnType<HarnessWorkspace['loadRunState']>>
  ): Promise<RunConsoleEntry> {
    const draft = state.latestArtifacts.draft
      ? await this.safeReadArtifact<ContentDraft>(
          runId,
          state.latestArtifacts.draft,
          ContentDraftSchema
        )
      : null;
    const approval = state.latestArtifacts.approval
      ? await this.safeReadArtifact<ApprovalRequest>(
          runId,
          state.latestArtifacts.approval,
          ApprovalRequestSchema
        )
      : null;
    const evaluation = state.latestArtifacts.evaluation
      ? await this.safeReadArtifact<EvaluationReport>(
          runId,
          state.latestArtifacts.evaluation,
          EvaluationReportSchema
        )
      : null;
    const publishReport = state.latestArtifacts.publishing
      ? await this.safeReadArtifact<PublishReport>(
          runId,
          state.latestArtifacts.publishing,
          PublishReportSchema
        )
      : null;
    const blockingStep = state.steps.find(
      (step) => step.status === 'failed' || step.status === 'blocked'
    );

    return {
      runId,
      stateStatus: state.status,
      currentStep: state.currentStep,
      updatedAt: state.updatedAt,
      startedAt: state.startedAt,
      runDirectory: this.workspace.getRunDir(runId),
      topic: draft?.topic,
      approvalStatus: approval?.status,
      requestedAt: approval?.requestedAt,
      approvedAt: approval?.approvedAt,
      evaluationSummary: evaluation?.summary,
      evaluationPassed: evaluation?.passed,
      previews:
        draft?.versions.map((version) => ({
          platform: version.platform,
          content: version.content
        })) || [],
      receipts:
        publishReport?.receipts.map((receipt) => ({
          platform: receipt.platform,
          success: receipt.success,
          publishedAt: receipt.publishedAt,
          attempts: receipt.attempts,
          url: receipt.url
        })) || [],
      lastError: blockingStep?.lastError
    };
  }

  private async safeReadArtifact<T>(
    runId: string,
    artifactPath: string,
    schema: z.ZodType<T>
  ): Promise<T | null> {
    try {
      return await this.workspace.readArtifact(runId, artifactPath, schema);
    } catch {
      return null;
    }
  }

  private prunePendingStates(): void {
    const threshold = Date.now() - 15 * 60 * 1000;
    for (const [state, pending] of this.pendingStates.entries()) {
      if (pending.createdAt < threshold) {
        this.pendingStates.delete(state);
      }
    }
  }

  private async readForm(req: http.IncomingMessage): Promise<URLSearchParams> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  }

  private redirect(res: http.ServerResponse, location: string): void {
    res.statusCode = 302;
    res.setHeader('Location', location);
    res.end();
  }

  private respondHtml(res: http.ServerResponse, statusCode: number, html: string): void {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  }

  private respondJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

function renderIndexPage(args: {
  baseUrl: string;
  statuses: Array<{
    provider: 'x' | 'threads';
    connected: boolean;
    username?: string;
    displayName?: string;
    expiresAt?: string;
  }>;
  xConfigured: boolean;
  threadsConfigured: boolean;
  pendingApprovals: RunConsoleEntry[];
  recentRuns: RunConsoleEntry[];
  jobs: ApprovalJobState[];
  publishingEnabled: boolean;
}): string {
  const xStatus = args.statuses.find((status) => status.provider === 'x');
  const threadsStatus = args.statuses.find((status) => status.provider === 'threads');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TrumanWrld Control Console</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f1e7;
      --panel: rgba(255,255,255,0.84);
      --ink: #1c1a17;
      --muted: #6b6359;
      --line: rgba(28,26,23,0.12);
      --accent: #0f766e;
      --danger: #9a3412;
      --warning: #b45309;
    }
    body {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
      background:
        radial-gradient(circle at top left, rgba(15,118,110,0.15), transparent 32%),
        radial-gradient(circle at top right, rgba(180,83,9,0.14), transparent 28%),
        linear-gradient(180deg, #f8f4ec, var(--bg));
      color: var(--ink);
      min-height: 100vh;
    }
    .wrap {
      max-width: 980px;
      margin: 0 auto;
      padding: 40px 24px 72px;
    }
    .hero, .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 28px;
      box-shadow: 0 20px 50px rgba(28,26,23,0.08);
      backdrop-filter: blur(8px);
    }
    .panel {
      margin-top: 18px;
    }
    h1, h2, h3 {
      margin: 0;
    }
    h1 {
      font-size: 38px;
      line-height: 1.05;
      margin-bottom: 10px;
    }
    h2 {
      font-size: 26px;
      margin-bottom: 14px;
    }
    h3 {
      font-size: 20px;
      margin-bottom: 8px;
    }
    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.6;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 18px;
      margin-top: 22px;
    }
    .stack {
      display: grid;
      gap: 16px;
    }
    .card {
      background: rgba(255,255,255,0.92);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 22px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 12px;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--warning);
    }
    .dot.ok {
      background: var(--accent);
    }
    .dot.fail {
      background: var(--danger);
    }
    .actions {
      display: flex;
      gap: 12px;
      margin-top: 18px;
      flex-wrap: wrap;
      align-items: center;
    }
    a.button, button.button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 132px;
      border-radius: 999px;
      padding: 12px 18px;
      text-decoration: none;
      border: 1px solid var(--line);
      color: var(--ink);
      background: white;
      font-weight: 700;
      cursor: pointer;
      font: inherit;
    }
    a.button.primary, button.button.primary {
      background: var(--ink);
      color: white;
      border-color: var(--ink);
    }
    a.button.danger {
      color: var(--danger);
    }
    form {
      margin: 0;
    }
    .meta {
      margin-top: 24px;
      font-size: 14px;
      color: var(--muted);
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 8px 12px;
      font-size: 13px;
      margin-top: 14px;
      color: var(--muted);
      background: rgba(255,255,255,0.7);
    }
    .subtle {
      color: var(--muted);
      font-size: 14px;
    }
    code, pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    code {
      background: rgba(28,26,23,0.06);
      padding: 2px 6px;
      border-radius: 8px;
    }
    pre {
      margin: 10px 0 0;
      white-space: pre-wrap;
      background: rgba(28,26,23,0.04);
      border-radius: 16px;
      padding: 14px;
      line-height: 1.5;
      font-size: 14px;
    }
    .preview-grid {
      display: grid;
      gap: 12px;
      margin-top: 12px;
    }
    .job {
      border-left: 4px solid var(--accent);
      padding-left: 14px;
      margin-top: 10px;
    }
    .job.fail {
      border-color: var(--danger);
    }
    .empty {
      border: 1px dashed var(--line);
      border-radius: 18px;
      padding: 18px;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Local Control Console</h1>
      <p>This page keeps account linking and human approval on one local surface. Login, 2FA, and consent only happen on official provider pages. Publishing can only proceed after a human approves a waiting run.</p>
      <div class="pill"><span class="dot ${args.publishingEnabled ? 'ok' : ''}"></span>${args.publishingEnabled ? 'Real publishing enabled' : 'Real publishing disabled, mock publish only'}</div>
      <div class="grid">
        ${renderProviderCard('X', xStatus, args.xConfigured, '/auth/x/start', '/auth/x/disconnect')}
        ${renderProviderCard('Threads', threadsStatus, args.threadsConfigured, '/auth/threads/start', '/auth/threads/disconnect')}
      </div>
      <div class="meta">
        Base URL: <code>${escapeHtml(args.baseUrl)}</code><br />
        Configure provider callbacks to <code>${escapeHtml(args.baseUrl)}/auth/x/callback</code> and <code>${escapeHtml(args.baseUrl)}/auth/threads/callback</code>.
      </div>
    </section>

    <section class="panel">
      <h2>Approval Queue</h2>
      <p>Any run that reaches the approval step stops here until you explicitly resume it. The agent never self-approves publishing.</p>
      ${args.jobs.length > 0 ? `<div class="stack" style="margin-top:18px">${args.jobs.map(renderJobSummary).join('')}</div>` : ''}
      <div class="stack" style="margin-top:18px">
        ${
          args.pendingApprovals.length > 0
            ? args.pendingApprovals.map(renderPendingApprovalCard).join('')
            : '<div class="empty">No runs are currently waiting for approval.</div>'
        }
      </div>
    </section>

    <section class="panel">
      <h2>Recent Runs</h2>
      <p>Completed and failed runs stay visible here for auditability, publish receipt review, and postmortem debugging.</p>
      <div class="stack" style="margin-top:18px">
        ${
          args.recentRuns.length > 0
            ? args.recentRuns.map(renderRecentRunCard).join('')
            : '<div class="empty">No completed or failed runs have been recorded yet.</div>'
        }
      </div>
    </section>
  </div>
</body>
</html>`;
}

function renderProviderCard(
  label: string,
  status:
    | {
        connected: boolean;
        username?: string;
        displayName?: string;
        expiresAt?: string;
      }
    | undefined,
  configured: boolean,
  connectHref: string,
  disconnectHref: string
): string {
  const connected = Boolean(status?.connected);
  const identity =
    status?.username || status?.displayName || (connected ? 'Connected account' : 'Not connected');
  const expiry = status?.expiresAt
    ? `Token expires: ${formatDate(status.expiresAt)}`
    : 'No token stored.';
  return `<article class="card">
    <div class="status"><span class="dot ${connected ? 'ok' : ''}"></span>${connected ? 'Connected' : configured ? 'Ready to connect' : 'Missing config'}</div>
    <h3>${escapeHtml(label)}</h3>
    <p>${configured ? escapeHtml(identity) : 'Missing required app credentials in your local .env file.'}</p>
    <p style="margin-top:10px">${configured ? escapeHtml(expiry) : 'Set the provider client id/secret first, then reload this page.'}</p>
    <div class="actions">
      <a class="button primary" href="${configured ? connectHref : '#'}"${configured ? '' : ' aria-disabled="true"'}>Connect ${escapeHtml(label)}</a>
      ${connected ? `<a class="button danger" href="${disconnectHref}">Disconnect</a>` : ''}
    </div>
  </article>`;
}

function renderPendingApprovalCard(entry: RunConsoleEntry): string {
  return `<article class="card">
    <div class="status"><span class="dot"></span>Awaiting approval</div>
    <h3>${escapeHtml(entry.topic || entry.runId)}</h3>
    <p class="subtle">Run <code>${escapeHtml(entry.runId)}</code> updated ${escapeHtml(formatDate(entry.updatedAt))}</p>
    <p style="margin-top:10px">${escapeHtml(entry.evaluationSummary || 'Evaluator completed and the draft package is waiting for approval.')}</p>
    <div class="preview-grid">
      ${entry.previews.map((preview) => `<div><div class="subtle">${escapeHtml(preview.platform)}</div><pre>${escapeHtml(summarize(preview.content, 260))}</pre></div>`).join('')}
    </div>
    <div class="actions">
      <a class="button" href="/runs/${encodeURIComponent(entry.runId)}">Review Run</a>
      <form method="post" action="/approval/approve">
        <input type="hidden" name="runId" value="${escapeHtml(entry.runId)}" />
        <button class="button primary" type="submit">Approve & Resume</button>
      </form>
    </div>
  </article>`;
}

function renderRecentRunCard(entry: RunConsoleEntry): string {
  const statusClass =
    entry.stateStatus === 'succeeded' ? 'ok' : entry.stateStatus === 'failed' ? 'fail' : '';
  const statusLabel = entry.stateStatus.replace(/_/g, ' ');
  return `<article class="card">
    <div class="status"><span class="dot ${statusClass}"></span>${escapeHtml(statusLabel)}</div>
    <h3>${escapeHtml(entry.topic || entry.runId)}</h3>
    <p class="subtle">Run <code>${escapeHtml(entry.runId)}</code> updated ${escapeHtml(formatDate(entry.updatedAt))}</p>
    <p style="margin-top:10px">${escapeHtml(entry.lastError || entry.evaluationSummary || 'Run completed without extra notes.')}</p>
    <div class="actions">
      <a class="button" href="/runs/${encodeURIComponent(entry.runId)}">Open Run</a>
    </div>
  </article>`;
}

function renderJobSummary(job: ApprovalJobState): string {
  return `<div class="job ${job.status === 'failed' ? 'fail' : ''}">
    <div class="subtle">Approval job for <code>${escapeHtml(job.runId)}</code></div>
    <div>${escapeHtml(job.message || job.status)}</div>
    <div class="subtle">${escapeHtml(formatDate(job.finishedAt || job.startedAt))}</div>
  </div>`;
}

function renderRunDetailPage(args: {
  baseUrl: string;
  entry: RunConsoleEntry;
  job?: ApprovalJobState;
}): string {
  const { entry, job } = args;
  const statusClass =
    entry.stateStatus === 'succeeded' ? 'ok' : entry.stateStatus === 'failed' ? 'fail' : '';
  const canApprove = entry.stateStatus === 'awaiting_approval' && job?.status !== 'running';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Run ${escapeHtml(entry.runId)}</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      background: linear-gradient(180deg, #f9f5ed, #efe5d4);
      color: #221f1b;
      font-family: Georgia, serif;
    }
    .wrap {
      max-width: 920px;
      margin: 0 auto;
      padding: 36px 24px 72px;
    }
    .card {
      background: rgba(255,255,255,0.9);
      border: 1px solid rgba(34,31,27,0.12);
      border-radius: 24px;
      padding: 28px;
      box-shadow: 0 18px 40px rgba(34,31,27,0.08);
      margin-top: 18px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #6b6359;
      margin-bottom: 12px;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: #b45309;
    }
    .dot.ok {
      background: #0f766e;
    }
    .dot.fail {
      background: #9a3412;
    }
    a.button, button.button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 132px;
      border-radius: 999px;
      padding: 12px 18px;
      text-decoration: none;
      border: 1px solid rgba(34,31,27,0.12);
      color: #221f1b;
      background: white;
      font-weight: 700;
      cursor: pointer;
      font: inherit;
    }
    a.button.primary, button.button.primary {
      background: #221f1b;
      color: white;
      border-color: #221f1b;
    }
    form {
      margin: 0;
    }
    .actions {
      display: flex;
      gap: 12px;
      margin-top: 20px;
      flex-wrap: wrap;
      align-items: center;
    }
    pre, code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    code {
      background: rgba(34,31,27,0.06);
      padding: 2px 6px;
      border-radius: 8px;
    }
    pre {
      white-space: pre-wrap;
      background: rgba(34,31,27,0.04);
      border-radius: 16px;
      padding: 14px;
      line-height: 1.5;
      font-size: 14px;
      margin: 10px 0 0;
    }
    .grid {
      display: grid;
      gap: 16px;
    }
    .subtle {
      color: #6b6359;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="actions" style="margin-top:0">
      <a class="button" href="${escapeHtml(args.baseUrl)}">Back to Console</a>
      ${canApprove ? `<form method="post" action="/approval/approve"><input type="hidden" name="runId" value="${escapeHtml(entry.runId)}" /><button class="button primary" type="submit">Approve & Resume</button></form>` : ''}
    </div>

    <section class="card">
      <div class="status"><span class="dot ${statusClass}"></span>${escapeHtml(entry.stateStatus.replace(/_/g, ' '))}</div>
      <h1>${escapeHtml(entry.topic || entry.runId)}</h1>
      <p class="subtle">Run <code>${escapeHtml(entry.runId)}</code></p>
      <p class="subtle" style="margin-top:8px">Started ${escapeHtml(formatDate(entry.startedAt))} · Updated ${escapeHtml(formatDate(entry.updatedAt))} · Step ${escapeHtml(entry.currentStep || 'n/a')}</p>
      <p class="subtle" style="margin-top:8px">Directory <code>${escapeHtml(entry.runDirectory)}</code></p>
      ${job ? `<div class="card" style="margin-top:18px"><div class="status"><span class="dot ${job.status === 'succeeded' ? 'ok' : job.status === 'failed' ? 'fail' : ''}"></span>Approval job ${escapeHtml(job.status)}</div><p>${escapeHtml(job.message || 'No details available.')}</p></div>` : ''}
      ${entry.lastError ? `<p style="margin-top:14px;color:#9a3412">${escapeHtml(entry.lastError)}</p>` : ''}
      ${entry.evaluationSummary ? `<p style="margin-top:14px">${escapeHtml(entry.evaluationSummary)}</p>` : ''}
    </section>

    <section class="card">
      <h2>Draft Package</h2>
      <div class="grid">
        ${
          entry.previews.length > 0
            ? entry.previews
                .map(
                  (preview) =>
                    `<div><div class="subtle">${escapeHtml(preview.platform)}</div><pre>${escapeHtml(preview.content)}</pre></div>`
                )
                .join('')
            : '<p class="subtle">No draft artifact is currently available.</p>'
        }
      </div>
    </section>

    <section class="card">
      <h2>Publish Receipts</h2>
      <div class="grid">
        ${
          entry.receipts.length > 0
            ? entry.receipts
                .map(
                  (receipt) =>
                    `<div><div class="status"><span class="dot ${receipt.success ? 'ok' : 'fail'}"></span>${escapeHtml(receipt.platform)}</div><p class="subtle">Published ${escapeHtml(formatDate(receipt.publishedAt))}${receipt.attempts ? ` · Attempts ${receipt.attempts}` : ''}</p>${receipt.url ? `<p style="margin-top:10px"><a href="${escapeHtml(receipt.url)}">${escapeHtml(receipt.url)}</a></p>` : ''}</div>`
                )
                .join('')
            : '<p class="subtle">This run has not published yet.</p>'
        }
      </div>
    </section>
  </div>
</body>
</html>`;
}

function renderResultPage(title: string, message: string, baseUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: linear-gradient(180deg, #f9f5ed, #efe5d4);
      color: #221f1b;
      font-family: Georgia, serif;
      padding: 24px;
    }
    .card {
      max-width: 640px;
      background: rgba(255,255,255,0.9);
      border: 1px solid rgba(34,31,27,0.12);
      border-radius: 24px;
      padding: 28px;
      box-shadow: 0 18px 40px rgba(34,31,27,0.08);
    }
    a {
      display: inline-block;
      margin-top: 16px;
      color: #0f766e;
      font-weight: 700;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="${escapeHtml(baseUrl)}">Return to local control console</a>
  </div>
</body>
</html>`;
}

function extractRunId(pathname: string): string | null {
  const match = /^\/runs\/([^/]+)$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function isSafeRunId(runId: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(runId);
}

function summarize(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function formatDate(value?: string): string {
  if (!value) {
    return 'n/a';
  }

  return new Date(value).toLocaleString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isEnabled(name: string): boolean {
  return !['', '0', 'false', 'off', 'no'].includes(getEnv(name).trim().toLowerCase());
}
