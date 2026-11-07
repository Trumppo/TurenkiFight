import type { PlayerInput } from '../simulation/types';

/** Keyboard layouts use DOM `KeyboardEvent.code` values. */
export type KeyboardLayout = {
  readonly moveX: readonly [string, string];
  readonly moveY: readonly [string, string];
  readonly jump: string;
  readonly punch: string;
  readonly kick: string;
  readonly jumpkick: string;
  readonly grab: string;
};

export const KEYBOARD_LAYOUTS: Readonly<Record<'P1' | 'P2', KeyboardLayout>> = {
  P1: {
    moveX: ['KeyA', 'KeyD'],
    moveY: ['KeyW', 'KeyS'],
    jump: 'Space',
    punch: 'KeyF',
    kick: 'KeyG',
    jumpkick: 'KeyH',
    grab: 'KeyT',
  },
  P2: {
    moveX: ['ArrowLeft', 'ArrowRight'],
    moveY: ['ArrowUp', 'ArrowDown'],
    jump: 'KeyK',
    punch: 'KeyL',
    kick: 'KeyJ',
    jumpkick: 'KeyU',
    grab: 'KeyI',
  },
};

export type KeyboardSlot = 'P1' | 'P2' | 'P3' | 'P4';
export const KEYBOARD_SLOTS: readonly KeyboardSlot[] = ['P1', 'P2', 'P3', 'P4'];

/** A single physical-key position. Axis directions are distinct positions. */
export const KEYBOARD_BINDINGS = [
  'moveXNegative', 'moveXPositive', 'moveYNegative', 'moveYPositive',
  'jump', 'punch', 'kick', 'jumpkick', 'grab',
] as const;
export type KeyboardBinding = typeof KEYBOARD_BINDINGS[number];

const STORE_KEY = 'turenkifight.keyboard-bindings';
const STORE_VERSION = 1;
const RESERVED_CODES = new Set([
  'ShiftLeft', 'ShiftRight', 'Enter', 'Escape', 'KeyP', 'KeyB', 'KeyV', 'KeyO',
]);

type Overrides = Partial<Record<KeyboardSlot, Partial<Record<KeyboardBinding, string>>>>;
export type KeyboardBindingResult = { readonly ok: true } | { readonly ok: false; readonly conflict: string };

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function emptyLayout(): KeyboardLayout {
  return { moveX: ['', ''], moveY: ['', ''], jump: '', punch: '', kick: '', jumpkick: '', grab: '' };
}

function defaultLayout(slot: KeyboardSlot): KeyboardLayout {
  if (slot === 'P1' || slot === 'P2') return KEYBOARD_LAYOUTS[slot];
  // P3 and P4 remain gamepad slots until a local player assigns keyboard keys.
  return emptyLayout();
}

function mutableLayout(layout: KeyboardLayout): { moveX: [string, string]; moveY: [string, string]; jump: string; punch: string; kick: string; jumpkick: string; grab: string } {
  return {
    moveX: [layout.moveX[0], layout.moveX[1]], moveY: [layout.moveY[0], layout.moveY[1]],
    jump: layout.jump, punch: layout.punch, kick: layout.kick, jumpkick: layout.jumpkick, grab: layout.grab,
  };
}

function readBinding(layout: KeyboardLayout, binding: KeyboardBinding): string {
  switch (binding) {
    case 'moveXNegative': return layout.moveX[0];
    case 'moveXPositive': return layout.moveX[1];
    case 'moveYNegative': return layout.moveY[0];
    case 'moveYPositive': return layout.moveY[1];
    default: return layout[binding];
  }
}

function writeBinding(layout: ReturnType<typeof mutableLayout>, binding: KeyboardBinding, code: string): void {
  switch (binding) {
    case 'moveXNegative': layout.moveX[0] = code; break;
    case 'moveXPositive': layout.moveX[1] = code; break;
    case 'moveYNegative': layout.moveY[0] = code; break;
    case 'moveYPositive': layout.moveY[1] = code; break;
    default: layout[binding] = code;
  }
}

function validCode(code: unknown): code is string {
  return typeof code === 'string' && code.length > 0 && code.length <= 64 && /^[A-Za-z][A-Za-z0-9]*$/.test(code);
}

/**
 * Persistent local keyboard mapping overrides. Bad, stale or colliding data
 * is discarded as a whole so every load starts from a valid, conflict-free set.
 */
export class KeyboardMappingStore {
  private overrides: Overrides = {};

  constructor(private readonly storage?: StorageLike) {
    this.restore();
  }

  layoutFor(slot: KeyboardSlot): KeyboardLayout {
    const layout = mutableLayout(defaultLayout(slot));
    for (const binding of KEYBOARD_BINDINGS) {
      const code = this.overrides[slot]?.[binding];
      if (code) writeBinding(layout, binding, code);
    }
    return layout;
  }

  hasKeyboardBindings(slot: KeyboardSlot): boolean {
    const layout = this.layoutFor(slot);
    return [...layout.moveX, ...layout.moveY, layout.jump, layout.punch, layout.kick, layout.jumpkick, layout.grab].some(Boolean);
  }

  setBinding(slot: KeyboardSlot, binding: KeyboardBinding, code: string): KeyboardBindingResult {
    if (!validCode(code)) return { ok: false, conflict: 'That key cannot be assigned.' };
    if (RESERVED_CODES.has(code)) return { ok: false, conflict: `${displayKey(code)} is reserved for a lobby or game control.` };

    for (const otherSlot of KEYBOARD_SLOTS) {
      for (const otherBinding of KEYBOARD_BINDINGS) {
        if (otherSlot === slot && otherBinding === binding) continue;
        if (this.layoutFor(otherSlot) && readBinding(this.layoutFor(otherSlot), otherBinding) === code) {
          return { ok: false, conflict: `${displayKey(code)} is already bound to ${otherSlot} ${bindingLabel(otherBinding)}.` };
        }
      }
    }

    const defaults = defaultLayout(slot);
    if (readBinding(defaults, binding) === code) {
      const slotOverrides = this.overrides[slot];
      if (slotOverrides) delete slotOverrides[binding];
    } else {
      this.overrides[slot] ??= {};
      this.overrides[slot]![binding] = code;
    }
    this.cleanOverrides();
    this.persist();
    return { ok: true };
  }

  resetSlot(slot: KeyboardSlot): void {
    delete this.overrides[slot];
    this.persist();
  }

  resetAll(): void {
    this.overrides = {};
    this.persist();
  }

  private restore(): void {
    if (!this.storage) return;
    let raw: string | null;
    try { raw = this.storage.getItem(STORE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!this.isValidRecord(parsed)) throw new Error('invalid keyboard mapping record');
      this.overrides = parsed.overrides;
    } catch {
      this.overrides = {};
      try { this.storage.removeItem(STORE_KEY); } catch { /* Storage may be disabled. */ }
    }
  }

  private isValidRecord(value: unknown): value is { version: 1; overrides: Overrides } {
    if (!value || typeof value !== 'object') return false;
    const record = value as { version?: unknown; overrides?: unknown };
    if (record.version !== STORE_VERSION || !record.overrides || typeof record.overrides !== 'object' || Array.isArray(record.overrides)) return false;
    const overrides = record.overrides as Record<string, unknown>;
    if (Object.keys(overrides).some(slot => !KEYBOARD_SLOTS.includes(slot as KeyboardSlot))) return false;
    const candidate = overrides as Overrides;
    const seen = new Set<string>();
    for (const slot of KEYBOARD_SLOTS) {
      const actions = candidate[slot];
      if (!actions) continue;
      if (typeof actions !== 'object' || Array.isArray(actions)) return false;
      if (Object.keys(actions).some(binding => !KEYBOARD_BINDINGS.includes(binding as KeyboardBinding))) return false;
      const layout = mutableLayout(defaultLayout(slot));
      for (const binding of KEYBOARD_BINDINGS) {
        const code = actions[binding];
        if (code === undefined) continue;
        if (!validCode(code) || RESERVED_CODES.has(code) || readBinding(defaultLayout(slot), binding) === code) return false;
        writeBinding(layout, binding, code);
      }
      for (const binding of KEYBOARD_BINDINGS) {
        const code = readBinding(layout, binding);
        if (!code) continue;
        if (seen.has(code)) return false;
        seen.add(code);
      }
    }
    return true;
  }

  private cleanOverrides(): void {
    for (const slot of KEYBOARD_SLOTS) {
      if (this.overrides[slot] && Object.keys(this.overrides[slot]!).length === 0) delete this.overrides[slot];
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      if (Object.keys(this.overrides).length === 0) this.storage.removeItem(STORE_KEY);
      else this.storage.setItem(STORE_KEY, JSON.stringify({ version: STORE_VERSION, overrides: this.overrides }));
    } catch { /* Keep the in-memory mapping usable if browser storage is blocked. */ }
  }
}

export function displayKey(code: string): string {
  if (code === 'Space') return 'SPACE';
  if (code.startsWith('Arrow')) return code.slice(5).toUpperCase();
  if (code.startsWith('Key')) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit')) return code.slice(5);
  return code.replace(/([A-Z])/g, ' $1').trim().toUpperCase();
}

export function bindingLabel(binding: KeyboardBinding): string {
  const labels: Record<KeyboardBinding, string> = {
    moveXNegative: 'MOVE LEFT', moveXPositive: 'MOVE RIGHT',
    moveYNegative: 'MOVE UP', moveYPositive: 'MOVE DOWN',
    jump: 'JUMP', punch: 'PUNCH', kick: 'KICK', jumpkick: 'JUMPKICK', grab: 'GRAB',
  };
  return labels[binding];
}

/** Retain the original fallback for callers outside the local remapping UI. */
export function keyboardLayoutFor(playerId: string): KeyboardLayout {
  return KEYBOARD_LAYOUTS[playerId === 'P2' ? 'P2' : 'P1'];
}

export function keyboardPlayerInput(
  playerId: string,
  isDown: (code: string) => boolean,
  layout: KeyboardLayout = keyboardLayoutFor(playerId),
): PlayerInput {
  return {
    playerId,
    moveX: axis(!!layout.moveX[0] && isDown(layout.moveX[0]), !!layout.moveX[1] && isDown(layout.moveX[1])),
    moveY: axis(!!layout.moveY[0] && isDown(layout.moveY[0]), !!layout.moveY[1] && isDown(layout.moveY[1])),
    jump: !!layout.jump && isDown(layout.jump),
    punch: !!layout.punch && isDown(layout.punch),
    kick: !!layout.kick && isDown(layout.kick),
    jumpkick: !!layout.jumpkick && isDown(layout.jumpkick),
    grab: !!layout.grab && isDown(layout.grab),
  };
}

/** Both directions cancel; the simulation expects -1, 0 or 1. */
export function axis(negative: boolean, positive: boolean): -1 | 0 | 1 {
  if (negative === positive) return 0;
  return negative ? -1 : 1;
}
