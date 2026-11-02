# Player count: history, options and a proposed limit

**Status:** Design decision brief, 2026-11-02. Awaiting the owner's choice of the number.
**Question:** was four players a real decision, and should the game support eight, sixteen or "unlimited"?

## 1. What the repository actually says

- `docs/GAME_DESIGN.md` line 56: **"Configurable player count: no permanent hard-coded maximum. Four local players are the first milestone; test eight players and beyond before setting supported limits."**
- `docs/M1_GAMEPLAY_IMPLEMENTATION.md`: "Player count is configured from the joined roster, not baked into simulation. Support testing at eight players later; no arbitrary four-player engine limit."
- No document records an owner decision that four is the product limit. Four was the **M1 milestone scope**: four local players, four gamepads, readable HUD.

So the owner's memory is accurate: **four was never chosen as a product limit.** It hardened into one because the milestone, the HUD, the protocol caps and the tests were all built around four.

## 2. Where the limit actually lives today

| Layer | Constant / rule | Notes |
| --- | --- | --- |
| Input codec | `MAX_PLAYERS_PER_FRAME = 4` | per-tick input frame |
| Snapshot codec | `MAX_SNAPSHOT_FIGHTERS = 4` | full-state snapshot |
| Event codec | `MAX_EVENT_FIGHTERS = 4` | event batch |
| Session roster/buffer | `maxPlayers ≤ 4` | trusted ingress |
| Match server | roster 1–4 | network play |
| HUD / lobby | four slots | presentation |
| Simulation | **no cap** | accepts an arbitrary roster |

The simulation is already general. The cap is a set of independent constants that happen to share the value four.

## 3. Options

| Option | What it means | Cost | Risk |
| --- | --- | --- | --- |
| **A. Keep four** | Status quo, document it as a product limit | none | Contradicts the stated design intent, blocks the owner's eight-player test |
| **B. Support eight** | One constant derived everywhere, 1–8 roster, bots fill slots | moderate: codecs, session, server, HUD, readability | Eight fighters may be unreadable at 640×360; snapshot grows ~2× |
| **C. Support sixteen** | Same as B with a bigger ceiling | higher: HUD and readability much harder, snapshot ~4× | Very likely unplayable and hard to debug; no evidence it is worth it |
| **D. "Unlimited"** | No fixed ceiling, configured per match | open-ended | Not meaningful for a fighting game: input devices, readability, O(n²) hit checks, linear snapshot growth, and an unbounded roster is a denial-of-service surface on a server |

## 4. Recommendation: support eight, keep the ceiling explicit

**Adopt 8 as the supported maximum**, implemented as a single named constant that every layer derives from, with strict rejection above it and a clear error message. Reasons:

1. **It satisfies the stated design intent** ("no permanent hard-coded maximum", test eight before setting limits) instead of contradicting it.
2. **It matches work already specified**: the benchmark suite already defines an eight-player scenario, and the M1 robustness work exercised eight-fighter simulation scaling.
3. **It is defensible for the genre**: eight fighters in a single arena is already at the edge of readability; beyond that the screen, not the engine, is the limit.
4. **It is testable**: a single human plus seven bots can exercise it locally, which is exactly the owner's request.
5. **It keeps the door open**: because every layer derives from one constant, moving to sixteen later is a decision plus measurement, not a rewrite.

**"Unlimited" is not recommended.** A fighting game with no roster ceiling has no coherent rendering, input or fairness story, and an unbounded roster on a server is an attack surface. If the owner wants the *feeling* of no limit, the honest implementation is a configurable per-match limit with a hard ceiling; that is what option B already provides.

## 5. Consequences of choosing eight

- Snapshot size roughly doubles at eight players; measure and record it rather than estimating.
- The HUD needs an eight-slot layout; the arena needs an honest readability report at eight fighters.
- Keyboard play realistically supports four local layouts; slots 5–8 are gamepad or bot slots. This must be stated in the UI rather than left as a surprise.
- Four-player Score Brawl bytes and pinned fingerprints must stay identical: raising a cap may not change encoding for smaller rosters.
- Server play with eight needs its own load/measurement follow-up; this decision only makes the cap legal.

## 6. Decision requested

Pick one and it becomes the recorded product limit:

1. **Eight (recommended).**
2. Sixteen, accepting the readability and HUD cost.
3. Keep four and document it as a deliberate product limit, overriding the earlier design note.
