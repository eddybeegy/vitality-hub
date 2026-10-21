import { describe, expect, it } from 'vitest';
import { jsonParseErrorResponse } from './bodyParseError';

// The error body-parser hands to error middleware: a SyntaxError from JSON.parse with
// `type`, `status` and the raw `body` attached.
function parseFailure(raw: string) {
  try {
    JSON.parse(raw);
  } catch (e: any) {
    return Object.assign(e, { type: 'entity.parse.failed', status: 400, statusCode: 400, body: raw });
  }
  throw new Error(`fixture parsed: ${raw}`);
}

describe('jsonParseErrorResponse', () => {
  it('reports where parsing stopped', () => {
    expect(jsonParseErrorResponse(parseFailure('{"a":1,}'))).toEqual({
      error: 'Malformed JSON in request body at position 7',
      position: 7,
    });
    expect(jsonParseErrorResponse(parseFailure('[1,2'))?.position).toBe(4);
  });

  it('says so when the body was truncated', () => {
    expect(jsonParseErrorResponse(parseFailure('{"level":"info","message":'))).toEqual({
      error: 'Malformed JSON in request body: unexpected end of input',
    });
  });

  it('never echoes the raw body back', () => {
    const r = jsonParseErrorResponse(parseFailure('{"password":"hunter2",'));
    expect(JSON.stringify(r)).not.toContain('hunter2');
  });

  it.each([
    ['a generic error', new Error('boom')],
    ['a SyntaxError without the body-parser type', new SyntaxError('Unexpected token')],
    ['entity.too.large', Object.assign(new Error('too big'), { type: 'entity.too.large', status: 413 })],
    ['request.aborted', Object.assign(new Error('aborted'), { type: 'request.aborted', status: 400 })],
    ['null', null],
    ['a string', 'entity.parse.failed'],
  ])('leaves %s alone', (_label, err) => {
    expect(jsonParseErrorResponse(err)).toBeNull();
  });
});
