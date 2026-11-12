# Gubs

Online version of the Gamewright card game Gubs for 2 to 6 players. Plain HTML/CSS/JS, no build step.
State is synced through Firebase Realtime Database; the site itself is static, so it deploys to Vercel as-is.

## Firebase

`firebase-config.js` already holds the gubs-80fbf web config. All data is written under the
`gubs-v2` key, separate from the old app's data. The Realtime Database rules must allow access there:

    { "rules": { "gubs-v2": { ".read": true, ".write": true } } }

(If your rules are already fully open, nothing needs changing. Open access is fine for a private
game among friends but is not a secure setup.)

## Run it locally

    python3 -m http.server 8000      # then open http://localhost:8000

Add `?local=1` to the address for **practice mode**: rooms live in this browser's localStorage and
never touch Firebase. To play both sides yourself in practice mode, open the room in a second tab
and add `&as=2` to the address.

## Deploy to Vercel

Push this folder to a GitHub repo, then in Vercel: Add New -> Project -> import the repo ->
Framework Preset "Other", no build command, output directory left as the root. Every push redeploys.

## Layout

- `js/cards.js`   card names, types, text, and **copies per card** (edit counts here)
- `js/engine.js`  the rules: pure functions, no DOM or network
- `js/net.js`     Firebase / practice-mode storage
- `js/game.js`    lobby + table UI
- `tests/`        `npm test` runs the rules tests, including 400 random full games

## Rulings made where the cards are silent

- Card copies per deck are a best guess totalling 70 (see `js/cards.js`).
- Letters are seeded one per third of the deck.
- Barricades go on your own Free Gubs only. The Esteemed Elder can never be covered, trapped, lured, speared or flooded.
- Rings and Sud Spouts may trap any Free Gub in play, including your own.
- Feather / Blindfold can be played by any player who holds one; only those players are asked.
- Smahl Thief: a stolen Gub arrives Free on your side (its Barricade returns to the owner's hand,
  its Sud Spout is discarded); a stolen Barricade or Sud Spout goes to your hand.
- Retreat takes whole stacks, including traps opponents put on your side.
- Age-Old Cure's "take a Gub" mode is played on your own turn and cannot fetch the Elder.
- Traveling Merchant: "right" is the player who acts before you.
- Hands are stored in the shared game state, so a player who opens dev tools could peek.
