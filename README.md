# VROS

A virtual reality OS: a spatial shell for **Meta Quest 3** where generative particle "apps" float in your room and you shape them with your bare hands.

It runs as a WebXR page in the Quest Browser, with passthrough when it's available. Quest 3's bootloader is locked, so nothing can replace Horizon OS itself. VROS is the layer you live in once you're inside it.

## Home screen

Opening the site shows a start screen with an icon for each app. Tap one to launch it; each app has a **← Home** link to come back.

**In XR:** tap **Enter** on the start screen and the app icons float in an arc in front of you, with the time above. Poke an icon with your index finger to open it (with controllers, pull the trigger on it). A right-hand thumbs down on the home screen leaves XR.

Moving between the home screen and apps keeps you in the headset when the browser supports WebXR navigation (Quest Browser does): the next page re-enters XR on its own. Otherwise you land on the page and tap **Enter** again.

**Close an app:** give a thumbs down with your **right hand** (fingers curled, thumb pointing at the floor) and hold it for about a second. A ring fills up around your fist; when it closes, the app exits and you're back on the home screen. Works in every app. A hand with its thumb stuck out (thumbs up or down) doesn't count as a fist, so it never sets off the fist gestures (Cinema's jog dial, resizing in Rigger and Plume, Galaxies' stillness, two-fist recenter); make those with your thumb tucked in.

**Undo and redo, everywhere:** make a peace sign (index and middle fingers up in a V, the others curled) and hold it for a second. With the **left hand** it undoes, with the **right hand** it redoes; keep holding and it steps again about every half second. A ring fills around your hand while you hold, and a label says what happened ("Undo", "Nothing to undo", …). Plume undoes strokes, erasing and frame and layer changes; Scribe undoes text; Marionette and Rigger's Pose step undo poses and frame changes; Rigger's Fit step undoes skeleton edits. The other apps have nothing to undo and just say so.

**Help in XR:** hold an open hand up near eye height with the palm facing your eyes (like reading a note in your hand) for half a second; do it again to hide it. The card shows the app's own gestures as tiles (an icon, the gesture, what it does), then a strip of the gestures every app shares (close, help, undo, and where the app has them the view grab, recenter, palm-up menu and panel bar), so those aren't repeated in each app's list. Apps with steps or modes show only what applies right now: in Rigger, the card for 3 FIT lists moving joints and resizing, the one for 5 POSE the handles and frames. A short tip about the gesture shows when you enter XR. The card is built from the page overlay's `<dl class="legend">` (one `<dt data-icon data-when>` / `<dd>` per gesture, the shared ones named in its `data-common`), and the page lists the shared ones under it too, so there is one list to keep up to date.

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

A browser tab manager on a Rolodex: every index card is a real browser tab, so any site opens and works fully (logins, video, everything).

- **2D view** (the normal page): the Rolodex runs down the left. Scroll it, drag it or click a card to flip; click the front card (or **Open ↗**, or press Enter) to open it. The address bar searches (DuckDuckGo) or takes an address and opens it in the front card's tab. Click the card's name to rename it. **Open here** leaves Holodex and loads the site in the same tab. **＋ New card** opens a start page with quick links.
- **XR**: the same cards on a 3D Rolodex in front of you. Swipe up or down in the air just in front of the cards to spin it; **pinch** (or poke the front card) to open it. That opens its browser tab and leaves XR.

Each card has its own named browser tab, so opening a card again brings its tab back when the browser still knows it, rather than opening another one. Some sites break that link for privacy reasons, and then a fresh tab opens. Go back to Holodex through the browser's tab list. The browser only opens tabs right after a click, key press or pinch; if it blocks one, Holodex says so (allow pop-ups for the site, or use **Open here**).

Why tabs and not a page inside Holodex: most big sites refuse to be shown inside another page, and WebXR can't draw web pages in 3D. Real tabs avoid both limits.

## Marionette

Stop-motion animation in XR: pose a jointed puppet on a small stage, capture the pose as a frame, pose it again, and play the frames back.

**Posing.** Pinch a handle and move it:

| Handle | What it does |
| --- | --- |
| **Amber spheres** (chest, head, elbows, wrists, knees, ankles) | **Forward kinematics**: bend the bone behind the handle (spine, neck, upper arm, forearm, thigh, shin) around its joint; everything further down the hierarchy follows. |
| **Diamonds at the fingertips and toe tips** | In **IK** mode (cyan): put the tip where you want it; the elbow or knee works out its own bend (in the plane it already bends in, or the natural way when the limb is straight) and the hand/foot keeps its orientation. In **FK** mode (amber): turn the hand or foot itself at the wrist/ankle. **HANDS** and **FEET** on the timeline switch each between IK and FK. |
| **Magenta cube** (hips) | Moves the hips while the feet stay planted: the legs re-solve by IK. |
| **White ring on the floor** | Moves the whole puppet. |

**Looking around.** Pinch empty space with both hands to move your view (the camera), not the puppet: move your hands to travel, pull them apart to zoom in (you get smaller and the stage bigger, down to 1/10 of your size) or together to zoom out (up to 10×), and turn them to turn the view around you; the floor stays level. The puppet, stage and poses never change, and the timeline stays with you. Two fists or a controller's thumbstick click recenters, back to life size. Handles, grab distances and gestures keep the same size to your hands at any zoom. On the desktop, the wheel still scales the stage and the timeline follows it.

The skeleton is a hierarchy: hips → spine → chest → neck → head, chest → shoulders → elbows → hands, hips → hip joints → knees → feet. Both hands can hold handles at once.

**Timeline.** A film strip in front of the stage, poked with a finger. Pinch the bar under it to carry it somewhere else, or pinch its bottom-right corner and pull to resize it; once moved it stays put until you recenter. Or turn a palm up and hold it for a second (a ring fills above your palm): the timeline comes to your hand, like the dock in Galaxies, and rides just above your palm while you poke it with the other hand; lower your palm and it stays where it was. On it: frame cells with stick-figure thumbnails (poke to jump), **PREV / PLAY / NEXT**, **+ FRAME** (copies the current pose into a new frame after it: the stop-motion step), **DELETE**, **HANDS** / **FEET** (IK or FK for the tips), **ONION** (see-through ghosts of the previous frame in red and the next in blue) and **FPS** (4, 6, 8, 12 or 24). Playback shows each pose as is, with no in-betweens. The animation is saved in the browser.

Desktop preview: drag handles with the mouse, scale the scene with the wheel, click the timeline; keys ←/→ frames, space play, N new frame, Delete, O onion, H / J hands / feet IK⇄FK, F fps.

## Cinema

A media player on a big floating screen, controlled with your hands.

| Gesture | Effect |
| --- | --- |
| **Pinch (a quick tap)** | Play / pause. |
| **Fist + twist** | A jog dial: clockwise fast-forwards, counter-clockwise rewinds. One full turn is one minute; the screen shows how far you've gone. |
| **Pinch with both hands** | Look around: move your view (the camera), pull apart to zoom in, push together to zoom out, turn your hands to turn the view. The screen stays where it is; the remote stays with you. |
| **Two fists, held ~1 s** | Back in front of the screen, at life size. (The jog dial only answers one fist.) |
| **Remote** (a small panel near your hands) | Poke: previous · −10 s · play/pause · +10 s · next, or poke the progress bar to jump there. |

Pick what to play in window mode: **Open files…** (video or audio from the headset's storage) or paste a link. Two free samples are loaded to start with. Audio files show a title card instead of a picture. Links from other sites only show a picture if the site allows it (CORS); local files always work. Desktop preview: click to play/pause, the wheel scrubs, ←/→ jump 10 s.

## Pip

A pocket companion that lives in a little egg-shaped gadget with a pixel screen, like the virtual pets of the 90s. Ask it anything out loud and it answers out loud, like a personal assistant. It thinks with Claude (`claude-opus-5-5`, with web search for anything recent) and remembers the conversation until you tell it to forget.

| Gesture | Effect |
| --- | --- |
| **Pinch (a quick tap)** | Start talking with Pip; tap again to stop. While Pip is answering, a tap hushes it. |
| **Just talk** | After each answer Pip listens again, so you can keep the conversation going. It stops after 30 s of silence. |
| **Poke the buttons** | TALK · HUSH (stop the answer) · FORGET (clear the conversation). |
| **Poke the screen** | Tickle Pip. |
| **Pinch with both hands** | Look around: move your view (the camera), pull apart to zoom in, push together to zoom out, turn your hands to turn the view. Pip stays where it is. |
| **Two fists, held ~1 s** | Back in front of Pip, at life size. |

The screen shows what Pip is doing: listening (antenna blinking, sound waves), thinking, searching the web (a globe), speaking (a moving mouth), or asleep after a while with nothing to do. A speech bubble above the egg shows what it heard and its answer.

**Setup:** Pip needs an [Anthropic API key](https://console.anthropic.com/settings/keys). Paste it in window mode; it is kept in this browser's local storage and sent only to `api.anthropic.com`. There is no server; the page calls the API straight from the browser, so each question is billed to your key. The first tap on **Enter** asks for the microphone, because the permission prompt can't appear inside XR. Speech recognition works like Scribe's (Whisper on the headset). Answers are spoken with the browser's built-in voices; pick one in window mode. Desktop preview: click the egg or **Talk**, or type a question.

## Rigger

Rig any 3D model and give it animations, like [Mesh2Motion](https://github.com/Mesh2Motion/mesh2motion-app) (a free Mixamo alternative), done with your hands. You fit a template skeleton inside the model, Rigger works out the skin weights, and the model can then play a library of ready-made animations or ones you pose yourself. Export it all as a GLB.

A panel floats in front of you with five steps; poke them in order:

1. **Model**: one of nine samples, or your own file (GLB, GLTF, FBX or OBJ). Open files in window mode, with **Open a model…** or by dropping one on the page; the browser can't show a file picker inside XR. Models are put on the floor, centred, and brought to a sensible size if they're in centimetres or kilometres.
2. **Skeleton**: Human, Fox, Horse, Bird, Dragon, Kaiju, Spider, Snake or Fish. For your own model the skeleton is first scaled to its height (or length, for flat creatures) and stood in it.
3. **Fit**: the model turns see-through so the joints show. **Pinch a joint** and move it into place. Cyan joints are the left side, pink the right, amber the middle.

   | Tool | What it does |
   | --- | --- |
   | **Mirror** (on by default) | The joint's twin on the other side moves with it, mirrored. |
   | **Children follow / stay** | Moving a joint also moves the rest of the limb, or only that joint. |
   | **Fist + twist** or **Size − / +** | Resize the whole skeleton. |
   | **Turn model 90°** | For models that don't face the front. |
   | **Undo**, **Reset fit**, **See-through**, **Recenter** | |

4. **Animate**: **Skin & animate** binds the model to the skeleton (after Mesh2Motion's solver: each vertex follows its nearest bone, with blended seams on the torso and one-sided blends at elbows and knees so bending doesn't dent the upper limb). Poke a clip to play it (the human library has about 180; the animals have 5 to 14 each). Fist + twist scrolls the list, a quick pinch pauses. **Weights** colours the model by bone to check the skinning. Tick ✓ the clips you want and poke **Export**: the rigged model plus those clips is saved to Downloads. **Import** brings in the animations from a GLB/GLTF file, such as one you exported from Rigger before (for another model with the same skeleton type) or one from Mesh2Motion: its tracks are matched to your skeleton by bone name, so a clip is only taken if at least half its bones match (the panel says why a file didn't fit). Rotations carry over as they are, and the hips are adapted from the file's skeleton to yours, so the clip plays at the right height even if you re-fit later. Imported clips show with ⤓, ticked for export, and are kept in the browser for that skeleton type; **Remove** deletes the one playing (it also deletes clips saved in 5 Pose). The browser can't show a file picker in XR, so import in window mode (**Import animations…**).
5. **Pose**: make your own animation, frame by frame, like Marionette, on the rigged model itself.

   | Handle | What it does |
   | --- | --- |
   | **Amber spheres** at the joints | **FK**: bend the bone behind the joint; everything further down follows. |
   | **Diamonds past each hand and foot** | **IK** (cyan): place the hand or foot; the elbow or knee bends to follow and the hand/foot keeps its orientation. **FK** (amber): turn the hand or foot itself. **HANDS** and **FEET** switch each; a quadruped's front legs count as hands. Every leg of the spider is a foot. |
   | **Magenta cube** (hips) | Move the hips while the feet stay planted. |
   | **White ring** on the floor | Move the whole body. |

   The film strip shows every frame (poke one to go there). **+ Frame** copies this pose into a new frame after it; **Prev / Play / Next**, **Delete**, **Onion skin** (skeletons of the previous frame in red and the next in blue), **FPS** (4 to 30), **Smooth / Stepped** (in-betweens on playback, or stop-motion), **Clip pose** (copy the pose of the clip last played in 4 Animate, to start from it), **Reset pose**, **New animation** (press twice). Fist + twist steps through the frames. **Save as clip** adds the frames as "My animation N" to the top of 4 Animate, ticked for export; **Export** is on this step's panel too. Saved clips and the frames are kept in the browser for each skeleton type, so they're still there after a reload or after closing the app, and come back whenever you skin a model with that skeleton. To delete a saved clip, play it in 4 Animate and poke **Remove ★**.

Pinch the bar under the panel to carry it somewhere else, or pinch its bottom-right corner and pull to resize it; it stays where you put it. Or turn a palm up and hold it for a second: the panel comes to your hand, like the dock in Galaxies, and rides just above your palm while you poke it with the other hand; lower your palm and it stays there. Pinch empty space with both hands to look around: this moves your view (the camera), never the model, so the fit, the skin and the poses don't change. Move your hands to travel, pull them apart to zoom in, push them together to zoom out, turn them to turn the view; the floor stays level, and the panel stays with you. Two fists held for a second (or **Recenter**) bring the model and panel back in front of you at life size. Desktop preview: click the panel, drag joints and handles, right-drag to turn the model, wheel to scale; keys are listed on the page.

The skeletons, sample models and animations are Mesh2Motion's (CC0), in `apps/rigger/assets/`; the skinning is a port of its solver (MIT).

## Plume

Paint in the air and animate it frame by frame, in the spirit of VR painting and animation tools like Quill.

| Gesture | Effect |
| --- | --- |
| **Pinch and move** | Paint. With **Erase** on, pinch and sweep through strokes to remove them (one sweep is one undo). |
| **Pinch with both hands** | Move, scale and turn the whole drawing: pull it close and zoom in to paint fine detail, or step back to see it all. Strokes are as wide as the brush in the room, so painting zoomed in gives finer lines. |
| **Fist + twist** | Brush size, like a knob. |
| **Poke the panel** | Everything else (below). |

**Brushes:** **Ribbon**, a flat band that lies the way your hand is turned (like a calligraphy pen); **Tube**, round; **Glow**, round, see-through and additive. With controllers, the trigger is pressure: press harder for a wider line.

**The panel:** Draw / Erase, the brushes, Undo / Redo; a colour square, hue bar and 16 swatches; the size slider; **Layers** (up to six: poke one to draw on it, ◉ to show or hide it, + / − Layer); the active layer's **frames** (poke one to go there); ◀ Prev, ▶ Play, Next ▶, **+ Frame** (blank), **Duplicate** (a copy to change a little), **Delete**, **Onion** (the previous frame in red and the next in blue), **FPS**; **New drawing** (press twice), **Recenter**, **Export GLB**. Pinch the bar under the panel to carry it, or its corner to resize it; or turn a palm up and hold it for a second and the panel comes to your hand like a painter's palette (it rides above your palm while you paint and poke with the other hand; lower your palm and it stays where it was). Two fists held a second bring it back.

**Animation:** every layer has its own frames, and the playhead shows frame *t* mod the layer's length. A one-frame layer is a still background while the others animate, and layers of different lengths loop on their own. **Export GLB** saves the drawing with a node per frame and one stepped animation that switches them; viewers without animation show frame 1. The drawing is saved in the browser (IndexedDB) as you go.

Desktop preview: drag to paint on a plane through the drawing's origin, click the panel, right-drag to turn the drawing, wheel to scale it; keys are listed on the page.

## Splat

Walk through Gaussian splats: photoreal 3D captures of objects and places. Rendering is by [Spark](https://sparkjs.dev) (World Labs), which reads .ply (also compressed), .spz, .splat, .ksplat and .sog. Seven sample scenes load from Spark's examples; open your own in window mode (**Open a splat…**, drop a file on the page, or paste a link).

| Gesture | Effect |
| --- | --- |
| **Pinch and move** | Grab the world and pull yourself through it: the spot you pinched stays under your fingers. |
| **Pinch with both hands** | Move, zoom (pull apart to get smaller and see detail, push together to get bigger and see it all) and turn your view. The floor stays level. |
| **Fist + twist** | Spin the splat like a turntable. |
| **MEASURE, then pinch** | Drop two points: the line between them shows its length, in meters once the splat is the right size (use SIZE − / + to calibrate it against something you know). A third pinch starts again. |
| **Peace sign, held 1 s** | Left hand: undo; right hand: redo. Covers where you were (every pull, grab and reset) and how the splat sits (flips, turns, size, spin). |
| **Two fists, held 1 s** | Reset the view: life size, back in front of it, and the panel too. |
| **Palm up, held 1 s** | The panel comes to your hand. |
| **Poke the panel** | Scenes; Move / Measure / Clear, ↶ / ↷ view, Reset view; Flip, Turn X / Y / Z (90°), Size − / +; Passthrough (in mixed reality), Auto spin, Reset orientation. |

Objects (anything whose splats span less than 4 units) float in front of you about 0.8 m across, turning about their middle; places stay life size with you standing at their origin, which is usually where the capture camera was. The size is worked out from where the splats really are, leaving out the outer 2 %, so stray splats far out don't throw it off. Most splats are made in computer-vision axes, so they're turned the right way up by default; **Flip** and the quarter turns fix any that aren't, and each splat remembers how you turned and sized it. The panel moves like the others (the bar under it, its corner, palm up).

Desktop preview: drag to pull the world, right-drag to turn around the splat, wheel to move closer or further; keys are listed on the page. This app uses three.js 0.180 (Spark needs it) through its own import map; the others stay on 0.170.

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
  input.js          hands / controllers / mouse → unified gesture state (and trigger pressure)
  handsView.js      glowing joint visualization
  pointsMaterial.js glowing point shader
  closeGesture.js   right-hand thumbs down → close the app (home: leave XR)
  fistTwist.js      fist + twist as a knob (Scribe scrolling, Cinema scrubbing)
  sceneGrab.js      two-hand pinch → move / scale / turn an object (Plume's drawing)
  navGrab.js        your view via a camera "dolly": two-hand move / zoom / turn (Marionette, Rigger, Cinema, Pip, Splat), one-hand pull (Splat)
  panelGrab.js      grab bar and corner grip to move / resize a floating panel (Marionette, Rigger, Plume)
  palmDock.js       palm up held 1 s → the panel comes to your hand (Marionette, Rigger, Plume, Splat)
  helpGesture.js    palm toward your eyes → help card
  undoGesture.js    peace sign held 1 s → undo (left hand) / redo (right hand)
  speech.js         speech recognition (built-in or Whisper) + voice activity gate (Scribe, Pip)
  whisper-worker.js Whisper in a worker via transformers.js
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
  src/buttons.js    pokeable buttons under the page
apps/holodex/
  index.html        browser layout: Rolodex pane, address bar, page viewer
  src/tabs.js       the cards (saved), address → URL, labels
  src/launch.js     opening a card as its own named browser tab
  src/ui.js         2D Rolodex drum and the front card up close
  src/drum3d.js     the Rolodex in XR
  src/main.js       wires the 2D view and XR together
apps/marionette/
  src/rig.js        the puppet's bone hierarchy, FK and two-bone IK, poses
  src/timeline.js   frames, playback, the film-strip panel
  src/main.js       stage, handles, pinch-dragging, onion skins, XR
apps/cinema/
  src/player.js     playlist and playback on one <video> element
  src/remote.js     the pokeable remote: title, time, progress bar, buttons
  src/main.js       screen, on-screen feedback, pinch / twist / two-hand gestures, XR
apps/companion/     Pip
  src/brain.js      Claude from the browser: conversation, streaming, sentences to speak
  src/voice.js      spoken answers (speech synthesis), voice choice
  src/pet.js        the egg: shell, keychain, bezel, buttons, hit testing
  src/lcd.js        the 48 × 32 pixel screen and the creature's moods
  src/bubble.js     speech bubble: what you said, the answer, status
  src/main.js       listening → thinking → speaking loop, gestures, XR
apps/rigger/
  assets/           Mesh2Motion's skeletons, sample models and animation libraries (CC0)
  src/rigs.js       the skeleton types and their files
  src/model.js      loading GLB / GLTF / FBX / OBJ into plain meshes on the floor
  src/skeleton.js   fitting: moving joints (mirror, children follow/stay), scaling, undo, first guess
  src/skinning.js   automatic skin weights (after Mesh2Motion's solver)
  src/rigged.js     binding, retargeting library clips, playback, GLB export
  src/pose.js       posing (FK, two-bone IK, planted hips), frames, onion skin, clips
  src/panel.js      the pokeable panel: steps, items, film strip, actions
  src/main.js       steps, gestures, mouse, XR
apps/splat/
  src/scene.js      loading splats (Spark), where they really are, object or place, orientation
  src/measure.js    two-point measuring, kept on the splat
  src/panel.js      the pokeable panel: scenes, tools, orientation, display
  src/main.js       pulling the world, the two-hand view grab, spin, view history, mouse, XR
apps/plume/
  src/brush.js      stroke geometry (ribbon, tube, glow), merging strokes into meshes
  src/doc.js        layers, frames, strokes, undo / redo, saving (IndexedDB)
  src/view.js       showing the frames at the playhead, onion skin, the stroke being drawn
  src/panel.js      the pokeable panel: tools, colour, size, layers, frames, playback
  src/export.js     GLB with one node per frame and a stepped animation
  src/main.js       painting, erasing, grabbing the drawing, mouse, XR
```
