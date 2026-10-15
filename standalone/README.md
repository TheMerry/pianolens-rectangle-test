# PianoLens Standalone

Independent visual MIDI playback. No Android bridge, microphone, Wait Mode or live relay. Reuses existing MIDI parser, MusicEngine, geometry and piano renderer. Starter songs plus personal MIDI library when configured. Upload at /upload.html, then save the read-only glasses link once. The upload browser can close during playback. 25–150% speed, pause/resume, restart, repeat.

Library API origin is in library-config.json. The library backend requires durable storage. Selected songs cache in IndexedDB where supported; shell uses a service worker. Physical-glasses offline storage remains to verify. Piano sound is not implemented in this standalone release.
