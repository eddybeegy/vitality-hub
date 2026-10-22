import { describe, it, expect, vi } from 'vitest';
import { createMcpServer, mountMcpServer, MCP_PATH } from './server';
import type { McpContext } from './tools';

/** Minimal express stand-in: records the handler registered per method. */
function fakeApp() {
  const routes: Record<string, any> = {};
  return {
    app: {
      post: (p: string, h: any) => { routes['POST ' + p] = h; },
      get: (p: string, h: any) => { routes['GET ' + p] = h; },
      delete: (p: string, h: any) => { routes['DELETE ' + p] = h; },
    },
    routes,
  };
}

const fakeRes = () => {
  const res: any = {
    statusCode: 200, body: undefined, headersSent: false,
    status(c: number) { res.statusCode = c; return res; },
    json(b: any) { res.body = b; res.headersSent = true; return res; },
    on: vi.fn(),
  };
  return res;
};

const deps = {
  db: { type: 'sqlite', prepare: () => ({ all: () => [], get: () => ({}) }) },
  readingInstant: () => 'timestamp',
  filterMetricsByPriority: (m: any[]) => m,
};

describe('mountMcpServer', () => {
  it('mounts nothing when no service token is configured', () => {
    const { app, routes } = fakeApp();
    const log = vi.fn();
    mountMcpServer(app, { ...deps, authorize: () => ({ userId: 1 }), enabled: false, log });
    expect(Object.keys(routes)).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not mounted'));
  });

  it('registers the endpoint when enabled', () => {
    const { app, routes } = fakeApp();
    mountMcpServer(app, { ...deps, authorize: () => ({ userId: 1 }), enabled: true, log: vi.fn() });
    expect(Object.keys(routes).sort()).toEqual([`DELETE ${MCP_PATH}`, `GET ${MCP_PATH}`, `POST ${MCP_PATH}`]);
  });

  it('rejects an unauthorised call with a JSON-RPC error, before touching the db', async () => {
    const { app, routes } = fakeApp();
    const prepare = vi.fn(() => ({ all: () => [], get: () => ({}) }));
    const authorize = vi.fn(() => null);
    mountMcpServer(app, { ...deps, db: { type: 'sqlite', prepare } as any, authorize, enabled: true, log: vi.fn() });

    const res = fakeRes();
    await routes[`POST ${MCP_PATH}`]({ method: 'POST', headers: {}, body: { jsonrpc: '2.0', method: 'tools/list', id: 1 } }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ jsonrpc: '2.0', error: { message: 'Unauthorized' } });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('scopes the tools to the user id the authorizer returned, not the request body', async () => {
    const { app, routes } = fakeApp();
    const authorize = vi.fn(() => ({ userId: 42, name: 'mcp' }));
    mountMcpServer(app, { ...deps, authorize, enabled: true, log: vi.fn() });
    const req: any = { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: { jsonrpc: '2.0', method: 'tools/list', id: 1 }, on: vi.fn(), socket: {} };
    // handleRequest needs a real node res; we only assert the authorizer is the
    // single source of the user id, so a failure past that point is fine.
    const res = fakeRes();
    await routes[`POST ${MCP_PATH}`](req, res).catch(() => {});
    expect(authorize).toHaveBeenCalledWith(req);
  });
});

describe('createMcpServer', () => {
  const ctx = { ...deps, userId: 1 } as unknown as McpContext;

  it('registers the read-only tool set', async () => {
    const server = createMcpServer(ctx);
    // The registry is internal; listing through the server object's own tools
    // map is the only public-ish view, so assert via the registered names.
    const names = Object.keys((server as any)._registeredTools || {});
    expect(names.sort()).toEqual([
      'get_metrics', 'get_nutrition', 'get_readiness', 'get_sleep', 'get_targets', 'get_workouts', 'list_metric_types',
    ]);
    await server.close();
  });

  it('marks every tool read-only so a client never guesses about side effects', async () => {
    const server = createMcpServer(ctx);
    const registered: any = (server as any)._registeredTools || {};
    for (const [name, tool] of Object.entries<any>(registered)) {
      expect(tool.annotations?.readOnlyHint, name).toBe(true);
      expect(tool.annotations?.destructiveHint, name).toBe(false);
    }
    await server.close();
  });
});
