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

  it('explains an update instead of a cryptic error when screen files have moved', async () => {
    const retry = jest.fn(() => Promise.resolve());
    await render(
      <ScreenError
        error={new Error('Loading module https://x/_expo/static/js/web/chronicle-1.js failed.')}
        retry={retry}
      />,
    );
    expect(screen.getByText('The app has been updated')).toBeTruthy();
    expect(screen.queryByText(/Loading module/)).toBeNull();
    // (On a phone the app's code is all on the device, so Reload just tries again.)
    await fireEvent.press(screen.getByRole('button', { name: 'Reload' }));
    expect(retry).toHaveBeenCalled();
  });
});
