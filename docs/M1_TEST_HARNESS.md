# M1 Game Test Harness

Run on GitHub Actions without a local PC: **Actions → Game Test Harness → Run workflow**. On completion open the run's **Artifacts → game-harness-report**, download the archive and open `playwright-report/index.html` in a browser. GitHub's artifact archive is downloadable on mobile, but the HTML report is not directly hosted as a public URL.

The harness reuses Playwright and Chromium, injects virtual standard gamepads before page load, joins P2–P4, starts as P1, advances the actual Phaser scene until results, captures lobby/results/mobile screenshots and a final state attachment. Browser exceptions and HTTP 4xx/5xx are failures. Existing browser tests remain unchanged.

**Boundaries:** Gamepad API simulation does not verify physical hardware. A complete match with neutral inputs verifies clock, transitions and rendering, not bot intelligence or combat balance. Deterministic replay is independently covered by gameplay unit tests; the browser harness does not claim a byte-for-byte replay fingerprint. Screenshot capture is not visual approval; baseline image comparisons may be added after human approval.

Report and traces: HTML + list/GitHub reporter, traces on failure, video on failure, screenshot attachments. PR runs and manual dispatch are supported. No production gameplay hooks or game rule changes.
