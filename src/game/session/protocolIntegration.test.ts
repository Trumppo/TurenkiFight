import { describe, expect, it } from 'vitest';
import { createState, step } from '../simulation/step';
import { AuthorizedSessionIngress } from './authorizedSessionIngress';
import { consumeAuthorizedFrame } from './protocolIntegration';
import { decodeInputFrame, encodeInputFrame } from '../protocol/inputFrame';

const neutral = (playerId: string) => ({ playerId, moveX: 0 as const, moveY: 0 as const, jump: false });

describe('M2 protocol / authorized session integration', () => {
  it('runs a deterministic four-player 7200-tick match with canonical wire frames', () => {
    const ids = ['P1', 'P2', 'P3', 'P4'];
    const ingress = new AuthorizedSessionIngress(0, 8, 4);
    ids.forEach((id, i) => ingress.join('connection' + i, id));
    let actual = createState(ids, 'fighting');
    let reference = createState(ids, 'fighting');
    for (let tick = 0; tick < 7200; tick++) {
      for (let i = 0; i < ids.length; i++) {
        if (tick % 7 === i) ingress.submit('connection' + i, tick, tick, neutral(ids[i]));
      }
      const frame = decodeInputFrame(encodeInputFrame(consumeAuthorizedFrame(ingress)));
      expect(frame.tick).toBe(tick);
      actual = step(actual, frame.inputs);
      reference = step(reference, frame.inputs);
    }
    expect(actual).toEqual(reference);
    expect(actual.tick).toBe(7200);
    expect(actual.phase).toBe('results');
  });

  it('rejects spoofing and replay; revokes disconnected inputs and authorizes a new connection', () => {
    const ingress = new AuthorizedSessionIngress();
    ingress.join('old', 'P1');
    ingress.join('other', 'P2');
    expect(() => ingress.submit('other', 1, 0, neutral('P1'))).toThrow(/Unauthorized/);
    ingress.submit('old', 1, 0, neutral('P1'));
    expect(() => ingress.submit('old', 1, 0, neutral('P1'))).toThrow(/Replayed/);
    expect(() => ingress.submit('old', 2, 0, { ...neutral('P1'), moveX: 2 as never })).toThrow(/Malformed/);
    expect(ingress.disconnect('old')).toEqual(['P1']);
    expect(() => ingress.submit('old', 3, 0, neutral('P1'))).toThrow(/Unauthorized/);
    expect(consumeAuthorizedFrame(ingress).inputs).toEqual([]);
    ingress.join('new', 'P1');
    ingress.submit('new', 0, 1, neutral('P1'));
    expect(consumeAuthorizedFrame(ingress).inputs).toEqual([neutral('P1')]);
  });

  it('rejects invalid codec versions and duplicate player IDs', () => {
    expect(() => decodeInputFrame(JSON.stringify({ version: 2, tick: 0, inputs: [] }))).toThrow();
    expect(() => decodeInputFrame(JSON.stringify({ version: 1, tick: 0, inputs: [neutral('P1'), neutral('P1')] }))).toThrow();
  });
});
