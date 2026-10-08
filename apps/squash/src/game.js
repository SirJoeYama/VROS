import * as THREE from 'three';
import { CFG, COLORS, clamp } from './config.js';

const HW = CFG.COURT_W / 2, H = CFG.COURT_H;
const BEST_KEY = 'vros.squash.best';

const N_FLOOR = new THREE.Vector3(0, 1, 0), N_CEIL = new THREE.Vector3(0, -1, 0);
const N_LEFT = new THREE.Vector3(1, 0, 0), N_RIGHT = new THREE.Vector3(-1, 0, 0);
const N_FRONT = new THREE.Vector3(0, 0, 1), N_BACK = new THREE.Vector3(0, 0, -1);

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _n = new THREE.Vector3(), _local = new THREE.Vector3(), _off = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qInv = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _c = new THREE.Color();

// The ball, its physics and the rules, all in court space.
//
// States: serve (waiting for a pinch / trigger) → ready (the ball floats in
// front of you) → play → miss (a short pause) → serve, or over after the
// last life. A front-wall hit after one of your shots scores a point; two
// floor bounces, or the ball getting past you, ends the rally.
export class Game {
  constructor(parent, { sfx, flashes, glowTex, haptic }) {
    this.sfx = sfx;
    this.flashes = flashes;
    this.haptic = haptic;

    const b = CFG.BALL_SIZE;
    this.ball = new THREE.Mesh(
      new THREE.BoxGeometry(b, b, b),
      new THREE.MeshStandardMaterial({ color: COLORS.ball, emissive: COLORS.ball, emissiveIntensity: 0.8 }),
    );
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, color: 0xaaddff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.halo.scale.setScalar(0.4);
    this.ball.add(this.halo);
    this.ball.visible = false;
    parent.add(this.ball);

    // Trail: additive ghost cubes; a black instance colour is invisible.
    this.trail = new THREE.InstancedMesh(
      this.ball.geometry,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      CFG.TRAIL_LEN,
    );
    this.trail.frustumCulled = false;
    this.trailPts = Array.from({ length: CFG.TRAIL_LEN }, () => new THREE.Vector3());
    for (let i = 0; i < CFG.TRAIL_LEN; i++) this.trail.setColorAt(i, _c.setRGB(0, 0, 0));
    this.trailHead = 0;
    this.trailCount = 0;
    parent.add(this.trail);

    this.vel = new THREE.Vector3();
    this.ang = new THREE.Vector3();
    this.active = false;
    this.floating = false;
    this.floatBase = new THREE.Vector3();
    this.floorBounces = 0;
    this.needsFront = false;
    this.lastTouch = 0;

    this.time = 0;
    this.state = 'serve';
    this.rally = 0;
    this.lives = CFG.LIVES;
    this.best = 0;
    this.message = '';
    this.missTimer = 0;
    try { this.best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch { /* storage blocked */ }

    this.head = new THREE.Vector3(0, 1.6, 0); // your eyes, court space
    this.desktop = true;
  }

  _saveBest() {
    try { localStorage.setItem(BEST_KEY, String(this.best)); } catch { /* ignore */ }
  }

  get minSpeed() {
    return Math.min(CFG.BASE_SPEED + CFG.SPEED_RAMP * this.rally, CFG.MAX_SPEED);
  }

  // Pinch / trigger / click. `fwd`: which way you face (court space, level).
  trigger(fwd) {
    if (this.state === 'serve' || this.state === 'ready') this._serve(fwd);
    else if (this.state === 'over') {
      this.lives = CFG.LIVES;
      this._serve(fwd);
    }
  }

  _serve(fwd) {
    const base = this.floatBase;
    if (this.desktop) base.set(this.head.x, this.head.y - 0.25, this.head.z - CFG.DESKTOP_PLANE);
    else {
      base.copy(this.head).addScaledVector(fwd, CFG.SERVE_DIST);
      base.y = this.head.y - 0.25;
    }
    base.x = clamp(base.x, -HW + 0.2, HW - 0.2);
    base.y = clamp(base.y, 0.3, H - 0.3);
    base.z = clamp(base.z, CFG.FRONT_Z + 0.5, CFG.BACK_Z - 0.2);
    this.ball.position.copy(base);
    this.vel.set(0, 0, 0);
    this.ang.set(0.6, 1.0, 0.3);
    this.active = true;
    this.floating = true;
    this.floorBounces = 0;
    this.needsFront = false;
    this.lastTouch = this.time;
    this.ball.visible = true;
    this.trailCount = 0;
    this.rally = 0;
    this.state = 'ready';
    this.message = 'HIT THE BALL!';
    this.sfx.serve();
  }

  // One frame. paddles: the Paddle objects, already updated this frame.
  update(dt, paddles) {
    this.time += dt;
    const S = CFG.SUBSTEPS, h = dt / S;
    for (let k = 1; k <= S; k++) this._step(h, k / S, paddles);
    this._rules(dt);
    this._fx();
  }

  _step(h, frac, paddles) {
    if (!this.active) return;
    const p = this.ball.position, v = this.vel;

    if (!this.floating) {
      v.y -= CFG.GRAVITY * h;
      v.add(_v1.crossVectors(this.ang, v).multiplyScalar(CFG.MAGNUS * h)); // spin curves it
      p.addScaledVector(v, h);

      const r = CFG.BALL_SIZE / 2;
      if (p.x < -HW + r && v.x < 0) { p.x = -HW + r; this._bounce(N_LEFT, CFG.WALL_DAMP, 'side'); }
      if (p.x > HW - r && v.x > 0) { p.x = HW - r; this._bounce(N_RIGHT, CFG.WALL_DAMP, 'side'); }
      if (p.y > H - r && v.y > 0) { p.y = H - r; this._bounce(N_CEIL, CFG.WALL_DAMP, 'ceiling'); }
      if (p.z > CFG.BACK_Z - r && v.z > 0) { p.z = CFG.BACK_Z - r; this._bounce(N_BACK, CFG.WALL_DAMP, 'back'); }
      if (p.z < CFG.FRONT_Z + r && v.z < 0) { p.z = CFG.FRONT_Z + r; this._bounce(N_FRONT, CFG.FRONT_WALL_DAMP, 'front'); }
      if (p.y < r && v.y < 0) { p.y = r; this._bounce(N_FLOOR, CFG.FLOOR_DAMP, 'floor'); }
      if (!this.active) return; // a bounce may have ended the rally
    }

    // tumble
    const w = this.ang.length();
    if (w > 1e-4) {
      _q.setFromAxisAngle(_v1.copy(this.ang).divideScalar(w), w * h);
      this.ball.quaternion.premultiply(_q);
    }
    this.ang.multiplyScalar(Math.max(0, 1 - CFG.ANG_DAMP * h));

    for (const pd of paddles) if (pd.active) this._paddleHit(pd, frac);
  }

  _bounce(n, damp, kind) {
    const v = this.vel;
    const impact = -v.dot(n);
    _v2.copy(v).addScaledVector(n, impact); // the tangential part
    this.ang.addScaledVector(_v3.crossVectors(n, _v2), 3); // friction spins it
    _v2.multiplyScalar(CFG.WALL_FRICTION);
    v.copy(_v2).addScaledVector(n, impact * damp);
    if (kind === 'floor' && v.y < 0.4) v.y = 0; // settle into rolling
    this._wallHit(kind, n, impact);
  }

  // Swept box test: the paddle's pose is interpolated across the frame (frac
  // 0..1), so a fast swing is sampled SUBSTEPS times and can't skip the ball.
  _paddleHit(pd, frac) {
    if (this.time - pd.lastHit < CFG.HIT_COOLDOWN) return;
    _v1.lerpVectors(pd.prevPos, pd.pos, frac);
    _q.slerpQuaternions(pd.prevQuat, pd.quat, frac);
    _qInv.copy(_q).invert();
    _local.copy(this.ball.position).sub(_v1).applyQuaternion(_qInv);

    const hs = (CFG.PADDLE_SIZE + CFG.BALL_SIZE) / 2;
    const ax = Math.abs(_local.x), ay = Math.abs(_local.y), az = Math.abs(_local.z);
    if (ax >= hs || ay >= hs || az >= hs) return;

    // the face it hit: the axis of least penetration (a mouse can't swing, so
    // its cube always hits with the face toward the front wall)
    const axis = pd.mouse ? 'z' : ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
    const sign = pd.mouse ? -1 : Math.sign(_local[axis]) || 1;
    _n.set(0, 0, 0);
    _n[axis] = sign;
    _n.applyQuaternion(_q);

    // push the ball out onto that face
    _local[axis] = sign * (hs + 0.002);
    _off.copy(_local);
    _off[axis] = 0;
    _off.divideScalar(hs); // where on the face, -1..1
    this.ball.position.copy(_local).applyQuaternion(_q).add(_v1);
    _off.applyQuaternion(_q);

    // the paddle's velocity (a mouse gets a simulated forward, upward swing)
    _v2.copy(pd.vel);
    if (pd.mouse) {
      _v2.y = _v2.y * 0.2 + CFG.DESKTOP_LOFT;
      _v2.z -= CFG.DESKTOP_PUSH;
    }

    // reflect the relative velocity, then carry the paddle's velocity over
    _v3.subVectors(this.vel, _v2);
    const vn = _v3.dot(_n);
    if (vn < 0) _v3.addScaledVector(_n, -(1 + CFG.PADDLE_RESTITUTION) * vn);
    this.vel.copy(_v3).addScaledVector(_v2, CFG.HIT_TRANSFER);
    const sep = this.vel.dot(_n) - _v2.dot(_n);
    if (sep < 0.5) this.vel.addScaledVector(_n, 0.5 - sep);

    // off-centre hits: an angle and spin
    let spd = this.vel.length();
    this.vel.addScaledVector(_off, CFG.ANGLE_FACTOR * spd);
    this.ang.crossVectors(_n, _off).multiplyScalar(CFG.SPIN_FACTOR * spd);
    _v3.copy(_v2).addScaledVector(_n, -_v2.dot(_n)); // the swing across the face
    this.ang.add(_v1.crossVectors(_n, _v3).multiplyScalar(3));

    // speed: a minimum for forward shots that grows with the rally, a hard max
    spd = this.vel.length();
    if (this.vel.z < 0 && spd < this.minSpeed && spd > 1e-3) this.vel.multiplyScalar(this.minSpeed / spd);
    if (spd > CFG.MAX_SPEED) this.vel.multiplyScalar(CFG.MAX_SPEED / spd);

    pd.lastHit = this.time;
    this._onPaddle(pd, Math.max(-vn, _v2.length()));
  }

  _onPaddle(pd, impact) {
    if (this.state === 'ready') this.state = 'play';
    if (this.state !== 'play') return;
    this.floating = false;
    this.needsFront = true;
    this.floorBounces = 0;
    this.lastTouch = this.time;
    this.message = '';
    pd.glow = 1;
    this.sfx.tock(impact, this.ball.position.x);
    this.haptic(pd.side, clamp(0.2 + (impact / CFG.MAX_SPEED) * 1.1, 0.2, 1));
  }

  _wallHit(kind, n, impact) {
    const p = this.ball.position;
    if (kind === 'floor') {
      if (impact > 0.3) {
        this.sfx.floor(impact, p.x);
        this.flashes.spawn(_v1.set(p.x, 0, p.z), n, COLORS.right, 0.5);
      }
      if (this.state === 'play' && impact > 0.05 && ++this.floorBounces >= 2) this._endRally('DOUBLE BOUNCE');
      return;
    }
    const front = kind === 'front';
    if (impact > 0.3) {
      this.sfx.thud(impact, p.x, front);
      this.flashes.spawn(p, n, front ? 0xffffff : COLORS.left, front ? 0.9 : 0.6);
    }
    if (this.state !== 'play') return;
    if (front) {
      if (this.needsFront) {
        this.needsFront = false;
        this.rally++;
        if (this.rally > this.best) this.best = this.rally;
        this.sfx.chime();
      }
      this._returnAssist();
    } else if (kind === 'back') this._endRally('PAST YOU');
  }

  // Blend the front-wall rebound toward a lob that reaches you, so a solo
  // rally can keep going. RETURN_ASSIST = 0 leaves the physics alone.
  _returnAssist() {
    if (CFG.RETURN_ASSIST <= 0) return;
    const head = this.head, d = this.desktop;
    const tx = clamp(head.x + (Math.random() - 0.5) * (d ? 0.5 : 0.9), -HW + 0.4, HW - 0.4);
    const ty = d ? head.y - 0.25 : head.y - CFG.RETURN_DROP;
    const tz = d ? head.z - CFG.DESKTOP_PLANE : head.z - 0.45;
    const p = this.ball.position, v = this.vel;
    const dx = tx - p.x, dy = ty - p.y, dz = tz - p.z;
    const across = Math.max(Math.hypot(v.x, v.z), this.minSpeed * 0.75);
    const t = clamp(Math.hypot(dx, dz) / across, 0.5, 2.2);
    v.lerp(_v1.set(dx / t, dy / t + 0.5 * CFG.GRAVITY * t, dz / t), CFG.RETURN_ASSIST);
    const s = v.length();
    if (s > CFG.MAX_SPEED) v.multiplyScalar(CFG.MAX_SPEED / s);
  }

  _endRally(reason) {
    if (this.state !== 'play') return;
    this.lives--;
    if (this.rally > this.best) this.best = this.rally;
    this._saveBest();
    this.flashes.spawn(this.ball.position, _v1.subVectors(this.head, this.ball.position).normalize(), COLORS.tin, 0.7);
    this.active = false;
    this.ball.visible = false;
    this.state = 'miss';
    this.missTimer = CFG.MISS_PAUSE;
    this.message = reason;
    this.sfx.miss();
  }

  _rules(dt) {
    if (this.state === 'ready') {
      this.ball.position.copy(this.floatBase);
      this.ball.position.y += Math.sin(this.time * 2.5) * 0.02;
    } else if (this.state === 'play') {
      if (this.ball.position.z > this.head.z + CFG.BEHIND_MARGIN && this.vel.z > 0) this._endRally('PAST YOU');
      else if (this.time - this.lastTouch > CFG.STUCK_TIME) this._endRally('TOO SLOW');
    } else if (this.state === 'miss') {
      this.missTimer -= dt;
      if (this.missTimer <= 0) {
        if (this.lives <= 0) {
          this.state = 'over';
          this.message = 'GAME OVER';
          this.sfx.gameOver();
        } else {
          this.state = 'serve';
          this.message = '';
        }
      }
    }
  }

  _fx() {
    const speed = this.vel.length();
    const k = this.active && !this.floating ? clamp((speed - CFG.TRAIL_SPEED) / 4, 0, 1) : 0;
    const L = CFG.TRAIL_LEN;
    if (this.active) {
      this.trailPts[this.trailHead].copy(this.ball.position);
      this.trailHead = (this.trailHead + 1) % L;
      this.trailCount = Math.min(this.trailCount + 1, L);
    }
    this.trail.visible = k > 0;
    if (this.trail.visible) {
      for (let i = 0; i < L; i++) {
        const age = i / L;
        const on = i > 0 && i < this.trailCount;
        _s.setScalar(on ? 0.9 * (1 - age) : 0.0001);
        _m.compose(this.trailPts[(this.trailHead - 1 - i + L * 2) % L], this.ball.quaternion, _s);
        this.trail.setMatrixAt(i, _m);
        const b = on ? k * 0.5 * (1 - age) : 0;
        this.trail.setColorAt(i, _c.setRGB(b * 0.8, b * 0.95, b));
      }
      this.trail.instanceMatrix.needsUpdate = true;
      this.trail.instanceColor.needsUpdate = true;
    }
    this.halo.material.opacity = 0.5 + 0.3 * Math.sin(this.time * 6);
  }
}
