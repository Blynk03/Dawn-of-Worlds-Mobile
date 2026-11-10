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

    default:
      // Unknown event types (from newer app versions) are skipped, not fatal.
      return next;
  }
}

export function projectWorld(events: readonly GameEvent[], from: GameView = EMPTY_GAME): GameView {
  return [...events].sort((a, b) => a.seq - b.seq).reduce(applyEvent, from);
}

function sortByOrder(incomes: Income[], order: string[]): Income[] {
  return [...incomes].sort((a, b) => order.indexOf(a.godId) - order.indexOf(b.godId));
}

const AGE_NAMES = ['First Age', 'Second Age', 'Third Age'];

export function ageName(age: number): string {
  return AGE_NAMES[age - 1] ?? `Age ${age}`;
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
