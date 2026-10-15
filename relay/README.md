# PianoLens hybrid glasses renderer

The existing rectangle diagnostic remains at `/`. The piano lesson renderer is at `/piano` (600x600, black, 20 white keys with an 80px shallow key-top strip). Android owns MIDI parsing, score structure, timing, mode, microphone/chord matching and settings. The browser draws locally and clamps at the next unresolved Wait chord; it does not parse MIDI or process microphone audio.

Piano rooms accept bounded score chunks (64 notes, maximum 20,000 notes per selected section) followed by small authoritative state/confirmation messages. Heartbeat/state snapshots are sent every two seconds, not every frame. No bitmap streaming. A missing connection/heartbeat freezes the view; reconnect reloads the selected score and state from Android. The original rectangle room protocol is kept separate and its tests remain.

Open `/piano` on glasses, read the short code, enter it in Android's **Glasses piano lesson · Web App** panel, then use the existing main song and Practice/Listen controls. Do not use the rectangle panel's code or controls for piano. The native DAT renderer remains a separate fallback. Both sides need internet for the relay route.

Piano pairing is remembered in browser localStorage where permitted and Android app-private preferences (Android backup is disabled). It is best effort: the relay's memory-only rooms expire within six hours, inactive rooms are removed after both sides leave, and service restarts lose pairing. Android offers Disconnect and Forget pairing. Select an unpaired/disconnected canvas to request a new code. Credentials never enter URL queries/fragments or application logs. They are development-session credentials, not user accounts.

WSS uses normal certificate validation; TLS terminates at Render. The relay can read score notes and control messages: transport is encrypted, not end-to-end encrypted. It does not store a song library, audio, frames, accounts or a database. Roles/room types, origins, message sizes, pairing attempts and connection counts are bounded. Slow peers disconnect and restore fresh state instead of accumulating animation frames. This is a small development service, not production multi-tenant infrastructure.

Local: `npm ci --ignore-scripts`, `npm test`, `npm start` (port 8787). `/health` returns service identity only. The service is deployed as Render **Web Service**, Root Directory `relay`, build `npm ci --ignore-scripts && npm test`, start `npm start`, health `/health`, Free instance, Auto-Deploy Off. Free Render instances share limited usage allowances, sleep with inactivity and can take around a minute to wake. No paid plan is selected. Phone practice remains offline; the relay path does not.

Build `piano.js` and `lesson.js` from the canonical PianoLens TypeScript using `node scripts/build-hybrid.mjs`, then export the self-contained deployment with `node scripts/export-rectangle-relay.mjs`. The generated bundles preserve the reused React Piano Roll MIT notice. Rectangle timing helpers remain canonical under milestone-a/dist. Runtime dependency `ws` 8.22.0 is MIT. See LICENSE and bundled notices.

Direct phone loopback was attempted on physical glasses without a browser connection; its precise failure remains unconfirmed. A shared LAN was unavailable on the user's mobile-data setup. The authorised relay is the practical tested fallback, not a claim that every direct route is impossible. Physical-glasses acceptance of piano visuals, sustained FPS, alignment, acoustic confirmation, reconnect and storage remains required.

References: https://render.com/docs/websocket , https://render.com/docs/free , https://github.com/facebook/meta-wearables-webapp , https://github.com/websockets/ws .
