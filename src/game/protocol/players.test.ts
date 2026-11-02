import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_MATCH_PLAYERS } from '../../../server/ws/matchServer';
import {
  MAX_EVENT_FIGHTERS,
  MAX_EVENTS_PER_BATCH,
} from './eventBatch';
import { MAX_PLAYERS_PER_FRAME } from './inputFrame';
import { MAX_PLAYERS, MIN_PLAYERS, isSupportedPlayerCount } from './players';
import { MAX_SNAPSHOT_FIGHTERS } from './stateSnapshot';

/**
 * Guard test for the owner's 2026-11-02 decision: eight players are supported
 * and `MAX_PLAYERS` is the only place that number is written down. Every layer
 * must derive its bound from it; a reintroduced literal cap is a review defect.
 */
const CAP_SOURCES = [
  'src/game/protocol/inputFrame.ts',
  'src/game/protocol/stateSnapshot.ts',
  'src/game/protocol/eventBatch.ts',
  'src/game/protocol/inputFrameBuffer.ts',
  'src/game/session/sessionRoster.ts',
  'src/game/session/sessionInputBuffer.ts',
  'src/game/session/authorizedSessionIngress.ts',
  'src/game/session/sessionEnvelope.ts',
  'server/ws/authoritativeWsSession.ts',
  'server/ws/matchServer.ts',
  'benchmarks/bot/botClient.ts',
  'benchmarks/bot/botManifest.ts',
  'benchmarks/bot/runBot.ts',
];

const FORBIDDEN_CAP_PATTERNS = [
  /MAX_PLAYERS_PER_FRAME\s*=\s*4\b/,
  /MAX_SNAPSHOT_FIGHTERS\s*=\s*4\b/,
  /MAX_EVENT_FIGHTERS\s*=\s*4\b/,
  /MAX_MATCH_PLAYERS\s*=\s*4\b/,
  /\bmaxPlayers\s*=\s*4\b/,
  /(?:players|playerIds|inputs|fighters)\.length\s*>\s*4\b/,
];

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('M8 single roster-limit source', () => {
  it('exports the owner-decided maximum and derives every layer from it', () => {
    expect(MAX_PLAYERS).toBe(8);
    expect(MIN_PLAYERS).toBe(1);
    expect(MAX_PLAYERS_PER_FRAME).toBe(MAX_PLAYERS);
    expect(MAX_SNAPSHOT_FIGHTERS).toBe(MAX_PLAYERS);
    expect(MAX_EVENT_FIGHTERS).toBe(MAX_PLAYERS);
    expect(MAX_MATCH_PLAYERS).toBe(MAX_PLAYERS);
    expect(MAX_EVENTS_PER_BATCH).toBe(MAX_PLAYERS * (MAX_PLAYERS - 1) + 2 * MAX_PLAYERS + 1);
    expect([1, 4, 8].every(isSupportedPlayerCount)).toBe(true);
    expect([0, 9, 16, 4.5, '8', Number.MAX_SAFE_INTEGER].some(isSupportedPlayerCount)).toBe(false);
  });

  it('keeps no private literal cap in any enforcement layer', () => {
    for (const relativePath of CAP_SOURCES) {
      const source = readFileSync(resolve(ROOT, relativePath), 'utf8');
      for (const pattern of FORBIDDEN_CAP_PATTERNS) {
        expect(source, `${relativePath} reintroduced ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
