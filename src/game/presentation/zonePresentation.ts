import type Phaser from 'phaser';
import { isInsideZone, nextZoneShrinkTick, zoneRangeAt, zoneStageAt } from '../simulation/zone';
import type { GameState } from '../simulation/types';
import { VIEWPORT } from './viewport';

/** Two and a half seconds at 60 Hz; presentation warning only. */
export const ZONE_WARNING_TICKS = 150;

export type ZonePresentation = {
  readonly active: boolean;
  readonly stage: number;
  readonly minX: number;
  readonly maxX: number;
  readonly ticksUntilShrink: number | null;
  readonly warning: boolean;
  readonly warningFlash: boolean;
  readonly dangerIds: readonly string[];
};

/** Build the same presentation view for local state and authoritative snapshots. */
export function zonePresentation(state: GameState | null, reducedMotion = false): ZonePresentation {
  const active = !!state && state.mode === 'deathmatch' &&
    (state.phase === 'countdown' || state.phase === 'fighting');
  const tick = state?.tick ?? 0;
  const range = zoneRangeAt(tick);
  const next = nextZoneShrinkTick(tick);
  const ticksUntilShrink = next === null ? null : next - tick;
  const warning = active && ticksUntilShrink !== null && ticksUntilShrink <= ZONE_WARNING_TICKS;
  return {
    active,
    stage: zoneStageAt(tick),
    minX: range.minX,
    maxX: range.maxX,
    ticksUntilShrink,
    warning,
    warningFlash: warning && !reducedMotion && Math.floor(tick / 15) % 2 === 0,
    dangerIds: active && state
      ? state.fighters.filter(fighter => !fighter.eliminated && fighter.health > 0 && !isInsideZone(fighter.x, tick))
        .map(fighter => fighter.id)
      : [],
  };
}

/** Draw a tick-marked, contracting mode boundary; never touches fighters or simulation. */
export function drawZoneGraphics(
  graphics: Phaser.GameObjects.Graphics,
  zone: ZonePresentation,
  tick: number,
): void {
  graphics.clear();
  graphics.setVisible(zone.active);
  if (!zone.active) return;

  const floorTop = 124;
  const floorBottom = 210;
  // Subtle danger tint leaves outside fighters visible and all combatants remain
  // depth-sorted in front of this floor-level overlay.
  graphics.fillStyle(0x9a4036, 0.25);
  if (zone.minX > 0) graphics.fillRect(0, floorTop, zone.minX, floorBottom - floorTop);
  if (zone.maxX < VIEWPORT.logicalWidth) {
    graphics.fillRect(zone.maxX, floorTop, VIEWPORT.logicalWidth - zone.maxX, floorBottom - floorTop);
  }

  const warningFlash = zone.warningFlash;
  // Cyan/ice marks are reserved for the mode rule; the arena shelf uses amber.
  const edgeColor = warningFlash ? 0xb2f5ff : 0x66d8e6;
  for (const x of [zone.minX, zone.maxX]) {
    const edgeX = Math.round(x);
    const inward = x === zone.minX ? 1 : -1;
    // A dark rail with inward-facing cyan ticks reads as the moving platform
    // edge. The bounds are derived from the deterministic mode schedule.
    graphics.lineStyle(7, 0x172536, 0.96).lineBetween(edgeX, floorTop + 2, edgeX, floorBottom - 1);
    graphics.lineStyle(3, edgeColor, 0.98).lineBetween(edgeX, floorTop + 2, edgeX, floorBottom - 1);
    for (let y = floorTop + 7; y < floorBottom - 5; y += 12) {
      graphics.lineStyle(2, 0xd8fbff, 0.98).lineBetween(edgeX, y, edgeX + inward * 9, y);
    }
    graphics.lineStyle(2, edgeColor, 1)
      .lineBetween(edgeX + inward * 8, floorTop + 2, edgeX, floorTop + 7)
      .lineBetween(edgeX, floorTop + 7, edgeX + inward * 8, floorTop + 12);
  }

  // A small floor-facing end-cap helps communicate the safe platform as an area.
  graphics.fillStyle(0x293f45, 0.9);
  graphics.fillRect(Math.round(zone.minX) - 5, floorBottom - 2, 11, 4);
  graphics.fillRect(Math.round(zone.maxX) - 5, floorBottom - 2, 11, 4);
  graphics.fillStyle(edgeColor, 1);
  graphics.fillRect(Math.round(zone.minX) - 3, floorBottom - 1, 7, 2);
  graphics.fillRect(Math.round(zone.maxX) - 3, floorBottom - 1, 7, 2);
}

export function zoneSummaryText(zone: ZonePresentation): string {
  if (!zone.active) return '';
  if (zone.warning && zone.ticksUntilShrink !== null) {
    const tenths = Math.ceil(zone.ticksUntilShrink / 6);
    const seconds = tenths % 10 === 0 ? `${tenths / 10}` : `${Math.floor(tenths / 10)}.${tenths % 10}`;
    const shrinkLabel = zone.stage === 0 ? 'FIRST SHRINK' : 'SHRINK';
    return `MODE: SHRINKING ZONE · ${shrinkLabel} IN ${seconds}s · MOVE INSIDE`;
  }
  if (zone.ticksUntilShrink === null) return `MODE: SHRINKING ZONE · STAGE ${zone.stage} · FINAL PLATFORM`;
  return `MODE: SHRINKING ZONE · STAGE ${zone.stage} · NEXT ${Math.ceil(zone.ticksUntilShrink / 60)}s`;
}
