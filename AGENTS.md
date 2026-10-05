# AGENTS.md: StoryCuts

Read this first. It explains how this project works so you don't break it.

## What this repo is

- **StoryCuts** lives in `/storycuts/` and is served at https://saadtareen9-source.github.io/storycuts/ by GitHub Pages from `main`.
- **The product:** a creator uploads a video of themselves telling a story (a "storytime"). The app:
  1. transcribes the video in the browser
  2. plans the edit with Claude: when to show their face and when to cut to an illustrated scene
  3. lets them check and draw the characters
  4. draws every scene with OpenAI images, using those characters for consistency
  5. opens a CapCut-style editor to export a finished vertical or horizontal video
- **The owner is a beginner.** They want a polished, professional, easy-to-follow product: no emojis, nothing that looks like generated code, clear buttons, one obvious next step per screen, smooth on phone and desktop.
- The repo root also has `README.md` and `app-ads.txt`. Leave both alone.

## Architecture

The site is static. There is **no build step and no framework**: plain HTML, CSS and native ES modules. Keep it that way. Don't add React, Tailwind, bundlers or runtime npm dependencies.

| File | What it is |
|---|---|
| `storycuts/index.html` | All page markup: landing, 5-step wizard, editor, dialogs. Also holds the SVG icon sprite (`<symbol id="i-...">`), the import map and a self-update script. |
| `storycuts/style.css` | The whole design system. Tokens are in `:root`. Sections: buttons, forms, nav, landing, wizard steps, characters, editor (in-page, desktop app `body.ed-app`, phone `body.ed-full`), progress screen (`.work`), pricing, dialogs. |
| `storycuts/js/app.js` | All UI logic and state (`state`, exposed as `window.__storycuts`). Generates markup for character cards, timeline clips, the shot inspector, sound tiles, filter tiles, plans and project cards. |
| `storycuts/js/experience.js` | Presentation-only extras: the landing page before/after showreel, the style preview and the cast quick-jump buttons. The example clips and art are in `storycuts/assets/examples/` (sources and licenses in its `CREDITS.md`). |
| `storycuts/js/loader.js` | `showWork()` full-screen progress (steps, ETA, Stop/Cancel, "Back to editor" with a background pill) and the small `showLoader()`. |
| `storycuts/js/render.js` | The canvas renderer used for both preview and export: shots, Ken Burns, "living pictures" motion and effects, captions, filters, transitions, audio mix, MediaRecorder export. |
| `storycuts/js/planner.js` | The Claude prompts and JSON schemas: plan the edit, then a continuity review that fixes who is where (texts and calls become two shots). `callClaude()` calls the API from the browser via the `@anthropic-ai/sdk` ESM build. |
| `storycuts/js/qc.js` | Normalises and validates the plan: hook face shot, cut-backs, minimum lengths, staging rules. |
| `storycuts/js/images.js` | OpenAI `gpt-image-2` drawing, Claude vision quality checks, art styles, and IndexedDB picture storage (`putBlob`, `getBlob`, `hasBlob`). |
| `storycuts/js/transcribe.js` | In-browser speech-to-text and transcript import. |
| `storycuts/js/sfx.js` | Sound effects library and players. |
| `storycuts/js/billing.js` | Subscription plans and the paywall. Stripe links are not filled in yet; `?unlock=owner` gives the owner access. |
| `storycuts/js/animate.js` and `storycuts/server/video-relay.js` | Dormant code for animated (video) scenes. OpenAI discontinued the Sora video API on 24 Sept 2026, so this option is hidden. Leave it in place. |
| `storycuts/tools/bump-version.py` | Cache busting (see the workflow below). |
| `storycuts/tests/` | End-to-end test with mocked AI (see Testing). |
| `storycuts/DESIGN-HANDOFF.md` | Design brief, plus the **full list of ids, classes and data attributes the JavaScript depends on**. Read it before any UI change. |

## Hard rules

1. **Never rename or remove an `id`, class or `data-` attribute that the JavaScript uses.** The full list is in `storycuts/DESIGN-HANDOFF.md`. It breaks silently: the button just stops working.
2. API keys are typed by users and stored **only in their browser** (localStorage) and sent straight to Anthropic or OpenAI. Never put keys in code, never log them, and never add a server that sees them.
3. The video never leaves the user's device. Only text and scene descriptions go to the AI providers.
4. **Changes to the AI pipeline need care.** Keep the JSON schemas and the fields that other modules read in sync. The pipeline files are `planner.js` (prompts and schemas), `qc.js` and `images.js`.
5. Phone (390px wide, **no sideways scrolling**) and desktop must both work.
6. Respect `prefers-reduced-motion`. No emojis in the UI.

## Workflow

1. Work on a branch and open a pull request into `main`. Don't push to `main` directly. Merging publishes the site within about a minute.
2. **Before every PR that changes the site**, run `python3 storycuts/tools/bump-version.py <N>`, using the next integer (check `storycuts/version.json` for the current one). This updates every `?v=` in `index.html`, the import map and `version.json`. Old cached copies of the page then reload themselves onto the new version.
3. Run the tests (below). They must pass.
4. In the PR description, write plain-English bullets of what changed for the owner.

## Testing

```bash
cd storycuts/tests
npm install
npx playwright install chromium
npm test
```

- `e2e.mjs` serves the site itself and fakes Claude and OpenAI with fixed replies, so no keys or network are needed.
- It goes through the whole flow on desktop and phone:
  - demo, style, settings, create
  - continuity split
  - characters and scenes
  - the editor: trim, undo, every tab, a sound effect, split, play, the living pictures toggle
  - export and cancel
  - the missing-pictures state
  - no sideways scroll on phone
  - no console errors
- It prints PASS/FAIL per check and saves screenshots of every screen to `tests/out/`. **Look at the screenshots** after UI changes.
- Headless Chromium can't play MP4 files. The demo story needs no video, so the test uses it.
- If you add a feature, add a check for it.
- **For a quick manual look:** run `cd storycuts && npx http-server -p 8123 -s .`, open http://localhost:8123, then click **Try the demo story**. Real drawing needs real API keys under the key icon; without them you can still check layout and steps 1 to 4.

## Known issues and backlog

- **Pictures sometimes disappear** for the owner: character and scene images stored in IndexedDB go missing between sessions.
  - It's handled gracefully: missing pictures are detected and the app asks to redraw them.
  - The root cause is still unknown, possibly Safari or private browsing clearing storage.
  - `checkStorage()` in `app.js` shows a warning when storage isn't persistent.
- **Stripe checkout links** are still empty in `billing.js`, so the paywall says checkout isn't open yet.
- **A server to verify subscriptions** is planned, not built. The paywall check runs in the browser only.
- **Animated scenes** (a real video model, maybe Google Veo) are a possible future premium feature. The plumbing is in `animate.js`.
