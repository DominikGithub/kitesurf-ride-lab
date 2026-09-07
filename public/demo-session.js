const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);
const SESSION_SECONDS = 90 * 60;
const SAMPLE_SECONDS = 2;
const START_TIME = Math.floor((Date.UTC(2025, 6, 18, 13, 30) - FIT_EPOCH_MS) / 1000);
const EL_GOUNA = { latitude: 27.3976, longitude: 33.6842 };
const ROUTE_NODES_METRES = [
  { east: -600, north: -780 },
  { east: -505, north: -738 },
  { east: -365, north: -665 },
  { east: -205, north: -570 },
  { east: -30, north: -466 },
  { east: 155, north: -385 },
  { east: 325, north: -326 },
  { east: 440, north: -300 },
  { east: 454, north: -284 },
  { east: 427, north: -270 },
  { east: 355, north: -283 },
  { east: 190, north: -326 },
  { east: 5, north: -386 },
  { east: -180, north: -446 },
  { east: -345, north: -488 },
  { east: -460, north: -500 },
  { east: -479, north: -483 },
  { east: -468, north: -455 },
  { east: -395, north: -414 },
  { east: -240, north: -337 },
  { east: -65, north: -243 },
  { east: 120, north: -155 },
  { east: 305, north: -74 },
  { east: 470, north: -12 },
  { east: 570, north: 20 },
  { east: 588, north: 39 },
  { east: 587, north: 65 },
  { east: 550, north: 80 },
  { east: 395, north: 41 },
  { east: 220, north: -12 },
  { east: 35, north: -76 },
  { east: -155, north: -125 },
  { east: -340, north: -158 },
  { east: -500, north: -170 },
  { east: -520, north: -152 },
  { east: -508, north: -120 },
  { east: -435, north: -88 },
  { east: -280, north: -22 },
  { east: -100, north: 65 },
  { east: 90, north: 154 },
  { east: 280, north: 244 },
  { east: 455, north: 325 },
  { east: 580, north: 365 },
  { east: 620, north: 370 },
  { east: 638, north: 385 },
  { east: 637, north: 411 },
  { east: 600, north: 431 },
  { east: 440, north: 402 },
  { east: 270, north: 355 },
  { east: 90, north: 300 },
  { east: -100, north: 243 },
  { east: -300, north: 205 },
  { east: -460, north: 190 },
  { east: -478, north: 208 },
  { east: -470, north: 235 },
  { east: -395, north: 272 },
  { east: -240, north: 345 },
  { east: -70, north: 430 },
  { east: 110, north: 519 },
  { east: 290, north: 605 },
  { east: 465, north: 684 },
  { east: 570, north: 724 },
  { east: 600, north: 730 },
  { east: 616, north: 747 },
  { east: 612, north: 775 },
  { east: 574, north: 797 },
  { east: 415, north: 755 },
  { east: 235, north: 693 },
  { east: 45, north: 627 },
  { east: -145, north: 560 },
  { east: -310, north: 520 },
  { east: -400, north: 510 },
  { east: -417, north: 530 },
  { east: -408, north: 557 },
  { east: -330, north: 600 },
  { east: -170, north: 673 },
  { east: 10, north: 758 },
  { east: 190, north: 848 },
  { east: 365, north: 935 },
  { east: 505, north: 1020 },
  { east: 555, north: 1058 },
  { east: 570, north: 1070 },
  { east: 587, north: 1089 },
  { east: 581, north: 1116 },
  { east: 542, north: 1138 },
  { east: 385, north: 1095 },
  { east: 205, north: 1035 },
  { east: 20, north: 970 },
  { east: -160, north: 906 },
  { east: -300, north: 856 },
  { east: -350, north: 840 },
  { east: -365, north: 861 },
  { east: -354, north: 890 },
  { east: -280, north: 936 },
  { east: -120, north: 1012 },
  { east: 55, north: 1104 },
  { east: 230, north: 1200 },
  { east: 395, north: 1298 },
  { east: 520, north: 1381 },
  { east: 560, north: 1410 },
  { east: 578, north: 1429 },
  { east: 570, north: 1457 },
  { east: 530, north: 1482 },
  { east: 375, north: 1435 },
  { east: 200, north: 1360 },
  { east: 25, north: 1295 },
  { east: -145, north: 1227 },
  { east: -250, north: 1195 },
  { east: -270, north: 1190 },
  { east: -283, north: 1213 },
  { east: -266, north: 1243 },
  { east: -194, north: 1290 },
  { east: -35, north: 1372 },
  { east: 135, north: 1468 },
  { east: 305, north: 1560 },
  { east: 468, north: 1641 },
  { east: 580, north: 1682 },
  { east: 610, north: 1690 },
  { east: 625, north: 1676 },
  { east: 618, north: 1650 },
  { east: 580, north: 1612 },
  { east: 475, north: 1560 },
  { east: 355, north: 1497 },
  { east: 260, north: 1450 },
  { east: 230, north: 1422 },
  { east: 186, north: 1360 },
  { east: 125, north: 1286 },
  { east: 55, north: 1215 },
  { east: -18, north: 1144 },
  { east: -93, north: 1073 },
  { east: -130, north: 1020 },
  { east: -111, north: 1000 },
  { east: -55, north: 965 },
  { east: 30, north: 914 },
  { east: 125, north: 846 },
  { east: 225, north: 767 },
  { east: 325, north: 685 },
  { east: 410, north: 618 },
  { east: 450, north: 590 },
  { east: 467, north: 572 },
  { east: 462, north: 548 },
  { east: 425, north: 524 },
  { east: 315, north: 490 },
  { east: 195, north: 449 },
  { east: 70, north: 405 },
  { east: -55, north: 367 },
  { east: -110, north: 350 },
  { east: -82, north: 327 },
  { east: -24, north: 284 },
  { east: 52, north: 226 },
  { east: 132, north: 166 },
  { east: 215, north: 105 },
  { east: 300, north: 48 },
  { east: 382, north: -2 },
  { east: 450, north: -50 },
  { east: 466, north: -66 },
  { east: 464, north: -93 },
  { east: 425, north: -117 },
  { east: 305, north: -146 },
  { east: 175, north: -179 },
  { east: 40, north: -211 },
  { east: -105, north: -237 },
  { east: -230, north: -250 },
  { east: -216, north: -273 },
  { east: -160, north: -320 },
  { east: -86, north: -367 },
  { east: -4, north: -416 },
  { east: 75, north: -466 },
  { east: 140, north: -507 },
  { east: 170, north: -520 },
  { east: 150, north: -540 },
  { east: 100, north: -563 },
  { east: 28, north: -592 },
  { east: -62, north: -624 },
  { east: -165, north: -662 },
  { east: -280, north: -706 },
  { east: -410, north: -748 },
  { east: -530, north: -775 },
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
