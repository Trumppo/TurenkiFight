import { runBot } from './runBot';

/**
 * Script entry for `npm run bot`.
 *
 * Kept separate from `runBot.ts` so tests can import the parser and runner
 * without executing a CLI against the test runner's own argv. `process.exitCode`
 * is set instead of calling `process.exit`, so pending socket close handshakes
 * and buffered output finish first.
 */
try {
  process.exitCode = await runBot(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`bot: unexpected: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
