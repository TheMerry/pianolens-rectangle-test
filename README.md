# PianoLens rectangle test — Milestones A and B

Static deployment assets only. Pure black background, one white rectangle, local elapsed-time animation. No piano, MIDI, microphone, library or relay.

The default URL preserves the independent animation test. Milestone B adds `pair.html` and `index.html?control=1`, accepting start, pause, resume, reset and speed commands from the existing Android app's opt-in WebSocket test server. Pair using the temporary endpoint/token displayed in Android. Tokens belong in the URL fragment, not query parameters; they stay out of hosting requests and reports. Authentication over plaintext LAN is only a trusted-network diagnostic, not production transport.

The browser freezes on disconnect, reconnects with bounded exponential backoff and receives a fresh authoritative state snapshot. Android sends commands, not frames. The device-local report records connection attempts, received revisions, ping round trip and estimated command transit; these do not measure optical presentation latency. Desktop browser plus Android emulator transport has been tested; phone-to-physical-glasses reachability and HTTPS mixed-content constraints still require device testing. Do not disable browser security or certificate checks.

Render: Static Site; branch main; Build Command `node --test timing.test.mjs`; Publish Directory `.`. No dependencies. Default Canvas drawing is capped at 30 Hz; `?fps=native` compares uncapped RAF and `?fps=15` selects a lower drawing budget.

Select the rectangle to see the device-local report. RAF and Canvas rates are not optical presentation FPS. Downloads and local storage require actual Meta Web App testing. No reports leave the device. Physical glasses performance is not yet verified.

Source and full investigation remain in the existing PianoLens Android workspace under `glasses-lab/milestone-a`. This repository intentionally does not contain the Android app.

Original PianoLens test code is MIT licensed; see LICENSE.
