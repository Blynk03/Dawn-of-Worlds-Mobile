// DOW-48/54/55/41: the forms for Command City, marching an army and attacking.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CostSummary } from '@/components/act-forms';
import { Button, TextField } from '@/components/form';
import { Card, Chip, ErrorMessage, SectionLabel } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { AttackOrder, CityCommand } from '@/game/api';
import { presentIn } from '@/game/civilization';
import type { ArmyView, GameView, StructureView } from '@/game/project';
import { armiesRaisedThisTurn, battleSuggestions, defendersOf } from '@/game/war';

export const STRUCTURE_TYPES: { value: StructureView['structureType']; label: string }[] = [
  { value: 'wonder', label: 'Wonder' },
  { value: 'wall', label: 'Wall' },
  { value: 'school', label: 'School' },
  { value: 'tower', label: 'Tower' },
  { value: 'temple', label: 'Temple' },
  { value: 'other', label: 'Something else' },
];

const MAX_MODIFIERS = 10;

/** DOW-48: Command City: build something, or raise an army (one per city each turn). */
export function CommandCityForm({
  view,
  godId,
  viaAvatar,
  cityId,
  onCity,
  cost,
  power,
  busy,
  onSubmit,
}: {
  view: GameView;
  godId: string;
  /** Through an avatar: no presence needed, and a city may raise a second army. */
  viaAvatar: boolean;
  cityId: string | null;
  onCity: (id: string) => void;
  cost: number;
  power: number;
  busy: boolean;
  onSubmit: (cityId: string, command: CityCommand) => void;
}) {
  const [action, setAction] = useState<CityCommand['action']>('build');
  const [name, setName] = useState('');
  const [structureType, setStructureType] = useState<StructureView['structureType']>('wonder');
  const [description, setDescription] = useState('');
  const limit = viaAvatar ? 2 : 1;
  const cities = view.cities.filter((c) => c.status === 'active');
  const city = cities.find((c) => c.id === cityId);
  const absent = (raceId: string) => !viaAvatar && !presentIn(view, godId, raceId);
  const atLimit = (id: string) => armiesRaisedThisTurn(view, godId, id) >= limit;
  const blockedReason =
    city && action === 'raiseArmy' && atLimit(city.id)
      ? `${city.name} has already raised ${limit === 1 ? 'an army' : 'two armies'} this turn.`
      : null;

  return (
    <>
      <SectionLabel>City</SectionLabel>
      {cities.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          There are no standing cities.
        </ThemedText>
      ) : null}
      <View style={styles.wrap}>
        {cities.map((c) => {
          const away = absent(c.raceId);
          return (
            <Chip
              key={c.id}
              label={away ? `${c.name} · no order or avatar here` : c.name}
              selected={cityId === c.id}
              disabled={away}
              onPress={() => onCity(c.id)}
            />
          );
        })}
      </View>
      <SectionLabel>Command</SectionLabel>
      <View style={styles.wrap}>
        <Chip label="Build" selected={action === 'build'} onPress={() => setAction('build')} />
        <Chip
          label="Raise an army"
          selected={action === 'raiseArmy'}
          onPress={() => setAction('raiseArmy')}
        />
      </View>
      {action === 'build' ? (
        <>
          <View style={styles.wrap}>
            {STRUCTURE_TYPES.map((t) => (
              <Chip
                key={t.value}
                label={t.label}
                selected={structureType === t.value}
                onPress={() => setStructureType(t.value)}
              />
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            A wall gives the city’s defenders +1 in battle.
          </ThemedText>
        </>
      ) : null}
      <TextField
        label={action === 'build' ? 'What is it called?' : 'Army name'}
        value={name}
        onChangeText={setName}
        placeholder={action === 'build' ? 'The Iron Wall' : 'Host of Karak'}
        maxLength={40}
      />
      <CostSummary
        headline={
          !city
            ? 'Choose a city.'
            : action === 'build'
              ? `${city.name} builds ${name.trim() || 'something great'}`
              : `${city.name} raises ${name.trim() || 'an army'}`
        }
        cost={cost}
        power={power}
        ready={!!city}
      />
      <ErrorMessage message={blockedReason} />
      <TextField
        label="What happens?"
        value={description}
        onChangeText={setDescription}
        placeholder="Describe it for the chronicle…"
        maxLength={280}
        multiline
        style={styles.multiline}
      />
      <Button
        title={action === 'build' ? 'Build it' : 'Raise the army'}
        onPress={() =>
          onSubmit(
            city!.id,
            action === 'build'
              ? { action, name, structure_type: structureType, description }
              : { action, name, description },
          )
        }
        busy={busy}
        disabled={!city || !!blockedReason || !name.trim() || !description.trim() || cost > power}
      />
    </>
  );
}

/** Armies a god can command: active, among a race where they have an order or avatar. */
function commandable(view: GameView, godId: string): ArmyView[] {
  return view.armies.filter((a) => a.status === 'active' && presentIn(view, godId, a.raceId));
}

function ArmyPicker({
  view,
  godId,
  armyId,
  onArmy,
}: {
  view: GameView;
  godId: string;
  armyId: string | null;
  onArmy: (id: string) => void;
}) {
  const armies = commandable(view, godId);
  return (
    <>
      <SectionLabel>Army</SectionLabel>
      {armies.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          You have no order or avatar among any race with a standing army.
        </ThemedText>
      ) : null}
      <View style={styles.wrap}>
        {armies.map((a) => (
          <Chip
            key={a.id}
            label={`${a.name} · ${a.hex.x}, ${a.hex.y}`}
            selected={armyId === a.id}
            onPress={() => onArmy(a.id)}
          />
        ))}
      </View>
    </>
  );
}

/** DOW-48: march an army to a land hex, chosen on the map (Command Race). */
export function MarchForm({
  view,
  godId,
  armyId,
  onArmy,
  destination,
  cost,
  power,
  busy,
  onSubmit,
}: {
  view: GameView;
  godId: string;
  armyId: string | null;
  onArmy: (id: string) => void;
  /** e.g. "hex 6, 5", once one is tapped. */
  destination: string | null;
  cost: number;
  power: number;
  busy: boolean;
  onSubmit: (description: string) => void;
}) {
  const [description, setDescription] = useState('');
  const army = view.armies.find((a) => a.id === armyId);
  return (
    <>
      <ArmyPicker view={view} godId={godId} armyId={armyId} onArmy={onArmy} />
      <CostSummary
        headline={
          !army
            ? 'Choose an army.'
            : destination
              ? `${army.name} marches to ${destination}`
              : `Tap a land hex for where ${army.name} marches.`
        }
        cost={cost}
        power={power}
        ready={!!army && !!destination}
      />
      <TextField
        label="What happens?"
        value={description}
        onChangeText={setDescription}
        placeholder="Down to the river…"
        maxLength={280}
        multiline
        style={styles.multiline}
      />
      <Button
        title={army ? `March ${army.name}` : 'March'}
        onPress={() => onSubmit(description)}
        busy={busy}
        disabled={!army || !destination || !description.trim() || cost > power}
      />
    </>
  );
}

/** Toggle suggested +1s, or add your own. */
function ModifierPicker({
  label,
  side,
  suggestions,
  chosen,
  onChange,
}: {
  label: string;
  side: 'attackers' | 'defenders';
  suggestions: string[];
  chosen: string[];
  onChange: (next: string[]) => void;
}) {
  const [custom, setCustom] = useState('');
  const all = [...new Set([...suggestions, ...chosen])];
  const toggle = (m: string) =>
    onChange(
      chosen.includes(m)
        ? chosen.filter((x) => x !== m)
        : chosen.length < MAX_MODIFIERS
          ? [...chosen, m]
          : chosen,
    );
  const add = () => {
    const m = custom.trim();
    if (m && !chosen.includes(m) && chosen.length < MAX_MODIFIERS) onChange([...chosen, m]);
    setCustom('');
  };
  return (
    <>
      <SectionLabel>{label}</SectionLabel>
      <View style={styles.wrap}>
        {all.map((m) => (
          <Chip key={m} label={`+1 ${m}`} selected={chosen.includes(m)} onPress={() => toggle(m)} />
        ))}
      </View>
      <View style={styles.addRow}>
        <View style={styles.fill}>
          <TextField
            label={`Another bonus for the ${side}`}
            value={custom}
            onChangeText={setCustom}
            placeholder="Cavalry, a dragon overhead…"
            maxLength={60}
            onSubmitEditing={add}
          />
        </View>
        <Button title="Add" variant="secondary" onPress={add} disabled={!custom.trim()} />
      </View>
    </>
  );
}

export type WarTarget = { kind: 'army' | 'city'; id: string };

/**
 * DOW-54/55/41: attack an army or a city. Each side rolls 2d6 plus a +1 for each advantage the
 * table agrees on (advancements, walls, higher ground, terrain, weather, an avatar leading them).
 * Against a city every defending army fights in turn and the attacker tires: −1 for each battle
 * after the first. Utterly destroying the losers (and the city) costs extra, only if it happens.
 */
export function AttackForm({
  view,
  godId,
  armyId,
  onArmy,
  target,
  onTarget,
  prices,
  power,
  busy,
  onSubmit,
}: {
  view: GameView;
  godId: string;
  armyId: string | null;
  onArmy: (id: string) => void;
  target: WarTarget | null;
  onTarget: (t: WarTarget | null) => void;
  /** The attack itself (Command Race), destroying an army (Command City), a city (Command Race). */
  prices: { attack: number; army: number; city: number };
  power: number;
  busy: boolean;
  onSubmit: (order: Omit<AttackOrder, 'armyId' | 'target'>) => void;
}) {
  const [targetKind, setTargetKind] = useState<WarTarget['kind']>(target?.kind ?? 'city');
  const [attackerModifiers, setAttackerModifiers] = useState<string[]>([]);
  const [defenderModifiers, setDefenderModifiers] = useState<string[]>([]);
  const [utterly, setUtterly] = useState(false);
  const [description, setDescription] = useState('');

  const army = view.armies.find((a) => a.id === armyId);
  const kind = target?.kind ?? targetKind;
  const targets =
    kind === 'army'
      ? view.armies.filter((a) => a.status === 'active' && a.id !== armyId)
      : view.cities.filter((c) => c.status === 'active');
  const targetName =
    target &&
    (target.kind === 'army'
      ? view.armies.find((a) => a.id === target.id)?.name
      : view.cities.find((c) => c.id === target.id)?.name);
  const defenders =
    target?.kind === 'city'
      ? defendersOf(view, target.id, armyId ?? undefined)
      : target
        ? view.armies.filter((a) => a.id === target.id)
        : [];
  const suggestions =
    army && target ? battleSuggestions(view, army, target) : { attacker: [], defender: [] };
  const worstCase = defenders.length * prices.army + (target?.kind === 'city' ? prices.city : 0);
  const needed = prices.attack + (utterly ? worstCase : 0);
  const ready = !!army && !!targetName;

  return (
    <>
      <ArmyPicker view={view} godId={godId} armyId={armyId} onArmy={onArmy} />
      <SectionLabel>Attack</SectionLabel>
      <View style={styles.wrap}>
        <Chip
          label="A city"
          selected={kind === 'city'}
          onPress={() => {
            setTargetKind('city');
            onTarget(null);
          }}
        />
        <Chip
          label="An army"
          selected={kind === 'army'}
          onPress={() => {
            setTargetKind('army');
            onTarget(null);
          }}
        />
      </View>
      <View style={styles.wrap}>
        {targets.map((t) => (
          <Chip
            key={t.id}
            label={t.name}
            selected={target?.id === t.id}
            onPress={() => onTarget({ kind, id: t.id })}
          />
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Or tap a city or an army on the map.
      </ThemedText>
      {ready ? (
        <>
          <ModifierPicker
            label={`${army.name}’s bonuses`}
            side="attackers"
            suggestions={suggestions.attacker}
            chosen={attackerModifiers}
            onChange={setAttackerModifiers}
          />
          <ModifierPicker
            label="Defenders’ bonuses"
            side="defenders"
            suggestions={suggestions.defender}
            chosen={defenderModifiers}
            onChange={setDefenderModifiers}
          />
          <Card>
            <ThemedText type="smallBold">
              {army.name}: 2d6 + {attackerModifiers.length}
            </ThemedText>
            {defenders.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {targetName} has no army to defend it: it falls without a battle.
              </ThemedText>
            ) : (
              defenders.map((d, i) => (
                <ThemedText key={d.id} type="small" themeColor="textSecondary">
                  Battle {i + 1}: against {d.name}, 2d6 + {defenderModifiers.length}
                  {i > 0 ? ` (${army.name} at −${i}, tiring)` : ''}
                </ThemedText>
              ))
            )}
            <ThemedText type="small" themeColor="textSecondary">
              Ties are rolled again. Winning moves {army.name} onto {targetName}
              {target?.kind === 'city' ? ' and leaves it in ruins' : ''}; losing scatters it.
            </ThemedText>
          </Card>
          <Chip
            label={`Utterly destroy them · up to +${worstCase} power`}
            selected={utterly}
            onPress={() => setUtterly((u) => !u)}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {utterly
              ? `Beaten armies are destroyed (+${prices.army} each)${
                  target?.kind === 'city' ? ` and so is the city (+${prices.city})` : ''
                }, paid only for what is destroyed. You’ll need ${needed} power to try.`
              : 'Beaten armies are scattered; survivors remain.'}
          </ThemedText>
        </>
      ) : null}
      <CostSummary
        headline={
          !army
            ? 'Choose an army.'
            : !targetName
              ? 'Choose what to attack.'
              : `${army.name} attacks ${targetName}`
        }
        cost={needed}
        power={power}
        ready={ready}
      />
      <TextField
        label="What happens?"
        value={description}
        onChangeText={setDescription}
        placeholder="The Host brings them to heel…"
        maxLength={280}
        multiline
        style={styles.multiline}
      />
      <Button
        title={targetName ? `Attack ${targetName}` : 'Attack'}
        onPress={() =>
          onSubmit({ attackerModifiers, defenderModifiers, utterlyDestroy: utterly, description })
        }
        busy={busy}
        disabled={!ready || !description.trim() || needed > power}
      />
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
});
