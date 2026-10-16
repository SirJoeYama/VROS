# VROS

A WebXR "OS" for Meta Quest 3: a home screen of apps, each a static page driven by bare hands (and Quest controllers). The README is the user manual and the source of truth for every gesture; read the section for an app before changing it.

## How it's built

- Plain ES modules, **no build step, no package.json, no tests**. Every page loads three.js from jsDelivr through its own `<script type="importmap">`.
- three.js is pinned to **0.170.0** on every page except `apps/splat` (**0.180.0**, required by Spark). Keep `three` and `three/addons/` on the same version within a page. A hook checks this.
- `index.html` + `home.js` + `homeXR.js`: the home screen. Apps are listed in the `APPS` array in `home.js` (order = order on screen and in XR).
- `apps/<id>/`: `index.html` (overlay + import map), `icon.svg`, `style.css`, `src/main.js` (+ more modules). Apps import shared code as `../../../shared/<name>.js`.
- `shared/`: gestures and plumbing every app uses. See the README "Structure" section for what each module does.

## Run it

- Desktop preview: the `vros` config in `.claude/launch.json` (no-cache static server on port 3000). Mouse stands in for hands: drag = pinch, right/shift-drag = palm, wheel = scale.
- Real hand tracking can only be checked on the headset; say so rather than claiming a gesture works.
- Deploy: push to `main`; `.github/workflows/pages.yml` publishes to GitHub Pages after `.github/cachebust.py` stamps `?v=<sha>` onto scripts/styles. Don't add `?v=` by hand in the source.

## Conventions

- **Global gestures are reserved** in every app; never reuse them for app features:
  right thumbs-down held = close · peace sign held = undo (left) / redo (right) · open palm facing the eyes 3 s = help · palm up 1 s = menu/panel to hand · both palms up + pinch = two-hand view grab · two fists 1 s = recenter.
  A fist only counts with the thumb tucked in (so thumbs up/down never trigger fist gestures).
- Controllers mirror hands everywhere (trigger = pinch, grip = fist, X/A undo/redo, B help, hold Y close, left stick click = menu, right stick click = recenter). New app gestures need a controller equivalent.
- **Help is generated from the page**: each app's `<dl class="legend" data-common="...">` lists its own gestures as `<dt data-icon="…" data-when="…">` / `<dd>` pairs. `data-common` names the shared ones it has (`view reset undo menu panel walk`; close and help are implicit). `data-when` limits a row to a mode/step (`pads` = controllers, `desktop`, or app modes like `fit`, `pose`, `animate`). When gestures change, update the legend **and** the app's README table together.
- Comments explain *why* and describe behaviour in plain words (see `shared/*.js` headers); match that style.
- `apps/squash/` is owned by @SirJoeYama (CODEOWNERS): changes need their review on `main`.

## Claude Code setup in this repo

- `/new-app <id>`: scaffold a new app (skill in `.claude/skills/new-app`).
- `gesture-conflict-reviewer` agent: run it after adding or changing a gesture.
- Hooks (`.claude/settings.json`): syntax-check every edited `.js` with `node --check`; check three.js pins in edited `.html`.
