// Speech → text. Two engines behind one interface:
//  - "web": the browser's built-in SpeechRecognition (live partial results).
//  - "whisper": Whisper running on the device in a worker (transformers.js).
//    Used on Quest, where the built-in engine isn't dependable, and as a
//    fallback whenever the built-in engine errors out.
// Callbacks: onInterim(text), onFinal(text), onStatus(text).

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

// 'granted' | 'prompt' | 'denied'. The permission prompt can't show inside an
// immersive session, so the page asks for the mic before entering XR.
export async function micPermission() {
  try {
    return (await navigator.permissions.query({ name: 'microphone' })).state;
  } catch {
    return 'granted'; // can't tell; behave as before
  }
}
const FALLBACK_ERRORS = ['network', 'service-not-allowed', 'language-not-supported'];

export class Speech {
  constructor({ engine, model, onInterim, onFinal, onStatus }) {
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.onStatus = onStatus;
    this.model = model;
    this.active = false;
    this.engine = engine === 'web' && SR ? new WebEngine(this) : new WhisperEngine(this);
  }

  get name() {
    return this.engine.name;
  }

  async start() {
    this.active = true;
    await this.engine.start();
  }

  stop() {
    this.active = false;
    this.engine.stop();
    this.onInterim('');
    this.onStatus('mic off');
  }

  toggle() {
    return this.active ? this.stop() : this.start();
  }

  // Call from a real user action (a click, or an XR "select" such as a
  // pinch). Browsers only let audio start from one, and poking a 3D button
  // doesn't count, so in XR the first pinch is what gets the mic going.
  unlock() {
    this.engine.unlock?.();
  }

  fallBackToWhisper(reason) {
    this.engine.stop();
    this.onStatus(`built-in speech failed (${reason}), switching to on-device Whisper`);
    this.engine = new WhisperEngine(this);
    if (this.active) this.engine.start();
  }
}

class WebEngine {
  constructor(owner) {
    this.name = 'web';
    this.owner = owner;
    const rec = (this.rec = new SR());
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    this.running = false;
    rec.onstart = () => {
      this.running = true;
      owner.onStatus('listening');
    };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) owner.onFinal(r[0].transcript);
        else interim += r[0].transcript;
      }
      owner.onInterim(interim.trim());
    };
    rec.onerror = (e) => {
      if (FALLBACK_ERRORS.includes(e.error)) owner.fallBackToWhisper(e.error);
      else if (e.error === 'not-allowed') { owner.active = false; owner.onStatus('microphone blocked'); }
    };
    // The engine stops on its own after silence; keep it going while active.
    rec.onend = () => {
      this.running = false;
      if (owner.active && owner.engine === this) setTimeout(() => this.start(), 250);
    };
  }

  start() {
    try { this.rec.start(); } catch {} // already started
  }

  stop() {
    try { this.rec.stop(); } catch {}
  }

  unlock() {
    if (this.owner.active && !this.running) this.start();
  }
}

// Captures the mic at 16 kHz, cuts it into utterances with a simple energy
// gate, and transcribes each utterance with Whisper in a worker.
const FRAME = 480; // 30 ms at 16 kHz
const START_FRAMES = 3, END_FRAMES = 25, PREROLL = 10;
const MAX_SAMPLES = 16000 * 14, MIN_SAMPLES = 16000 * 0.4;

const TAP = `
registerProcessor('tap', class extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
});`;

class WhisperEngine {
  constructor(owner) {
    this.name = 'whisper';
    this.owner = owner;
    this.ready = false;
    this.queue = [];
    this.busy = false;
    this.nextId = 0;

    this.worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => this._onWorker(data);
    this.worker.postMessage({ type: 'load', model: owner.model, webgpu: !!navigator.gpu });
    owner.onStatus('loading speech model…');
  }

  _onWorker(msg) {
    const owner = this.owner;
    if (msg.type === 'progress') {
      owner.onStatus(`loading speech model ${Math.round(msg.progress)}%`);
    } else if (msg.type === 'ready') {
      this.ready = true;
      if (owner.active) this._status();
      else owner.onStatus(`speech model ready (${msg.device}) · mic off`);
      this._pump();
    } else if (msg.type === 'result') {
      this.busy = false;
      const text = clean(msg.text);
      if (text) owner.onFinal(text);
      owner.onInterim(this.speaking ? '…' : '');
      if (owner.active && !this.speaking) owner.onStatus('listening');
      this._pump();
    } else if (msg.type === 'error') {
      this.busy = false;
      owner.onStatus('speech model error: ' + msg.message);
    }
  }

  async start() {
    const owner = this.owner;
    if (!this.ctx) {
      try {
        // A prompt that can't be shown (e.g. inside XR) never answers; give up.
        this.stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
        ]);
      } catch {
        owner.active = false;
        owner.onStatus('microphone not allowed: leave XR and allow it in window mode');
        return;
      }
      this.ctx = new AudioContext({ sampleRate: 16000 });
      this.ctx.onstatechange = () => this._status();
      const url = URL.createObjectURL(new Blob([TAP], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      const tap = new AudioWorkletNode(this.ctx, 'tap');
      tap.port.onmessage = (e) => this._onAudio(e.data);
      this.ctx.createMediaStreamSource(this.stream).connect(tap);
      this._resetGate();
    }
    this.stream.getTracks().forEach((t) => (t.enabled = true));
    // Without a user action resume() never settles, so don't wait on it; the
    // statechange handler updates the status once audio actually runs.
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    this._status();
  }

  // Turning the mic off only mutes it. Suspending the audio context would
  // need another user action to resume, which a poke in XR isn't.
  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => (t.enabled = false));
    this._resetGate();
  }

  unlock() {
    if (!this.owner.active) return;
    if (!this.ctx) this.start();
    else if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  _status() {
    const owner = this.owner;
    if (!owner.active) return;
    if (this.ctx?.state !== 'running') owner.onStatus('pinch once to start the microphone');
    else owner.onStatus(this.ready ? 'listening' : 'loading speech model…');
  }

  _resetGate() {
    this.pending = new Float32Array(0);
    this.frames = []; // recent frames kept as pre-roll
    this.segment = null;
    this.loud = 0;
    this.quiet = 0;
    this.floor = 0.004;
    this.speaking = false;
  }

  _onAudio(chunk) {
    if (!this.owner.active) return;
    const buf = new Float32Array(this.pending.length + chunk.length);
    buf.set(this.pending);
    buf.set(chunk, this.pending.length);
    let off = 0;
    for (; off + FRAME <= buf.length; off += FRAME) this._onFrame(buf.subarray(off, off + FRAME).slice());
    this.pending = buf.slice(off);
  }

  _onFrame(f) {
    let e = 0;
    for (let i = 0; i < f.length; i++) e += f[i] * f[i];
    const rms = Math.sqrt(e / f.length);
    const loud = rms > Math.max(0.012, this.floor * 3);

    if (!this.speaking) {
      this.floor += (rms - this.floor) * 0.02;
      this.frames.push(f);
      if (this.frames.length > PREROLL) this.frames.shift();
      this.loud = loud ? this.loud + 1 : 0;
      if (this.loud >= START_FRAMES) {
        this.speaking = true;
        this.segment = [...this.frames];
        this.frames = [];
        this.quiet = 0;
        this.owner.onInterim('…');
        this.owner.onStatus('hearing you…');
      }
      return;
    }

    this.segment.push(f);
    this.quiet = loud ? 0 : this.quiet + 1;
    if (this.quiet >= END_FRAMES || this.segment.length * FRAME >= MAX_SAMPLES) this._endSegment();
  }

  _endSegment() {
    const frames = this.segment;
    this.speaking = false;
    this.segment = null;
    this.loud = 0;
    if (frames.length * FRAME < MIN_SAMPLES) {
      if (!this.busy) this.owner.onInterim('');
      return;
    }
    const audio = new Float32Array(frames.length * FRAME);
    frames.forEach((fr, i) => audio.set(fr, i * FRAME));
    this.queue.push(audio);
    this.owner.onStatus(this.ready ? 'transcribing…' : 'loading speech model…');
    this._pump();
  }

  _pump() {
    if (!this.ready || this.busy || !this.queue.length) return;
    this.busy = true;
    const audio = this.queue.shift();
    this.worker.postMessage({ type: 'transcribe', id: this.nextId++, audio }, [audio.buffer]);
  }
}

// Whisper labels silence and noise instead of staying quiet; drop those.
function clean(text) {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
