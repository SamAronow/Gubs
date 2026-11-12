// Run with: node tests/engine.test.mjs
import assert from 'node:assert/strict';
import { CARDS, typeOf, kindOf, isElder } from '../js/cards.js';
import { newGame, applyAction, getPlayOptions, responseCards, stackStatus, score, mustDraw } from '../js/engine.js';

const TOTAL = Object.values(CARDS).reduce((n, c) => n + c.count, 0);
assert.equal(TOTAL, 70, 'deck should be 70 cards');

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function allCards(s) {
  const out = [...s.deck, ...s.discard, ...s.letters];
  for (const p of s.players) {
    out.push(...s.hands[p.id]);
    for (const st of s.table[p.id]) out.push(...st.gubs, ...(st.top ? [st.top] : []));
  }
  if (s.pending && s.pending.card) out.push(s.pending.card);
  return out;
}
function checkInvariants(s) {
  const cards = allCards(s);
  assert.equal(cards.length, TOTAL, 'card count conserved');
  assert.equal(new Set(cards).size, TOTAL, 'no duplicate cards');
  for (const p of s.players) for (const st of s.table[p.id]) {
    assert.ok(st.gubs.length >= 1, 'no empty stacks');
    assert.ok(st.gubs.every(g => kindOf(g) === 'gub'));
    const status = stackStatus(st);
    if (status === 'ring') assert.equal(st.gubs.length, CARDS[typeOf(st.top)].ring);
    else assert.equal(st.gubs.length, 1);
    if (st.gubs.some(isElder)) assert.equal(st.top, null, 'Elder is never covered');
  }
}
const P = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const ok = (s, pid, a) => { const r = applyAction(s, pid, a); assert.ok(!r.error, r.error); checkInvariants(r.state); return r.state; };
const bad = (s, pid, a) => { const r = applyAction(s, pid, a); assert.ok(r.error, 'expected a rules error'); };

// Build a controlled position: move named card types into a player's hand / onto the table.
function take(s, type) {
  for (const pile of [s.deck, s.discard, ...Object.values(s.hands)]) {
    const i = pile.findIndex(c => typeOf(c) === type);
    if (i >= 0) return pile.splice(i, 1)[0];
  }
  throw new Error('no ' + type + ' available');
}
function setup(n = 2) {
  const s = newGame(P(n), rng(7));
  s.turn = 0;
  for (const p of s.players) { s.deck.push(...s.hands[p.id]); s.hands[p.id] = []; }
  return s;
}
const give = (s, pid, ...types) => types.map(t => { const c = take(s, t); s.hands[pid].push(c); return c; });
const putGub = (s, pid, top) => { const st = { id: 's' + (s.seq++), gubs: [take(s, 'gub')], top: top ? take(s, top) : null }; s.table[pid].push(st); return st; };
const play = (s, pid, card, as, mode, targets = []) => ok(s, pid, { type: 'play', card, as, mode, targets });
const pass = (s, pid) => ok(s, pid, { type: 'respond' });

// ---- setup ----
{
  for (let n = 2; n <= 6; n++) {
    const s = newGame(P(n), rng(n));
    checkInvariants(s);
    for (const p of s.players) {
      assert.equal(s.hands[p.id].length, 3);
      assert.ok(s.hands[p.id].every(c => !['event', 'letter'].includes(kindOf(c))), 'no Events dealt');
      assert.equal(s.table[p.id].length, 1);
      assert.equal(typeOf(s.table[p.id][0].gubs[0]), 'gub');
    }
    const third = Math.floor((s.deck.length - 3) / 3);
    const pos = s.deck.map((c, i) => kindOf(c) === 'letter' ? i : -1).filter(i => i >= 0);
    assert.equal(pos.length, 3);
    assert.ok(pos[0] <= third && pos[2] >= 2 * third, 'letters spread through the deck');
  }
}

// ---- turn structure ----
{
  let s = setup();
  const [g] = give(s, 'p0', 'gub');
  bad(s, 'p1', { type: 'draw' });
  s = play(s, 'p0', g, 'gub', 'play');
  bad(s, 'p0', { type: 'draw' });                       // cannot draw after playing
  s = ok(s, 'p0', { type: 'endTurn' });
  assert.equal(s.skipped.p0, true);
  s = ok(s, 'p1', { type: 'endTurn' });
  assert.ok(mustDraw(s, 'p0'));
  bad(s, 'p0', { type: 'endTurn' });                    // cannot skip twice in a row
}
{
  let s = setup();
  give(s, 'p0', 'gub', 'gub', 'lure', 'lure', 'lure', 'lure', 'lure', 'mushroom', 'mushroom', 'mushroom');
  bad(s, 'p0', { type: 'endTurn' });
  bad(s, 'p0', { type: 'endTurn', discards: [s.hands.p0[0]] });
  s = ok(s, 'p0', { type: 'endTurn', discards: s.hands.p0.slice(0, 2) });
  assert.equal(s.hands.p0.length, 8);
  const [extra] = give(s, 'p1', 'gub');
  bad(s, 'p1', { type: 'endTurn', discards: [extra] });          // may only discard down to eight
}

// ---- barricades ----
{
  let s = setup();
  const [m, m2, toad] = give(s, 'p0', 'mushroom', 'mushroom', 'toad_rider');
  const mine = s.table.p0[0].gubs[0];
  s = play(s, 'p0', m, 'mushroom', 'protect', [mine]);
  assert.equal(stackStatus(s.table.p0[0]), 'protected');
  const theirs = putGub(s, 'p1', 'velvet_moth');
  bad(s, 'p0', { type: 'play', card: m2, as: 'mushroom', mode: 'destroy', targets: [theirs.top] });  // moth is not a Mushroom
  s = play(s, 'p0', toad, 'toad_rider', 'destroy', [theirs.top]);
  assert.equal(stackStatus(s.table.p1.at(-1)), 'free');
  s = play(s, 'p0', m2, 'mushroom', 'destroy', [m]);
  assert.equal(stackStatus(s.table.p0[0]), 'free');
}

// ---- lure, feather, blindfold, protection ----
{
  let s = setup();
  const [l1, l2, l3] = give(s, 'p0', 'lure', 'lure', 'lure');
  const prot = putGub(s, 'p1', 'mushroom');
  const free = s.table.p1[0].gubs[0];
  assert.ok(!getPlayOptions(s, 'p0', l1)[0].target.candidates.includes(prot.gubs[0]));
  s = play(s, 'p0', l1, 'lure', 'lure', [free]);            // nobody can respond: resolves at once
  assert.equal(s.pending, null);
  assert.equal(s.table.p0.length, 2);
  // Feather
  const g2 = putGub(s, 'p1').gubs[0];
  const [f] = give(s, 'p1', 'feather');
  s = play(s, 'p0', l2, 'lure', 'lure', [g2]);
  assert.deepEqual(s.pending.waiting, ['p1']);
  bad(s, 'p0', { type: 'endTurn' });
  s = ok(s, 'p1', { type: 'respond', card: f });
  assert.equal(s.table.p0.length, 2);
  assert.ok(s.discard.includes(l2) && s.discard.includes(f));
  // Blindfold, then a pass
  const [b] = give(s, 'p1', 'blindfold');
  s = play(s, 'p0', l3, 'lure', 'lure', [g2]);
  assert.deepEqual(responseCards(s, 'p1'), [b]);
  s = pass(s, 'p1');
  assert.equal(s.table.p0.length, 3);
}

// ---- blindfold does not stop a Spear; Elder immunity ----
{
  let s = setup();
  const [sp, lu] = give(s, 'p0', 'spear', 'lure');
  give(s, 'p1', 'blindfold');
  const elder = take(s, 'esteemed_elder');
  s.table.p1.push({ id: 'sE', gubs: [elder], top: null });
  for (const c of [sp, lu]) for (const o of getPlayOptions(s, 'p0', c))
    if (o.target.type === 'card') assert.ok(!o.target.candidates.includes(elder), 'Elder is immune');
  s = play(s, 'p0', sp, 'spear', 'kill', [s.table.p1[0].gubs[0]]);
  assert.equal(s.pending, null);
  assert.equal(score(s, 'p1'), 1);                          // only the Elder left
}

// ---- super lure ----
{
  let s = setup();
  const [sl] = give(s, 'p0', 'super_lure');
  const a = putGub(s, 'p1', 'toad_rider'); putGub(s, 'p1', 'sud_spout');
  s.table.p1.push({ id: 'sE', gubs: [take(s, 'esteemed_elder')], top: null });
  s = play(s, 'p0', sl, 'super_lure', 'lure', ['p1']);
  assert.equal(score(s, 'p0'), 3);                          // own + free + protected
  assert.ok(s.hands.p1.includes(a.top), 'abandoned Barricade returns to hand');
  assert.equal(s.table.p1.length, 2);                       // sud-trapped Gub and Elder stay
  assert.equal(score(s, 'p1'), 1);
}

// ---- traps: sud spout, spear, rings, haki flute ----
{
  let s = setup();
  const [sud, sp, ring, flute] = give(s, 'p0', 'sud_spout', 'spear', 'double_ring', 'haki_flute');
  const theirs = s.table.p1[0].gubs[0];
  s = play(s, 'p0', sud, 'sud_spout', 'trap', [theirs]);
  assert.equal(score(s, 'p1'), 0);
  assert.equal(s.table.p1.length, 1, 'Sud Spout leaves the Gub where it is');
  s = play(s, 'p0', sp, 'spear', 'pop', [sud]);
  assert.equal(score(s, 'p1'), 1);
  bad(s, 'p0', { type: 'play', card: ring, as: 'double_ring', mode: 'trap', targets: [theirs] });   // exactly two
  s = play(s, 'p0', ring, 'double_ring', 'trap', [theirs, s.table.p0[0].gubs[0]]);
  assert.equal(score(s, 'p0'), 0); assert.equal(s.table.p1.length, 0);
  assert.equal(stackStatus(s.table.p0[0]), 'ring');
  s = ok(s, 'p0', { type: 'endTurn' });
  const [fl2] = give(s, 'p1', 'haki_flute');
  s = play(s, 'p1', fl2, 'haki_flute', 'flute', [ring]);
  assert.equal(score(s, 'p1'), 2, 'Ring Gubs go to whoever shatters it');
  assert.ok(s.discard.includes(ring));
  assert.equal(getPlayOptions(s, 'p0', flute).length, 0);
}

// ---- cyclone, omen beetle, lightning ----
{
  let s = setup();
  const [cy, ob, li, li2] = give(s, 'p0', 'cyclone', 'omen_beetle', 'lightning', 'cricket_song');
  putGub(s, 'p1', 'mushroom'); putGub(s, 'p1', 'toad_rider'); putGub(s, 'p0', 'mushroom');
  s = play(s, 'p0', ob, 'omen_beetle', 'beetle');
  assert.equal(s.table.p1.length, 2); assert.equal(s.table.p0.length, 1);
  s = play(s, 'p0', cy, 'cyclone', 'cyclone', ['p1']);
  assert.ok(s.table.p1.every(st => stackStatus(st) === 'free'));
  const elder = take(s, 'esteemed_elder');
  s.table.p1.push({ id: 'sE', gubs: [elder], top: null });
  give(s, 'p1', 'gub', 'gub');
  s = play(s, 'p0', li, 'lightning', 'hand', ['p1']);
  assert.equal(s.hands.p1.length, 0);
  s = play(s, 'p0', li2, 'lightning', 'smite', [elder]);     // Cricket Song as Lightning
  assert.ok(s.discard.includes(elder) && s.discard.includes(li2));
}

// ---- smahl thief ----
{
  let s = setup();
  const [t1] = give(s, 'p0', 'smahl_thief');
  const st = putGub(s, 'p1', 'sud_spout');
  s = play(s, 'p0', t1, 'smahl_thief', 'steal', [st.gubs[0]]);
  assert.equal(score(s, 'p0'), 2);
  assert.ok(s.discard.includes(st.top), 'Sud Spout is discarded when its Gub is stolen');
}
{
  let s = setup();
  const [t1] = give(s, 'p0', 'smahl_thief');
  const st = putGub(s, 'p1', 'mushroom');
  const ring = take(s, 'single_ring'); const rg = take(s, 'gub');
  s.table.p1.push({ id: 'sR', gubs: [rg], top: ring });
  const c = getPlayOptions(s, 'p0', t1)[0].target.candidates;
  assert.ok(!c.includes(ring) && !c.includes(rg), 'Rings and their Gubs cannot be stolen');
  s = play(s, 'p0', t1, 'smahl_thief', 'steal', [st.top]);
  assert.ok(s.hands.p0.includes(st.top));
  assert.equal(stackStatus(s.table.p1[1]), 'free');
}

// ---- retreat, scout, age-old cure ----
{
  let s = setup();
  const [re, sc, sc2, cure] = give(s, 'p0', 'retreat', 'scout', 'scout', 'age_old_cure');
  const sud = take(s, 'sud_spout'); s.table.p0[0].top = sud;
  const g = s.table.p0[0].gubs[0];
  s = play(s, 'p0', re, 'retreat', 'retreat', [g]);
  assert.ok(s.hands.p0.includes(g) && s.hands.p0.includes(sud));
  give(s, 'p1', 'lure', 'mushroom');
  s = play(s, 'p0', sc, 'scout', 'peek', ['p1']);
  assert.equal(s.reveal.cards.length, 2);
  s = ok(s, 'p0', { type: 'dismissReveal' });
  assert.equal(s.reveal, null);
  s = play(s, 'p0', sc2, 'scout', 'deck');
  const top3 = s.pending.cards;
  assert.deepEqual(top3, s.deck.slice(-3).reverse());
  s = ok(s, 'p0', { type: 'rearrange', order: [top3[2], top3[0], top3[1]] });
  assert.equal(s.deck.at(-1), top3[2]); assert.equal(s.deck.at(-2), top3[0]);
  assert.equal(getPlayOptions(s, 'p0', cure).length, 0);
  s.discard.push(take(s, 'gub'), take(s, 'esteemed_elder'));
  s = play(s, 'p0', cure, 'age_old_cure', 'retrieve');
  assert.equal(typeOf(s.hands.p0.at(-1)), 'gub');
  assert.ok(s.discard.some(isElder), 'Elder cannot be retrieved');
}

// ---- events ----
const drawEvent = (s, pid, type) => { s.deck.push(take(s, type)); return ok(s, pid, { type: 'draw' }); };
{
  let s = setup(3);                                         // flash flood
  putGub(s, 'p1', 'mushroom');
  s.table.p2.push({ id: 'sE', gubs: [take(s, 'esteemed_elder')], top: null });
  s = drawEvent(s, 'p0', 'flash_flood');
  assert.equal(s.table.p0.length, 0); assert.equal(s.table.p1.length, 1); assert.equal(s.table.p2.length, 1);
}
{
  let s = setup();                                          // flop boat
  const [fb] = give(s, 'p1', 'flop_boat');
  s = drawEvent(s, 'p0', 'flash_flood');
  assert.deepEqual(s.pending.waiting, ['p1']);
  s = ok(s, 'p1', { type: 'respond', card: fb });
  assert.equal(s.table.p0.length, 1);
  assert.ok(s.deck.some(c => typeOf(c) === 'flash_flood'));
  bad(s, 'p0', { type: 'draw' });                           // already drew this turn
}
{
  let s = setup(3);                                         // gargok plague + cure
  const [cure] = give(s, 'p1', 'age_old_cure', 'gub');
  give(s, 'p0', 'gub'); give(s, 'p2', 'gub', 'lure');
  s = drawEvent(s, 'p0', 'gargok_plague');
  assert.deepEqual(s.pending.waiting, ['p1']);
  s = ok(s, 'p1', { type: 'respond', card: cure });
  assert.equal(s.hands.p0.length, 0); assert.equal(s.hands.p2.length, 0); assert.equal(s.hands.p1.length, 1);
}
{
  let s = setup();                                          // dangerous alchemy
  putGub(s, 'p0', 'mushroom');
  s.table.p0.push({ id: 'sE', gubs: [take(s, 'esteemed_elder')], top: null });
  s = drawEvent(s, 'p0', 'dangerous_alchemy');
  assert.equal(s.table.p0.length, 1); assert.ok(isElder(s.table.p0[0].gubs[0]));
  assert.equal(s.table.p1.length, 1);
}
{
  let s = setup();                                          // rumor of wasps
  putGub(s, 'p0', 'toad_rider'); putGub(s, 'p1', 'mushroom');
  s = drawEvent(s, 'p1'.replace('1', '0'), 'rumor_of_wasps');
  assert.equal(s.table.p0.length, 1); assert.equal(s.table.p1.length, 2);
}
{
  let s = setup(3);                                         // traveling merchant
  const h0 = give(s, 'p0', 'gub', 'lure', 'mushroom');
  const h1 = give(s, 'p1', 'spear');
  const h2 = give(s, 'p2', 'cyclone', 'scout');
  s = drawEvent(s, 'p0', 'traveling_merchant');
  assert.deepEqual(s.pending.waiting, ['p0', 'p2']);
  s = ok(s, 'p0', { type: 'keep', card: h0[0] });
  s = ok(s, 'p2', { type: 'keep', card: h2[1] });
  assert.deepEqual(s.hands.p0, [h0[0]]);                    // p1 (on p0's left) had nothing to pass
  assert.deepEqual(s.hands.p1, [h1[0], h2[0]]);             // from p2
  assert.deepEqual(s.hands.p2, [h2[1], h0[1], h0[2]]);      // from p0, whose right-hand neighbour is p2
}

// ---- end of game and tie-breaks ----
{
  let s = setup();
  s = drawEvent(s, 'p0', 'G'); s = ok(s, 'p0', { type: 'endTurn' });
  s = drawEvent(s, 'p1', 'U'); s = ok(s, 'p1', { type: 'endTurn' });
  give(s, 'p1', 'lure');
  s = drawEvent(s, 'p0', 'B');
  assert.equal(s.phase, 'ended');
  assert.deepEqual(s.result.winners, ['p0'], 'fewest cards in hand breaks the tie');
  bad(s, 'p0', { type: 'endTurn' });
}
{
  let s = setup();
  s.letters.push(take(s, 'G'), take(s, 'U'));
  putGub(s, 'p0');
  s.table.p1.push({ id: 'sE', gubs: [take(s, 'esteemed_elder')], top: null });
  const [fb] = give(s, 'p0', 'flop_boat');
  s = drawEvent(s, 'p0', 'B');
  s = ok(s, 'p0', { type: 'respond', card: fb });           // Flop Boat saves the game from ending
  assert.equal(s.phase, 'playing');
  s = ok(s, 'p0', { type: 'endTurn' });
  s = drawEvent(s, 'p1', 'B');
  assert.deepEqual(s.result.winners, ['p1'], 'Elder breaks the tie');
}

// ---- random full games: every legal move keeps the state consistent ----
function randomGame(seed, n) {
  const r = rng(seed);
  const pick = a => a[Math.floor(r() * a.length)];
  let s = newGame(P(n), r);
  let steps = 0;
  const seen = new Set();
  while (s.phase === 'playing') {
    assert.ok(++steps < 5000, 'game should finish');
    if (s.reveal) s = ok(s, s.reveal.to, { type: 'dismissReveal' });
    if (s.pending) {
      const pid = s.pending.waiting[0], p = s.pending;
      if (p.kind === 'merchant') s = ok(s, pid, { type: 'keep', card: pick(s.hands[pid]) });
      else if (p.kind === 'rearrange') s = ok(s, pid, { type: 'rearrange', order: [...p.cards].sort(() => r() - 0.5) });
      else { const rc = responseCards(s, pid); s = ok(s, pid, { type: 'respond', card: rc.length && r() < 0.5 ? pick(rc) : undefined }); }
      continue;
    }
    const pid = s.players[s.turn].id;
    if (!s.drew && !s.played && s.deck.length && (mustDraw(s, pid) || r() < 0.85)) { s = ok(s, pid, { type: 'draw' }); continue; }
    const plays = s.hands[pid].flatMap(c => getPlayOptions(s, pid, c).map(o => ({ c, o })));
    if (plays.length && r() < 0.6) {
      const { c, o } = pick(plays);
      let targets = [];
      if (o.target.type === 'player') targets = [pick(o.target.candidates)];
      if (o.target.type === 'card') {
        const k = o.target.min + Math.floor(r() * (o.target.max - o.target.min + 1));
        targets = [...o.target.candidates].sort(() => r() - 0.5).slice(0, k);
      }
      seen.add(o.key);
      s = ok(s, pid, { type: 'play', card: c, as: o.as, mode: o.mode, targets });
      continue;
    }
    const over = Math.max(0, s.hands[pid].length - 8);
    s = ok(s, pid, { type: 'endTurn', discards: s.hands[pid].slice(0, over) });
  }
  assert.equal(s.letters.length, 3);
  assert.ok(s.result.winners.length >= 1);
  return seen;
}
const covered = new Set();
for (let seed = 1; seed <= 400; seed++) for (const k of randomGame(seed, 2 + seed % 5)) covered.add(k);
console.log(`random games ok; ${covered.size} distinct plays exercised`);
for (const k of ['lure/lure', 'super_lure/lure', 'smahl_thief/steal', 'retreat/retreat', 'triple_ring/trap', 'haki_flute/flute', 'scout/deck', 'age_old_cure/retrieve', 'spear/pop'])
  assert.ok(covered.has(k), 'random play never tried ' + k);

console.log('all engine tests passed');
