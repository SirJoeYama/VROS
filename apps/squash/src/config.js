// Tunable constants (meters, seconds, m/s). Everything happens in court
// space: the player starts at the origin facing -Z, the front wall ahead.
export const CFG = {
  // Court
  COURT_W: 6.4, // side wall to side wall
  COURT_H: 6.0, // floor to ceiling
  FRONT_Z: -6.0, // front wall plane (about 6 m ahead)
  BACK_Z: 2.5, // back wall plane (behind the player)
  TIN_H: 0.48, SERVICE_H: 1.78, OUT_H: 4.57,

  // Physics
  GRAVITY: 3.2, // light gravity, m/s²
  WALL_DAMP: 0.88, // normal restitution: side walls, ceiling, back wall
  FRONT_WALL_DAMP: 0.95,
  FLOOR_DAMP: 0.7,
  WALL_FRICTION: 0.92, // tangential velocity kept on a bounce
  MAGNUS: 0.004, // how much spin curves the ball
  ANG_DAMP: 0.5, // spin decay per second
  SUBSTEPS: 6, // physics substeps per frame: the swept paddle test samples the swing this often

  // Ball
  BALL_SIZE: 0.1,
  BASE_SPEED: 6.0, // minimum forward shot speed at rally 0
  SPEED_RAMP: 0.25, // the minimum grows this much per rally point
  MAX_SPEED: 16.0, // hard clamp
  RETURN_ASSIST: 0.6, // 0..1: how much front-wall rebounds are steered back to the player (0 = pure physics)
  RETURN_DROP: 0.45, // rebounds aim this far below your eyes

  // Paddles
  PADDLE_SIZE: 0.15,
  PADDLE_OFFSET: 0.1, // controllers: the cube's centre this far along the pointing ray
  PALM_OFFSET: 0.1, // hands: the cube's centre this far out of the palm
  PADDLE_RESTITUTION: 0.6,
  HIT_TRANSFER: 1.0, // fraction of the paddle's velocity given to the ball
  ANGLE_FACTOR: 0.35, // off-centre hits deflect the ball sideways
  SPIN_FACTOR: 1.5, // off-centre hits spin it
  VEL_SAMPLES: 6, // frames of history for the paddle's velocity
  HIT_COOLDOWN: 0.12,

  // Rules
  LIVES: 3,
  BEHIND_MARGIN: 0.7, // the ball this far behind your head is a miss
  MISS_PAUSE: 1.4,
  STUCK_TIME: 9.0, // the rally ends after this long without a touch
  SERVE_DIST: 0.55,

  // FX
  TRAIL_SPEED: 7.0,
  TRAIL_LEN: 12,

  // Desktop preview
  DESKTOP_PLANE: 0.7, // the mouse paddle moves on a plane this far ahead
  DESKTOP_PUSH: 5.0, // a mouse can't swing forward: hits get this forward speed
  DESKTOP_LOFT: 1.5, // and this much upward, so they reach the wall
};

export const COLORS = {
  left: 0x00f6ff, right: 0xff2bd6, ball: 0xffffff,
  wall: 0x0a0d1a, floor: 0x070912, front: 0x10162c,
  edge: 0x00f6ff, grid: 0x0c3d55, tin: 0xff2266, line: 0x00c8ff, floorLine: 0xff2bd6,
};

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
