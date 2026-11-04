import type { WsMatchResult } from '../../src/game/networking/wsMessages';
import { rankMatch } from '../../src/game/simulation/ranking';
import type { EndReason, GameEvent, GameState, PlayerId } from '../../src/game/simulation/types';

/**
 * Server-side result computation for the authoritative session.
 *
 * The server is the only ranker: this is a pure fold over the same state and
 * accumulated event stream that local play uses, calling the shared `rankMatch`.
 * It never re-orders fighters from array positions and never invents a winner.
 *
 * `MatchEnded` carries `reason`/`winner` for Last Man Standing and Deathmatch.
 * Score Brawl keeps its historical lifecycle event (no outcome fields) and only
 * ends on the shared timer, so the fallback reason is `time` and the winner is
 * taken from the ranking only when exactly one fighter holds rank 1.
 */
export function computeMatchResult(state: GameState, events: readonly GameEvent[]): WsMatchResult {
  const ranking = rankMatch(state, events);
  let ended: GameEvent | undefined;
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index].type === 'MatchEnded') {
      ended = events[index];
      break;
    }
  }
  const declaredWinner: PlayerId | null | undefined =
    ended !== undefined && Object.prototype.hasOwnProperty.call(ended, 'winner') ? ended.winner : undefined;
  const top = ranking.order.filter(entry => entry.rank === 1).map(entry => entry.id);
  let winner: PlayerId | null;
  if (ranking.draw) winner = null;
  else if (declaredWinner !== undefined) winner = declaredWinner;
  else winner = top.length === 1 ? top[0] : null;
  return {
    reason: (ended?.reason ?? 'time') as EndReason,
    winner,
    ranking: ranking.order.map(entry => ({ id: entry.id, rank: entry.rank, metric: entry.metric })),
  };
}
