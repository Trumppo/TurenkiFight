import type { GameEvent, GameState } from '../../simulation/types';

export type AudioCue = 'hit' | 'kick' | 'jump' | 'land' | 'ko' | 'respawn' | 'join' |
  'match-start' | 'time-warning' | 'match-end' | 'victory' | 'confirm' |
  'item-pickup' | 'item-throw' | 'item-break' | 'shop-bell' | 'station-train';

export function cueForGameEvent(event: GameEvent): AudioCue | null {
  switch (event.type) {
    case 'HitLanded': return event.move === 'kick' || event.move === 'jumpkick' ? 'kick' : 'hit';
    case 'Knockout': return 'ko';
    case 'Respawned': return 'respawn';
    case 'MatchStarted': return 'match-start';
    case 'MatchEnded': return 'match-end';
  }
}

/** Read-only adapter: observes authoritative states/events and emits presentation cues once. */
export class CueBridge {
  private previous: GameState | null = null;
  private readonly seenEvents = new Set<string>();
  private readonly recentEventKeys: string[] = [];

  constructor(private readonly emit: (cue: AudioCue) => void, private readonly announceInitialRoster = false) {}

  observe(state: GameState): void {
    const previous = this.previous;
    for (const event of state.events) {
      const key = `${event.tick}:${event.type}:${event.attacker ?? ''}:${event.target ?? ''}:${event.move ?? ''}`;
      if (this.seenEvents.has(key)) continue;
      this.seenEvents.add(key);
      this.recentEventKeys.push(key);
      if (this.recentEventKeys.length > 256) this.seenEvents.delete(this.recentEventKeys.shift()!);
      const cue = cueForGameEvent(event);
      if (cue) this.emit(cue);
    }

    if (previous) {
      const oldObjects = new Map((previous.objects ?? []).map(object => [object.id, object]));
      const currentObjects = new Map((state.objects ?? []).map(object => [object.id, object]));
      for (const object of currentObjects.values()) {
        const old = oldObjects.get(object.id);
        if (old?.state === 'ground' && object.state === 'held') this.emit('item-pickup');
        else if (old?.state === 'held' && object.state === 'airborne') this.emit('item-throw');
      }
      // Broken objects are removed during same-tick simulation cleanup. A
      // missing previously-airborne id is therefore the presentation signal;
      // only advance-time removals during a match count, not an initial/reset frame.
      if (state.tick > previous.tick && state.phase !== 'lobby' && previous.phase !== 'results') {
        for (const object of oldObjects.values()) {
          if (object.state === 'airborne' && !currentObjects.has(object.id)) this.emit('item-break');
        }
      }
      const oldFighters = new Map(previous.fighters.map(fighter => [fighter.id, fighter]));
      for (const fighter of state.fighters) {
        const old = oldFighters.get(fighter.id);
        if (!old) this.emit('join');
        else if (old.z <= 0 && fighter.z > 0) this.emit('jump');
        else if (old.z > 0 && fighter.z <= 0) this.emit('land');
      }
      if (previous.remainingTicks > 600 && state.remainingTicks <= 600 && state.remainingTicks > 0) this.emit('time-warning');
      if (previous.phase === 'results' && state.phase !== 'results') this.emit('confirm');
    } else if (this.announceInitialRoster && state.fighters.length > 0) {
      this.emit('join');
    }
    this.previous = state;
  }

  reset(): void {
    this.previous = null;
    this.seenEvents.clear();
    this.recentEventKeys.length = 0;
  }
}
