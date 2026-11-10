// Test stand-in for src/components/hex-map (Reanimated/gestures can't run in Jest). Shows the
// first few hexes as buttons named "hex x,y", plus which hexes are selected.
import { Pressable, Text, View } from 'react-native';

type Props = {
  map: { width: number; height: number; terrain: string[] };
  selected?: ReadonlySet<number>;
  onTapHex?: (hex: { x: number; y: number }) => void;
  onLongPressHex?: (hex: { x: number; y: number }) => void;
};

export function HexMap({ map, selected, onTapHex, onLongPressHex }: Props) {
  const shown = Array.from({ length: Math.min(12, map.width * map.height) }, (_, i) => i);
  return (
    <View testID="hex-map">
      <Text>{`map ${map.width}x${map.height}`}</Text>
      <Text>{`selected ${[...(selected ?? [])].sort((a, b) => a - b).join(',') || 'none'}`}</Text>
      {shown.map((i) => {
        const hex = { x: i % map.width, y: Math.floor(i / map.width) };
        return (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={`hex ${hex.x},${hex.y}`}
            onPress={() => onTapHex?.(hex)}
            onLongPress={() => onLongPressHex?.(hex)}>
            <Text>{map.terrain[i]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
