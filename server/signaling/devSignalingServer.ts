import { startSignalingServer } from './signalingServer';
import { DEFAULT_SIGNALING_ROOM_ID } from './signalingRelay';

/**
 * Development entry point for the WebRTC prototype signaling relay.
 *
 * Started by Playwright's webServer array (or manually) and unrelated to the
 * game server: it relays only room-scoped offer/answer/ICE messages.
 */
function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find(entry => entry.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function portArgument(raw: string | undefined): number {
  if (raw === undefined) return 4174;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 65535) {
    throw new Error(`Invalid signaling port: ${raw}`);
  }
  return value;
}

const port = portArgument(argument('port'));
const host = argument('host') ?? '127.0.0.1';
const roomId = argument('room') ?? DEFAULT_SIGNALING_ROOM_ID;

const server = await startSignalingServer({ port, host, roomId });
process.stdout.write(`${JSON.stringify({
  event: 'signaling-listening',
  host: server.host,
  port: server.port,
})}\n`);

let stopping = false;
const shutdown = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  await server.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
