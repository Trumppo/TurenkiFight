import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { decodeInputFrame } from '../../src/game/protocol/inputFrame';
import { encodeStateSnapshot } from '../../src/game/protocol/stateSnapshot';
import type { PlayerInput } from '../../src/game/simulation/types';
import { attachDataChannelSession, type DataChannelSession } from '../../src/game/networking/dataChannelSession';
import { SUPPORTED_SNAPSHOT_HZ, type SnapshotHz } from '../../src/game/networking/wsMessages';
import type { SessionClientHandlers } from '../../src/game/networking/wsSessionClient';
import { WebrtcHostSession } from '../../src/game/networking/webrtcHostSession';
import { InMemoryBenchmarkAdapter } from '../inMemory';
import { createRoster, generateFixture, sha256 } from '../scenarios';
import { createLoopbackDataChannelPair } from './loopbackDataChannel';
import { createWebrtcPrototypeManifest } from './webrtcManifest';

/**
 * Bounded "loopback" architecture-B correctness run.
 *
 * The full browser-host path is exercised in-process: four client cores emit the
 * canonical session envelope over an ordered in-memory DataChannel pair, and a
 * `WebrtcHostSession` answers with the prototype server-message codec. This is
 * not a WebRTC measurement: no ICE, DTLS, TURN, signaling socket or real
 * network path is involved, and no latency/bandwidth/CPU number is produced.
 */

const DEFAULT_TICKS = 300;
const MAX_LEAD_TICKS = 8;
const RUN_ID = 'webrtc-base4';
const PLAYERS = createRoster(4);

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find(entry => entry.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function positiveInteger(raw: string | undefined, fallback: number, max: number, label: string): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${label}: ${raw}`);
  return value;
}

function snapshotRate(raw: string | undefined): SnapshotHz {
  if (raw === undefined) return 20;
  const value = Number(raw);
  if (!SUPPORTED_SNAPSHOT_HZ.includes(value as SnapshotHz)) {
    throw new Error(`Unsupported snapshot rate: ${raw}`);
  }
  return value as SnapshotHz;
}

function decodeSchedule(frames: string[][], players: readonly string[], ticks: number): PlayerInput[][] {
  if (frames.length !== 7200) throw new Error('Invalid fixture');
  const schedule: PlayerInput[][] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const tickFrames = frames[tick];
    if (tickFrames.length !== 1) throw new Error('Invalid BASE-4 fixture framing');
    const frame = decodeInputFrame(tickFrames[0]);
    if (frame.tick !== tick || frame.inputs.length !== players.length) throw new Error('Invalid fixture tick');
    for (const playerId of players) {
      if (!frame.inputs.some(input => input.playerId === playerId)) throw new Error('Invalid fixture roster');
    }
    schedule.push(frame.inputs);
  }
  return schedule;
}

async function main(): Promise<void> {
  const ticks = positiveInteger(argument('ticks'), DEFAULT_TICKS, 7200, 'tick count');
  const snapshotHz = snapshotRate(argument('snapshot-hz'));
  const fixture = generateFixture('BASE-4-60-20');
  const schedule = decodeSchedule(fixture.framesByTick as string[][], PLAYERS, ticks);

  const host = new WebrtcHostSession({
    roomId: 'webrtc-prototype',
    playerIds: PLAYERS,
    snapshotHz,
    maxLead: MAX_LEAD_TICKS,
    maxTicks: ticks,
  });

  const clients: { playerId: string; session: DataChannelSession }[] = [];
  const denials: string[] = [];
  const protocolErrors: string[] = [];
  const closeReasons: string[] = [];

  try {
    for (const playerId of PLAYERS) {
      const pair = createLoopbackDataChannelPair();
      // The host allocates the trusted rtc-N connection ID from the channel itself.
      host.acceptChannel(pair.host);
      const handlers: SessionClientHandlers = {
        onError: error => denials.push(error.code),
        onProtocolError: message => protocolErrors.push(message),
        onSessionClosed: reason => closeReasons.push(reason),
      };
      const session = attachDataChannelSession(pair.client, handlers);
      clients.push({ playerId, session });
      session.client.join([playerId]);
    }

    if (host.phase !== 'starting') throw new Error(`Unexpected host phase: ${host.phase}`);
    if (!host.beginMatch()) throw new Error('Host could not start the bounded match');

    for (let tick = 0; tick < ticks; tick++) {
      for (const client of clients) {
        const input = schedule[tick].find(candidate => candidate.playerId === client.playerId);
        if (!input) throw new Error('Fixture lost a player input');
        client.session.client.submitInput(tick, [input]);
      }
      const result = host.stepOnce();
      if (!result.stepped || result.tick !== tick + 1) {
        throw new Error(`Host did not advance deterministically at tick ${tick}`);
      }
    }

    if (protocolErrors.length > 0) {
      throw new Error(`Client protocol error: ${protocolErrors[0]}`);
    }
    if (closeReasons.length > 0) {
      throw new Error(`Client session closed during the bounded run: ${closeReasons[0]}`);
    }
    if (host.tick !== ticks) {
      throw new Error(`Bounded run ended at tick ${host.tick}, expected ${ticks}`);
    }

    const finalStateSha256 = sha256(encodeStateSnapshot(host.snapshot()));
    const orderedEventsSha256 = sha256(JSON.stringify(host.orderedEvents()));

    const reference = new InMemoryBenchmarkAdapter();
    reference.connect({ scenarioId: 'BASE-4-60-20' });
    reference.join(PLAYERS);
    for (let tick = 0; tick < ticks; tick++) reference.sendInput(fixture.framesByTick[tick][0]);
    const referenceFinalStateSha256 = sha256(encodeStateSnapshot(reference.observeSnapshot()));
    const referenceOrderedEventsSha256 = sha256(JSON.stringify(reference.observeEvents()));
    reference.close();

    const runId = `${RUN_ID}-${Date.now()}`;
    const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
    const manifest = createWebrtcPrototypeManifest({
      runId,
      commitSha,
      fixtureSha256: fixture.fixtureSha256,
      seed: fixture.seed,
      snapshotHz,
      maxLeadTicks: MAX_LEAD_TICKS,
      boundedTicks: ticks,
      correctness: {
        finalTick: host.tick,
        matchesInMemoryReference:
          finalStateSha256 === referenceFinalStateSha256 &&
          orderedEventsSha256 === referenceOrderedEventsSha256,
        finalStateSha256,
        referenceFinalStateSha256,
        orderedEventsSha256,
        referenceOrderedEventsSha256,
        lateTicks: denials.filter(code => code === 'late-tick').length,
        deniedMessages: denials.length,
      },
    });

    const output = resolve(process.cwd(), argument('out') ?? `benchmarks/out/${runId}.json`);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    process.stdout.write(`${JSON.stringify({
      manifest: output,
      scenarioId: manifest.scenarioId,
      boundedTicks: manifest.boundedTicks,
      snapshotHz: manifest.snapshotHz,
      finalTick: manifest.correctness.finalTick,
      matchesInMemoryReference: manifest.correctness.matchesInMemoryReference,
      lateTicks: manifest.correctness.lateTicks,
      deniedMessages: manifest.correctness.deniedMessages,
      result: manifest.result,
      measurements: manifest.measurements,
    }, null, 2)}\n`);
  } finally {
    host.close('host-lost');
    for (const client of clients) {
      try { client.session.close(); } catch { /* already closed */ }
    }
  }
}

main().catch(error => {
  process.stderr.write(`webrtc benchmark failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
