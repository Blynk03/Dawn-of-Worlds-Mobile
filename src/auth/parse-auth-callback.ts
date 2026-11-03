/**
 * Reads the result of a Supabase magic link from the URL the app was opened with.
 *
 * Supabase redirects to our `/auth/callback` route with either:
 * - `#access_token=...&refresh_token=...` (implicit flow, supabase-js default), or
 * - `?code=...` (PKCE flow), or
 * - `?error=...&error_description=...` / `#error=...` when the link is expired or invalid.
 */
export type AuthCallback =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

function parseParams(part: string): URLSearchParams {
  return new URLSearchParams(part.replace(/^[?#]/, ''));
}

export function parseAuthCallback(url: string | null | undefined): AuthCallback {
  if (!url) {
    return { kind: 'none' };
  }

  const hashIndex = url.indexOf('#');
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex + 1);
  const queryIndex = beforeHash.indexOf('?');
  const query = queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1);

  // Fragment wins over query for the same key, matching how Supabase writes implicit-flow results.
  const params = new Map<string, string>();
  for (const [key, value] of parseParams(query)) params.set(key, value);
  for (const [key, value] of parseParams(hash)) params.set(key, value);

  const error = params.get('error_description') ?? params.get('error');
  if (error) {
    return { kind: 'error', message: error.replace(/\+/g, ' ') };
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    return { kind: 'tokens', accessToken, refreshToken };
  }

  const code = params.get('code');
  if (code) {
    return { kind: 'code', code };
  }

  return { kind: 'none' };
}
