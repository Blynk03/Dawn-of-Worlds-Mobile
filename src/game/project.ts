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
  /** The world's year when it happened. */
  year: number;
  /** When it was logged (ISO time). */
  at: string;
};

/** When and by whom something entered the world. */
type Origin = { godId: string | null; createdSeq: number; age: number; round: number };

/** DOW-34: a race, set down on its homeland hex. */
export type RaceView = Origin & {
  id: string;
  name: string;
  description: string;
  appearance: string;
  /** +1 good, 0 neutral, -1 evil (purify/corrupt move it later). */
  alignment: number;
  hex: { x: number; y: number };
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
};

/** A sect (order) within a race; a race's creator gets one automatically. */
export type OrderView = Origin & { id: string; name: string; raceId: string };

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
  const next: GameView = { ...view, lastSeq: event.seq };

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
      next.map = { width, height, terrain: strings(p.terrain), climate: strings(p.climate) };
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
        year: view.year,
        at: event.created_at,
      };
      next.actions = [...view.actions, action];
      const origin: Origin = {
        godId: event.god_id,
        createdSeq: event.seq,
        age: event.age,
        round: event.round,
      };
      if (action.power === 'createRace') {
        const race = asObj(p.race);
        const order = asObj(p.order);
        const id = str(race.id);
        if (id) {
          next.races = [
            ...view.races,
            {
              ...origin,
              id,
              name: str(race.name) ?? action.choice,
              description: str(race.description) ?? '',
              appearance: str(race.appearance) ?? '',
              alignment: num(race.alignment),
              hex: hexOf(race.hex),
            },
          ];
          const orderId = str(order.id);
          if (orderId) {
            next.orders = [
              ...view.orders,
              { ...origin, id: orderId, name: str(order.name) ?? '', raceId: id },
            ];
          }
        }
      }
      if (action.power === 'commandRace' && action.intent === 'foundCity') {
        const city = asObj(p.city);
        const id = str(city.id);
        const raceId = str(city.race_id);
        if (id && raceId) {
          next.cities = [
            ...view.cities,
            {
              ...origin,
              id,
              name: str(city.name) ?? action.choice,
              raceId,
              alignment: num(city.alignment),
              hex: hexOf(city.hex),
              description: action.description,
            },
          ];
        }
      }
      if (event.god_id) {
        next.powers = {
          ...view.powers,
          [event.god_id]: {
            power: num(p.power_after, view.powers[event.god_id]?.power ?? 0),
            lowPoolBonus: view.powers[event.god_id]?.lowPoolBonus ?? 0,
          },
        };
      }
      if (view.map) {
        const layer =
          action.power === 'shapeLand'
            ? 'terrain'
            : action.power === 'shapeClimate'
              ? 'climate'
              : null;
        const map = { ...view.map, terrain: [...view.map.terrain], climate: [...view.map.climate] };
        const history = { ...view.hexHistory };
        for (const [x, y] of hexes) {
          if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
          const index = y * map.width + x;
          if (layer) map[layer][index] = action.choice;
          history[index] = [...(history[index] ?? []), event.seq];
        }
        next.map = map;
        next.hexHistory = history;
      }
      return next;
    }

    default:
      // Unknown event types (from newer app versions) are skipped, not fatal.
      return next;
  }
}

export function projectWorld(events: readonly GameEvent[], from: GameView = EMPTY_GAME): GameView {
  return [...events].sort((a, b) => a.seq - b.seq).reduce(applyEvent, from);
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
