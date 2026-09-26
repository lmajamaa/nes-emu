# Controllers

Playing with gamepads as well as the keyboard, for both consoles, and with two players. The
consoles already emulate two controller ports each, and the adapters take a player number in
`setButton(player, button, pressed)` (see `src/systems/types.ts`), so this is work in the shell.

References: the [Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API) and
its [standard mapping](https://w3c.github.io/gamepad/#remapping) of buttons and axes.

## Layout

```
src/shell/
  input.ts            gamepad mapping, and merging the keyboard and pads into each player's buttons
  input.test.ts
  App.tsx             polls the pads each frame, keyboard events feed the same buttons
src/systems/
  types.ts            EmulatorSystem gets padMap next to keyMap
  nes/index.tsx       the NES pad mapping
  snes/index.ts       the SNES pad mapping
```

## Milestones

### 1. Gamepads (small)

- `navigator.getGamepads()` is read once per frame in the emulation loop. The first pad is
  player 1 and the second player 2, while the keyboard stays player 1.
- Each system maps the standard layout's buttons, which are numbered by position, to its own:
  - SNES: B at the bottom, A on the right, Y on the left, X at the top, L and R on the shoulders
    (and the triggers), Select and Start, the D-pad.
  - NES: B at the bottom and A on the right, like the SNES's, Select, Start and the D-pad.
  - The left stick moves the D-pad too, past half way.
  - Pads without the standard mapping get the same table, which fits most of them.
- The keyboard and the pads each keep their own buttons, and a player's buttons are all of them
  together. Only changes reach the emulator, so letting go of a key doesn't let go of the same
  button held on a pad. Keys are let go when the window loses focus.
- Browsers only show a pad once one of its buttons is pressed, so the help under the screen
  says which pads are connected, and which player each is.
- Tests: the mapping and the merging are plain functions, tested with pads made up in the test.

### 2. Rebinding (medium)

- Choosing the keys and pad buttons for each console's buttons, remembered in the browser.
- A second keyboard player, which the NES plan's milestone 3 had in mind, can then be a set of
  bindings for player 2.

### 3. Later

- Turbo buttons, and the NES Zapper (see the NES plan).
- Four players through the SNES multitap.

## Risks and decisions

- **Mapping by position, not by label**: the buttons are where they are on a SNES pad, whatever
  their labels say. On an Xbox pad the SNES's A is the pad's B, on a Nintendo pad the labels match.
- **Polling, not events**: the Gamepad API has no button events, and reading the pads with the
  frame they are used for keeps input lag to a frame.
- **Two players on the keyboard** wait for rebinding, to keep this milestone small.

## Progress

- [x] 1. Gamepads. `src/shell/input.ts` maps the pads and merges them with the keyboard, and
  `App.tsx` reads the pads at the start of each frame. Tested with pads made up in the tests, and
  in the browser with a stand-in for `navigator.getGamepads`: the D-pad and the stick move
  nestest's menu, and the help says which pad is which player
- [ ] 2. Rebinding
