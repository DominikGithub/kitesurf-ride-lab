import { getField } from "./fit-decoder.js";

export const DEFAULT_SEGMENTATION_OPTIONS = Object.freeze({
  activeSpeedMps: 3.5,
  lowMovementSpeedMps: 1.8,
  windowSeconds: 60,
  minimumWindowSamples: 30,
  minimumActiveWindows: 2,
  maximumIntervalSeconds: 5,
  maximumGpsGapSeconds: 30,
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

function buildMovementWindows(records, options) {
  const timestamped = records.filter((record) => finite(record.timestamp));
  if (!timestamped.length) return { firstTimestamp: null, windows: [] };
  const firstTimestamp = timestamped[0].timestamp;
  const lastTimestamp = timestamped.at(-1).timestamp;
  const windowCount = Math.floor((lastTimestamp - firstTimestamp) / options.windowSeconds) + 1;
  const windows = Array.from({ length: windowCount }, (_, bucket) => ({
    bucket,
    startTimestamp: firstTimestamp + bucket * options.windowSeconds,
    endTimestamp: firstTimestamp + (bucket + 1) * options.windowSeconds,
    records: [],
    speeds: [],
    state: "unknown",
    medianSpeed: null,
  }));

  timestamped.forEach((record) => {
    const bucket = Math.floor((record.timestamp - firstTimestamp) / options.windowSeconds);
    if (bucket < 0 || bucket >= windows.length) return;
    windows[bucket].records.push(record);
    if (finite(record.speed) && record.speed >= 0) windows[bucket].speeds.push(record.speed);
  });

  windows.forEach((window) => {
    window.medianSpeed = median(window.speeds);
    if (window.speeds.length < options.minimumWindowSamples || window.medianSpeed === null) return;
    window.state = window.medianSpeed > options.activeSpeedMps
      ? "active"
      : window.medianSpeed < options.lowMovementSpeedMps ? "low movement" : "slow transit";
  });
  return { firstTimestamp, windows };
}

function activeWindowRuns(windows, options) {
  const runs = [];
  for (let index = 0; index < windows.length;) {
    if (windows[index].state !== "active") {
      index += 1;
      continue;
    }
    const start = index;
    while (windows[index + 1]?.state === "active") index += 1;
    if (index - start + 1 >= options.minimumActiveWindows) runs.push({ start, end: index });
    index += 1;
  }
  return runs;
}

function completeWindowRuns(windows, activeRuns) {
  const runs = [];
  let cursor = 0;
  activeRuns.forEach((activeRun) => {
    if (cursor < activeRun.start) runs.push({ start: cursor, end: activeRun.start - 1, type: "inactive" });
    runs.push({ ...activeRun, type: "active" });
    cursor = activeRun.end + 1;
  });
  if (cursor < windows.length) runs.push({ start: cursor, end: windows.length - 1, type: "inactive" });
  return runs;
}

function recordRanges(records, startTimestamp, endTimestamp, maximumIntervalSeconds) {
  const selected = records.filter((record) => finite(record.timestamp)
    && record.timestamp >= startTimestamp && record.timestamp < endTimestamp);
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

function sectionHeartRate(records, startTimestamp, endTimestamp) {
  const values = records.filter((record) => record.timestamp >= startTimestamp && record.timestamp < endTimestamp
    && finite(record.heartRate) && record.heartRate > 0).map((record) => record.heartRate);
  if (!values.length) return { average: null, trend: null };
  const split = Math.max(1, Math.floor(values.length * 0.2));
  const first = average(values.slice(0, split));
  const last = average(values.slice(-split));
  return { average: average(values), trend: values.length >= 4 ? last - first : null };
}

function inactiveState(windows, run) {
  const counts = new Map();
  windows.slice(run.start, run.end + 1).forEach((window) => {
    if (window.state === "unknown") return;
    counts.set(window.state, (counts.get(window.state) ?? 0) + 1);
  });
  return counts.size ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] : "unclassified";
}

function makeSection(records, windows, run, options, id, displayNumber) {
  const startTimestamp = windows[run.start].startTimestamp;
  const lastTimestamp = records.filter((record) => finite(record.timestamp)).at(-1)?.timestamp;
  const endTimestamp = Math.min(windows[run.end].endTimestamp, lastTimestamp ?? windows[run.end].endTimestamp);
  const selected = records.filter((record) => finite(record.timestamp)
    && record.timestamp >= startTimestamp && record.timestamp < endTimestamp);
  const speeds = selected.filter((record) => finite(record.speed) && record.speed >= 0).map((record) => record.speed);
  const interval = intervalStats(records, startTimestamp, endTimestamp, options.maximumIntervalSeconds);
  const heartRate = sectionHeartRate(records, startTimestamp, endTimestamp);
  const firstIndex = selected.length ? selected[0].index : null;
  const lastIndex = selected.length ? selected.at(-1).index : null;
  const ranges = recordRanges(records, startTimestamp, endTimestamp, options.maximumIntervalSeconds);
  const direction = directionStats(records, ranges, options.maximumGpsGapSeconds);
  const isActive = run.type === "active";
  const state = isActive ? "active movement" : inactiveState(windows, run);
  return {
    id,
    type: run.type,
    state,
    label: `${isActive ? "Active" : "Inactive"} section ${String(displayNumber).padStart(2, "0")}`,
    startIndex: firstIndex,
    endIndex: lastIndex,
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
    confidence: isActive && interval.activeSeconds >= (endTimestamp - startTimestamp) * 0.8 ? "high" : "medium",
    evidence: isActive
      ? [
        `${options.windowSeconds}-second median speed above ${(options.activeSpeedMps * 3.6).toFixed(1)} km/h`,
        `${run.end - run.start + 1} consecutive active windows`,
      ]
      : [
        `${run.end - run.start + 1} non-active windows`,
        state === "unclassified" ? "no stable speed state" : `${state} is the dominant state`,
      ],
  };
}

export function sectionContainsIndex(section, index) {
  return section?.ranges?.some((range) => index >= range.startIndex && index <= range.endIndex) ?? false;
}

export function segmentTrack(records, suppliedOptions = {}) {
  const options = { ...DEFAULT_SEGMENTATION_OPTIONS, ...suppliedOptions };
  const normalizedRecords = normalizeTrackRecords(records);
  const { firstTimestamp, windows } = buildMovementWindows(normalizedRecords, options);
  const activeRuns = activeWindowRuns(windows, options);
  const runs = completeWindowRuns(windows, activeRuns);
  const sections = firstTimestamp === null
    ? []
    : runs.map((run, index) => makeSection(normalizedRecords, windows, run, options, index, index + 1));
  const activeSections = sections.filter((section) => section.type === "active");
  const routeRuns = buildRouteRuns(normalizedRecords, options.maximumGpsGapSeconds);
  const activeDuration = activeSections.reduce((sum, section) => sum + section.activeDuration, 0);
  const activeDistance = activeSections.reduce((sum, section) => sum + section.distance, 0);
  return {
    options,
    records: normalizedRecords,
    windows,
    routeRuns,
    sections,
    activeSections,
    activeDuration,
    activeDistance,
    averageActiveSpeed: activeDuration ? activeDistance / activeDuration : null,
  };
}
