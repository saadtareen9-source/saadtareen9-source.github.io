# StoryCuts: design handoff

You are taking over the **visual design and UX** of StoryCuts, a web app that turns a storytime video into an illustrated, edited short. The app already works. Your job is to make it look and feel like a top-tier creator tool (CapCut, Descript, Runway level) **without breaking any functionality**.

Live site: https://saadtareen9-source.github.io/storycuts/
Repository: saadtareen9-source/saadtareen9-source.github.io (the app lives in `/storycuts/`)

## What the product does

1. **Upload**: the creator uploads a video of themselves telling a story (or tries the demo story).
2. **Style**: they pick an art style in a swipeable coverflow.
3. **Settings**: format (9:16 or 16:9), edit pacing, living pictures or still pictures, full-frame cuts or a face bubble.
4. **Create**:
   - The AI transcribes the story and plans the edit.
   - The creator checks the characters and draws them.
   - The AI then draws every scene.
5. **Edit**: a CapCut-style editor with a player, timeline, shot inspector, audio/SFX, text/captions, filters, transitions and export.

Long jobs (planning, drawing, exporting) show a full-screen progress screen (`js/loader.js`, `showWork`). Scene drawing can be sent to the background with "Back to editor", which shows a progress pill.

## Tech (keep it this way)

- A static site with **no build step**: plain HTML, CSS and ES modules, hosted on GitHub Pages.
- Do **not** add React, Tailwind, a bundler or npm dependencies.
- `index.html` holds all the page markup and the SVG icon sprite (`<symbol id="i-...">`).
- `style.css` is the entire design system (tokens at the top in `:root`).
- `js/app.js` is all UI logic. It also **generates some markup** in template strings: character cards, timeline clips, the shot inspector, sound tiles, filter tiles, plan cards and project cards.
- `js/loader.js` is the loading screens.
- `js/render.js` is the canvas video renderer. It is **not design, so don't touch it**.
- Never touch these (logic, not design): `planner.js`, `qc.js`, `images.js`, `transcribe.js`, `animate.js`, `sfx.js`, `billing.js`, `constants.js`, `draw.js` and `server/`.

## Hard rules (the app breaks if these are ignored)

1. **Do not rename or remove any `id`, class or `data-` attribute that the JavaScript uses.** The full list is below. You may add new classes and wrapper elements, and you may restyle anything.
2. Keep every button, input and panel that exists today. You can move them, restyle them, relabel them (keep the meaning) or tuck them into menus, but don't delete them.
3. Markup built in `js/app.js` can be restyled freely from CSS. If you change its HTML, keep the same classes and `data-` attributes and all event-handling code.
4. It must work on **phones** (390px wide, no sideways scrolling) and **desktop**.
   - On computers the editor is a full-screen app (`body.ed-app`).
   - On phones it uses bottom sheets (`body.ed-full`).
5. No emojis in the UI. It should look professional, not like generated code: no rainbow gradients, glows or gimmick animations.
6. Respect `prefers-reduced-motion`.
7. **Cache busting:** after changing files, run `python3 storycuts/tools/bump-version.py <next number>`. The current version is 37. This updates `index.html` and `version.json` so users get the new files.
8. API keys are typed by users into the app and stored only in their browser. Never add keys to the code.

## What the owner wants from the redesign

- It should feel premium, calm and very easy to follow for beginners.
- Every screen should have one obvious next action.
- Animations should be smooth and quick. Nothing should feel blocky, chunky or cluttered.
- **Editor:** clear controls with labels, a clean timeline, and obvious Split / Undo / Next.
- **Character step:** cards that are easy to edit, and an obvious "Draw characters" action.
- **Loading screens:** full-screen and polished, with an option to keep editing in the background.

## How to test

Run `cd storycuts/tests && npm install && npx playwright install chromium && npm test`.

- The test fakes the AI services and goes through the whole flow on desktop and phone.
- It must print "All checks passed".
- Check the screenshots it saves in `storycuts/tests/out/`.

## JavaScript hooks: do not rename or remove

**IDs:**
#api-key #asr-quality #btn-add-char #btn-approve #btn-cast-pre-add #btn-clear-ref #btn-create #btn-demo #btn-export #btn-gen-chars #btn-gen-scenes #btn-keys #btn-menu #btn-open-editor #btn-paste-cancel #btn-paste-open #btn-play #btn-redo #btn-redraw-all #btn-reset #btn-save #btn-show-cast #btn-snap #btn-split #btn-srt #btn-style-next #btn-test-relay #btn-to-editor #btn-transcript-clear #btn-undo #btn-use-paste #btn-resume #btn-start-new #asr-help #btn-rights-no #btn-rights-yes #rights-dialog #rights-file #autoframe-note #btn-asr-cloud #btn-asr-paste #face-x-row #frame-pill #opt-autoframe #cap-anims #cap-bg #cap-bg-colors #cap-bg-row #cap-colors #cap-effects #cap-fonts #cap-outline-colors #cap-pos #cap-reset #cap-size #cap-styles #cap-sub #cap-text-colors #cap-words #pane-captions #peek #peek-canvas #peek-cap-styles #peek-sample #peek-shots #peek-sounds #peek-tabs #resume-detail #resume-dialog #resume-name #cast #cast-bar #cast-pre #cast-sub #cast-title #cb-cost #cb-step1 #cb-step2 #cb-step3 #cb-sub #cb-title #chars #chars-status #create-cost #create-start #create-status #create-summary #cta-demo #custom-box #custom-style #dc-title #draw-card #drop #ed-close #ed-export #ed-sheet #ed-tabs #ex-progress #ex-status #face-x #file #filter-amt #filter-amt-row #filter-grid #gemini-key #gen-progress #hero-talk #image-model #inspector #keys-dot #load-project #manage-sub #marquee-row #menu-sheet #mix-music #mix-voice #model #music-card #music-file #nav-links #nav-plan #openai-key #opt-captions #opt-living #opt-punch #opt-qc #opt-upper #opt-watermark #panel-upload #paste-box #paste-msg #paste-text #pay-close #pay-demo #pay-period #pay-plans #paywall #pipeline #plan-notes #plans #prep-cast #prep-transcript #preview #proj-row #projects #ready-card #relay-result #rights #run #scenes-cost #scenes-status #seg-face #seg-format #seg-motion #seg-pacing #settings #sfx-cats #sfx-file #sfx-lib #sfx-selected #sheet-done #sheet-title #stage #stepper #storage-warn #studio #style-dots #style-next #style-notes #style-prev #style-ref #style-ref-img #style-track #time #timeline #tl-content #tl-fx #tl-music #tl-ruler #tl-scroll #tl-wave #toast #trans-grid #trans-hint #trans-scope #transcript #transcript-file #transcript-state #video #video-info #video-model #video-relay #vol-music #vol-sfx #vol-voice #wizard #year #zoom-in #zoom-out

**Classes the code adds, toggles or looks up:**
.active .amt .btn .bubble-mode .busy .cap-dragging .cap-grab .cap-sec .cap-tile .caps-off .char .check .chosen .clip .cta-big .custom .cut .done .dot .dragging .ed-app .ed-full .ed-panel .ed-title .fg .filter-tile .fresh .fxclip .glass .has-job .has-thumb .hidden .in .in-fwd .ld-bar .ld-count .ld-eta .ld-tip .ld-title .live .manage-link .menu-open .missing .nav .ok .on .open .opening .out .over .panel .period .period-thumb .phone-screen .plan .poster .pp-price .primary .proj-card .rc-ico .reach .ready .ref-thumb .reveal .reviewed .row .scrolled .seg .seg-thumb .sheet-open .shot-img .show .stagger .style-card .tick .trim .wizard .wm-count .wm-eta .work-actions .work-bar .work-note .work-open .work-steps .work-tip .work-title .work-visual .wp-txt

**Data attributes:**
data-a data-act data-add data-aspect data-back data-c data-capsub data-peek data-peek-open data-peek-pane data-peek-shot data-peek-sound data-peek-style data-cat data-ck data-cv data-del data-edge data-f data-face data-filter data-fx data-i data-id data-k data-key data-m data-motion data-music data-next data-pacing data-pane data-period data-plan data-preset data-projects data-pv data-redraw data-s data-stage data-sub data-step data-style data-tab data-tip data-tr data-type data-upload data-v data-wave

The screenshots in `screenshots/` show the current design. In these screenshots the scene and character pictures are coloured placeholder blocks from a test run; real ones are AI illustrations.

## Returning the work

The preferred way is a **pull request** to the repository (branch from `main`). Otherwise, send back the full changed files (`index.html`, `style.css`, and `js/app.js` / `js/loader.js` if they were edited). The owner's Claude Code assistant will test every flow before it goes live.


## Version 46 controls

- `experience.js` uses the original video as the example playback clock and `captions.js` to draw the caption styles used by the editor. Short clips are paced across the eight-second edit. Seeking applies the correct shot and phrase immediately. The examples remain labeled fictional and silent.
- `#showreel-captions`, `#showreel-caption`, `#showreel-shot-label`, `#showreel-chapter`, and `[data-demo-caption]` form the live example caption preview.
- `[data-editor-tool]` opens the free sample editor directly in a selected tab. It must not grant AI or paid access.
- `#caption-transcript`, `#caption-search`, `#caption-no-results`, `#caption-word-form`, `#caption-word`, `#caption-word-start`, `#caption-word-end`, `#caption-word-status` let creators correct individual words and timestamps. Corrections replace the word array to invalidate the caption cache and are undoable. Neighboring word bounds prevent overlap.
- `#btn-save-caption-style` and `#btn-apply-caption-style` save one custom style on the current device. Applying it is undoable.
- `#btn-safe-area` draws guidance only in the preview. It must never appear in exports. `#btn-shortcuts` opens `#shortcuts-dialog`.
- The automated test can use an existing browser with `STORYCUTS_BROWSER_PATH` and optionally `STORYCUTS_BROWSER_ARGS` (a JSON array). The normal Playwright installation remains the default.
