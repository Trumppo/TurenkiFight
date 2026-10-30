import { encodeInputFrame, MAX_INPUT_FRAME_BYTES, type InputFrame } from './inputFrame';
import { encodeStateSnapshot, MAX_SNAPSHOT_BYTES, type StateSnapshot } from './stateSnapshot';

function byteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

/** FNV-1a 32-bit over UTF-8 bytes: reproducible diagnostic fingerprint, not security. */
export function fingerprintUtf8(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function inputFrameFingerprint(frame: InputFrame): string {
  const encoded = encodeInputFrame(frame);
  if (byteLength(encoded) > MAX_INPUT_FRAME_BYTES) throw new Error('Input frame exceeds size limit');
  return fingerprintUtf8(encoded);
}

export function stateSnapshotFingerprint(snapshot: StateSnapshot): string {
  const encoded = encodeStateSnapshot(snapshot);
  if (byteLength(encoded) > MAX_SNAPSHOT_BYTES) throw new Error('State snapshot exceeds size limit');
  return fingerprintUtf8(encoded);
}

export function assertWireSize(json: string, kind: 'input' | 'snapshot'): void {
  const limit = kind === 'input' ? MAX_INPUT_FRAME_BYTES : MAX_SNAPSHOT_BYTES;
  if (byteLength(json) > limit) throw new Error(kind + ' message exceeds size limit');
}
