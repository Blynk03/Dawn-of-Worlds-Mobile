/** Turns Supabase/Postgres errors into messages players can act on. */
const KNOWN: [RegExp, string][] = [
  [/gods_world_id_color_key/, 'Another god already uses that color.'],
  [/gods_world_name_idx/, 'Another god in this world already has that name.'],
  [/gods_world_id_user_id_key/, 'You already have a god in this world.'],
  [/row-level security|permission denied/i, "You don't have permission to do that."],
  [
    /Failed to fetch|Network request failed|NetworkError/i,
    "Couldn't reach the server. Check your connection and try again.",
  ],
];

export function friendlyError(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
  for (const [pattern, friendly] of KNOWN) {
    if (pattern.test(message)) return friendly;
  }
  // Messages raised by our own database functions are already written for players.
  return message || 'Something went wrong. Please try again.';
}
