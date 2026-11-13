import { net, LOCAL, explain, myId, myName, setMyName, link } from './net.js';
import { CARDS, HAND_LIMIT, MIN_PLAYERS, MAX_PLAYERS, typeOf, nameOf, def } from './cards.js';
import { newGame, applyAction, getPlayOptions, responseCards, stackStatus, score, mustDraw } from './engine.js';

const app = document.getElementById('app');
const room = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
const me = myId();
let db, data = undefined, S = null;
// Local-only interaction state (never synced).
let ui = { sel: null, discard: null, order: [] };
let seenDraw = null;      // last draw number already flashed on this screen

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nameFor = pid => pid === me ? 'You' : esc((S.players.find(p => p.id === pid) || {}).name || '?');
const list = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a.at(-1);

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3200);
}

// ---------- networking ----------

async function start() {
  if (!room) { location.href = link('index.html'); return; }
  try { db = await net(); } catch (e) { app.innerHTML = `<p class="loading">${esc(explain(e))}</p>`; return; }
  db.watch(`rooms/${room}`, v => {
    data = v;
    S = v && v.game ? JSON.parse(v.game.json) : null;
    pruneUi();
    render();
    flashDraw();
  }, e => { app.innerHTML = `<p class="loading">${esc(explain(e))}</p>`; });
}

async function act(action) {
  let error = null;
  try {
    await db.transact(`rooms/${room}/game`, cur => {
      if (!cur) return cur;
      const r = applyAction(JSON.parse(cur.json), me, action);
      if (r.error) { error = r.error; return undefined; }
      error = null;
      return { v: (cur.v || 0) + 1, json: JSON.stringify(r.state) };
    });
  } catch (e) { error = explain(e); }
  if (error) toast(error);
  return !error;
}

async function joinSeat(name) {
  setMyName(name);
  let full = false;
  await db.transact(`rooms/${room}/seats`, seats => {
    seats = seats || {};
    if (seats[me]) { seats[me].name = name; return seats; }
    if (Object.keys(seats).length >= MAX_PLAYERS) { full = true; return undefined; }
    seats[me] = { name, at: Date.now() };
    return seats;
  });
  if (full) toast('That room is full.');
}

async function startGame() {
  const seats = Object.entries(data.seats || {}).sort((a, b) => a[1].at - b[1].at);
  if (seats.length < MIN_PLAYERS) return;
  const s = newGame(seats.map(([id, v]) => ({ id, name: v.name })));
  await db.write(`rooms/${room}/game`, { v: 1, json: JSON.stringify(s) });
  await db.write(`rooms/${room}/meta/status`, 'playing');
}

// Flash the card that was just drawn in the middle of the screen, then fade it out.
// The drawer sees their card; Events and Letters are shown to everyone; otherwise the card back.
function flashDraw() {
  const d = S && S.lastDraw, n = d ? d.n : 0;
  if (seenDraw === null || !d || n <= seenDraw) { seenDraw = n; return; }   // nothing new (or first load / new game)
  seenDraw = n;
  const face = d.open || d.by === me;
  const who = d.by === me ? 'You drew' : `${nameFor(d.by)} drew`;
  const el = document.getElementById('flash');
  el.innerHTML = `<figure><img src="${img(face ? typeOf(d.card) : 'back')}" alt=""><figcaption>${who}${face ? ' ' + esc(nameOf(d.card)) : ''}</figcaption></figure>`;
  el.hidden = false;
  clearTimeout(flashDraw.t); flashDraw.t = setTimeout(() => { el.hidden = true; el.innerHTML = ''; }, 1700);
}

// ---------- rendering ----------

const img = t => `cards/${t}.jpg`;
function cardHtml(id, cls = '', style = '') {
  const t = typeOf(id);
  return `<button type="button" class="card ${cls}" data-id="${id}" style="${style}" aria-label="${esc(CARDS[t].name)}"><img src="${img(t)}" alt="" draggable="false"></button>`;
}

function render() {
  if (data === undefined) return;
  if (!data || !data.meta) { app.innerHTML = `<div class="panel center-panel"><h2>No room called ${esc(room)}</h2><a class="btn" href="${link('index.html')}">Back</a></div>`; return; }
  if (data.meta.status === 'lobby' || !S) return renderLobby();
  if (!S.players.some(p => p.id === me)) {
    app.innerHTML = `<div class="panel center-panel"><h2>Room ${esc(room)}</h2><p>This game has already started without you.</p><a class="btn" href="${link('index.html')}">Back</a></div>`;
    return;
  }
  renderTable();
}

function renderLobby() {
  const seats = Object.entries(data.seats || {}).sort((a, b) => a[1].at - b[1].at);
  const seated = !!(data.seats || {})[me];
  const host = data.meta.host === me;
  const url = location.origin + location.pathname.replace('game.html', 'index.html') + '?room=' + room;
  app.innerHTML = `
  <div class="panel center-panel lobby">
    <h1 class="logo small">Gubs</h1>
    <p class="room-code">Room <strong>${esc(room)}</strong></p>
    <p class="note">Share the code, or this link: <br><input class="share" readonly value="${esc(url)}" aria-label="Invite link"></p>
    <ul class="seats">
      ${seats.map(([id, v]) => `<li>${esc(v.name)}${id === data.meta.host ? ' <span class="tag">host</span>' : ''}${id === me ? ' <span class="tag you">you</span>' : ''}</li>`).join('')}
    </ul>
    ${seated ? '' : `<div class="join-row"><input id="jn" maxlength="16" placeholder="Your name" value="${esc(myName())}" aria-label="Your name"><button class="btn primary" data-act="join">Sit down</button></div>`}
    ${host ? `<button class="btn primary" data-act="start" ${seats.length < MIN_PLAYERS ? 'disabled' : ''}>Start game</button>
              <p class="note">${seats.length < MIN_PLAYERS ? 'Waiting for at least one more player.' : `${seats.length} players ready.`}</p>`
           : `<p class="note">Waiting for the host to start.</p>`}
    ${LOCAL ? '<p class="note">Practice mode: open this page in another tab with <code>&amp;as=2</code> added to the address to sit down as a second player.</p>' : ''}
  </div>`;
}

function stackHtml(st, targets, picked) {
  const status = stackStatus(st);
  const cls = id => (targets.includes(id) ? 'target ' : '') + (picked.includes(id) ? 'picked ' : '');
  let cards = '';
  if (status === 'ring') {
    cards += cardHtml(st.top, 'top ' + cls(st.top), 'left:0;top:0');
    st.gubs.forEach((g, i) => { cards += cardHtml(g, cls(g), `left:calc(var(--cw)*${0.42 * (i + 1)});top:calc(var(--cw)*0.34)`); });
    return `<div class="stack ring" style="--n:${st.gubs.length}" data-status="${status}">${cards}</div>`;
  }
  cards += cardHtml(st.gubs[0], cls(st.gubs[0]), 'left:0;top:0');
  if (st.top) cards += cardHtml(st.top, 'top ' + cls(st.top), 'left:calc(var(--cw)*0.26);top:calc(var(--cw)*0.4)');
  return `<div class="stack ${st.top ? 'covered' : ''}" data-status="${status}">${cards}</div>`;
}

function currentTargets() {
  const sel = ui.sel;
  if (!sel || !sel.opt) return { cards: [], players: [] };
  const t = sel.opt.target;
  return { cards: t.type === 'card' ? t.candidates : [], players: t.type === 'player' ? t.candidates : [] };
}

function promptHtml() {
  const turnPid = S.players[S.turn].id, myTurn = turnPid === me;
  const p = S.pending;
  const btn = (act, label, extra = '', cls = '') => `<button class="btn ${cls}" data-act="${act}" ${extra}>${label}</button>`;

  if (S.phase === 'ended') return '';
  // Messages about other people's business are only shown on my own turn.
  const idle = html => (myTurn ? html : '');

  if (p) {
    const iWait = p.waiting.includes(me);
    const who = list(p.waiting.map(nameFor));
    if (p.kind === 'window') {
      const what = `${nameFor(p.by)} played <strong>${esc(CARDS[p.as].name)}</strong>${typeOf(p.card) === 'cricket_song' ? ' (Cricket Song)' : ''}${targetWords(p)}.`;
      if (!iWait) return idle(`<p class="say">${what} Waiting for ${who} to respond…</p>`);
      return `<p class="say">${what} Cancel it?</p><div class="btns">${responseCards(S, me).map(c =>
        btn('respond', `Play ${esc(nameOf(c))}`, `data-card="${c}"`, 'primary')).join('')}${btn('respond', 'Let it happen')}</div>`;
    }
    if (p.kind === 'event') {
      const ev = `<strong>${esc(nameOf(p.card))}</strong>`;
      if (p.stage === 'flop') {
        if (!iWait) return idle(`<p class="say">${nameFor(p.by)} drew ${ev}. Waiting for ${who}…</p>`);
        return `<p class="say">${nameFor(p.by)} drew ${ev}. Shuffle it back into the deck?</p><div class="btns">${responseCards(S, me).map(c =>
          btn('respond', `Play ${esc(nameOf(c))}${typeOf(c) === 'cricket_song' ? ' as Flop Boat' : ''}`, `data-card="${c}"`, 'primary')).join('')}${btn('respond', 'Let it happen')}</div>`;
      }
      if (!iWait) return idle(`<p class="say">${ev}! Waiting for ${who}…</p>`);
      return `<p class="say">${ev}! Every hand is shuffled into the deck. Protect yours?</p><div class="btns">${responseCards(S, me).map(c =>
        btn('respond', `Play ${esc(nameOf(c))}${typeOf(c) === 'cricket_song' ? ' as Age-Old Cure' : ''}`, `data-card="${c}"`, 'primary')).join('')}${btn('respond', 'Lose my hand')}</div>`;
    }
    if (p.kind === 'merchant') {
      if (!iWait) return idle(`<p class="say"><strong>Traveling Merchant</strong>! Waiting for ${who} to choose a card to keep…</p>`);
      return `<p class="say"><strong>Traveling Merchant</strong>! Click the one card in your hand you want to keep. The rest go to the player on your right.</p>`;
    }
    if (p.kind === 'rearrange') {
      if (!iWait) return idle(`<p class="say">${nameFor(p.by)} is rearranging the top of the deck…</p>`);
      const left = p.cards.filter(c => !ui.order.includes(c));
      return `<p class="say">Scout: click the cards in the order they should be drawn (first click = top of the deck).</p>
        <div class="peek">${p.cards.map(c => cardHtml(c, ui.order.includes(c) ? 'used' : 'target', '')
          .replace('</button>', ui.order.includes(c) ? `<span class="badge">${ui.order.indexOf(c) + 1}</span></button>` : '</button>')).join('')}</div>
        <div class="btns">${btn('rearrange', 'Confirm order', left.length ? 'disabled' : '', 'primary')}${btn('reorder', 'Start over', ui.order.length ? '' : 'disabled')}</div>`;
    }
  }

  if (!myTurn) return '';

  if (ui.discard) {
    const need = S.hands[me].length - HAND_LIMIT;
    return `<p class="say">Choose ${need} card${need > 1 ? 's' : ''} to discard (${ui.discard.length}/${need}).</p>
      <div class="btns">${btn('confirmDiscard', 'Discard and end turn', ui.discard.length === need ? '' : 'disabled', 'primary')}${btn('cancel', 'Cancel')}</div>`;
  }
  if (ui.sel) {
    const sel = ui.sel, n = esc(nameOf(sel.card));
    if (!sel.opt) {
      return `<p class="say"><strong>${n}</strong>: ${esc(def(sel.card).text)}</p>
        <div class="btns">${sel.options.map((o, i) => btn('opt', esc(o.label), `data-i="${i}"`, 'primary')).join('')}${btn('cancel', 'Cancel')}</div>`;
    }
    const t = sel.opt.target;
    if (t.type === 'player') {
      return `<p class="say"><strong>${n}</strong>: ${esc(sel.opt.label)}. Choose a player.</p>
        <div class="btns">${t.candidates.map(pid => btn('pickPlayer', nameFor(pid), `data-pid="${pid}"`, 'primary')).join('')}${btn('cancel', 'Cancel')}</div>`;
    }
    const range = t.min !== t.max;
    return `<p class="say"><strong>${n}</strong>: ${esc(sel.opt.label)}. ${range ? 'Click the cards to take back (a whole stack comes with each).' : `Click ${t.min > 1 ? t.min + ' glowing cards' : 'a glowing card'}${t.min > 1 ? ` (${sel.picked.length}/${t.min})` : ''}.`}</p>
      <div class="btns">${range ? btn('confirmTargets', 'Confirm', sel.picked.length ? '' : 'disabled', 'primary') + btn('pickAll', 'Take everything') : ''}${btn('cancel', 'Cancel')}</div>`;
  }

  const must = mustDraw(S, me);
  const canDraw = !S.drew && !S.played && S.deck.length > 0;
  const say = must ? 'You skipped your draw last turn, so you must draw.'
    : canDraw ? 'Draw, or play a card (no drawing after you play).'
    : 'Play cards, or end your turn.';
  // End turn lives in the corner of the player's own area (see renderTable).
  return `<p class="say">${say}</p>${canDraw ? `<div class="btns">${btn('draw', 'Draw', '', 'primary')}</div>` : ''}`;
}

function targetWords(p) {
  if (!p.targets.length) return '';
  if (S.hands[p.targets[0]] !== undefined) return ` on ${p.targets[0] === me ? 'you' : nameFor(p.targets[0])}`;
  const owners = [...new Set(p.targets.map(c => S.players.find(pl => S.table[pl.id].some(st => st.top === c || st.gubs.includes(c)))).filter(Boolean).map(pl => pl.id))];
  return ` on ${list(p.targets.map(c => esc(nameOf(c))))} (${list(owners.map(o => o === me ? 'yours' : nameFor(o) + "'s"))})`;
}

function renderTable() {
  // Remember where the log was scrolled to, so reading back through it isn't interrupted by updates.
  const oldLog = app.querySelector('.log');
  const pinned = !oldLog || oldLog.scrollHeight - oldLog.scrollTop - oldLog.clientHeight < 24;
  const oldTop = oldLog ? oldLog.scrollTop : 0;
  const tg = currentTargets();
  const picked = ui.sel ? ui.sel.picked : [];
  const turnPid = S.players[S.turn].id;
  const myIdx = S.players.findIndex(p => p.id === me);
  // Opponents in turn order starting from the player after me.
  const opps = S.players.map((_, i) => S.players[(myIdx + 1 + i) % S.players.length]).filter(p => p.id !== me);
  const waiting = S.pending ? S.pending.waiting : [];

  const badge = pid => (S.phase !== 'playing' ? ''
    : waiting.includes(pid) ? `<span class="tag deciding">${pid === me ? 'your move' : 'deciding…'}</span>`
    : pid === turnPid ? `<span class="tag turn">${pid === me ? 'your turn' : 'their turn'}</span>` : '');
  const seat = p => `
    <section class="seat ${p.id === turnPid ? 'active' : ''} ${waiting.includes(p.id) ? 'waiting' : ''}">
      <header><h3>${esc(p.name)}</h3>${badge(p.id)}
        <span class="pill score" title="Free and Protected Gubs">${score(S, p.id)} Gub${score(S, p.id) === 1 ? '' : 's'}</span>
        <span class="pill" title="Cards in hand">${S.hands[p.id].length} in hand</span></header>
      <div class="stacks">${S.table[p.id].map(st => stackHtml(st, tg.cards, picked)).join('') || '<p class="empty">No cards in play</p>'}</div>
    </section>`;

  const hand = S.hands[me];
  const merchant = S.pending && S.pending.kind === 'merchant' && waiting.includes(me);
  const myTurn = turnPid === me && !S.pending && S.phase === 'playing';
  const handCls = c => {
    if (ui.discard) return 'target ' + (ui.discard.includes(c) ? 'picked' : '');
    if (merchant) return 'target';
    if (ui.sel) return ui.sel.card === c ? 'selected' : 'dim';
    if (myTurn && !mustDraw(S, me)) return getPlayOptions(S, me, c).length ? 'playable' : '';
    return '';
  };
  const top = S.discard.at(-1);
  const prompt = promptHtml();
  const letters = ['G', 'U', 'B'].map(l => {
    const got = S.letters.some(c => typeOf(c) === l);
    return `<span class="letter ${got ? 'got' : ''}">${l}</span>`;
  }).join('');

  app.innerHTML = `
  <div class="table">
    <header class="topbar">
      <span class="logo tiny">Gubs</span>
      <span class="room">Room ${esc(room)}</span>
      <span class="letters" title="The game ends when the third Letter is drawn" aria-label="Letters drawn: ${S.letters.length} of 3">${letters}</span>
    </header>

    <div class="opponents n${opps.length}">${opps.map(seat).join('')}</div>

    <div class="middle">
      <div class="piles">
        <div class="pile"><div class="card static"><img src="${img('back')}" alt="Deck"></div><span>Deck · ${S.deck.length}</span></div>
        <div class="pile">${top ? cardHtml(top, 'static') : '<div class="card static ghost"></div>'}<span>Discard · ${S.discard.length}</span></div>
      </div>
      <div class="prompt-slot" aria-live="polite">${prompt ? `<div class="prompt panel">${prompt}</div>` : ''}</div>
      <ol class="log panel" aria-label="Game log">${S.log.map(l => `<li>${esc(l)}</li>`).join('')}</ol>
    </div>

    <section class="seat mine ${turnPid === me ? 'active' : ''} ${waiting.includes(me) ? 'waiting' : ''}">
      <header><h3>${esc((S.players[myIdx] || {}).name)} <span class="tag you">you</span></h3>${badge(me)}
        <span class="pill score">${score(S, me)} Gub${score(S, me) === 1 ? '' : 's'}</span>
        ${myTurn && !ui.discard && !mustDraw(S, me) ? '<button class="btn end-turn" data-act="endTurn">End turn</button>' : ''}</header>
      <div class="stacks">${S.table[me].map(st => stackHtml(st, tg.cards, picked)).join('') || '<p class="empty">No cards in play</p>'}</div>
      <div class="hand" aria-label="Your hand">${hand.map(c => cardHtml(c, handCls(c))).join('') || '<p class="empty">Your hand is empty</p>'}</div>
    </section>
  </div>
  ${overlayHtml()}`;

  const lg = app.querySelector('.log'); if (lg) lg.scrollTop = pinned ? lg.scrollHeight : oldTop;
}

function overlayHtml() {
  if (S.reveal && S.reveal.to === me) {
    return `<div class="overlay"><div class="panel modal"><h2>${nameFor(S.reveal.of)}'s hand</h2>
      <div class="peek">${S.reveal.cards.map(c => cardHtml(c, 'static')).join('')}</div>
      <button class="btn primary" data-act="dismiss">Done</button></div></div>`;
  }
  if (S.phase === 'ended') {
    const r = S.result;
    const rows = [...S.players].sort((a, b) => r.scores[b.id] - r.scores[a.id]).map(p =>
      `<tr class="${r.winners.includes(p.id) ? 'win' : ''}"><td>${esc(p.name)}${p.id === me ? ' (you)' : ''}</td><td>${r.scores[p.id]}</td><td>${S.hands[p.id].length} in hand</td></tr>`).join('');
    return `<div class="overlay"><div class="panel modal"><h2>${list(r.winners.map(w => w === me ? 'You' : nameFor(w)))} win${r.winners.length === 1 && r.winners[0] !== me ? 's' : ''}!</h2>
      <p class="note">Decided by ${esc(r.reason)}.</p>
      <table class="scores"><tbody>${rows}</tbody></table>
      ${data.meta.host === me ? '<button class="btn primary" data-act="start">Play again</button>' : '<p class="note">The host can start another game.</p>'}
      <a class="btn" href="${link('index.html')}">Leave</a></div></div>`;
  }
  return '';
}

// Drop local selections that no longer make sense after a state change.
function pruneUi() {
  if (!S || S.phase !== 'playing') { ui = { sel: null, discard: null, order: [] }; return; }
  const myTurn = S.players[S.turn].id === me && !S.pending;
  if (!myTurn) { ui.sel = null; ui.discard = null; }
  if (ui.sel && !S.hands[me].includes(ui.sel.card)) ui.sel = null;
  if (!(S.pending && S.pending.kind === 'rearrange')) ui.order = [];
}

// ---------- input ----------

async function submitPlay(targets) {
  const { card, opt } = ui.sel;
  ui.sel = null;
  if (!(await act({ type: 'play', card, as: opt.as, mode: opt.mode, targets }))) render();
}

function chooseOption(opt) {
  ui.sel.opt = opt; ui.sel.picked = [];
  if (opt.target.type === 'none') return submitPlay([]);
  render();
}

function clickCard(id, inHand) {
  if (!S || S.phase !== 'playing') return;
  const p = S.pending;
  if (p && p.waiting.includes(me)) {
    if (p.kind === 'merchant' && inHand) act({ type: 'keep', card: id });
    if (p.kind === 'rearrange' && p.cards.includes(id) && !ui.order.includes(id)) { ui.order.push(id); render(); }
    return;
  }
  if (p || S.players[S.turn].id !== me) return;

  if (ui.discard) {
    if (!inHand) return;
    const need = S.hands[me].length - HAND_LIMIT;
    if (ui.discard.includes(id)) ui.discard = ui.discard.filter(c => c !== id);
    else if (ui.discard.length < need) ui.discard.push(id);
    return render();
  }
  if (ui.sel && ui.sel.opt && !inHand) {
    const t = ui.sel.opt.target;
    if (t.type !== 'card' || !t.candidates.includes(id)) return;
    const pk = ui.sel.picked;
    if (pk.includes(id)) ui.sel.picked = pk.filter(c => c !== id);
    else if (pk.length < t.max) pk.push(id);
    if (t.min === t.max && ui.sel.picked.length === t.max) return submitPlay(ui.sel.picked);
    return render();
  }
  if (inHand) {
    if (ui.sel && ui.sel.card === id) { ui.sel = null; return render(); }
    if (mustDraw(S, me)) return toast('Draw first: you skipped your draw last turn.');
    const options = getPlayOptions(S, me, id);
    if (!options.length) {
      const k = def(id).kind;
      return toast(k === 'interrupt' ? `${nameOf(id)} is played in response to another card.` : `${nameOf(id)} has nothing to affect right now.`);
    }
    ui.sel = { card: id, options, opt: null, picked: [] };
    // One way to play it that needs a target: go straight to targeting.
    if (options.length === 1 && options[0].target.type !== 'none') ui.sel.opt = options[0];
    render();
  }
}

app.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b) {
    if (b.disabled) return;
    const a = b.dataset.act;
    if (a === 'join') { const n = document.getElementById('jn').value.trim(); if (n) joinSeat(n); else toast('Enter a name first.'); }
    else if (a === 'start') startGame();
    else if (a === 'draw') act({ type: 'draw' });
    else if (a === 'endTurn') {
      if (S.hands[me].length > HAND_LIMIT) { ui.discard = []; ui.sel = null; render(); }
      else act({ type: 'endTurn', discards: [] });
    }
    else if (a === 'confirmDiscard') { const d = ui.discard; ui.discard = null; act({ type: 'endTurn', discards: d }); }
    else if (a === 'cancel') { ui.sel = null; ui.discard = null; render(); }
    else if (a === 'opt') chooseOption(ui.sel.options[+b.dataset.i]);
    else if (a === 'pickPlayer') submitPlay([b.dataset.pid]);
    else if (a === 'confirmTargets') submitPlay(ui.sel.picked);
    else if (a === 'pickAll') submitPlay([...ui.sel.opt.target.candidates]);
    else if (a === 'respond') act({ type: 'respond', card: b.dataset.card || undefined });
    else if (a === 'rearrange') act({ type: 'rearrange', order: ui.order });
    else if (a === 'reorder') { ui.order = []; render(); }
    else if (a === 'dismiss') act({ type: 'dismissReveal' });
    return;
  }
  const c = e.target.closest('.card[data-id]');
  if (c && !c.classList.contains('static')) clickCard(c.dataset.id, !!c.closest('.hand'));
});

// Enlarged preview so the card text is readable.
const zoom = document.getElementById('zoom');
app.addEventListener('mouseover', e => {
  const c = e.target.closest('.card[data-id]');
  if (!c) { zoom.hidden = true; return; }
  const t = typeOf(c.dataset.id);
  zoom.querySelector('img').src = img(t);
  zoom.querySelector('p').textContent = `${CARDS[t].name}: ${CARDS[t].text}`;
  zoom.hidden = false;
  zoom.classList.toggle('left', e.clientX > innerWidth / 2);
});
app.addEventListener('mouseleave', () => { zoom.hidden = true; });
app.addEventListener('focusin', e => { if (e.target.matches('.share')) e.target.select(); });

start();
