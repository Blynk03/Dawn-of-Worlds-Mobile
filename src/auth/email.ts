/** Light check that catches typos; Supabase does the real validation. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Supabase email codes are 6–10 digits (the length is a project setting; this project sends 8). */
export function looksLikeEmailCode(value: string): boolean {
  return /^\d{6,10}$/.test(value.trim());
}
