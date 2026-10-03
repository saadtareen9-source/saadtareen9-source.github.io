# StoryCuts (MVP)

Tell your story on camera. StoryCuts turns it into an illustrated video: your face for the hook,
punchlines and reactions, and stick-figure scenes that act out what you're describing, with the
same characters throughout.

Live at **https://saadtareen9-source.github.io/storycuts/** (static site, no backend, no build step).

## The six MVP steps
1. **Upload** a video (stays in the browser; rights confirmation required).
2. **Transcript with word timestamps**: Whisper runs locally via transformers.js (free), or paste text and it's aligned to the speech in the audio.
3. **AI edit plan**: Claude decides face / scene / scene + face bubble for every line and writes each scene. Fully editable. An offline keyword planner works without a key.
4. **Characters with approval**: every person gets one design (shirt colour, hair, accessory, height).
5. **Scenes + automatic QC**: every plan goes through deterministic checks with auto-fixes (unknown characters, overlapping figures, unreadable speech bubbles, shots under 1s, hook on face, creator not missing for too long…). "Redo with AI" and "Surprise me" per scene.
6. **Export** 9:16 or 16:9 with burned-in word-highlight captions, corner face bubble, punch-in zooms. Also exports `.srt` and a project file.

## Key design decision: scenes are drawn, not generated
Instead of generating 15–30 images per video, Claude writes each scene as structured data
(setting, characters, poses, expressions, props, effects, speech), and `js/draw.js` renders it.
That means:
- **Perfect character consistency**: a character is a fixed set of attributes, so they can't drift.
- **No broken hands or stray text**: QC is deterministic and every fix is free.
- **Cost per video drops from ~$1–2.50 to a few cents** (only the planning call).
- Scenes are lightly animated (walk cycles, blinking, smoke, camera push-in), not static stills.

An AI image backend can be added later as a premium "art style" layer on top of the same plan.

## Files
- `js/app.js`: UI and workflow
- `js/planner.js`: Claude planner (structured outputs) + offline heuristic planner
- `js/qc.js`: validation and auto-fix rules
- `js/draw.js`: stick-figure, setting, prop and effect renderer
- `js/render.js`: compositor (shared by preview and export), captions, MediaRecorder export
- `js/transcribe.js`: in-browser Whisper and pasted-transcript alignment

## Notes
- Claude calls go straight from the browser to api.anthropic.com using the user's own key (stored in localStorage). For a public launch, move this behind a small server so users don't need a key, and to meter credits.
- Export is real-time (the video plays once while recording). Chrome/Edge produce MP4 where supported, otherwise WebM.
