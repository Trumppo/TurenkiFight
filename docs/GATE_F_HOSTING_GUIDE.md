# Host a TurenkiFight online match

This guide covers the current single-room authoritative server. It is intended for a technically comfortable host, but avoids requiring game-source changes. The host starts the match process and shares its URL, room code and assigned player slots. There are no accounts, matchmaking, room discovery, persistence, host migration or admission authentication.

## Choose a network path

| Use | Web page | Match server | Guidance |
|---|---|---|---|
| Same trusted LAN | Vite/static page over HTTP | `ws://` on the host LAN address | Use only on a trusted private network. Restrict the firewall to the LAN. |
| VPN between players | Page over HTTP or HTTPS | VPN-reachable `ws://` or `wss://` | Preferred for a small remote group; permit only VPN peers. |
| Public internet | Public HTTPS page | Public `wss://` endpoint with a valid certificate | Use a DNS name and a publicly trusted TLS certificate. Do not expose plain `ws://`. Understand that a room code is not authentication. |

The static client and authoritative match server are separate processes. GitHub Pages hosts only static assets; it does not run the match server. The server is one room per process.

## LAN/VPN setup

1. Install Node.js and check out the repository on the host. From the repository root, run `npm ci`.
2. Start the browser page with `npm run dev -- --host 0.0.0.0` (development) or build it with `npm run build` and serve `dist/` on the LAN/VPN. Share the page address with players.
3. In another terminal, start the authoritative room. Example for a four-player match:

   ```sh
   npm run serve:match -- --host=0.0.0.0 --port=8787 --players=4 --snapshot-hz=20 --start=manual --rematch
   ```

   Add `--mode=score-brawl|last-man-standing|deathmatch|wave` as desired. Use `--start=manual` for browser lobby READY/host-start (the default auto mode starts as soon as the configured roster is full). The host presses **HOST START** after all joined participants show READY.
4. Copy the `match-server-ready` JSON line from stdout. It includes the listening URL and generated `roomCode`. Share the reachable server address, room code and one unique slot (P1…P4 in this example) with each player.
5. Players open `/online.html`, enter the server URL, room code and assigned slot, then choose **Connect**. In manual mode everyone chooses **READY**; the first player to join is the room host and can press **HOST START** when all required slots are ready. The server rejects start attempts from other players.
6. At results, use **Rematch** (requires `--rematch` and the complete roster to be present) or **Leave**. `quit` or Ctrl+C stops the server.

For eight players, set `--players=8` and assign P1 through P8. On a trusted network, use the host's LAN/VPN address, not `127.0.0.1` from another device. Open only the selected TCP port in the host firewall, and scope the rule to the private LAN/VPN where possible.

## Public internet with TLS

This is an operator-run deployment, not a managed service. A DNS name must resolve to the host, the host/network must permit inbound traffic, and the browser page must be served over HTTPS. Obtain and renew a certificate for the DNS name from a trusted certificate authority. Never commit or share the private key.

1. Build and host the static client on HTTPS (for example, use a maintained HTTPS static-file server or a reverse proxy such as Caddy). Publish the `dist/` files; GitHub Pages can provide this static HTTPS page if its public URL is suitable.
2. Make the match server reachable on a TLS endpoint. Direct TLS example:

   ```sh
   npm run serve:match -- --host=0.0.0.0 --port=8787 --players=4 --snapshot-hz=20 --start=manual --rematch --cert=/secure/path/fullchain.pem --key=/secure/path/private-key.pem
   ```

   The certificate must be valid for the hostname players use. Protect the key with restrictive filesystem permissions. The service must be restarted after certificate renewal unless the operator's deployment handles reloads.
3. In each browser, set the server field to `wss://your-match-host.example:8787` (or a WSS reverse-proxy URL) and enter the room code and unique slot. HTTPS pages default the URL scheme to WSS when the server field is left at its default; entering the actual hostname is still required.
4. Keep the firewall limited to the required HTTPS and WSS ports. Monitor server output, apply Node/runtime updates and stop the server after the session.

If a TLS-terminating reverse proxy is used, configure it to pass WebSocket upgrades and proxy to the private match-server listener. In that topology the proxy owns the public certificate; keep the backend port inaccessible from the public internet. Do not use a self-signed or expired certificate for ordinary browser sessions.

## Security and operational limits

- `wss` encrypts traffic but does not authenticate players. The room code is an admission secret, not an identity or anti-cheat mechanism; share it only with the intended group.
- Defaults: one room per process, up to eight player slots, a small connection margin for reconnects, 5120-byte messages, 240 messages per 1000 ms, five consecutive invalid-message failures, and a 30-second non-host rejoin window. These are policy limits, not performance measurements.
- Rejoin requires the same room code and player slot; do not treat it as account-grade identity. Host disconnect ends the room; there is no host migration.
- No capacity guarantee is made for LAN or internet. Gate E's two-machine RTT, jitter, loss and bandwidth values remain `NOT_MEASURED`; loopback and single-machine tests are not network evidence.
- The online client uses authoritative snapshots and has no prediction. Input responsiveness depends on the actual link and snapshot interval.

## Troubleshooting

| Symptom | Check |
|---|---|
| Browser cannot connect | Confirm the server ready line's address, correct `ws://` vs `wss://`, port/firewall and that the service is still running. |
| Room code rejected | Use the exact code from the ready line; codes are normalized to uppercase. |
| Slot rejected | Ensure each client uses a different configured player slot and the server `--players` count includes it. |
| HTTPS page reports mixed content | Use a `wss://` server URL with a valid certificate; browsers block insecure WebSocket from secure pages. |
| Rejoin fails | Rejoin within 30 seconds using the same room code and slot. The host cannot rejoin as host. |
| Rematch refused | Start the host with `--rematch` and ensure the required roster is connected again. |

For verified local checks, see the browser and server tests in the repository. Automated loopback tests validate the code path but do not certify the operator's DNS, firewall, certificate, router or internet path.
