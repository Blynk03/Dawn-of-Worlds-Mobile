import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { SplitView } from '@/components/split-view';
import { useLayoutMode } from '@/hooks/use-layout-mode';

jest.mock('@/hooks/use-layout-mode');
const mockUseLayoutMode = jest.mocked(useLayoutMode);

const renderSplit = () => render(<SplitView main={<Text>map</Text>} side={<Text>panel</Text>} />);

describe('SplitView', () => {
  it('shows only the main content on phones', async () => {
    mockUseLayoutMode.mockReturnValue('phone');
    await renderSplit();
    expect(screen.getByText('map')).toBeTruthy();
    expect(screen.queryByText('panel')).toBeNull();
    expect(screen.getByTestId('split-view-phone')).toBeTruthy();
  });

  it('shows main content and side panel on tablets', async () => {
    mockUseLayoutMode.mockReturnValue('tablet');
    await renderSplit();
    expect(screen.getByText('map')).toBeTruthy();
    expect(screen.getByText('panel')).toBeTruthy();
    expect(screen.getByTestId('split-view-tablet')).toBeTruthy();
  });
});
