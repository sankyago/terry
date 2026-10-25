/** Фіксований крок симуляції (с). Поведінка не залежить від FPS. */
export const SIM_DT = 1 / 60;
/** Максимум кроків симуляції за один кадр (захист від «спіралі смерті»). */
export const MAX_STEPS_PER_FRAME = 6;

/** Габарити та параметри автомобіля (м). Візуальна модель будується з цих самих чисел. */
export const CAR = {
  length: 4.63,
  width: 1.85,
  height: 1.37,
  wheelbase: 2.75,
  groundClearance: 0.16,
  wheelRadius: 0.33,
  wheelWidth: 0.24,
  /** Максимальний кут повороту передніх коліс (рад) → мінімальний радіус ≈ 5,5 м. */
  maxSteerAngle: 0.465,
  maxForwardSpeed: 60 / 3.6,
  maxReverseSpeed: 12 / 3.6,
  driveAccel: 2.8,
  reverseAccel: 1.6,
  brakeDecel: 7.5,
  /** «Повзучість» автомата в D/R без педалей. */
  creepSpeed: 4 / 3.6,
  creepAccel: 0.8,
  rollingResistance: 0.25,
  aeroDrag: 0.012,
  /** Нижче цієї швидкості (м/с) можна перемикати D↔R і вмикати P. */
  shiftSpeedThreshold: 0.3,
  /** Швидкість повороту керма (частка повного ходу за секунду). */
  steerRate: 3.2,
} as const;

export const EXERCISE = {
  speedLimitKmh: 20,
  speedClearKmh: 18,
  stopHoldSeconds: 2,
  /** Швидкість, яку вважаємо «майже нулем» (км/год). */
  stoppedSpeedKmh: 0.5,
  startMoveDistance: 0.5,
  offRoadTolerance: 0.05,
} as const;

export const ROAD_HALF_WIDTH = 3.5;
export const LANE_OFFSET = 1.75;
