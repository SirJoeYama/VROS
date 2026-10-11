// Tunable constants (meters, seconds, m/s). Everything happens in court
// space: the player starts at the origin facing -Z, the front wall ahead.
export const CFG = {
  // Court
  COURT_W: 2.0, // side wall to side wall
  COURT_H: 2.0, // floor to ceiling
  FRONT_Z: -2.0, // front wall plane, 2 m ahead
  BACK_Z: 1.0, // back wall plane, 1 m behind: 3 m deep in all
  TIN_H: 0.15, SERVICE_H: 0.6, OUT_H: 1.5, OUT_BACK_H: 0.7, // squash lines, scaled to the court
  SHORT_LINE: 0.56, // the short line, as a fraction of the depth from the front wall

  // Physics
  GRAVITY: 2.0, // light gravity, m/s²
  WALL_DAMP: 0.88, // normal restitution: side walls, ceiling, back wall
  FRONT_WALL_DAMP: 0.95,
  FLOOR_DAMP: 0.7,
  WALL_FRICTION: 0.92, // tangential velocity kept on a bounce
  MAGNUS: 0.004, // how much spin curves the ball
  ANG_DAMP: 0.5, // spin decay per second
  SUBSTEPS: 6, // physics substeps per frame: the swept paddle test samples the swing this often

  // Ball
  BALL_SIZE: 0.1,
  BASE_SPEED: 3.5, // minimum forward shot speed at rally 0
  SPEED_RAMP: 0.1, // the minimum grows this much per rally point
  MAX_SPEED: 8.0, // hard clamp
  RETURN_SPEED_MAX: 5.0, // assisted rebounds come back no faster than this (across the floor)
  RETURN_ASSIST: 0.6, // 0..1: how much front-wall rebounds are steered back to the player (0 = pure physics)
  RETURN_DROP: 0.45, // rebounds aim this far below your eyes
  RETURN_SPREAD: 0.5, // and up to this far to either side

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
  BEHIND_MARGIN: 0.5, // the ball this far behind your head is a miss
  MISS_PAUSE: 1.4,
  STUCK_TIME: 9.0, // the rally ends after this long without a touch
  SERVE_DIST: 0.55,

  // FX
  TRAIL_SPEED: 4.5,
  TRAIL_LEN: 12,

  // Desktop preview
  DESKTOP_PLANE: 0.7, // the mouse paddle moves on a plane this far ahead
  DESKTOP_PUSH: 3.0, // a mouse can't swing forward: hits get this forward speed
  DESKTOP_LOFT: 0.8, // and this much upward, so they reach the wall

  // Front-wall panel: the scoreboard between the out line and the ceiling,
  // with a button each side (pressed with a controller's laser)
  BOARD_W: 0.9,
  BUTTON_W: 0.28, BUTTON_H: 0.14,

  // Mixed reality: how see-through the walls are over passthrough (0 = invisible)
  MR_WALL_OPACITY: 0.12,
};

export const COLORS = {
  left: 0x00f6ff, right: 0xff2bd6, ball: 0xffffff,
  wall: 0x0a0d1a, floor: 0x070912, front: 0x10162c,
  edge: 0x00f6ff, grid: 0x0c3d55, tin: 0xff2266, line: 0x00c8ff, floorLine: 0xff2bd6,
};

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
