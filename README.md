# VROS

A virtual reality OS: a spatial shell for **Meta Quest 3** where generative particle "apps" float in your room and you shape them with your bare hands.

It runs as a WebXR page in the Quest Browser, with passthrough when it's available. Quest 3's bootloader is locked, so nothing can replace Horizon OS itself. VROS is the layer you live in once you're inside it.

## Home screen

Opening the site shows a start screen with an icon for each app. Tap one to launch it; each app has a **← Home** link to come back.

**Close an app:** press both palms together in front of you (prayer pose) and hold for about a second. A ring fills up between your hands; when it closes, the app exits and you're back on the home screen. Works in every app.

To add an app, create `apps/<id>/` with an `index.html` and an `icon.svg`, then add an entry to the `APPS` list in `home.js`.

## Galaxies

The first app: generative particle formations you shape with your hands.

### Gestures

| Gesture | Effect |
| --- | --- |
| **Pinch** | Creates a gravity well: particles swirl in and follow your fingers. Release and they spring home. |
| **Open palm** | Wind: pushes and swirls the field in the direction your palm faces. Sweep to throw particles. |
| **Fist** | Stillness: the simulation slows almost to a stop. |
| **Pinch with both hands** | Grabs the whole formation: move, scale (pull apart / push together) and turn it. |
| **Palm up** | Summons the app dock (glowing orbs) plus a clock above your palm. Poke an orb with your other index finger to launch that app. |
| **Two fists, held ~1 s** | Recenters the formation in front of you. |

Controllers work too: trigger = pinch, grip = palm, A/X and B/Y = next/previous app, thumbstick click = recenter.

### Formations

1. **Nebula**: a breathing cloud
2. **Galaxy**: a three-armed spiral with differential rotation
3. **Threads**: light flowing in bundles along a torus knot
4. **Bloom**: a flower that opens and closes

To add a formation, add an entry to `apps/galaxies/src/apps.js` with a name, two colors and a `target(i, t, R, out)` function that returns each particle's home position. The dock and desktop buttons pick it up automatically.

## Scribe

Speech to text on a floating A4 page (portrait). Talk and your words appear on the page.

| Gesture | Effect |
| --- | --- |
| **Speak** | Text is written at the end of the page (partial words show in blue while you talk). |
| **Touch a word** | Highlights it. |
| **Pinch on a word** | Selects it; keep pinching and drag to select more words. Then say what should go there. Pinch empty space to cancel. |
| **Fist + twist** | Scrolls like a knob: clockwise scrolls down, counter-clockwise scrolls up. |
| **Buttons under the page** | Poke with your index finger: mic on/off, undo, recenter the page in front of you. |

Voice commands: "new line", "delete that" (removes the selection), "undo" / "scratch that". The text is saved in the browser, so it's still there next time.

Speech recognition: on Quest, Scribe runs [Whisper](https://huggingface.co/Xenova/whisper-tiny.en) on the headset (English, about 40 MB downloaded once on first use). Elsewhere it uses the browser's built-in recognition when available and falls back to Whisper if that fails. `?engine=whisper` or `?engine=web` forces one; `?model=base` uses the larger, more accurate Whisper model.

## Run it on your Quest 3

WebXR needs a secure origin (HTTPS or `localhost`).

**Option A: GitHub Pages (easiest)**
1. In the repo on GitHub, go to **Settings → Pages → Source** and choose **GitHub Actions**.
2. Push to `main`. The workflow in `.github/workflows/pages.yml` publishes the site.
3. On the Quest, open the Pages URL in the Browser, pick an app and tap **Enter (passthrough)**. Put the controllers down and your hands take over.
4. Optional: install it from the Browser menu as an app so it shows up in your library.

**Option B: local over USB**
```sh
npx serve -l 3000 .           # or: python3 -m http.server 3000
adb reverse tcp:3000 tcp:3000  # Quest in developer mode, plugged in
```
Then open `http://localhost:3000` in the Quest Browser.

**Desktop preview:** any static server works. Drag = pinch, right-drag / shift-drag = palm, wheel = scale, keys 1–4 = apps.

`?n=24000` sets the particle count (default 16k on Quest, 24k on desktop).

## Structure

```
index.html, home.js, home.css   start screen (app icons)
apps/galaxies/
  index.html        overlay + import map (three.js from jsDelivr, no build step)
  icon.svg          home screen icon
  src/main.js       renderer, XR session, gesture → force mapping, main loop
  src/input.js      hands / controllers / mouse → unified gesture state
  src/particles.js  CPU particle simulation + glow point shader
  src/apps.js       particle formations
  src/launcher.js   palm-up formation dock
  src/handsView.js  glowing joint visualization
  src/text.js       canvas text sprites
  src/closeGesture.js  palms-together gesture to close an app (shared)
apps/scribe/
  index.html        overlay + import map
  icon.svg          home screen icon
  src/main.js       renderer, XR session, gestures (select, twist-scroll), main loop
  src/doc.js        the text, selection, replacement and undo
  src/page.js       A4 page: layout, drawing, hit testing, scrolling
  src/speech.js     speech recognition (built-in or Whisper) + voice activity gate
  src/whisper-worker.js  Whisper in a worker via transformers.js
  src/buttons.js    pokeable buttons under the page
```

Scribe reuses the hand tracking and close gesture from Galaxies (`apps/galaxies/src/input.js`, `handsView.js`, `closeGesture.js`).
