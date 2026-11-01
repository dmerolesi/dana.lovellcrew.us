// Kitchen timers. They keep their end time, so a timer survives the page reloading.
// Each timer can also give a "check it now" alert at the short end of a range.

import { loadTimers, saveTimers, newId } from './storage.js';

let timers = loadTimers();
let listeners = [];
let alertHandler = () => {};

export const getTimers = () => timers;
export const onTimersChange = (fn) => listeners.push(fn);
export const onTimerAlert = (fn) => { alertHandler = fn; };

function changed() {
  saveTimers(timers);
  listeners.forEach((fn) => fn(timers));
}

export function addTimer({ label, seconds, checkSeconds = null, withCheck = true }) {
  const now = Date.now();
  timers.push({
    id: newId(),
    label,
    endAt: now + seconds * 1000,
    checkAt: withCheck && checkSeconds && checkSeconds < seconds ? now + checkSeconds * 1000 : null,
    checkShown: false,
    doneShown: false,
  });
  changed();
}

export function removeTimer(id) {
  timers = timers.filter((t) => t.id !== id);
  changed();
}

export function remaining(t) {
  return Math.max(0, Math.round((t.endAt - Date.now()) / 1000));
}

function tick() {
  const now = Date.now();
  for (const t of timers) {
    if (t.checkAt && !t.checkShown && now >= t.checkAt && now < t.endAt) {
      t.checkShown = true;
      saveTimers(timers);
      alertHandler({ kind: 'check', timer: t });
    }
    if (!t.doneShown && now >= t.endAt) {
      t.doneShown = true;
      saveTimers(timers);
      alertHandler({ kind: 'done', timer: t });
    }
  }
  listeners.forEach((fn) => fn(timers));
}

setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tick());

// A repeating chime made in the browser, so there is no sound file to download.
// Browsers only allow sound after a tap, so unlockSound() runs on the first tap.
let audio = null;
let chime = null;

export function unlockSound() {
  if (audio) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  audio = new Ctx();
  const silent = audio.createBuffer(1, 1, 22050);
  const src = audio.createBufferSource();
  src.buffer = silent;
  src.connect(audio.destination);
  src.start(0);
}

function playTone(freq, start, length) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.9, start + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(audio.destination);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

export function startChime({ repeat = true } = {}) {
  stopChime();
  if (!audio) return;
  audio.resume?.();
  // Lower pitches are easier to hear for many people with age-related hearing loss.
  const ring = () => {
    const t = audio.currentTime;
    playTone(523, t, 0.45);
    playTone(392, t + 0.5, 0.45);
    playTone(523, t + 1.0, 0.6);
  };
  ring();
  navigator.vibrate?.([400, 200, 400]);
  if (repeat) chime = setInterval(ring, 3000);
}

export function stopChime() {
  clearInterval(chime);
  chime = null;
}
