/**
 * Layout modes for phones vs tablets (DOW-12).
 *
 * Phones get one screen per tab. Tablets (iPad, Android tablets) get a split view
 * on screens that support it: the main content (usually the map) plus a side panel.
 */

export type LayoutMode = 'phone' | 'tablet';

/** Window width (in density-independent pixels) at which the tablet layout starts. */
export const TABLET_MIN_WIDTH = 768;

/** Width of the side panel in split view. */
export const SIDE_PANEL_WIDTH = 360;

export function getLayoutMode(windowWidth: number): LayoutMode {
  return windowWidth >= TABLET_MIN_WIDTH ? 'tablet' : 'phone';
}
