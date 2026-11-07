import { describe, expect, it } from 'vitest';
import { KeyboardMappingStore } from '../src/game/input/keyboardMapping';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  seed(key: string, value: string): void { this.values.set(key, value); }
}

const KEY = 'turenkifight.keyboard-bindings';

describe('local keyboard mapping overrides', () => {
  it('keeps P1/P2 defaults exact and P3/P4 unassigned', () => {
    const store = new KeyboardMappingStore(new MemoryStorage());
    expect(store.layoutFor('P1')).toEqual({ moveX: ['KeyA', 'KeyD'], moveY: ['KeyW', 'KeyS'], jump: 'Space', punch: 'KeyF', kick: 'KeyG', jumpkick: 'KeyH', grab: 'KeyT' });
    expect(store.layoutFor('P2')).toEqual({ moveX: ['ArrowLeft', 'ArrowRight'], moveY: ['ArrowUp', 'ArrowDown'], jump: 'KeyK', punch: 'KeyL', kick: 'KeyJ', jumpkick: 'KeyU', grab: 'KeyI' });
    expect(store.layoutFor('P3')).toEqual({ moveX: ['', ''], moveY: ['', ''], jump: '', punch: '', kick: '', jumpkick: '', grab: '' });
    expect(store.hasKeyboardBindings('P3')).toBe(false);
  });

  it('sets, persists, restores and clears a binding', () => {
    const storage = new MemoryStorage();
    const first = new KeyboardMappingStore(storage);
    expect(first.setBinding('P1', 'jump', 'KeyQ')).toEqual({ ok: true });
    expect(first.layoutFor('P1').jump).toBe('KeyQ');
    expect(new KeyboardMappingStore(storage).layoutFor('P1').jump).toBe('KeyQ');
    first.resetSlot('P1');
    expect(first.layoutFor('P1').jump).toBe('Space');
    expect(storage.getItem(KEY)).toBeNull();
    first.setBinding('P3', 'moveXPositive', 'KeyM');
    expect(first.hasKeyboardBindings('P3')).toBe(true);
    first.resetAll();
    expect(first.hasKeyboardBindings('P3')).toBe(false);
    expect(storage.getItem(KEY)).toBeNull();
  });

  it('refuses a key already used by another action in this slot or any other slot', () => {
    const store = new KeyboardMappingStore(new MemoryStorage());
    expect(store.setBinding('P1', 'jump', 'KeyQ')).toEqual({ ok: true });
    expect(store.setBinding('P1', 'punch', 'KeyQ')).toEqual({ ok: false, conflict: 'Q is already bound to P1 JUMP.' });
    expect(store.setBinding('P2', 'jump', 'KeyQ')).toEqual({ ok: false, conflict: 'Q is already bound to P1 JUMP.' });
    expect(store.setBinding('P2', 'jump', 'KeyP')).toEqual({ ok: false, conflict: 'P is reserved for a lobby or game control.' });
  });

  it('falls back to defaults and clears corrupt or stale saved data', () => {
    for (const value of ['not json', JSON.stringify({ version: 99, overrides: {} }), JSON.stringify({ version: 1, overrides: { P3: { jump: 'KeyQ', punch: 'KeyQ' } } })]) {
      const storage = new MemoryStorage();
      storage.seed(KEY, value);
      const store = new KeyboardMappingStore(storage);
      expect(store.layoutFor('P1').jump).toBe('Space');
      expect(store.hasKeyboardBindings('P3')).toBe(false);
      expect(storage.getItem(KEY)).toBeNull();
    }
  });
});
