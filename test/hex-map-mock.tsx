// Test stand-in for src/components/hex-map (Reanimated/gestures can't run in Jest). Shows each hex
// (up to 100) as a button named "hex x,y", plus the markers, candidate hexes and selection as text.
import { Pressable, Text, View } from 'react-native';

type Props = {
  map: { width: number; height: number; terrain: string[] };
  markers?: readonly { index: number; kind: string; label: string }[];
  candidates?: ReadonlySet<number>;
  selected?: ReadonlySet<number>;
  onTapHex?: (hex: { x: number; y: number }) => void;
  onLongPressHex?: (hex: { x: number; y: number }) => void;
};

const list = (set?: ReadonlySet<number>) =>
  [...(set ?? [])].sort((a, b) => a - b).join(',') || 'none';

export function HexMap({ map, markers, candidates, selected, onTapHex, onLongPressHex }: Props) {
  const shown = Array.from({ length: Math.min(100, map.width * map.height) }, (_, i) => i);
  return (
    <View testID="hex-map">
      <Text>{`map ${map.width}x${map.height}`}</Text>
      <Text>{`selected ${list(selected)}`}</Text>
      <Text>{`candidates ${list(candidates)}`}</Text>
      {(markers ?? []).map((m) => (
        <Text key={`${m.kind}${m.index}`}>{`marker ${m.kind} ${m.label} at ${m.index}`}</Text>
      ))}
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
