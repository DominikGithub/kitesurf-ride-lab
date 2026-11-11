import { getField } from "./fit-decoder.js";

export const DEFAULT_SEGMENTATION_OPTIONS = Object.freeze({
  activeSpeedMps: 3.5,
  lowMovementSpeedMps: 1.8,
  smoothingSeconds: 15,
  mergeGapSeconds: 25,
  minimumActiveSeconds: 45,
  maximumIntervalSeconds: 5,
  maximumGpsGapSeconds: 30,
  legHeadingSpanSeconds: 6,
  legTurnDegrees: 70,
  legTurnHoldSeconds: 8,
  minimumLegSeconds: 15,
  minimumHeadingDistanceMetres: 5,
});

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function speedForRecord(record, previous) {
  const measured = getField(record, "enhanced_speed") ?? getField(record, "speed");
  if (finite(measured) && measured >= 0) return measured;
  if (!previous || !finite(previous.timestamp) || !finite(previous.distance)) return null;
  const timestamp = getField(record, "timestamp");
  const distance = getField(record, "distance");
  const elapsed = timestamp - previous.timestamp;
  if (!finite(timestamp) || !finite(distance) || elapsed <= 0) return null;
  return Math.max(0, (distance - previous.distance) / elapsed);
}

function positionForRecord(record) {
  const latitude = getField(record, "position_lat");
  const longitude = getField(record, "position_long");
  return finite(latitude) && finite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180
    ? { latitude, longitude }
    : null;
}

export function normalizeTrackRecords(records) {
  let previous = null;
  return records.map((record, index) => {
    const timestamp = getField(record, "timestamp");
    const distance = getField(record, "distance");
    const normalized = {
      index,
      timestamp: finite(timestamp) ? timestamp : null,
      speed: speedForRecord(record, previous),
      smoothedSpeed: null,
      heartRate: getField(record, "heart_rate"),
      position: positionForRecord(record),
      distance: finite(distance) && distance >= 0 ? distance : null,
    };
    previous = normalized;
    return normalized;
  });
}

function buildRouteRuns(records, maximumGpsGapSeconds) {
  const runs = [];
  let current = [];
  let previous = null;
  for (const record of records) {
    if (!record.position) continue;
    const gap = previous && finite(record.timestamp) && finite(previous.timestamp)
      ? record.timestamp - previous.timestamp
      : null;
    if (current.length && (!finite(gap) || gap <= 0 || gap > maximumGpsGapSeconds)) {
      runs.push(current);
      current = [];
    }
    current.push({ ...record.position, index: record.index, timestamp: record.timestamp });
    previous = record;
  }
  if (current.length) runs.push(current);
  return runs.filter((run) => run.length >= 2);
}

// Centred rolling median, so one-off speed spikes and brief dips do not move section boundaries.
function smoothSpeeds(timed, smoothingSeconds) {
  const half = smoothingSeconds / 2;
  let lower = 0;
  let upper = 0;
  timed.forEach((record, position) => {
    while (lower < position && timed[lower].timestamp < record.timestamp - half) lower += 1;
    while (upper < timed.length && timed[upper].timestamp <= record.timestamp + half) upper += 1;
    const speeds = [];
    for (let index = lower; index < upper; index += 1) {
      if (finite(timed[index].speed) && timed[index].speed >= 0) speeds.push(timed[index].speed);
    }
    record.smoothedSpeed = median(speeds);
  });
}

function activeIntervals(timed, options) {
  const raw = [];
  let current = null;
  timed.forEach((record, position) => {
    const previous = timed[position - 1];
    const paused = Boolean(previous) && record.timestamp - previous.timestamp > options.maximumIntervalSeconds;
    const active = record.smoothedSpeed !== null && record.smoothedSpeed > options.activeSpeedMps;
    if (current && (paused || !active)) {
      current.end = paused ? previous.timestamp + 1 : record.timestamp;
      raw.push(current);
      current = null;
    }
    if (active && !current) current = { start: record.timestamp, end: null };
  });
  if (current) {
    current.end = timed.at(-1).timestamp + 1;
    raw.push(current);
  }

  const merged = [];
  raw.forEach((interval) => {
    const last = merged.at(-1);
    if (last && interval.start - last.end <= options.mergeGapSeconds) last.end = interval.end;
    else merged.push({ ...interval });
  });
  return merged.filter((interval) => interval.end - interval.start >= options.minimumActiveSeconds);
}

function timelineSpans(startTimestamp, endTimestamp, intervals) {
  const spans = [];
  let cursor = startTimestamp;
  intervals.forEach((interval) => {
    if (interval.start > cursor) spans.push({ start: cursor, end: interval.start, type: "inactive" });
    spans.push({ start: interval.start, end: interval.end, type: "active" });
    cursor = interval.end;
  });
  if (cursor < endTimestamp) spans.push({ start: cursor, end: endTimestamp, type: "inactive" });
  return spans;
}

function recordsBetween(records, startTimestamp, endTimestamp) {
  return records.filter((record) => finite(record.timestamp)
    && record.timestamp >= startTimestamp && record.timestamp < endTimestamp);
}

function recordRanges(selected, maximumIntervalSeconds) {
  if (!selected.length) return [];
  const ranges = [];
  let start = selected[0].index;
  let previous = selected[0];
  for (let index = 1; index < selected.length; index += 1) {
    const record = selected[index];
    if (record.timestamp - previous.timestamp > maximumIntervalSeconds) {
      ranges.push({ startIndex: start, endIndex: previous.index });
      start = record.index;
    }
    previous = record;
  }
  ranges.push({ startIndex: start, endIndex: previous.index });
  return ranges;
}

function distanceBetween(start, end) {
  const latitude = (end.latitude - start.latitude) * Math.PI / 180;
  const longitude = (end.longitude - start.longitude) * Math.PI / 180;
  const startLatitude = start.latitude * Math.PI / 180;
  const endLatitude = end.latitude * Math.PI / 180;
  const a = Math.sin(latitude / 2) ** 2 + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitude / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function bearingBetween(start, end) {
  const startLatitude = start.latitude * Math.PI / 180;
  const endLatitude = end.latitude * Math.PI / 180;
  const longitude = (end.longitude - start.longitude) * Math.PI / 180;
  const y = Math.sin(longitude) * Math.cos(endLatitude);
  const x = Math.cos(startLatitude) * Math.sin(endLatitude)
    - Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(longitude);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function angleDifference(from, to) {
  return Math.abs(((to - from + 540) % 360) - 180);
}

function directionStats(records, ranges, maximumGpsGapSeconds) {
  const bearings = [];
  for (let index = 0; index < records.length - 1; index += 1) {
    const start = records[index];
    const end = records[index + 1];
    if (!start.position || !end.position || !finite(start.timestamp) || !finite(end.timestamp)) continue;
    if (!sectionContainsIndex({ ranges }, start.index) || !sectionContainsIndex({ ranges }, end.index)) continue;
    const elapsed = end.timestamp - start.timestamp;
    const distance = distanceBetween(start.position, end.position);
    if (elapsed <= 0 || elapsed > maximumGpsGapSeconds || distance < 2) continue;
    bearings.push(bearingBetween(start.position, end.position));
  }
  if (bearings.length < 2) return { average: null, standardDeviation: null, sampleCount: bearings.length };
  const meanX = bearings.reduce((sum, bearing) => sum + Math.cos(bearing * Math.PI / 180), 0) / bearings.length;
  const meanY = bearings.reduce((sum, bearing) => sum + Math.sin(bearing * Math.PI / 180), 0) / bearings.length;
  const averageDirection = (Math.atan2(meanY, meanX) * 180 / Math.PI + 360) % 360;
  const differences = bearings.map((bearing) => ((bearing - averageDirection + 540) % 360) - 180);
  const standardDeviation = Math.sqrt(differences.reduce((sum, difference) => sum + difference ** 2, 0) / differences.length);
  return { average: averageDirection, standardDeviation, sampleCount: bearings.length };
}

function intervalStats(records, startTimestamp, endTimestamp, maximumIntervalSeconds) {
  let activeSeconds = 0;
  let distance = 0;
  for (let index = 0; index < records.length - 1; index += 1) {
    const start = records[index];
    const end = records[index + 1];
    if (!finite(start.timestamp) || !finite(end.timestamp) || !finite(start.speed)) continue;
    const elapsed = end.timestamp - start.timestamp;
    if (elapsed <= 0 || elapsed > maximumIntervalSeconds) continue;
    const overlap = Math.max(0, Math.min(end.timestamp, endTimestamp) - Math.max(start.timestamp, startTimestamp));
    if (!overlap) continue;
    activeSeconds += overlap;
    distance += start.speed * overlap;
  }
  return { activeSeconds, distance, averageSpeed: activeSeconds ? distance / activeSeconds : null };
}

function sectionHeartRate(selected) {
  const values = selected.filter((record) => finite(record.heartRate) && record.heartRate > 0).map((record) => record.heartRate);
  if (!values.length) return { average: null, trend: null };
  const split = Math.max(1, Math.floor(values.length * 0.2));
  const first = average(values.slice(0, split));
  const last = average(values.slice(-split));
  return { average: average(values), trend: values.length >= 4 ? last - first : null };
}

function inactiveState(selected, options) {
  const typicalSpeed = median(selected.filter((record) => record.smoothedSpeed !== null).map((record) => record.smoothedSpeed));
  if (typicalSpeed === null) return "unclassified";
  return typicalSpeed < options.lowMovementSpeedMps ? "low movement" : "slow transit";
}

// A leg ends where the course over ground turns by more than legTurnDegrees and stays turned,
// which is what a tack, jibe or transition looks like on the track.
function legBoundaries(selected, startTimestamp, endTimestamp, options) {
  const points = selected.filter((record) => record.position);
  const headings = [];
  let ahead = 0;
  points.forEach((point, position) => {
    ahead = Math.max(ahead, position + 1);
    while (ahead < points.length && points[ahead].timestamp < point.timestamp + options.legHeadingSpanSeconds) ahead += 1;
    const target = points[ahead];
    if (!target || target.timestamp - point.timestamp > options.maximumGpsGapSeconds) return;
    if (distanceBetween(point.position, target.position) < options.minimumHeadingDistanceMetres) return;
    headings.push({
      // The heading describes the stretch ahead of the point, so it is dated to the middle of that stretch.
      timestamp: (point.timestamp + target.timestamp) / 2,
      heading: bearingBetween(point.position, target.position),
    });
  });
  if (headings.length < 2) return [];

  const turns = [];
  let reference = headings[0].heading;
  let turnStart = null;
  headings.forEach((sample) => {
    if (angleDifference(reference, sample.heading) <= options.legTurnDegrees) {
      turnStart = null;
      return;
    }
    turnStart ??= sample;
    if (sample.timestamp - turnStart.timestamp < options.legTurnHoldSeconds) return;
    turns.push(turnStart.timestamp);
    reference = sample.heading;
    turnStart = null;
  });

  const boundaries = [];
  let legStart = startTimestamp;
  turns.forEach((timestamp) => {
    if (timestamp - legStart < options.minimumLegSeconds) return;
    boundaries.push(timestamp);
    legStart = timestamp;
  });
  if (boundaries.length && endTimestamp - boundaries.at(-1) < options.minimumLegSeconds) boundaries.pop();
  return boundaries;
}

function buildLegs(records, selected, startTimestamp, endTimestamp, options) {
  const edges = [startTimestamp, ...legBoundaries(selected, startTimestamp, endTimestamp, options), endTimestamp];
  return edges.slice(1).map((legEnd, position) => {
    const legStart = edges[position];
    const legRecords = selected.filter((record) => record.timestamp >= legStart && record.timestamp < legEnd);
    const positioned = legRecords.filter((record) => record.position);
    const interval = intervalStats(records, legStart, legEnd, options.maximumIntervalSeconds);
    const speeds = legRecords.filter((record) => finite(record.speed) && record.speed >= 0).map((record) => record.speed);
    return {
      number: position + 1,
      startTimestamp: legStart,
      endTimestamp: legEnd,
      duration: legEnd - legStart,
      startIndex: legRecords.length ? legRecords[0].index : null,
      endIndex: legRecords.length ? legRecords.at(-1).index : null,
      distance: interval.distance,
      averageSpeed: interval.averageSpeed,
      maximumSpeed: speeds.length ? Math.max(...speeds) : null,
      heading: positioned.length >= 2 ? bearingBetween(positioned[0].position, positioned.at(-1).position) : null,
    };
  });
}

function makeSection(records, span, options, id, displayNumber) {
  const startTimestamp = span.start;
  const endTimestamp = span.end;
  const selected = recordsBetween(records, startTimestamp, endTimestamp);
  const speeds = selected.filter((record) => finite(record.speed) && record.speed >= 0).map((record) => record.speed);
  const interval = intervalStats(records, startTimestamp, endTimestamp, options.maximumIntervalSeconds);
  const heartRate = sectionHeartRate(selected);
  const ranges = recordRanges(selected, options.maximumIntervalSeconds);
  const direction = directionStats(records, ranges, options.maximumGpsGapSeconds);
  const isActive = span.type === "active";
  const state = isActive ? "active movement" : inactiveState(selected, options);
  const legs = isActive ? buildLegs(records, selected, startTimestamp, endTimestamp, options) : [];
  return {
    id,
    type: span.type,
    state,
    label: `${isActive ? "Active" : "Inactive"} section ${String(displayNumber).padStart(2, "0")}`,
    startIndex: selected.length ? selected[0].index : null,
    endIndex: selected.length ? selected.at(-1).index : null,
    ranges,
    startTimestamp,
    endTimestamp,
    duration: Math.max(0, endTimestamp - startTimestamp),
    activeDuration: isActive ? interval.activeSeconds : 0,
    usableDuration: interval.activeSeconds,
    distance: interval.distance,
    averageSpeed: interval.averageSpeed,
    medianSpeed: median(speeds),
    maximumSpeed: speeds.length ? Math.max(...speeds) : null,
    averageDirection: direction.average,
    directionStdDev: direction.standardDeviation,
    directionSampleCount: direction.sampleCount,
    averageHeartRate: heartRate.average,
    heartRateTrend: heartRate.trend,
    gpsPointCount: selected.filter((record) => record.position).length,
    legs,
    medianLegDuration: median(legs.map((leg) => leg.duration)),
    confidence: isActive && interval.activeSeconds >= (endTimestamp - startTimestamp) * 0.8 ? "high" : "medium",
    evidence: isActive
      ? [
        `${options.smoothingSeconds}-second median speed above ${(options.activeSpeedMps * 3.6).toFixed(1)} km/h`,
        `stops shorter than ${options.mergeGapSeconds} seconds bridged`,
        `${legs.length} ${legs.length === 1 ? "leg" : "legs"} between turns`,
      ]
      : [
        `no riding stretch of ${options.minimumActiveSeconds} seconds or longer`,
        state === "unclassified" ? "no usable speed samples" : `${state} is the typical state`,
      ],
  };
}

export function sectionContainsIndex(section, index) {
  return section?.ranges?.some((range) => index >= range.startIndex && index <= range.endIndex) ?? false;
}

export function segmentTrack(records, suppliedOptions = {}) {
  const options = { ...DEFAULT_SEGMENTATION_OPTIONS, ...suppliedOptions };
  const normalizedRecords = normalizeTrackRecords(records);
  const timed = normalizedRecords.filter((record) => finite(record.timestamp));
  smoothSpeeds(timed, options.smoothingSeconds);
  const spans = timed.length
    ? timelineSpans(timed[0].timestamp, timed.at(-1).timestamp + 1, activeIntervals(timed, options))
    : [];
  const sections = spans.map((span, index) => makeSection(normalizedRecords, span, options, index, index + 1));
  const activeSections = sections.filter((section) => section.type === "active");
  const routeRuns = buildRouteRuns(normalizedRecords, options.maximumGpsGapSeconds);
  const activeDuration = activeSections.reduce((sum, section) => sum + section.activeDuration, 0);
  const activeDistance = activeSections.reduce((sum, section) => sum + section.distance, 0);
  const legs = activeSections.flatMap((section) => section.legs);
  return {
    options,
    records: normalizedRecords,
    routeRuns,
    sections,
    activeSections,
    activeDuration,
    activeDistance,
    averageActiveSpeed: activeDuration ? activeDistance / activeDuration : null,
    legCount: legs.length,
    medianLegDuration: median(legs.map((leg) => leg.duration)),
  };
}
