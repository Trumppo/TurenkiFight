import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARENA_MANIFESTS, resolveArenaSelection, resolveArenaVisual, validateArenaManifest, type ArenaVisualManifest } from './arenaVisuals';

describe('presentation arena visual manifests', () => {
  it('validates every arena as a data-only 640x360 / 320x180 retro manifest', () => {
    for (const manifest of Object.values(ARENA_MANIFESTS)) {
      expect(() => validateArenaManifest(manifest)).not.toThrow();
      expect(manifest.logicalSize).toEqual({ width: 640, height: 360 });
      expect(manifest.artSize).toEqual({ width: 320, height: 180 });
      expect(manifest.variants.retro.backdropPath).toMatch(/\.svg$/);
      expect(manifest.hudContrast).toBe('dark');
    }
  });

  it('registers all supported retro arenas and their shipped assets', () => {
    expect(Object.keys(ARENA_MANIFESTS)).toEqual(['station', 'mesku', 'kkauppa']);
    expect(resolveArenaVisual('station').backdropPath).toBe('assets/station/turenki-station-retro.svg');
    expect(resolveArenaVisual('mesku').backdropPath).toBe('assets/mesku/ravintola-mesku-evening.svg');
    expect(resolveArenaVisual('kkauppa').backdropPath).toBe('assets/kkauppa/k-kauppa-retro.svg');
    for (const manifest of Object.values(ARENA_MANIFESTS) as ArenaVisualManifest[]) {
      const paths = [manifest.variants.retro.backdropPath, ...manifest.layers.map(layer => layer.assetPath)];
      for (const path of paths) expect(existsSync(resolve(process.cwd(), 'public', path)), path).toBe(true);
    }
  });

  it('rejects malformed asset paths, dimensions, layers and non-visual fields', () => {
    const copy = (): ArenaVisualManifest => structuredClone(ARENA_MANIFESTS.station);
    const badPath = copy() as any;
    badPath.variants.retro.backdropPath = '../private.svg';
    expect(() => validateArenaManifest(badPath)).toThrow(/relative public asset path/);
    const badSize = copy() as any;
    badSize.logicalSize.width = 384;
    expect(() => validateArenaManifest(badSize)).toThrow(/logicalSize must be 640/);
    const badLayer = structuredClone(ARENA_MANIFESTS.mesku) as any;
    badLayer.layers[0].depth = Number.NaN;
    expect(() => validateArenaManifest(badLayer)).toThrow(/depth must be finite/);
    const gameplayField = { ...copy(), collision: [] };
    expect(() => validateArenaManifest(gameplayField)).toThrow(/unsupported field.*collision/);
  });

  it('resolves every URL selection as retro and keeps station as the default', () => {
    expect(resolveArenaSelection('').manifest.id).toBe('station');
    expect(resolveArenaSelection('').style).toBe('retro');
    expect(resolveArenaSelection('?arena=mesku').manifest.id).toBe('mesku');
    expect(resolveArenaSelection('?arena=kkauppa').manifest.id).toBe('kkauppa');
    const fallback = resolveArenaSelection('?arena=not-real');
    expect(fallback.manifest.id).toBe('station');
    expect(fallback.notice).toBe('Unknown arena "not-real"; showing Turenki railway station.');
  });

  it('fails with an explicit list when an arena ID is unknown', () => {
    expect(() => resolveArenaVisual('missing'))
      .toThrow('Unknown arena "missing". Available arenas: station, mesku, kkauppa');
  });

  it('has no simulation, input, physics or collision dependencies', () => {
    const source = readFileSync(new URL('./arenaVisuals.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+['"].*\/(simulation|input|networking)\//);
    expect(source).not.toMatch(/\b(collision|physics|spawnPoints|inputBindings)\s*:/);
  });
});
