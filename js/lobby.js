import { net, LOCAL, explain, myId, myName, setMyName, link } from './net.js';

const $ = id => document.getElementById(id);
$('name').value = myName();
$('mode-note').hidden = !LOCAL;
const code = new URLSearchParams(location.search).get('room');
if (code) $('code').value = code;

function name() {
  const n = $('name').value.trim();
  if (!n) { $('error').textContent = 'Enter a name first.'; $('name').focus(); return null; }
  setMyName(n);
  return n;
}
const newCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');

$('create').onclick = async () => {
  const n = name(); if (!n) return;
  try {
    const db = await net();
    let c = newCode();
    while (await db.read(`rooms/${c}/meta`)) c = newCode();
    await db.write(`rooms/${c}`, {
      meta: { host: myId(), status: 'lobby', created: Date.now() },
      seats: { [myId()]: { name: n, at: Date.now() } },
    });
    location.href = link('game.html', { room: c });
  } catch (e) { $('error').textContent = explain(e); }
};

$('join').onclick = async () => {
  const n = name(); if (!n) return;
  const c = $('code').value.trim().toUpperCase();
  if (c.length !== 4) { $('error').textContent = 'Room codes are four letters.'; return; }
  try {
    const db = await net();
    if (!(await db.read(`rooms/${c}/meta`))) { $('error').textContent = `No room called ${c}.`; return; }
    location.href = link('game.html', { room: c });
  } catch (e) { $('error').textContent = explain(e); }
};
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('join').click(); });
