# Repository setup and CI

## Implemented in repository

- TypeScript + Vite + Phaser 3 prototype.
- Vitest unit tests.
- Playwright Chromium smoke test, run by `npm run test:browser`.
- GitHub Actions `ci.yml` on pushes and pull requests.
- GitHub Actions `deploy.yml` builds and deploys to GitHub Pages on main.
- Issue and pull request templates.
- Preliminary network benchmark results and an open WebSocket-vs-WebRTC decision.

## Required GitHub repository settings (not configurable through current connector)

1. **Settings → Pages → Build and deployment → Source → GitHub Actions**.
2. **Settings → Actions → General:** allow GitHub Actions and the listed marketplace actions; use least-privilege default workflow permissions where possible.
3. **Settings → Branches / Rules → main:** consider a ruleset requiring the `quality` and `browser-smoke` checks before merging once they have passed at least once. Do not enable a rule that blocks the only maintainer before CI is validated.
4. Check **Actions** for failures after enabling Pages; browser test requires downloading Chromium in the runner.
5. For public repository security, enable Dependabot alerts and secret scanning where available.

## Local commands

```bash
npm install
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

The GitHub-hosted browser tests establish that a real browser can render the prototype; they **do not** benchmark WebRTC or prove a WebSocket-vs-WebRTC winner. For the actual comparative benchmark, implement both transport candidates against a common simulation, then collect measurements as defined in [NETWORK_BENCHMARK_PLAN.md](NETWORK_BENCHMARK_PLAN.md).

## Important limitations

GitHub Pages only hosts the static frontend. It cannot host a long-lived authoritative WebSocket server, signaling service or TURN relay. Those require a separate machine or service for online play. An offline LAN needs locally hosted static files and backend components.
