// DOW-52/53: reading votes and objections out of the projected game.
import type { ActionRecord, GameView, ProposalView } from './project';

export type VoteCounts = {
  yes: number;
  no: number;
  keep: number;
  undo: number;
  coin: number;
  drop: number;
};

export function voteCounts(proposal: ProposalView): VoteCounts {
  const counts: VoteCounts = { yes: 0, no: 0, keep: 0, undo: 0, coin: 0, drop: 0 };
  for (const choice of Object.values(proposal.votes)) {
    if (choice in counts) counts[choice as keyof VoteCounts] += 1;
  }
  return counts;
}

export function openProposals(view: GameView): ProposalView[] {
  return view.proposals.filter((p) => p.status === 'open');
}

/** The objection to an action, if there is one (one per action). */
export function objectionTo(view: GameView, seq: number): ProposalView | null {
  return view.proposals.find((p) => p.kind === 'objection' && p.targetSeq === seq) ?? null;
}

/** When the window to object to an action closes, or null if objections are off. */
export function objectionDeadline(action: ActionRecord, hours: number): Date | null {
  if (hours <= 0 || !action.at) return null;
  return new Date(new Date(action.at).getTime() + hours * 3_600_000);
}

/** Whether a god may object to an action now (mirrors object_to_action() on the server). */
export function canObject(
  view: GameView,
  action: ActionRecord,
  godId: string | null,
  hours: number,
  now: Date,
): boolean {
  const deadline = objectionDeadline(action, hours);
  return (
    !!godId &&
    action.godId !== godId &&
    !action.retconned &&
    !!deadline &&
    deadline > now &&
    !objectionTo(view, action.seq)
  );
}

/** A vote whose time is up, waiting for someone to close it. */
export function isExpired(proposal: ProposalView, now: Date): boolean {
  return proposal.status === 'open' && !!proposal.closesAt && new Date(proposal.closesAt) <= now;
}
