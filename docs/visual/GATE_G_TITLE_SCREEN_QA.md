# Gate G title-screen visual QA

Title and main-menu captures were rendered with headless Chromium at 640×360
and 1280×720. These are illustrative review captures, not pixel-byte baselines.

| State | 640×360 | 1280×720 |
| --- | --- | --- |
| Fresh title | [title-640.png](gate-g-title/title-640.png) | [title-1280.png](gate-g-title/title-1280.png) |
| Main menu | [menu-640-first-gesture.png](gate-g-title/menu-640-first-gesture.png) | [menu-1280.png](gate-g-title/menu-1280.png) |
| Local play / short HUD | [short-hud-640x360.png](gate-g-title/short-hud-640x360.png) | — |

The title is a hand-authored, original pixel-art SVG using nearest-neighbor
rendering. The existing local lobby and online room setup remain the routes
behind the menu. No simulation, scoring, room protocol or music composition was
changed. Music uses the existing procedural arrangement and is unlocked only
after activation.

Limitations: physical gamepad hardware and browser-specific gamepad audio
autoplay behavior were not tested. The browser integration service was
unavailable in the in-app Review browser; captures and smoke checks used
Playwright's local headless Chromium instead. Gate G remains pending owner
playtest and acceptance.

Manual Chromium on the current implementation at 640×360 confirmed the title and
menu render before the game canvas, first title activation creates/resumes audio,
and LOCAL FIGHT mounts one `#audio-mute` control. After local route activation
the HUD measured 45 CSS px against the scoreboard band's 54.4 CSS px bottom; the
canvas remains within the 360 px viewport. The short-HUD capture is illustrative,
not a pixel baseline. After merging Tester head `ea2edb1`, focused Playwright
coverage for title routes/activation, audio, and retro-scale/HUD completed 29/29.
