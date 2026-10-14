# PianoLens rectangle test — Milestone A

Static deployment assets only. Pure black background, one white rectangle, local elapsed-time animation. No piano, MIDI, microphone, Android controller or relay.

Render: Static Site; branch main; Build Command `node --test timing.test.mjs`; Publish Directory `.`. No dependencies. Default Canvas drawing is capped at 30 Hz; `?fps=native` compares uncapped RAF and `?fps=15` selects a lower drawing budget.

Select the rectangle to see the device-local report. RAF and Canvas rates are not optical presentation FPS. Downloads and local storage require actual Meta Web App testing. No reports leave the device. Physical glasses performance is not yet verified.

Source and full investigation remain in the existing PianoLens Android workspace under `glasses-lab/milestone-a`. This repository intentionally does not contain the Android app.

Original PianoLens test code is MIT licensed; see LICENSE.
