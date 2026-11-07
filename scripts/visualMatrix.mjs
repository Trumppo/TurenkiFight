import { execFileSync } from 'node:child_process';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(root, 'docs', 'visual', 'g1-matrix');
const arenas = ['station', 'kkauppa', 'mesku'];
const viewports = [
  { name: '640x360', width: 640, height: 360 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '390x844', width: 390, height: 844 },
  { name: '844x390', width: 844, height: 390 },
];
const styles = ['classic', 'retro'];
const fighterIds = ['P1', 'P2', 'P3', 'P4'];
const hudTextSelector = [
  '#match-timer', '#match-status', '.hud-player', '.hud-name', '.hud-score',
  '.hud-health', '.hud-slot-action', '.mode-control select', '.hud-actions button',
  '#zone-summary', '#station-event-status',
].join(', ');

function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
}

function expectedSelectedArena(style, requestedArena) {
  // The classic art manifest intentionally falls back to the station for Mesku.
  return style === 'classic' && requestedArena === 'mesku' ? 'station' : requestedArena;
}

async function startVite(style) {
  const previousStyle = process.env.VITE_VISUAL_STYLE;
  process.env.VITE_VISUAL_STYLE = style;
  let server;
  try {
    server = await createServer({
      configFile: resolve(root, 'vite.config.ts'),
      root,
      logLevel: 'error',
      server: { host: '127.0.0.1', port: 0, strictPort: false },
    });
    await server.listen();
    const address = server.httpServer.address();
    requireCheck(address && typeof address === 'object', `Vite did not bind a port for ${style}`);
    return { server, baseUrl: `http://127.0.0.1:${address.port}`, previousStyle };
  } catch (error) {
    if (server) await server.close();
    if (previousStyle === undefined) delete process.env.VITE_VISUAL_STYLE;
    else process.env.VITE_VISUAL_STYLE = previousStyle;
    throw error;
  }
}

async function restoreStyle(previousStyle) {
  if (previousStyle === undefined) delete process.env.VITE_VISUAL_STYLE;
  else process.env.VITE_VISUAL_STYLE = previousStyle;
}

async function totalOutputBytes() {
  const files = await readdir(outputDir);
  let total = 0;
  for (const file of files) total += (await stat(join(outputDir, file))).size;
  return total;
}

await mkdir(outputDir, { recursive: true });
const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const date = new Date().toISOString();
const captures = [];
const browser = await chromium.launch({ headless: true });

try {
  // Run the two style passes sequentially on separate, freshly allocated ports.
  for (const style of styles) {
    const { server, baseUrl, previousStyle } = await startVite(style);
    try {
      const context = await browser.newContext({ deviceScaleFactor: 1 });
      const page = await context.newPage();
      for (const requestedArena of arenas) {
        for (const viewport of viewports) {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          const query = requestedArena === 'station' ? '' : `?arena=${requestedArena}`;
          await page.goto(`${baseUrl}/${query}`, { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => {
            const scene = window.__turenkiGame?.scene?.getScene('StationScene');
            const arena = scene?.arenaSelection?.manifest?.id;
            const textureKey = arena === 'station' ? 'station-backdrop' : `arena-${arena}-backdrop`;
            return !!scene?.sys?.isActive() && !!arena && scene.textures.exists(textureKey);
          });

          const selectedArena = await page.evaluate(async ({ fighterIds, requestedArena }) => {
            const game = window.__turenkiGame;
            const scene = game.scene.getScene('StationScene');
            const sim = await import('/src/game/simulation/step.ts');
            const selected = scene.arenaSelection.manifest.id;
            scene.state = sim.createState(fighterIds, 'fighting', {
              ...(selected === 'station' ? {} : { arena: selected }),
            });
            scene.drawFighters();
            scene.renderDomHud();
            return {
              selected,
              requested: requestedArena,
              fighterCount: scene.state.fighters.length,
              canvas: [game.canvas.width, game.canvas.height],
            };
          }, { fighterIds, requestedArena });
          const expectedArena = expectedSelectedArena(style, requestedArena);
          requireCheck(selectedArena.selected === expectedArena,
            `${style}/${requestedArena}/${viewport.name}: selected ${selectedArena.selected}, expected ${expectedArena}`);
          requireCheck(selectedArena.fighterCount === 4,
            `${style}/${requestedArena}/${viewport.name}: expected four fighters, got ${selectedArena.fighterCount}`);
          requireCheck(JSON.stringify(selectedArena.canvas) === JSON.stringify([640, 360]),
            `${style}/${requestedArena}/${viewport.name}: logical canvas is ${selectedArena.canvas.join('x')}, expected 640x360`);

          // Give the browser two frames to paint the state and its responsive HUD.
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const semantics = await page.evaluate(({ width, height, hudTextSelector }) => {
            const visible = (element) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden'
                && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
            };
            const hud = document.querySelector('#fight-hud');
            const hudRect = hud?.getBoundingClientRect();
            const hudInside = !!hudRect && hudRect.left >= 0 && hudRect.top >= 0
              && hudRect.right <= width && hudRect.bottom <= height;
            const textNodes = [...document.querySelectorAll(hudTextSelector)]
              .filter(element => visible(element) && (element.textContent ?? '').trim().length > 0);
            const fontSizes = textNodes.map(element => ({
              selector: element.tagName.toLowerCase() + (element.id ? `#${element.id}` : '')
                + (element.classList.length ? `.${[...element.classList].join('.')}` : ''),
              size: Number.parseFloat(getComputedStyle(element).fontSize),
            }));
            const outOfBounds = [...(hud ? [hud, ...hud.querySelectorAll('*')] : [])]
              .filter(visible)
              .map(element => ({
                selector: element.tagName.toLowerCase() + (element.id ? `#${element.id}` : '')
                  + (element.classList.length ? `.${[...element.classList].join('.')}` : ''),
                rect: (() => {
                  const rect = element.getBoundingClientRect();
                  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
                })(),
              }))
              .filter(item => item.rect.left < 0 || item.rect.top < 0 || item.rect.right > width || item.rect.bottom > height);
            return { hudInside, fontSizes, outOfBounds };
          }, { width: viewport.width, height: viewport.height, hudTextSelector });
          requireCheck(semantics.hudInside && semantics.outOfBounds.length === 0,
            `${style}/${requestedArena}/${viewport.name}: HUD outside viewport: ${JSON.stringify(semantics.outOfBounds)}`);
          requireCheck(semantics.fontSizes.length > 0,
            `${style}/${requestedArena}/${viewport.name}: no visible HUD text to size-check`);
          const smallText = semantics.fontSizes.filter(item => item.size < 14);
          requireCheck(smallText.length === 0,
            `${style}/${requestedArena}/${viewport.name}: HUD text below 14 CSS px: ${JSON.stringify(smallText)}`);

          const filename = `${style}-${requestedArena}-${viewport.name}.png`;
          const path = join(outputDir, filename);
          await page.screenshot({ path, animations: 'disabled' });
          const bytes = (await stat(path)).size;
          captures.push({
            file: filename,
            size: viewport.name,
            width: viewport.width,
            height: viewport.height,
            style,
            arena: requestedArena,
            selectedArena,
            fighterCount: 4,
            bytes,
          });
          console.log(`Captured ${filename} (${bytes} bytes)`);
        }
      }
      await context.close();
    } finally {
      await server.close();
      await restoreStyle(previousStyle);
    }
  }
} finally {
  await browser.close();
}

const manifest = {
  task: 'GRAPHICS-G1-EVAL-BASELINE',
  commitSha,
  date,
  logicalCanvas: { width: 640, height: 360 },
  captures,
};
await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const rows = captures.map(capture =>
  `| ${capture.style} | ${capture.arena} | ${capture.size} | ${capture.fighterCount} | ${capture.selectedArena.selected} | [${capture.file}](./${capture.file}) | ${(capture.bytes / 1024).toFixed(1)} KiB |`,
).join('\n');
const captureBytes = captures.reduce((sum, capture) => sum + capture.bytes, 0);
const index = `# G1 visual evaluation matrix\n\nGenerated ${date} from commit \`${commitSha}\`. Each capture uses a 640×360 logical canvas and four fighters. The classic Mesku request intentionally resolves to the station art because Mesku is only available in the retro manifest.\n\nSemantic checks: logical canvas size, selected arena (including documented classic Mesku fallback), visible HUD bounds, and visible HUD text at least 14 CSS px. No screenshot or cross-platform pixel comparisons are used.\n\nCaptures: ${captures.length} PNGs, ${(captureBytes / 1024 / 1024).toFixed(2)} MiB total (${captureBytes.toLocaleString()} bytes).\n\n| Style | Requested arena | Viewport | Fighters | Selected arena | Capture | Size |\n|---|---|---:|---:|---|---|---:|\n${rows}\n`;
await writeFile(join(outputDir, 'README.md'), index);
const totalBytes = await totalOutputBytes();
console.log(`Wrote ${captures.length} captures to docs/visual/g1-matrix/ (${captureBytes.toLocaleString()} PNG bytes; ${totalBytes.toLocaleString()} total bytes including manifest and index).`);
