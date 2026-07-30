/* ------------------------------------------------------------------
   lobby.js — create/join a room, then deal the opening setup.
------------------------------------------------------------------- */

var MAX_PLAYERS = 4;
var HAND_LIMIT  = 8;

/* ---------- identity ------------------------------------------- */
function myId() {
  var id = localStorage.getItem('gubs.pid');
  if (!id) {
    id = 'p' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('gubs.pid', id);
  }
  return id;
}
function rememberName(n) { localStorage.setItem('gubs.name', n); }
function savedName()     { return localStorage.getItem('gubs.name') || ''; }

function makeCode() {
  var letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O
  var s = '';
  for (var i = 0; i < 4; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return s;
}

/* ---------- element handles ------------------------------------ */
var elStart   = document.getElementById('start');
var elWaiting = document.getElementById('waiting');
var elCode    = document.getElementById('codeOut');
var elCodeSub = document.getElementById('codeSub');
var elSeats   = document.getElementById('seatList');
var btnStart  = document.getElementById('btnStart');
var noteStart = document.getElementById('startNotice');
var noteWait  = document.getElementById('waitNotice');

document.getElementById('hostName').value = savedName();
document.getElementById('joinName').value = savedName();

var roomCode = null;
var unsub = null;

/* ---------- create --------------------------------------------- */
document.getElementById('btnCreate').onclick = function () {
  var name = document.getElementById('hostName').value.trim();
  if (!name) { noteStart.textContent = 'Put a name in first.'; return; }
  rememberName(name);
  noteStart.textContent = '';

  var code = makeCode();
  readOnce('rooms/' + code + '/meta').then(function (existing) {
    if (existing) { document.getElementById('btnCreate').click(); return; } // collision, try again
    var now = Date.now();
    var payload = { 'meta': { code: code, hostId: myId(), status: 'lobby', createdAt: now } };
    payload['players/' + myId()] = { name: name, seat: 0, joinedAt: now };
    return updateAsync('rooms/' + code, payload)
      .then(function () { enterRoom(code); });
  });
};

/* ---------- join ----------------------------------------------- */
/* Seats are claimed in a transaction. Two people pressing Join at the same
   moment would otherwise both read "seat 1 is free" and both take it. */
document.getElementById('btnJoin').onclick = function () {
  var name = document.getElementById('joinName').value.trim();
  var code = document.getElementById('joinCode').value.trim().toUpperCase();
  if (!name) { noteStart.textContent = 'Put a name in first.'; return; }
  if (code.length !== 4) { noteStart.textContent = 'Room codes are four letters.'; return; }
  rememberName(name);
  noteStart.textContent = '';

  readOnce('rooms/' + code + '/meta').then(function (meta) {
    if (!meta) { noteStart.textContent = 'No room called ' + code + '.'; return; }

    var outcome = null;
    database.ref('rooms/' + code + '/players').transaction(function (players) {
      players = players || {};
      if (players[myId()]) {                       // already have a seat, just rename
        players[myId()].name = name;
        outcome = 'rejoined';
        return players;
      }
      if (meta.status !== 'lobby') { outcome = 'underway'; return; }   // abort
      var taken = Object.keys(players).map(function (k) { return players[k].seat; });
      var seat = 0;
      while (taken.indexOf(seat) !== -1) seat++;
      if (seat >= MAX_PLAYERS) { outcome = 'full'; return; }           // abort
      players[myId()] = { name: name, seat: seat, joinedAt: Date.now() };
      outcome = 'seated';
      return players;
    }, function (err, committed) {
      if (err) { noteStart.textContent = 'Could not reach that room. Try again.'; return; }
      if (!committed || outcome === 'full') { noteStart.textContent = 'That room is full.'; return; }
      if (outcome === 'underway') { noteStart.textContent = 'That game is already underway.'; return; }
      enterRoom(code);
    });
  });
};

/* ---------- waiting room --------------------------------------- */
function enterRoom(code) {
  roomCode = code;
  localStorage.setItem('gubs.room', code);
  elStart.style.display = 'none';
  elWaiting.style.display = '';
  elCode.textContent = code;

  if (unsub) unsub();
  unsub = listen('rooms/' + code, function (room) {
    if (!room || !room.meta) { leave(); return; }

    if (room.meta.status === 'playing' || room.meta.status === 'finished') {
      location.href = 'game.html?room=' + code;
      return;
    }

    var players = room.players || {};
    var ids = Object.keys(players).sort(function (a, b) { return players[a].seat - players[b].seat; });

    elSeats.innerHTML = '';
    for (var s = 0; s < MAX_PLAYERS; s++) {
      var pid = ids.filter(function (i) { return players[i].seat === s; })[0];
      var li = document.createElement('li');
      if (!pid) {
        li.className = 'empty';
        li.innerHTML = '<span class="pip"></span><span class="who">Waiting\u2026</span>' +
                       '<span class="tag">seat ' + (s + 1) + '</span>';
      } else {
        var tags = [];
        if (pid === room.meta.hostId) tags.push('host');
        if (pid === myId()) tags.push('you');
        li.innerHTML = '<span class="pip"></span>' +
                       '<span class="who"></span>' +
                       '<span class="tag">' + (tags.join(' \u00b7 ') || ('seat ' + (s + 1))) + '</span>';
        li.querySelector('.who').textContent = players[pid].name;
      }
      elSeats.appendChild(li);
    }

    var isHost = room.meta.hostId === myId();
    var enough = ids.length >= 2;
    btnStart.style.display = isHost ? '' : 'none';
    btnStart.disabled = !enough;
    elCodeSub.textContent = ids.length + ' of ' + MAX_PLAYERS + ' seats taken';
    noteWait.textContent = isHost
      ? (enough ? '' : 'You need at least one more player.')
      : '';
    if (!isHost) noteWait.textContent = 'Waiting for the host to deal.';

    btnStart.onclick = function () {
      btnStart.disabled = true;
      noteWait.textContent = 'Dealing\u2026';
      readOnce('rooms/' + code).then(function (fresh) {
        if (!fresh || !fresh.players) { btnStart.disabled = false; return; }
        dealAndStart(code, fresh.players);
      });
    };
  });
}

function leave() {
  if (unsub) { unsub(); unsub = null; }
  if (roomCode) removeNode('rooms/' + roomCode + '/players/' + myId());
  localStorage.removeItem('gubs.room');
  roomCode = null;
  elWaiting.style.display = 'none';
  elStart.style.display = '';
}
document.getElementById('btnLeave').onclick = leave;

/* ==================================================================
   SETUP — exactly as the rules sheet describes it
   ================================================================== */
function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

function dealAndStart(code, players) {
  /* Seats may have gaps if someone left, so renumber them 0..n-1 here.
     The table advances turns with (seat + 1) % seatCount and would skip
     anyone sitting past the end. */
  var ids = Object.keys(players).sort(function (a, b) {
    return (players[a].seat - players[b].seat) || (players[a].joinedAt - players[b].joinedAt);
  });
  var n = ids.length;
  if (n < 2 || n > MAX_PLAYERS) { noteWait.textContent = 'Need 2 to 4 players.'; btnStart.disabled = false; return; }

  var deck = buildDeck();

  /* 1. Pull one plain Gub per player out of the deck. Each starts in play. */
  var starters = [];
  for (var i = 0; i < n; i++) {
    var idx = deck.indexOf('gub#' + i);
    starters.push(deck.splice(idx, 1)[0]);
  }

  /* 2. Set the three Letter cards aside, then shuffle everything else. */
  var letters = ['G#0', 'U#0', 'B#0'];
  deck = deck.filter(function (u) { return letters.indexOf(u) === -1; });
  shuffle(deck);

  /* 3. Deal three each. Any Event dealt goes back in and is replaced. */
  var hands = {}, benched = [];
  ids.forEach(function (pid) { hands[pid] = []; });
  ids.forEach(function (pid) {
    while (hands[pid].length < 3) {
      var c = deck.shift();
      if (!c) break;
      if (cardDef(c).type === 'event') benched.push(c);
      else hands[pid].push(c);
    }
  });
  benched.forEach(function (c) { deck.splice(randInt(0, deck.length), 0, c); });

  /* 4. Slide the letters back in: one near the top, one in the middle,
        one near the bottom. */
  var L = shuffle(letters.slice());
  var spots = [
    randInt(3, Math.max(4, Math.floor(deck.length * 0.28))),
    randInt(Math.floor(deck.length * 0.38), Math.floor(deck.length * 0.62)),
    randInt(Math.floor(deck.length * 0.74), deck.length)
  ].sort(function (a, b) { return b - a; });
  spots.forEach(function (pos, k) { deck.splice(pos, 0, L[k]); });

  /* ---- assemble the room state ---- */
  var tableau = {}, seating = {};
  ids.forEach(function (pid, k) {
    seating['players/' + pid + '/seat'] = k;
    tableau[pid] = {
      gubs: { g0: { card: starters[k], cardId: 'gub', barricade: null, barricadeId: null, trap: null } },
      traps: null
    };
  });

  var firstSeat = randInt(0, n - 1);
  var firstName = players[ids[firstSeat]].name;

  var payload = {
    'deck': deck,
    'discard': null,
    'hands': hands,
    'tableau': tableau,
    'pending': null,
    'state': {
      phase: 'draw',
      turnSeat: firstSeat,
      seatCount: n,
      letters: null,
      skipped: null,
      winner: null,
      log: [
        { t: Date.now(), text: firstName + ' goes first.' },
        { t: Date.now(), text: 'The colony wakes. ' + n + ' players, ' + deck.length + ' cards in the deck.' }
      ]
    },
    'meta/status': 'playing',
    'meta/startedAt': Date.now()
  };
  Object.keys(seating).forEach(function (k) { payload[k] = seating[k]; });

  updateAsync('rooms/' + code, payload).then(function () {
    location.href = 'game.html?room=' + code;
  });
}

/* ---------- come back to a room you were already in ------------- */
(function autoRejoin() {
  var last = localStorage.getItem('gubs.room');
  if (!last) return;
  readOnce('rooms/' + last).then(function (room) {
    if (!room || !room.meta) { localStorage.removeItem('gubs.room'); return; }
    if (!room.players || !room.players[myId()]) { localStorage.removeItem('gubs.room'); return; }
    if (room.meta.status === 'playing') { location.href = 'game.html?room=' + last; return; }
    enterRoom(last);
  });
})();
