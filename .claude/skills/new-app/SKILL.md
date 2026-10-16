---
name: new-app
description: Scaffold a new VROS app - folder, import map, shared gestures, help legend, home.js entry and README section.
argument-hint: <id> [Name] [one-line blurb]
disable-model-invocation: true
---

# New VROS app

Create the app `$ARGUMENTS`. The first word is the folder id (lowercase, no spaces); ask for the display name, the one-line blurb and what the app does if they weren't given.

Use `apps/squash/` as the model for a small app (read its `index.html`, `style.css` and the top of `src/main.js` first), and copy its patterns rather than inventing new ones.

## Checklist (every item, in this order)

1. **`apps/<id>/index.html`**: same head as squash (charset, viewport, theme-color, `<title>Name · VROS</title>`, manifest `../../manifest.webmanifest`, icon, stylesheet). Import map pins `three@0.170.0` (add `"three/addons/"` on the same version only if you use addons). Overlay: `← Home` link to `../../`, `<h1>` in capitals, `<p class="sub">` blurb, `<button id="enter" disabled>Checking WebXR…</button>`, `<p id="status">`, then the legend (step 5), then a `<p class="desk">` line for the mouse controls. `<script type="module" src="src/main.js">` at the end of body.
2. **`apps/<id>/src/main.js`**: renderer with `xr.enabled`, `local-floor`, alpha for passthrough; `setupEnterXR` from `shared/xr.js`; `Input`, `HandsView`, `CloseGesture`, `UndoGesture`, `HelpGesture.fromPage()` and `Pointer` from `shared/` (all at `../../../shared/<name>.js`), wired the same way as squash's main loop. Add `navGrab`, `panelGrab`, `palmDock`, `fistTwist` only if the app needs them.
3. **`apps/<id>/style.css`**: start from squash's.
4. **`apps/<id>/icon.svg`**: a simple glowing line icon in the style of the other `apps/*/icon.svg` (look at two or three first; same viewBox and stroke style).
5. **Help legend**: `<dl class="legend" data-common="...">` with one `<dt data-icon="emoji">Gesture</dt><dd>what it does</dd>` per app gesture, and controller rows with `data-when="pads"`. `data-common` lists only the shared gestures the app actually wires up (`view reset undo menu panel walk`); close and help are implicit.
6. **`home.js`**: add `{ id, name, blurb }` to `APPS` at the end (or where the user asks).
7. **README.md**: a `## Name` section before `## Quest controllers` with a one-paragraph intro and a `| Gesture | Effect |` table that matches the legend, and the new folder in the `## Structure` tree.
8. **Gesture check**: run the `gesture-conflict-reviewer` agent on the new app.
9. **Preview**: start the `vros` preview, open the home page, confirm the icon shows and the app page loads with no console errors. Say that hand tracking itself needs a headset test.

Don't commit; list the files you created and changed.
