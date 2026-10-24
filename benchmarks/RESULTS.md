# Network benchmark results – preliminary run 001

**Date:** 2026-10-24  
**Status:** INCOMPLETE. Not a WebSocket vs WebRTC winner decision.

## What was actually executed

A local WebSocket echo microbenchmark was run in the assistant's container using Python 3, `aiohttp` WebSocket server and `aiohttp` client sessions, all bound to `127.0.0.1`. For each client-count case, every client sent 100 JSON messages sequentially at ~10 ms intervals, waited for the server to return `{seq,tick,x+1}`, and checked the response. The reported timings are round-trip wall-clock measurements using `time.perf_counter_ns()`.

| Clients | Total messages | p50 RTT ms | p95 RTT ms | p99 RTT ms | Incorrect / missing |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 200 | 0.189 | 0.504 | 0.953 | 0 |
| 4 | 400 | 0.273 | 0.714 | 1.256 | 0 |
| 8 | 800 | 0.354 | 0.795 | 1.039 | 0 |
| 12 | 1200 | 0.541 | 1.166 | 1.368 | 0 |
| 16 | 1600 | 0.652 | 1.387 | 2.700 | 0 |

**Important limitations:** one run per case, local loopback, Python server rather than planned TypeScript server, no actual 60 Hz authoritative game simulation, no snapshot fanout, no packet impairment, no remote network, no actual browser rendering, no connection setup timing. These numbers are **not** estimates of real multiplayer latency, server capacity or comparative WebSocket advantage.

## WebRTC attempt and blocker

An automated real-Chromium WebRTC DataChannel test was prepared using Playwright and the system Chromium binary. Browser navigation failed with `net::ERR_BLOCKED_BY_ADMINISTRATOR` for both `http://127.0.0.1:<port>/` and a `data:` URL in the execution environment. The initial Playwright browser executable path was also unavailable, but using the installed Chromium binary got past that first issue. The navigation policy still prevented the test from executing.

**WebRTC measurement result: NOT MEASURED.** No performance comparison or architectural selection can be made from this run.

## Next experiment required

1. Execute both real-browser transports on an unrestricted developer machine or CI runner that allows Chromium, local HTTP and WebRTC ICE.
2. Use the same TypeScript authoritative simulation and protocol in both variants; test browser-host star and central WS.
3. Measure 4/8/12/16 players, real LAN and internet, 60 Hz sim, 20 Hz snapshots, 120 s matches, >= 5 repeats per key case.
4. Add CPU, upload bandwidth, host exit, TURN fallback, packet loss and NAT cases.
5. Store raw results and record the architecture decision only after evidence exists.

**Decision:** OPEN. See [test plan](../docs/NETWORK_BENCHMARK_PLAN.md).
