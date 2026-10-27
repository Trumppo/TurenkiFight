/** Render configuration is presentation-only; it never changes world coordinates. */
function renderSize(): { renderWidth: number; renderHeight: number } {
  // QA override: VITE_RENDER_WIDTH=960 VITE_RENDER_HEIGHT=540 npm run dev
  const width = Number(import.meta.env.VITE_RENDER_WIDTH ?? 640);
  const height = Number(import.meta.env.VITE_RENDER_HEIGHT ?? 360);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 180 || width * 9 !== height * 16) {
    throw new Error('Invalid 16:9 render resolution; use positive integer dimensions (minimum 320x180)');
  }
  return { renderWidth: width, renderHeight: height };
}

// Presentation-only settings: changing render size never changes simulation coordinates.
export const VIEWPORT = {
  logicalWidth: 384,
  logicalHeight: 216,
  ...renderSize(),
} as const;

export function cameraScale(width: number, height: number): number {
  return Math.min(width / VIEWPORT.logicalWidth, height / VIEWPORT.logicalHeight);
}
