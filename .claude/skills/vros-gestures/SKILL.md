---
name: vros-gestures
description: Reserved VROS hand and controller gestures and which shared module implements each. Use when designing, adding or changing any gesture, pose detection or controller mapping in a VROS app.
user-invocable: false
---

# VROS gestures

Every app shares these. An app feature must never use one of these poses (or one that a hand passes through on the way to them) for something else.

| Gesture (hands) | Controller | Does | Module |
| --- | --- | --- | --- |
| Right thumbs down, held ~1 s (ring fills) | Hold Y 1 s | Close app → home (home: leave XR) | `shared/closeGesture.js` (`isThumbsDown`, `CloseGesture`) |
| Peace sign held 1 s, repeats every ~0.5 s | X (undo) / A (redo) | Left hand undo, right hand redo | `shared/undoGesture.js` (`isPeace`, `UndoGesture`) |
| Open palm facing the eyes near eye height, 3 s | B | Show / hide help card | `shared/helpGesture.js` (`HelpGesture.fromPage`) |
| One palm up 1 s, not pinching | Left stick click | Panel / dock comes to that hand | `shared/palmDock.js` |
| Both palms up, both pinch, then move | Both triggers | Move / zoom / turn the view (or the object) | `shared/navGrab.js`, `shared/sceneGrab.js` |
| Two fists (thumb tucked) 1 s | Both grips 1 s / right stick click | Recenter | per app (`reset`) |
| Pinch the panel bar / corner / both | Point + trigger | Carry / resize / turn a panel | `shared/panelGrab.js` |
| Fist (thumb tucked) + roll | Grip + roll controller | A knob | `shared/fistTwist.js` |
| Index fingertip poke | Point + trigger (laser) | Press buttons, icons, panels | `shared/pointer.js` |

## Rules that keep them apart

- A hand with the thumb out (thumbs up/down) is **not** a fist.
- Two palm-**down** pinches are two independent one-hand pinches; only palms-**up** pinches start the two-hand grab (`palmFacesUp` in `shared/input.js`).
- Palm-up dock is suppressed while both palms are up or a hand is pinching.
- Modules return the hand/controller ids they're using (`PanelGrab.update()`, `Pointer.update()`); the app must leave those out of its own gestures.
- Holds use a filling ring for feedback and drain slowly on tracking dropouts rather than resetting.
- Every hand gesture needs a controller equivalent following the mapping in README "Quest controllers".
- Document each gesture in the page's `<dl class="legend">` and the README table; list shared ones in `data-common` instead of repeating them.
