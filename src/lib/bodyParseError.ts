// Malformed JSON request bodies (sweep item 52).
//
// body-parser raises `entity.parse.failed` (status 400) when a JSON body does not parse,
// but nothing translated it, so the terminal handler turned a truncated or invalid body
// into a 500 "Internal server error" on every POST route -- a client mistake reported as
// a server fault, and logged as one. This maps that one error type, and only that one,
// to a 400 that says where parsing stopped. Every other error keeps its existing path.
//
// Pure, no Express types, so it is unit-tested directly.

export type JsonParseErrorBody = { error: string; position?: number };

/**
 * The 400 body for a body-parser JSON parse failure, or null for any other error.
 * The raw body (`err.body`) is never echoed back; only the parser's offset is.
 */
export function jsonParseErrorResponse(err: unknown): JsonParseErrorBody | null {
  if (!err || typeof err !== 'object' || (err as { type?: unknown }).type !== 'entity.parse.failed') return null;
  const message = String((err as { message?: unknown }).message ?? '');
  // V8 says "... in JSON at position 12" (plus "(line 1 column 13)" on newer Node).
  // "Unexpected end of JSON input" carries no offset: the body ended early.
  const at = /\bposition (\d+)/.exec(message);
  if (at) {
    const position = Number(at[1]);
    return { error: `Malformed JSON in request body at position ${position}`, position };
  }
  if (/end of (JSON|data)/i.test(message)) {
    return { error: 'Malformed JSON in request body: unexpected end of input' };
  }
  return { error: 'Malformed JSON in request body' };
}
