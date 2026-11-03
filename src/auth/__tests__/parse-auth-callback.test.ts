import { parseAuthCallback } from '../parse-auth-callback';

describe('parseAuthCallback', () => {
  it('returns none for empty or unrelated URLs', () => {
    expect(parseAuthCallback(null)).toEqual({ kind: 'none' });
    expect(parseAuthCallback('dawnofworlds://map')).toEqual({ kind: 'none' });
    expect(parseAuthCallback('dawnofworlds://auth/callback?foo=bar')).toEqual({ kind: 'none' });
  });

  it('reads implicit-flow tokens from the fragment (custom scheme)', () => {
    expect(
      parseAuthCallback(
        'dawnofworlds://auth/callback#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=magiclink',
      ),
    ).toEqual({ kind: 'tokens', accessToken: 'abc', refreshToken: 'def' });
  });

  it('reads tokens from an Expo Go URL', () => {
    expect(
      parseAuthCallback(
        'exp://192.168.1.20:8081/--/auth/callback#access_token=abc&refresh_token=def',
      ),
    ).toEqual({ kind: 'tokens', accessToken: 'abc', refreshToken: 'def' });
  });

  it('reads a PKCE code from the query', () => {
    expect(parseAuthCallback('https://example.com/auth/callback?code=xyz-123')).toEqual({
      kind: 'code',
      code: 'xyz-123',
    });
  });

  it('reports errors from the query or fragment, preferring the description', () => {
    expect(
      parseAuthCallback(
        'dawnofworlds://auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      ),
    ).toEqual({ kind: 'error', message: 'Email link is invalid or has expired' });
    expect(parseAuthCallback('dawnofworlds://auth/callback?error=server_error')).toEqual({
      kind: 'error',
      message: 'server_error',
    });
  });

  it('needs both tokens', () => {
    expect(parseAuthCallback('dawnofworlds://auth/callback#access_token=abc')).toEqual({
      kind: 'none',
    });
  });
});
