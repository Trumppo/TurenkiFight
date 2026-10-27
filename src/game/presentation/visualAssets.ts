/** Presentation-only asset manifest. Paths are relative to the Vite public root. */
export const VISUAL_ASSETS = {
  station: {
    backdrop: { key: 'station-backdrop', path: 'assets/station/turenki-station-background.svg', width: 384, height: 216 },
  },
} as const;

/** Resolve a public asset against Vite's base path, including GitHub Pages subpaths. */
export function publicAssetUrl(baseUrl: string, path: string): string {
  if (!baseUrl || !path || path.startsWith('/') || path.includes('..') || /^[a-z]+:/i.test(path)) {
    throw new Error('Invalid presentation asset base or path');
  }
  return `${baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'}${path}`;
}
