// Pure rules engine for Gubs. No DOM, no network: state in, state out.
// The whole game is one JSON-serialisable object so it can be stored in a
// single Firebase node and updated atomically with a transaction.

import { CARDS, HAND_LIMIT, WILD_TYPES, typeOf, kindOf, nameOf, isElder, isEvent } from './cards.js';

// ---------- small helpers ----------

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const clone = o => JSON.parse(JSON.stringify(o));
const pname = (s, pid) => (s.players.find(p => p.id === pid) || {}).name || '?';
const others = (s, pid) => s.players.map(p => p.id).filter(id => id !== pid);
// The whole game's log is kept (a full game is only a few hundred short lines).
function log(s, msg) { s.log.push(msg); }
function fail(msg) { const e = new Error(msg); e.rule = true; throw e; }

function newStack(s, gubs, top = null) { return { id: 's' + (s.seq++), gubs, top }; }

// 'free' | 'protected' | 'sud' | 'ring'
export function stackStatus(st) {
  if (!st.top) return 'free';
  const k = kindOf(st.top);
  if (k === 'barricade') return 'protected';
  return CARDS[typeOf(st.top)].ring ? 'ring' : 'sud';
}

export function locate(s, cardId) {
  for (const pid of Object.keys(s.table)) {
    for (const st of s.table[pid]) {
      if (st.top === cardId) return { pid, st, role: 'top' };
      if (st.gubs.includes(cardId)) return { pid, st, role: 'gub' };
    }
  }
  return null;
}
function removeStack(s, pid, st) { s.table[pid] = s.table[pid].filter(x => x !== st); }

function allStacks(s) {
  const out = [];
  for (const p of s.players) for (const st of s.table[p.id]) out.push({ pid: p.id, st });
  return out;
}
// Free, non-Elder gubs (the Elder is immune to everything but Lightning).
function freeGubIds(s, pred = () => true) {
  return allStacks(s)
    .filter(x => stackStatus(x.st) === 'free' && !isElder(x.st.gubs[0]) && pred(x.pid))
    .map(x => x.st.gubs[0]);
}
function topsWhere(s, pred) {
  return allStacks(s).filter(x => x.st.top && pred(x.st.top, x.pid)).map(x => x.st.top);
}
const hasType = (s, pid, types) => s.hands[pid].some(c => types.includes(typeOf(c)));

export function score(s, pid) {
  return s.table[pid].filter(st => ['free', 'protected'].includes(stackStatus(st))).length;
}

// ---------- setup ----------

export function newGame(players, rng = Math.random) {
  if (players.length < 2 || players.length > 6) fail('Gubs is for 2 to 6 players.');
  const s = {
    phase: 'playing', players: players.map(p => ({ id: p.id, name: p.name })),
    turn: 0, drew: false, played: false, skipped: {},
    deck: [], discard: [], hands: {}, table: {}, letters: [],
    pending: null, reveal: null, result: null, lastDraw: null, log: [], seq: 1,
  };
  let deck = [];
  const letters = [];
  for (const [type, d] of Object.entries(CARDS)) {
    for (let i = 1; i <= d.count; i++) {
      (d.kind === 'letter' ? letters : deck).push(`${type}:${i}`);
    }
  }
  // Each player starts with one ordinary Gub in play.
  for (const p of s.players) {
    const i = deck.findIndex(c => typeOf(c) === 'gub');
    s.table[p.id] = [newStack(s, [deck.splice(i, 1)[0]])];
    s.hands[p.id] = [];
    s.skipped[p.id] = false;
  }
  shuffle(deck, rng);
  // Deal three each; Events are set aside, replaced, then shuffled back in.
  const aside = [];
  for (let r = 0; r < 3; r++) {
    for (const p of s.players) {
      let c = deck.pop();
      while (isEvent(c)) { aside.push(c); c = deck.pop(); }
      s.hands[p.id].push(c);
    }
  }
  deck.push(...aside);
  shuffle(deck, rng);
  // One Letter near the top, one in the middle, one near the bottom.
  shuffle(letters, rng);
  const third = Math.floor(deck.length / 3);
  const chunks = [deck.slice(0, third), deck.slice(third, 2 * third), deck.slice(2 * third)];
  chunks.forEach((ch, i) => ch.splice(Math.floor(rng() * (ch.length + 1)), 0, letters[i]));
  s.deck = chunks.flat();          // top of the deck is the END of the array
  s.turn = Math.floor(rng() * s.players.length);
  log(s, `Game started. ${pname(s, s.players[s.turn].id)} goes first.`);
  return s;
}

// ---------- what can this card do right now? ----------
// Returns a list of options: { key, as, mode, label, target }
// target: { type: 'none' } | { type: 'card', min, max, candidates } | { type: 'player', candidates }

const T_NONE = { type: 'none' };
const tCards = (candidates, min = 1, max = min) => ({ type: 'card', min, max, candidates });
const tPlayer = candidates => ({ type: 'player', candidates });

function optionsForType(s, pid, t) {
  const opp = others(s, pid);
  const o = [];
  const add = (mode, label, target) => {
    if (target.type !== 'none' && target.candidates.length < (target.min || 1)) return;
    o.push({ mode, label, target });
  };
  switch (t) {
    case 'gub': case 'esteemed_elder':
      add('play', 'Put into play', T_NONE); break;
    case 'mushroom':
      add('protect', 'Protect one of your Gubs', tCards(freeGubIds(s, p => p === pid)));
      add('destroy', 'Discard a Mushroom in play', tCards(topsWhere(s, c => typeOf(c) === 'mushroom')));
      break;
    case 'toad_rider':
      add('protect', 'Protect one of your Gubs', tCards(freeGubIds(s, p => p === pid)));
      add('destroy', 'Discard a Barricade in play', tCards(topsWhere(s, c => kindOf(c) === 'barricade')));
      break;
    case 'velvet_moth':
      add('protect', 'Protect one of your Gubs', tCards(freeGubIds(s, p => p === pid))); break;
    case 'sud_spout':
      add('trap', 'Trap a Free Gub', tCards(freeGubIds(s))); break;
    case 'single_ring': case 'double_ring': case 'triple_ring': {
      const n = CARDS[t].ring;
      add('trap', `Trap exactly ${n} Free Gub${n > 1 ? 's' : ''}`, tCards(freeGubIds(s), n)); break;
    }
    case 'lure':
      add('lure', "Lure an opponent's Free Gub", tCards(freeGubIds(s, p => p !== pid))); break;
    case 'super_lure':
      add('lure', "Lure all of a player's Free and Protected Gubs", tPlayer(opp.filter(p =>
        s.table[p].some(st => ['free', 'protected'].includes(stackStatus(st)) && !isElder(st.gubs[0])))));
      break;
    case 'cyclone':
      add('cyclone', "Destroy a player's Barricades", tPlayer(s.players.map(p => p.id).filter(p =>
        s.table[p].some(st => stackStatus(st) === 'protected'))));
      break;
    case 'lightning': {
      const elder = allStacks(s).map(x => x.st.gubs[0]).filter(isElder);
      add('smite', 'Smite the Esteemed Elder', tCards(elder));
      add('hand', 'Force an opponent to discard their hand', tPlayer(opp.filter(p => s.hands[p].length > 0)));
      break;
    }
    case 'omen_beetle':
      if (topsWhere(s, c => typeOf(c) === 'mushroom').length)
        add('beetle', 'Discard all Mushrooms and the Gubs behind them', T_NONE);
      break;
    case 'smahl_thief': {
      const c = [];
      for (const { pid: owner, st } of allStacks(s)) {
        const status = stackStatus(st);
        if (status === 'ring') continue;
        if (owner !== pid && !isElder(st.gubs[0])) c.push(st.gubs[0]);
        if (st.top) c.push(st.top);
      }
      add('steal', 'Steal a card in play into your hand', tCards(c)); break;
    }
    case 'spear':
      add('pop', 'Destroy a Sud Spout', tCards(topsWhere(s, c => typeOf(c) === 'sud_spout')));
      add('kill', 'Kill a Free Gub', tCards(freeGubIds(s)));
      break;
    case 'haki_flute':
      add('flute', 'Shatter a Ring and win its Gubs', tCards(topsWhere(s, c => !!CARDS[typeOf(c)].ring))); break;
    case 'retreat': {
      const mine = s.table[pid].flatMap(st => [...st.gubs, ...(st.top ? [st.top] : [])]);
      add('retreat', 'Take cards on your side back into your hand', tCards(mine, 1, mine.length)); break;
    }
    case 'scout':
      add('peek', "Look at an opponent's hand", tPlayer(opp.filter(p => s.hands[p].length > 0)));
      if (s.deck.length) add('deck', 'Rearrange the top three cards of the deck', T_NONE);
      break;
    case 'age_old_cure':
      if (s.discard.some(c => typeOf(c) === 'gub')) add('retrieve', 'Take a Gub from the discard pile', T_NONE);
      break;
    // feather, blindfold, flop_boat: only playable in response (see respond()).
  }
  return o;
}

export function getPlayOptions(s, pid, cardId) {
  const t = typeOf(cardId);
  const mk = (as, o) => ({ ...o, as, key: `${as}/${o.mode}` });
  if (t !== 'cricket_song') return optionsForType(s, pid, t).map(o => mk(t, o));
  return WILD_TYPES.flatMap(as => optionsForType(s, pid, as)
    .map(o => mk(as, { ...o, label: `As ${CARDS[as].name}: ${o.label}` })));
}

// Is the effect something Feather / Blindfold can cancel?
function cancellers(as, mode) {
  const k = CARDS[as].kind;
  const hazardous = k === 'hazard' || k === 'trap' || (as === 'spear' && mode === 'kill');
  if (!hazardous) return [];
  const c = ['feather', 'cricket_song'];
  if (as === 'lure' || as === 'super_lure') c.push('blindfold');
  return c;
}

// Which cards in this player's hand answer the current prompt?
export function responseCards(s, pid) {
  const p = s.pending;
  if (!p || !p.waiting.includes(pid)) return [];
  let types = [];
  if (p.kind === 'window') types = cancellers(p.as, p.mode);
  else if (p.kind === 'event' && p.stage === 'flop') types = ['flop_boat', 'cricket_song'];
  else if (p.kind === 'event' && p.stage === 'cure') types = ['age_old_cure', 'cricket_song'];
  return s.hands[pid].filter(c => types.includes(typeOf(c)));
}

export function mustDraw(s, pid) {
  return !s.drew && !s.played && s.skipped[pid] && s.deck.length > 0;
}

// ---------- actions ----------

export function applyAction(state, pid, action) {
  const s = clone(state);
  try {
    if (s.phase !== 'playing') fail('The game is over.');
    if (action.type === 'dismissReveal') {
      if (s.reveal && s.reveal.to === pid) s.reveal = null;
      return { state: s };
    }
    if (s.pending) {
      if (!s.pending.waiting.includes(pid)) fail('Waiting for another player.');
      respond(s, pid, action);
    } else {
      if (s.players[s.turn].id !== pid) fail('It is not your turn.');
      if (action.type === 'draw') draw(s, pid);
      else if (action.type === 'play') play(s, pid, action);
      else if (action.type === 'endTurn') endTurn(s, pid, action);
      else fail('Unknown action.');
    }
    return { state: s };
  } catch (e) {
    if (e.rule) return { error: e.message };
    throw e;
  }
}

function draw(s, pid) {
  if (s.drew) fail('You have already drawn this turn.');
  if (s.played) fail('You cannot draw after playing cards.');
  if (!s.deck.length) fail('The deck is empty.');
  const c = s.deck.pop();
  s.drew = true;
  // `open` draws (Events and Letters) are shown to everyone; others only to the drawer.
  s.lastDraw = { n: (s.lastDraw ? s.lastDraw.n : 0) + 1, by: pid, card: c, open: isEvent(c) };
  if (!isEvent(c)) { s.hands[pid].push(c); log(s, `${pname(s, pid)} draws a card.`); return; }
  log(s, `${pname(s, pid)} draws ${kindOf(c) === 'letter' ? 'the ' : 'an Event: '}${nameOf(c)}!`);
  s.pending = {
    kind: 'event', stage: 'flop', card: c, by: pid,
    waiting: s.players.map(p => p.id).filter(p => hasType(s, p, ['flop_boat', 'cricket_song'])),
  };
  advance(s);
}

function play(s, pid, a) {
  if (mustDraw(s, pid)) fail('You skipped your draw last turn, so you must draw first.');
  if (!s.hands[pid].includes(a.card)) fail('That card is not in your hand.');
  const opt = getPlayOptions(s, pid, a.card).find(o => o.key === `${a.as}/${a.mode}`);
  if (!opt) fail('That card cannot be played that way right now.');
  const targets = a.targets || [];
  const t = opt.target;
  if (t.type === 'none') { if (targets.length) fail('That play takes no target.'); }
  else {
    const min = t.type === 'player' ? 1 : t.min, max = t.type === 'player' ? 1 : t.max;
    if (targets.length < min || targets.length > max || new Set(targets).size !== targets.length)
      fail('Wrong number of targets.');
    if (!targets.every(x => t.candidates.includes(x))) fail('That is not a valid target.');
  }
  s.hands[pid] = s.hands[pid].filter(c => c !== a.card);
  s.played = true;
  const wild = typeOf(a.card) === 'cricket_song' ? ' (Cricket Song)' : '';
  const eff = { by: pid, card: a.card, as: a.as, mode: a.mode, targets };
  const cancelTypes = cancellers(a.as, a.mode);
  if (cancelTypes.length) {
    log(s, `${pname(s, pid)} plays ${CARDS[a.as].name}${wild}${describeTargets(s, eff)}.`);
    s.pending = { kind: 'window', ...eff, waiting: others(s, pid).filter(p => hasType(s, p, cancelTypes)) };
    advance(s);
  } else {
    log(s, `${pname(s, pid)} plays ${CARDS[a.as].name}${wild}${describeTargets(s, eff)}.`);
    resolve(s, eff);
  }
}

function describeTargets(s, eff) {
  const t = eff.targets;
  if (!t.length) return '';
  if (s.hands[t[0]] !== undefined) return ` on ${pname(s, t[0])}`;
  if (eff.as === 'retreat') return '';
  const owners = [...new Set(t.map(c => (locate(s, c) || {}).pid).filter(Boolean))].map(p => pname(s, p));
  return ` on ${t.map(nameOf).join(', ')} (${owners.join(', ')})`;
}

function endTurn(s, pid, a) {
  if (mustDraw(s, pid)) fail('You skipped your draw last turn, so you must draw first.');
  const discards = a.discards || [];
  const hand = s.hands[pid];
  const over = Math.max(0, hand.length - HAND_LIMIT);
  if (discards.length !== over) fail(over ? `Discard exactly ${over} card${over > 1 ? 's' : ''}.` : 'You may only discard down to eight.');
  if (new Set(discards).size !== discards.length || !discards.every(c => hand.includes(c))) fail('Bad discard.');
  s.hands[pid] = hand.filter(c => !discards.includes(c));
  s.discard.push(...discards);
  if (over) log(s, `${pname(s, pid)} discards ${over}.`);
  s.skipped[pid] = !s.drew;
  s.turn = (s.turn + 1) % s.players.length;
  s.drew = false; s.played = false;
  log(s, `${pname(s, s.players[s.turn].id)}'s turn.`);
}

function respond(s, pid, a) {
  const p = s.pending;
  if (p.kind === 'merchant') {
    if (a.type !== 'keep' || !s.hands[pid].includes(a.card)) fail('Choose one card from your hand to keep.');
    p.keep[pid] = a.card;
  } else if (p.kind === 'rearrange') {
    const o = a.order || [];
    if (a.type !== 'rearrange' || o.length !== p.cards.length || !p.cards.every(c => o.includes(c)))
      fail('Put all of the shown cards in order.');
    s.deck.splice(s.deck.length - o.length, o.length, ...[...o].reverse());   // o[0] becomes the top
    log(s, `${pname(s, pid)} rearranges the top of the deck.`);
  } else {
    if (a.type !== 'respond') fail('Respond to the card in play first.');
    if (a.card) {
      if (!responseCards(s, pid).includes(a.card)) fail('That card cannot be played now.');
      s.hands[pid] = s.hands[pid].filter(c => c !== a.card);
      s.discard.push(a.card);
      const what = typeOf(a.card) === 'cricket_song' ? 'Cricket Song' : nameOf(a.card);
      if (p.kind === 'window') {
        log(s, `${pname(s, pid)} cancels it with ${what}!`);
        s.discard.push(p.card);
        s.pending = null;
        return;
      }
      if (p.stage === 'flop') {
        log(s, `${pname(s, pid)} plays ${what}: ${nameOf(p.card)} is shuffled back into the deck.`);
        s.deck.push(p.card); shuffle(s.deck, Math.random);
        s.pending = null;
        return;
      }
      p.cured[pid] = true;               // Gargok Plague, cure stage
      log(s, `${pname(s, pid)} plays ${what} and keeps their hand.`);
    }
  }
  p.waiting = p.waiting.filter(x => x !== pid);
  advance(s);
}

// Move a pending prompt forward once nobody is left to answer it.
function advance(s) {
  while (s.pending && s.pending.waiting.length === 0) {
    const p = s.pending;
    if (p.kind === 'window') { s.pending = null; resolve(s, p); }
    else if (p.kind === 'rearrange') { s.pending = null; }
    else if (p.kind === 'merchant') { s.pending = null; finishMerchant(s, p); }
    else if (p.stage === 'flop') { applyEvent(s, p); }
    else { s.pending = null; finishPlague(s, p); }
  }
}

// ---------- events ----------

function applyEvent(s, p) {
  const c = p.card, t = typeOf(c), ids = s.players.map(x => x.id);
  if (kindOf(c) === 'letter') {
    s.pending = null;
    s.letters.push(c);
    if (s.letters.length >= 3) return endGame(s);
    log(s, `${3 - s.letters.length} Letter${s.letters.length === 2 ? '' : 's'} left before the game ends.`);
    return;
  }
  if (t === 'gargok_plague') {
    p.stage = 'cure'; p.cured = {};
    p.waiting = ids.filter(x => hasType(s, x, ['age_old_cure', 'cricket_song']));
    return;
  }
  if (t === 'traveling_merchant') {
    s.pending = { kind: 'merchant', card: c, by: p.by, keep: {}, waiting: ids.filter(x => s.hands[x].length >= 2) };
    return;
  }
  s.pending = null;
  s.discard.push(c);
  if (t === 'flash_flood') {
    let n = 0;
    for (const { pid, st } of allStacks(s)) {
      if (stackStatus(st) === 'free' && !isElder(st.gubs[0])) { s.deck.push(...st.gubs); removeStack(s, pid, st); n++; }
    }
    shuffle(s.deck, Math.random);
    log(s, `Flash Flood washes ${n} Free Gub${n === 1 ? '' : 's'} back into the deck.`);
  } else if (t === 'rumor_of_wasps') {
    let n = 0;
    for (const { pid, st } of allStacks(s)) {
      if (st.top && typeOf(st.top) === 'toad_rider') { s.deck.push(st.top, ...st.gubs); removeStack(s, pid, st); n++; }
    }
    shuffle(s.deck, Math.random);
    log(s, `Rumor of Wasps: ${n} Toad Rider${n === 1 ? '' : 's'} ride off into the deck.`);
  } else if (t === 'dangerous_alchemy') {
    for (const st of [...s.table[p.by]]) {
      if (isElder(st.gubs[0])) continue;
      s.discard.push(...st.gubs, ...(st.top ? [st.top] : []));
      removeStack(s, p.by, st);
    }
    log(s, `Dangerous Alchemy destroys everything on ${pname(s, p.by)}'s side.`);
  }
}

function finishPlague(s, p) {
  for (const pl of s.players) {
    if (p.cured[pl.id]) continue;
    s.deck.push(...s.hands[pl.id]);
    s.hands[pl.id] = [];
  }
  shuffle(s.deck, Math.random);
  s.discard.push(p.card);
  log(s, 'Gargok Plague: uncured hands are shuffled into the deck.');
}

function finishMerchant(s, p) {
  const n = s.players.length, pass = {};
  for (const pl of s.players) {
    const h = s.hands[pl.id];
    const keep = p.keep[pl.id] || h[0];          // 0 or 1 cards: nothing to choose
    pass[pl.id] = h.filter(c => c !== keep);
    s.hands[pl.id] = keep ? [keep] : [];
  }
  // Turn order is clockwise (to the left), so "to the right" is the previous seat.
  s.players.forEach((pl, i) => {
    const right = s.players[(i - 1 + n) % n].id;
    s.hands[right].push(...pass[pl.id]);
  });
  s.discard.push(p.card);
  log(s, 'Traveling Merchant: everyone keeps one card and passes the rest to the right.');
}

// ---------- card effects ----------

function freeTop(s, st) { const c = st.top; st.top = null; return c; }

function resolve(s, e) {
  const { by, as, mode, targets } = e;
  let keepInPlay = false;
  const loc = c => locate(s, c);
  const toSide = (pid, gubs) => gubs.forEach(g => s.table[pid].push(newStack(s, [g])));

  switch (`${as}/${mode}`) {
    case 'gub/play': case 'esteemed_elder/play':
      s.table[by].push(newStack(s, [e.card])); keepInPlay = true; break;

    case 'mushroom/protect': case 'toad_rider/protect': case 'velvet_moth/protect':
      loc(targets[0]).st.top = e.card; keepInPlay = true; break;

    case 'mushroom/destroy': case 'toad_rider/destroy':
      s.discard.push(freeTop(s, loc(targets[0]).st)); break;

    case 'sud_spout/trap':
      loc(targets[0]).st.top = e.card; keepInPlay = true; break;

    case 'single_ring/trap': case 'double_ring/trap': case 'triple_ring/trap': {
      for (const g of targets) { const l = loc(g); removeStack(s, l.pid, l.st); }
      s.table[by].push(newStack(s, [...targets], e.card)); keepInPlay = true; break;
    }

    case 'lure/lure': {
      const l = loc(targets[0]); removeStack(s, l.pid, l.st); toSide(by, l.st.gubs); break;
    }
    case 'super_lure/lure': {
      const victim = targets[0];
      for (const st of [...s.table[victim]]) {
        const status = stackStatus(st);
        if (!['free', 'protected'].includes(status) || isElder(st.gubs[0])) continue;
        if (st.top) s.hands[victim].push(st.top);        // abandoned Barricade returns to hand
        removeStack(s, victim, st); toSide(by, st.gubs);
      }
      break;
    }
    case 'cyclone/cyclone':
      for (const st of s.table[targets[0]]) if (stackStatus(st) === 'protected') s.discard.push(freeTop(s, st));
      break;

    case 'lightning/smite': {
      const l = loc(targets[0]); removeStack(s, l.pid, l.st); s.discard.push(...l.st.gubs); break;
    }
    case 'lightning/hand':
      s.discard.push(...s.hands[targets[0]]); s.hands[targets[0]] = []; break;

    case 'omen_beetle/beetle':
      for (const { pid, st } of allStacks(s)) {
        if (st.top && typeOf(st.top) === 'mushroom') { s.discard.push(st.top, ...st.gubs); removeStack(s, pid, st); }
      }
      break;

    case 'smahl_thief/steal': {
      const l = loc(targets[0]);
      if (l.role === 'top') {                 // a Barricade or Sud Spout: into the thief's hand
        s.hands[by].push(freeTop(s, l.st));
      } else {                                // a Gub: also into the thief's hand (Card Guide)
        if (l.st.top) {                       // abandoned Barricade -> owner's hand; Sud Spout -> discard
          const top = freeTop(s, l.st);
          if (kindOf(top) === 'barricade') s.hands[l.pid].push(top); else s.discard.push(top);
        }
        removeStack(s, l.pid, l.st); s.hands[by].push(...l.st.gubs);
      }
      break;
    }
    case 'spear/pop':
      s.discard.push(freeTop(s, loc(targets[0]).st)); break;
    case 'spear/kill': {
      const l = loc(targets[0]); removeStack(s, l.pid, l.st); s.discard.push(...l.st.gubs); break;
    }
    case 'haki_flute/flute': {
      const l = loc(targets[0]); removeStack(s, l.pid, l.st);
      s.discard.push(l.st.top); toSide(by, l.st.gubs); break;
    }
    case 'retreat/retreat': {
      const stacks = [...new Set(targets.map(c => loc(c).st))];
      for (const st of stacks) {
        s.hands[by].push(...st.gubs, ...(st.top ? [st.top] : []));
        removeStack(s, by, st);
      }
      break;
    }
    case 'scout/peek':
      s.reveal = { to: by, of: targets[0], cards: [...s.hands[targets[0]]] }; break;
    case 'scout/deck':
      s.pending = { kind: 'rearrange', by, cards: s.deck.slice(-3).reverse(), waiting: [by] }; break;

    case 'age_old_cure/retrieve': {
      const i = s.discard.findIndex(c => typeOf(c) === 'gub');
      s.hands[by].push(s.discard.splice(i, 1)[0]); break;
    }
    default: throw new Error('No effect for ' + as + '/' + mode);
  }
  if (!keepInPlay) s.discard.push(e.card);
}

// ---------- end of game ----------

function endGame(s) {
  s.phase = 'ended';
  const scores = {};
  for (const p of s.players) scores[p.id] = score(s, p.id);
  const best = Math.max(...Object.values(scores));
  let winners = s.players.map(p => p.id).filter(p => scores[p] === best);
  let reason = 'most Free and Protected Gubs';
  if (winners.length > 1) {
    const elder = winners.filter(p => s.table[p].some(st => isElder(st.gubs[0])));
    if (elder.length) { winners = elder; reason = 'tie broken by the Esteemed Elder'; }
    else {
      const fewest = Math.min(...winners.map(p => s.hands[p].length));
      const w = winners.filter(p => s.hands[p].length === fewest);
      reason = w.length === 1 ? 'tie broken by fewest cards in hand' : 'a shared win';
      winners = w;
    }
  }
  s.result = { scores, winners, reason };
  log(s, `The third Letter is drawn. ${winners.map(p => pname(s, p)).join(' and ')} win${winners.length > 1 ? '' : 's'}!`);
}
