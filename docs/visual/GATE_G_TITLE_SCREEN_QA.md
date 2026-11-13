# Gate G title-screen visual QA

Title and main-menu captures were rendered with headless Chromium at 640×360
and 1280×720. These are illustrative review captures, not pixel-byte baselines.

| State | 640×360 | 1280×720 |
| --- | --- | --- |
| Fresh title | [title-640.png](gate-g-title/title-640.png) | [title-1280.png](gate-g-title/title-1280.png) |
| Main menu | [menu-640.png](gate-g-title/menu-640.png) | [menu-1280.png](gate-g-title/menu-1280.png) |

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
