import { describe, expect, it } from 'vitest';
import { AuthorizedSessionIngress } from './authorizedSessionIngress';
import { consumeAuthorizedFrame } from './protocolIntegration';

const neutral = (playerId: string) => ({ playerId, moveX: 0 as const, moveY: 0 as const, jump: false });

describe('M2 identity and host authority regression', () => {
  it('rejects invalid connection and player identifiers before ownership exists', () => {
    const ingress = new AuthorizedSessionIngress();
    expect(() => ingress.join('bad connection', 'P1')).toThrow(/Invalid/);
    expect(() => ingress.join('valid', '../P1')).toThrow(/Invalid/);
    expect(ingress.playerCount).toBe(0);
    expect(() => ingress.submit('valid', 0, 0, neutral('P1'))).toThrow(/Unauthorized/);
  });

  it('does not silently migrate host authority after host disconnect', () => {
    const ingress = new AuthorizedSessionIngress();
    ingress.join('host', 'P1');
    ingress.join('guest', 'P2');
    expect(() => ingress.assertHost('guest')).toThrow(/Host authorization/);
    expect(() => ingress.assertHost('host')).not.toThrow();
    ingress.disconnect('host');
    expect(() => ingress.assertHost('guest')).toThrow(/Host authorization/);
    ingress.join('replacement', 'P1');
    expect(() => ingress.assertHost('replacement')).toThrow(/Host authorization/);
  });

  it('rejects old connection replay even after slot is reassigned', () => {
    const ingress = new AuthorizedSessionIngress(0, 2, 2);
    ingress.join('old', 'P1');
    ingress.submit('old', 3, 1, neutral('P1'));
    ingress.disconnect('old');
    ingress.join('fresh', 'P1');
    expect(() => ingress.submit('old', 4, 1, neutral('P1'))).toThrow(/Unauthorized/);
    ingress.submit('fresh', 0, 1, neutral('P1'));
    expect(consumeAuthorizedFrame(ingress).inputs).toEqual([]);
    expect(consumeAuthorizedFrame(ingress).inputs).toEqual([neutral('P1')]);
  });
});
