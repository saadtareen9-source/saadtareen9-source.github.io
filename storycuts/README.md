# StoryCuts (MVP)

Tell your story on camera. StoryCuts turns it into an illustrated video: your face for the hook,
punchlines and reactions, and stick-figure scenes that act out what you're describing, with the
same characters throughout.

Live at **https://saadtareen9-source.github.io/storycuts/** (static site, no backend, no build step).

## The flow
Upload → choose a style (slider of style cards) → **Create my video** (transcribe, plan, design the cast; you approve it) → scenes are drawn → edit & export.
Scenes are full-frame cuts by default; a "face bubble" mode keeps your face in a corner during scenes.
Consistency: characters are drawn once as master references; the AI editor defines recurring locations with fixed descriptions, and the first shot of each location is drawn first and passed as a reference to later shots there; each style has a detailed recipe plus an "avoid" list; Claude rejects any image scoring under 7/10 (anatomy, stray text, character/location/style mismatch, sloppy rendering) and it's redrawn.
Custom styles: "Create your own" (text description + optional example image used as a style reference) and "Extra details" added to any style.
Baseline style anchors: each built-in style can have one official reference image (`assets/styles/<id>.png`, listed in `assets/styles/manifest.json`). It's attached to every generation in that style so the look is identical across users and projects, and doubles as the slider thumbnail. Create them with `tools/style-anchors.html` (uses your saved OpenAI key; every style draws the same subject).

## The six MVP steps
1. **Upload** a video (stays in the browser; rights confirmation required).
2. **Transcript with word timestamps**: Whisper runs locally via transformers.js (free), or paste text and it's aligned to the speech in the audio.
3. **AI edit plan**: Claude decides face / scene / scene + face bubble for every line and writes each scene. Fully editable. An offline keyword planner works without a key.
4. **Characters with approval**: every person gets one design (shirt colour, hair, accessory, height).
5. **Scenes + automatic QC**: every plan goes through deterministic checks with auto-fixes (unknown characters, overlapping figures, unreadable speech bubbles, shots under 1s, hook on face, creator not missing for too long…). "Redo with AI" and "Surprise me" per scene.
6. **Export** 9:16 or 16:9 with burned-in word-highlight captions, corner face bubble, punch-in zooms. Also exports `.srt` and a project file.

## How the illustrations work
- **Claude** plans the edit and writes each scene as a visual brief (who is where, doing what, which expressions), plus a one-line design for every character.
- **OpenAI GPT Image 2** (default; Google's Nano Banana models are an option in Settings) draws each character once (the creator's own character can be based on a frame from their video), then draws every scene with those character images attached as references, so the cast stays consistent.
- **Claude checks every image** (broken anatomy, stray text, characters not matching their reference, wrong moment) and failed images are redrawn automatically, up to twice, with the problems spelled out. Anything still flagged gets a ⚠ on the timeline.
- Images are stored in the browser (IndexedDB) and animated in the video with a slow push-in and pan.
- Art styles: stick figures (default), flat cartoon, comic book, storybook.
- Until a scene has an AI image, the preview shows a quick drawn draft (`js/draw.js`), so you can review timing before spending anything.

Cost (rough estimates): about $0.05 per image with GPT Image 2 at medium quality (about $0.15 at high), plus about $0.02 per Claude check. A 3–5 minute video with 20 scenes costs roughly $1–1.50. The app shows the estimate before generating.

## Files
- `js/app.js`: UI and workflow
- `js/planner.js`: Claude planner (structured outputs) + offline heuristic planner
- `js/qc.js`: validation and auto-fix rules
- `js/images.js`: OpenAI / Gemini image generation, Claude image QC, retries, IndexedDB storage
- `js/draw.js`: draft renderer used before AI images exist
- `js/render.js`: compositor (shared by preview and export), captions, MediaRecorder export
- `js/transcribe.js`: in-browser Whisper and pasted-transcript alignment

## Notes
- Claude and image-model calls go straight from the browser using the user's own keys (stored in localStorage). For a public launch, move this behind a small server so users don't need a key, and to meter credits.
- Export is real-time (the video plays once while recording). Chrome/Edge produce MP4 where supported, otherwise WebM.

## Sound effect packs

Built-in sounds are synthesized in `js/sfx.js`. To add real recordings, drop audio files in
`assets/sfx/` and list them in `assets/sfx/manifest.json`:

```json
{ "sounds": [ { "id": "boom_real", "name": "Big boom", "cat": "impact", "icon": "burst", "file": "boom.mp3" } ] }
```

`cat` is one of impact, whoosh, comedy, reveal, real. `icon` is one of the `i-sfx-*` symbols in `index.html`.
Users can also upload their own sounds and music in the editor's Audio tab (stored in their browser only).
