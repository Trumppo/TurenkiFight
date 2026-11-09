import Phaser from 'phaser';

/**
 * Contrast target for the small, persistent player-ID tags on both arena styles.
 * Markers live on the 640x360 logical canvas, so their type is sized for that canvas
 * rather than for DOM text. HUD text keeps its own 14 px minimum.
 */
export const FIGHTER_MARKER_CONTRAST_THRESHOLD = 3;
export const FIGHTER_MARKER_TEXT_SIZE = 12;
export const FIGHTER_MARKER_FACE = 0xfff1b7;
export const FIGHTER_MARKER_OUTLINE = 0x101820;

/** Combat-plane base fills sampled from the unchanged arena SVG backgrounds. */
export const FIGHTER_MARKER_FLOORS = {
  stationClassic: 0x76786f,
  stationRetro: 0x6f7470,
  kkauppaClassic: 0x7d8580,
  kkauppaRetro: 0x727d79,
  meskuRetro: 0x666a64,
} as const;

const rgb = (color: number): [number, number, number] => [
  (color >> 16) & 0xff,
  (color >> 8) & 0xff,
  color & 0xff,
];

function luminance(color: number): number {
  const [r, g, b] = rgb(color).map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG relative-luminance contrast ratio, exposed for semantic visual QA. */
export function contrastRatio(first: number, second: number): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function playerMarkerLabel(playerId: string): string {
  const match = /^P([1-8])$/.exec(playerId);
  if (!match) throw new Error(`Unknown player marker ID: ${playerId}`);
  return match[1];
}

/**
 * Compact two-row fan that keeps a tag close to its fighter's head. The tag is
 * always within about one fighter height of the anchor, so it still reads as
 * belonging to that fighter even in a crowd of eight.
 */
export function fighterMarkerOffset(playerId: string): { x: number; y: number } {
  const index = Number(playerMarkerLabel(playerId)) - 1;
  const column = index % 4;
  const row = Math.floor(index / 4);
  return { x: [-27, -9, 9, 27][column], y: row === 0 ? -64 : -78 };
}

export interface FighterMarker {
  face: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

/**
 * Small cream numberplate with an ink outline. Each marker is tied to the stable
 * player ID, not the fighter's palette or animation state. `label` remains a
 * standalone Text object so StationScene's existing `koMarkers` read API stays
 * compatible while its visibility becomes persistent.
 */
export function createFighterMarker(scene: Phaser.Scene, playerId: string): FighterMarker {
  const face = scene.add.graphics();
  face.fillStyle(FIGHTER_MARKER_FACE, 1).fillRoundedRect(-9, -7, 18, 14, 2);
  face.lineStyle(1, FIGHTER_MARKER_OUTLINE, 1).strokeRoundedRect(-9, -7, 18, 14, 2);
  const label = scene.add.text(0, 0, `P${playerMarkerLabel(playerId)}`, {
    fontFamily: 'monospace',
    fontSize: `${FIGHTER_MARKER_TEXT_SIZE}px`,
    fontStyle: 'bold',
    color: '#101820',
    align: 'center',
  }).setOrigin(0.5).setName(`fighter-marker-${playerId}`).setDepth(1_000_000);
  face.setName(`fighter-marker-face-${playerId}`).setDepth(999_999);
  return { face, label };
}

/** Diagnostic data for browser semantic checks; it does not affect presentation state. */
export function fighterMarkerDiagnostics(markers: ReadonlyMap<string, FighterMarker>): Array<{
  id: string;
  label: string;
  visible: boolean;
  fontSize: number;
  x: number;
  y: number;
}> {
  return Array.from(markers, ([id, marker]) => {
    const label = marker.label;
    return {
      id,
      label: label.text,
      visible: marker.face.visible && label.visible,
      fontSize: Number.parseFloat(String(label.style.fontSize)),
      x: label.x,
      y: label.y,
    };
  });
}
