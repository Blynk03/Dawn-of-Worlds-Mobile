import { webAuthRedirectUrl } from '../redirect-url';

describe('webAuthRedirectUrl', () => {
  it('uses the site root when there is no base path', () => {
    expect(webAuthRedirectUrl('http://localhost:8081', undefined)).toBe(
      'http://localhost:8081/auth/callback',
    );
    expect(webAuthRedirectUrl('http://localhost:8081', '')).toBe(
      'http://localhost:8081/auth/callback',
    );
  });

  it('includes the GitHub Pages sub-folder', () => {
    expect(webAuthRedirectUrl('https://blynk03.github.io', '/Dawn-of-Worlds-Mobile')).toBe(
      'https://blynk03.github.io/Dawn-of-Worlds-Mobile/auth/callback',
    );
  });

  it('tolerates a trailing slash or missing leading slash', () => {
    expect(webAuthRedirectUrl('https://x.io', '/app/')).toBe('https://x.io/app/auth/callback');
    expect(webAuthRedirectUrl('https://x.io', 'app')).toBe('https://x.io/app/auth/callback');
  });
});
