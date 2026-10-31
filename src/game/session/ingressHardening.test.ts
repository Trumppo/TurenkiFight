import { describe, expect, it } from 'vitest';
import { AuthorizedSessionIngress } from './authorizedSessionIngress';
import { consumeAuthorizedFrame } from './protocolIntegration';
import { encodeInputFrame } from '../protocol/inputFrame';

const input = (playerId: string) => ({ playerId, moveX: 1 as const, moveY: 0 as const, jump: false });

describe('M2 ingress hardening regression', () => {
  it('does not burn a sequence number after denied spoofing or malformed controls', () => {
    const ingress = new AuthorizedSessionIngress(0, 2, 2);
    ingress.join('a', 'P1');
    ingress.join('b', 'P2');
    expect(() => ingress.submit('b', 7, 0, input('P1'))).toThrow(/Unauthorized/);
    expect(() => ingress.submit('b', 7, 0, { ...input('P2'), jump: 'yes' as never })).toThrow(/Malformed/);
    ingress.submit('b', 7, 0, input('P2'));
    expect(consumeAuthorizedFrame(ingress).inputs).toEqual([input('P2')]);
  });

  it('revokes queued future input and requires new ownership after disconnect', () => {
    const ingress = new AuthorizedSessionIngress(0, 3, 2);
    ingress.join('a', 'P1');
    ingress.submit('a', 1, 2, input('P1'));
    ingress.disconnect('a');
    expect(() => ingress.submit('a', 2, 2, input('P1'))).toThrow(/Unauthorized/);
    ingress.join('b', 'P1');
    ingress.submit('b', 0, 2, input('P1'));
    expect(consumeAuthorizedFrame(ingress).inputs).toEqual([]);
    expect(consumeAuthorizedFrame(ingress).inputs).toEqual([]);
    const frame = consumeAuthorizedFrame(ingress);
    expect(frame.inputs).toEqual([input('P1')]);
    expect(encodeInputFrame(frame)).toContain('"version":1');
  });

  it('rejects far-future and duplicate inputs without corrupting the canonical frame', () => {
    const ingress = new AuthorizedSessionIngress(0, 1, 1);
    ingress.join('a', 'P1');
    expect(() => ingress.submit('a', 0, 2, input('P1'))).toThrow(/future/);
    ingress.submit('a', 0, 0, input('P1'));
    expect(() => ingress.submit('a', 1, 0, input('P1'))).toThrow(/Duplicate/);
    expect(consumeAuthorizedFrame(ingress).inputs).toEqual([input('P1')]);
  });
});
