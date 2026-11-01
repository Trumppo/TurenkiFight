# Headless bot client (M7)

Task: M7-BOT-CLIENT. Specification: [docs/M7_ONLINE_TEST_HARNESS.md](../../docs/M7_ONLINE_TEST_HARNESS.md) §3.3 and §3.4.

A bot is a plain Node process that joins real player slots on the real-match
server (`npm run serve:match`), plays canonical inputs and writes **one** JSON
manifest describing what it measured on its own socket. It is the cheapest way
for a remote agent to play: no browser, no GPU, no rendering. It uses the same
`SessionClientCore` and session envelope as the browser adapter, so protocol
behaviour is identical; only the socket implementation (Node `ws`) differs.

It does **not** predict, reconcile, step the simulation, change match rules or
select a network transport.

## Command

```bash
npm run bot -- --url=ws://HOST:PORT --players=P2,P3,P4 --pattern=fixture --ticks=7200 --out=benchmarks/out/bot-p234.json
```

One process owns one socket and claims the slots in `--players` (1–4). Start
`npm run serve:match -- --players=4` first and put a human client in P1 (or run
three bot processes for P2–P4). The match starts when every configured slot is
claimed.

| Option | Meaning |
| --- | --- |
| `--url=<ws://host:port>` | Match server URL. Required. `ws://` only; the prototype has no TLS. |
| `--players=P2,P3,P4` | Slots this socket claims. Required, unique, 1–4 entries. |
| `--pattern=fixture\|wander` | Input source (default `fixture`). |
| `--ticks=<1-7200>` | Authoritative ticks to play before exiting (default 7200 = one full 120 s match). |
| `--seed=<1-4294967295>` | `wander` seed (default 1337). Rejected with `fixture`, whose seed comes from the committed fixture. |
| `--ping-interval-ms=<ms>` | Ping period for RTT sampling (default 250). |
| `--timeout-ms=<ms>` | Whole-run hang guard (default 30 s + the planned ticks). |
| `--out=<path>` | Manifest path (default `benchmarks/out/bot-<runId>.json`). An existing file is never overwritten. |
| `--path=loopback\|lan\|vm\|internet` | Network path label supplied by the operator. A loopback URL defaults to `loopback`; anything else stays `NOT_SUPPLIED`. |
| `--record-address` | Store the server URL in the manifest. Off by default. |
| `--help` | Usage text. |

### Patterns

- **`fixture`** replays this socket's slice of the committed `BASE-4-60-20`
  fixture: the same deterministic 60 Hz inputs the benchmark roles drive, so a
  bot run is reproducible and comparable. It requires the server to start at
  tick 0, which this prototype always does.
- **`wander`** is a small, seeded, per-player pseudo-random walk (direction holds
  of 0.4–1.4 s, occasional jump/punch/kick) so a human opponent sees movement
  instead of idle fighters. Same seed and players ⇒ same inputs. It is not an AI.

Input is sent one canonical envelope per tick, two to eight ticks ahead of the
authoritative tick, exactly as any client would.

## Exit behaviour

| Code | Meaning |
| --- | --- |
| `0` | The authoritative match completed, or the `--ticks` bound was reached. A manifest is written. |
| `2` | Invalid arguments; usage is printed. No socket is opened. |
| `1` | Failed join, wrong grant, connect error, timeout, transport/session loss or an unwritable manifest. One stderr line; **no manifest**. |

The process sets `process.exitCode` and clears every timer before exiting; it
never calls `process.exit`, so a pending close handshake is not truncated.

A socket that joins as the first player is the host. By the prototype's
documented rule, a host disconnect terminates the session (`session-closed:
host-lost`), so put the human in first when bots are expected to finish at
different times.

## Manifest honesty

`benchmarks/out/bot-*.json` is written by the bot about itself. It contains:

- provenance: `command`, sanitised `cliArguments`, role, pattern, player ids,
  planned and achieved ticks, commit SHA, Node/OS/arch, fixture and exact
  schedule SHA-256, seed, snapshot Hz and server tick rate as announced by
  `match-start`, and the network path **label**;
- `scope.clientViewNote`: the file states that RTT, snapshot inter-arrival and
  byte counts describe this client's own socket view, and that server-internal
  tick timing, queueing and other players' links are not observable here;
- `scope.noPredictionNote`: no prediction, so latency is RTT plus up to one
  snapshot interval;
- `metrics.rtt` / `snapshotInterArrival`: nearest-rank p50/p95/p99 and max over
  actually observed samples, in milliseconds, from a monotonic clock;
- `metrics.bandwidth`: counted UTF-8 frame bytes at the socket boundary, the
  measured wall-clock window, derived bytes/second and a per-second series whose
  sums must equal the totals;
- `metrics.inputs`: envelopes submitted, observed denials by code, `late-tick`
  count, and `accepted = submitted − denied` with `acceptedBasis` making that
  derivation explicit (the server does not acknowledge accepted input);
- `metrics.disconnects`: session-close reasons and transport closures observed
  before completion.

Rules enforced by `validateBotManifest` and the tests:

- a field is either `MEASURED` with real samples or `NOT_MEASURED` with a
  reason; zero is never a stand-in for "no sample";
- percentiles are monotonic and are observed samples; a byte rate must be
  reproducible from its own bytes and window; per-second sums must match totals;
  `accepted` must equal `submitted − denied`;
- the honesty notes are literal strings, so a manifest cannot quietly drop them;
- the server address is `NOT_RECORDED` and no argument may contain a `ws://`
  URL unless the operator passed `--record-address`.

Everything the client *cannot* see stays unseen: there is no server tick
duration, queue depth, packet loss or "internet" estimate in this file. A
loopback run says `loopback`; a LAN number is never generalised to the internet.

## Verification

`tests/m7-bot-client.test.ts` covers:

- three bots plus a fourth in-process client on a real `startMatchServer`:
  roster fills, the match runs to the tick bound, every manifest validates and
  records zero denials/late ticks with non-empty RTT, inter-arrival and
  bandwidth samples;
- a fake server that grants the wrong slot → `grant-mismatch`, exit 1, no file;
- a second claim on an owned slot → `join-denied`;
- a closed port → `connect-failed`, exit 1, no file;
- deterministic fixture/wander schedules and the CLI parser;
- malformed manifest mutations (percentiles, rates, per-second sums, accepted
  counts, path labels, honesty notes, address leakage) are rejected.

## Notes and limits

- The roster is frozen once the match starts: a bot that connects too late is
  denied (`match-started`) and exits 1. Start the bots while the lobby is open.
- A server started with `--start=manual` waits for an operator `start`; bots do
  not (and cannot) request the start, so they time out if nobody types it.
- The bot claims exactly the slots the server granted. `SessionClientCore` also
  rejects input for an unowned slot, so a compromised or mistaken schedule
  cannot speak for another player.
- The client only sees its own connection. It records no server tick duration,
  queue depth, loss, or cross-player timing; those are other tools' jobs.
- Frames are text JSON, so the byte counts are UTF-8 payload lengths only; the
  WebSocket frame headers are not observable from inside the client and are not
  included.

## Security

Plain `ws://` has no TLS, authentication, origin checks or rate limiting. Use it
on a LAN, a VPN (Tailscale/ZeroTier) or an SSH tunnel, never on the open
internet.
