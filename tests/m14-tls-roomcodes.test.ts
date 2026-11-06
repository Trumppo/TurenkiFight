import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import {
  SessionEnvelopeError,
  decodeClientEnvelope,
  encodeClientEnvelope,
} from '../src/game/session/sessionEnvelope';
import { OnlineMatchController } from '../src/game/networking/onlineMatchController';
import type { BrowserSocketHandlers } from '../src/game/networking/browserWsAdapter';
import { defaultServerUrl, resolveServerUrl } from '../src/game/networking/wsEndpoint';
import { parseBotArgs } from '../benchmarks/bot/runBot';
import {
  DEFAULT_MATCH_ROOM_ID,
  ROOM_CODE_ALPHABET,
  formatMatchReadyLine,
  generateRoomCode,
  loadTlsFiles,
  matchConnectUrl,
  parseRoomCode,
  parseServeMatchArgs,
  serveMatchUsage,
  startMatchServer,
  type MatchServerHandle,
  type MatchTlsMaterial,
} from '../server/ws/matchServer';
import { openNodeSession, type NodeSession } from '../server/ws/nodeWsClient';

/**
 * M14 hardening slice: optional WSS, room codes and the room connection cap.
 * The TLS happy path needs a locally generated self-signed certificate; when
 * `openssl` is unavailable the test skips with an explicit reason.
 */

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>(resolve => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function waitFor<T>(
  label: string,
  check: () => T | undefined | false,
  timeoutMs = 5000,
): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function bindingFailure(error: unknown): string | null {
  const code = (error as { code?: string } | null)?.code;
  if (code && ['EACCES', 'EPERM', 'EADDRINUSE', 'EADDRNOTAVAIL', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return code;
  }
  return null;
}

function errorCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof SessionEnvelopeError ? error.code : 'not-an-envelope-error';
  }
  return 'accepted';
}

function opensslBinary(): string | null {
  const candidates = [
    process.env.OPENSSL_BIN,
    'openssl',
    ...(process.platform === 'win32'
      ? ['C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe']
      : []),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const probe = spawnSync(candidate, ['version'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  return null;
}

type GeneratedCertificate = MatchTlsMaterial & { readonly directory: string };

/** Self-signed leaf for 127.0.0.1/localhost; never part of the repository. */
function createSelfSignedCertificate(): GeneratedCertificate | null {
  const openssl = opensslBinary();
  if (openssl === null) return null;
  const directory = mkdtempSync(join(tmpdir(), 'turenki-m14-tls-'));
  const certPath = join(directory, 'cert.pem');
  const keyPath = join(directory, 'key.pem');
  const result = spawnSync(openssl, [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath,
    '-days', '1',
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    rmSync(directory, { recursive: true, force: true });
    return null;
  }
  return {
    directory,
    cert: readFileSync(certPath, 'utf8'),
    key: readFileSync(keyPath, 'utf8'),
  };
}

function openRaw(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Timed out opening a raw WebSocket'));
    }, 5000);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function closeCode(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Timed out waiting for a close frame'));
    }, 5000);
    socket.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
    socket.once('error', () => undefined);
  });
}

const tempDirectories: string[] = [];
const openServers: MatchServerHandle[] = [];
const openClients: NodeSession[] = [];

afterEach(async () => {
  for (const client of openClients.splice(0)) {
    try {
      client.close();
    } catch {
      // Already closed.
    }
  }
  for (const server of openServers.splice(0)) {
    await server.close();
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('M14 serve:match flags, room code and ready line', () => {
  it('parses a fixed room code and TLS paths in both flag forms', () => {
    expect(parseServeMatchArgs([]).roomCode).toBeNull();
    expect(parseServeMatchArgs([]).cert).toBeNull();
    expect(parseServeMatchArgs([]).key).toBeNull();
    expect(parseServeMatchArgs(['--room=ab12']).roomCode).toBe('AB12');
    expect(parseServeMatchArgs(['--room', 'CD34']).roomCode).toBe('CD34');
    expect(parseServeMatchArgs(['--cert=cert.pem', '--key=key.pem']).cert).toBe('cert.pem');
    expect(parseServeMatchArgs(['--cert', 'cert.pem', '--key', 'key.pem']).key).toBe('key.pem');
  });

  it('rejects a malformed room code or an unpaired TLS flag clearly', () => {
    expect(() => parseServeMatchArgs(['--room=abc'])).toThrow(/4-12 letters or digits/);
    expect(() => parseServeMatchArgs(['--room=bad!'])).toThrow(/Invalid room code/);
    expect(() => parseServeMatchArgs(['--cert=cert.pem'])).toThrow(/--cert and --key/);
    expect(() => parseServeMatchArgs(['--key=key.pem'])).toThrow(/--cert and --key/);
    expect(() => parseServeMatchArgs(['--cert'])).toThrow(/--name=value/);
    expect(() => parseRoomCode('x')).toThrow(/Invalid room code/);
  });

  it('generates an unambiguous short code', () => {
    expect(generateRoomCode(() => 0)).toHaveLength(5);
    expect(generateRoomCode(() => 0)).toBe(ROOM_CODE_ALPHABET[0]!.repeat(5));
    for (let index = 0; index < 100; index++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[A-Z2-9]{5}$/);
      expect(code).not.toMatch(/[O0I1]/);
    }
  });

  it('prints the room code, connection cap and WSS URL in one ready line', () => {
    const line = formatMatchReadyLine({
      url: 'wss://127.0.0.1:8787',
      host: '127.0.0.1',
      port: 8787,
      roomId: DEFAULT_MATCH_ROOM_ID,
      roomCode: 'ABCDE',
      maxConnections: 6,
      maxMessageBytes: 5120,
      messageRateWindowMs: 1000,
      maxMessagesPerWindow: 240,
      maxValidationFailures: 5,
      playerIds: ['P1', 'P2'],
      snapshotHz: 20,
      startMode: 'auto',
      mode: 'score-brawl',
      secure: true,
    });
    expect(line).not.toContain('\n');
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.roomCode).toBe('ABCDE');
    expect(parsed.maxConnections).toBe(6);
    expect(parsed.secure).toBe(true);
    expect(parsed.url).toBe('wss://127.0.0.1:8787');
    expect(matchConnectUrl('127.0.0.1', 8787, true)).toBe('wss://127.0.0.1:8787');
    expect(matchConnectUrl('127.0.0.1', 8787)).toBe('ws://127.0.0.1:8787');
    expect(matchConnectUrl('::1', 8787, true)).toBe('wss://[::1]:8787');
    expect(serveMatchUsage()).toContain('--cert');
    expect(serveMatchUsage()).toContain('--key');
    expect(serveMatchUsage()).toContain('--room');
  });

  it('rejects missing or malformed certificate files before binding', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'turenki-m14-files-'));
    tempDirectories.push(directory);
    const missing = join(directory, 'missing.pem');
    expect(() => loadTlsFiles(missing, missing)).toThrow(/Cannot read TLS certificate/);

    const certPath = join(directory, 'cert.pem');
    const keyPath = join(directory, 'key.pem');
    writeFileSync(certPath, '');
    writeFileSync(keyPath, '');
    expect(() => loadTlsFiles(certPath, keyPath)).toThrow(/is empty/);

    writeFileSync(certPath, 'not a certificate');
    writeFileSync(keyPath, 'not a key');
    expect(() => loadTlsFiles(certPath, keyPath)).toThrow(/Invalid TLS certificate or key/);
    await expect(startMatchServer({
      port: 0,
      playerIds: ['P1'],
      tls: { cert: 'not a certificate', key: 'not a key' },
    })).rejects.toThrow(/Invalid TLS certificate or key/);
  });
});

describe('M14 room code admission over real sockets', () => {
  async function start(ctx: TestContext): Promise<MatchServerHandle> {
    let server: MatchServerHandle;
    try {
      server = await startMatchServer({
        host: '127.0.0.1',
        port: 0,
        playerIds: ['P1', 'P2'],
        roomCode: 'room1',
        connectionMargin: 1,
        startMode: 'manual',
        log: () => undefined,
      });
      openServers.push(server);
    } catch (error) {
      const code = bindingFailure(error);
      ctx.skip(code === null
        ? `Local WebSocket server could not start: ${error instanceof Error ? error.message : String(error)}`
        : `Local WebSocket binding unavailable (${code})`);
      throw error;
    }
    return server;
  }

  it('rejects a missing and a wrong code before a slot is allocated', async (ctx: TestContext) => {
    const server = await start(ctx);
    expect(server.ready.roomCode).toBe('ROOM1');
    expect(server.ready.maxConnections).toBe(3);
    expect(server.ready.secure).toBe(false);
    const url = server.url!;

    const missingErrors: string[] = [];
    const missingJoins: boolean[] = [];
    const missing = await openNodeSession({
      url,
      handlers: {
        onError: error => missingErrors.push(error.code),
        onJoinResult: result => missingJoins.push(result.accepted),
      },
    });
    openClients.push(missing);
    missing.client.join(['P1']);
    await waitFor('missing-code denial', () => missingErrors.length > 0);
    expect(missingErrors).toEqual(['room-code-required']);
    expect(missingJoins).toEqual([]);
    expect(server.room.playerCount).toBe(0);
    missing.close();
    await waitFor('first socket close', () => server.room.connectionCount === 0);

    const wrongErrors: string[] = [];
    const wrongJoins: boolean[] = [];
    const wrong = await openNodeSession({
      url,
      handlers: {
        onError: error => wrongErrors.push(error.code),
        onJoinResult: result => wrongJoins.push(result.accepted),
      },
    });
    openClients.push(wrong);
    wrong.client.join(['P1'], 'WRONG');
    await waitFor('wrong-code denial', () => wrongErrors.length > 0);
    expect(wrongErrors).toEqual(['room-code-mismatch']);
    expect(wrongJoins).toEqual([]);
    expect(server.room.playerCount).toBe(0);
    wrong.close();
    await waitFor('second socket close', () => server.room.connectionCount === 0);

    const accepted = deferred<void>();
    const correct = await openNodeSession({
      url,
      handlers: { onJoinResult: result => { if (result.accepted) accepted.resolve(); } },
    });
    openClients.push(correct);
    correct.client.join(['P1'], 'ROOM1');
    await accepted.promise;
    expect(server.room.playerCount).toBe(1);

    // Once the match is running, a wrong code is still reported as a code
    // mismatch rather than leaking the match phase.
    const secondJoined = deferred<void>();
    const second = await openNodeSession({
      url,
      handlers: { onJoinResult: result => { if (result.accepted) secondJoined.resolve(); } },
    });
    openClients.push(second);
    second.client.join(['P2'], 'ROOM1');
    await secondJoined.promise;
    expect(server.start()).toEqual({ started: true });
    await waitFor('running match', () => server.room.phase === 'running');

    const lateErrors: string[] = [];
    const late = await openNodeSession({
      url,
      handlers: { onError: error => lateErrors.push(error.code) },
    });
    openClients.push(late);
    late.client.join(['P1'], 'WRONG');
    await waitFor('late wrong-code denial', () => lateErrors.length > 0);
    expect(lateErrors).toEqual(['room-code-mismatch']);
    expect(server.room.playerCount).toBe(2);
  });

  it('closes the socket beyond the documented connection cap', async (ctx: TestContext) => {
    const server = await start(ctx);
    expect(server.ready.maxConnections).toBe(3);
    const url = server.url!;
    const sockets: WebSocket[] = [];
    try {
      for (let index = 0; index < 3; index++) {
        sockets.push(await openRaw(url));
      }
      await waitFor('the accepted sockets to register', () => server.room.connectionCount === 3);
      const extra = new WebSocket(url);
      const closed = await closeCode(extra);
      expect(closed.code).toBe(1008);
      expect(closed.reason).toContain('connection limit');
      expect(server.room.connectionCount).toBe(3);
    } finally {
      for (const socket of sockets) socket.close();
    }
  });
});

describe('M14 TLS (wss) with a generated self-signed certificate', () => {
  it('serves wss and accepts a client that trusts the temporary certificate', async (ctx: TestContext) => {
    const material = createSelfSignedCertificate();
    if (material === null) {
      ctx.skip('openssl is unavailable; cannot generate a temporary self-signed certificate');
      return;
    }
    tempDirectories.push(material.directory);
    let server: MatchServerHandle;
    try {
      server = await startMatchServer({
        host: '127.0.0.1',
        port: 0,
        playerIds: ['P1', 'P2'],
        roomCode: 'TLS1',
        connectionMargin: 0,
        tls: { cert: material.cert, key: material.key },
        startMode: 'manual',
        log: () => undefined,
      });
      openServers.push(server);
    } catch (error) {
      const code = bindingFailure(error);
      ctx.skip(code === null
        ? `Local WSS server could not start: ${error instanceof Error ? error.message : String(error)}`
        : `Local WSS binding unavailable (${code})`);
      return;
    }

    expect(server.ready.secure).toBe(true);
    expect(server.ready.url).toBe(`wss://127.0.0.1:${server.port}`);
    const errors: string[] = [];
    const joined = deferred<void>();
    const session = await openNodeSession({
      url: server.url!,
      tls: { ca: material.cert },
      handlers: {
        onJoinResult: result => { if (result.accepted) joined.resolve(); },
        onError: error => errors.push(error.code),
      },
    });
    openClients.push(session);
    session.client.join(['P1'], 'TLS1');
    await joined.promise;
    expect(errors).toEqual([]);
    expect(server.room.playerCount).toBe(1);
  });
});

describe('M14 client scheme and room-code join', () => {
  it('shows a room-code field on the online join form', () => {
    const html = readFileSync(join(process.cwd(), 'online.html'), 'utf8');
    expect(html).toContain('id="room-code"');
    expect(html).toContain('name="room"');
    expect(html).toContain('for="room-code"');
  });

  it('lets the headless bot carry the room code', () => {
    expect(parseBotArgs(['--url=ws://127.0.0.1:8787', '--players=P2', '--room=ab12']).roomCode)
      .toBe('AB12');
    expect(parseBotArgs(['--url=ws://127.0.0.1:8787', '--players=P2']).roomCode).toBeNull();
    expect(() => parseBotArgs(['--url=ws://127.0.0.1:8787', '--players=P2', '--room=x']))
      .toThrow(/Invalid --room/);
  });

  it('chooses wss:// over https and ws:// otherwise unless the URL overrides it', () => {
    expect(defaultServerUrl('https:')).toBe('wss://127.0.0.1:8787');
    expect(defaultServerUrl('http:')).toBe('ws://127.0.0.1:8787');
    expect(resolveServerUrl('', 'https:')).toBe('wss://127.0.0.1:8787');
    expect(resolveServerUrl('example.test:8787', 'https:')).toBe('wss://example.test:8787');
    expect(resolveServerUrl('example.test:8787', 'http:')).toBe('ws://example.test:8787');
    expect(resolveServerUrl('ws://example.test:8787', 'https:')).toBe('ws://example.test:8787');
    expect(resolveServerUrl('wss://example.test:8787', 'http:')).toBe('wss://example.test:8787');
    expect(resolveServerUrl('https://example.test', 'http:')).toBe('wss://example.test');
  });

  it('sends the normalized room code in the join envelope', () => {
    let capturedUrl = '';
    let handlers: BrowserSocketHandlers | undefined;
    const sent: string[] = [];
    const controller = new OnlineMatchController({
      socketFactory: (url, socketHandlers) => {
        capturedUrl = url;
        handlers = socketHandlers;
        return { send: data => sent.push(data), close: () => undefined };
      },
      now: () => 0,
    });
    try {
      controller.connect({ url: 'ws://127.0.0.1:8787', playerId: 'P1', roomCode: 'ab12c' });
      expect(capturedUrl).toBe('ws://127.0.0.1:8787');
      expect(controller.roomCode).toBe('AB12C');
      handlers?.onOpen();
      expect(sent).toHaveLength(1);
      const envelope = decodeClientEnvelope(sent[0]!);
      expect(envelope.kind).toBe('join-request');
      if (envelope.kind !== 'join-request') throw new Error('Expected a join envelope');
      expect(envelope.roomCode).toBe('AB12C');
      expect(envelope.playerIds).toEqual(['P1']);
    } finally {
      controller.disconnect();
    }
  });

  it('canonicalizes the room code in the codec and rejects a malformed one', () => {
    const text = encodeClientEnvelope({
      version: 1,
      kind: 'join-request',
      sequence: 1,
      roomCode: 'ab12',
      playerIds: ['P1'],
    });
    expect(text).toBe('{"version":1,"kind":"join-request","sequence":1,"roomCode":"AB12","playerIds":["P1"]}');
    const decoded = decodeClientEnvelope(text);
    expect(decoded.kind).toBe('join-request');
    if (decoded.kind !== 'join-request') throw new Error('Expected a join envelope');
    expect(decoded.roomCode).toBe('AB12');
    expect(errorCode(() => decodeClientEnvelope(
      '{"version":1,"kind":"join-request","sequence":1,"roomCode":"abc","playerIds":["P1"]}',
    ))).toBe('invalid-envelope');
    expect(errorCode(() => decodeClientEnvelope(
      '{"version":1,"kind":"join-request","sequence":1,"roomCode":"ab12","playerIds":["P1"]}',
    ))).toBe('non-canonical-envelope');
  });

  it('rejects a malformed room code before opening a connection', () => {
    const controller = new OnlineMatchController({
      socketFactory: () => {
        throw new Error('the socket must not open');
      },
    });
    expect(() => controller.connect({ url: 'ws://127.0.0.1:8787', playerId: 'P1', roomCode: 'ab' }))
      .toThrow(/Room code must be 4-12/);
  });
});
