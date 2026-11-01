// Reading steps aloud, and (where the browser allows) listening for "next", "back" and "repeat".

const synth = window.speechSynthesis;

export const canSpeak = Boolean(synth);
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = Boolean(Recognition);

export function getVoices() {
  if (!synth) return [];
  return synth.getVoices().filter((v) => v.lang?.toLowerCase().startsWith((navigator.language || 'en').slice(0, 2)));
}

export function onVoicesChanged(fn) {
  if (synth) synth.addEventListener?.('voiceschanged', fn);
}

let speakingListeners = [];
export function onSpeakingChange(fn) {
  speakingListeners.push(fn);
}
const setSpeaking = (on) => speakingListeners.forEach((fn) => fn(on));

export function stopSpeaking() {
  if (synth) synth.cancel();
  setSpeaking(false);
}

// Speaks text. onWord(charIndex) is called as each word starts, for highlighting.
export function speak(text, { rate = 0.85, voiceURI = '', onWord, onEnd } = {}) {
  if (!synth || !text) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  const voice = synth.getVoices().find((v) => v.voiceURI === voiceURI);
  if (voice) u.voice = voice;
  u.onboundary = (e) => {
    if (onWord && (e.name === 'word' || e.name === undefined)) onWord(e.charIndex);
  };
  u.onstart = () => setSpeaking(true);
  u.onend = u.onerror = () => {
    setSpeaking(false);
    onEnd?.();
  };
  // Safari sometimes ignores speak() right after cancel(); a short pause avoids that.
  setTimeout(() => synth.speak(u), 60);
}

const COMMANDS = [
  ['next', /\b(next|continue|go on|forward|done)\b/],
  ['back', /\b(back|previous|go back|last one)\b/],
  ['repeat', /\b(repeat|again|say that again|what)\b/],
  ['stop', /\b(stop|quiet|be quiet|hush)\b/],
];

// Listens for spoken commands until stop() is called.
export function startListening(onCommand, onStatus) {
  if (!Recognition) return { stop() {}, pause() {}, resume() {} };
  let wanted = true;
  let paused = false;
  let rec = null;
  const begin = () => {
    if (!wanted || paused) return;
    rec = new Recognition();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = e.results[e.results.length - 1][0].transcript.toLowerCase();
      const hit = COMMANDS.find(([, re]) => re.test(said));
      if (hit) onCommand(hit[0]);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wanted = false;
        onStatus?.('blocked');
      }
    };
    rec.onend = () => setTimeout(begin, 300);
    try {
      rec.start();
      onStatus?.('listening');
    } catch {
      // Already started.
    }
  };
  begin();
  return {
    stop() {
      wanted = false;
      rec?.abort();
      onStatus?.('off');
    },
    // Paused while the app is talking, so it doesn't hear itself say "next".
    pause() {
      paused = true;
      rec?.abort();
    },
    resume() {
      if (!paused) return;
      paused = false;
      begin();
    },
  };
}
