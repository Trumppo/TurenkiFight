import {
  DEFAULT_MATCH_CONNECTION_MARGIN,
  formatMatchReadyLine,
  generateRoomCode,
  loadTlsFiles,
  parseServeMatchArgs,
  serveMatchUsage,
  startMatchServer,
  type MatchServerHandle,
  type MatchStartFailureReason,
  type MatchTlsMaterial,
} from './matchServer';

/**
 * CLI entry for `npm run serve:match`.
 *
 * One machine-readable JSON ready line goes to stdout so another process can
 * find the URL; everything a human reads goes to stderr. SIGINT/SIGTERM stop the
 * 60 Hz tick timer and close every socket before the process exits.
 *
 * One match per process by default. With `--rematch`, an accepted client
 * `rematch` starts another match in the same process with the same roster and
 * mode; without it, a `rematch` is denied and the historical lifecycle stands.
 * A non-host player who drops mid-match keeps a 30 s rejoin window; host
 * migration remains out of scope.
 *
 * A short room code is always printed in the ready line and required on join.
 * `--room` fixes it; otherwise one is generated. `--cert`/`--key` switch the
 * listener to https/wss with the operator's PEM material.
 */

const STATUS_PREFIX = 'match server: ';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function startFailureMessage(reason: MatchStartFailureReason | undefined): string {
  switch (reason) {
    case 'roster-incomplete':
      return 'not every configured player slot has joined yet';
    case 'already-started':
      return 'the match has already started';
    case 'closed':
      return 'the session is closed and cannot start';
    case 'not-startable':
      return 'the session cannot start in its current phase';
    default:
      return 'unknown reason';
  }
}

export async function runServeMatch(argv: readonly string[]): Promise<void> {
  const status = (line: string): void => {
    process.stderr.write(`${STATUS_PREFIX}${line}\n`);
  };

  let options: ReturnType<typeof parseServeMatchArgs>;
  try {
    options = parseServeMatchArgs(argv);
  } catch (error) {
    process.stderr.write(`${STATUS_PREFIX}${errorText(error)}\n\n${serveMatchUsage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(`${serveMatchUsage()}\n`);
    return;
  }

  // The room code is an admission code, not authentication: it is printed so
  // the operator can pass it to the players. `--room` fixes it; otherwise a
  // short unambiguous code is generated per process.
  const roomCode = options.roomCode ?? generateRoomCode();
  let tls: MatchTlsMaterial | null = null;
  if (options.cert !== null && options.key !== null) {
    try {
      tls = loadTlsFiles(options.cert, options.key);
    } catch (error) {
      status(errorText(error));
      process.exitCode = 1;
      return;
    }
  }

  let handle: MatchServerHandle;
  try {
    handle = await startMatchServer({
      host: options.host,
      port: options.port,
      playerIds: options.playerIds,
      mode: options.mode,
      snapshotHz: options.snapshotHz,
      startMode: options.startMode,
      allowRematch: options.rematch,
      roomCode,
      connectionMargin: DEFAULT_MATCH_CONNECTION_MARGIN,
      ...(tls === null ? {} : { tls }),
      log: status,
      onReady: info => {
        // The only stdout output: exactly one line, no peer addresses or metrics.
        process.stdout.write(`${formatMatchReadyLine(info)}\n`);
        status(info.url === null
          ? `bound ${info.host}:${info.port}; wildcard bind, connect with this machine's LAN address`
          : `listening on ${info.url} for ${info.playerIds.join(', ')}`);
        status(`mode: ${info.mode}`);
        status(`room code: ${info.roomCode ?? 'not enforced'} · ` +
          `max connections: ${info.maxConnections}${info.secure ? ' · TLS' : ''}`);
        status(`per-connection limits: ${info.maxMessageBytes} B/message · ` +
          `${info.maxMessagesPerWindow} messages/${info.messageRateWindowMs} ms · ` +
          `${info.maxValidationFailures} consecutive invalid messages (policy, not measured)`);
      },
    });
  } catch (error) {
    status(`could not bind ${options.host}:${options.port}: ${errorText(error)}`);
    process.exitCode = 1;
    return;
  }

  let stdinAttached = false;
  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    status(`${signal} received; stopping timers and closing sockets`);
    if (stdinAttached) {
      process.stdin.removeAllListeners('data');
      // Destroy, not pause: a resumed stdin handle otherwise keeps the process
      // alive after the server has closed.
      process.stdin.destroy();
      stdinAttached = false;
    }
    void handle.close().then(
      () => status('closed'),
      error => {
        status(`shutdown failed: ${errorText(error)}`);
        process.exitCode = 1;
      },
    );
  };

  // stdin is the cross-platform control channel; SIGINT/SIGTERM do the same.
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      const command = line.trim();
      if (command === 'start') {
        const result = handle.start();
        status(result.started
          ? 'explicit start accepted'
          : `explicit start rejected: ${startFailureMessage(result.reason)}`);
        continue;
      }
      if (command === 'quit' || command === 'stop') {
        shutdown('stdin');
        continue;
      }
      if (command.length > 0) status(`ignored stdin command: ${command}`);
    }
  });
  process.stdin.resume();
  stdinAttached = true;
  status(options.startMode === 'manual'
    ? 'manual start mode: type "start" and press Enter once the roster is full'
    : 'type "quit" and press Enter to stop the server');

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

await runServeMatch(process.argv.slice(2));
