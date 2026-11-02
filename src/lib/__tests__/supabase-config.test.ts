import { readSupabaseConfig } from '../supabase-config';

const url = 'https://abcdefghijklmnop.supabase.co';
const publishableKey = 'sb_publishable_example';

describe('readSupabaseConfig', () => {
  it('accepts a project URL and publishable key', () => {
    expect(
      readSupabaseConfig({
        EXPO_PUBLIC_SUPABASE_URL: url,
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      }),
    ).toEqual({ ok: true, config: { url, publishableKey } });
  });

  it('trims whitespace and a trailing slash', () => {
    const result = readSupabaseConfig({
      EXPO_PUBLIC_SUPABASE_URL: ` ${url}/ `,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ` ${publishableKey}\n`,
    });
    expect(result).toEqual({ ok: true, config: { url, publishableKey } });
  });

  it('reports missing values', () => {
    const result = readSupabaseConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toHaveLength(2);
  });

  it('rejects a URL with a path, such as the REST endpoint', () => {
    const result = readSupabaseConfig({
      EXPO_PUBLIC_SUPABASE_URL: `${url}/rest/v1/`,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a secret key', () => {
    const result = readSupabaseConfig({
      EXPO_PUBLIC_SUPABASE_URL: url,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_oops',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toMatch(/secret key/);
  });
});
