import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import { supabaseConfig } from '@/lib/supabase';

/** Shown instead of the app when Supabase settings are missing (e.g. no .env.local yet). */
export function ConfigMissingScreen() {
  const problems = supabaseConfig.ok ? [] : supabaseConfig.problems;
  return (
    <PlaceholderScreen
      title="Almost there"
      description="The app isn't connected to Supabase yet. Copy .env.example to .env.local, fill in the project URL and publishable key, then restart the dev server.">
      {problems.map((problem) => (
        <ThemedText key={problem} type="code">
          {problem}
        </ThemedText>
      ))}
    </PlaceholderScreen>
  );
}
