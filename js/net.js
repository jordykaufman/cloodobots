// Links phones together with PeerJS. The host phone listens under a short join code and
// other phones connect to it. PeerJS's free public server only introduces the phones to
// each other; game messages then travel directly between them, encrypted.

import { loadScript, lib } from './util.js';

const PEER_JS = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
const PREFIX = 'cluedo-robot-players-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}
export const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

// Tests point this at a local PeerJS server.
const options = () => Object.assign({ debug: 1 }, window.CRP_PEER_OPTIONS || {});
const retryDelay = n => Math.min(15000, 1000 * 2 ** n);

// onStatus gets 'starting', 'ready', 'waiting' (the code is still held by this phone's
// previous session, usually just after a reload) or 'offline'.
export async function hostLink({ code, onHello, onAction, onLeave, onStatus }) {
  await loadScript(lib('peerjs', PEER_JS));
  let peer = null, closed = false, attempt = 0, timer = null;
  const conns = new Map();

  const reopen = () => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(open, retryDelay(attempt++));
  };
  function open() {
    if (closed) return;
    if (peer) peer.destroy();
    onStatus('starting');
    peer = new window.Peer(PREFIX + code, options());
    peer.on('open', () => { attempt = 0; onStatus('ready'); });
    peer.on('connection', conn => {
      let device = null;
      conn.on('data', msg => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'hello' && typeof msg.device === 'string') {
          device = msg.device.slice(0, 40);
          const old = conns.get(device);
          conns.set(device, conn);
          if (old && old !== conn) old.close();
          onHello(device);
        } else if (msg.t === 'act' && device) {
          onAction(device, msg.action, msg.id);
        }
      });
      const gone = () => {
        if (device && conns.get(device) === conn) { conns.delete(device); onLeave(device); }
      };
      conn.on('close', gone);
      conn.on('error', gone);
    });
    // Losing the introduction server doesn't break links already made.
    peer.on('disconnected', () => { if (!closed && !peer.destroyed) peer.reconnect(); });
    peer.on('error', err => {
      if (closed) return;
      if (err.type === 'unavailable-id') { onStatus('waiting'); reopen(); }
      else if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(err.type)) { onStatus('offline'); reopen(); }
    });
  }
  open();
  return {
    send(device, msg) {
      const c = conns.get(device);
      if (c && c.open) { try { c.send(msg); } catch (e) { /* the close handler tidies up */ } }
    },
    online() {
      return new Set([...conns.entries()].filter(([, c]) => c.open).map(([d]) => d));
    },
    close() {
      closed = true;
      clearTimeout(timer);
      for (const c of conns.values()) c.close();
      if (peer) peer.destroy();
    },
  };
}

// onStatus gets 'connecting', 'connected', 'reconnecting' or 'missing' (no host phone is
// using that code right now).
export async function joinLink({ code, device, onModel, onReply, onStatus }) {
  await loadScript(lib('peerjs', PEER_JS));
  let peer = null, conn = null, closed = false, attempt = 0, timer = null;

  const later = status => {
    if (closed) return;
    onStatus(status || 'reconnecting');
    clearTimeout(timer);
    timer = setTimeout(connect, retryDelay(attempt++));
  };
  function dial() {
    if (conn) { conn.removeAllListeners(); conn.close(); }
    onStatus(attempt ? 'reconnecting' : 'connecting');
    const c = peer.connect(PREFIX + code, { serialization: 'json', reliable: true });
    conn = c;
    c.on('open', () => { attempt = 0; onStatus('connected'); c.send({ t: 'hello', device }); });
    c.on('data', msg => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'model') onModel(msg.model);
      else if (msg.t === 'reply') onReply(msg);
    });
    c.on('close', () => { if (conn === c) later(); });
    c.on('error', () => { if (conn === c) later(); });
  }
  function connect() {
    if (closed) return;
    if (peer && !peer.destroyed && peer.open) return dial();
    if (peer) peer.destroy();
    peer = new window.Peer(options());
    peer.on('open', dial);
    peer.on('disconnected', () => { if (!closed && !peer.destroyed) peer.reconnect(); });
    peer.on('error', err => later(err.type === 'peer-unavailable' ? 'missing' : 'reconnecting'));
  }
  connect();
  const wake = () => {
    if (document.visibilityState === 'visible' && !(conn && conn.open)) { attempt = 0; clearTimeout(timer); connect(); }
  };
  document.addEventListener('visibilitychange', wake);
  return {
    send(action, id) {
      if (conn && conn.open) { conn.send({ t: 'act', action, id }); return true; }
      return false;
    },
    connected: () => !!(conn && conn.open),
    close() {
      closed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      if (conn) conn.close();
      if (peer) peer.destroy();
    },
  };
}
