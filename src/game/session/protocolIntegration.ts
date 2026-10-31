import { AuthorizedSessionIngress } from './authorizedSessionIngress';
import { encodeInputFrame, parseInputFrame, type InputFrame } from '../protocol/inputFrame';

/**
 * Authority boundary: only consume frames assembled by AuthorizedSessionIngress.
 * Never accept a client-authored InputFrame at this boundary.
 * Authentication of connectionId remains the responsibility of the transport adapter.
 */
export function consumeAuthorizedFrame(ingress: AuthorizedSessionIngress): InputFrame {
  const frame = parseInputFrame(ingress.consume());
  // Enforce the same UTF-8 wire size limit used by the standalone codec.
  encodeInputFrame(frame);
  return frame;
}
