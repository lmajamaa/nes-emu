# Mobile

Playing on phones and tablets: touch controls, a layout and gestures that suit a touch screen,
and enough speed on slower phones. The page already fits a phone's width, and sound starts with
the first touch. Pads paired to a phone already work, see the [controllers plan](003-controllers.md).

References: [Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events),
[touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action), and
[Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) for moving
emulation off the page's thread.

## Layout

```
src/shell/
  TouchControls.tsx   the on-screen D-pad and buttons, laid out per console
  App.tsx             shows them on touch screens, and hides what only suits a mouse and keyboard
src/systems/
  types.ts            each system lists the buttons its touch controls need
```

## Milestones

### 1. Touch controls (medium)

- An on-screen D-pad, and the console's buttons: A and B for the NES, A, B, X, Y, L and R for the
  SNES, with Select and Start. Shown on devices whose main pointer is coarse, a touch screen.
- Pointer events with `touch-action: none`, so the page doesn't scroll or zoom under the thumbs,
  and several fingers at once, like the D-pad and a button. Sliding from one D-pad direction to
  another follows the finger, like on a real D-pad.
- They feed the same per-source buttons as the keyboard and the pads.
- Tests: the D-pad direction from a touch position, and the buttons of several touches.

### 2. Layout and gestures (small)

- In landscape the screen fills the height between the touch controls, in portrait the controls
  go below the screen.
- On touch screens the screen doesn't pause on a tap, and double tap doesn't go full screen,
  as those clash with the buttons over it. The pause button stays.
- The debugger is collapsed on small screens, and the keyboard help hidden on touch screens.
- iPhones can't make a page full screen, so the landscape layout leaves out the header there.

### 3. Speed (small)

- A frame time readout, shown with a setting, to measure real phones on the live site.
- On a fast desktop a frame of NES or SNES takes about 4.5 ms of the 16.6 ms budget. Mid-range
  Android phones run JavaScript several times slower, which puts the SNES near the budget.
- Less work per frame where it's cheap: the debugger only redraws while it's shown.

### 4. Web Worker (large, only if phones are too slow)

- Emulation moves to a worker, so the page's thread only draws and handles input. Frames go back
  in a transferred buffer, sound straight to the audio worklet, and input the other way.
- The debugger reads the emulator's state, which then lives in the worker, so it gets a snapshot
  message instead.
- The plans' "Later" sections have this for both consoles.

### 5. Later

- Installing as an app that works offline, with a service worker caching the site.
- Vibration on button presses, where the browser has it.

## Risks and decisions

- **Speed** is the main risk, and can only be measured on real phones: milestone 3 comes before
  any work on the worker.
- **Touch controls over the screen or beside it**: beside it in landscape, where there's room,
  so they don't hide the game. Over the screen's edges only if the screen gets too small.
- **iOS**: Safari needs a touch before sound starts, which is already handled, and plays no
  sound with the silent switch on, which a page can't change.

## Progress

- [x] 1. Touch controls. `src/shell/TouchControls.tsx`, shown when the main pointer is coarse, with
  each system's `touchLayout`: the NES has B and A side by side, the SNES X, Y, A and B in a
  diamond with L and R above. They are player 1's, merged with the keyboard and the pads in
  `input.ts`. Checked in the browser's phone emulation: the D-pad moves nestest's menu, a thumb
  rolls from B to A, and two fingers press the D-pad and a button together
- [x] 2. Layout and gestures. Below the screen in portrait, beside it in landscape, where the
  screen leaves 170px for each side. Phones on their side drop the header, so the console menu is
  back in portrait. On touch screens a tap doesn't pause, the video player's controls stay shown,
  theater mode and the keyboard help are left out, and the debugger starts hidden: a button next
  to theater mode shows it, and it's remembered. Full screen takes the touch controls along with
  the screen, and turns phones to landscape where the browser allows it (Chrome on Android). The
  browser pane it was tested in doesn't allow full screen, so that layout was checked with the
  full screen styles put on by hand, and is still to be tried on a phone
- [x] 3. Speed. With the debugger shown, a line under the screen gives the time a frame takes,
  the slowest in the last second and the frames shown a second, e.g. "Frame 2.9 ms of 16.6 ms
  (17%)". Hidden, the debugger isn't drawn at all. Real phones are still to be measured, which
  decides milestone 4
- [ ] 4. Web Worker
