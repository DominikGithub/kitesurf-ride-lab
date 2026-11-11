// Synthetic documentation session. Nothing in this file comes from a recorded activity:
// the track is produced by a small seeded simulation of a rider reaching back and forth off a beach.
const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);
const SESSION_SECONDS = 90 * 60;
const START_TIME = Math.floor((Date.UTC(2025, 6, 18, 13, 30) - FIT_EPOCH_MS) / 1000);
const METRES_PER_DEGREE = 111320;
const SEED = 20250718;

// Where the gear lies on the beach at El Gouna. The shore runs along SHORE_BEARING with the water on its right.
const GEAR_SPOT = { latitude: 27.41633, longitude: 33.67769 };
const SHORE_BEARING = 338;
const WATERLINE_METRES = 30;
const PREVAILING_WIND = 330;

// [seconds into the session, wind speed m/s, direction the wind comes from, gusts m/s]
const WEATHER = [
  [0, 8.9, 328, 11.3],
  [900, 9.2, 331, 11.8],
  [1800, 9.5, 334, 12.1],
  [2700, 9.0, 330, 11.4],
  [3600, 9.4, 327, 12.0],
  [4500, 9.1, 332, 11.7],
  [5400, 9.3, 329, 11.9],
];

// upwindTarget is how far upwind of the gear spot the rider tries to hold their line during that block.
const PLAN = [
  { type: "beach", seconds: 200 },
  { type: "ride", seconds: 11 * 60, upwindTarget: 60 },
  { type: "beach", seconds: 230 },
  { type: "ride", seconds: 18 * 60, upwindTarget: 220 },
  { type: "beach", seconds: 330 },
  { type: "ride", seconds: 15 * 60, upwindTarget: -40 },
  { type: "beach", seconds: 280 },
  { type: "ride", seconds: 19 * 60, upwindTarget: 140 },
  { type: "beach" },
];

const HEART_RATE = { standing: 99, walking: 110, riding: 132, swimming: 142, sessionDrift: 12 };
const HEART_RATE_ZONE_LIMITS = [111, 130, 148, 167];

function createRandom(seed) {
  let state = seed >>> 0;
  const uniform = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    uniform,
    between: (low, high) => low + (high - low) * uniform(),
    normal: () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform()),
  };
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function unitVector(bearing) {
  const angle = bearing * Math.PI / 180;
  return { east: Math.sin(angle), north: Math.cos(angle) };
}

function windDirectionAt(second) {
  const upper = WEATHER.findIndex(([offset]) => offset >= second);
  if (upper <= 0) return WEATHER[upper === 0 ? 0 : WEATHER.length - 1][2];
  const [lowerOffset, , lowerDirection] = WEATHER[upper - 1];
  const [upperOffset, , upperDirection] = WEATHER[upper];
  return lowerDirection + (upperDirection - lowerDirection) * (second - lowerOffset) / (upperOffset - lowerOffset);
}

// Board speed by angle off the wind: slower when pointing upwind, faster on a broad reach.
function boardSpeed(offWind) {
  return offWind <= 90 ? 7.5 - (90 - offWind) * 0.05 : 7.5 + Math.min(offWind - 90, 30) * 0.035;
}

function simulateSession() {
  const random = createRandom(SEED);
  const offshore = unitVector(SHORE_BEARING + 90);
  const upwind = unitVector(PREVAILING_WIND);
  const rider = { second: 0, east: 0, north: 0, speed: 0, heartRate: 92, distance: 0 };
  const noise = { gust: 0, course: 0, gpsEast: 0, gpsNorth: 0, heartRate: 0 };
  const samples = [];

  const finished = () => rider.second > SESSION_SECONDS;
  const offshoreDistance = () => rider.east * offshore.east + rider.north * offshore.north;
  const upwindDistance = () => rider.east * upwind.east + rider.north * upwind.north;
  const bearingTo = (point) => Math.atan2(point.east - rider.east, point.north - rider.north) * 180 / Math.PI;
  const distanceTo = (point) => Math.hypot(point.east - rider.east, point.north - rider.north);

  // Records the current second, then moves the rider on by one second.
  function tick(targetSpeed, heading, effort, { acceleration = 1, braking = 1.8 } = {}) {
    if (finished()) return;
    noise.gpsEast = 0.9 * noise.gpsEast + 0.35 * random.normal();
    noise.gpsNorth = 0.9 * noise.gpsNorth + 0.35 * random.normal();
    noise.heartRate = 0.85 * noise.heartRate + 0.7 * random.normal();
    samples.push({
      second: rider.second,
      east: rider.east + noise.gpsEast,
      north: rider.north + noise.gpsNorth,
      speed: Math.max(0, rider.speed + 0.12 * random.normal()),
      heartRate: Math.round(rider.heartRate + noise.heartRate),
      distance: rider.distance,
    });
    rider.speed = Math.max(0, rider.speed + clamp(targetSpeed - rider.speed, -braking, acceleration));
    const direction = unitVector(heading);
    rider.east += rider.speed * direction.east;
    rider.north += rider.speed * direction.north;
    rider.distance += rider.speed;
    const target = effort + HEART_RATE.sessionDrift * rider.second / SESSION_SECONDS;
    rider.heartRate += (target - rider.heartRate) / (target > rider.heartRate ? 28 : 75);
    rider.second += 1;
  }

  function stand(until) {
    let heading = random.between(0, 360);
    while (!finished() && rider.second < until) {
      heading += 40 * random.normal();
      tick(random.uniform() < 0.9 ? 0.12 : 0.6, heading, HEART_RATE.standing, { acceleration: 0.4 });
    }
  }

  function walkTo(point) {
    while (!finished() && distanceTo(point) > 4) {
      tick(1.15 + 0.1 * random.normal(), bearingTo(point) + 6 * random.normal(), HEART_RATE.walking, { acceleration: 0.5 });
    }
  }

  function beach(seconds) {
    const until = seconds === undefined ? Infinity : rider.second + seconds;
    stand(Math.min(until, rider.second + random.between(18, 32)));
    walkTo({ east: random.between(-3, 3), north: random.between(-3, 3) });
    stand(until);
  }

  function rideEffort(offWind) {
    return Math.max(122, HEART_RATE.riding + 2.5 * (rider.speed - 6.5) + (offWind < 80 ? 5 : 0));
  }

  // A fall: the rider drifts slowly downwind until the kite is relaunched and the board is back on.
  function crash() {
    const until = rider.second + (random.uniform() < 0.62 ? random.between(7, 19) : random.between(32, 85));
    while (!finished() && rider.second < until) {
      noise.course = 0.93 * noise.course + 1.1 * random.normal();
      const downwind = windDirectionAt(rider.second) + 180;
      tick(0.35 + 0.25 * random.uniform(), downwind + 4 * noise.course, HEART_RATE.swimming, { braking: 4 });
    }
  }

  // A transition: brake on the old course, swing the board through downwind, then accelerate away.
  // Most are slow sliding turns; some are carved and keep more speed through a wider arc.
  function turn(leg, next) {
    const carved = random.uniform() < 0.3;
    const slowest = carved ? random.between(3.2, 4.5) : random.between(1.6, 2.6);
    const brakeSeconds = Math.round(random.between(1, 3));
    for (let step = 0; step < brakeSeconds; step += 1) {
      tick(slowest + 1, windDirectionAt(rider.second) + leg.tack * (leg.offWind + 8), rideEffort(leg.offWind), { braking: 2.2 });
    }
    const swingSeconds = Math.round(carved ? random.between(4, 6) : random.between(3, 5));
    const sweep = 360 - leg.offWind - next.offWind;
    for (let step = 1; step <= swingSeconds; step += 1) {
      const progress = step / swingSeconds;
      const offWind = leg.offWind + sweep * progress * progress * (3 - 2 * progress);
      tick(slowest + 0.3 * random.normal(), windDirectionAt(rider.second) + leg.tack * offWind, rideEffort(90) + 3, { braking: 2.2 });
    }
  }

  // tack 1 heads out to sea, tack -1 heads back towards the beach.
  function planLeg(tack, phase, end) {
    const upwindTarget = rider.second > end - 180 ? 20 : phase.upwindTarget;
    const outerTurn = random.uniform() < 0.15 ? random.between(150, 300) : random.between(360, 620);
    return {
      tack,
      offWind: clamp(88 + (upwindDistance() - upwindTarget) / 14 + 4 * random.normal(), 64, 112),
      // Degrees per second the rider gradually heads up or bears away, which bends the leg slightly.
      drift: 0.07 * random.normal(),
      turnAt: tack === 1 ? outerTurn : WATERLINE_METRES + random.between(35, 190),
    };
  }

  // Sails one leg. Returns true when the rider has come back in and stopped at the beach.
  function sail(leg, end) {
    const started = rider.second;
    const landing = { east: offshore.east * WATERLINE_METRES, north: offshore.north * WATERLINE_METRES };
    while (!finished()) {
      const returning = rider.second >= end;
      const fromShore = offshoreDistance();
      const wind = windDirectionAt(rider.second);
      // Angle off the wind that points straight at the landing spot on the inbound tack.
      const needed = ((wind - bearingTo(landing)) % 360 + 360) % 360;
      const canFetchBeach = needed <= 125 || needed > 250;
      let offWind = leg.offWind + clamp(leg.drift * (rider.second - started), -10, 10);
      let speedLimit = Infinity;
      if (leg.tack === 1) {
        const turnForHome = returning && needed >= 70 && needed <= 120 && rider.second - started > 8;
        if (fromShore >= leg.turnAt || turnForHome) return false;
      } else if (returning && canFetchBeach) {
        if (fromShore <= WATERLINE_METRES + 3) return true;
        offWind = needed > 250 ? 64 : clamp(needed, 64, 125);
        speedLimit = fromShore < WATERLINE_METRES + 25 ? 2 : fromShore < WATERLINE_METRES + 60 ? 4.5 : Infinity;
      } else if (fromShore <= leg.turnAt) {
        return false;
      }
      noise.course = 0.93 * noise.course + 1.1 * random.normal();
      noise.gust = 0.97 * noise.gust + 0.02 * random.normal();
      const course = offWind + noise.course;
      const fatigue = 1 - 0.06 * rider.second / SESSION_SECONDS;
      const speed = boardSpeed(course) * (1 + clamp(noise.gust, -0.2, 0.2)) * fatigue;
      tick(Math.min(speed, speedLimit), wind + leg.tack * course, rideEffort(course));
      if (speedLimit === Infinity && random.uniform() < 1 / 1100) crash();
    }
    return true;
  }

  function ride(phase) {
    const end = rider.second + phase.seconds;
    // Carry the board into the shallows before starting.
    while (!finished() && offshoreDistance() < WATERLINE_METRES + 8) {
      tick(1.05 + 0.1 * random.normal(), SHORE_BEARING + 90 + 8 * random.normal(), HEART_RATE.walking, { acceleration: 0.5 });
    }
    stand(rider.second + random.between(6, 14));
    let leg = planLeg(1, phase, end);
    while (!finished()) {
      if (sail(leg, end)) return;
      const next = planLeg(-leg.tack, phase, end);
      if (random.uniform() < 0.07) crash();
      else turn(leg, next);
      leg = next;
    }
  }

  PLAN.forEach((phase) => (phase.type === "ride" ? ride(phase) : beach(phase.seconds)));
  return samples;
}

function demoMessage(globalNumber, name, fields, units = {}) {
  return {
    globalNumber,
    name,
    fields,
    rawFields: { ...fields },
    fieldDetails: Object.fromEntries(Object.keys(fields).map((fieldName, fieldNumber) => [fieldName, {
      name: fieldName,
      label: fieldName,
      unit: units[fieldName] ?? null,
      baseType: null,
      fieldNumber,
      developer: false,
    }])),
  };
}

function messageTypes(messages) {
  const counts = new Map();
  messages.forEach((message) => {
    const current = counts.get(message.globalNumber);
    counts.set(message.globalNumber, current
      ? { ...current, count: current.count + 1 }
      : { globalNumber: message.globalNumber, name: message.name, count: 1 });
  });
  return [...counts.values()];
}

export function createDemoActivity() {
  const samples = simulateSession();
  const longitudeScale = METRES_PER_DEGREE * Math.cos(GEAR_SPOT.latitude * Math.PI / 180);
  const records = samples.map((sample) => demoMessage(20, "record", {
    timestamp: START_TIME + sample.second,
    position_lat: GEAR_SPOT.latitude + sample.north / METRES_PER_DEGREE,
    position_long: GEAR_SPOT.longitude + sample.east / longitudeScale,
    heart_rate: sample.heartRate,
    distance: sample.distance,
    enhanced_speed: sample.speed,
    gps_accuracy: 3 + (sample.second % 4) * 0.35,
    calories: Math.round(1010 * sample.second / SESSION_SECONDS),
    temperature: 29,
  }, {
    distance: "m",
    enhanced_speed: "m/s",
    gps_accuracy: "m",
    temperature: "C",
  }));

  const heartRates = samples.map((sample) => sample.heartRate);
  const distance = samples.at(-1).distance;
  const timeInZone = [0, 0, 0, 0, 0];
  heartRates.forEach((heartRate) => {
    const zone = HEART_RATE_ZONE_LIMITS.findIndex((limit) => heartRate < limit);
    timeInZone[zone < 0 ? HEART_RATE_ZONE_LIMITS.length : zone] += 1;
  });

  const weather = WEATHER.map(([offset, windSpeed, windDirection, windGusts]) => demoMessage(128, "weather_conditions", {
    timestamp: START_TIME + offset,
    observed_at_time: START_TIME + offset,
    weather_location: "El Gouna, Egypt (synthetic)",
    temperature: 29,
    wind_speed: windSpeed,
    wind_direction: windDirection,
    wind_gusts: windGusts,
  }, {
    temperature: "C",
    wind_speed: "m/s",
    wind_direction: "degrees",
    wind_gusts: "m/s",
  }));

  const fileId = demoMessage(0, "file_id", {
    product_name: "Synthetic documentation session",
    time_created: START_TIME,
  });
  const device = demoMessage(23, "device_info", { device_name: "Synthetic demo device" });
  const session = demoMessage(18, "session", {
    start_time: START_TIME,
    sport: 29,
    total_elapsed_time: SESSION_SECONDS,
    total_timer_time: SESSION_SECONDS,
    total_distance: distance,
    total_calories: 1010,
    avg_speed: distance / SESSION_SECONDS,
    max_speed: Math.max(...samples.map((sample) => sample.speed)),
    avg_heart_rate: heartRates.reduce((total, heartRate) => total + heartRate, 0) / heartRates.length,
    max_heart_rate: Math.max(...heartRates),
    min_heart_rate: Math.min(...heartRates),
    total_training_effect: 3.8,
    training_stress_score: 101.2,
    time_in_hr_zone: timeInZone,
    recovery_time: 46800,
    peak_epoc: 109.5,
    carbs: 78,
    fat: 23,
    fp: 44.2,
    avg_ngp: 7.4,
    feeling: 4,
    description: "Synthetic documentation data: this is data from a dummy 90-minute kite session at El Gouna, Egypt, not a real activity.",
  }, {
    total_elapsed_time: "s",
    total_timer_time: "s",
    total_distance: "m",
    avg_speed: "m/s",
    max_speed: "m/s",
    total_calories: "kcal",
    recovery_time: "s",
  });
  const messages = [fileId, device, ...weather, ...records, session];
  messages.forEach((message, sequence) => {
    message.sequence = sequence;
  });

  return {
    isDemo: true,
    fileId,
    session,
    records,
    messages,
    messageTypes: messageTypes(messages),
    messageCounts: new Map(messageTypes(messages).map((type) => [type.globalNumber, type.count])),
  };
}
