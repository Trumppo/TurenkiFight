import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARENA_MANIFESTS, resolveArenaSelection, resolveArenaVisual, validateArenaManifest, type ArenaVisualManifest } from './arenaVisuals';

describe('presentation arena visual manifests', () => {
  it('validates the station as a data-only 640×360 / 320×180 manifest', () => {
    expect(() => validateArenaManifest(ARENA_MANIFESTS.station)).not.toThrow();
    expect(ARENA_MANIFESTS.station.logicalSize).toEqual({ width: 640, height: 360 });
    expect(ARENA_MANIFESTS.station.artSize).toEqual({ width: 320, height: 180 });
    expect(ARENA_MANIFESTS.station.hudContrast).toBe('dark');
  });

  it('validates Mesku as an independent retro-only visual manifest', () => {
    expect(() => validateArenaManifest(ARENA_MANIFESTS.mesku)).not.toThrow();
    expect(ARENA_MANIFESTS.mesku.displayName).toBe('Ravintola Mesku');
    expect(ARENA_MANIFESTS.mesku.variants.retro.backdropPath).toBe('assets/mesku/ravintola-mesku-evening.svg');
    expect(() => resolveArenaVisual('mesku', 'classic')).toThrow(/no classic art variant/);
  });

  it('points every declared variant and layer at a shipped public asset', () => {
    for (const manifest of Object.values(ARENA_MANIFESTS) as ArenaVisualManifest[]) {
      const paths = [
        manifest.variants.classic?.backdropPath,
        manifest.variants.retro.backdropPath,
        ...manifest.layers.map(layer => layer.assetPath),
      ].filter((path): path is string => !!path);
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
    expect(() => validateArenaManifest(badSize)).toThrow(/logicalSize must be 640×360/);

    const badLayer = structuredClone(ARENA_MANIFESTS.mesku) as any;
    badLayer.layers[0].depth = Number.NaN;
    expect(() => validateArenaManifest(badLayer)).toThrow(/depth must be finite/);

    const gameplayField = { ...copy(), collision: [] };
    expect(() => validateArenaManifest(gameplayField)).toThrow(/unsupported field.*collision/);
  });

  it('resolves the existing classic and retro station assets without changing their paths', () => {
    expect(resolveArenaVisual('station', 'classic').backdropPath)
      .toBe('assets/station/turenki-station-background.svg');
    expect(resolveArenaVisual('station', 'retro').backdropPath)
      .toBe('assets/station/turenki-station-retro.svg');
  });

  it('fails with an explicit list when an arena ID is unknown', () => {
    expect(() => resolveArenaVisual('missing', 'retro'))
      .toThrow('Unknown arena "missing". Available arenas: station, mesku');
  });

  it('keeps station as the default and reports a clear station fallback for unknown URLs', () => {
    expect(resolveArenaSelection('', 'retro').manifest.id).toBe('station');
    const fallback = resolveArenaSelection('?arena=not-real', 'retro');
    expect(fallback.manifest.id).toBe('station');
    expect(fallback.notice).toBe('Unknown arena "not-real"; showing Turenki railway station.');
  });

  it('keeps Mesku available in retro mode and reports classic-mode fallback', () => {
    expect(resolveArenaSelection('?arena=mesku', 'retro').manifest.id).toBe('mesku');
    expect(resolveArenaSelection('?arena=mesku', 'classic').notice)
      .toBe('Arena "Ravintola Mesku" has no classic art; showing Turenki railway station.');
  });

  it('has no simulation, input, physics or collision dependencies', () => {
    const source = readFileSync(new URL('./arenaVisuals.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+['"].*\/(simulation|input|networking)\//);
    expect(source).not.toMatch(/\b(collision|physics|spawnPoints|inputBindings)\s*:/);
  });
});
