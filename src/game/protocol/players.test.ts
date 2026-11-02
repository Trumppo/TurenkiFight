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
 * that enforces the roster bound must derive from it; a reintroduced literal
 * cap is a review defect.
 *
 * Scope is enforcement, not fixture configuration. The BASE-4 benchmark
 * fixture and its `WS_BENCHMARK_ROSTER` stay four players by design; those are
 * scenario inputs, not the supported maximum.
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
  'src/game/networking/wsSessionClient.ts',
  'src/game/networking/wsMessages.ts',
  'server/ws/authoritativeWsSession.ts',
  'server/ws/matchServer.ts',
  'server/ws/wsServer.ts',
  'benchmarks/scenarios.ts',
  'benchmarks/inMemory.ts',
  'benchmarks/manifest.ts',
  'benchmarks/bot/botClient.ts',
  'benchmarks/bot/botInput.ts',
  'benchmarks/bot/botManifest.ts',
  'benchmarks/bot/runBot.ts',
];

/** A literal cap is any integer >= 2; 0/1 are the legitimate empty/minimum bounds. */
const NUMBER = '[2-9]\\d*';
const OPERATOR = '(?:<=|>=|===|!==|<|>)';
const ROSTER_ARRAY = '(?:[\\w$.]+\\.)*(?:players|playerIds|inputs|fighters|slots|roster|entries|ids|value)';

type CapRule = { readonly reason: string; readonly pattern: RegExp };

/**
 * Each rule describes a *cap-shaped use* of a numeric literal rather than any
 * occurrence of a digit. Byte caps, tick counts, version numbers and identifier
 * length limits must not be flagged.
 */
const CAP_RULES: readonly CapRule[] = [
  {
    reason: 'cap-named constant, default or option assigned a numeric literal',
    pattern: new RegExp(
      `\\b(?:MAX_PLAYERS(?:_PER_FRAME)?|MAX_SNAPSHOT_FIGHTERS|MAX_EVENT_FIGHTERS|MAX_MATCH_PLAYERS|` +
      `maxPlayers|playerCount|playerCapacity|rosterSize|slotCount|maxConnections)\\b` +
      `\\s*(?::[^=;\\n]+)?(?:=|:|\\?\\?)\\s*${NUMBER}\\b`,
    ),
  },
  {
    reason: 'roster-length compared with a numeric literal',
    pattern: new RegExp(`\\b${ROSTER_ARRAY}\\.length\\s*${OPERATOR}\\s*${NUMBER}\\b`),
  },
  {
    reason: 'numeric literal compared with a roster length',
    pattern: new RegExp(`\\b${NUMBER}\\s*${OPERATOR}\\s*${ROSTER_ARRAY}\\.length\\b`),
  },
  {
    reason: 'roster count compared with a numeric literal',
    pattern: new RegExp(
      `\\b(?:[\\w$.]+\\.)*(?:players|playerCount|playerCapacity|rosterSize|slotCount|maxPlayers|maxConnections)\\b` +
      `\\s*${OPERATOR}\\s*${NUMBER}\\b`,
    ),
  },
  {
    reason: 'numeric literal compared with a roster count',
    pattern: new RegExp(
      `\\b${NUMBER}\\s*${OPERATOR}\\s*` +
      `(?:[\\w$.]+\\.)*(?:players|playerCount|playerCapacity|rosterSize|slotCount|maxPlayers|maxConnections)\\b`,
    ),
  },
  {
    reason: 'roster slice bounded by a numeric literal',
    pattern: new RegExp(
      `\\b(?:[\\w$.]+\\.)?(?:players|playerIds|inputs|fighters|slots|roster|entries|ids)\\.slice\\([^)\\n]*\\b${NUMBER}\\b`,
    ),
  },
  {
    reason: 'roster array length declared with a numeric literal',
    pattern: new RegExp(`\\b(?:Array\\.from|new Array|Array)\\s*\\(\\s*(?:\\{\\s*length\\s*:\\s*)?${NUMBER}\\b`),
  },
  {
    reason: 'roster loop index bounded or advanced by a numeric literal',
    pattern: new RegExp(`\\b(?:index|offset|slot|player|fighter|chunk)\\w*\\s*(?:${OPERATOR}|\\+=)\\s*${NUMBER}\\b`),
  },
];

/** `const FRAME_PLAYERS = 4` used later as a cap is still a private copy. */
const CONST_CAP_CANDIDATE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*([2-9]\d*)\b/g;
const CAP_LIKE_NAME = /(?:player|roster|fighter|slot|chunk|cap|limit)/i;

/**
 * A line may opt out with a reason when the number is provably not a player
 * cap, e.g. an operator default roster size. The marker is intentionally
 * explicit so a reviewer sees why the number is legitimate.
 */
const ALLOW_MARKER = /cap-scan-allow:\s*\S+/;

type Violation = { readonly file: string; readonly line: number; readonly reason: string; readonly text: string };

function scanSource(file: string, source: string): Violation[] {
  const lines = source.split(/\r?\n/);
  const violations: Violation[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (ALLOW_MARKER.test(line) || (index > 0 && ALLOW_MARKER.test(lines[index - 1]))) continue;
    // Comments can discuss four players; only executable code enforces a cap.
    const code = line.replace(/\/\/.*$/, '');
    for (const rule of CAP_RULES) {
      if (rule.pattern.test(code)) {
        violations.push({ file, line: index + 1, reason: rule.reason, text: line.trim() });
      }
    }
    for (const match of code.matchAll(CONST_CAP_CANDIDATE)) {
      if (CAP_LIKE_NAME.test(match[1])) {
        violations.push({
          file,
          line: index + 1,
          reason: `cap-like constant ${match[1]} assigned a numeric literal`,
          text: line.trim(),
        });
      }
    }
  }
  return violations;
}

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
    const violations = CAP_SOURCES.flatMap(relativePath =>
      scanSource(relativePath, readFileSync(resolve(ROOT, relativePath), 'utf8')));
    expect(
      violations,
      violations.map(violation =>
        `${violation.file}:${violation.line} [${violation.reason}] ${violation.text}`).join('\n'),
    ).toEqual([]);
  });
});
