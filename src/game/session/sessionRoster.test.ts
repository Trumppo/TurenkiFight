import { describe, expect, it } from 'vitest';
import { SessionRoster } from './sessionRoster';

describe('M2 session roster authorization', () => {
  it('assigns host to first joining connection and enforces host-only operations', () => {
    const roster = new SessionRoster();
    roster.join('conn1', 'P1');
    roster.join('conn2', 'P2');
    expect(roster.isHost('conn1')).toBe(true);
    expect(roster.isHost('conn2')).toBe(false);
    expect(() => roster.assertHost('conn2')).toThrow(/Host authorization/);
    expect(() => roster.assertHost('conn1')).not.toThrow();
  });

  it('rejects slot impersonation, ownership takeover and roster overflow', () => {
    const roster = new SessionRoster(2);
    roster.join('a', 'P1');
    expect(() => roster.assertOwns('b', 'P1')).toThrow(/Unauthorized/);
    expect(() => roster.join('b', 'P1')).toThrow(/already owned/);
    roster.join('b', 'P2');
    expect(() => roster.join('c', 'P3')).toThrow(/full/);
    expect(roster.playerCount).toBe(2);
  });

  it('supports multiple authorized local slots per connection', () => {
    const roster = new SessionRoster();
    roster.join('c1', 'P1');
    roster.join('c1', 'P2');
    roster.join('c1', 'P2');
    expect(roster.playerCount).toBe(2);
    expect(roster.owns('c1', 'P2')).toBe(true);
    expect(roster.owns('c2', 'P2')).toBe(false);
  });

  it('revokes slots on disconnect and does not silently transfer host authority', () => {
    const roster = new SessionRoster();
    roster.join('host', 'P1');
    roster.join('guest', 'P2');
    expect(roster.disconnect('host')).toEqual(['P1']);
    expect(roster.disconnect('host')).toEqual([]);
    expect(roster.hasHost()).toBe(false);
    expect(() => roster.assertOwns('host', 'P1')).toThrow(/Unauthorized/);
    roster.join('new', 'P1');
    expect(roster.isHost('new')).toBe(false);
    expect(() => roster.assertHost('new')).toThrow(/Host authorization/);
    expect(roster.owns('guest', 'P2')).toBe(true);
  });

  it('allows explicit slot reuse after revocation without preserving stale authority', () => {
    const roster = new SessionRoster();
    roster.join('a', 'P1');
    roster.join('a', 'P2');
    expect(roster.disconnect('a')).toEqual(['P1', 'P2']);
    roster.join('b', 'P1');
    expect(roster.owns('b', 'P1')).toBe(true);
    expect(roster.owns('a', 'P1')).toBe(false);
  });

  it('rejects malformed IDs and invalid capacity', () => {
    expect(() => new SessionRoster(0)).toThrow(/capacity/);
    expect(() => new SessionRoster(1.5)).toThrow(/capacity/);
    const roster = new SessionRoster();
    for (const id of ['', 'bad space', 'x'.repeat(65), '../p1']) {
      expect(() => roster.join(id, 'P1')).toThrow(/identifier/);
      expect(() => roster.join('good', id)).toThrow(/identifier/);
    }
    expect(roster.playerCount).toBe(0);
  });
});
