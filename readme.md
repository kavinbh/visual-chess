README.md
# Chess Vision Overlay

A Chrome extension that detects when you're on a chess board and paints an overlay showing **every square each side controls**:

- **Green** — squares *your* pieces look at (full vision: a bishop's whole diagonal until something blocks it, a pawn's two attacking diagonals, etc. — not just legal captures).
- **Red** — squares your *opponent's* pieces look at.
- **Diagonal green/red split** — contested squares both sides see.

It's a passive *vision/threat map*: it does not suggest moves or evaluate the position.

## Supported sites
- **lichess.org**
- **chess.com**

(Adding another site = writing one more adapter — see "Extending" below.)

## Install (developer mode)
1. Keep this folder (`chess-vision-overlay`) somewhere on disk — it must contain `manifest.json`, `content.js`, and `overlay.css`.
2. Open `chrome://extensions` in Chrome (or Edge/Brave).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the `chess-vision-overlay` folder.
5. Open lichess.org or chess.com and load a game/board. The overlay appears, plus a small **Chess Vision** control panel (top-left, draggable).

If you edit any file, return to `chrome://extensions` and hit the reload icon on the extension.

## Controls
The little panel lets you toggle the whole overlay, your-control (green), and opponent-control (red) independently. Drag it by its header; position and toggles are remembered.

## How it works (quick tour of `content.js`)
1. **Site adapters** read board geometry, orientation, and the piece list from the DOM.
   - *lichess* reads `<piece>` elements and their `transform: translate(...)` (chessground), using the `orientation-white/black` class to map screen → logical squares.
   - *chess.com* reads `.piece` elements whose classes encode color/type (`wp`, `bn`, …) and square (`square-FR`, file then rank); the `flipped` board class gives orientation.
2. **Vision engine** (`computeVision`) — pure chess logic. For each piece it marks every square it sees, stopping at (and including) the first blocker for sliding pieces.
3. **Renderer** paints a `pointer-events: none` overlay aligned to the board, so it never blocks your clicks.
4. **Controller** uses a `MutationObserver` to redraw after every move, plus a 1-second loop to re-detect the board across page navigations.

"You" is taken to be the side at the **bottom** of the board (standard in a live game). In analysis/spectator mode that's just whichever side the board is oriented to.

## Extending to another site
Add an adapter object to the `ADAPTERS` array in `content.js` with three methods:
```js
{
  name: "mysite",
  match: () => /mysite\.com$/.test(location.hostname),
  getBoardElement: () => document.querySelector("...the 8x8 board element..."),
  read(boardEl) {
    // return { pieces: [{file,rank,color,type}], whiteBottom: <bool> }
    // file/rank are 0..7, rank 0 = White's first rank, color 'w'|'b', type 'p|n|b|r|q|k'
  }
}
```

## Notes
- Site DOMs change over time. If chess.com or lichess updates their markup, a selector in the relevant adapter may need a small tweak — the panel's status line ("no board detected") tells you when reading fails.
- The pieces stay fully visible because the colored squares are semi-transparent and don't intercept clicks.
- One thing to keep in mind: many platforms prohibit any external assistance during **rated** play. This tool is meant for learning, analysis, and casual/offline study — check the rules of whatever you're playing before turning it on in a competitive game.