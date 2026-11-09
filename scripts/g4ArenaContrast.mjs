import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = process.argv[2];
if (!['before', 'after'].includes(stage)) throw new Error('Usage: node scripts/g4ArenaContrast.mjs before|after');
const outputDir = join(root, 'docs', 'visual', 'g4-arena-contrast', stage);
const styles = ['classic', 'retro'];
const arenas = ['station', 'kkauppa', 'mesku'];
const counts = [4, 8];
const viewports = [
  { name: '640x360', width: 640, height: 360 },
  { name: '1280x720', width: 1280, height: 720 },
];

function assert(value, message) { if (!value) throw new Error(message); }

function linear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]) { return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b); }
function ratio(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function hex(rgb) { return `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`; }

// Playwright's PNGs are RGBA, 8-bit, non-interlaced. Decode the standard PNG
// row filters so the metric reads the exact raster written as capture evidence.
function decodePng(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert(bytes.subarray(0, 8).equals(signature), 'Unexpected screenshot PNG signature');
  let width, height, colorType, bitDepth, interlace;
  const data = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset); offset += 4;
    const type = bytes.toString('ascii', offset, offset + 4); offset += 4;
    const chunk = bytes.subarray(offset, offset + length); offset += length + 4;
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      bitDepth = chunk[8]; colorType = chunk[9]; interlace = chunk[12];
    } else if (type === 'IDAT') data.push(chunk);
    else if (type === 'IEND') break;
  }
  assert(bitDepth === 8 && [2, 6].includes(colorType) && interlace === 0, 'Expected 8-bit RGB/RGBA PNG screenshot');
  const raw = inflateSync(Buffer.concat(data));
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const pixels = Buffer.alloc(height * stride);
  let input = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[input++];
    for (let x = 0; x < stride; x++) {
      const value = raw[input++];
      const left = x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? pixels[(y - 1) * stride + x - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upperLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upperLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
      } else assert(filter === 0, `Unsupported PNG filter ${filter}`);
      pixels[y * stride + x] = (value + predictor) & 0xff;
    }
  }
  return { width, height, pixels, stride, bytesPerPixel };
}

function pixel(image, x, y) {
  x = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  y = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const i = y * image.stride + x * image.bytesPerPixel;
  return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]];
}

function percentile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}

async function launchStyle(browser, style) {
  const oldStyle = process.env.VITE_VISUAL_STYLE;
  process.env.VITE_VISUAL_STYLE = style;
  let server;
  try {
    server = await createServer({
      configFile: resolve(root, 'vite.config.ts'), root, logLevel: 'error',
      server: { host: '127.0.0.1', port: 0, strictPort: false },
    });
    await server.listen();
    const address = server.httpServer.address();
    assert(address && typeof address === 'object', `Vite failed to bind for ${style}`);
    return { server, baseUrl: `http://127.0.0.1:${address.port}`, oldStyle };
  } catch (error) {
    if (server) await server.close();
    if (oldStyle === undefined) delete process.env.VITE_VISUAL_STYLE;
    else process.env.VITE_VISUAL_STYLE = oldStyle;
    throw error;
  }
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const captures = [];
try {
  for (const style of styles) {
    const { server, baseUrl, oldStyle } = await launchStyle(browser, style);
    try {
      const context = await browser.newContext({ deviceScaleFactor: 1 });
      const page = await context.newPage();
      for (const requestedArena of arenas) for (const count of counts) for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const query = requestedArena === 'station' ? '' : `?arena=${requestedArena}`;
        await page.goto(`${baseUrl}/${query}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => {
          const scene = window.__turenkiGame?.scene?.getScene('StationScene');
          const id = scene?.arenaSelection?.manifest?.id;
          return !!scene?.sys?.isActive() && !!id && window.__turenkiGame.canvas.width === 640;
        });
        const ids = Array.from({ length: count }, (_, i) => `P${i + 1}`);
        const setup = await page.evaluate(async ids => {
          const sim = await import('/src/game/simulation/step.ts');
          const game = window.__turenkiGame;
          const scene = game.scene.getScene('StationScene');
          const selected = scene.arenaSelection.manifest.id;
          scene.state = sim.createState(ids, 'fighting', selected === 'station' ? {} : { arena: selected });
          scene.drawFighters();
          scene.sys.pause();
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const camera = scene.cameras.main;
          const rect = game.canvas.getBoundingClientRect();
          return {
            selected, backing: [game.canvas.width, game.canvas.height],
            camera: { zoom: camera.zoom, x: camera.worldView.x, y: camera.worldView.y },
            css: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            fighters: [...scene.fighterSprites].map(([id, sprite]) => ({
              id, x: sprite.x, y: sprite.y, width: sprite.displayWidth, height: sprite.displayHeight,
            })),
          };
        }, ids);
        const expected = style === 'classic' && requestedArena === 'mesku' ? 'station' : requestedArena;
        assert(setup.selected === expected, `${style}/${requestedArena} selected ${setup.selected}, expected ${expected}`);
        assert(setup.backing[0] === 640 && setup.backing[1] === 360, 'Logical canvas backing changed');
        assert(setup.fighters.length === count, `${style}/${requestedArena}: expected ${count} fighters`);

        const stem = `${style}-${requestedArena}-${count}p-${viewport.name}`;
        const visibleBytes = await page.screenshot({ animations: 'disabled', timeout: 0, fullPage: false });
        await writeFile(join(outputDir, `${stem}.png`), visibleBytes);
        await page.evaluate(() => {
          const scene = window.__turenkiGame.scene.getScene('StationScene');
          for (const object of [...scene.fighterSprites.values(), ...scene.shadows.values()]) object.setVisible(false);
          for (const marker of scene.fighterMarkers.values()) { marker.face.setVisible(false); marker.label.setVisible(false); }
        });
        const backgroundBytes = await page.screenshot({ animations: 'disabled', timeout: 0, fullPage: false });
        await page.evaluate(() => {
          const scene = window.__turenkiGame.scene.getScene('StationScene');
          for (const object of [...scene.fighterSprites.values(), ...scene.shadows.values()]) object.setVisible(true);
          for (const marker of scene.fighterMarkers.values()) { marker.face.setVisible(true); marker.label.setVisible(true); }
        });

        const front = decodePng(visibleBytes), back = decodePng(backgroundBytes);
        assert(front.width === back.width && front.height === back.height, 'Capture dimensions changed during measurement');
        assert(front.width === viewport.width && front.height === viewport.height,
          `Expected ${viewport.name} full-viewport capture, got ${front.width}x${front.height}`);
        const scaleX = setup.camera.zoom * setup.css.width / setup.backing[0];
        const scaleY = setup.camera.zoom * setup.css.height / setup.backing[1];
        const fighterMetrics = setup.fighters.map(({ id, x, y, width, height }) => {
          // Sample the full sprite bounds (not the player marker or floor shadow).
          // Only pixels changed by the visible sprite are paired with the exact
          // same raster positions in the background-only capture.
          const centerX = setup.css.x + (x - setup.camera.x) * scaleX;
          const left = centerX - width * scaleX * 0.5;
          const right = centerX + width * scaleX * 0.5;
          const top = setup.css.y + (y - height - setup.camera.y) * scaleY;
          const bottom = setup.css.y + (y - setup.camera.y) * scaleY;
          const ratios = [];
          const colors = new Map();
          let changedPixels = 0;
          for (let py = Math.floor(top); py < Math.ceil(bottom); py++) for (let px = Math.floor(left); px < Math.ceil(right); px++) {
            const a = pixel(front, px, py), b = pixel(back, px, py);
            if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) continue;
            changedPixels++;
            const key = a.join(',');
            colors.set(key, (colors.get(key) ?? 0) + 1);
            ratios.push(ratio(a, b));
          }
          assert(ratios.length > 0, `${id} sprite sample was fully occluded or empty`);
          const dominant = [...colors].sort((a, b) => b[1] - a[1])[0];
          return {
            id, dominantForeground: hex(dominant[0].split(',').map(Number)), dominantPixelCount: dominant[1], changedPixels,
            silhouetteP10: Number(percentile(ratios, 0.1).toFixed(2)),
            silhouetteMedian: Number(percentile(ratios, 0.5).toFixed(2)),
            silhouettePixelsAtLeast3To1: Math.round(100 * ratios.filter(value => value >= 3).length / ratios.length),
          };
        });
        captures.push({ file: `${stem}.png`, style, arena: requestedArena, selectedArena: setup.selected,
          fighterCount: count, viewport: viewport.name, screenshot: [front.width, front.height], fighterMetrics });
        console.log(`Captured ${stem}.png`);
      }
      await context.close();
    } finally {
      await server.close();
      if (oldStyle === undefined) delete process.env.VITE_VISUAL_STYLE;
      else process.env.VITE_VISUAL_STYLE = oldStyle;
    }
  }
} finally {
  await browser.close();
}

await writeFile(join(outputDir, 'measurements.json'), `${JSON.stringify({
  task: 'GRAPHICS-G4-ARENA-CONTRAST', stage, method: 'Paired full-viewport captures at 640x360 and 1280x720. Every changed pixel within each fighter sprite bounds (marker labels and floor shadows excluded) is compared to the same raster position in a background-only capture using WCAG relative luminance; report p10, median, and share at or above 3:1.', captures,
}, null, 2)}\n`);
console.log(`Wrote ${captures.length} captures and contrast samples to ${outputDir}`);
