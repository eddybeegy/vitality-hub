/**
 * MCP (Model Context Protocol) server for vitality-hub.
 *
 * Mounted inside the existing Express app at POST /mcp rather than run as its
 * own process: the tools need the same `db` handle, the same source-priority
 * resolver and the same timestamp conventions as the API, and a second process
 * would be a second copy of all three to keep in step.
 *
 * Auth. /mcp sits OUTSIDE the `app.use('/api', requireAuth)` mount, so it does
 * its own check -- with the same machinery, not a looser one. The caller must
 * present a service token whose allowlist names `POST /mcp` (the `mcp` entry in
 * server.ts's SERVICE_TOKENS, keyed off MCP_SERVICE_TOKEN/MCP_SERVICE_USER_ID).
 * It is a separate token from the coach's on purpose: the coach may POST
 * targets and insights, this one may only read, and one token holding the union
 * of two scopes is how the 2026 /api/settings leak got its reach. A browser
 * session cookie is deliberately NOT accepted here -- nothing in the UI speaks
 * MCP, so accepting it would only add CSRF surface.
 *
 * Statelessness. A fresh McpServer and transport are built per request
 * (`sessionIdGenerator: undefined`), so there is no session map to leak between
 * callers and no server-initiated streaming. Agents call tools and get JSON
 * back; nothing here needs a long-lived stream, and a per-request instance
 * cannot be left holding another user's context.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { tools, MAX_DAYS, type McpContext, type McpDeps } from './tools.js';

export const MCP_PATH = '/mcp';
export const MCP_SERVER_NAME = 'vitality-hub';

const daysArg = (fallback: number) =>
  z.number().int().min(1).max(MAX_DAYS).optional().describe(`Days of history to return (default ${fallback}, max ${MAX_DAYS}).`);

/** JSON-RPC shaped error, so a client sees a protocol error rather than HTML. */
const rpcError = (res: any, status: number, message: string) =>
  res.status(status).json({ jsonrpc: '2.0', error: { code: status === 401 ? -32001 : -32000, message }, id: null });

export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: '1.0.0' },
    { instructions: 'Read-only access to one vitality-hub account: metrics, workouts, nutrition, sleep, readiness, targets and the weekly/monthly digest. Call list_metric_types first to see which metric types this account actually holds.' }
  );

  // Every tool is read-only; say so in the annotations so a client never has to
  // guess whether calling one has a side effect.
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const reply = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 1) }] });

  server.registerTool('list_metric_types', {
    title: 'List metric types',
    description: 'Every metric type stored for this account, with row counts, the sources that wrote it and its first/last reading. Use this to find valid `types` values before calling get_metrics.',
    annotations: readOnly,
  }, async () => reply(await tools.listMetricTypes(ctx)));

  server.registerTool('get_metrics', {
    title: 'Get daily metrics',
    description: 'Daily values for the named metric types, newest day first. Daily totals (steps, energy, nutrients) are summed; readings (weight, resting HR, HRV) are averaged. Where two sources cover the same day, the account\'s source priority picks one. Omit `types` to get every type, which can be a large response.',
    inputSchema: {
      types: z.array(z.string()).max(40).optional().describe('Metric types to return, e.g. ["weight","resting_heart_rate"]. Omit for all.'),
      days: daysArg(30),
    },
    annotations: readOnly,
  }, async (args) => reply(await tools.getMetrics(ctx, args)));

  server.registerTool('get_nutrition', {
    title: 'Get nutrition',
    description: 'Daily nutrition totals (calories, macros, micronutrients) for days with logged food. Days with nothing logged are omitted rather than returned as zero.',
    inputSchema: { days: daysArg(14) },
    annotations: readOnly,
  }, async (args) => reply(await tools.getNutrition(ctx, args)));

  server.registerTool('get_workouts', {
    title: 'Get workouts',
    description: 'Workout sessions newest first, with duration, volume and the exercises performed. Set include_sets for per-set weight/reps, which is much larger.',
    inputSchema: {
      days: daysArg(30),
      include_sets: z.boolean().optional().describe('Include every set of every exercise (default false).'),
    },
    annotations: readOnly,
  }, async (args) => reply(await tools.getWorkouts(ctx, args)));

  server.registerTool('get_sleep', {
    title: 'Get sleep',
    description: 'Nightly sleep duration and stages in hours, plus a bedtime/wake-time consistency summary (averages, standard deviations, regularity, social jet lag). The summary is null until the window holds 5 paired nights.',
    inputSchema: { days: daysArg(28) },
    annotations: readOnly,
  }, async (args) => reply(await tools.getSleep(ctx, args)));

  server.registerTool('get_readiness', {
    title: 'Get readiness scores',
    description: 'Stored daily readiness scores with their component breakdown. Only finished days are stored, so today appears after it closes.',
    inputSchema: { days: daysArg(14) },
    annotations: readOnly,
  }, async (args) => reply(await tools.getReadiness(ctx, args)));

  server.registerTool('get_digest', {
    title: 'Get digest',
    description: 'A weekly or monthly digest: training, sleep, intake, body and activity for the trailing period against the period before it. Each line carries both numbers, the percent change and a ready-made sentence; `text` is the whole digest as plain text, and `headlines` the few lines worth leading with.',
    inputSchema: {
      period: z.enum(['week', 'month']).optional().describe('week = the trailing 7 days, month = the trailing 30 (default week).'),
    },
    annotations: readOnly,
  }, async (args) => reply(await tools.getDigest(ctx, args)));

  server.registerTool('get_targets', {
    title: 'Get targets',
    description: 'The account\'s configured targets (calories, protein, steps, sleep and so on) to compare actuals against.',
    annotations: readOnly,
  }, async () => reply(await tools.getTargets(ctx)));

  return server;
}

export interface MountMcpOptions extends McpDeps {
  /** Returns the user id the caller is authorised for, or null to reject. */
  authorize: (req: any) => { userId: number; name?: string } | null;
  /** Mount nothing and log why when false (no token configured). */
  enabled: boolean;
  log?: (message: string) => void;
}

/**
 * Register the MCP endpoint on `app`. Call this before `app.use('/api', ...)`
 * ordering matters only for the body parser, which is already app-level.
 */
export function mountMcpServer(app: any, opts: MountMcpOptions): void {
  const log = opts.log || ((m: string) => console.log(m));
  if (!opts.enabled) {
    log('[mcp] not mounted: MCP_SERVICE_TOKEN/MCP_SERVICE_USER_ID not set');
    return;
  }

  const handle = async (req: any, res: any) => {
    const caller = opts.authorize(req);
    if (!caller) return rpcError(res, 401, 'Unauthorized');

    const ctx: McpContext = {
      db: opts.db,
      readingInstant: opts.readingInstant,
      filterMetricsByPriority: opts.filterMetricsByPriority,
      userId: caller.userId,
    };
    const server = createMcpServer(ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });

    // Both are per-request, so both must be released whichever way the response
    // ends -- a client that hangs up mid-call would otherwise leak a transport.
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e: any) {
      log(`[mcp] request failed: ${e?.message || e}`);
      if (!res.headersSent) rpcError(res, 500, 'Internal server error');
    }
  };

  app.post(MCP_PATH, handle);
  // Stateless mode has no standalone stream and no session to delete; the
  // transport answers both with a proper JSON-RPC error rather than a 404.
  app.get(MCP_PATH, handle);
  app.delete(MCP_PATH, handle);
  log(`[mcp] mounted at POST ${MCP_PATH} (read-only, service token required)`);
}
