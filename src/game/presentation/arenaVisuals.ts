/**
 * Presentation-only arena art metadata. This module intentionally has no
 * imports: it must remain independent from simulation, input and networking.
 */
export type ArenaArtStyle = 'classic' | 'retro';
export type ArenaLayerId = 'sky' | 'architecture' | 'combat-surface' | 'foreground';

export interface ArenaVisualManifest {
  readonly id: string;
  readonly displayName: string;
  readonly logicalSize: { readonly width: 640; readonly height: 360 };
  readonly artSize: { readonly width: 320; readonly height: 180 };
  readonly variants: {
    readonly classic?: { readonly backdropPath: string };
    readonly retro: { readonly backdropPath: string };
  };
  readonly layers: readonly {
    readonly id: ArenaLayerId;
    readonly assetPath: string;
    readonly depth: number;
    readonly parallax?: number;
  }[];
  readonly hudContrast: 'dark' | 'light';
}

const STATION_RETRO = 'assets/station/turenki-station-retro.svg';

export const ARENA_MANIFESTS = {
  station: {
    id: 'station',
    displayName: 'Turenki railway station',
    logicalSize: { width: 640, height: 360 },
    artSize: { width: 320, height: 180 },
    variants: {
      classic: { backdropPath: 'assets/station/turenki-station-background.svg' },
      retro: { backdropPath: STATION_RETRO },
    },
    // The legacy station is a single composite backdrop, so it has no extra
    // overlay planes beyond the variant's backdropPath.
    layers: [],
    hudContrast: 'dark',
  },
  mesku: {
    id: 'mesku',
    displayName: 'Ravintola Mesku',
    logicalSize: { width: 640, height: 360 },
    artSize: { width: 320, height: 180 },
    variants: {
      retro: { backdropPath: 'assets/mesku/ravintola-mesku-evening.svg' },
    },
    // Original composite art is intentionally kept as one crisp, quiet layer;
    // the descriptor leaves room for future independent parallax planes.
    layers: [{ id: 'architecture', assetPath: 'assets/mesku/ravintola-mesku-evening.svg', depth: -100, parallax: 1 }],
    hudContrast: 'dark',
  },
} as const satisfies Readonly<Record<string, ArenaVisualManifest>>;

export type ArenaId = keyof typeof ARENA_MANIFESTS;
export const DEFAULT_ARENA_ID = 'station' as const;

/** Keep the station's established Phaser texture key as a compatibility contract. */
export function arenaBackdropTextureKey(arenaId: string): string {
  return arenaId === DEFAULT_ARENA_ID ? 'station-backdrop' : `arena-${arenaId}-backdrop`;
}

type ResolvedArenaVisual = {
  readonly manifest: ArenaVisualManifest;
  readonly style: ArenaArtStyle;
  readonly backdropPath: string;
  readonly layers: ArenaVisualManifest['layers'];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  if (extra.length) throw new Error(`${label} contains unsupported field(s): ${extra.join(', ')}`);
}

function assertAssetPath(path: unknown, label: string): asserts path is string {
  if (typeof path !== 'string' || path.trim() === '' || path.startsWith('/') || path.includes('..') || /^[a-z]+:/i.test(path)) {
    throw new Error(`${label} must be a non-empty relative public asset path`);
  }
}

/** Validate manifest input at registry boundaries and in tests. */
export function validateArenaManifest(input: unknown): asserts input is ArenaVisualManifest {
  if (!isRecord(input)) throw new Error('Arena manifest must be an object');
  assertExactKeys(input, ['id', 'displayName', 'logicalSize', 'artSize', 'variants', 'layers', 'hudContrast'], 'Arena manifest');
  if (typeof input.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(input.id)) throw new Error('Arena manifest id must be a stable lowercase identifier');
  if (typeof input.displayName !== 'string' || input.displayName.trim() === '') throw new Error(`Arena "${input.id}" needs a displayName`);
  const checkSize = (size: unknown, label: string, width: number, height: number): void => {
    if (!isRecord(size)) throw new Error(`Arena "${input.id}" ${label} must be an object`);
    assertExactKeys(size, ['width', 'height'], `${label}`);
    if (size.width !== width || size.height !== height) throw new Error(`Arena "${input.id}" ${label} must be ${width}×${height}`);
  };
  checkSize(input.logicalSize, 'logicalSize', 640, 360);
  checkSize(input.artSize, 'artSize', 320, 180);
  if (!isRecord(input.variants)) throw new Error(`Arena "${input.id}" variants must be an object`);
  assertExactKeys(input.variants, ['classic', 'retro'], `Arena "${input.id}" variants`);
  if (!isRecord(input.variants.retro)) throw new Error(`Arena "${input.id}" needs a retro variant`);
  assertExactKeys(input.variants.retro, ['backdropPath'], `Arena "${input.id}" retro variant`);
  assertAssetPath(input.variants.retro.backdropPath, `Arena "${input.id}" retro backdropPath`);
  if (input.variants.classic !== undefined) {
    if (!isRecord(input.variants.classic)) throw new Error(`Arena "${input.id}" classic variant must be an object`);
    assertExactKeys(input.variants.classic, ['backdropPath'], `Arena "${input.id}" classic variant`);
    assertAssetPath(input.variants.classic.backdropPath, `Arena "${input.id}" classic backdropPath`);
  }
  if (!Array.isArray(input.layers)) throw new Error(`Arena "${input.id}" layers must be an array`);
  for (const [index, layer] of input.layers.entries()) {
    if (!isRecord(layer)) throw new Error(`Arena "${input.id}" layer ${index} must be an object`);
    assertExactKeys(layer, ['id', 'assetPath', 'depth', 'parallax'], `Arena "${input.id}" layer ${index}`);
    if (!['sky', 'architecture', 'combat-surface', 'foreground'].includes(String(layer.id))) {
      throw new Error(`Arena "${input.id}" layer ${index} has an unknown id`);
    }
    assertAssetPath(layer.assetPath, `Arena "${input.id}" layer ${index} assetPath`);
    if (typeof layer.depth !== 'number' || !Number.isFinite(layer.depth)) throw new Error(`Arena "${input.id}" layer ${index} depth must be finite`);
    if (layer.parallax !== undefined && (typeof layer.parallax !== 'number' || !Number.isFinite(layer.parallax) || layer.parallax < 0 || layer.parallax > 1)) {
      throw new Error(`Arena "${input.id}" layer ${index} parallax must be between 0 and 1`);
    }
  }
  if (input.hudContrast !== 'dark' && input.hudContrast !== 'light') throw new Error(`Arena "${input.id}" hudContrast must be dark or light`);
}

for (const manifest of Object.values(ARENA_MANIFESTS)) validateArenaManifest(manifest);

/** Pure lookup: unknown IDs and unavailable visual variants fail descriptively. */
export function resolveArenaVisual(arenaId: string, style: ArenaArtStyle): ResolvedArenaVisual {
  const manifest = (ARENA_MANIFESTS as Readonly<Record<string, ArenaVisualManifest>>)[arenaId];
  if (!manifest) {
    throw new Error(`Unknown arena "${arenaId}". Available arenas: ${Object.keys(ARENA_MANIFESTS).join(', ')}`);
  }
  const variant = manifest.variants[style];
  if (!variant) throw new Error(`Arena "${manifest.displayName}" has no ${style} art variant`);
  return { manifest, style, backdropPath: variant.backdropPath, layers: manifest.layers };
}

export interface ArenaSelection extends ResolvedArenaVisual {
  readonly notice: string | null;
}

/** URL parsing and deliberate fallback policy are pure presentation behavior. */
export function resolveArenaSelection(search: string, style: ArenaArtStyle): ArenaSelection {
  const requestedId = new URLSearchParams(search).get('arena')?.trim() || DEFAULT_ARENA_ID;
  const requested = (ARENA_MANIFESTS as Readonly<Record<string, ArenaVisualManifest>>)[requestedId];
  if (!requested) {
    const station = resolveArenaVisual(DEFAULT_ARENA_ID, style);
    return { ...station, notice: `Unknown arena "${requestedId}"; showing ${station.manifest.displayName}.` };
  }
  try {
    return { ...resolveArenaVisual(requestedId, style), notice: null };
  } catch {
    const station = resolveArenaVisual(DEFAULT_ARENA_ID, style);
    return { ...station, notice: `Arena "${requested.displayName}" has no ${style} art; showing ${station.manifest.displayName}.` };
  }
}
