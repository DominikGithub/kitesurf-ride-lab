// Where things happen on the water: the track in a wind-up frame, launch against landing,
// where the stops are, and how fast each part of the track was ridden.
// Built on the section detection and the coaching analysis; only the wind frame needs a wind direction.
import { angleDifference } from "./track-segmentation.js";

export const DEFAULT_TRACK_WATER_OPTIONS = Object.freeze({
  // GPS drops out in the water, so a stop is placed at the nearest fix within this many seconds.
  eventFixSeconds: 15,
  endpointFixSeconds: 30,
  // A recording that starts or ends this close to riding has no real launch or landing in it.
  ridingEdgeSeconds: 10,
  windErrorDegrees: 15,
  windShiftNoteDegrees: 15,
  speedSteps: 5,
  // The speed scale starts at this share of riding speeds, so slow turns do not stretch it.
  speedScaleLowShare: 0.25,
  minimumClusterEvents: 4,
  clusterShare: 0.5,
});

const METRES_PER_DEGREE = 111320;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function radians(degrees) {
  return degrees * Math.PI / 180;
}

function percentile(sorted, share) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * share;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

// One wind direction for the whole session, so the frame does not bend as the wind shifts.
function sessionWind(records, recordWind, from, to) {
  if (!recordWind) return null;
  let east = 0;
  let north = 0;
  const directions = [];
  records.forEach((record) => {
    const direction = recordWind[record.index]?.windDirection;
    if (!finite(record.timestamp) || record.timestamp < from || record.timestamp > to || !finite(direction)) return;
    east += Math.sin(radians(direction));
    north += Math.cos(radians(direction));
    directions.push(direction);
  });
  if (!directions.length || (!east && !north)) return null;
  const direction = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
  return { direction, shiftDegrees: Math.max(...directions.map((sample) => angleDifference(direction, sample))) };
}

// Last fix at or before the moment, or failing that the first one after it, within the limit.
function fixNear(points, timestamp, limitSeconds, preferAfter = false) {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle].timestamp <= timestamp) low = middle + 1;
    else high = middle;
  }
  const before = points[low - 1];
  const after = points[low];
  const beforeOk = before && timestamp - before.timestamp <= limitSeconds;
  const afterOk = after && after.timestamp - timestamp <= limitSeconds;
  if (preferAfter && afterOk) return after;
  if (beforeOk) return before;
  return afterOk ? after : null;
}

export function analyzeTrackWater(segmentation, coaching, { recordWind = null, options: suppliedOptions = {} } = {}) {
  const options = { ...DEFAULT_TRACK_WATER_OPTIONS, ...suppliedOptions };
  const records = segmentation?.records ?? [];
  const sections = segmentation?.activeSections ?? [];
  const positioned = records.filter((record) => record.position && finite(record.timestamp));
  if (positioned.length < 2 || !sections.length) return { available: false };

  const timed = records.filter((record) => finite(record.timestamp));
  const sessionStart = timed[0].timestamp;
  const sessionEnd = timed.at(-1).timestamp;
  const waterStart = sections[0].startTimestamp;
  const waterEnd = sections.at(-1).endTimestamp;
  const maximumGap = segmentation.options.maximumGpsGapSeconds;

  // Launch: where the rider was just before the first riding section. Landing: just after the last one.
  const bare = positioned.map((record) => ({ timestamp: record.timestamp, record }));
  const launchRecord = (fixNear(bare, waterStart, options.endpointFixSeconds) ?? bare[0]).record;
  const landingRecord = (fixNear(bare, waterEnd, options.endpointFixSeconds, true) ?? bare.at(-1)).record;
  const origin = launchRecord.position;
  const eastScale = Math.cos(radians(origin.latitude)) * METRES_PER_DEGREE;

  const wind = sessionWind(records, recordWind, waterStart, waterEnd);
  const windSin = wind ? Math.sin(radians(wind.direction)) : 0;
  const windCos = wind ? Math.cos(radians(wind.direction)) : 0;

  let sectionCursor = 0;
  let run = 0;
  const points = positioned.map((record, position) => {
    if (position && record.timestamp - positioned[position - 1].timestamp > maximumGap) run += 1;
    while (sectionCursor < sections.length - 1 && record.timestamp >= sections[sectionCursor].endTimestamp) sectionCursor += 1;
    const section = sections[sectionCursor];
    const riding = record.timestamp >= section.startTimestamp && record.timestamp < section.endTimestamp;
    const east = (record.position.longitude - origin.longitude) * eastScale;
    const north = (record.position.latitude - origin.latitude) * METRES_PER_DEGREE;
    return {
      index: record.index,
      timestamp: record.timestamp,
      latitude: record.position.latitude,
      longitude: record.position.longitude,
      east,
      north,
      // Metres towards where the wind comes from, and metres to the right of that when facing the wind.
      upwind: wind ? east * windSin + north * windCos : null,
      crosswind: wind ? east * windCos - north * windSin : null,
      speed: record.smoothedSpeed ?? record.speed,
      riding,
      sectionId: riding ? section.id : null,
      run,
      speedStep: null,
    };
  });
  const pointFor = (record) => points.find((point) => point.index === record.index);
  const launch = pointFor(launchRecord);
  const landing = pointFor(landingRecord);
  const ridingPoints = points.filter((point) => point.riding);

  // Speed scale: equal steps from the lower quartile to the 95th percentile of riding speed.
  const speeds = ridingPoints.map((point) => point.speed).filter(finite).sort((left, right) => left - right);
  let speedScale = null;
  if (speeds.length >= 2) {
    const low = percentile(speeds, options.speedScaleLowShare);
    const high = Math.max(percentile(speeds, 0.95), low + 0.1);
    const width = (high - low) / options.speedSteps;
    speedScale = { low, high, bounds: Array.from({ length: options.speedSteps + 1 }, (_, step) => low + step * width) };
    ridingPoints.forEach((point) => {
      if (finite(point.speed)) point.speedStep = Math.min(options.speedSteps - 1, Math.max(0, Math.floor((point.speed - low) / width)));
    });
  }

  // Launch against landing. A wrong wind direction mostly moves the crosswind offset into the upwind figure.
  const distance = Math.hypot(landing.east, landing.north);
  const error = radians(options.windErrorDegrees);
  const launchLanding = {
    distance,
    upwindMetres: wind ? landing.upwind : null,
    crosswindMetres: wind ? landing.crosswind : null,
    uncertaintyMetres: wind ? Math.abs(landing.crosswind) * Math.sin(error) + Math.abs(landing.upwind) * (1 - Math.cos(error)) : null,
    windErrorDegrees: options.windErrorDegrees,
    startedRiding: waterStart - sessionStart < options.ridingEdgeSeconds,
    endedRiding: sessionEnd - waterEnd < options.ridingEdgeSeconds,
  };

  let upwind = null;
  if (wind && ridingPoints.length) {
    const extreme = (better) => ridingPoints.reduce((best, point) => (better(point.upwind, best.upwind) ? point : best), ridingPoints[0]);
    const highest = extreme((value, best) => value > best);
    const lowest = extreme((value, best) => value < best);
    upwind = {
      highest: { metres: highest.upwind, timestamp: highest.timestamp },
      lowest: { metres: lowest.upwind, timestamp: lowest.timestamp },
      sections: sections.map((section) => {
        const members = ridingPoints.filter((point) => point.sectionId === section.id);
        if (members.length < 2) return { id: section.id, label: section.label, startTimestamp: section.startTimestamp, endTimestamp: section.endTimestamp, startMetres: null, endMetres: null, netMetres: null };
        return {
          id: section.id,
          label: section.label,
          startTimestamp: section.startTimestamp,
          endTimestamp: section.endTimestamp,
          startMetres: members[0].upwind,
          endMetres: members.at(-1).upwind,
          netMetres: members.at(-1).upwind - members[0].upwind,
        };
      }),
    };
  }

  // The line the rider reaches back and forth along, to tell one end of the run from the other.
  const sides = coaching?.sides ?? [];
  let axis = null;
  if (sides.length === 2 && finite(sides[0].heading) && ridingPoints.length >= 2) {
    const sin = Math.sin(radians(sides[0].heading));
    const cos = Math.cos(radians(sides[0].heading));
    const along = (point) => point.east * sin + point.north * cos;
    const sorted = ridingPoints.map(along).sort((left, right) => left - right);
    const low = percentile(sorted, 0.05);
    const high = percentile(sorted, 0.95);
    if (high - low > 1) axis = { along, low, high, zones: [`${sides[1].label} end`, "middle", `${sides[0].label} end`] };
  }

  const events = (coaching?.stops ?? []).filter((stop) => stop.kind === "stop").map((stop) => {
    const fix = fixNear(points, stop.startTimestamp, options.eventFixSeconds);
    const share = fix && axis ? (axis.along(fix) - axis.low) / (axis.high - axis.low) : null;
    return {
      timestamp: stop.startTimestamp,
      restartSeconds: stop.restartSeconds,
      context: stop.context,
      placed: Boolean(fix),
      point: fix,
      zone: share === null ? null : axis.zones[share < 1 / 3 ? 0 : share > 2 / 3 ? 2 : 1],
    };
  });
  const placedEvents = events.filter((event) => event.placed);
  const zoneCounts = axis
    ? axis.zones.map((zone) => ({ zone, count: placedEvents.filter((event) => event.zone === zone).length }))
    : [];
  const busiest = zoneCounts.reduce((best, entry) => (!best || entry.count > best.count ? entry : best), null);
  const cluster = busiest && placedEvents.length >= options.minimumClusterEvents && busiest.count / placedEvents.length >= options.clusterShare
    ? { zone: busiest.zone, count: busiest.count, total: placedEvents.length }
    : null;

  return {
    available: true,
    options,
    sessionStart,
    sessionEnd,
    waterStart,
    waterEnd,
    wind,
    points,
    launch,
    landing,
    launchLanding,
    upwind,
    speedScale,
    events,
    placedEventCount: placedEvents.length,
    zoneCounts,
    cluster,
  };
}
