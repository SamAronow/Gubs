# Gubs — online, 2–4 players

A browser version of Gamewright's *Gubs: A Game of Wit and Luck*, for you and up to
three friends. Plain HTML, CSS and JavaScript. Every player's page talks to the same
Firebase Realtime Database node and re-renders whenever it changes; there is no server
of your own to run.

---

## Getting it running

**1. Add the card art.** Drop your 33 PNGs into `cards/`. The filenames must stay
exactly as they are — the code builds image paths from card ids:

```
cards/
  G.png  U.png  B.png  back.png
  gub.png  esteemed_elder.png
  mushroom.png  toad_rider.png  velvet_moth.png
  single_ring.png  double_ring.png  triple_ring.png  sud_spout.png
  spear.png  haki_flute.png  scout.png  retreat.png
  lure.png  super_lure.png  lightning.png  cyclone.png  omen_beetle.png  smahl_thief.png
  dangerous_alchemy.png  flash_flood.png  gargok_plague.png  rumor_of_wasps.png
  traveling_merchant.png
  age_old_cure.png  blindfold.png  feather.png  flop_boat.png  cricket_song.png
```

If an image is missing the card still works — it falls back to a printed name — so you
can test before the art is in place.

**2. Try it locally.** Open a static server from this folder (`file://` will not work,
because the Firebase SDK needs a real origin):

```
python3 -m http.server 8000
```

Then visit `http://localhost:8000` in two browser windows. Use a normal window and a
private one, or two different browsers — player identity lives in `localStorage`, so
two tabs of the same profile are the same player.

**3. Deploy.** Push the folder to a git repo and point Vercel at it. There is no build
step; `vercel.json` just tells it to serve the directory as static files. After the
first deploy, add your Vercel domain under **Firebase console → Authentication →
Settings → Authorized domains** if you ever turn auth on, and check your Realtime
Database rules (see *Security* below).

---

## How a game goes

1. Someone creates a room and reads out the four-letter code.
2. Up to three more people join with that code. Two to four players.
3. The host presses **Deal the cards**. Everyone's page jumps to the table.

The setup follows the rules sheet: one Gub per player is pulled from the deck and put
into play on their side, the three Letter cards are removed, the rest is shuffled, three
cards are dealt to each player (any Event dealt goes back in and is replaced), then the
Letters are slid back in — one near the top, one in the middle, one near the bottom.

On your turn: draw (or skip, but never two turns running), play as many cards as you
like, then end your turn holding no more than eight. Events fire the instant they are
drawn. When the third letter of G-U-B comes out, the game stops immediately and whoever
has the most Free and Protected Gubs wins — ties go to the Esteemed Elder, then to the
smallest hand.

Interrupts play themselves. If someone aims a Lure at you and you are holding a Feather
or a Blindfold, a window opens on your screen and the table waits for your answer. Same
for the Flop Boat when an Event or a Letter is drawn, and the Age-Old Cure when the
Gargok Plague hits.

---

## The deck

72 cards, matching the composition the game's designer published:

| | |
|---|---|
| Letters | G, U, B |
| Gubs | 13 Gub, 1 Esteemed Elder |
| Barricades | 7 Mushroom, 4 Toad Rider, 2 Velvet Moth |
| Traps | 4 Sud Spout, 1 Single Ring, 1 Double Ring, 1 Triple Ring |
| Tools | 4 Spear, 2 Haki Flute, 2 Scout, 1 Retreat |
| Hazards | 7 Lure, 2 Super Lure, 2 Omen Beetle, 1 Lightning, 1 Cyclone, 1 Smahl Thief |
| Events | 2 Flash Flood, 1 Dangerous Alchemy, 1 Gargok Plague, 1 Rumor of Wasps, 1 Traveling Merchant |
| Interrupts | 2 Age-Old Cure, 1 Blindfold, 1 Feather, 1 Flop Boat, 1 Cricket Song |

The rules sheet says 70 and the designer's own list says 72; the difference is
presumably a print-run change. 72 is what is implemented.

### Effects I had to reconstruct

Your PDF has the rules sheet and the FAQ but not the Card Guide, so most card text came
from Gamewright's own rules PDF and the official FAQ. Three things are my best
reconstruction rather than confirmed text — all of them live in `js/cards.js`, one line
each, if you want to correct them against a physical deck:

- **Scout** — implemented as *look at the top three cards, keep one, the rest go back on
  top in the same order*. Letters and Events cannot be taken this way, since taking one
  is not the same as drawing it and there is no sensible way to make it fire.
- **Barricade-on-Barricade** — a Mushroom may be played to discard another Mushroom in
  play (both go to the discard pile, leaving the Gub beneath Free), and likewise for
  Toad Rider and Velvet Moth. The category is confirmed; the same-kind restriction is my
  reading.
- **Traps only go on Free Gubs.** Barricaded Gubs cannot be trapped, which is what makes
  Barricades worth playing.

Two more places where I made a call the rules do not spell out:

- A Ring normally needs its full number of Gubs, but if the target does not have that
  many Free Gubs you get a **Set it on N** button so a Triple Ring is not dead in hand.
- The Esteemed Elder is immune to everything except Lightning, per the FAQ. That means
  Super Lure, Flash Flood and Dangerous Alchemy all leave it alone.

---

## What lives in the database

```
rooms/{CODE}
  meta          code, hostId, status (lobby | playing | finished)
  players/{pid} name, seat, joinedAt
  deck          [uid, ...]        index 0 is the top of the deck
  discard       [uid, ...]        index 0 is the top of the pile
  hands/{pid}   [uid, ...]
  tableau/{pid}
    gubs/{key}  { card, cardId, barricade, barricadeId, trap }
    traps/{key} { card, cardId, capacity }
  pending       an open interrupt window, or absent
  state         phase, turnSeat, seatCount, letters, skipped, log, winner, results
```

A *uid* is a single physical card: `lure#3`, `gub#11`, `G#0`. Every reference in the
database is a uid, so a card can be tracked from the deck to a hand to the table and
back.

`tableau/{pid}/traps` is separate from the Gubs because a Ring can hold several Gubs at
once — each Gub entry stores the key of the trap sitting on it, and the trap card is
discarded when the last Gub leaves it. That is what makes the Haki Flute ("shatter a
Ring and win all the Gubs clinging to it") work.

### Who writes

Only one client writes at a time, which is what keeps this safe without a server:

- The player whose turn it is writes their own moves.
- When someone opens an interrupt window, everyone who may answer writes only their own
  response under `pending/responses/{pid}` — and the player who opened the window is the
  one who applies the outcome and clears it.

Each action is resolved by copying the relevant branches, mutating them locally, then
writing them back in one `update()`.

---

## Security

The database has no authentication on it. Hands are readable by anyone who knows the
room code and opens a browser console. The interface never shows them, and for a game
among friends that is usually fine — but it is not hidden information against a
determined opponent.

If you want to tighten it, the smallest useful step is a rules change so that a room can
only be read while it exists and written by its own players. Properly hiding hands needs
either Firebase Auth plus per-player read rules, or moving the deck and hands behind a
Cloud Function. Neither is required to play.

Reasonable starting rules, still open but not a public scratchpad:

```json
{
  "rules": {
    "rooms": {
      "$code": {
        ".read": true,
        ".write": true,
        ".validate": "newData.hasChildren(['meta'])"
      }
    }
  }
}
```

---

## Known edges

- **If the player whose turn it is closes the tab mid-action**, the table waits. Rejoin
  from the lobby with the same browser profile — identity is stored in `localStorage`,
  so you land back in your seat and the game carries on.
- **If the deck runs out** before three letters are drawn, the game ends and is scored on
  the spot. In practice the letters come out first.
- **Two tabs in the same browser profile are the same player.** Use a private window for
  the second seat when testing.
- The log keeps the last 60 entries.

---

## Testing

The engine was exercised headlessly before shipping: an in-memory stand-in for the
Realtime Database (one that drops nulls and empty objects the way Firebase does) plus one
jsdom document per player, running the real `js/game.js`. Bots played complete games
making random legal moves while asserting, after every action, that all 72 cards exist
exactly once somewhere, that no trap is left orphaned on the table, that no trap holds
more Gubs than its capacity, and that the Esteemed Elder is never barricaded or trapped.

That turned up four bugs worth knowing about, all fixed:

- Firebase echoes a local write to your own listener *before* the write promise resolves.
  A "busy" flag was still set when the interrupt resolver ran, so every Feather or Flop
  Boat window would have hung the table permanently. The flag now clears on the echo, and
  each window carries a one-shot resolution guard.
- The Haki Flute discarded the shattered Ring twice, because moving the last Gub off a
  trap already tidies the trap card away.
- Two people pressing **Join** at the same moment both read "seat 1 is free" and both
  took it. Seats are now claimed in a transaction, which also handles a full room and a
  game that has already started.
- If someone left the middle seat before the deal, seats were left with a gap — and the
  table advances turns with `(seat + 1) % seatCount`, so the player sitting past the end
  would never get a turn. Seats are renumbered contiguously at deal time, from a fresh
  read rather than whatever the host's page last rendered.
