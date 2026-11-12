/**
 * DOW-14: rebuilds what the game screen shows from the event log.
 *
 * The server decides everything (dice, power, order) and writes the results into each event, so
 * this projection only *reads* results; it never re-applies rules. That keeps the app and the
 * server from ever disagreeing. Pure: same events in, same view out.
 */

export type GameEvent = {
  seq: number;
  type: string;
  age: number;
  round: number;
  god_id: string | null;
  payload: unknown;
  created_at: string;
};

export type DiceRoll = {
  seq: number;
  godId: string | null;
  purpose: string;
  dice: number[];
  total: number;
};

export type Income = { godId: string; roll: number; bonus: number; gained: number; power: number };

export type TurnRecord = {
  seq: number;
  round: number;
  godId: string;
  how: 'end' | 'pass' | 'timeout';
  at: string;
};

export type WorldMapView = {
  width: number;
  height: number;
  /** Row by row: index = y * width + x. */
  terrain: string[];
  climate: string[];
  /** DOW-46: each hex's alignment, changed by Purify / Corrupt Region (0 or missing = untouched). */
  alignment?: number[];
};

/** One thing a god did to a hex (DOW-33). */
export type HexChange = {
  seq: number;
  age: number;
  round: number;
  godId: string | null;
  power: string;
  choice: string;
  description: string;
};

/** An action a god took (Shape Land, Shape Climate, Create Race, …). */
export type ActionRecord = HexChange & {
  cost: number;
  hexes: [number, number][];
  /** What a command was for, e.g. 'foundCity' for Command Race. */
  intent: string | null;
  /** What an action was aimed at (Advance, Purify, Corrupt). `key` is the id, or "x,y" for a region. */
  target: ActionTarget | null;
  /** For an attack: the battles and their outcome. */
  battle: BattleView | null;
  /** For Command Avatar: the avatar that acted. */
  avatar: { id: string; name: string } | null;
  /** For Purify / Corrupt: the target's alignment afterwards. */
  alignmentAfter: number | null;
  /** The world's year when it happened. */
  year: number;
  /** When it was logged (ISO time). */
  at: string;
  /** DOW-53: undone after an objection (it stays in the log, marked, and was refunded). */
  retconned: boolean;
  /** The undone action this was undone along with, because it built on it. */
  undoneBecauseOf: number | null;
};

/** DOW-52/53: a vote: on moving to the next age, or on an objection to an action. */
export type ProposalView = {
  id: string;
  kind: 'advanceAge' | 'objection';
  /** Who proposed or objected. */
  godId: string | null;
  /** An objection's action. */
  targetSeq: number | null;
  /** The age proposed. */
  age: number | null;
  /** A single god calling the age after its tenth round (no vote). */
  solo: boolean;
  reason: string;
  /** When an objection's vote closes (ISO time); age votes last until the round ends. */
  closesAt: string | null;
  status: 'open' | 'passed' | 'failed' | 'expired' | 'kept' | 'undone';
  /** Each god's vote: yes / no on an age, keep / undo / coin on an objection. */
  votes: Record<string, string>;
  /** The server's coin flip, if it came to that: 1 keeps, 2 undoes. */
  coin: number | null;
  seq: number;
  at: string;
};

/** DOW-52: when an age began. */
export type AgeChange = { age: number; name: string; round: number; seq: number };

export type ActionTarget = {
  kind: 'race' | 'city' | 'region' | 'order' | 'avatar' | 'army';
  id: string | null;
  key: string;
  name: string;
};

/** When and by whom something entered the world. */
type Origin = { godId: string | null; createdSeq: number; age: number; round: number };

/** DOW-34: a race, set down on its homeland hex. */
export type RaceView = Origin & {
  id: string;
  name: string;
  description: string;
  appearance: string;
  /** Starts at +1 good, 0 neutral or -1 evil; Purify / Corrupt move it, without limit. */
  alignment: number;
  hex: { x: number; y: number };
  /** DOW-43: the race a subrace split from. */
  parentId: string | null;
};

/** DOW-35: a city founded by a race. */
export type CityView = Origin & {
  id: string;
  name: string;
  raceId: string;
  alignment: number;
  hex: { x: number; y: number };
  /** What happened when it was founded. */
  description: string;
  /** DOW-41: 'ruined' when taken in battle (survivors remain), 'destroyed' if utterly wiped out. */
  status: 'active' | 'ruined' | 'destroyed';
};

/** DOW-48: an army raised by a city. */
export type ArmyView = Origin & {
  id: string;
  name: string;
  raceId: string;
  cityId: string;
  hex: { x: number; y: number };
  description: string;
  /** 'scattered' when beaten (survivors remain), 'destroyed' if utterly wiped out. */
  status: 'active' | 'scattered' | 'destroyed';
};

/** DOW-48: a wonder, wall, school, tower… built by a city. */
export type StructureView = Origin & {
  id: string;
  name: string;
  structureType: 'wonder' | 'wall' | 'school' | 'tower' | 'temple' | 'other';
  cityId: string;
  description: string;
};

/** One battle within an attack: 2d6 + bonuses each side; the attacker tires after the first. */
export type BattleRound = {
  defenderId: string;
  defenderName: string;
  attackerDice: number[];
  defenderDice: number[];
  attackerBonus: number;
  defenderBonus: number;
  fatigue: number;
  attackerTotal: number;
  defenderTotal: number;
  winner: 'attacker' | 'defender';
};

/** DOW-54/55: an attack and how it went. */
export type BattleView = {
  armyId: string;
  armyName: string;
  attackerModifiers: string[];
  defenderModifiers: string[];
  battles: BattleRound[];
  outcome: 'won' | 'lost';
  cityOutcome: 'ruined' | 'destroyed' | null;
  destructionCost: number;
};

/** DOW-47: a race or city that is the greatest in the world at a field. */
export type AdvancementView = Origin & { id: string; entityId: string; field: string };

/** A sect (order) within a race; a race's creator gets one automatically. */
/** DOW-44: an order within a race: a religious sect, knights, thieves' guild, brigands, pirates… */
export type OrderView = Origin & {
  id: string;
  name: string;
  raceId: string;
  orderType: OrderType;
  purpose: string;
  /** 'destroyed' once wiped out (no longer a presence among its race). */
  status: 'active' | 'destroyed';
};

export type OrderType = 'religious' | 'knights' | 'thieves' | 'brigands' | 'pirates' | 'other';

/** DOW-45: a major figure: a high priest, a dragon, a dynasty… */
export type AvatarView = Origin & {
  id: string;
  name: string;
  avatarType: string;
  description: string;
  /** The race it walks among, if any. */
  raceId: string | null;
  hex: { x: number; y: number };
  /** 'destroyed' while slain; its creator can resurrect it. */
  status: 'active' | 'destroyed';
};

export type GameView = {
  started: boolean;
  age: number;
  round: number;
  year: number;
  turnOrder: string[];
  /** null between the last turn of a round and the next round_started (never visible in practice). */
  activeGodId: string | null;
  turnDeadline: string | null;
  powers: Record<string, { power: number; lowPoolBonus: number }>;
  /** Income for the current round, in turn order. */
  roundIncomes: Income[];
  /** Tie-break rolls for the current round's turn order. */
  roundTiebreaks: DiceRoll[];
  /** Turns taken so far this round. */
  turnsThisRound: TurnRecord[];
  /** null until the map is logged at the start of the game. */
  map: WorldMapView | null;
  /** Every action so far, oldest first. */
  actions: ActionRecord[];
  /** For each hex index, the seqs of actions that changed it (oldest first). */
  hexHistory: Record<number, number[]>;
  races: RaceView[];
  cities: CityView[];
  orders: OrderView[];
  avatars: AvatarView[];
  armies: ArmyView[];
  structures: StructureView[];
  advancements: AdvancementView[];
  /** DOW-17: gods whose players deleted their accounts; they take no more turns. */
  departedGods: string[];
  /** DOW-52/53: every vote, oldest first. */
  proposals: ProposalView[];
  /** The round the current age began in. */
  ageStartedRound: number;
  /** The next age has been agreed and begins with the next round. */
  agePending: boolean;
  /** When each age after the first began. */
  ageChanges: AgeChange[];
  /** seqs of undone actions; their effects are left out of the view. */
  retconned: number[];
  /** Every event applied, so the view can be rebuilt when an action is undone. */
  log: GameEvent[];
  /** seq of the current round's round_started event. */
  roundStartSeq: number;
  /** Highest seq applied, so new events can be applied incrementally. */
  lastSeq: number;
};

export const EMPTY_GAME: GameView = {
  started: false,
  age: 1,
  round: 0,
  year: 0,
  turnOrder: [],
  activeGodId: null,
  turnDeadline: null,
  powers: {},
  roundIncomes: [],
  roundTiebreaks: [],
  turnsThisRound: [],
  map: null,
  actions: [],
  hexHistory: {},
  races: [],
  cities: [],
  orders: [],
  advancements: [],
  avatars: [],
  armies: [],
  structures: [],
  departedGods: [],
  proposals: [],
  ageStartedRound: 1,
  agePending: false,
  ageChanges: [],
  retconned: [],
  log: [],
  roundStartSeq: 0,
  lastSeq: 0,
};

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const num = (v: unknown, fallback = 0) => (typeof v === 'number' ? v : fallback);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** Applies one event. Events at or below `lastSeq` are ignored, so re-delivery is harmless. */
export function applyEvent(view: GameView, event: GameEvent): GameView {
  if (event.seq <= view.lastSeq) return view;
  const p = asObj(event.payload);
  const next: GameView = { ...view, lastSeq: event.seq, log: [...view.log, event] };

  switch (event.type) {
    case 'game_started': {
      const gods = Array.isArray(p.gods)
        ? p.gods.filter((g): g is string => typeof g === 'string')
        : [];
      next.started = true;
      next.powers = Object.fromEntries(gods.map((g) => [g, { power: 0, lowPoolBonus: 0 }]));
      return next;
    }

    case 'dice_rolled': {
      if (p.purpose === 'turn_order_tiebreak') {
        next.roundTiebreaks = [
          ...view.roundTiebreaks,
          {
            seq: event.seq,
            godId: str(p.god_id),
            purpose: 'turn_order_tiebreak',
            dice: Array.isArray(p.dice) ? p.dice.map((d) => num(d)) : [],
            total: num(p.total),
          },
        ];
      }
      return next;
    }

    case 'round_started': {
      const incomes: Income[] = (Array.isArray(p.incomes) ? p.incomes : []).map((raw) => {
        const i = asObj(raw);
        return {
          godId: str(i.god_id) ?? '',
          roll: num(i.roll),
          bonus: num(i.bonus),
          gained: num(i.gained),
          power: num(i.power),
        };
      });
      const order = Array.isArray(p.turn_order)
        ? p.turn_order.filter((g): g is string => typeof g === 'string')
        : [];
      const powers = { ...view.powers };
      for (const income of incomes) {
        powers[income.godId] = {
          power: income.power,
          lowPoolBonus: powers[income.godId]?.lowPoolBonus ?? 0,
        };
      }
      // Tie-break rolls are logged just before round_started, so keep the ones from this round.
      const tiebreaks = view.roundTiebreaks.filter((t) => t.seq > view.roundStartSeq);
      return {
        ...next,
        started: true,
        round: num(p.round, view.round + 1),
        age: num(p.age, view.age),
        year: num(p.year, view.year),
        turnOrder: order,
        activeGodId: order[0] ?? null,
        turnDeadline: str(p.deadline),
        powers,
        roundIncomes: sortByOrder(incomes, order),
        roundTiebreaks: tiebreaks,
        turnsThisRound: [],
        roundStartSeq: event.seq,
      };
    }

    case 'turn_ended': {
      const godId = str(p.god_id) ?? event.god_id ?? '';
      const how = p.how === 'pass' || p.how === 'timeout' ? p.how : 'end';
      next.powers = {
        ...view.powers,
        [godId]: {
          power: num(p.power, view.powers[godId]?.power ?? 0),
          lowPoolBonus: num(p.low_pool_bonus),
        },
      };
      next.turnsThisRound = [
        ...view.turnsThisRound,
        { seq: event.seq, round: event.round, godId, how, at: event.created_at },
      ];
      next.activeGodId = str(p.next_god_id);
      next.turnDeadline = str(p.deadline);
      return next;
    }

    case 'map_initialized': {
      const width = num(p.width);
      const height = num(p.height);
      const strings = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
      next.map = {
        width,
        height,
        terrain: strings(p.terrain),
        climate: strings(p.climate),
        alignment: Array.from({ length: width * height }, () => 0),
      };
      next.hexHistory = {};
      return next;
    }

    case 'action_taken': {
      const hexes: [number, number][] = (Array.isArray(p.hexes) ? p.hexes : [])
        .filter((h): h is unknown[] => Array.isArray(h) && h.length === 2)
        .map((h) => [num(h[0]), num(h[1])]);
      const action: ActionRecord = {
        seq: event.seq,
        age: event.age,
        round: event.round,
        godId: event.god_id,
        power: str(p.power) ?? '',
        choice: str(p.choice) ?? '',
        description: str(p.description) ?? '',
        cost: num(p.cost),
        hexes,
        intent: str(p.intent),
        battle: battleOf(p.battle),
        avatar: (() => {
          const a = asObj(p.avatar);
          const id = str(a.id);
          return id ? { id, name: str(a.name) ?? '' } : null;
        })(),
        target: targetOf(p.target),
        alignmentAfter:
          typeof asObj(p.alignment).after === 'number' ? num(asObj(p.alignment).after) : null,
        year: view.year,
        at: event.created_at,
        retconned: view.retconned.includes(event.seq),
        undoneBecauseOf: null,
      };
      next.actions = [...view.actions, action];
      if (event.god_id) {
        next.powers = {
          ...view.powers,
          [event.god_id]: {
            power: num(p.power_after, view.powers[event.god_id]?.power ?? 0),
            lowPoolBonus: view.powers[event.god_id]?.lowPoolBonus ?? 0,
          },
        };
      }
      // DOW-53: an undone action is listed, but changed nothing.
      if (action.retconned) return next;
      const origin: Origin = {
        godId: event.god_id,
        createdSeq: event.seq,
        age: event.age,
        round: event.round,
      };
      // Whatever the power (or avatar) that made them, new races, orders, cities and avatars
      // arrive in the payload.
      const race = asObj(p.race);
      const raceId = str(race.id);
      if (raceId) {
        next.races = [
          ...view.races,
          {
            ...origin,
            id: raceId,
            name: str(race.name) ?? action.choice,
            description: str(race.description) ?? '',
            appearance: str(race.appearance) ?? '',
            alignment: num(race.alignment),
            hex: hexOf(race.hex),
            parentId: str(race.parent_id),
          },
        ];
      }
      const order = asObj(p.order);
      const orderId = str(order.id);
      const orderRace = str(order.race_id) ?? raceId;
      if (orderId && orderRace) {
        next.orders = [
          ...view.orders,
          {
            ...origin,
            id: orderId,
            name: str(order.name) ?? '',
            raceId: orderRace,
            orderType: orderTypeOf(order.order_type),
            purpose: str(order.purpose) ?? '',
            status: 'active',
          },
        ];
      }
      const city = asObj(p.city);
      const cityId = str(city.id);
      const cityRace = str(city.race_id);
      if (cityId && cityRace) {
        next.cities = [
          ...view.cities,
          {
            ...origin,
            id: cityId,
            name: str(city.name) ?? action.choice,
            raceId: cityRace,
            alignment: num(city.alignment),
            hex: hexOf(city.hex),
            description: action.description,
            status: 'active',
          },
        ];
      }
      const army = asObj(p.army);
      const armyId = str(army.id);
      const armyRace = str(army.race_id);
      const armyCity = str(army.city_id);
      if (armyId && armyRace && armyCity) {
        next.armies = [
          ...view.armies,
          {
            ...origin,
            id: armyId,
            name: str(army.name) ?? action.choice,
            raceId: armyRace,
            cityId: armyCity,
            hex: hexOf(army.hex),
            description: action.description,
            status: 'active',
          },
        ];
      }
      const structure = asObj(p.structure);
      const structureId = str(structure.id);
      const structureCity = str(structure.city_id);
      if (structureId && structureCity) {
        next.structures = [
          ...view.structures,
          {
            ...origin,
            id: structureId,
            name: str(structure.name) ?? action.choice,
            structureType: structureTypeOf(structure.structure_type),
            cityId: structureCity,
            description: action.description,
          },
        ];
      }
      // Marching moves an army.
      const march = asObj(p.march);
      const marching = str(march.army_id);
      if (marching) {
        const to = hexOf(march.to);
        next.armies = next.armies.map((a) => (a.id === marching ? { ...a, hex: to } : a));
      }
      // A battle: the losers are scattered or destroyed, a taken city ruined or destroyed, and the
      // victors hold the field.
      const battle = action.battle;
      if (battle) {
        const b = asObj(p.battle);
        const scattered = new Set(stringList(b.scattered));
        const destroyed = new Set(stringList(b.destroyed));
        const field = action.hexes[0];
        next.armies = next.armies.map((a) => {
          if (destroyed.has(a.id)) return { ...a, status: 'destroyed' };
          if (scattered.has(a.id)) return { ...a, status: 'scattered' };
          if (a.id === battle.armyId && battle.outcome === 'won' && field) {
            return { ...a, hex: { x: field[0], y: field[1] } };
          }
          return a;
        });
        const cityId = action.target?.kind === 'city' ? action.target.id : null;
        const fallen = battle.cityOutcome;
        if (cityId && fallen) {
          next.cities = next.cities.map((c) => (c.id === cityId ? { ...c, status: fallen } : c));
        }
      }
      const avatar = asObj(p.avatar);
      const avatarId = str(avatar.id);
      if (avatarId && action.power === 'createAvatar') {
        next.avatars = [
          ...view.avatars,
          {
            ...origin,
            id: avatarId,
            name: str(avatar.name) ?? action.choice,
            avatarType: str(avatar.avatar_type) ?? '',
            description: str(avatar.description) ?? action.description,
            raceId: str(avatar.race_id),
            hex: hexOf(avatar.hex),
            status: 'active',
          },
        ];
      } else if (avatarId && avatar.status === 'active') {
        next.avatars = view.avatars.map((a) =>
          a.id === avatarId ? { ...a, status: 'active' } : a,
        );
      }
      if (action.power === 'advanceCivilization' || action.power === 'advanceCity') {
        const advancement = asObj(p.advancement);
        const id = str(advancement.id);
        if (id && action.target?.id) {
          next.advancements = [
            ...view.advancements,
            {
              ...origin,
              id,
              entityId: action.target.id,
              field: str(advancement.field) ?? action.choice,
            },
          ];
        }
      }
      // DOW-46: Purify / Corrupt. The server sends the new value.
      const alignment = asObj(p.alignment);
      if (action.target && typeof alignment.after === 'number') {
        const after = alignment.after;
        const { kind, id } = action.target;
        if (kind === 'race' && id) {
          next.races = next.races.map((r) => (r.id === id ? { ...r, alignment: after } : r));
        } else if (kind === 'city' && id) {
          next.cities = next.cities.map((c) => (c.id === id ? { ...c, alignment: after } : c));
        }
      }
      if (view.map) {
        const layer =
          action.power === 'shapeLand'
            ? 'terrain'
            : action.power === 'shapeClimate'
              ? 'climate'
              : null;
        const map = {
          ...view.map,
          terrain: [...view.map.terrain],
          climate: [...view.map.climate],
          alignment: [...(view.map.alignment ?? [])],
        };
        const history = { ...view.hexHistory };
        for (const [x, y] of hexes) {
          if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
          const index = y * map.width + x;
          if (layer) map[layer][index] = action.choice;
          if (action.target?.kind === 'region' && typeof alignment.after === 'number') {
            map.alignment[index] = alignment.after;
          }
          history[index] = [...(history[index] ?? []), event.seq];
        }
        next.map = map;
        next.hexHistory = history;
      }
      return next;
    }

    case 'god_departed': {
      const god = str(p.god_id);
      if (!god) return next;
      next.departedGods = [...view.departedGods, god];
      next.turnOrder = view.turnOrder.filter((id) => id !== god);
      return next;
    }

    case 'proposal_opened': {
      const id = str(p.proposal_id);
      if (!id) return next;
      next.proposals = [
        ...view.proposals,
        {
          id,
          kind: p.kind === 'objection' ? 'objection' : 'advanceAge',
          godId: event.god_id,
          targetSeq: typeof p.target_seq === 'number' ? p.target_seq : null,
          age: typeof p.age === 'number' ? p.age : null,
          solo: p.solo === true,
          reason: str(p.reason) ?? '',
          closesAt: str(p.closes_at),
          status: 'open',
          votes: {},
          coin: null,
          seq: event.seq,
          at: event.created_at,
        },
      ];
      return next;
    }

    case 'vote_cast': {
      const id = str(p.proposal_id);
      const choice = str(p.choice);
      if (!id || !choice || !event.god_id) return next;
      const god = event.god_id;
      next.proposals = view.proposals.map((x) =>
        x.id === id ? { ...x, votes: { ...x.votes, [god]: choice } } : x,
      );
      return next;
    }

    case 'proposal_resolved': {
      const id = str(p.proposal_id);
      const outcome = PROPOSAL_STATUSES.find((o) => o === p.outcome) ?? 'expired';
      next.proposals = view.proposals.map((x) =>
        x.id === id
          ? { ...x, status: outcome, coin: typeof p.coin === 'number' ? p.coin : null }
          : x,
      );
      if (p.kind === 'advance_age' && outcome === 'passed') next.agePending = true;
      return next;
    }

    case 'age_advanced': {
      const age = num(p.age, view.age + 1);
      const round = num(p.round, view.round + 1);
      return {
        ...next,
        age,
        agePending: false,
        ageStartedRound: round,
        ageChanges: [
          ...view.ageChanges,
          { age, name: str(p.name) ?? `Age ${age}`, round, seq: event.seq },
        ],
      };
    }

    case 'action_retconned': {
      // DOW-53: rebuild the view without the undone action's effects (and refund it).
      const seq = num(p.seq);
      const base = view.retconned.includes(seq)
        ? next
        : {
            ...view.log.reduce(applyEvent, { ...EMPTY_GAME, retconned: [...view.retconned, seq] }),
            lastSeq: event.seq,
            log: next.log,
          };
      const because = typeof p.because_of === 'number' ? p.because_of : null;
      const god = event.god_id;
      return {
        ...base,
        actions: base.actions.map((a) =>
          a.seq === seq ? { ...a, retconned: true, undoneBecauseOf: because } : a,
        ),
        powers: god
          ? {
              ...base.powers,
              [god]: {
                power: num(p.power_after, base.powers[god]?.power ?? 0),
                lowPoolBonus: base.powers[god]?.lowPoolBonus ?? 0,
              },
            }
          : base.powers,
      };
    }

    default:
      // Unknown event types (from newer app versions) are skipped, not fatal.
      return next;
  }
}

export function projectWorld(events: readonly GameEvent[], from: GameView = EMPTY_GAME): GameView {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  // Actions undone later in this batch are known up front, so they never need a rebuild.
  const undone = sorted
    .filter((e) => e.type === 'action_retconned')
    .map((e) => num(asObj(e.payload).seq))
    .filter((seq) => seq > from.lastSeq && !from.retconned.includes(seq));
  const start = undone.length > 0 ? { ...from, retconned: [...from.retconned, ...undone] } : from;
  return sorted.reduce(applyEvent, start);
}

const PROPOSAL_STATUSES: ProposalView['status'][] = [
  'open',
  'passed',
  'failed',
  'expired',
  'kept',
  'undone',
];

function targetOf(v: unknown): ActionTarget | null {
  const t = asObj(v);
  const kind = str(t.kind);
  const key = str(t.key) ?? str(t.id);
  if (
    (kind !== 'race' &&
      kind !== 'city' &&
      kind !== 'region' &&
      kind !== 'order' &&
      kind !== 'avatar' &&
      kind !== 'army') ||
    !key
  ) {
    return null;
  }
  return { kind, id: str(t.id), key, name: str(t.name) ?? '' };
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

const STRUCTURE_TYPES: StructureView['structureType'][] = [
  'wonder',
  'wall',
  'school',
  'tower',
  'temple',
  'other',
];

function structureTypeOf(v: unknown): StructureView['structureType'] {
  return STRUCTURE_TYPES.includes(v as StructureView['structureType'])
    ? (v as StructureView['structureType'])
    : 'other';
}

function battleOf(v: unknown): BattleView | null {
  const b = asObj(v);
  const army = asObj(b.army);
  const armyId = str(army.id);
  if (!armyId) return null;
  const rounds = Array.isArray(b.battles) ? b.battles : [];
  return {
    armyId,
    armyName: str(army.name) ?? '',
    attackerModifiers: stringList(b.attacker_modifiers),
    defenderModifiers: stringList(b.defender_modifiers),
    battles: rounds.map((r): BattleRound => {
      const round = asObj(r);
      const defender = asObj(round.defender);
      return {
        defenderId: str(defender.id) ?? '',
        defenderName: str(defender.name) ?? '',
        attackerDice: Array.isArray(round.attacker_dice) ? round.attacker_dice.map(num) : [],
        defenderDice: Array.isArray(round.defender_dice) ? round.defender_dice.map(num) : [],
        attackerBonus: num(round.attacker_bonus),
        defenderBonus: num(round.defender_bonus),
        fatigue: num(round.fatigue),
        attackerTotal: num(round.attacker_total),
        defenderTotal: num(round.defender_total),
        winner: round.winner === 'attacker' ? 'attacker' : 'defender',
      };
    }),
    outcome: b.outcome === 'won' ? 'won' : 'lost',
    cityOutcome:
      b.city_outcome === 'ruined' || b.city_outcome === 'destroyed' ? b.city_outcome : null,
    destructionCost: num(b.destruction_cost),
  };
}

const ORDER_TYPES: OrderType[] = [
  'religious',
  'knights',
  'thieves',
  'brigands',
  'pirates',
  'other',
];

function orderTypeOf(v: unknown): OrderType {
  return ORDER_TYPES.includes(v as OrderType) ? (v as OrderType) : 'religious';
}

function hexOf(v: unknown): { x: number; y: number } {
  return Array.isArray(v) ? { x: num(v[0]), y: num(v[1]) } : { x: 0, y: 0 };
}

function sortByOrder(incomes: Income[], order: string[]): Income[] {
  return [...incomes].sort((a, b) => order.indexOf(a.godId) - order.indexOf(b.godId));
}

const AGE_NAMES = ['First Age', 'Second Age', 'Third Age'];

export function ageName(age: number): string {
  return AGE_NAMES[age - 1] ?? `Age ${age}`;
}

/** The actions that changed a hex, oldest first. */
export function hexChanges(view: GameView, index: number): ActionRecord[] {
  const seqs = new Set(view.hexHistory[index] ?? []);
  return view.actions.filter((a) => seqs.has(a.seq));
}

/** The race whose homeland is on a hex, and the city there, if any. */
export function settlementsAt(
  view: GameView,
  hex: { x: number; y: number },
): { race: RaceView | null; city: CityView | null } {
  const at = (h: { x: number; y: number }) => h.x === hex.x && h.y === hex.y;
  return {
    race: view.races.find((r) => at(r.hex)) ?? null,
    city: view.cities.find((c) => at(c.hex)) ?? null,
  };
}

/**
 * The hexes a race can found a city on: its homeland, its cities, and their neighbors, as long
 * as they're on the map, on land, not already a city, and not another race's homeland. Mirrors
 * the server's checks in found_city so the app only offers moves the server will accept.
 */
export function cityCandidates(
  view: GameView,
  raceId: string,
  isWater: (terrain: string) => boolean,
  neighborsOf: (hex: { x: number; y: number }) => { x: number; y: number }[],
): number[] {
  const map = view.map;
  const race = view.races.find((r) => r.id === raceId);
  if (!map || !race) return [];
  const key = (h: { x: number; y: number }) => h.y * map.width + h.x;
  const land = [race.hex, ...view.cities.filter((c) => c.raceId === raceId).map((c) => c.hex)];
  const taken = new Set([
    ...view.cities.map((c) => key(c.hex)),
    ...view.races.filter((r) => r.id !== raceId).map((r) => key(r.hex)),
  ]);
  const out = new Set<number>();
  for (const h of land.flatMap((h) => [h, ...neighborsOf(h)])) {
    const k = key(h);
    if (!taken.has(k) && !isWater(map.terrain[k] ?? '')) out.add(k);
  }
  return [...out].sort((a, b) => a - b);
}

/** e.g. "Ends in 23h", "Ends in 12m", or "Time's up". */
export function describeDeadline(deadline: string | null, now: Date = new Date()): string | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - now.getTime();
  if (ms <= 0) return "Time's up";
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `Ends in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `Ends in ${hours}h` : `Ends in ${Math.floor(hours / 24)}d`;
}
