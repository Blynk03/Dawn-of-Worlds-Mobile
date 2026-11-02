import { getLayoutMode, TABLET_MIN_WIDTH } from '@/layout/breakpoints';

describe('getLayoutMode', () => {
  it.each([
    [375, 'phone'], // iPhone
    [430, 'phone'], // large iPhone
    [TABLET_MIN_WIDTH - 1, 'phone'],
    [TABLET_MIN_WIDTH, 'tablet'],
    [820, 'tablet'], // iPad Air portrait
    [1280, 'tablet'], // Android tablet landscape
  ])('width %i → %s', (width, expected) => {
    expect(getLayoutMode(width)).toBe(expected);
  });
});
