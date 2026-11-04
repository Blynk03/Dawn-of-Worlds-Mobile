import { fireEvent, render, screen } from '@testing-library/react-native';

import { ScreenError } from '@/components/screen-error';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));

describe('ScreenError', () => {
  it('explains the problem and offers a way out', async () => {
    const retry = jest.fn(() => Promise.resolve());
    await render(<ScreenError error={new Error('Boom')} retry={retry} />);
    expect(screen.getByText('Boom')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Back to my worlds' }));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});
