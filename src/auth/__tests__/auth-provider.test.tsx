import { act, render, screen } from '@testing-library/react-native';
import { useLinkingURL } from 'expo-linking';
import { Text } from 'react-native';

import { AuthProvider, useAuth } from '@/auth/auth-provider';
import { supabase } from '@/lib/supabase';

jest.mock('expo-linking', () => ({ useLinkingURL: jest.fn(() => null) }));

type AuthListener = (event: string, session: unknown) => void;
let listener: AuthListener | undefined;

jest.mock('@/lib/supabase', () => ({
  supabaseConfig: { ok: true, config: { url: 'https://x.supabase.co', publishableKey: 'k' } },
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn((cb: AuthListener) => {
        listener = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
      setSession: jest.fn(() => Promise.resolve({ error: null })),
      exchangeCodeForSession: jest.fn(() => Promise.resolve({ error: null })),
      signOut: jest.fn(() => Promise.resolve({ error: null })),
    },
  },
}));

const auth = jest.mocked(supabase!.auth);
const mockUseLinkingURL = jest.mocked(useLinkingURL);

function Probe() {
  const { status, linkError } = useAuth();
  return (
    <Text>
      {status}
      {linkError ? ` | ${linkError}` : ''}
    </Text>
  );
}

const session = { user: { id: 'u1', email: 'bob@example.com' } };

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLinkingURL.mockReturnValue(null);
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null } as never);
});

describe('AuthProvider', () => {
  it('starts loading, then reports signed out with no stored session', async () => {
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('signedOut')).toBeTruthy();
  });

  it('reports signed in when a session is stored', async () => {
    auth.getSession.mockResolvedValue({ data: { session }, error: null } as never);
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('signedIn')).toBeTruthy();
  });

  it('follows sign-in and sign-out events', async () => {
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('signedOut');
    await act(async () => listener?.('SIGNED_IN', session));
    expect(screen.getByText('signedIn')).toBeTruthy();
    await act(async () => listener?.('SIGNED_OUT', null));
    expect(screen.getByText('signedOut')).toBeTruthy();
  });

  it('completes sign-in from a magic link with tokens', async () => {
    mockUseLinkingURL.mockReturnValue(
      'dawnofworlds://auth/callback#access_token=a&refresh_token=r',
    );
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('signedOut');
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
    expect(auth.setSession).toHaveBeenCalledTimes(1);
  });

  it('completes sign-in from a magic link with a PKCE code', async () => {
    mockUseLinkingURL.mockReturnValue('dawnofworlds://auth/callback?code=c0de');
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('signedOut');
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('c0de');
  });

  it('shows an expired-link error', async () => {
    mockUseLinkingURL.mockReturnValue(
      'dawnofworlds://auth/callback#error=access_denied&error_description=Email+link+is+invalid+or+has+expired',
    );
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(
      await screen.findByText('signedOut | Email link is invalid or has expired'),
    ).toBeTruthy();
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it('shows an error when the session cannot be created from the link', async () => {
    auth.setSession.mockResolvedValueOnce({ error: { message: 'Invalid Refresh Token' } } as never);
    mockUseLinkingURL.mockReturnValue(
      'dawnofworlds://auth/callback#access_token=a&refresh_token=r',
    );
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('signedOut | Invalid Refresh Token')).toBeTruthy();
  });
});
