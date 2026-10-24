// Presentation-only settings: changing render size never changes simulation coordinates.
export const VIEWPORT = {
  logicalWidth: 384,
  logicalHeight: 216,
  renderWidth: 640,
  renderHeight: 360,
} as const;

export function cameraScale(width: number, height: number): number {
  return Math.min(width / VIEWPORT.logicalWidth, height / VIEWPORT.logicalHeight);
}
