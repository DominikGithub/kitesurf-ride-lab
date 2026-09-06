const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);
const SESSION_SECONDS = 90 * 60;
const SAMPLE_SECONDS = 2;
const START_TIME = Math.floor((Date.UTC(2025, 6, 18, 13, 30) - FIT_EPOCH_MS) / 1000);
const EL_GOUNA = { latitude: 27.3976, longitude: 33.6842 };
const ROUTE_NODES_METRES = [
  { east: -600, north: -780 },
  { east: 650, north: 150 },
  { east: -520, north: 1080 },
  { east: 610, north: 1770 },
  { east: -130, north: 420 },
  { east: 550, north: -470 },
  { east: -600, north: -780 },
];

const ROUTE_SEGMENTS = ROUTE_NODES_METRES.slice(1).map((end, index) => {
  const start = ROUTE_NODES_METRES[index];
  return { start, end, length: Math.hypot(end.east - start.east, end.north - start.north) };
});
const ROUTE_LENGTH = ROUTE_SEGMENTS.reduce((total, segment) => total + segment.length, 0);

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

function routePosition(distance) {
  let remaining = distance % ROUTE_LENGTH;
  let segment = ROUTE_SEGMENTS.at(-1);
  for (const candidate of ROUTE_SEGMENTS) {
    if (remaining <= candidate.length) {
      segment = candidate;
      break;
    }
    remaining -= candidate.length;
  }
  const ratio = segment.length ? remaining / segment.length : 0;
  const east = segment.start.east + (segment.end.east - segment.start.east) * ratio;
  const north = segment.start.north + (segment.end.north - segment.start.north) * ratio;
  return {
    latitude: EL_GOUNA.latitude + north / 111320,
    longitude: EL_GOUNA.longitude + east / (111320 * Math.cos(EL_GOUNA.latitude * Math.PI / 180)),
  };
}

function isActive(second) {
  return (second >= 180 && second < 2040) || (second >= 2340 && second < 5220);
}

function speedAt(second, active) {
  if (!active) return 0.95 + 0.22 * Math.sin(second / 23);
  return 6.85 + 0.88 * Math.sin(second / 47) + 0.38 * Math.sin(second / 9);
}

function heartRateAt(second, active) {
  if (!active) return Math.round(97 + 4 * Math.sin(second / 29));
  return Math.round(138 + 13 * Math.sin(second / 71) + 4 * Math.sin(second / 13) + second / 460);
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
  const records = [];
  let distance = 0;
  let totalHeartRate = 0;
  let maxHeartRate = 0;
  let minHeartRate = Infinity;
  let maxSpeed = 0;

  for (let second = 0; second <= SESSION_SECONDS; second += SAMPLE_SECONDS) {
    const active = isActive(second);
    const speed = speedAt(second, active);
    const heartRate = heartRateAt(second, active);
    const position = routePosition(distance);
    records.push(demoMessage(20, "record", {
      timestamp: START_TIME + second,
      position_lat: position.latitude,
      position_long: position.longitude,
      heart_rate: heartRate,
      distance,
      enhanced_speed: speed,
      gps_accuracy: 3 + (second / SAMPLE_SECONDS % 4) * 0.35,
      calories: Math.round(1010 * second / SESSION_SECONDS),
      temperature: 29,
    }, {
      distance: "m",
      enhanced_speed: "m/s",
      gps_accuracy: "m",
      temperature: "C",
    }));
    totalHeartRate += heartRate;
    maxHeartRate = Math.max(maxHeartRate, heartRate);
    minHeartRate = Math.min(minHeartRate, heartRate);
    maxSpeed = Math.max(maxSpeed, speed);
    if (second < SESSION_SECONDS) distance += speed * SAMPLE_SECONDS;
  }

  const weather = [
    [0, 8.9, 328, 11.3],
    [900, 9.2, 331, 11.8],
    [1800, 9.5, 334, 12.1],
    [2700, 9.0, 330, 11.4],
    [3600, 9.4, 327, 12.0],
    [4500, 9.1, 332, 11.7],
    [5400, 9.3, 329, 11.9],
  ].map(([offset, windSpeed, windDirection, windGusts]) => demoMessage(128, "weather_conditions", {
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
    max_speed: maxSpeed,
    avg_heart_rate: totalHeartRate / records.length,
    max_heart_rate: maxHeartRate,
    min_heart_rate: minHeartRate,
    total_training_effect: 3.8,
    training_stress_score: 101.2,
    time_in_hr_zone: [540, 1200, 1980, 1320, 360],
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
