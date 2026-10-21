import { describe, expect, it } from 'vitest';
import { buildWithingsTokenRequestParams, extractWithingsTokens } from './withings';

describe('Withings token helpers', () => {
  it('builds refresh-token request params matching the auth-code exchange style', () => {
    const params = buildWithingsTokenRequestParams('client-id', 'client-secret', 'refresh-token');

    expect(params).toEqual({
      action: 'requesttoken',
      grant_type: 'refresh_token',
      client_id: 'client-id',
      client_secret: 'client-secret',
      refresh_token: 'refresh-token',
    });
  });

  it('preserves the existing refresh token when Withings omits a replacement', () => {
    const result = extractWithingsTokens({ body: { access_token: 'new-access' } }, 'existing-refresh');

    expect(result).toEqual({ access_token: 'new-access', refresh_token: 'existing-refresh' });
  });
});
