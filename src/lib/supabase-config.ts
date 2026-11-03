/**
 * Supabase connection settings, read from EXPO_PUBLIC_* environment variables
 * (.env.local in development, EAS environment variables for builds). See docs/supabase-setup.md.
 */
export type SupabaseConfig = { url: string; publishableKey: string };

export type SupabaseConfigResult =
  { ok: true; config: SupabaseConfig } | { ok: false; problems: string[] };

export function readSupabaseConfig(env: Record<string, string | undefined>): SupabaseConfigResult {
  const problems: string[] = [];
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url) {
    problems.push('EXPO_PUBLIC_SUPABASE_URL is not set.');
  } else if (!/^https:\/\/[^/]+$/.test(url.replace(/\/+$/, ''))) {
    problems.push(
      'EXPO_PUBLIC_SUPABASE_URL should look like https://<project-ref>.supabase.co (no path).',
    );
  }

  if (!publishableKey) {
    problems.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set.');
  } else if (publishableKey.startsWith('sb_secret_')) {
    problems.push(
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is a secret key. Use the publishable key; secret keys must never ship in the app.',
    );
  }

  if (problems.length > 0 || !url || !publishableKey) {
    return { ok: false, problems };
  }
  return { ok: true, config: { url: url.replace(/\/+$/, ''), publishableKey } };
}
