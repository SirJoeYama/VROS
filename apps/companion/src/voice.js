// Spoken answers through the browser's speech synthesizer. Sentences are
// queued one by one as they stream in, which also avoids Chrome cutting off
// long utterances.
const VOICE_STORE = 'vros.companion.voice';
const synth = window.speechSynthesis;

export class Voice {
  constructor({ onChange = () => {} } = {}) {
    this.onChange = onChange;
    this.pending = 0;
    this.voices = [];
    this.voice = null;
    this.blocked = false; // the browser refused to speak without a user action
    try {
      this.wanted = localStorage.getItem(VOICE_STORE) || '';
    } catch {
      this.wanted = '';
    }
    if (!synth) return;
    const load = (notify = true) => {
      this.voices = synth.getVoices();
      this.voice = this.voices.find((v) => v.name === this.wanted) || pickDefault(this.voices);
      if (notify) this.onChange();
    };
    load(false);
    synth.addEventListener?.('voiceschanged', load);
  }

  get available() {
    return !!synth;
  }

  get speaking() {
    return this.pending > 0;
  }

  choose(name) {
    this.voice = this.voices.find((v) => v.name === name) || pickDefault(this.voices);
    try {
      localStorage.setItem(VOICE_STORE, name);
    } catch {}
  }

  say(text) {
    if (!synth || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) {
      u.voice = this.voice;
      u.lang = this.voice.lang;
    }
    u.rate = 1.05;
    u.pitch = 1.25; // a small creature's voice
    const done = (e) => {
      if (u._done) return;
      u._done = true;
      if (e?.error === 'not-allowed') this.blocked = true;
      this.pending = Math.max(0, this.pending - 1);
      this.onChange();
    };
    u.onstart = () => {
      this.blocked = false;
      this.onChange();
    };
    u.onend = done;
    u.onerror = done;
    this.pending++;
    this.onChange();
    synth.speak(u);
  }

  stop() {
    if (!synth) return;
    synth.cancel();
    this.pending = 0;
    this.onChange();
  }

  // From a real user action (a click, or an XR "select"): browsers only let a
  // page start speaking after one.
  unlock() {
    if (!synth || this._unlocked) return;
    this._unlocked = true;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
    synth.resume?.();
  }
}

// A British English voice if there is one (the butler-assistant feel), else
// any English voice, else whatever the browser defaults to.
function pickDefault(voices) {
  const en = voices.filter((v) => /^en/i.test(v.lang));
  return (
    en.find((v) => /en[-_]GB/i.test(v.lang) && /\bmale\b|daniel|arthur|george|ryan/i.test(v.name)) ||
    en.find((v) => /en[-_]GB/i.test(v.lang)) ||
    en.find((v) => v.default) ||
    en[0] ||
    voices.find((v) => v.default) ||
    null
  );
}
