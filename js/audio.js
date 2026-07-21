/**
 * 🍰 Kawaii Bakery — Audio System
 * audio.js
 *
 * 100% procedural WebAudio — no external files, nothing to host, no CORS
 * issues in the Oculus Browser. Royalty-free by construction.
 *
 * Provides: looping café ambience, soft looping music, SFX (pickup, drop,
 * success, error, click, start, victory). Starts on the first user gesture
 * (including the Enter-VR button press or any controller button in-session).
 */

class BakeryAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.ambGain = null;
    this.started = false;
    this._musicTimer = null;
    this._clinkTimer = null;
  }

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  start() {
    if (!this._ensure()) return;
    if (this.started) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    this.started = true;
    this._startAmbience();
    this._startMusic();
    this.play('start');
    console.log('[audio.js] audio started');
  }

  _tone(freq, dur, type, vol, when, dest, slideTo) {
    const t = this.ctx.currentTime + (when || 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest || this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  _noise(dur, vol, when, filterFreq, filterType) {
    const t = this.ctx.currentTime + (when || 0);
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType || 'lowpass';
    f.frequency.value = filterFreq || 800;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  play(name) {
    if (!this._ensure()) return;
    switch (name) {
      case 'pickup':
        this._tone(520, 0.09, 'sine', 0.18, 0, null, 780);
        this._tone(1040, 0.07, 'sine', 0.06, 0.05);
        break;
      case 'drop':
        this._tone(150, 0.16, 'triangle', 0.22, 0, null, 70);
        this._noise(0.08, 0.10, 0, 500);
        break;
      case 'success':
        this._tone(523, 0.22, 'sine', 0.16, 0);
        this._tone(659, 0.22, 'sine', 0.16, 0.09);
        this._tone(784, 0.30, 'sine', 0.16, 0.18);
        this._tone(1046, 0.40, 'sine', 0.10, 0.27);
        break;
      case 'error':
        this._tone(180, 0.12, 'square', 0.08, 0);
        this._tone(150, 0.16, 'square', 0.08, 0.14);
        break;
      case 'click':
        this._tone(850, 0.045, 'sine', 0.12, 0);
        break;
      case 'start':
        this._tone(392, 0.15, 'sine', 0.12, 0);
        this._tone(523, 0.15, 'sine', 0.12, 0.12);
        this._tone(659, 0.30, 'sine', 0.12, 0.24);
        break;
      case 'victory':
        [523, 659, 784, 1046, 784, 1046].forEach((f, i) => {
          this._tone(f, 0.22, 'sine', 0.16, i * 0.13);
          this._tone(f / 2, 0.22, 'triangle', 0.06, i * 0.13);
        });
        this._noise(0.5, 0.05, 0.7, 4000, 'highpass');
        break;
    }
  }

  _startAmbience() {
    this.ambGain = this.ctx.createGain();
    this.ambGain.gain.value = 0.045;
    this.ambGain.connect(this.master);

    const len = this.ctx.sampleRate * 3;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420;
    src.connect(lp).connect(this.ambGain);
    src.start();

    const clink = () => {
      if (!this.ctx) return;
      const f = 1800 + Math.random() * 1600;
      this._tone(f, 0.05, 'sine', 0.02 + Math.random() * 0.02, 0);
      this._tone(f * 1.5, 0.04, 'sine', 0.012, 0.01);
      this._clinkTimer = setTimeout(clink, 3500 + Math.random() * 7000);
    };
    this._clinkTimer = setTimeout(clink, 4000);
  }

  _startMusic() {
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.055;
    this.musicGain.connect(this.master);

    const chords = [
      [349.23, 440.00, 523.25],
      [261.63, 329.63, 392.00],
      [293.66, 349.23, 440.00],
      [233.08, 293.66, 349.23],
    ];
    const CHORD_DUR = 4;
    let idx = 0;

    const playChord = () => {
      if (!this.ctx) return;
      const notes = chords[idx % chords.length];
      idx++;
      const t = this.ctx.currentTime;
      notes.forEach((f) => {
        const osc = this.ctx.createOscillator();
        const det = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = f;
        det.type = 'sine'; det.frequency.value = f * 1.004;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.6 / notes.length, t + 1.2);
        g.gain.linearRampToValueAtTime(0.0001, t + CHORD_DUR + 0.5);
        osc.connect(g); det.connect(g);
        g.connect(this.musicGain);
        osc.start(t); det.start(t);
        osc.stop(t + CHORD_DUR + 0.6); det.stop(t + CHORD_DUR + 0.6);
      });
      this._musicTimer = setTimeout(playChord, CHORD_DUR * 1000);
    };
    playChord();
  }
}

window.bakeryAudio = new BakeryAudio();

(function () {
  const kick = () => window.bakeryAudio.start();
  window.addEventListener('click', kick);
  window.addEventListener('keydown', kick);
  window.addEventListener('touchstart', kick);
  const hook = () => {
    const s = document.querySelector('a-scene');
    if (s) s.addEventListener('enter-vr', kick);
  };
  if (document.querySelector('a-scene')) hook();
  else window.addEventListener('DOMContentLoaded', hook);
})();
