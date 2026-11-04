/**
 * Form checks for worlds and gods. They mirror the database constraints in
 * supabase/migrations so players see a clear message before saving.
 */
import { MAX_SPHERES } from './god-options';

export const WORLD_NAME_MAX = 60;
export const GOD_NAME_MAX = 30;
export const PERSONALITY_MAX = 500;

export function validateWorldName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Give your world a name.';
  if (trimmed.length > WORLD_NAME_MAX) return `Keep the name under ${WORLD_NAME_MAX} characters.`;
  return null;
}

export type GodDraft = {
  name: string;
  spheres: string[];
  personality: string;
  color: string | null;
  sigil: string | null;
};

export type GodErrors = Partial<Record<keyof GodDraft, string>>;

/** Other gods in the same world, so names and colors stay unique. */
export type OtherGods = { name: string; color: string }[];

export function validateGod(draft: GodDraft, others: OtherGods = []): GodErrors {
  const errors: GodErrors = {};
  const name = draft.name.trim();

  if (!name) errors.name = 'Your god needs a name.';
  else if (name.length > GOD_NAME_MAX)
    errors.name = `Keep the name under ${GOD_NAME_MAX} characters.`;
  else if (others.some((g) => g.name.trim().toLowerCase() === name.toLowerCase())) {
    errors.name = 'Another god in this world already has that name.';
  }

  if (draft.spheres.length === 0) errors.spheres = 'Pick at least one sphere of influence.';
  else if (draft.spheres.length > MAX_SPHERES) {
    errors.spheres = `Pick up to ${MAX_SPHERES} spheres.`;
  }

  if (draft.personality.length > PERSONALITY_MAX) {
    errors.personality = `Keep it under ${PERSONALITY_MAX} characters.`;
  }

  if (!draft.color) errors.color = 'Pick a color.';
  else if (others.some((g) => g.color === draft.color)) {
    errors.color = 'Another god already uses that color.';
  }

  if (!draft.sigil) errors.sigil = 'Pick a sigil.';

  return errors;
}

export function hasErrors(errors: object): boolean {
  return Object.keys(errors).length > 0;
}

/** Adds or removes a sphere, never going over the maximum. */
export function toggleSphere(spheres: string[], sphere: string): string[] {
  if (spheres.includes(sphere)) return spheres.filter((s) => s !== sphere);
  if (spheres.length >= MAX_SPHERES) return spheres;
  return [...spheres, sphere];
}
