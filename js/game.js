/* ==================================================================
   game.js — the Gubs table.

   Every client renders the same room node from Firebase. Only one
   client ever writes at a time: the player whose turn it is, or the
   player who opened an interrupt window (they own resolving it).
   ================================================================== */

var CODE = new URLSearchParams(location.search).get('room')
        || localStorage.getItem('gubs.room');
var HAND_LIMIT = 8;

function myId() {
  var id = localStorage.getItem('gubs.pid');
  if (!id) { id = 'p' + Math.random().toString(36).slice(2, 10); localStorage.setItem('gubs.pid', id); }
  return id;
}
var ME = myId();

var R = null;                       // latest room snapshot
var UI = { sel: null, pick: null, modal: null, busy: false };

if (!CODE) location.href = 'index.html';
document.getElementById('roomTag').textContent = 'room ' + CODE;
document.getElementById('btnQuit').onclick = function () { location.href = 'index.html'; };

/* ==================================================================
   small helpers
   ================================================================== */
function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
function keyGen(p) { return p + Math.random().toString(36).slice(2, 8); }
function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

function players()      { return (R && R.players) || {}; }
function nameOf(pid)    { return (players()[pid] || {}).name || '???'; }
function seatOf(pid)    { return (players()[pid] || {}).seat; }
function orderedPids()  {
  var p = players();
  return Object.keys(p).sort(function (a, b) { return p[a].seat - p[b].seat; });
}
function pidAtSeat(s)   { return orderedPids().filter(function (p) { return seatOf(p) === s; })[0]; }
function mySeat()       { return seatOf(ME); }
function st()           { return (R && R.state) || {}; }
function myHand()       { return ((R && R.hands && R.hands[ME]) || []).slice(); }
function pending()      { return R && R.pending; }
function finished()     { return R && R.meta && R.meta.status === 'finished'; }
function isMyTurn()     { return !finished() && !pending() && st().turnSeat === mySeat(); }

function gubsOf(pid)  { return (R.tableau && R.tableau[pid] && R.tableau[pid].gubs)  || {}; }
function trapsOf(pid) { return (R.tableau && R.tableau[pid] && R.tableau[pid].traps) || {}; }
function isElder(e)   { return e.cardId === 'esteemed_elder'; }
function statusOf(e)  { return e.trap ? 'trapped' : (e.barricade ? 'protected' : 'free'); }

/* ==================================================================
   the mutable world used while resolving an action
   ================================================================== */
function world() {
  var W = {
    deck:    clone(R.deck) || [],
    discard: clone(R.discard) || [],
    hands:   clone(R.hands) || {},
    tableau: clone(R.tableau) || {},
    state:   clone(R.state) || {},
    log:     clone((R.state && R.state.log)) || []
  };
  orderedPids().forEach(function (pid) {
    if (!W.hands[pid]) W.hands[pid] = [];
    if (!W.tableau[pid]) W.tableau[pid] = {};
    if (!W.tableau[pid].gubs)  W.tableau[pid].gubs  = {};
    if (!W.tableau[pid].traps) W.tableau[pid].traps = {};
  });
  return W;
}

function note(W, text) { W.log.unshift({ t: Date.now(), text: text }); }

function commit(W, extra) {
  var payload = {
    deck:    W.deck.length ? W.deck : null,
    discard: W.discard.length ? W.discard : null,
    hands:   {},
    tableau: {},
    pending: W.pendingNode || null
  };
  orderedPids().forEach(function (pid) {
    payload.hands[pid] = W.hands[pid] && W.hands[pid].length ? W.hands[pid] : null;
    payload.tableau[pid] = {
      gubs:  Object.keys(W.tableau[pid].gubs).length  ? W.tableau[pid].gubs  : null,
      traps: Object.keys(W.tableau[pid].traps).length ? W.tableau[pid].traps : null
    };
  });
  W.state.log = W.log.slice(0, 60);
  payload.state = W.state;
  Object.keys(extra || {}).forEach(function (k) { payload[k] = extra[k]; });

  UI.busy = true;                       // cleared when the write echoes back
  return updateAsync('rooms/' + CODE, payload)
    .catch(function (e) { UI.busy = false; console.error(e); });
}

/* ---- pile / deck manipulation ---------------------------------- */
function toDiscard(W, uid) { if (uid) W.discard.unshift(uid); }
function intoDeck(W, uid)  { if (uid) W.deck.splice(randInt(0, W.deck.length), 0, uid); }

function trapUsers(W, pid, trapKey) {
  var g = W.tableau[pid].gubs;
  return Object.keys(g).filter(function (k) { return g[k].trap === trapKey; });
}
function tidyTrap(W, pid, trapKey) {
  if (!trapKey) return;
  if (trapUsers(W, pid, trapKey).length === 0) {
    var t = W.tableau[pid].traps[trapKey];
    if (t) { toDiscard(W, t.card); delete W.tableau[pid].traps[trapKey]; }
  }
}
/* Take a gub entry off the table. dest: 'discard' | 'deck' */
function removeEntry(W, pid, key, dest) {
  var e = W.tableau[pid].gubs[key];
  if (!e) return;
  var trapKey = e.trap;
  if (e.barricade) toDiscard(W, e.barricade);
  delete W.tableau[pid].gubs[key];
  tidyTrap(W, pid, trapKey);
  if (dest === 'deck') intoDeck(W, e.card); else toDiscard(W, e.card);
}
/* Move a gub entry to another player's side. */
function moveEntry(W, fromPid, key, toPid, keepBarricade) {
  var e = W.tableau[fromPid].gubs[key];
  if (!e) return;
  var trapKey = e.trap;
  delete W.tableau[fromPid].gubs[key];
  tidyTrap(W, fromPid, trapKey);
  W.tableau[toPid].gubs[keyGen('g')] = {
    card: e.card, cardId: e.cardId,
    barricade: keepBarricade ? e.barricade : null,
    barricadeId: keepBarricade ? e.barricadeId : null,
    trap: null
  };
  if (!keepBarricade && e.barricade) toDiscard(W, e.barricade);
}
function handRemove(W, pid, uid) {
  var i = (W.hands[pid] || []).indexOf(uid);
  if (i >= 0) W.hands[pid].splice(i, 1);
}

/* ==================================================================
   live subscription
   ================================================================== */
listen('rooms/' + CODE, function (room) {
  UI.busy = false;
  if (!room || !room.meta) { alert('That room is gone.'); location.href = 'index.html'; return; }
  R = room;
  if (!players()[ME]) { alert('You are not seated at this table.'); location.href = 'index.html'; return; }
  autoResolve();
  render();
});

/* ==================================================================
   RENDER
   ================================================================== */
function cardEl(uid, extraClass) {
  var d = document.createElement('div');
  d.className = 'card' + (extraClass ? ' ' + extraClass : '');
  var def = cardDef(uid);
  var img = document.createElement('img');
  img.src = cardImg(uid);
  img.alt = def.name;
  img.onerror = function () {
    img.remove();
    var f = document.createElement('div');
    f.className = 'fallback';
    f.textContent = def.name;
    d.appendChild(f);
  };
  d.appendChild(img);
  d.title = def.name + '\n' + def.text;
  return d;
}
function backEl() {
  var d = document.createElement('div');
  d.className = 'card';
  var img = document.createElement('img');
  img.src = 'cards/back.png';
  img.alt = 'face down';
  img.onerror = function () {
    img.remove();
    var f = document.createElement('div'); f.className = 'fallback'; f.textContent = 'GUBS';
    d.appendChild(f);
  };
  d.appendChild(img);
  return d;
}
function overlay(uid) {
  var o = document.createElement('div');
  o.className = 'overlay';
  var img = document.createElement('img');
  img.src = cardImg(uid); img.alt = cardName(uid);
  img.onerror = function () { o.style.background = 'var(--moss-lit)'; o.style.height = '46px'; img.remove(); };
  o.appendChild(img);
  return o;
}

function stackEl(pid, key, entry) {
  var wrap = document.createElement('div');
  wrap.className = 'stack';
  wrap.appendChild(cardEl(entry.card));
  if (entry.barricade) wrap.appendChild(overlay(entry.barricade));
  if (entry.trap) {
    var t = trapsOf(pid)[entry.trap];
    if (t) wrap.appendChild(overlay(t.card));
    wrap.classList.add('trapped');
  }
  var badge = document.createElement('div');
  var s = statusOf(entry);
  badge.className = 'badge ' + s;
  badge.textContent = isElder(entry) ? 'elder' : s;
  wrap.appendChild(badge);

  if (UI.pick && gubIsPickable(pid, key, entry)) {
    wrap.classList.add('pickable');
    if (UI.pick.chosen.indexOf(pid + '/' + key) !== -1) wrap.classList.add('picked');
    wrap.onclick = function () { pickGub(pid, key); };
  }
  return wrap;
}

function renderLetters() {
  var drawn = st().letters || [];
  ['G', 'U', 'B'].forEach(function (L) {
    var el = document.getElementById('slot' + L);
    el.className = 'slot';
    if (drawn.indexOf(L) !== -1) el.classList.add('lit');
    else if (drawn.length === 2) el.classList.add('final');
  });
}

function renderColonies() {
  var host = document.getElementById('colonies');
  host.innerHTML = '';
  var order = orderedPids();
  // put me last so my colony sits closest to my hand
  order = order.filter(function (p) { return p !== ME; }).concat([ME]);

  order.forEach(function (pid) {
    var box = document.createElement('div');
    box.className = 'colony' + (pid === ME ? ' mine' : '');
    if (!finished() && seatOf(pid) === st().turnSeat) box.classList.add('active');

    var head = document.createElement('div');
    head.className = 'colony-head';
    var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = nameOf(pid);
    head.appendChild(nm);
    if (pid === ME) { var y = document.createElement('span'); y.className = 'meta'; y.textContent = 'you'; head.appendChild(y); }
    if (!finished() && seatOf(pid) === st().turnSeat) {
      var tf = document.createElement('span'); tf.className = 'turnflag'; tf.textContent = 'their turn';
      if (pid === ME) tf.textContent = 'your turn';
      head.appendChild(tf);
    }
    var hc = document.createElement('span'); hc.className = 'meta';
    hc.textContent = ((R.hands && R.hands[pid]) || []).length + ' in hand';
    head.appendChild(hc);
    var sc = document.createElement('span'); sc.className = 'score';
    sc.textContent = scoreFor(pid) + ' pt' + (scoreFor(pid) === 1 ? '' : 's');
    head.appendChild(sc);
    box.appendChild(head);

    var row = document.createElement('div');
    row.className = 'gubrow';
    var g = gubsOf(pid);
    var keys = Object.keys(g);
    if (!keys.length) {
      var none = document.createElement('span'); none.className = 'none';
      none.textContent = 'no Gubs on this side';
      row.appendChild(none);
    }
    keys.forEach(function (k) { row.appendChild(stackEl(pid, k, g[k])); });
    box.appendChild(row);

    if (UI.pick && playerIsPickable(pid)) {
      box.classList.add('targetable');
      box.onclick = function (ev) { if (ev.target.closest('.stack')) return; pickPlayer(pid); };
    }
    host.appendChild(box);
  });
}

function renderPile() {
  var host = document.getElementById('pile');
  host.innerHTML = '';

  var d1 = document.createElement('div'); d1.className = 'slotwrap';
  var deck = R.deck || [];
  if (deck.length) d1.appendChild(backEl());
  else { var e = document.createElement('div'); e.className = 'empty'; e.textContent = 'empty'; d1.appendChild(e); }
  var c1 = document.createElement('div'); c1.className = 'cap'; c1.textContent = 'Deck \u00b7 ' + deck.length;
  d1.appendChild(c1);
  host.appendChild(d1);

  var d2 = document.createElement('div'); d2.className = 'slotwrap';
  var disc = R.discard || [];
  if (disc.length) {
    d2.appendChild(cardEl(disc[0]));
  } else { var e2 = document.createElement('div'); e2.className = 'empty'; e2.textContent = 'empty'; d2.appendChild(e2); }
  var c2 = document.createElement('div'); c2.className = 'cap'; c2.textContent = 'Discard \u00b7 ' + disc.length;
  d2.appendChild(c2);
  host.appendChild(d2);
}

function renderSide() {
  var drawn = (st().letters || []).length;
  document.getElementById('tableInfo').innerHTML =
    '<div>' + (R.deck || []).length + ' cards left in the deck</div>' +
    '<div>' + drawn + ' of 3 letters drawn</div>' +
    '<div>' + (finished() ? 'Game over' : nameOf(pidAtSeat(st().turnSeat)) + ' is up') + '</div>';

  var log = document.getElementById('log');
  log.innerHTML = '';
  (st().log || []).slice(0, 40).forEach(function (l) {
    var d = document.createElement('div');
    d.textContent = l.text;
    log.appendChild(d);
  });
}

function renderTray() {
  var prompt = document.getElementById('prompt');
  var sub = document.getElementById('promptSub');
  var acts = document.getElementById('actions');
  var handEl = document.getElementById('hand');
  var hcEl = document.getElementById('handCount');
  acts.innerHTML = '';
  handEl.innerHTML = '';

  var hand = myHand();
  hcEl.textContent = hand.length + ' / ' + HAND_LIMIT + ' in hand';
  hcEl.className = 'handcount' + (hand.length > HAND_LIMIT ? ' over' : '');

  var head = '', tail = '';

  if (finished()) {
    head = 'The game is over.';
    tail = 'Every letter of G-U-B has been drawn.';
    acts.appendChild(btn('See the scores', function () { showResults(); }));
  } else if (UI.pick) {
    head = pickPrompt();
    tail = 'Click a highlighted target, or cancel.';
    if (UI.pick.need === 'trap' && UI.pick.chosen.length && UI.pick.chosen.length < UI.pick.capacity) {
      acts.appendChild(btn('Set it on ' + UI.pick.chosen.length, function () {
        var p = UI.pick;
        launchAttack(p.uid, p.effId, {
          pid: p.targetPid,
          keys: p.chosen.map(function (t) { return t.split('/')[1]; })
        });
      }));
    }
    acts.appendChild(btn('Cancel', function () { UI.pick = null; UI.sel = null; render(); }, 'ghost'));
  } else if (pending()) {
    head = 'Hold on \u2014 something is being resolved.';
    tail = pendingSummary();
  } else if (!isMyTurn()) {
    head = nameOf(pidAtSeat(st().turnSeat)) + ' is taking their turn.';
    tail = 'Your interrupts will come up automatically when they are needed.';
  } else if (st().phase === 'draw') {
    head = 'Draw a card.';
    tail = 'You may skip the draw, but not two turns running.';
    acts.appendChild(btn('Draw', doDraw));
    var mustDraw = (st().skipped || {})[String(mySeat())];
    var b = btn('Skip the draw', doSkip, 'ghost');
    b.disabled = !!mustDraw;
    if (mustDraw) b.title = 'You skipped last turn.';
    acts.appendChild(b);
  } else if (st().phase === 'discard') {
    head = 'Discard down to eight.';
    tail = 'Click cards in your hand to discard them.';
    var eb = btn('End turn', endTurn);
    eb.disabled = hand.length > HAND_LIMIT;
    acts.appendChild(eb);
  } else {
    head = 'Play what you like.';
    tail = UI.sel ? cardDef(UI.sel).name + ' \u2014 ' + cardDef(UI.sel).text
                  : 'Click a card to select it, then Play.';
    if (UI.sel) acts.appendChild(btn('Play ' + cardName(UI.sel), function () { beginPlay(UI.sel); }));
    acts.appendChild(btn('End turn', endTurn, UI.sel ? 'ghost' : ''));
  }

  prompt.childNodes[0].nodeValue = head + ' ';
  sub.textContent = tail;

  hand.forEach(function (uid) {
    var c = cardEl(uid);
    if (UI.sel === uid) c.classList.add('sel');
    var playable = isMyTurn() && !UI.pick && (st().phase === 'play' || st().phase === 'discard');
    if (!playable) c.classList.add('dim');
    c.onclick = function () {
      if (finished()) return;
      if (pending()) return;
      if (!isMyTurn()) return;
      if (st().phase === 'discard') { discardFromHand(uid); return; }
      if (st().phase !== 'play') return;
      UI.sel = (UI.sel === uid) ? null : uid;
      render();
    };
    handEl.appendChild(c);
  });
}

function btn(label, fn, cls) {
  var b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.onclick = fn;
  return b;
}

function scoreFor(pid) {
  var g = gubsOf(pid);
  return Object.keys(g).filter(function (k) { return !g[k].trap; }).length;
}

function render() {
  if (!R) return;
  renderLetters();
  renderColonies();
  renderPile();
  renderSide();
  renderTray();
  renderModal();
}

/* ==================================================================
   TARGETING
   ================================================================== */
function pickPrompt() {
  var p = UI.pick;
  var def = CARDS[p.effId];
  switch (p.need) {
    case 'barricade':    return 'Cover one of your Free Gubs, or knock out a ' + def.name + ' in play.';
    case 'trap':         return 'Choose ' + p.capacity + ' Free Gub' + (p.capacity > 1 ? 's' : '') +
                                ' on one opponent\u2019s side (' + p.chosen.length + '/' + p.capacity + ').';
    case 'anyTrap':      return 'Choose a Trap to destroy.';
    case 'ringTrap':     return 'Choose a Ring to shatter.';
    case 'freeGubEnemy': return 'Choose a Free Gub to lure away.';
    case 'anyGub':       return 'Choose any Gub to destroy.';
    case 'spoutGub':     return 'Choose a Gub trapped under a Sud Spout.';
    case 'player':       return 'Choose a player.';
    default:             return 'Choose a target.';
  }
}

function gubIsPickable(pid, key, e) {
  var p = UI.pick;
  if (!p) return false;
  switch (p.need) {
    case 'barricade':
      if (pid === ME && !e.barricade && !e.trap && !isElder(e)) return true;   // protect
      if (e.barricadeId === p.effId) return true;                              // knock out
      return false;
    case 'trap':
      if (pid === ME || isElder(e) || e.trap || e.barricade) return false;
      if (p.targetPid && p.targetPid !== pid) return false;
      return true;
    case 'anyTrap':  return !!e.trap;
    case 'ringTrap': return !!e.trap && !!(trapsOf(pid)[e.trap] && CARDS[trapsOf(pid)[e.trap].cardId].ring);
    case 'freeGubEnemy': return pid !== ME && !e.barricade && !e.trap && !isElder(e);
    case 'anyGub':   return true;
    case 'spoutGub': return !!e.trap && !!(trapsOf(pid)[e.trap] && CARDS[trapsOf(pid)[e.trap].cardId].spout);
    default: return false;
  }
}
function playerIsPickable(pid) {
  var p = UI.pick;
  return p && p.need === 'player' && pid !== ME && Object.keys(gubsOf(pid)).length >= 0;
}

function pickGub(pid, key) {
  var p = UI.pick, e = gubsOf(pid)[key], tag = pid + '/' + key;

  if (p.need === 'trap') {
    p.targetPid = pid;
    var i = p.chosen.indexOf(tag);
    if (i >= 0) p.chosen.splice(i, 1); else p.chosen.push(tag);
    if (!p.chosen.length) p.targetPid = null;
    if (p.chosen.length === p.capacity) {
      var keys = p.chosen.map(function (t) { return t.split('/')[1]; });
      launchAttack(p.uid, p.effId, { pid: pid, keys: keys });
      return;
    }
    render(); return;
  }

  if (p.need === 'barricade') {
    if (pid === ME && !e.barricade && !e.trap) resolveOwn(p.uid, p.effId, { mode: 'protect', pid: pid, key: key });
    else resolveOwn(p.uid, p.effId, { mode: 'knock', pid: pid, key: key });
    return;
  }
  if (p.need === 'anyTrap' || p.need === 'ringTrap') {
    resolveOwn(p.uid, p.effId, { pid: pid, trapKey: e.trap });
    return;
  }
  // hazards that hit one gub
  launchAttack(p.uid, p.effId, { pid: pid, key: key });
}

function pickPlayer(pid) {
  launchAttack(UI.pick.uid, UI.pick.effId, { pid: pid });
}

/* ==================================================================
   TURN: draw
   ================================================================== */
function doSkip() {
  if (!isMyTurn() || st().phase !== 'draw' || UI.busy) return;
  var W = world();
  W.state.skipped = W.state.skipped || {};
  W.state.skipped[String(mySeat())] = true;
  W.state.phase = 'play';
  note(W, nameOf(ME) + ' let the deck be.');
  commit(W);
}

function doDraw() {
  if (!isMyTurn() || st().phase !== 'draw' || UI.busy) return;
  var W = world();
  if (!W.deck.length) { endGame(W, 'The deck ran out.'); return; }

  var uid = W.deck.shift();
  var def = cardDef(uid);
  W.state.skipped = W.state.skipped || {};
  W.state.skipped[String(mySeat())] = null;

  if (def.type === 'letter' || def.type === 'event') {
    // everyone gets a chance to Flop Boat it (and Age-Old Cure the Plague)
    var awaiting = {};
    orderedPids().forEach(function (p) { awaiting[p] = true; });
    W.pendingNode = {
      id: keyGen('x'), kind: def.type === 'letter' ? 'letter' : 'event',
      srcUid: uid, effId: cardId(uid), actorId: ME,
      awaiting: awaiting, responses: null, createdAt: Date.now()
    };
    W.state.phase = 'react';
    note(W, nameOf(ME) + ' drew ' + def.name + '.');
    commit(W);
    return;
  }

  W.hands[ME].push(uid);
  W.state.phase = 'play';
  note(W, nameOf(ME) + ' drew a card.');
  commit(W);
}

/* ==================================================================
   TURN: play
   ================================================================== */
function beginPlay(uid) {
  if (!isMyTurn() || st().phase !== 'play' || UI.busy) return;
  var id = cardId(uid);

  if (id === 'cricket_song') { openCricket(uid); return; }
  startPlayAs(uid, id);
}

function startPlayAs(uid, effId) {
  var def = CARDS[effId];

  if (def.type === 'event') { alert('Events only fire when they are drawn.'); return; }

  if (def.type === 'gub') { resolveOwn(uid, effId, {}); return; }

  if (effId === 'flop_boat' || effId === 'feather' || effId === 'blindfold') {
    alert(def.name + ' is an interrupt \u2014 it plays itself when you need it.');
    return;
  }
  if (effId === 'age_old_cure') { openDiscardPicker(uid); return; }

  if (!def.need || def.need === 'none') { resolveOwn(uid, effId, {}); return; }

  UI.pick = { uid: uid, effId: effId, need: def.need, capacity: def.capacity || 1, chosen: [], targetPid: null };
  UI.sel = null;

  // nothing legal to click? say so instead of stranding the player
  if (!anyLegalTarget()) {
    UI.pick = null;
    alert('There is nothing on the table that ' + def.name + ' can be played on.');
  }
  render();
}

function anyLegalTarget() {
  var found = false;
  orderedPids().forEach(function (pid) {
    var g = gubsOf(pid);
    Object.keys(g).forEach(function (k) { if (gubIsPickable(pid, k, g[k])) found = true; });
    if (playerIsPickable(pid)) found = true;
  });
  return found;
}

/* ---- things that resolve straight away (no interrupt window) ---- */
function resolveOwn(uid, effId, T) {
  var W = world();
  handRemove(W, ME, uid);
  applyOwn(W, uid, effId, T);
  UI.pick = null; UI.sel = null;
  commit(W).then(function () {
    if (effId === 'scout') runScout();
  });
}

function applyOwn(W, uid, effId, T) {
  var def = CARDS[effId];
  var isWild = cardId(uid) !== effId;
  var label = def.name + (isWild ? ' (Cricket Song)' : '');
  var g;

  switch (def.type === 'gub' ? 'gub' : effId) {

    case 'gub':
      W.tableau[ME].gubs[keyGen('g')] =
        { card: uid, cardId: cardId(uid), barricade: null, barricadeId: null, trap: null };
      note(W, nameOf(ME) + ' put ' + (effId === 'esteemed_elder' ? 'the Esteemed Elder' : 'a Gub') + ' into play.');
      return;

    case 'mushroom': case 'toad_rider': case 'velvet_moth':
      if (T.mode === 'protect') {
        var e = W.tableau[ME].gubs[T.key];
        e.barricade = uid; e.barricadeId = effId;
        note(W, nameOf(ME) + ' sheltered a Gub with a ' + def.name + '.');
      } else {
        var t = W.tableau[T.pid].gubs[T.key];
        toDiscard(W, t.barricade); toDiscard(W, uid);
        t.barricade = null; t.barricadeId = null;
        note(W, nameOf(ME) + ' knocked out ' + nameOf(T.pid) + '\u2019s ' + def.name + '. Both are discarded.');
      }
      return;

    case 'spear':
      var tr = W.tableau[T.pid].traps[T.trapKey];
      trapUsers(W, T.pid, T.trapKey).forEach(function (k) { W.tableau[T.pid].gubs[k].trap = null; });
      toDiscard(W, tr.card); delete W.tableau[T.pid].traps[T.trapKey];
      toDiscard(W, uid);
      note(W, nameOf(ME) + ' drove a ' + label + ' through ' + nameOf(T.pid) + '\u2019s ' + CARDS[tr.cardId].name + '. Those Gubs are Free.');
      return;

    case 'haki_flute':
      var ring = W.tableau[T.pid].traps[T.trapKey];
      var freed = trapUsers(W, T.pid, T.trapKey);
      delete W.tableau[T.pid].traps[T.trapKey];   // before the moves, so it isn't tidied twice
      freed.forEach(function (k) {
        W.tableau[T.pid].gubs[k].trap = null;
        moveEntry(W, T.pid, k, ME, false);
      });
      toDiscard(W, ring.card);
      toDiscard(W, uid);
      note(W, nameOf(ME) + ' shattered a ' + CARDS[ring.cardId].name + ' and won ' + freed.length + ' Gub' + (freed.length === 1 ? '' : 's') + '.');
      return;

    case 'scout':
      toDiscard(W, uid);
      note(W, nameOf(ME) + ' sent a ' + label + ' ahead.');
      return;

    case 'retreat':
      g = W.tableau[ME].gubs;
      var back = 0;
      Object.keys(g).forEach(function (k) {
        var e = g[k];
        W.hands[ME].push(e.card); back++;
        if (e.barricade) { W.hands[ME].push(e.barricade); back++; }
      });
      Object.keys(W.tableau[ME].traps).forEach(function (tk) {
        W.hands[ME].push(W.tableau[ME].traps[tk].card); back++;
      });
      W.tableau[ME].gubs = {}; W.tableau[ME].traps = {};
      toDiscard(W, uid);
      note(W, nameOf(ME) + ' sounded a ' + label + ' and pulled ' + back + ' cards back into hand.');
      return;

    case 'age_old_cure':
      var i = W.discard.indexOf(T.uid);
      if (i >= 0) W.discard.splice(i, 1);
      W.hands[ME].push(T.uid);
      toDiscard(W, uid);
      note(W, nameOf(ME) + ' used an ' + label + ' to lift a Gub out of the discard pile.');
      return;

    default:
      toDiscard(W, uid);
      note(W, nameOf(ME) + ' played ' + label + '.');
  }
}

/* ==================================================================
   ATTACKS — hazards and traps, which can be interrupted
   ================================================================== */
function launchAttack(uid, effId, T) {
  var W = world();
  handRemove(W, ME, uid);

  var awaiting = {};
  if (effId === 'omen_beetle') {
    orderedPids().forEach(function (p) { if (p !== ME) awaiting[p] = true; });
  } else if (T.pid && T.pid !== ME) {
    awaiting[T.pid] = true;
  }

  var def = CARDS[effId];
  note(W, nameOf(ME) + ' played ' + def.name +
        (T.pid && T.pid !== ME ? ' at ' + nameOf(T.pid) : '') + '.');

  if (!Object.keys(awaiting).length) {
    applyAttack(W, uid, effId, T, ME);
    UI.pick = null; UI.sel = null;
    commit(W);
    return;
  }

  W.pendingNode = {
    id: keyGen('x'), kind: 'attack', srcUid: uid, effId: effId,
    actorId: ME, target: T, awaiting: awaiting, responses: null, createdAt: Date.now()
  };
  UI.pick = null; UI.sel = null;
  commit(W);
}

function applyAttack(W, uid, effId, T, actor) {
  var def = CARDS[effId];
  var isWild = cardId(uid) !== effId;
  var label = def.name + (isWild ? ' (Cricket Song)' : '');
  var e, g;

  switch (effId) {

    case 'lure':
      e = W.tableau[T.pid].gubs[T.key];
      if (e && !e.trap && !e.barricade && !isElder(e)) {
        moveEntry(W, T.pid, T.key, actor, false);
        note(W, nameOf(actor) + ' lured a Gub away from ' + nameOf(T.pid) + '.');
      }
      toDiscard(W, uid);
      return;

    case 'super_lure':
      g = W.tableau[T.pid].gubs;
      var moved = 0;
      Object.keys(g).forEach(function (k) {
        if (g[k].trap) return;
        if (isElder(g[k])) return;            // the Elder cannot be lured
        moveEntry(W, T.pid, k, actor, true);
        moved++;
      });
      toDiscard(W, uid);
      note(W, nameOf(actor) + ' emptied ' + nameOf(T.pid) + '\u2019s colony with a ' + label + ' \u2014 ' + moved + ' Gub' + (moved === 1 ? '' : 's') + '.');
      return;

    case 'lightning':
      e = W.tableau[T.pid].gubs[T.key];
      if (e) {
        var wasElder = isElder(e);
        removeEntry(W, T.pid, T.key, 'discard');
        note(W, nameOf(actor) + ' struck ' + (wasElder ? 'the Esteemed Elder' : 'a Gub') + ' on ' + nameOf(T.pid) + '\u2019s side with ' + label + '.');
      }
      toDiscard(W, uid);
      return;

    case 'cyclone':
      g = W.tableau[T.pid].gubs;
      var blown = 0;
      Object.keys(g).forEach(function (k) {
        if (g[k].barricade) { toDiscard(W, g[k].barricade); g[k].barricade = null; g[k].barricadeId = null; blown++; }
      });
      toDiscard(W, uid);
      note(W, label + ' tore ' + blown + ' Barricade' + (blown === 1 ? '' : 's') + ' off ' + nameOf(T.pid) + '\u2019s Gubs.');
      return;

    case 'omen_beetle':
      var eaten = 0;
      orderedPids().forEach(function (pid) {
        var gg = W.tableau[pid].gubs;
        Object.keys(gg).forEach(function (k) {
          if (gg[k].barricadeId === 'mushroom') { removeEntry(W, pid, k, 'discard'); eaten++; }
        });
      });
      toDiscard(W, uid);
      note(W, label + ' ate every Mushroom in play \u2014 ' + eaten + ' Gub' + (eaten === 1 ? '' : 's') + ' went with them.');
      return;

    case 'smahl_thief':
      e = W.tableau[T.pid].gubs[T.key];
      if (e && e.trap) {
        var spoutKey = e.trap, spout = W.tableau[T.pid].traps[spoutKey];
        e.trap = null;
        moveEntry(W, T.pid, T.key, actor, false);
        if (spout) { toDiscard(W, spout.card); delete W.tableau[T.pid].traps[spoutKey]; }
        note(W, nameOf(actor) + ' had a ' + label + ' lift a Gub out from under a Sud Spout.');
      }
      toDiscard(W, uid);
      return;

    default:
      // the four Traps
      if (def.type === 'trap') {
        var tk = keyGen('t');
        W.tableau[T.pid].traps[tk] = { card: uid, cardId: effId, capacity: def.capacity };
        (T.keys || []).forEach(function (k) {
          if (W.tableau[T.pid].gubs[k]) W.tableau[T.pid].gubs[k].trap = tk;
        });
        note(W, nameOf(actor) + ' snared ' + (T.keys || []).length + ' of ' + nameOf(T.pid) + '\u2019s Gubs in a ' + label + '.');
        return;
      }
      toDiscard(W, uid);
  }
}

/* ==================================================================
   EVENTS — resolved after the interrupt window closes
   ================================================================== */
function applyEvent(W, effId, drawer, responses) {
  var g;
  switch (effId) {

    case 'dangerous_alchemy':
      g = W.tableau[drawer].gubs;
      var lost = 0;
      Object.keys(g).forEach(function (k) {
        if (isElder(g[k])) {
          if (g[k].barricade) { toDiscard(W, g[k].barricade); g[k].barricade = null; g[k].barricadeId = null; }
          return;
        }
        removeEntry(W, drawer, k, 'discard'); lost++;
      });
      Object.keys(W.tableau[drawer].traps).forEach(function (tk) {
        toDiscard(W, W.tableau[drawer].traps[tk].card);
        delete W.tableau[drawer].traps[tk];
      });
      Object.keys(W.tableau[drawer].gubs).forEach(function (k) { W.tableau[drawer].gubs[k].trap = null; });
      note(W, 'Dangerous Alchemy wiped ' + nameOf(drawer) + '\u2019s side clean \u2014 ' + lost + ' Gub' + (lost === 1 ? '' : 's') + ' lost.');
      return;

    case 'flash_flood':
      var washed = 0;
      orderedPids().forEach(function (pid) {
        var gg = W.tableau[pid].gubs;
        Object.keys(gg).forEach(function (k) {
          var e = gg[k];
          if (e.barricade || e.trap || isElder(e)) return;
          removeEntry(W, pid, k, 'deck'); washed++;
        });
      });
      note(W, 'A Flash Flood swept ' + washed + ' Free Gub' + (washed === 1 ? '' : 's') + ' back into the deck.');
      return;

    case 'rumor_of_wasps':
      var scared = 0;
      orderedPids().forEach(function (pid) {
        var gg = W.tableau[pid].gubs;
        Object.keys(gg).forEach(function (k) {
          if (gg[k].barricadeId !== 'toad_rider') return;
          toDiscard(W, gg[k].barricade);
          gg[k].barricade = null; gg[k].barricadeId = null;
          removeEntry(W, pid, k, 'deck'); scared++;
        });
      });
      note(W, 'A Rumor of Wasps sent ' + scared + ' Toad Rider Gub' + (scared === 1 ? '' : 's') + ' back into the deck.');
      return;

    case 'gargok_plague':
      var struck = [];
      orderedPids().forEach(function (pid) {
        var r = (responses || {})[pid];
        if (r && r.action === 'cure') {
          handRemove(W, pid, r.uid); toDiscard(W, r.uid);
          return;
        }
        var h = W.hands[pid] || [];
        h.forEach(function (u) { intoDeck(W, u); });
        if (h.length) struck.push(nameOf(pid));
        W.hands[pid] = [];
      });
      note(W, 'The Gargok Plague swept through' + (struck.length ? ': ' + struck.join(', ') + ' lost their hands.' : ' \u2014 everyone was cured.'));
      return;
  }
}

/* ==================================================================
   INTERRUPT WINDOWS
   ================================================================== */
function myInterruptOptions() {
  var p = pending();
  if (!p) return [];
  var hand = myHand();
  var out = [];

  function offer(uid, asId) { out.push({ uid: uid, asId: asId }); }

  hand.forEach(function (uid) {
    var id = cardId(uid);
    var wild = id === 'cricket_song';
    var acts = wild ? ['feather', 'blindfold', 'flop_boat', 'age_old_cure'] : [id];
    acts.forEach(function (a) {
      if (p.kind === 'attack') {
        var t = CARDS[p.effId].type;
        if (a === 'feather' && (t === 'hazard' || t === 'trap')) offer(uid, a);
        if (a === 'blindfold' && (p.effId === 'lure' || p.effId === 'super_lure')) offer(uid, a);
      } else if (p.kind === 'event' || p.kind === 'letter') {
        if (a === 'flop_boat') offer(uid, a);
        if (a === 'age_old_cure' && p.effId === 'gargok_plague') offer(uid, a);
      }
    });
  });
  return out;
}

function respond(choice) {
  var p = pending();
  if (!p) return;
  var payload = {};
  payload['pending/responses/' + ME] = choice;
  updateAsync('rooms/' + CODE, payload);
}

/* the player who opened the window is the one who closes it */
var RESOLVED = {};
function autoResolve() {
  var p = pending();
  if (!p || p.actorId !== ME) return;
  if (RESOLVED[p.id]) return;
  var awaiting = Object.keys(p.awaiting || {});
  var got = Object.keys(p.responses || {});
  if (awaiting.some(function (a) { return got.indexOf(a) === -1; })) return;
  RESOLVED[p.id] = true;

  if (p.kind === 'attack')   { closeAttack(p); return; }
  if (p.kind === 'merchant') { closeMerchant(p); return; }
  closeEvent(p);
}

function closeAttack(p) {
  var W = world();
  var res = p.responses || {};
  var canceller = null;
  Object.keys(res).forEach(function (pid) {
    if (!canceller && res[pid] && res[pid].action === 'cancel') canceller = { pid: pid, r: res[pid] };
  });

  if (canceller) {
    handRemove(W, canceller.pid, canceller.r.uid);
    toDiscard(W, canceller.r.uid);
    toDiscard(W, p.srcUid);
    note(W, nameOf(canceller.pid) + ' answered with ' + CARDS[canceller.r.asId].name + '. ' +
            CARDS[p.effId].name + ' does nothing.');
  } else {
    applyAttack(W, p.srcUid, p.effId, p.target, p.actorId);
  }
  W.pendingNode = null;
  W.state.phase = 'play';
  commit(W);
}

function closeEvent(p) {
  var W = world();
  var res = p.responses || {};
  var boat = null;
  Object.keys(res).forEach(function (pid) {
    if (!boat && res[pid] && res[pid].action === 'cancel') boat = { pid: pid, r: res[pid] };
  });

  if (boat) {
    handRemove(W, boat.pid, boat.r.uid);
    toDiscard(W, boat.r.uid);
    intoDeck(W, p.srcUid);
    note(W, nameOf(boat.pid) + ' rowed up a Flop Boat. ' + CARDS[p.effId].name + ' goes back into the deck.');
    W.pendingNode = null;
    W.state.phase = 'play';
    commit(W);
    return;
  }

  if (p.kind === 'letter') {
    var letters = (W.state.letters || []).slice();
    letters.push(p.effId);
    W.state.letters = letters;
    W.discard.unshift(p.srcUid);
    note(W, 'The letter ' + p.effId + ' is out. ' + letters.length + ' of 3.');
    if (letters.length >= 3) { W.pendingNode = null; endGame(W, 'The third letter is out.'); return; }
    W.pendingNode = null;
    W.state.phase = 'play';
    commit(W);
    return;
  }

  // a real Event
  if (p.effId === 'traveling_merchant') {
    var awaiting = {};
    orderedPids().forEach(function (pid) { if ((W.hands[pid] || []).length > 1) awaiting[pid] = true; });
    toDiscard(W, p.srcUid);
    note(W, 'A Traveling Merchant arrives. Everyone keeps one card and passes the rest along.');
    if (!Object.keys(awaiting).length) {
      W.pendingNode = null; W.state.phase = 'play'; commit(W); return;
    }
    W.pendingNode = { id: keyGen('x'), kind: 'merchant', effId: 'traveling_merchant',
                      actorId: ME, awaiting: awaiting, responses: null, createdAt: Date.now() };
    commit(W);
    return;
  }

  applyEvent(W, p.effId, p.actorId, res);
  toDiscard(W, p.srcUid);
  W.pendingNode = null;
  W.state.phase = 'play';
  commit(W);
}

function closeMerchant(p) {
  var W = world();
  var res = p.responses || {};
  var order = orderedPids();
  var passing = {};
  order.forEach(function (pid) {
    var keep = (res[pid] || {}).uid;
    var h = (W.hands[pid] || []).slice();
    if (keep && h.indexOf(keep) >= 0) {
      passing[pid] = h.filter(function (u) { return u !== keep; });
      W.hands[pid] = [keep];
    } else {
      passing[pid] = h.slice(1);
      W.hands[pid] = h.slice(0, 1);
    }
  });
  order.forEach(function (pid, i) {
    var to = order[(i + 1) % order.length];
    W.hands[to] = (W.hands[to] || []).concat(passing[pid]);
  });
  note(W, 'Hands changed owners.');
  W.pendingNode = null;
  W.state.phase = 'play';
  commit(W);
}

/* ==================================================================
   discard step, end of turn, end of game
   ================================================================== */
function discardFromHand(uid) {
  if (UI.busy) return;
  var W = world();
  handRemove(W, ME, uid);
  toDiscard(W, uid);
  note(W, nameOf(ME) + ' discarded ' + cardName(uid) + '.');
  if ((W.hands[ME] || []).length <= HAND_LIMIT) {
    W.state.phase = 'discard';
  }
  commit(W);
}

function endTurn() {
  if (!isMyTurn() || UI.busy) return;
  var hand = myHand();
  if (hand.length > HAND_LIMIT) {
    var W0 = world();
    W0.state.phase = 'discard';
    commit(W0);
    return;
  }
  var W = world();
  W.state.turnSeat = (W.state.turnSeat + 1) % W.state.seatCount;
  W.state.phase = 'draw';
  UI.sel = null; UI.pick = null;
  note(W, nameOf(ME) + ' says \u201cGo\u201d.');
  commit(W);
}

function endGame(W, reason) {
  var rows = orderedPids().map(function (pid) {
    var g = W.tableau[pid].gubs;
    var keys = Object.keys(g);
    return {
      pid: pid, name: nameOf(pid),
      pts: keys.filter(function (k) { return !g[k].trap; }).length,
      elder: keys.some(function (k) { return g[k].cardId === 'esteemed_elder' && !g[k].trap; }),
      hand: (W.hands[pid] || []).length
    };
  });
  var best = Math.max.apply(null, rows.map(function (r) { return r.pts; }));
  var tied = rows.filter(function (r) { return r.pts === best; });
  var winner = null, how = 'most Free and Protected Gubs';
  if (tied.length === 1) winner = tied[0].pid;
  else {
    var elders = tied.filter(function (r) { return r.elder; });
    if (elders.length === 1) { winner = elders[0].pid; how = 'tied, but held the Esteemed Elder'; }
    else {
      var pool = elders.length ? elders : tied;
      var few = Math.min.apply(null, pool.map(function (r) { return r.hand; }));
      var fin = pool.filter(function (r) { return r.hand === few; });
      if (fin.length === 1) { winner = fin[0].pid; how = 'tied, but held the fewest cards'; }
      else how = 'a dead heat';
    }
  }
  W.state.phase = 'over';
  W.state.winner = winner;
  W.state.how = how;
  W.state.results = rows;
  note(W, reason + ' ' + (winner ? nameOf(winner) + ' wins \u2014 ' + how + '.' : 'Nobody could be separated.'));
  W.pendingNode = null;
  commit(W, { 'meta/status': 'finished' });
}

/* ==================================================================
   MODALS
   ================================================================== */
function modal(html, build) {
  var host = document.getElementById('modalHost');
  host.innerHTML = '';
  var scrim = document.createElement('div'); scrim.className = 'scrim';
  var box = document.createElement('div'); box.className = 'modal';
  box.innerHTML = html;
  scrim.appendChild(box);
  host.appendChild(scrim);
  if (build) build(box);
}
function closeModal() { document.getElementById('modalHost').innerHTML = ''; }

function pendingSummary() {
  var p = pending();
  if (!p) return '';
  if (p.kind === 'merchant') return 'Everyone is choosing a card to keep.';
  return nameOf(p.actorId) + ' \u2014 ' + CARDS[p.effId].name;
}

function renderModal() {
  if (UI.modal === 'results' || (finished() && UI.modal !== 'dismissed')) { showResults(); return; }
  if (UI.modal === 'cricket' || UI.modal === 'discardpick' || UI.modal === 'scout') return;

  var p = pending();
  if (!p) { closeModal(); return; }

  var responded = p.responses && p.responses[ME];
  var involved = p.awaiting && p.awaiting[ME];

  if (p.kind === 'merchant' && involved && !responded) { showMerchant(); return; }
  if (involved && !responded && p.kind !== 'merchant') { showInterrupt(p); return; }
  closeModal();
}

function showInterrupt(p) {
  var opts = myInterruptOptions();
  var def = CARDS[p.effId];
  var mine = p.target && p.target.pid === ME;
  var head = p.kind === 'attack'
    ? (mine ? nameOf(p.actorId) + ' is playing ' + def.name + ' on you.'
            : nameOf(p.actorId) + ' played ' + def.name + '.')
    : def.name + ' was drawn.';

  modal(
    '<p class="eyebrow">' + (p.kind === 'attack' ? 'Interrupt' : 'Event') + '</p>' +
    '<h2>' + head + '</h2>' +
    '<div class="cardtext">' + def.text + '</div>' +
    (opts.length ? '<p>You can answer it:</p>' : '<p>You have nothing that answers this.</p>') +
    '<div class="acts" id="iacts"></div>',
    function (box) {
      var acts = box.querySelector('#iacts');
      opts.forEach(function (o) {
        var lbl = cardName(o.uid) === CARDS[o.asId].name
          ? 'Play ' + CARDS[o.asId].name
          : 'Play Cricket Song as ' + CARDS[o.asId].name;
        acts.appendChild(btn(lbl, function () {
          closeModal();
          respond({ action: o.asId === 'age_old_cure' && p.effId === 'gargok_plague' ? 'cure' : 'cancel',
                    uid: o.uid, asId: o.asId });
        }));
      });
      acts.appendChild(btn(opts.length ? 'Let it happen' : 'Continue', function () {
        closeModal(); respond({ action: 'pass' });
      }, 'ghost'));
    }
  );
}

function showMerchant() {
  var hand = myHand();
  modal(
    '<p class="eyebrow">Event</p>' +
    '<h2>Traveling Merchant</h2>' +
    '<p>Keep one card. Everything else goes to the player on your left.</p>' +
    '<div class="choicegrid" id="mg"></div>',
    function (box) {
      var grid = box.querySelector('#mg');
      hand.forEach(function (uid) {
        var c = cardEl(uid);
        c.onclick = function () { closeModal(); respond({ uid: uid }); };
        grid.appendChild(c);
      });
    }
  );
}

function openCricket(uid) {
  UI.modal = 'cricket';
  modal(
    '<p class="eyebrow">Wild card</p>' +
    '<h2>Play the Cricket Song as\u2026</h2>' +
    '<p>Any Hazard, Tool or Interrupt in the deck.</p>' +
    '<div class="choicegrid" id="cg"></div>' +
    '<div class="acts"><button class="ghost" id="cx">Never mind</button></div>',
    function (box) {
      var grid = box.querySelector('#cg');
      CRICKET_CHOICES.forEach(function (id) {
        var c = cardEl(id + '#0');
        c.onclick = function () { UI.modal = null; closeModal(); startPlayAs(uid, id); };
        grid.appendChild(c);
      });
      box.querySelector('#cx').onclick = function () { UI.modal = null; closeModal(); render(); };
    }
  );
}

function openDiscardPicker(uid) {
  var gubs = (R.discard || []).filter(function (u) { return cardId(u) === 'gub'; });
  if (!gubs.length) { alert('There are no Gubs in the discard pile.'); return; }
  UI.modal = 'discardpick';
  modal(
    '<p class="eyebrow">Age-Old Cure</p>' +
    '<h2>Lift a Gub out of the discard pile</h2>' +
    '<p>It goes into your hand. The Esteemed Elder can never be recovered this way.</p>' +
    '<div class="choicegrid" id="dg"></div>' +
    '<div class="acts"><button class="ghost" id="dx">Never mind</button></div>',
    function (box) {
      var grid = box.querySelector('#dg');
      gubs.forEach(function (u) {
        var c = cardEl(u);
        c.onclick = function () { UI.modal = null; closeModal(); resolveOwn(uid, 'age_old_cure', { uid: u }); };
        grid.appendChild(c);
      });
      box.querySelector('#dx').onclick = function () { UI.modal = null; closeModal(); render(); };
    }
  );
}

/* Scout runs locally: peek, keep one, put the rest back. */
function runScout() {
  var top = (R.deck || []).slice(0, 3);
  var takeable = top.filter(function (u) {
    var t = cardDef(u).type; return t !== 'event' && t !== 'letter';
  });
  UI.modal = 'scout';
  modal(
    '<p class="eyebrow">Scout</p>' +
    '<h2>The top of the deck</h2>' +
    '<p>Keep one. The rest go back on top in the same order. Letters and Events stay where they are.</p>' +
    '<div class="choicegrid" id="sg"></div>' +
    '<div class="acts"><button class="ghost" id="sx">Keep none</button></div>',
    function (box) {
      var grid = box.querySelector('#sg');
      top.forEach(function (u) {
        var c = cardEl(u);
        if (takeable.indexOf(u) === -1) { c.style.opacity = '.4'; c.title = 'Stays in the deck'; }
        else c.onclick = function () { finishScout(u); };
        grid.appendChild(c);
      });
      box.querySelector('#sx').onclick = function () { finishScout(null); };
    }
  );
}
function finishScout(uid) {
  UI.modal = null; closeModal();
  if (!uid) { render(); return; }
  var W = world();
  var i = W.deck.indexOf(uid);
  if (i >= 0 && i < 3) { W.deck.splice(i, 1); W.hands[ME].push(uid); }
  note(W, nameOf(ME) + ' took a card off the top of the deck.');
  commit(W);
}

function showResults() {
  UI.modal = 'results';
  var rows = st().results || [];
  var winner = st().winner;
  var html =
    '<p class="eyebrow">Final count</p>' +
    '<h2>' + (winner ? nameOf(winner) + ' wins' : 'A dead heat') + '</h2>' +
    '<p>' + (st().how || '') + '</p><ul class="results">';
  rows.forEach(function (r) {
    html += '<li class="' + (r.pid === winner ? 'win' : '') + '">' +
            '<span>' + r.name + '</span>' +
            '<span class="meta" style="color:var(--parch-dim);font-size:12px">' +
              (r.elder ? 'Esteemed Elder \u00b7 ' : '') + r.hand + ' in hand</span>' +
            '<span class="pts">' + r.pts + '</span></li>';
  });
  html += '</ul><div class="acts"><button id="again">Back to the lobby</button>' +
          '<button class="ghost" id="look">Look at the table</button></div>';
  modal(html, function (box) {
    box.querySelector('#again').onclick = function () { location.href = 'index.html'; };
    box.querySelector('#look').onclick = function () { UI.modal = 'dismissed'; closeModal(); };
  });
}

