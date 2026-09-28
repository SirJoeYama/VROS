// The media player: a playlist on top of one <video> element (which also
// plays audio files). Emits 'change' whenever something visible changes.
export class Player extends EventTarget {
  constructor(video) {
    super();
    this.video = video;
    this.list = []; // { name, src }
    this.index = -1;
    this.error = '';
    // Browsers only start playback from a real user action; a pinch in XR
    // isn't one, but an XR "select" is. When play() is refused we remember
    // it and try again from unlock().
    this.pendingPlay = false;
    const emit = () => this.dispatchEvent(new Event('change'));
    for (const ev of ['play', 'pause', 'timeupdate', 'loadedmetadata', 'seeked', 'volumechange']) video.addEventListener(ev, emit);
    video.addEventListener('ended', () => (this.index < this.list.length - 1 ? this.next() : emit()));
    video.addEventListener('error', () => {
      this.error = "can't play this file";
      emit();
    });
  }

  get item() {
    return this.list[this.index] || null;
  }

  get playing() {
    return !this.video.paused && !this.video.ended;
  }

  get time() {
    return this.video.currentTime || 0;
  }

  get duration() {
    return Number.isFinite(this.video.duration) ? this.video.duration : 0;
  }

  // Audio files (and videos still loading) have no picture.
  get hasPicture() {
    return this.video.videoWidth > 0;
  }

  add(items, playNow = false) {
    const first = this.list.length;
    this.list.push(...items);
    if (playNow || this.index < 0) this.load(first, playNow);
    else this.dispatchEvent(new Event('change'));
  }

  addFiles(files, playNow = true) {
    this.add([...files].map((f) => ({ name: f.name, src: URL.createObjectURL(f) })), playNow);
  }

  load(i, autoplay = true) {
    if (!this.list[i]) return;
    this.index = i;
    this.error = '';
    const { src } = this.list[i];
    // Remote files need CORS to be drawn as a texture; local files don't care.
    if (/^https?:/.test(src)) this.video.crossOrigin = 'anonymous';
    else this.video.removeAttribute('crossorigin');
    this.video.src = src;
    this.video.load();
    if (autoplay) this.play();
    this.dispatchEvent(new Event('change'));
  }

  play() {
    if (!this.item) return;
    this.video.play().then(
      () => (this.pendingPlay = false),
      (err) => {
        if (err.name === 'NotAllowedError') this.pendingPlay = true;
        this.dispatchEvent(new Event('change'));
      },
    );
  }

  pause() {
    this.pendingPlay = false;
    this.video.pause();
  }

  toggle() {
    if (this.playing || this.pendingPlay) this.pause();
    else this.play();
  }

  unlock() {
    if (this.pendingPlay) this.play();
  }

  seekBy(seconds) {
    if (!this.duration) return;
    this.video.currentTime = Math.max(0, Math.min(this.duration - 0.05, this.time + seconds));
  }

  seekTo(fraction) {
    if (this.duration) this.video.currentTime = Math.max(0, Math.min(1, fraction)) * this.duration;
  }

  next() {
    if (this.index < this.list.length - 1) this.load(this.index + 1);
  }

  prev() {
    // like most players: back to the start first, then the previous item
    if (this.time > 3 || this.index === 0) this.video.currentTime = 0;
    else this.load(this.index - 1);
  }
}

export function formatTime(s) {
  if (!Number.isFinite(s)) return '0:00';
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
