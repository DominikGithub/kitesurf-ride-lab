// Coaching analysis built on the section and leg detection. Everything here is derived from
// timestamps, speed, heart rate and GPS positions; only the upwind part needs a wind direction.
import { angleDifference, bearingBetween, distanceBetween, median } from "./track-segmentation.js";

export const DEFAULT_COACHING_OPTIONS = Object.freeze({
  minimumStopSeconds: 6,
  breakSeconds: 120,
  turnSearchSeconds: 10,
  entryLeadSeconds: 6,
  entryWindowSeconds: 15,
  recoveryShare: 0.85,
  recoveryLimitSeconds: 60,
  // Getting up, riding a few seconds and going down again is one stop with a failed restart, not two stops.
  minimumRideSeconds: 12,
  // The course before and after a stop is read from a straight stretch next to it. The usual window is tried
  // first, then a shorter one (the rider had only just turned), then longer ones (few GPS fixes).
  courseWindowsSeconds: Object.freeze([20, 10, 40, 60]),
  minimumCourseMetres: 25,
  minimumCourseStraightness: 0.7,
  // A turn or stop is placed on the map at the nearest GPS fix within this many seconds.
  fixSeconds: 15,
  minimumLegSeconds: 15,
  minimumUpwindLegMetres: 100,
  minimumRidingSecondsForFatigue: 1200,
  fatigueSpeedDrop: 0.07,
  heartRateRecoverySeconds: 60,
  takeawayCount: 3,
});

const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function compassPoint(bearing) {
  return COMPASS_POINTS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

function circularMean(bearings, weights) {
  let east = 0;
  let north = 0;
  bearings.forEach((bearing, index) => {
    const weight = weights?.[index] ?? 1;
    east += weight * Math.sin(bearing * Math.PI / 180);
    north += weight * Math.cos(bearing * Math.PI / 180);
  });
  return east || north ? (Math.atan2(east, north) * 180 / Math.PI + 360) % 360 : null;
}

// Speeds, distance and timestamps as parallel arrays over the timestamped records.
function buildTrack(records, maximumIntervalSeconds) {
  const timed = records.filter((record) => finite(record.timestamp));
  const times = timed.map((record) => record.timestamp);
  const intervals = times.slice(1).map((time, position) => time - times[position]).filter((interval) => interval > 0);
  const period = median(intervals) ?? 1;

  const rollingMedian = (seconds) => {
    const half = seconds / 2;
    let lower = 0;
    let upper = 0;
    return timed.map((record, position) => {
      while (lower < position && times[lower] < record.timestamp - half) lower += 1;
      while (upper < timed.length && times[upper] <= record.timestamp + half) upper += 1;
      const speeds = [];
      for (let index = lower; index < upper; index += 1) if (finite(timed[index].speed)) speeds.push(timed[index].speed);
      return median(speeds);
    });
  };

  // Distance from speed × time, and a run number that changes at every recording gap.
  const distance = [0];
  const run = [0];
  for (let position = 1; position < timed.length; position += 1) {
    const elapsed = times[position] - times[position - 1];
    const continuous = elapsed > 0 && elapsed <= maximumIntervalSeconds;
    const speed = timed[position - 1].speed;
    distance.push(distance[position - 1] + (continuous && finite(speed) ? speed * elapsed : 0));
    run.push(run[position - 1] + (continuous ? 0 : 1));
  }

  const positionAtOrAfter = (time) => {
    let low = 0;
    let high = times.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (times[middle] < time) low = middle + 1;
      else high = middle;
    }
    return low;
  };

  return {
    timed,
    times,
    period,
    distance,
    run,
    quick: rollingMedian(Math.max(3, period * 3)),
    steady: rollingMedian(Math.max(5, period * 3)),
    positionAtOrAfter,
    // Positions [from, to) of the samples with from <= timestamp < to.
    range: (from, to) => [positionAtOrAfter(from), positionAtOrAfter(to)],
  };
}

// Course over ground between two moments, or null when the rider barely moved or did not hold a line
// (a stretch that runs through a turn says nothing about the course).
function courseBetween(track, from, to, options) {
  const [first, last] = track.range(from, to);
  let start = null;
  let end = null;
  let pathMetres = 0;
  for (let position = first; position < last; position += 1) {
    const record = track.timed[position];
    if (!record.position) continue;
    start ??= record.position;
    if (end) pathMetres += distanceBetween(end, record.position);
    end = record.position;
  }
  if (!start || end === start) return null;
  const straightMetres = distanceBetween(start, end);
  if (straightMetres < options.minimumCourseMetres || straightMetres < pathMetres * options.minimumCourseStraightness) return null;
  return bearingBetween(start, end);
}

// Course just before (direction -1) or just after (direction 1) a moment, never looking past the limit.
function courseBeside(track, moment, direction, limit, options) {
  const tried = new Set();
  for (const seconds of options.courseWindowsSeconds) {
    const edge = direction < 0 ? Math.max(limit, moment - seconds) : Math.min(limit, moment + seconds);
    if (tried.has(edge)) continue;
    tried.add(edge);
    const course = direction < 0 ? courseBetween(track, edge, moment, options) : courseBetween(track, moment, edge, options);
    if (course !== null) return course;
  }
  return null;
}

// The record with a GPS position closest to a moment: the last one before it, or failing that the first after it.
function fixNear(track, timestamp, limitSeconds) {
  const from = track.positionAtOrAfter(timestamp);
  for (let position = Math.min(from, track.timed.length - 1); position >= 0 && timestamp - track.times[position] <= limitSeconds; position -= 1) {
    if (track.times[position] <= timestamp && track.timed[position].position) return track.timed[position];
  }
  for (let position = from; position < track.timed.length && track.times[position] - timestamp <= limitSeconds; position += 1) {
    if (track.timed[position].position) return track.timed[position];
  }
  return null;
}

// A stop is any stretch below riding speed that includes real standing still (or a recording pause).
// A slow turn dips below riding speed too, but never stays under the stop speed for long.
function detectStops(track, windowStart, windowEnd, speeds, options) {
  const { timed, steady, period } = track;
  const [first, end] = track.range(windowStart, windowEnd);
  const stops = [];
  let current = null;
  let stillSince = null;
  const close = (endTimestamp) => {
    if (current.longestStill >= options.minimumStopSeconds || current.paused) stops.push({ ...current, endTimestamp });
    current = null;
    stillSince = null;
  };
  for (let position = first; position < end; position += 1) {
    const record = timed[position];
    const gap = position > first ? record.timestamp - timed[position - 1].timestamp : 0;
    if (gap > speeds.maximumInterval) {
      current ??= { startTimestamp: timed[position - 1].timestamp + period, stillSeconds: 0, longestStill: 0, paused: false };
      current.paused = true;
      current.stillSeconds += gap;
      current.longestStill = Math.max(current.longestStill, gap);
      stillSince = null;
    }
    const speed = steady[position];
    if (speed !== null && speed >= speeds.riding) {
      if (current) close(record.timestamp);
      continue;
    }
    current ??= { startTimestamp: record.timestamp, stillSeconds: 0, longestStill: 0, paused: false };
    if (speed === null || speed < speeds.stopped) {
      stillSince ??= record.timestamp;
      current.stillSeconds += period;
      current.longestStill = Math.max(current.longestStill, record.timestamp - stillSince + period);
    } else {
      stillSince = null;
    }
  }
  if (current) close(windowEnd);

  // Join stops that have only a few seconds of riding between them.
  const joined = [];
  stops.forEach((stop) => {
    const previous = joined.at(-1);
    if (!previous || stop.startTimestamp - previous.endTimestamp >= options.minimumRideSeconds) {
      joined.push({ ...stop, failedRestarts: 0 });
      return;
    }
    previous.endTimestamp = stop.endTimestamp;
    previous.stillSeconds += stop.stillSeconds;
    previous.longestStill = Math.max(previous.longestStill, stop.longestStill);
    previous.paused ||= stop.paused;
    previous.failedRestarts += 1;
  });
  stops.splice(0, stops.length, ...joined);

  return stops.map((stop, index) => {
    const previousEnd = index ? stops[index - 1].endTimestamp : windowStart;
    const nextStart = stops[index + 1]?.startTimestamp ?? windowEnd;
    const courseBefore = courseBeside(track, stop.startTimestamp, -1, previousEnd, options);
    const courseAfter = courseBeside(track, stop.endTimestamp, 1, nextStart, options);
    const restartSeconds = stop.endTimestamp - stop.startTimestamp;
    return {
      startTimestamp: stop.startTimestamp,
      endTimestamp: stop.endTimestamp,
      position: fixNear(track, stop.startTimestamp, options.fixSeconds)?.position ?? null,
      restartSeconds,
      stillSeconds: Math.min(stop.stillSeconds, restartSeconds),
      failedRestarts: stop.failedRestarts,
      paused: stop.paused,
      kind: restartSeconds >= options.breakSeconds ? "break" : "stop",
      // The rider came out of the stop going the other way: it happened in a turn.
      context: courseBefore === null || courseAfter === null ? "unclear" : angleDifference(courseBefore, courseAfter) > 90 ? "turn" : "leg",
      courseBefore,
      courseAfter,
    };
  });
}

// The two directions the rider reaches back and forth in, named by compass point.
function ridingSides(legs, options) {
  let east = 0;
  let north = 0;
  const usable = legs.filter((leg) => finite(leg.heading) && leg.duration >= options.minimumLegSeconds);
  usable.forEach((leg) => {
    // Doubling the angle makes opposite headings add up instead of cancelling out.
    const doubled = 2 * leg.heading * Math.PI / 180;
    const weight = leg.distance || leg.duration;
    east += weight * Math.sin(doubled);
    north += weight * Math.cos(doubled);
  });
  if (!east && !north) return { axis: null, sides: [] };
  const axis = ((Math.atan2(east, north) * 180 / Math.PI) / 2 + 360) % 180;
  const sideOf = (heading) => {
    if (!finite(heading)) return null;
    const alignment = Math.cos((heading - axis) * Math.PI / 180);
    return Math.abs(alignment) < 0.34 ? null : alignment > 0 ? 0 : 1;
  };
  const sides = [0, 1].map((key) => {
    const members = usable.filter((leg) => sideOf(leg.heading) === key);
    const heading = circularMean(members.map((leg) => leg.heading), members.map((leg) => leg.distance || leg.duration)) ?? (axis + key * 180) % 360;
    return { key, heading, label: compassPoint(heading) };
  });
  if (sides[0].label === sides[1].label) sides[1].label = compassPoint(sides[0].heading + 180);
  return { axis, sides, sideOf };
}

function measureTurn(track, previousLeg, nextLeg, speeds, options) {
  const boundary = nextLeg.startTimestamp;
  const [first, last] = track.range(
    Math.max(previousLeg.startTimestamp, boundary - options.turnSearchSeconds),
    Math.min(nextLeg.endTimestamp, boundary + options.turnSearchSeconds),
  );
  let slowest = null;
  for (let position = first; position < last; position += 1) {
    if (track.quick[position] !== null && (slowest === null || track.quick[position] < track.quick[slowest])) slowest = position;
  }
  if (slowest === null) return null;
  const slowestTime = track.times[slowest];
  const entryEnd = slowestTime - options.entryLeadSeconds;
  const [entryFirst, entryLast] = track.range(Math.max(previousLeg.startTimestamp, entryEnd - options.entryWindowSeconds), entryEnd);
  const entrySpeeds = [];
  for (let position = entryFirst; position < entryLast; position += 1) {
    if (finite(track.timed[position].speed)) entrySpeeds.push(track.timed[position].speed);
  }
  const entrySpeed = entrySpeeds.length >= 3 ? median(entrySpeeds) : previousLeg.averageSpeed;
  if (!finite(entrySpeed) || entrySpeed < speeds.riding) return null;
  const slowestSpeed = Math.min(track.quick[slowest], entrySpeed);
  const target = entrySpeed * options.recoveryShare;
  let recoverySeconds = slowestSpeed >= target ? 0 : null;
  const limit = Math.min(nextLeg.endTimestamp, slowestTime + options.recoveryLimitSeconds);
  for (let position = slowest; recoverySeconds === null && position < track.times.length && track.times[position] <= limit; position += 1) {
    if (track.quick[position] !== null && track.quick[position] >= target) recoverySeconds = track.times[position] - slowestTime;
  }
  return {
    outcome: "made",
    timestamp: slowestTime,
    recordIndex: track.timed[slowest].index,
    position: fixNear(track, slowestTime, options.fixSeconds)?.position ?? null,
    entrySpeed,
    slowestSpeed,
    speedLost: entrySpeed - slowestSpeed,
    speedKept: slowestSpeed / entrySpeed,
    recoverySeconds,
    restartSeconds: null,
  };
}

function collectTurns(track, sections, stops, sideOf, speeds, options) {
  const turns = [];
  const nearStop = (time) => stops.some((stop) => time >= stop.startTimestamp - options.turnSearchSeconds && time <= stop.endTimestamp + options.turnSearchSeconds);
  sections.forEach((section) => {
    section.legs.slice(1).forEach((nextLeg, position) => {
      const previousLeg = section.legs[position];
      if (nearStop(nextLeg.startTimestamp)) return;
      const turn = measureTurn(track, previousLeg, nextLeg, speeds, options);
      if (turn) turns.push({ ...turn, fromSide: sideOf(previousLeg.heading), toSide: sideOf(nextLeg.heading) });
    });
  });
  stops.filter((stop) => stop.kind === "stop" && stop.context === "turn").forEach((stop) => {
    turns.push({
      outcome: "stopped",
      timestamp: stop.startTimestamp,
      recordIndex: track.timed[Math.min(track.positionAtOrAfter(stop.startTimestamp), track.timed.length - 1)].index,
      position: stop.position,
      entrySpeed: null,
      slowestSpeed: null,
      speedLost: null,
      speedKept: null,
      recoverySeconds: null,
      restartSeconds: stop.restartSeconds,
      fromSide: sideOf(stop.courseBefore),
      toSide: sideOf(stop.courseAfter),
    });
  });
  return turns.sort((left, right) => left.timestamp - right.timestamp);
}

function summarizeTurns(turns) {
  const made = turns.filter((turn) => turn.outcome === "made");
  const recoveries = made.map((turn) => turn.recoverySeconds).filter(finite);
  return {
    attempted: turns.length,
    made: made.length,
    stopped: turns.length - made.length,
    successRate: turns.length ? made.length / turns.length : null,
    medianSpeedKept: median(made.map((turn) => turn.speedKept)),
    medianSpeedLost: median(made.map((turn) => turn.speedLost)),
    medianRecoverySeconds: median(recoveries),
    notRecovered: made.length - recoveries.length,
  };
}

function sideBalance(sides, legs, turns, stops, sideOf, options) {
  return sides.map((side) => {
    const sideLegs = legs.filter((leg) => leg.side === side.key && leg.duration >= options.minimumLegSeconds);
    const seconds = sum(sideLegs.map((leg) => leg.duration));
    const distance = sum(sideLegs.map((leg) => leg.distance));
    return {
      ...side,
      legCount: sideLegs.length,
      seconds,
      distance,
      averageSpeed: seconds ? distance / seconds : null,
      medianLegSeconds: median(sideLegs.map((leg) => leg.duration)),
      medianLegDistance: median(sideLegs.map((leg) => leg.distance)),
      turns: summarizeTurns(turns.filter((turn) => turn.toSide === side.key)),
      midLegStops: stops.filter((stop) => stop.kind === "stop" && stop.context === "leg" && sideOf(stop.courseBefore) === side.key).length,
    };
  });
}

function summarizeStops(track, stops, windowStart, windowEnd) {
  const shortStops = stops.filter((stop) => stop.kind === "stop");
  const breaks = stops.filter((stop) => stop.kind === "break");
  const waterSeconds = windowEnd - windowStart;
  const stopSeconds = sum(shortStops.map((stop) => stop.restartSeconds));
  const breakSeconds = sum(breaks.map((stop) => stop.restartSeconds));
  const boardSeconds = Math.max(0, waterSeconds - stopSeconds - breakSeconds);
  const sessionSeconds = track.times.at(-1) - track.times[0];

  // Longest stretch of riding between two stops.
  const edges = [windowStart, ...stops.flatMap((stop) => [stop.startTimestamp, stop.endTimestamp]), windowEnd];
  let longestRide = null;
  for (let index = 0; index < edges.length; index += 2) {
    const seconds = edges[index + 1] - edges[index];
    if (seconds <= 0 || (longestRide && seconds <= longestRide.seconds)) continue;
    const [first, last] = track.range(edges[index], edges[index + 1]);
    const distance = last > first ? track.distance[last - 1] - track.distance[first] : 0;
    longestRide = { seconds, distance, averageSpeed: distance / seconds, startTimestamp: edges[index] };
  }

  return {
    stopCount: shortStops.length,
    stopsInTurns: shortStops.filter((stop) => stop.context === "turn").length,
    stopsMidLeg: shortStops.filter((stop) => stop.context === "leg").length,
    stopsUnclear: shortStops.filter((stop) => stop.context === "unclear").length,
    medianRestartSeconds: median(shortStops.map((stop) => stop.restartSeconds)),
    longestRestartSeconds: shortStops.length ? Math.max(...shortStops.map((stop) => stop.restartSeconds)) : null,
    failedRestarts: sum(shortStops.map((stop) => stop.failedRestarts)),
    stopSeconds,
    breakCount: breaks.length,
    breakSeconds,
    waterSeconds,
    boardSeconds,
    sessionSeconds,
    boardShareOfSession: sessionSeconds > 0 ? boardSeconds / sessionSeconds : null,
    boardShareOfWater: boardSeconds + stopSeconds > 0 ? boardSeconds / (boardSeconds + stopSeconds) : null,
    stopsPerHour: boardSeconds > 0 ? shortStops.length / (boardSeconds / 3600) : null,
    longestRide,
  };
}

function legEndpoints(track, leg) {
  const [first, last] = track.range(leg.startTimestamp, leg.endTimestamp);
  let start = null;
  let end = null;
  for (let position = first; position < last; position += 1) {
    const record = track.timed[position];
    if (!record.position) continue;
    start ??= record;
    end = record;
  }
  return start && end && start !== end ? { start, end } : null;
}

// Angle to the wind and ground made good upwind for every leg. Only as good as the wind direction given.
function upwindAnalysis(track, legs, sides, sections, recordWind, options) {
  if (!recordWind) return null;
  const windAt = (index) => (finite(recordWind[index]?.windDirection) ? recordWind[index].windDirection : null);
  const measured = legs.map((leg) => {
    const endpoints = finite(leg.heading) ? legEndpoints(track, leg) : null;
    if (!endpoints) return null;
    const winds = [windAt(endpoints.start.index), windAt(endpoints.end.index)].filter(finite);
    if (!winds.length) return null;
    const windDirection = circularMean(winds);
    const straightMetres = distanceBetween(endpoints.start.position, endpoints.end.position);
    const angleToWind = angleDifference(windDirection, leg.heading);
    const upwindMetres = straightMetres * Math.cos(angleToWind * Math.PI / 180);
    return { leg, angleToWind, straightMetres, upwindMetres, upwindSpeed: leg.duration > 0 ? upwindMetres / leg.duration : null };
  }).filter(Boolean);
  if (!measured.length) return null;

  const pointing = measured.filter((entry) => entry.angleToWind < 90 && entry.straightMetres >= options.minimumUpwindLegMetres);
  const closest = pointing.reduce((best, entry) => (!best || entry.angleToWind < best.angleToWind ? entry : best), null);
  const fastest = pointing.reduce((best, entry) => (!best || entry.upwindSpeed > best.upwindSpeed ? entry : best), null);
  const describe = (entry) => entry && {
    angleToWind: entry.angleToWind,
    upwindSpeed: entry.upwindSpeed,
    upwindMetres: entry.upwindMetres,
    boardSpeed: entry.leg.averageSpeed,
    seconds: entry.leg.duration,
    timestamp: entry.leg.startTimestamp,
  };
  return {
    legCount: measured.length,
    upwindLegCount: pointing.length,
    closest: describe(closest),
    fastest: describe(fastest),
    gainedMetres: sum(measured.filter((entry) => entry.upwindMetres > 0).map((entry) => entry.upwindMetres)),
    lostMetres: -sum(measured.filter((entry) => entry.upwindMetres < 0).map((entry) => entry.upwindMetres)),
    netMetres: sum(measured.map((entry) => entry.upwindMetres)),
    sides: sides.map((side) => {
      const members = measured.filter((entry) => entry.leg.side === side.key && entry.leg.duration >= options.minimumLegSeconds);
      return { key: side.key, label: side.label, legCount: members.length, medianAngleToWind: median(members.map((entry) => entry.angleToWind)) };
    }),
    sections: sections.map((section) => {
      const members = measured.filter((entry) => entry.leg.sectionId === section.id);
      return {
        id: section.id,
        label: section.label,
        startTimestamp: section.startTimestamp,
        endTimestamp: section.endTimestamp,
        legCount: members.length,
        netMetres: sum(members.map((entry) => entry.upwindMetres)),
      };
    }),
  };
}

// The session cut into four parts with equal riding time, to see what changed as it went on.
function fatigueAnalysis(track, sections, turns, stops, speeds, options) {
  const riding = [];
  sections.forEach((section) => {
    const [first, last] = track.range(section.startTimestamp, section.endTimestamp);
    for (let position = first; position < last; position += 1) {
      if (track.steady[position] !== null && track.steady[position] >= speeds.riding) riding.push(position);
    }
  });
  if (riding.length * track.period < options.minimumRidingSecondsForFatigue) return null;

  const quarters = [0, 1, 2, 3].map((quarter) => {
    const members = riding.slice(Math.floor(quarter * riding.length / 4), Math.floor((quarter + 1) * riding.length / 4));
    const startTimestamp = track.times[members[0]];
    const endTimestamp = quarter === 3 ? track.times[members.at(-1)] + track.period : track.times[riding[Math.floor((quarter + 1) * riding.length / 4)]];
    const inQuarter = (time) => time >= startTimestamp && time < endTimestamp;
    const quarterTurns = turns.filter((turn) => inQuarter(turn.timestamp));
    const stopCount = stops.filter((stop) => stop.kind === "stop" && inQuarter(stop.startTimestamp)).length;
    const ridingSeconds = members.length * track.period;
    return {
      number: quarter + 1,
      startTimestamp,
      endTimestamp,
      ridingSeconds,
      medianSpeed: median(members.map((position) => track.timed[position].speed).filter(finite)),
      averageHeartRate: average(members.map((position) => track.timed[position].heartRate).filter((value) => finite(value) && value > 0)),
      turns: summarizeTurns(quarterTurns),
      stopCount,
      stopsPerHour: ridingSeconds > 0 ? stopCount / (ridingSeconds / 3600) : null,
    };
  });

  // Speed "dropped" at the first quarter that is clearly below the best earlier one and never recovers.
  let drop = null;
  for (let quarter = 1; quarter < 4 && !drop; quarter += 1) {
    const best = Math.max(...quarters.slice(0, quarter).map((entry) => entry.medianSpeed ?? 0));
    const later = quarters.slice(quarter);
    if (best > 0 && later.every((entry) => finite(entry.medianSpeed) && entry.medianSpeed < best * (1 - options.fatigueSpeedDrop))) {
      drop = { quarter: quarter + 1, timestamp: quarters[quarter].startTimestamp, speedDrop: 1 - average(later.map((entry) => entry.medianSpeed)) / best };
    }
  }

  const recoveries = stops.filter((stop) => stop.restartSeconds >= options.heartRateRecoverySeconds + 5).map((stop) => {
    const heartRateNear = (time) => {
      const [first, last] = track.range(time - 5, time + 5);
      return average(track.timed.slice(first, last).map((record) => record.heartRate).filter((value) => finite(value) && value > 0));
    };
    const before = heartRateNear(stop.startTimestamp);
    const after = heartRateNear(stop.startTimestamp + options.heartRateRecoverySeconds);
    return before !== null && after !== null ? before - after : null;
  }).filter(finite);

  const first = quarters[0];
  const last = quarters[3];
  return {
    quarters,
    drop,
    speedChange: finite(first.medianSpeed) && finite(last.medianSpeed) && first.medianSpeed > 0 ? last.medianSpeed / first.medianSpeed - 1 : null,
    heartRateDrift: first.averageHeartRate !== null && last.averageHeartRate !== null ? last.averageHeartRate - first.averageHeartRate : null,
    heartRateRecovery: recoveries.length ? { beatsPerMinute: median(recoveries), stopCount: recoveries.length, seconds: options.heartRateRecoverySeconds } : null,
  };
}

function personalBests(track, legs, stopSummary) {
  const { times, distance, run } = track;
  const fastest = (reached) => {
    let best = null;
    let ahead = 0;
    for (let position = 0; position < times.length; position += 1) {
      ahead = Math.max(ahead, position + 1);
      while (ahead < times.length && !reached(position, ahead)) ahead += 1;
      if (ahead >= times.length) break;
      if (run[ahead] !== run[position]) continue;
      const seconds = times[ahead] - times[position];
      const metres = distance[ahead] - distance[position];
      if (seconds > 0 && (!best || metres / seconds > best.speed)) best = { speed: metres / seconds, seconds, distance: metres, timestamp: times[position] };
    }
    return best;
  };
  const longestLeg = legs.reduce((best, leg) => (!best || leg.distance > best.distance ? leg : best), null);
  return {
    tenSeconds: fastest((from, to) => times[to] - times[from] >= 10),
    hundredMetres: fastest((from, to) => distance[to] - distance[from] >= 100),
    fiveHundredMetres: fastest((from, to) => distance[to] - distance[from] >= 500),
    longestLeg: longestLeg && { distance: longestLeg.distance, seconds: longestLeg.duration, averageSpeed: longestLeg.averageSpeed, timestamp: longestLeg.startTimestamp },
    longestRide: stopSummary.longestRide,
  };
}

function kilometresPerHour(speed, digits = 1) {
  return (speed * 3.6).toFixed(digits);
}

function percent(share) {
  return Math.round(share * 100);
}

function spanText(seconds) {
  const rounded = Math.round(seconds);
  if (rounded < 90) return `${rounded} seconds`;
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

// Rule-based observations. Each belongs to a group so that no two of them say the same thing, the
// clearest ones surface first, and one slot is kept for something that went well.
function buildTakeaways(analysis, options) {
  const { sideBalance: balance, stopSummary, fatigue, sessionStart, turnSummary, turns } = analysis;
  const candidates = [];
  const add = (group, score, tone, title, text) => candidates.push({ group, score, tone, title, text });

  if (balance.length === 2) {
    const [first, second] = balance;
    const failure = (side) => side.turns.stopped / side.turns.attempted;
    const enoughAttempts = first.turns.attempted >= 4 && second.turns.attempted >= 4;
    const enoughMade = first.turns.made >= 3 && second.turns.made >= 3;

    // Which side loses more turns to a stop, and which keeps less speed in the turns that are made.
    let stops = null;
    if (enoughAttempts) {
      const difference = Math.abs(failure(first) - failure(second));
      const [weak, strong] = failure(first) > failure(second) ? [first, second] : [second, first];
      if (difference >= 0.2 && weak.turns.stopped >= 3) stops = { weak, strong, difference };
    }
    let speed = null;
    if (enoughMade) {
      const difference = Math.abs(first.turns.medianSpeedKept - second.turns.medianSpeedKept);
      const [weak, strong] = first.turns.medianSpeedKept < second.turns.medianSpeedKept ? [first, second] : [second, first];
      if (difference >= 0.08) speed = { weak, strong, difference };
    }
    const stopsText = stops && `${stops.weak.turns.stopped} of ${stops.weak.turns.attempted} turns onto ${stops.weak.label} ended in a stop, against ${stops.strong.turns.stopped} of ${stops.strong.turns.attempted} onto ${stops.strong.label}`;
    if (stops && speed && stops.weak === speed.weak) {
      add("side-turns", 3 + stops.difference * 8 + speed.difference * 10, "focus", `Turns onto ${stops.weak.label} are your weak side`,
        `${stopsText}. The ones you made kept ${percent(speed.weak.turns.medianSpeedKept)}% of your speed, against ${percent(speed.strong.turns.medianSpeedKept)}% onto ${speed.strong.label}. That turn is the one to practise.`);
    } else {
      if (stops) add("side-turn-stops", 2.5 + stops.difference * 8, "focus", `More turns onto ${stops.weak.label} end in a stop`, `${stopsText}.`);
      if (speed) {
        add("side-turn-speed", 2 + speed.difference * 10, "focus", `Turns onto ${speed.weak.label} cost more speed`,
          `You keep ${percent(speed.weak.turns.medianSpeedKept)}% of your speed turning onto your ${speed.weak.label} legs and ${percent(speed.strong.turns.medianSpeedKept)}% turning onto ${speed.strong.label}. The turn onto ${speed.weak.label} is the one to practise.`);
      }
    }
    const even = enoughAttempts && enoughMade
      && Math.abs(failure(first) - failure(second)) < 0.1
      && Math.abs(first.turns.medianSpeedKept - second.turns.medianSpeedKept) < 0.05;
    if (even) {
      add("side-turns", 0.75, "strength", "Your turns are even on both sides",
        `You made ${first.turns.made} of ${first.turns.attempted} turns onto ${first.label} and ${second.turns.made} of ${second.turns.attempted} onto ${second.label}, keeping ${percent(first.turns.medianSpeedKept)}% and ${percent(second.turns.medianSpeedKept)}% of your speed.`);
    }

    if (first.seconds >= 120 && second.seconds >= 120) {
      const [fast, slow] = first.averageSpeed > second.averageSpeed ? [first, second] : [second, first];
      const difference = fast.averageSpeed / slow.averageSpeed - 1;
      if (difference >= 0.05) {
        add("side-speed", 1 + difference * 10, "note", `Faster heading ${fast.label}`,
          `You average ${kilometresPerHour(fast.averageSpeed)} km/h heading ${fast.label} and ${kilometresPerHour(slow.averageSpeed)} km/h heading ${slow.label}. That can be your stance, or one direction pointing higher into the wind.`);
      }
    }
  }

  if (stopSummary.stopCount >= 3) {
    const { stopCount, stopsInTurns, stopsMidLeg } = stopSummary;
    if (stopsInTurns / stopCount >= 0.6) {
      add("stop-place", 1.5 + stopCount / 6, "focus", "Most stops happen in turns", `${stopsInTurns} of ${stopCount} stops came in a turn and ${stopsMidLeg} came mid-leg, so transitions are where you lose the most time.`);
    } else if (stopsMidLeg / stopCount >= 0.6) {
      add("stop-place", 1.5 + stopCount / 6, "focus", "Most stops happen mid-leg", `${stopsMidLeg} of ${stopCount} stops came while riding a leg and ${stopsInTurns} came in a turn.`);
    }
    if (stopSummary.medianRestartSeconds >= 20) {
      const attempts = stopSummary.failedRestarts ? ` ${stopSummary.failedRestarts} ${stopSummary.failedRestarts === 1 ? "restart" : "restarts"} failed within a few seconds.` : "";
      add("restart", 1 + stopSummary.medianRestartSeconds / 40, "focus", `Restarts take ${spanText(stopSummary.medianRestartSeconds)}`,
        `After a stop you were back at riding speed in a median of ${spanText(stopSummary.medianRestartSeconds)}; the slowest restart took ${spanText(stopSummary.longestRestartSeconds)}.${attempts}`);
    }
  }

  if (fatigue?.drop) {
    const minutes = Math.round((fatigue.drop.timestamp - sessionStart) / 60);
    add("pace", 2.2 + fatigue.drop.speedDrop * 10, "focus", `Speed dropped after ${minutes} minutes`,
      `From then on your riding speed was ${percent(fatigue.drop.speedDrop)}% below your best earlier quarter. That can be fatigue or dropping wind.`);
  } else if (fatigue && finite(fatigue.speedChange) && fatigue.speedChange >= 0.05) {
    add("pace", 0.9, "strength", "You got faster as the session went on", `Riding speed in the final quarter was ${percent(fatigue.speedChange)}% above the first.`);
  } else if (fatigue && finite(fatigue.speedChange) && Math.abs(fatigue.speedChange) < 0.05) {
    add("pace", 0.9, "strength", "You held your pace", `Riding speed in the final quarter was within ${Math.max(1, percent(Math.abs(fatigue.speedChange)))}% of the first.`);
  }

  if (stopSummary.boardShareOfWater !== null && stopSummary.boardSeconds >= 600) {
    const share = stopSummary.boardShareOfWater;
    add("board-time", share < 0.85 ? 1.6 : 0.7, share < 0.85 ? "note" : "strength", `On the board ${percent(share)}% of your water time`,
      `Between breaks you rode for ${spanText(stopSummary.boardSeconds)} and spent ${spanText(stopSummary.stopSeconds)} restarting after ${stopSummary.stopCount} ${stopSummary.stopCount === 1 ? "stop" : "stops"}.`);
  }

  if (turnSummary.attempted >= 8 && turnSummary.successRate >= 0.85) {
    add("turn-success", 0.8 + turnSummary.successRate / 10, "strength", `You rode through ${turnSummary.made} of ${turnSummary.attempted} turns`,
      `Only ${turnSummary.stopped} ${turnSummary.stopped === 1 ? "turn" : "turns"} ended in a stop.`);
  }

  // The rider's own best turns are the reference for what a good turn looks like.
  const kept = turns.filter((turn) => turn.outcome === "made").map((turn) => turn.speedKept).sort((left, right) => left - right);
  if (kept.length >= 8) {
    const best = kept[Math.floor(kept.length * 0.75)];
    if (best - turnSummary.medianSpeedKept >= 0.05) {
      add("best-turns", 0.65, "strength", `Your best turns keep ${percent(best)}% of your speed`,
        `One turn in four kept ${percent(best)}% or more, against ${percent(turnSummary.medianSpeedKept)}% for a typical one. Those show what you can already do; find them in the chart and repeat them.`);
    }
  }

  if (stopSummary.longestRide && stopSummary.longestRide.seconds >= 300) {
    add("longest-ride", 0.6, "strength", `Longest ride without a stop: ${spanText(stopSummary.longestRide.seconds)}`,
      `${(stopSummary.longestRide.distance / 1000).toFixed(2)} km at ${kilometresPerHour(stopSummary.longestRide.averageSpeed)} km/h average.`);
  }

  // Best of each group by score; the last slot goes to something that went well if nothing above it did.
  const ranked = candidates.sort((left, right) => right.score - left.score);
  const picked = [];
  const free = (candidate) => !picked.some((entry) => entry.group === candidate.group);
  for (const candidate of ranked) {
    if (picked.length >= options.takeawayCount - 1) break;
    if (free(candidate)) picked.push(candidate);
  }
  const rest = ranked.filter(free);
  const last = (!picked.some((entry) => entry.tone === "strength") && rest.find((candidate) => candidate.tone === "strength")) || rest[0];
  if (last && picked.length < options.takeawayCount) picked.push(last);
  return picked
    .sort((left, right) => (left.tone === "strength") - (right.tone === "strength") || right.score - left.score)
    .map(({ group, tone, title, text }) => ({ group, tone, title, text }));
}

export function analyzeCoaching(segmentation, { recordWind = null, options: suppliedOptions = {} } = {}) {
  const options = { ...DEFAULT_COACHING_OPTIONS, ...suppliedOptions };
  const sections = segmentation?.activeSections ?? [];
  const track = buildTrack(segmentation?.records ?? [], segmentation?.options.maximumIntervalSeconds ?? 5);
  if (!sections.length || !track.timed.length) return { available: false };

  const speeds = {
    riding: segmentation.options.activeSpeedMps,
    stopped: segmentation.options.lowMovementSpeedMps,
    maximumInterval: segmentation.options.maximumIntervalSeconds,
  };
  const waterStart = sections[0].startTimestamp;
  const waterEnd = sections.at(-1).endTimestamp;
  const stops = detectStops(track, waterStart, waterEnd, speeds, options);
  const allLegs = sections.flatMap((section) => section.legs.map((leg) => ({ ...leg, sectionId: section.id })));
  const { sides, sideOf = () => null } = ridingSides(allLegs, options);
  const legs = allLegs.map((leg) => ({ ...leg, side: sideOf(leg.heading) }));
  const turns = collectTurns(track, sections, stops, sideOf, speeds, options);
  const stopSummary = summarizeStops(track, stops, waterStart, waterEnd);

  const analysis = {
    available: true,
    options,
    sessionStart: track.times[0],
    sessionEnd: track.times.at(-1),
    waterStart,
    waterEnd,
    sides,
    legs,
    turns,
    turnSummary: summarizeTurns(turns),
    sideBalance: sideBalance(sides, legs, turns, stops, sideOf, options),
    stops,
    stopSummary,
    upwind: upwindAnalysis(track, legs, sides, sections, recordWind, options),
    fatigue: fatigueAnalysis(track, sections, turns, stops, speeds, options),
    personalBests: personalBests(track, legs, stopSummary),
  };
  return { ...analysis, takeaways: buildTakeaways(analysis, options) };
}
