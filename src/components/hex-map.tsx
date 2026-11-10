import { memo, useCallback, useMemo, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  GestureDetector,
  useExclusiveGestures,
  useLongPressGesture,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { G, Polygon, Text as SvgText } from 'react-native-svg';

import type { WorldMapView } from '@/game/project';
import { type Hex, hexAtPoint, hexCenter, hexCorners, hexFromIndex, mapPixelSize } from '@/map/hex';
import { climateInfo, terrainInfo, TERRAINS } from '@/map/terrain';

/** Hex radius in map pixels at zoom 1. */
const HEX_SIZE = 20;
const MAX_ZOOM = 5;
/** How far (in points) a finger can move and still count as a tap or long-press. */
const TAP_SLOP = 10;

type HexMapProps = {
  map: WorldMapView;
  /** Hex indexes to highlight (e.g. the hexes chosen for an action). */
  selected?: ReadonlySet<number>;
  /** Hex indexes to outline more subtly (e.g. the hex whose history is open). */
  focused?: number | null;
  onTapHex?: (hex: Hex) => void;
  onLongPressHex?: (hex: Hex) => void;
};

/**
 * DOW-29: the world map. Pinch or use the buttons to zoom, drag to pan, tap a hex, long-press a
 * hex. The terrain layer only re-renders when the map changes; panning and zooming move it as a
 * whole on the UI thread, so it stays smooth on tablets.
 */
export function HexMap({ map, selected, focused, onTapHex, onLongPressHex }: HexMapProps) {
  const pixels = useMemo(
    () => mapPixelSize(map.width, map.height, HEX_SIZE),
    [map.width, map.height],
  );
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const minScale = useSharedValue(0.2);

  const fitScale = useCallback(
    (b: { width: number; height: number }) =>
      Math.min(b.width / pixels.width, b.height / pixels.height),
    [pixels],
  );

  const fit = useCallback(
    (b: { width: number; height: number }, animate: boolean) => {
      const s = fitScale(b);
      const x = (b.width - pixels.width * s) / 2;
      const y = (b.height - pixels.height * s) / 2;
      minScale.set(s * 0.8);
      scale.set(animate ? withTiming(s) : s);
      tx.set(animate ? withTiming(x) : x);
      ty.set(animate ? withTiming(y) : y);
    },
    [fitScale, pixels, minScale, scale, tx, ty],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!box) fit({ width, height }, false);
    setBox({ width, height });
  };

  const zoomBy = (factor: number) => {
    if (!box) return;
    const next = Math.min(MAX_ZOOM, Math.max(minScale.get(), scale.get() * factor));
    const cx = box.width / 2;
    const cy = box.height / 2;
    tx.set(withTiming(cx - (cx - tx.get()) * (next / scale.get())));
    ty.set(withTiming(cy - (cy - ty.get()) * (next / scale.get())));
    scale.set(withTiming(next));
  };

  const hexAtScreen = (x: number, y: number) =>
    hexAtPoint(
      { x: (x - tx.get()) / scale.get(), y: (y - ty.get()) / scale.get() },
      HEX_SIZE,
      map.width,
      map.height,
    );

  const pan = usePanGesture({
    minDistance: 4,
    onUpdate: (e) => {
      'worklet';
      tx.set(tx.get() + e.changeX);
      ty.set(ty.get() + e.changeY);
    },
  });
  const pinch = usePinchGesture({
    onUpdate: (e) => {
      'worklet';
      const next = Math.min(MAX_ZOOM, Math.max(minScale.get(), scale.get() * e.scaleChange));
      const ratio = next / scale.get();
      tx.set(e.focalX - (e.focalX - tx.get()) * ratio);
      ty.set(e.focalY - (e.focalY - ty.get()) * ratio);
      scale.set(next);
    },
  });
  const longPress = useLongPressGesture({
    runOnJS: true,
    minDuration: 450,
    maxDistance: TAP_SLOP,
    onActivate: (e) => {
      const hex = hexAtScreen(e.x, e.y);
      if (hex) onLongPressHex?.(hex);
    },
  });
  const tap = useTapGesture({
    runOnJS: true,
    // A drag to pan must not also pick a hex.
    maxDistance: TAP_SLOP,
    onActivate: (e) => {
      const hex = hexAtScreen(e.x, e.y);
      if (hex) onTapHex?.(hex);
    },
  });
  const touches = useExclusiveGestures(longPress, tap);
  const gesture = useSimultaneousGestures(pan, pinch, touches);

  const transform = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: scale.get() }],
  }));

  return (
    <View style={styles.container} onLayout={onLayout} accessibilityLabel="World map">
      <GestureDetector gesture={gesture}>
        <View style={styles.fill}>
          <Animated.View
            style={[styles.layer, { width: pixels.width, height: pixels.height }, transform]}>
            <TerrainLayer map={map} width={pixels.width} height={pixels.height} />
            <HighlightLayer
              map={map}
              selected={selected}
              focused={focused ?? null}
              width={pixels.width}
              height={pixels.height}
            />
          </Animated.View>
        </View>
      </GestureDetector>
      <View style={styles.controls}>
        <ZoomButton label="+" accessibilityLabel="Zoom in" onPress={() => zoomBy(1.5)} />
        <ZoomButton label="−" accessibilityLabel="Zoom out" onPress={() => zoomBy(1 / 1.5)} />
        <ZoomButton
          label="⤢"
          accessibilityLabel="Show whole map"
          onPress={() => box && fit(box, true)}
        />
      </View>
    </View>
  );
}

const TerrainLayer = memo(function TerrainLayer({
  map,
  width,
  height,
}: {
  map: WorldMapView;
  width: number;
  height: number;
}) {
  const cells = useMemo(
    () =>
      map.terrain.map((terrain, index) => {
        const hex = hexFromIndex(index, map.width);
        const info = terrainInfo(terrain);
        const climate = climateInfo(map.climate[index] ?? 'none');
        const c = hexCenter(hex, HEX_SIZE);
        return (
          <G key={index}>
            <Polygon
              points={hexCorners(hex, HEX_SIZE)}
              fill={info.color}
              stroke="rgba(0,0,0,0.12)"
              strokeWidth={0.75}
            />
            {info.glyph ? (
              <SvgText
                x={c.x}
                y={c.y + 5}
                fontSize={14}
                textAnchor="middle"
                fill="rgba(0,0,0,0.45)">
                {info.glyph}
              </SvgText>
            ) : null}
            {climate.glyph ? (
              <SvgText
                x={c.x + 7}
                y={c.y - 4}
                fontSize={9}
                textAnchor="middle"
                fill="#FFFFFF"
                stroke="rgba(0,0,0,0.35)"
                strokeWidth={0.4}>
                {climate.glyph}
              </SvgText>
            ) : null}
          </G>
        );
      }),
    [map],
  );
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      {cells}
    </Svg>
  );
});

function HighlightLayer({
  map,
  selected,
  focused,
  width,
  height,
}: {
  map: WorldMapView;
  selected?: ReadonlySet<number>;
  focused: number | null;
  width: number;
  height: number;
}) {
  if ((!selected || selected.size === 0) && focused === null) return null;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      {[...(selected ?? [])].map((index) => (
        <Polygon
          key={`s${index}`}
          points={hexCorners(hexFromIndex(index, map.width), HEX_SIZE)}
          fill="rgba(255,255,255,0.35)"
          stroke="#FFFFFF"
          strokeWidth={2.5}
        />
      ))}
      {focused !== null ? (
        <Polygon
          points={hexCorners(hexFromIndex(focused, map.width), HEX_SIZE)}
          fill="none"
          stroke="#E3B05B"
          strokeWidth={3}
        />
      ) : null}
    </Svg>
  );
}

function ZoomButton({
  label,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.zoomButton, pressed && styles.pressed]}>
      <Text style={styles.zoomLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden', backgroundColor: TERRAINS.ocean.color },
  fill: { flex: 1 },
  layer: { position: 'absolute', left: 0, top: 0, transformOrigin: 'top left' },
  controls: { position: 'absolute', right: 8, bottom: 8, gap: 6 },
  zoomButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomLabel: { fontSize: 20, color: '#1F2937' },
  pressed: { opacity: 0.7 },
});
