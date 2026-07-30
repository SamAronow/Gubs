/* ------------------------------------------------------------------
   cards.js — the Gubs deck.

   72 cards, matching the composition published by the game's designer.
   Every entry maps to a .png of the same name in /cards (letters use
   G.png / U.png / B.png).

   type:  letter | gub | barricade | trap | tool | hazard | event | interrupt
   count: how many copies are in the deck
   need:  what the card asks you to click on when you play it
------------------------------------------------------------------- */

const CARDS = {

  /* --- Letter cards (3) --------------------------------------- */
  G: { name: 'G', type: 'letter', count: 1,
       text: 'One third of G-U-B. When the third letter is drawn, the game ends at once.' },
  U: { name: 'U', type: 'letter', count: 1,
       text: 'One third of G-U-B. When the third letter is drawn, the game ends at once.' },
  B: { name: 'B', type: 'letter', count: 1,
       text: 'One third of G-U-B. When the third letter is drawn, the game ends at once.' },

  /* --- Gubs (14) ---------------------------------------------- */
  gub: { name: 'Gub', type: 'gub', count: 13, need: 'none',
         text: 'Goes face up on your side. Worth 1 point while it is Free or Protected.' },
  esteemed_elder: { name: 'Esteemed Elder', type: 'gub', count: 1, elder: true, need: 'none',
         text: 'Worth 1 point. Immune to every card in the deck except Lightning. Cannot be barricaded, trapped, lured or recovered from the discard pile. Breaks ties in your favour.' },

  /* --- Barricades (13) ---------------------------------------- */
  mushroom: { name: 'Mushroom', type: 'barricade', count: 7, need: 'barricade',
         text: 'Cover one of your Free Gubs to Protect it. Or discard a Mushroom already in play — both Mushrooms go to the discard pile.' },
  toad_rider: { name: 'Toad Rider', type: 'barricade', count: 4, need: 'barricade',
         text: 'Cover one of your Free Gubs to Protect it. Or discard a Toad Rider already in play. Vulnerable to a Rumor of Wasps.' },
  velvet_moth: { name: 'Velvet Moth', type: 'barricade', count: 2, need: 'barricade',
         text: 'Cover one of your Free Gubs to Protect it. Or discard a Velvet Moth already in play.' },

  /* --- Traps (7) ----------------------------------------------- */
  single_ring: { name: 'Single Ring', type: 'trap', count: 1, capacity: 1, ring: true, need: 'trap',
         text: 'Trap one Free Gub on an opponent\u2019s side. Trapped Gubs score nothing.' },
  double_ring: { name: 'Double Ring', type: 'trap', count: 1, capacity: 2, ring: true, need: 'trap',
         text: 'Trap two Free Gubs on one opponent\u2019s side. Trapped Gubs score nothing.' },
  triple_ring: { name: 'Triple Ring', type: 'trap', count: 1, capacity: 3, ring: true, need: 'trap',
         text: 'Trap three Free Gubs on one opponent\u2019s side. Trapped Gubs score nothing.' },
  sud_spout: { name: 'Sud Spout', type: 'trap', count: 4, capacity: 1, spout: true, need: 'trap',
         text: 'Trap one Free Gub on an opponent\u2019s side. A Smahl Thief can steal the Gub out from under it.' },

  /* --- Tools (9) ----------------------------------------------- */
  spear: { name: 'Spear', type: 'tool', count: 4, need: 'anyTrap',
         text: 'Destroy any Trap in play. The Gub stays where it sits but is Free again.' },
  haki_flute: { name: 'Haki Flute', type: 'tool', count: 2, need: 'ringTrap',
         text: 'Shatter a Ring and win every Gub clinging to it. They go straight into play on your side.' },
  scout: { name: 'Scout', type: 'tool', count: 2, need: 'none',
         text: 'Look at the top three cards of the deck. Keep one and put the rest back on top in any order.' },
  retreat: { name: 'Retreat', type: 'tool', count: 1, need: 'none',
         text: 'Take every card in play on your side back into your hand, even cards your opponents put there.' },

  /* --- Hazards (14) -------------------------------------------- */
  lure: { name: 'Lure', type: 'hazard', count: 7, need: 'freeGubEnemy',
         text: 'Take one Free Gub from an opponent and put it into play on your side.' },
  super_lure: { name: 'Super Lure', type: 'hazard', count: 2, need: 'player',
         text: 'Take every Free and Protected Gub from one opponent, Barricades and all.' },
  lightning: { name: 'Lightning', type: 'hazard', count: 1, need: 'anyGub',
         text: 'Destroy any one Gub in play \u2014 the only card that can touch the Esteemed Elder.' },
  cyclone: { name: 'Cyclone', type: 'hazard', count: 1, need: 'player',
         text: 'Target player\u2019s Barricades are destroyed. Gubs are not affected.' },
  omen_beetle: { name: 'Omen Beetle', type: 'hazard', count: 2, need: 'none',
         text: 'All Mushrooms in play are discarded, along with the Gubs hiding behind them.' },
  smahl_thief: { name: 'Smahl Thief', type: 'hazard', count: 1, need: 'spoutGub',
         text: 'Steal a Gub out from under a Sud Spout. The Sud Spout is discarded.' },

  /* --- Events (6) — resolve the moment they are drawn ----------- */
  dangerous_alchemy: { name: 'Dangerous Alchemy', type: 'event', count: 1,
         text: 'Whoever draws this discards every card in play on their side except the Esteemed Elder.' },
  flash_flood: { name: 'Flash Flood', type: 'event', count: 2,
         text: 'Every Free Gub in play is shuffled back into the deck.' },
  gargok_plague: { name: 'Gargok Plague', type: 'event', count: 1,
         text: 'Every player shuffles their hand back into the deck unless they play an Age-Old Cure.' },
  rumor_of_wasps: { name: 'Rumor of Wasps', type: 'event', count: 1,
         text: 'Every Gub riding a Toad Rider is shuffled back into the deck.' },
  traveling_merchant: { name: 'Traveling Merchant', type: 'event', count: 1,
         text: 'Every player keeps one card and passes the rest of their hand to the left.' },

  /* --- Interrupts (6) — playable out of turn -------------------- */
  age_old_cure: { name: 'Age-Old Cure', type: 'interrupt', count: 2, need: 'discardGub',
         text: 'Cancel the Gargok Plague and keep your hand. Or, on your turn, take a Gub from the discard pile into your hand.' },
  blindfold: { name: 'Blindfold', type: 'interrupt', count: 1,
         text: 'Cancel a Lure or a Super Lure aimed at you.' },
  feather: { name: 'Feather', type: 'interrupt', count: 1,
         text: 'Cancel any Hazard or Trap as it is played against you.' },
  flop_boat: { name: 'Flop Boat', type: 'interrupt', count: 1,
         text: 'Cancel an Event the moment it is drawn and shuffle it back into the deck. It works on Letter cards too.' },
  cricket_song: { name: 'Cricket Song', type: 'interrupt', count: 1, wild: true,
         text: 'Wild. Play it as any Hazard, Tool or Interrupt in the deck \u2014 never as an Event, Gub, Barricade or Trap.' }
};

/* Cards the Cricket Song is allowed to imitate. */
const CRICKET_CHOICES = Object.keys(CARDS).filter(function (id) {
  var t = CARDS[id].type;
  return id !== 'cricket_song' && (t === 'hazard' || t === 'tool' || t === 'interrupt');
});

/* uid  -> "lure#3".  Everything in the database refers to cards by uid. */
function cardId(uid) { return uid.split('#')[0]; }
function cardDef(uid) { return CARDS[cardId(uid)]; }
function cardName(uid) { return cardDef(uid).name; }
function cardImg(uid) { return 'cards/' + cardId(uid) + '.png'; }

/* Build one full 72-card deck of uids. */
function buildDeck() {
  var deck = [];
  Object.keys(CARDS).forEach(function (id) {
    for (var i = 0; i < CARDS[id].count; i++) deck.push(id + '#' + i);
  });
  return deck;
}

function shuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
