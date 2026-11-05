# ADR 0003: Carrying the finished match result and asking for a rematch

- **Status:** Proposed; implemented and merged in PR #149 (`eeeb084`). Owner acceptance of the ADR itself is still pending and is not implied by the merge.
- **Date:** 2026-11-04
- **Related:** [ADR 0001](0001-network-topology.md), [ADR 0002](0002-mode-fields.md), [online results spec](../M9_ONLINE_RESULTS.md), `src/game/networking/wsMessages.ts`, `server/ws/authoritativeWsSession.ts`, `src/game/simulation/ranking.ts`.

## Context

The online client renders snapshots only. When a match ends, the client sees `phase: 'results'` and, if it happens
to catch the right snapshot, the `MatchEnded` event in that tick's small event batch. It has no result screen and no
way to ask for another match:

- the ranking that the local results screen shows comes from `rankMatch`, which needs the **accumulated** event
  stream; snapshots carry at most `MAX_SNAPSHOT_EVENTS` (64) events from a single tick, so a client cannot rebuild
  Last Man Standing elimination order, and it must not invent an order from fighter array positions;
- `serve:match` serves one match per process by design (documented limitation since M7), so a rematch means a new
  server process and a new join today.

Two decisions are needed: how the authoritative result reaches clients, and how a rematch is requested without
weakening the session guarantees.

## Decision

### 1. The result travels in the server-authored `match-end` message, not in the snapshot

`match-end` gains an optional payload:

```ts
{
  version: 1,
  kind: 'match-end',
  tick: number,
  result?: {
    reason: EndReason,
    winner: PlayerId | null,
    ranking: Array<{ id: PlayerId, rank: number, metric: number }>
  }
}
```

- The server computes it from its own accumulated event stream with the same `rankMatch` used by local play, so the
  server is the only place that ranks.
- The payload is **canonically omitted** when absent. An old client that ignores unknown server fields keeps working,
  and no snapshot bytes change, so the pinned Score Brawl and mode expectations stay valid.
- Ranking uses competition ranks (1, 1, 3). A shared top rank or `winner: null` means a draw, and the payload must
  say so rather than picking a winner.
- The payload is sent once per match, so its size does not affect per-tick traffic.

### 2. `rematch` is a client message with explicit guards

A new client message `rematch` asks the server for another match. It is a new **kind inside the approved v1
session envelope**, not a new envelope format: the version, sequence domain, room ownership and strict decoding
stay exactly as approved, and existing kinds keep their bytes.

- accepted only while the session phase is `results`;
- accepted only when the full original roster is still connected; otherwise the server replies with a typed error
  and stays in `results`;
- repeated requests while a rematch is already starting are idempotent, not an error storm;
- a new match keeps the same player ids and mode, resets scores, HP, timer and the event stream, and starts a fresh
  countdown;
- the capability is opt-in, not a default: the session and the `serve:match` harness both refuse `rematch` unless
  repeat matches are explicitly enabled, so existing one-shot tests, benchmark runs and runbooks keep their
  semantics.

`match-start` gains a monotonic `matchId`. Clients use it to drop stale snapshots and to clear their interpolation
buffer, so the new countdown never renders positions from the previous match.

`serve:match` stays a single-match process by default: the repeatable behaviour is a session capability, and the
harness opts into it with a flag so existing one-shot tests and runbooks keep their current semantics.

The state tick keeps counting across a rematch instead of resetting to zero. Input target ticks are absolute in the
gateway, so resetting the state tick would desynchronise the two domains; `matchId`, not the tick, is the
discriminator for "this snapshot belongs to a different match".

## Consequences

- The online client can show the same podium the local screen shows, without ranking anything itself.
- Rematch removes the "one match per server process" limitation for the harness; host migration, rejoin and
  authentication remain out of scope.
- Two server messages change shape (one gains an optional field, one gains an identifier). Both are additive and
  canonical-omission based, in the same spirit as ADR 0002, so no version bump is needed.
- A client that ignores `matchId` still works, but may show a stale frame for one snapshot interval after a rematch.
  That is a presentation bug, not a protocol violation.

## Alternatives considered

- **Send the ranking inside each results-phase snapshot.** Repeats the same bytes up to 20 times per second and
  couples the snapshot codec to a finished-match concept. Rejected.
- **Have the client accumulate `MatchEnded` and snapshot history to rank.** Requires the client to be an authority
  on the match, duplicates ordering rules in the browser and cannot work for Last Man Standing with 64-event
  batches. Rejected.
- **Bump the protocol version.** Forces every client, bot, benchmark fixture and pinned expectation to change for an
  additive field. Rejected, consistent with ADR 0002.
- **Restart the server process for a rematch.** Works today but means a reload, a new join and a new port in the
  harness; it is exactly the friction the owner asked to remove. Rejected.
