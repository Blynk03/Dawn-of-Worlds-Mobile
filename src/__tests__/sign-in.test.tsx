import { fireEvent, render, screen } from '@testing-library/react-native';

import SignInScreen from '@/app/sign-in';
import { supabase } from '@/lib/supabase';

jest.mock('expo-linking', () => ({
  createURL: jest.fn((path: string) => `dawnofworlds://${path.replace(/^\//, '')}`),
}));

jest.mock('@/auth/auth-provider', () => ({
  useAuth: () => ({ linkError: null, clearLinkError: jest.fn() }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: jest.fn(() => Promise.resolve({ error: null })),
      verifyOtp: jest.fn(() => Promise.resolve({ error: null })),
      signInWithPassword: jest.fn(() => Promise.resolve({ error: null })),
    },
  },
}));

const auth = jest.mocked(supabase!.auth);

beforeEach(() => jest.clearAllMocks());

async function requestLink(email = 'bob@example.com') {
  await render(<SignInScreen />);
  await fireEvent.changeText(screen.getByLabelText('Email'), email);
  await fireEvent.press(screen.getByRole('button', { name: 'Send sign-in link' }));
  await screen.findByText('Check your email');
}

describe('SignInScreen', () => {
  it('disables the button until the email looks valid', async () => {
    await render(<SignInScreen />);
    expect(screen.getByRole('button', { name: 'Send sign-in link' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Email'), 'bob@example.com');
    expect(screen.getByRole('button', { name: 'Send sign-in link' })).toBeEnabled();
  });

  it('sends a magic link that returns to the auth callback route', async () => {
    await requestLink('  bob@example.com ');
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'bob@example.com',
      options: { emailRedirectTo: 'dawnofworlds://auth/callback' },
    });
    expect(screen.getByText(/We sent a sign-in link to bob@example.com/)).toBeTruthy();
  });

  it('shows Supabase errors when sending fails', async () => {
    auth.signInWithOtp.mockResolvedValueOnce({
      error: { message: 'Email rate limit exceeded' },
    } as never);
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'bob@example.com');
    await fireEvent.press(screen.getByRole('button', { name: 'Send sign-in link' }));
    expect(await screen.findByText('Email rate limit exceeded')).toBeTruthy();
    expect(screen.queryByText('Check your email')).toBeNull();
  });

  it('signs in with the code from the email', async () => {
    await requestLink();
    expect(screen.getByRole('button', { name: 'Sign in with code' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Code from the email'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in with code' }));
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'bob@example.com',
      token: '123456',
      type: 'email',
    });
  });

  it('shows an error for a wrong code', async () => {
    auth.verifyOtp.mockResolvedValueOnce({
      error: { message: 'Token has expired or is invalid' },
    } as never);
    await requestLink();
    await fireEvent.changeText(screen.getByLabelText('Code from the email'), '000000');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in with code' }));
    expect(await screen.findByText('Token has expired or is invalid')).toBeTruthy();
  });

  it('can go back and use a different email', async () => {
    await requestLink();
    await fireEvent.press(screen.getByRole('button', { name: 'Use a different email' }));
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });

  it('signs in with a password, for accounts given one (Google Play reviewers)', async () => {
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in with a password' }));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Email'), ' review@example.com ');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'hunter2');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'review@example.com',
      password: 'hunter2',
    });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('shows a wrong password, and goes back to emailed links', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({
      error: { message: 'Invalid login credentials' },
    } as never);
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in with a password' }));
    await fireEvent.changeText(screen.getByLabelText('Email'), 'review@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'nope');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid login credentials')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Use an emailed link instead' }));
    expect(screen.getByRole('button', { name: 'Send sign-in link' })).toBeTruthy();
  });
});
