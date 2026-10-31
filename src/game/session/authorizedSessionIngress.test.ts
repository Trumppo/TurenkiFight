import { describe, expect, it } from 'vitest';
import { AuthorizedSessionIngress } from './authorizedSessionIngress';

const controls = (playerId: string) => ({ playerId, moveX: 1 as const, moveY: 0 as const, jump: false });

describe('M2 authorized session ingress', () => {
  it('accepts only authorized slot inputs and emits canonical frames', () => {
    const gate = new AuthorizedSessionIngress();
    gate.join('host', 'P1');
    gate.join('guest', 'P2');
    expect(() => gate.submit('guest', 1, 0, controls('P1'))).toThrow(/Unauthorized/);
    gate.submit('guest', 1, 0, controls('P2'));
    gate.submit('host', 1, 0, controls('P1'));
    expect(gate.consume()).toEqual({ version: 1, tick: 0, inputs: [controls('P1'), controls('P2')] });
  });

  it('denied messages do not consume sequence numbers', () => {
    const gate = new AuthorizedSessionIngress();
    gate.join('a', 'P1');
    expect(() => gate.submit('a', 5, 0, controls('P2'))).toThrow(/Unauthorized/);
    gate.submit('a', 5, 0, controls('P1'));
    expect(gate.consume().inputs).toEqual([controls('P1')]);
  });

  it('disconnect revokes ownership, queued inputs and sequence domain', () => {
    const gate = new AuthorizedSessionIngress();
    gate.join('a', 'P1');
    gate.submit('a', 10, 0, controls('P1'));
    expect(gate.disconnect('a')).toEqual(['P1']);
    expect(() => gate.submit('a', 11, 0, controls('P1'))).toThrow(/Unauthorized/);
    expect(gate.consume().inputs).toEqual([]);
    gate.join('b', 'P1');
    gate.submit('b', 1, 1, controls('P1'));
    expect(gate.consume().inputs).toEqual([controls('P1')]);
    expect(() => gate.assertHost('b')).toThrow(/Host authorization/);
  });

  it('enforces host-only access without client-provided host flags', () => {
    const gate = new AuthorizedSessionIngress();
    gate.join('a', 'P1');
    gate.join('b', 'P2');
    expect(() => gate.assertHost('b')).toThrow(/Host authorization/);
    expect(() => gate.assertHost('a')).not.toThrow();
  });

  it('preserves per-connection sequence replay checks across owned slots', () => {
    const gate = new AuthorizedSessionIngress();
    gate.join('a', 'P1');
    gate.join('a', 'P2');
    gate.submit('a', 10, 0, controls('P1'));
    expect(() => gate.submit('a', 10, 0, controls('P2'))).toThrow(/Replayed/);
    gate.submit('a', 11, 0, controls('P2'));
    expect(gate.consume().inputs).toHaveLength(2);
  });
});
