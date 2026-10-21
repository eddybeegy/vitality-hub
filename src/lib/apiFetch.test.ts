import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchJson, fetchOk, ApiError } from './apiFetch';

const respond = (body: string, status: number, type = 'application/json') =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body === '' ? null : body, { status, headers: { 'Content-Type': type } }));

afterEach(() => vi.restoreAllMocks());

describe('fetchJson', () => {
  it('returns the parsed body of a 2xx JSON response', async () => {
    respond('{"theme":"dark"}', 200);
    expect(await fetchJson('/api/settings')).toEqual({ theme: 'dark' });
  });

  it("throws ApiError with the status and the server's error on a JSON 500", async () => {
    respond('{"error":"db down"}', 500);
    const err = await fetchJson('/api/settings').catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(err.message).toBe('/api/settings failed (HTTP 500): db down');
  });

  it('throws ApiError on an HTML 502 (proxy mid-deploy) rather than a JSON parse error', async () => {
    respond('<html>Bad Gateway</html>', 502, 'text/html');
    const err = await fetchJson('/api/targets').catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('/api/targets failed (HTTP 502)');
  });

  it('throws ApiError on a 200 that is not JSON (SPA catch-all, item 51)', async () => {
    respond('<!doctype html><html></html>', 200, 'text/html');
    const err = await fetchJson('/api/ai/data').catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('/api/ai/data returned a non-JSON body (HTTP 200)');
  });
});

describe('fetchOk', () => {
  it('resolves with the response on 2xx', async () => {
    respond('', 204);
    expect((await fetchOk('/api/chat-history', { method: 'POST' })).status).toBe(204);
  });

  it('throws ApiError on a non-2xx', async () => {
    respond('{"error":"nope"}', 403);
    await expect(fetchOk('/api/ai/insights', { method: 'POST' })).rejects.toMatchObject({ name: 'ApiError', status: 403 });
  });
});

describe('signOut', () => {
  it('reports a failed logout instead of reloading', async () => {
    respond('{"error":"boom"}', 500);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    const onError = vi.fn();
    const { signOut } = await import('./apiFetch');
    await signOut(onError);
    expect(reload).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Couldn't sign out"));
    vi.unstubAllGlobals();
  });

  it('reloads after a successful logout', async () => {
    respond('{"success":true}', 200);
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    const onError = vi.fn();
    const { signOut } = await import('./apiFetch');
    await signOut(onError);
    expect(reload).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
