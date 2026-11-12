import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import MyGodScreen from '@/app/(app)/(tabs)/god';
import * as account from '@/auth/account';

const mockSignOut = jest.fn();
jest.mock('@/auth/auth-provider', () => ({
  useAuth: () => ({
    session: { user: { id: 'u1', email: 'me@example.com' } },
    signOut: mockSignOut,
  }),
}));
jest.mock('@/lib/supabase', () => ({ supabase: null }));
jest.mock('@/auth/account', () => ({
  ...jest.requireActual('@/auth/account'),
  deleteMyAccount: jest.fn(),
}));
const api = jest.mocked(account);

beforeEach(() => jest.clearAllMocks());

describe('Deleting your account (DOW-17)', () => {
  it('asks first, then deletes and signs out', async () => {
    api.deleteMyAccount.mockResolvedValue();
    await render(<MyGodScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete my account…' }));
    expect(screen.getByText(/It can’t be undone/)).toBeTruthy();
    expect(screen.getByText(/your god departs and takes no more turns/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep it' }));
    expect(api.deleteMyAccount).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Delete my account…' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    expect(api.deleteMyAccount).toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('shows errors and stays signed in', async () => {
    api.deleteMyAccount.mockRejectedValue(new Error('Sign in first'));
    await render(<MyGodScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete my account…' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText('Sign in first')).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('links to the privacy policy', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<MyGodScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Privacy policy' }));
    expect(open).toHaveBeenCalledWith(account.PRIVACY_POLICY_URL);
  });
});
