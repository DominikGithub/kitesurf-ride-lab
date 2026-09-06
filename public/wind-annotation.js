import { dateFromFit, getField } from "./fit-decoder.js";

const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);
const MAX_GPS_GAP_SECONDS = 8;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function canonicalFieldName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function signedDegrees(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function radians(value) {
  return value * Math.PI / 180;
}

function degrees(value) {
  return value * 180 / Math.PI;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function fieldEntry(message, aliases) {
  return Object.entries(message.fields).find(([name]) => aliases.has(canonicalFieldName(name))) ?? null;
}

function fieldValue(message, aliases) {
  const entry = fieldEntry(message, aliases);
  if (!entry) return null;
  const [name, value] = entry;
  return { name, value, detail: message.fieldDetails?.[name] };
}

function speedInMetresPerSecond(value, unit) {
  if (!isFiniteNumber(value)) return null;
  const normalizedUnit = String(unit ?? "m/s").toLowerCase().replace(/\s/g, "");
  if (["km/h", "kph", "kmh"].includes(normalizedUnit)) return value / 3.6;
  if (["kn", "kt", "kts", "knot", "knots"].includes(normalizedUnit)) return value * 0.514444;
  if (["mph", "mi/h"].includes(normalizedUnit)) return value * 0.44704;
  return value;
}

function directionInDegrees(value, unit) {
  if (!isFiniteNumber(value)) return null;
  const normalizedUnit = String(unit ?? "degrees").toLowerCase().replace(/\s/g, "");
  return normalizeDegrees(normalizedUnit.startsWith("rad") ? degrees(value) : value);
}

function validPosition(record) {
  const latitude = getField(record, "position_lat");
  const longitude = getField(record, "position_long");
  return isFiniteNumber(latitude) && isFiniteNumber(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
    ? { latitude, longitude }
    : null;
}

function windSampleFromMessage(message) {
  const timestamp = getField(message, "timestamp") ?? getField(message, "observed_at_time");
  const speed = fieldValue(message, new Set(["windspeed", "windspeed10m", "windvelocity", "windspd", "windms"]));
  const direction = fieldValue(message, new Set(["winddirection", "winddirection10m", "windbearing", "winddir", "windheading"]));
  const gusts = fieldValue(message, new Set(["windgust", "windgusts", "windgust10m", "windgusts10m", "gust", "gustspeed"]));
  const windSpeed = speedInMetresPerSecond(speed?.value, speed?.detail?.unit);
  const windDirection = directionInDegrees(direction?.value, direction?.detail?.unit);
  const windGusts = speedInMetresPerSecond(gusts?.value, gusts?.detail?.unit);
  if (!isFiniteNumber(timestamp) || !isFiniteNumber(windSpeed) || windSpeed < 0 || !isFiniteNumber(windDirection)) return null;
  return {
    timestamp,
    windSpeed,
    windDirection,
    windGusts: isFiniteNumber(windGusts) && windGusts >= 0 ? windGusts : null,
    raw: {
      timestamp,
      windSpeed: speed?.value ?? null,
      windDirection: direction?.value ?? null,
      windGusts: gusts?.value ?? null,
    },
  };
}

function uniqueSamples(samples) {
  const byTimestamp = new Map();
  samples.forEach((sample) => byTimestamp.set(sample.timestamp, sample));
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function interpolateScalar(left, right, ratio, key) {
  if (!isFiniteNumber(left[key]) || !isFiniteNumber(right[key])) return null;
  return left[key] + (right[key] - left[key]) * ratio;
}

function windVector(sample) {
  // Meteorological wind directions describe where the wind comes from.
  const toward = radians(sample.windDirection + 180);
  return { east: sample.windSpeed * Math.sin(toward), north: sample.windSpeed * Math.cos(toward) };
}

function windFromVector(east, north) {
  const windSpeed = Math.hypot(east, north);
  if (!windSpeed) return { windSpeed: 0, windDirection: 0 };
  return { windSpeed, windDirection: normalizeDegrees(degrees(Math.atan2(-east, -north))) };
}

export function interpolateWind(samples, timestamp) {
  if (!samples.length || !isFiniteNumber(timestamp) || timestamp < samples[0].timestamp || timestamp > samples.at(-1).timestamp) return null;
  let upperIndex = samples.findIndex((sample) => sample.timestamp >= timestamp);
  if (upperIndex < 0) return null;
  if (upperIndex === 0 || samples[upperIndex].timestamp === timestamp) {
    const sample = samples[upperIndex];
    return { ...sample, interpolated: false };
  }
  const lower = samples[upperIndex - 1];
  const upper = samples[upperIndex];
  const ratio = (timestamp - lower.timestamp) / (upper.timestamp - lower.timestamp);
  const lowerVector = windVector(lower);
  const upperVector = windVector(upper);
  const wind = windFromVector(
    lowerVector.east + (upperVector.east - lowerVector.east) * ratio,
    lowerVector.north + (upperVector.north - lowerVector.north) * ratio,
  );
  return {
    timestamp,
    ...wind,
    windGusts: interpolateScalar(lower, upper, ratio, "windGusts"),
    interpolated: true,
  };
}

export function representativeCoordinate(records) {
  const positions = records.map(validPosition).filter(Boolean);
  if (!positions.length) return null;
  return {
    latitude: Math.round(median(positions.map((point) => point.latitude)) * 100) / 100,
    longitude: Math.round(median(positions.map((point) => point.longitude)) * 100) / 100,
  };
}

export function sessionRange(records) {
  const timestamps = records.map((record) => getField(record, "timestamp")).filter(isFiniteNumber);
  return timestamps.length ? { start: Math.min(...timestamps), end: Math.max(...timestamps) } : null;
}

export function extractSavedWindSamples(activity) {
  const weatherMessages = activity.messages.filter((message) => message.globalNumber === 128);
  const standardSamples = uniqueSamples(weatherMessages.map(windSampleFromMessage).filter(Boolean));
  if (standardSamples.length) {
    return {
      samples: standardSamples,
      rawSamples: standardSamples.map((sample) => sample.raw),
      source: "saved-fit",
      sourceLabel: "Saved FIT weather",
      measurementLabel: "Recorded in FIT file",
      model: null,
      returnedCoordinate: null,
    };
  }

  const developerSamples = uniqueSamples(activity.messages
    .filter((message) => Object.values(message.fieldDetails ?? {}).some((detail) => detail.developer && /wind|gust/i.test(detail.name)))
    .map(windSampleFromMessage)
    .filter(Boolean));
  return {
    samples: developerSamples,
    rawSamples: developerSamples.map((sample) => sample.raw),
    source: developerSamples.length ? "saved-developer" : null,
    sourceLabel: developerSamples.length ? "Saved FIT developer weather" : null,
    measurementLabel: developerSamples.length ? "Recorded in FIT file" : null,
    model: null,
    returnedCoordinate: null,
  };
}

export function createWindAnnotation(records, sourceData, extras = {}) {
  const samples = uniqueSamples(sourceData.samples ?? []);
  const timestamps = records.map((record) => getField(record, "timestamp"));
  const recordWind = timestamps.map((timestamp) => interpolateWind(samples, timestamp));
  const timestampCount = timestamps.filter(isFiniteNumber).length;
  const coveredRecordCount = recordWind.filter(Boolean).length;
  const coverageRatio = timestampCount ? coveredRecordCount / timestampCount : 0;
  return {
    status: samples.length ? (coverageRatio === 1 ? "ready" : "partial") : "unavailable",
    source: sourceData.source ?? null,
    sourceLabel: sourceData.sourceLabel ?? null,
    measurementLabel: sourceData.measurementLabel ?? null,
    model: sourceData.model ?? null,
    requestedCoordinate: sourceData.requestedCoordinate ?? null,
    returnedCoordinate: sourceData.returnedCoordinate ?? null,
    rawSamples: sourceData.rawSamples ?? [],
    rawResponse: sourceData.rawResponse ?? null,
    samples,
    recordWind,
    coverage: {
      timestampCount,
      coveredRecordCount,
      ratio: coverageRatio,
      complete: timestampCount > 0 && coveredRecordCount === timestampCount,
    },
    ...extras,
  };
}

export function summarizeAnnotatedWind(recordWind) {
  const samples = recordWind.filter(Boolean);
  if (!samples.length) return null;
  const windSpeed = samples.reduce((total, sample) => total + sample.windSpeed, 0) / samples.length;
  const vector = samples.reduce((total, sample) => {
    const current = windVector(sample);
    return { east: total.east + current.east, north: total.north + current.north };
  }, { east: 0, north: 0 });
  const direction = windFromVector(vector.east, vector.north).windDirection;
  const gustSamples = samples.filter((sample) => isFiniteNumber(sample.windGusts));
  return {
    windSpeed,
    windDirection: direction,
    windGusts: gustSamples.length ? gustSamples.reduce((total, sample) => total + sample.windGusts, 0) / gustSamples.length : null,
  };
}

function utcDate(fitTimestamp) {
  const date = dateFromFit(fitTimestamp);
  return date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function fitTimestampFromIso(value) {
  if (typeof value !== "string" && !isFiniteNumber(value)) return null;
  const milliseconds = isFiniteNumber(value)
    ? value * 1000
    : Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`);
  return Number.isFinite(milliseconds) ? Math.round((milliseconds - FIT_EPOCH_MS) / 1000) : null;
}

export function openMeteoWindUrl(coordinate, range) {
  if (!coordinate || !range) return null;
  const startDate = utcDate(range.start);
  const endDate = utcDate(range.end);
  if (!startDate || !endDate) return null;
  const query = new URLSearchParams({
    latitude: coordinate.latitude.toFixed(2),
    longitude: coordinate.longitude.toFixed(2),
    start_date: startDate,
    end_date: endDate,
    hourly: "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    wind_speed_unit: "ms",
    timezone: "GMT",
    cell_selection: "sea",
  });
  return `https://archive-api.open-meteo.com/v1/archive?${query}`;
}

export async function fetchOpenMeteoWind(coordinate, range, fetchImpl = fetch) {
  const url = openMeteoWindUrl(coordinate, range);
  if (!url) throw new Error("A valid GPS coordinate and timestamp range are required for wind annotation.");
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Open-Meteo could not provide wind data (${response.status}).`);
  const payload = await response.json();
  const hourly = payload?.hourly;
  if (!Array.isArray(hourly?.time) || !Array.isArray(hourly?.wind_speed_10m) || !Array.isArray(hourly?.wind_direction_10m)) {
    throw new Error("Open-Meteo returned no usable hourly wind data.");
  }
  const rawSamples = hourly.time.map((time, index) => ({
    time,
    wind_speed_10m: hourly.wind_speed_10m[index] ?? null,
    wind_direction_10m: hourly.wind_direction_10m[index] ?? null,
    wind_gusts_10m: hourly.wind_gusts_10m?.[index] ?? null,
  }));
  const samples = rawSamples.map((sample) => ({
    timestamp: fitTimestampFromIso(sample.time),
    windSpeed: speedInMetresPerSecond(sample.wind_speed_10m, payload.hourly_units?.wind_speed_10m),
    windDirection: directionInDegrees(sample.wind_direction_10m, payload.hourly_units?.wind_direction_10m),
    windGusts: speedInMetresPerSecond(sample.wind_gusts_10m, payload.hourly_units?.wind_gusts_10m),
  })).filter((sample) => isFiniteNumber(sample.timestamp) && isFiniteNumber(sample.windSpeed) && sample.windSpeed >= 0 && isFiniteNumber(sample.windDirection));
  if (!samples.length) throw new Error("Open-Meteo returned no valid wind samples.");
  return {
    samples,
    rawSamples,
    source: "open-meteo",
    sourceLabel: "Open-Meteo historical sea-grid",
    measurementLabel: "Modelled wind annotation",
    model: payload.model ?? payload.model_name ?? "Open-Meteo historical weather model",
    requestedCoordinate: coordinate,
    returnedCoordinate: isFiniteNumber(payload.latitude) && isFiniteNumber(payload.longitude)
      ? { latitude: payload.latitude, longitude: payload.longitude }
      : null,
    rawResponse: payload,
  };
}

export async function resolveWindAnnotation(activity, fetchImpl = fetch) {
  const saved = extractSavedWindSamples(activity);
  const savedAnnotation = createWindAnnotation(activity.records, saved);
  if (savedAnnotation.coverage.complete) return savedAnnotation;

  const coordinate = representativeCoordinate(activity.records);
  const range = sessionRange(activity.records);
  if (!coordinate || !range) {
    return {
      ...savedAnnotation,
      status: saved.samples.length ? "partial" : "unavailable",
      error: "No complete GPS track and timestamp range are available for a weather lookup.",
    };
  }
  try {
    const modelled = await fetchOpenMeteoWind(coordinate, range, fetchImpl);
    return createWindAnnotation(activity.records, modelled, {
      replacedSavedSamples: saved.samples.length ? saved.rawSamples : null,
    });
  } catch (error) {
    return {
      ...savedAnnotation,
      status: saved.samples.length ? "partial" : "unavailable",
      error: error.message || "Wind data is unavailable.",
    };
  }
}

function haversineMetres(start, end) {
  const latitudeDelta = radians(end.latitude - start.latitude);
  const longitudeDelta = radians(end.longitude - start.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(start.latitude)) * Math.cos(radians(end.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDegrees(start, end) {
  const longitudeDelta = radians(end.longitude - start.longitude);
  const latitudeStart = radians(start.latitude);
  const latitudeEnd = radians(end.latitude);
  return normalizeDegrees(degrees(Math.atan2(
    Math.sin(longitudeDelta) * Math.cos(latitudeEnd),
    Math.cos(latitudeStart) * Math.sin(latitudeEnd) - Math.sin(latitudeStart) * Math.cos(latitudeEnd) * Math.cos(longitudeDelta),
  )));
}

function movementVector(distance, bearing) {
  const heading = radians(bearing);
  return { east: distance * Math.sin(heading), north: distance * Math.cos(heading) };
}

function closeLeg(segments) {
  const duration = segments.reduce((total, segment) => total + segment.seconds, 0);
  const distance = segments.reduce((total, segment) => total + segment.distance, 0);
  if (duration < 20 || distance < 75) return null;
  const weighted = (key) => segments.reduce((total, segment) => total + segment[key] * segment.seconds, 0) / duration;
  return {
    duration,
    distance,
    vmg: weighted("upwindVmg"),
    tackAngle: weighted("tackAngle"),
    speed: weighted("speed"),
    startIndex: segments[0]?.index ?? null,
    endIndex: segments.at(-1)?.index ?? null,
  };
}

export function calculateWindCoaching(records, recordWind) {
  const segments = [];
  for (let index = 1; index < records.length; index += 1) {
    const previousPosition = validPosition(records[index - 1]);
    const position = validPosition(records[index]);
    const previousTimestamp = getField(records[index - 1], "timestamp");
    const timestamp = getField(records[index], "timestamp");
    const wind = recordWind[index];
    if (!previousPosition || !position || !isFiniteNumber(previousTimestamp) || !isFiniteNumber(timestamp) || !wind) continue;
    const seconds = timestamp - previousTimestamp;
    if (seconds <= 0 || seconds > MAX_GPS_GAP_SECONDS) continue;
    const distance = haversineMetres(previousPosition, position);
    const speed = distance / seconds;
    if (distance < 2 || speed > 35) continue;
    const bearing = bearingDegrees(previousPosition, position);
    const signedTackAngle = signedDegrees(wind.windDirection, bearing);
    const tackAngle = Math.abs(signedTackAngle);
    segments.push({
      index,
      timestamp,
      seconds,
      distance,
      speed,
      bearing,
      wind,
      tackAngle,
      tackSide: signedTackAngle < 0 ? -1 : 1,
      upwindVmg: speed * Math.cos(radians(tackAngle)),
    });
  }

  const legs = [];
  let legSegments = [];
  const closeCurrentLeg = () => {
    const leg = closeLeg(legSegments);
    if (leg) legs.push(leg);
    legSegments = [];
  };
  segments.forEach((segment) => {
    const isUpwind = segment.tackAngle >= 20 && segment.tackAngle <= 85 && segment.upwindVmg > 0;
    const previous = legSegments.at(-1);
    const sameLeg = previous
      && segment.timestamp - previous.timestamp <= MAX_GPS_GAP_SECONDS
      && segment.tackSide === previous.tackSide
      && Math.abs(signedDegrees(previous.bearing, segment.bearing)) <= 35;
    if (!isUpwind || (!sameLeg && legSegments.length)) closeCurrentLeg();
    if (isUpwind) legSegments.push(segment);
  });
  closeCurrentLeg();

  const bestLeg = legs.length ? [...legs].sort((left, right) => right.vmg - left.vmg)[0] : null;
  const medianLegVmg = median(legs.map((leg) => leg.vmg));
  const turns = [];
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    if (current.index - previous.index > 3 || Math.abs(signedDegrees(previous.bearing, current.bearing)) < 65) continue;
    const previousMovement = movementVector(previous.distance, previous.bearing);
    const currentMovement = movementVector(current.distance, current.bearing);
    const previousWind = windVector({ windSpeed: 1, windDirection: previous.wind.windDirection });
    const currentWind = windVector({ windSpeed: 1, windDirection: current.wind.windDirection });
    const downwindEast = previousWind.east + currentWind.east;
    const downwindNorth = previousWind.north + currentWind.north;
    const normalizer = Math.hypot(downwindEast, downwindNorth) || 1;
    const displacement = (previousMovement.east + currentMovement.east) * downwindEast / normalizer
      + (previousMovement.north + currentMovement.north) * downwindNorth / normalizer;
    turns.push({ index: current.index, displacement: Math.max(0, displacement) });
    index += 1;
  }

  return {
    eligibleSegmentCount: segments.length,
    validLegCount: legs.length,
    bestLeg,
    medianLegVmg,
    bestLegVmgGain: bestLeg && medianLegVmg && legs.length > 1 ? bestLeg.vmg - medianLegVmg : null,
    turnCount: turns.length,
    averageDownwindTurnDisplacement: turns.length ? turns.reduce((total, turn) => total + turn.displacement, 0) / turns.length : null,
    turnIndices: turns.map((turn) => turn.index),
  };
}
