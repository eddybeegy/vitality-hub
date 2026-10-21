import { describe, it, expect } from 'vitest';
import { readChartRows, asRows } from './chartRows';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('readChartRows', () => {
  it('returns the rows of a 200 JSON array', async () => {
    const rows = [{ date: '2026-10-21', steps: 1 }];
    expect(await readChartRows(json(rows))).toEqual({ rows, error: null });
  });

  it('treats a 500 with an {error} body as an error, not as rows', async () => {
    expect(await readChartRows(json({ error: 'boom' }, 500))).toEqual({ rows: [], error: 'HTTP 500' });
  });

  it('treats a 502 with an HTML body as an error', async () => {
    const res = new Response('<html>Bad Gateway</html>', { status: 502 });
    expect(await readChartRows(res)).toEqual({ rows: [], error: 'HTTP 502' });
  });

  it('treats a 200 that is not JSON (SPA catch-all index.html) as an error', async () => {
    const res = new Response('<!doctype html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    expect(await readChartRows(res)).toEqual({ rows: [], error: 'response was not JSON' });
  });

  it('treats a 200 JSON object as an error, not as rows', async () => {
    expect(await readChartRows(json({ error: 'x' }))).toEqual({ rows: [], error: 'response was not a list of rows' });
  });
});

describe('asRows', () => {
  it('passes arrays through and turns anything else into no rows', () => {
    expect(asRows([1])).toEqual([1]);
    expect(asRows({ error: 'x' })).toEqual([]);
    expect(asRows(undefined)).toEqual([]);
    expect(asRows(null)).toEqual([]);
  });
});
