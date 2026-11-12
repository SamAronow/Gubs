// Card definitions. Text is taken from the printed Gamewright cards.
// `count` is the number of copies in the 70-card deck. The per-card counts are
// NOT printed anywhere on the cards or rules sheet -- adjust them here to match
// your physical deck if they differ.

export const CARDS = {
  gub:            { name: 'Gub',            kind: 'gub',       count: 13, text: 'Worth 1 point while Free or Protected.' },
  esteemed_elder: { name: 'Esteemed Elder', kind: 'gub',       count: 1,  text: 'Immune to everything except Lightning.' },

  mushroom:       { name: 'Mushroom',       kind: 'barricade', count: 7,  text: 'Protect a Gub or force any Mushroom in play to be discarded.' },
  toad_rider:     { name: 'Toad Rider',     kind: 'barricade', count: 4,  text: 'Protect a Gub or force any Barricade in play to be discarded.' },
  velvet_moth:    { name: 'Velvet Moth',    kind: 'barricade', count: 2,  text: 'Protect a Gub.' },

  sud_spout:      { name: 'Sud Spout',      kind: 'trap',      count: 4,  text: 'Trap one Free Gub. Place over Gub wherever it is in play.' },
  single_ring:    { name: 'Single Ring',    kind: 'trap',      count: 1,  ring: 1, text: 'Trap exactly one Free Gub. Place Trapped Gub beneath this Ring on your side.' },
  double_ring:    { name: 'Double Ring',    kind: 'trap',      count: 1,  ring: 2, text: 'Trap exactly two Free Gubs. Place Trapped Gubs beneath this Ring on your side.' },
  triple_ring:    { name: 'Triple Ring',    kind: 'trap',      count: 1,  ring: 3, text: 'Trap exactly three Free Gubs. Place Trapped Gubs beneath this Ring on your side.' },

  lure:           { name: 'Lure',           kind: 'hazard',    count: 7,  text: "Draw one Free Gub away from an opponent's side and to your own." },
  super_lure:     { name: 'Super Lure',     kind: 'hazard',    count: 2,  text: "Lure all of target player's Free and Protected Gubs. Abandoned Barricades return to owner's hand." },
  cyclone:        { name: 'Cyclone',        kind: 'hazard',    count: 1,  text: "Target player's Barricades are destroyed. Gubs are not affected." },
  lightning:      { name: 'Lightning',      kind: 'hazard',    count: 1,  text: 'Smite the Esteemed Elder or force an opponent to discard their hand.' },
  omen_beetle:    { name: 'Omen Beetle',    kind: 'hazard',    count: 2,  text: 'All Mushrooms in play are discarded, along with Gubs hiding behind them.' },
  smahl_thief:    { name: 'Smahl Thief',    kind: 'hazard',    count: 1,  text: 'Steal any card in play except for the Esteemed Elder, Rings, or Gubs trapped in Rings.' },

  spear:          { name: 'Spear',          kind: 'tool',      count: 2,  text: 'Tool or Hazard. Destroy a Sud Spout or kill one Free Gub.' },
  haki_flute:     { name: 'Haki Flute',     kind: 'tool',      count: 2,  text: 'Shatter a Ring and win all of the trapped Gubs clinging to it. Gubs go immediately into play on your side.' },
  retreat:        { name: 'Retreat',        kind: 'tool',      count: 1,  text: 'Take any or all cards in play on your side back into your hand.' },
  scout:          { name: 'Scout',          kind: 'tool',      count: 2,  text: "Look at an opponent's hand or rearrange the top three cards on the deck." },

  feather:        { name: 'Feather',        kind: 'interrupt', count: 1,  text: 'Cancel any Hazard or Trap card when it is played.' },
  blindfold:      { name: 'Blindfold',      kind: 'interrupt', count: 1,  text: 'Cancel any Lure or Super Lure when it is played.' },
  flop_boat:      { name: 'Flop Boat',      kind: 'interrupt', count: 1,  text: 'Before an Event takes effect, play this card to have that Event card shuffled back into the deck.' },
  age_old_cure:   { name: 'Age-Old Cure',   kind: 'interrupt', count: 2,  text: 'Protect your hand from the Gargok Plague or take a Gub from the discard pile into your hand.' },

  cricket_song:   { name: 'Cricket Song',   kind: 'wild',      count: 1,  text: 'May be played as any one Hazard, Tool, or Interrupt card.' },

  flash_flood:        { name: 'Flash Flood',        kind: 'event', count: 2, text: 'Shuffle all Free Gubs in play back into the deck.' },
  gargok_plague:      { name: 'Gargok Plague',      kind: 'event', count: 1, text: 'All players shuffle their hands back into the deck, unless they immediately play an Age-Old Cure.' },
  dangerous_alchemy:  { name: 'Dangerous Alchemy',  kind: 'event', count: 1, text: 'Whoever drew this card must discard all their cards in play, except for the Esteemed Elder.' },
  rumor_of_wasps:     { name: 'Rumor of Wasps',     kind: 'event', count: 1, text: 'Shuffle Toad Riders and the Gubs beneath them back into the deck.' },
  traveling_merchant: { name: 'Traveling Merchant', kind: 'event', count: 1, text: 'All players pass their hands to the right, keeping one card.' },

  G: { name: 'Letter G', kind: 'letter', count: 1, text: 'The game ends when the third Letter is drawn.' },
  U: { name: 'Letter U', kind: 'letter', count: 1, text: 'The game ends when the third Letter is drawn.' },
  B: { name: 'Letter B', kind: 'letter', count: 1, text: 'The game ends when the third Letter is drawn.' },
};

export const HAND_LIMIT = 8;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

// What Cricket Song may stand in for (Hazard, Tool or Interrupt).
export const WILD_TYPES = Object.keys(CARDS).filter(t =>
  ['hazard', 'tool', 'interrupt'].includes(CARDS[t].kind));

export const typeOf = id => id.split(':')[0];
export const def = id => CARDS[typeOf(id)];
export const kindOf = id => def(id).kind;
export const nameOf = id => def(id).name;
export const isElder = id => typeOf(id) === 'esteemed_elder';
export const isEvent = id => ['event', 'letter'].includes(kindOf(id));
