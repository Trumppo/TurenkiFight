import { MAX_SESSION_ENVELOPE_BYTES } from '../../src/game/session/sessionEnvelope';

/**
 * Per-connection abuse policy for the operator-facing match server.
 *
 * These are **policy limits, not measurements**. No bandwidth, RTT or
 * throughput number is implied by them, and none was measured on a real
 * network; the two-machine measurement in `docs/M14_ONLINE_SECURITY.md` stays
 * owner-blocked.
 *
 * The defaults leave generous headroom over honest traffic. The browser client
 * submits at most one input frame per simulation tick (60 Hz) plus an occasional
 * ping, so an honest connection stays far below the rate limit. The limits
 * still bound what one peer can make the server parse:
 *
 * - one message larger than {@link MAX_CLIENT_MESSAGE_BYTES} → close 1009;
 * - more than {@link MAX_CLIENT_MESSAGES_PER_WINDOW} messages in the sliding
 *   {@link CLIENT_MESSAGE_WINDOW_MS} window → close 1013;
 * - {@link MAX_CLIENT_VALIDATION_FAILURES} consecutive protocol or authorization
 *   failures → close 1008;
 * - a room-code rejection always closes the socket with 1008.
 *
 * `startWsServer` itself stays policy-free so the deterministic benchmark
 * harness can submit a synthetic burst on loopback; `startMatchServer` always
 * supplies {@link CLIENT_MESSAGE_POLICY}, which is what `npm run serve:match`
 * uses.
 */
export type ClientMessagePolicy = {
  /** Largest accepted client message, in UTF-8 bytes. */
  readonly maxMessageBytes: number;
  /** Message count allowed inside one sliding window. */
  readonly maxMessagesPerWindow: number;
  /** Sliding window length in milliseconds. */
  readonly windowMs: number;
  /** Consecutive protocol/authorization denials before the socket is closed. */
  readonly maxValidationFailures: number;
};

/** The envelope codec cap is the single source of truth for one message. */
export const MAX_CLIENT_MESSAGE_BYTES = MAX_SESSION_ENVELOPE_BYTES;
export const CLIENT_MESSAGE_WINDOW_MS = 1000;
/**
 * Four times the 60 Hz input cadence, so a normal jitter burst or a snapshot
 * recovery can never approach the limit. Policy, not a measured ceiling.
 */
export const MAX_CLIENT_MESSAGES_PER_WINDOW = 240;
export const MAX_CLIENT_VALIDATION_FAILURES = 5;

/**
 * Hard transport bound above the policy. The extra allowance means an
 * over-policy message is closed by the server with its own reason instead of
 * the WebSocket library's generic payload error; it is not a second policy.
 */
export const CLIENT_FRAME_SLACK_BYTES = 1024;
export const MAX_CLIENT_FRAME_BYTES = MAX_CLIENT_MESSAGE_BYTES + CLIENT_FRAME_SLACK_BYTES;

/** Standard application close codes, kept as named constants for tests/logs. */
export const WS_CLOSE_POLICY_VIOLATION = 1008;
export const WS_CLOSE_MESSAGE_TOO_LARGE = 1009;
export const WS_CLOSE_RATE_LIMITED = 1013;

/**
 * Exported so the ready line and a test read the same strings. The reason is
 * human-readable and deliberately contains no client identity or address.
 */
export const CLOSE_REASON_MESSAGE_TOO_LARGE = `client message exceeds ${MAX_CLIENT_MESSAGE_BYTES} bytes`;
export const CLOSE_REASON_RATE_LIMITED =
  `client message rate exceeds ${MAX_CLIENT_MESSAGES_PER_WINDOW} per ${CLIENT_MESSAGE_WINDOW_MS} ms`;
export const CLOSE_REASON_ROOM_CODE = 'room code rejected';
export const CLOSE_REASON_VALIDATION_FAILURES =
  `too many consecutive invalid client messages (${MAX_CLIENT_VALIDATION_FAILURES})`;

export const CLIENT_MESSAGE_POLICY: ClientMessagePolicy = {
  maxMessageBytes: MAX_CLIENT_MESSAGE_BYTES,
  maxMessagesPerWindow: MAX_CLIENT_MESSAGES_PER_WINDOW,
  windowMs: CLIENT_MESSAGE_WINDOW_MS,
  maxValidationFailures: MAX_CLIENT_VALIDATION_FAILURES,
};

export type PolicyCloseAction = {
  readonly closeCode: number;
  readonly reason: string;
};

/**
 * Denials that prove a peer is not speaking the protocol or is probing for
 * slots it does not own. Tick-window denials (`late-tick`, `future-tick`,
 * `tick-out-of-window`) are deliberately excluded: a stalled but honest client
 * can receive several of those and already recovers from them, and lifecycle
 * or capacity denials (`match-started`, `rematch-disabled`, `roster-incomplete`,
 * ...) are normal refusals rather than attacks.
 */
const VALIDATION_FAILURE_CODES: ReadonlySet<string> = new Set([
  // Envelope codec failures.
  'oversized',
  'invalid-encoding',
  'invalid-json',
  'invalid-envelope',
  'unsupported-version',
  'unknown-kind',
  'unknown-field',
  'invalid-sequence',
  'invalid-tick',
  'tick-mismatch',
  'malformed-input',
  'non-canonical-envelope',
  // Gateway authorization and sequence failures.
  'invalid-binding',
  'room-mismatch',
  'not-joined',
  'already-joined',
  'replayed-sequence',
  'sequence-exhausted',
  'tick-exhausted',
  'unauthorized-player',
  'player-owned',
  'duplicate-input',
  'invalid-state',
  // Room-level roster denial (the claim names a slot outside the roster).
  'unknown-player',
]);

export function isValidationFailureCode(code: string): boolean {
  return VALIDATION_FAILURE_CODES.has(code);
}

/** `room-code-required` and `room-code-mismatch` end the connection at once. */
export function isRoomCodeDenial(code: string): boolean {
  return code === 'room-code-required' || code === 'room-code-mismatch';
}

export function roomCodeCloseAction(code: string): PolicyCloseAction {
  return { closeCode: WS_CLOSE_POLICY_VIOLATION, reason: `${CLOSE_REASON_ROOM_CODE} (${code})` };
}

/**
 * Stateful guard for one trusted connection.
 *
 * `admit` is called with the byte length of every delivered message before the
 * session parses it; `noteDenial`/`noteAccepted` track consecutive protocol
 * failures. The clock is injected so the window boundary is unit-testable
 * without sleeping.
 */
export class ClientMessageGuard {
  private readonly arrivals: number[] = [];
  private failures = 0;

  constructor(private readonly policy: ClientMessagePolicy = CLIENT_MESSAGE_POLICY) {
    if (!Number.isSafeInteger(policy.maxMessageBytes) || policy.maxMessageBytes < 1 ||
        !Number.isSafeInteger(policy.maxMessagesPerWindow) || policy.maxMessagesPerWindow < 1 ||
        !Number.isSafeInteger(policy.windowMs) || policy.windowMs < 1 ||
        !Number.isSafeInteger(policy.maxValidationFailures) || policy.maxValidationFailures < 1) {
      throw new Error('Invalid client message policy');
    }
  }

  /** Size first, then the sliding rate window. Returns a close action on breach. */
  admit(bytes: number, now: number): PolicyCloseAction | null {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.policy.maxMessageBytes) {
      return { closeCode: WS_CLOSE_MESSAGE_TOO_LARGE, reason: CLOSE_REASON_MESSAGE_TOO_LARGE };
    }
    this.arrivals.push(now);
    const cutoff = now - this.policy.windowMs;
    while (this.arrivals.length > 0 && this.arrivals[0]! <= cutoff) this.arrivals.shift();
    if (this.arrivals.length > this.policy.maxMessagesPerWindow) {
      // Keep the buffer bounded even if a caller ignores the close action.
      this.arrivals.shift();
      return { closeCode: WS_CLOSE_RATE_LIMITED, reason: CLOSE_REASON_RATE_LIMITED };
    }
    return null;
  }

  /** Records a denial; returns a close action once the failure budget is spent. */
  noteDenial(code: string): PolicyCloseAction | null {
    if (!isValidationFailureCode(code)) return null;
    this.failures += 1;
    if (this.failures < this.policy.maxValidationFailures) return null;
    return { closeCode: WS_CLOSE_POLICY_VIOLATION, reason: CLOSE_REASON_VALIDATION_FAILURES };
  }

  /** A valid message proves the peer can still speak the protocol. */
  noteAccepted(): void {
    this.failures = 0;
  }

  get consecutiveFailures(): number {
    return this.failures;
  }
}
