// Item 58 follow-up: one place that checks `response.ok` before a body is used.
//
// Several call sites did `await (await fetch(url)).json()` and used whatever came back.
// A 5xx's `{"error": ...}` was then treated as data (fetchSettings merged it into the
// settings object; handleChatSubmit sent the chat with no data at all), and an HTML
// body (a 502 from the proxy mid-deploy, or item 51's SPA catch-all) surfaced as
// "Unexpected token '<'" far from the cause. These helpers throw an ApiError instead,
// carrying the status and the server's own `error` message when it sent one, so the
// caller's existing try/catch handles it.

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function errorFor(res: Response, url: string): Promise<ApiError> {
  let detail = '';
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string') detail = `: ${body.error}`;
  } catch {
    // non-JSON error body (proxy page, index.html) -- the status says enough
  }
  return new ApiError(`${url} failed (HTTP ${res.status})${detail}`, res.status);
}

/** fetch, then throw ApiError unless the response is 2xx. For writes whose body is unused. */
export async function fetchOk(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) throw await errorFor(res, url);
  return res;
}

/** fetch and parse JSON; throws ApiError on a non-2xx status or a body that isn't JSON. */
export async function fetchJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetchOk(url, init);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(`${url} returned a non-JSON body (HTTP ${res.status})`, res.status);
  }
}

/**
 * POST /api/auth/logout, then reload. A failed logout used to reload anyway (still
 * signed in, no explanation) or, on a network error, do nothing at all; now the
 * caller is told so it can say so.
 */
export async function signOut(onError: (message: string) => void): Promise<void> {
  try {
    await fetchOk('/api/auth/logout', { method: 'POST' });
    window.location.reload();
  } catch (e) {
    console.error('Sign out failed', e);
    onError("Couldn't sign out. Check your connection and try again.");
  }
}
