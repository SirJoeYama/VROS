# VROS

A virtual reality OS: a spatial shell for **Meta Quest 3** where generative particle "apps" float in your room and you shape them with your bare hands.

It runs as a WebXR page in the Quest Browser, with passthrough when it's available. Quest 3's bootloader is locked, so nothing can replace Horizon OS itself. VROS is the layer you live in once you're inside it.

## Home screen

Opening the site shows a start screen with an icon for each app. Tap one to launch it; each app has a **← Home** link to come back.

**In XR:** tap **Enter** on the start screen and the app icons float in an arc in front of you, with the time above. Poke an icon with your index finger to open it (with controllers, pull the trigger on it). Palms together on the home screen leaves XR.

Moving between the home screen and apps keeps you in the headset when the browser supports WebXR navigation (Quest Browser does): the next page re-enters XR on its own. Otherwise you land on the page and tap **Enter** again.

**Close an app:** press both palms together in front of you (prayer pose) and hold for about a second. A ring fills up between your hands; when it closes, the app exits and you're back on the home screen. Works in every app.

**Help in XR:** hold an open hand up near eye height with the palm facing your eyes (like reading a note in your hand) for half a second. A card with the app's gestures appears in front of you; do it again to hide it. A short tip about this shows when you enter XR. The card lists the same gestures as the app's page overlay (`<dl class="legend">`), so there is one list to keep up to date.

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

**Microphone permission:** the browser can't show its "allow microphone?" prompt inside XR, so the first time, tapping **Enter** only asks for the microphone; tap **Enter** again to go into XR with the mic on. After that one tap does both. If you arrive in XR without having allowed it (e.g. from the XR home screen), the page tells you to leave XR and tap **Start dictation**. If the mic ever shows "pinch once to start the microphone", pinch anywhere: the browser only lets audio start from a real gesture, and a pinch counts where poking the 3D button doesn't.

Voice commands: "new line", "delete that" (removes the selection), "undo" / "scratch that". The text is saved in the browser, so it's still there next time.

Speech recognition: on Quest, Scribe runs [Whisper](https://huggingface.co/Xenova/whisper-tiny.en) on the headset (English, about 40 MB downloaded once on first use). Elsewhere it uses the browser's built-in recognition when available and falls back to Whisper if that fails. `?engine=whisper` or `?engine=web` forces one; `?model=base` uses the larger, more accurate Whisper model.

## Holodex

A web browser whose tabs are index cards on a Rolodex.

- **2D view** (the normal page): the Rolodex runs down the left. Scroll it, drag it or click a card to flip; the card at the front is the open tab, shown on the right. The address bar searches (DuckDuckGo) or opens an address; ‹ › ↻ go back, forward and reload; ↗ opens the tab in its own browser window. **＋ New card** opens a start page with quick links.
- **XR**: the same tabs on a 3D Rolodex in front of you. Swipe up or down in the air just in front of the cards to spin it; poke the front card to open that tab, which leaves XR and shows it in the 2D view.

Limits that come from the web platform, not the app: a page can't draw other websites inside an immersive XR view, so pages are always read in the 2D view; and many big sites (Google, GitHub, X, Reddit, …) refuse to be shown inside another page. Those tabs show an **Open in window** button instead. YouTube video links are switched to YouTube's embeddable player. Only addresses typed or picked in Holodex are tracked, so ‹ › don't follow links clicked inside a page.

## Marionette

Stop-motion animation in XR: pose a jointed puppet on a small stage, capture the pose as a frame, pose it again, and play the frames back.

**Posing.** Pinch a handle and move it:

| Handle | What it does |
| --- | --- |
| **Amber spheres** (chest, head, elbows, knees) | **Forward kinematics**: bend the bone behind the handle (spine, neck, upper arm, thigh) around its joint; everything further down the hierarchy follows. |
| **Cyan diamonds** (hands, feet) | **Inverse kinematics**: put the hand or foot where you want it; the elbow or knee works out its own bend, in the plane it already bends in (or the natural way when the limb is straight). The hand/foot keeps its orientation. |
| **White ring** (hips) | Moves the whole puppet. |

The skeleton is a hierarchy: hips → spine → chest → neck → head, chest → shoulders → elbows → hands, hips → hip joints → knees → feet. The **HANDS: IK / FK** button turns the hand and foot handles into FK handles too (they then rotate the forearm or shin). Both hands can hold handles at once.

**Timeline.** A film strip in front of the stage, poked with a finger: frame cells with stick-figure thumbnails (poke to jump), **PREV / PLAY / NEXT**, **+ FRAME** (copies the current pose into a new frame after it: the stop-motion step), **DELETE**, **ONION** (see-through ghosts of the previous frame in red and the next in blue) and **FPS** (4, 6, 8, 12 or 24). Playback shows each pose as is, with no in-betweens. The animation is saved in the browser.

Desktop preview: drag handles with the mouse and click the timeline; keys ←/→ frames, space play, N new frame, Delete, O onion, K IK/FK, F fps.

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
homeXR.js           the start screen in XR: icon shelf you poke
shared/             used by the home screen and every app
  xr.js             Enter button, passthrough/VR choice, re-entering XR after navigation
  input.js          hands / controllers / mouse → unified gesture state
  handsView.js      glowing joint visualization
  pointsMaterial.js glowing point shader
  closeGesture.js   palms together → close the app (home: leave XR)
  helpGesture.js    palm toward your eyes → help card
apps/galaxies/
  index.html        overlay + import map (three.js from jsDelivr, no build step)
  icon.svg          home screen icon
  src/main.js       renderer, XR session, gesture → force mapping, main loop
  src/particles.js  CPU particle simulation
  src/apps.js       particle formations
  src/launcher.js   palm-up formation dock
  src/text.js       canvas text sprites
apps/scribe/
  index.html        overlay + import map
  icon.svg          home screen icon
  src/main.js       renderer, XR session, gestures (select, twist-scroll), main loop
  src/doc.js        the text, selection, replacement and undo
  src/page.js       A4 page: layout, drawing, hit testing, scrolling
  src/speech.js     speech recognition (built-in or Whisper) + voice activity gate
  src/whisper-worker.js  Whisper in a worker via transformers.js
  src/buttons.js    pokeable buttons under the page
apps/holodex/
  index.html        browser layout: Rolodex pane, address bar, page viewer
  src/tabs.js       open tabs (saved), address → URL, framing rules
  src/ui.js         2D Rolodex drum and page viewer
  src/drum3d.js     the Rolodex in XR
  src/main.js       wires the 2D view and XR together
apps/marionette/
  src/rig.js        the puppet's bone hierarchy, FK and two-bone IK, poses
  src/timeline.js   frames, playback, the film-strip panel
  src/main.js       stage, handles, pinch-dragging, onion skins, XR
```
