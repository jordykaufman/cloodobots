// Reads envelope cards with the camera without ever showing them. The camera picture is
// drawn only to off-screen canvases; the screen shows progress and nothing else.

import { grayFromRGBA, shrink, findCard, cutOut, band, crop, textBoxes, nameSpot, READ_PLAN, TURNS, sideways } from './vision.js';
import { matchCard, isSure } from './match.js';
import { loadScript, sleep, lib } from './util.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';

export function cameraAvailable() {
  return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

async function openCamera() {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
}

let readerPromise = null;
async function reader(onProgress) {
  if (!readerPromise) {
    readerPromise = (async () => {
      await loadScript(lib('tesseract', TESSERACT));
      return window.Tesseract.createWorker('eng', 1, {
        ...((window.CRP_LIBS && window.CRP_LIBS.tesseractOptions) || {}),
        logger: m => { if (m && typeof m.progress === 'number' && /load|init/i.test(m.status || '')) onProgress(m.progress); },
      });
    })();
    readerPromise.catch(() => { readerPromise = null; });
  }
  return readerPromise;
}

// Calls onCard(card) each time a card has been read the same way twice in a row.
// onStatus gets 'loading' (with a 0-1 progress), 'looking' (no card in view) or 'reading'.
export async function startScanner({ cards, onStatus, onCard }) {
  onStatus('loading', 0);
  const [stream, worker] = await Promise.all([openCamera(), reader(p => onStatus('loading', p))]);

  // The video has to be on the page for some phones to keep delivering frames, so it
  // sits in a corner, two pixels wide and invisible.
  const video = document.createElement('video');
  video.className = 'scan-video';
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-hidden', 'true');
  document.body.appendChild(video);
  video.srcObject = stream;
  await video.play().catch(() => {});

  const track = stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  const torch = {
    available: !!caps.torch,
    on: false,
    async set(on) {
      if (!this.available) return false;
      try { await track.applyConstraints({ advanced: [{ torch: on }] }); this.on = on; return true; } catch (e) { return false; }
    },
  };

  const frame = document.createElement('canvas');
  const fctx = frame.getContext('2d', { willReadFrequently: true });
  const out = document.createElement('canvas');
  const octx = out.getContext('2d');
  let running = true, mode = null, last = null, lucky = null;

  const read = async img => {
    out.width = img.w; out.height = img.h;
    const data = octx.createImageData(img.w, img.h);
    for (let i = 0, j = 0; i < img.gray.length; i++, j += 4) {
      const v = img.gray[i];
      data.data[j] = data.data[j + 1] = data.data[j + 2] = v;
      data.data[j + 3] = 255;
    }
    octx.putImageData(data, 0, 0);
    const res = (await worker.recognize(out, {}, { text: true, blocks: true })).data;
    const words = (res.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words)));
    return { text: res.text, words };
  };

  const tryRead = async (img, m) => {
    if (mode !== m) { await worker.setParameters({ tessedit_pageseg_mode: m }); mode = m; }
    const r = await read(img);
    return matchCard(r.text, cards, r.words);
  };
  // Reads the card's name: first from boxes that look like a line of text near the
  // bottom of the card, then from the spot where names are usually printed, each way
  // up, starting with the way that worked last time; then wider bands as a last resort.
  const readCard = async (full, box) => {
    const cuts = new Map();
    const cut = t => { if (!cuts.has(t)) cuts.set(t, cutOut(full, box, t)); return cuts.get(t); };
    const order = lucky == null ? TURNS : [lucky, ...TURNS.filter(t => t !== lucky)];
    for (const turn of order) {
      if (!running) return null;
      const card = cut(turn);
      for (const b of textBoxes(card)) {
        const m = await tryRead(crop(card, b), '7');
        if (m) { lucky = turn; return m; }
      }
      if (!sideways(turn)) {
        const m = await tryRead(crop(card, nameSpot(card), 0, 0), '7');
        if (m) { lucky = turn; return m; }
      }
    }
    for (const step of READ_PLAN) {
      if (!running) return null;
      const m = await tryRead(band(cut(step.turn), step.top, step.bottom), step.mode);
      if (m) { lucky = step.turn; return m; }
    }
    return null;
  };

  (async () => {
    while (running) {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) { await sleep(150); continue; }
      frame.width = w; frame.height = h;
      fctx.drawImage(video, 0, 0, w, h);
      const full = grayFromRGBA(fctx.getImageData(0, 0, w, h).data, w, h);
      const small = shrink(full, 320);
      const f = findCard(small);
      if (!f) { last = null; onStatus('looking'); await sleep(150); continue; }
      onStatus('reading');
      const s = small.scale;
      const box = { cx: f.cx * s + (s - 1) / 2, cy: f.cy * s + (s - 1) / 2, angle: f.angle, long: f.long * s, short: f.short * s };
      const hit = await readCard(full, box);
      if (!running) break;
      if (hit && (last === hit.card.id || isSure(hit))) { last = null; onCard(hit.card); }
      else last = hit ? hit.card.id : null;
    }
  })();

  return {
    torch,
    stop() {
      running = false;
      stream.getTracks().forEach(t => t.stop());
      video.remove();
    },
  };
}

// Sounds and speech for when the phone is face-down. Browsers only allow sound after a
// tap, so call unlock() from the button that starts scanning.
export function makeVoice() {
  let ctx = null;
  const tone = (freq, at, dur) => {
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq;
    o.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime + at;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
  };
  const say = text => {
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch (e) { /* no speech on this phone */ }
  };
  const buzz = pattern => { try { navigator.vibrate && navigator.vibrate(pattern); } catch (e) { /* ignore */ } };
  return {
    unlock() {
      try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); } catch (e) { ctx = null; }
      say('');
    },
    got(text) { tone(880, 0, 0.18); buzz(120); say(text); },
    done(text) { tone(660, 0, 0.15); tone(880, 0.17, 0.15); tone(1175, 0.34, 0.3); buzz([120, 80, 120]); say(text); },
    oops(text) { tone(330, 0, 0.25); buzz([60, 60, 60]); say(text); },
    say,
  };
}
