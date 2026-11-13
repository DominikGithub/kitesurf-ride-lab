// Progress across several rides: each ride is boiled down to a handful of measures that can be
// compared from one session to the next. Built on the same section and coaching analysis as the
// single-ride pages; only the upwind measures need a wind direction.
import { analyzeCoaching } from "./coaching.js";
import { getField } from "./fit-decoder.js";
import { median, segmentTrack } from "./track-segmentation.js";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// How a measure is shown: the value is multiplied by scale and followed by the unit.
// changeUnit is used for differences where the plain unit would mislead (percentage points).
export const PROGRESS_KINDS = Object.freeze({
  speed: { scale: 3.6, unit: "km/h", digits: 1 },
  share: { scale: 100, unit: "%", digits: 0, changeUnit: "points" },
  seconds: { scale: 1, unit: "s", digits: 0 },
  minutes: { scale: 1 / 60, unit: "min", digits: 1 },
  metres: { scale: 1, unit: "m", digits: 0 },
  kilometres: { scale: 1 / 1000, unit: "km", digits: 1 },
  perHour: { scale: 1, unit: "per hour", digits: 1 },
  heartRate: { scale: 1, unit: "bpm", digits: 0 },
  degrees: { scale: 1, unit: "deg", digits: 0 },
});

const MINIMUM_TURNS = 3;

// better: which direction is an improvement ("high" or "low"), or null when neither is.
export const PROGRESS_METRICS = Object.freeze([
  {
    key: "ridingSpeed", group: "Speed", label: "Riding speed", kind: "speed", better: "high", defaultOn: true,
    note: "average speed while riding, stops and breaks left out",
    value: ({ segmentation }) => segmentation.averageActiveSpeed,
  },
  {
    key: "bestTenSeconds", group: "Speed", label: "Best 10 seconds", kind: "speed", better: "high",
    note: "fastest 10 seconds of the ride",
    value: ({ coaching }) => coaching.personalBests.tenSeconds?.speed,
  },
  {
    key: "bestFiveHundred", group: "Speed", label: "Best 500 m", kind: "speed", better: "high",
    note: "fastest 500 metres of the ride",
    value: ({ coaching }) => coaching.personalBests.fiveHundredMetres?.speed,
  },
  {
    key: "longestRide", group: "Riding", label: "Longest ride without a stop", kind: "minutes", better: "high", defaultOn: true,
    note: "longest stretch between two stops",
    value: ({ coaching }) => coaching.stopSummary.longestRide?.seconds,
  },
  {
    key: "ridingTime", group: "Riding", label: "Time riding", kind: "minutes", better: null,
    note: "time on the board, stops and breaks left out",
    value: ({ coaching }) => coaching.stopSummary.boardSeconds,
  },
  {
    key: "ridingDistance", group: "Riding", label: "Distance ridden", kind: "kilometres", better: null,
    note: "distance covered while riding",
    value: ({ segmentation }) => segmentation.activeDistance,
  },
  {
    key: "legLength", group: "Riding", label: "Typical leg length", kind: "metres", better: null,
    note: "median distance between two turns",
    value: ({ segmentation }) => median(segmentation.activeSections.flatMap((section) => section.legs).map((leg) => leg.distance).filter(finite)),
  },
  {
    key: "turnSuccess", group: "Turns", label: "Turns made", kind: "share", better: "high", defaultOn: true,
    note: "share of turns ridden through without a stop",
    value: ({ coaching }) => (coaching.turnSummary.attempted >= MINIMUM_TURNS ? coaching.turnSummary.successRate : null),
  },
  {
    key: "speedKept", group: "Turns", label: "Speed kept in turns", kind: "share", better: "high", defaultOn: true,
    note: "median share of entry speed kept through a turn",
    value: ({ coaching }) => (coaching.turnSummary.made >= MINIMUM_TURNS ? coaching.turnSummary.medianSpeedKept : null),
  },
  {
    key: "turnRecovery", group: "Turns", label: "Back to speed after a turn", kind: "seconds", better: "low",
    note: "median time to get back to riding speed",
    value: ({ coaching }) => (coaching.turnSummary.made >= MINIMUM_TURNS ? coaching.turnSummary.medianRecoverySeconds : null),
  },
  {
    key: "sideGap", group: "Turns", label: "Gap between your two sides", kind: "share", better: "low",
    note: "difference in turns made between the two directions",
    value: ({ coaching }) => {
      const [first, second] = coaching.sideBalance;
      if (!first || !second || first.turns.attempted < MINIMUM_TURNS || second.turns.attempted < MINIMUM_TURNS) return null;
      return Math.abs(first.turns.successRate - second.turns.successRate);
    },
  },
  {
    key: "boardShare", group: "Stops", label: "Time on the board", kind: "share", better: "high", defaultOn: true,
    note: "share of water time spent riding, breaks left out",
    value: ({ coaching }) => coaching.stopSummary.boardShareOfWater,
  },
  {
    key: "stopsPerHour", group: "Stops", label: "Stops per hour", kind: "perHour", better: "low",
    note: "stops per hour of riding",
    value: ({ coaching }) => coaching.stopSummary.stopsPerHour,
  },
  {
    key: "restart", group: "Stops", label: "Typical restart", kind: "seconds", better: "low",
    note: "median time from a stop to riding again",
    value: ({ coaching }) => coaching.stopSummary.medianRestartSeconds,
  },
  {
    key: "heartRate", group: "Effort", label: "Heart rate while riding", kind: "heartRate", better: null,
    note: "average heart rate in the riding sections",
    value: ({ segmentation }) => {
      const sections = segmentation.activeSections.filter((section) => finite(section.averageHeartRate) && section.activeDuration > 0);
      const seconds = sections.reduce((total, section) => total + section.activeDuration, 0);
      return seconds ? sections.reduce((total, section) => total + section.averageHeartRate * section.activeDuration, 0) / seconds : null;
    },
  },
  {
    key: "upwindAngle", group: "Upwind", label: "Closest angle to the wind", kind: "degrees", better: "low", needsWind: true,
    note: "smallest angle to the wind held over a leg",
    value: ({ coaching }) => coaching.upwind?.closest?.angleToWind,
  },
  {
    key: "upwindProgress", group: "Upwind", label: "Best upwind progress", kind: "speed", better: "high", needsWind: true,
    note: "best speed made good against the wind over a leg",
    value: ({ coaching }) => coaching.upwind?.fastest?.upwindSpeed,
  },
  {
    key: "upwindGround", group: "Upwind", label: "Ground gained upwind", kind: "metres", better: "high", needsWind: true,
    note: "metres gained against the wind over the whole ride",
    value: ({ coaching }) => coaching.upwind?.netMetres,
  },
]);

export const DEFAULT_PROGRESS_METRICS = Object.freeze(PROGRESS_METRICS.filter((metric) => metric.defaultOn).map((metric) => metric.key));

// One ride as a row of measures. Measures that cannot be worked out are null, never zero.
export function summarizeSession(activity, { recordWind = null } = {}) {
  const segmentation = segmentTrack(activity.records);
  const coaching = analyzeCoaching(segmentation, { recordWind });
  const timestamps = segmentation.records.map((record) => record.timestamp).filter(finite);
  const sessionStart = getField(activity.session, "start_time");
  const start = finite(sessionStart) ? sessionStart : timestamps[0] ?? null;
  const end = timestamps.length ? timestamps.at(-1) : null;
  const context = { segmentation, coaching };
  return {
    start,
    durationSeconds: finite(start) && finite(end) ? Math.max(0, end - start) : null,
    recordCount: activity.records.length,
    available: Boolean(coaching.available),
    hasWind: Boolean(coaching.available && coaching.upwind),
    metrics: Object.fromEntries(PROGRESS_METRICS.map((metric) => {
      const value = coaching.available ? metric.value(context) : null;
      return [metric.key, finite(value) ? value : null];
    })),
  };
}

// Oldest ride first; rides without a start time go last, in the order they were added.
export function sortSessions(sessions) {
  return [...sessions].sort((left, right) => (finite(left.start) ? left.start : Infinity) - (finite(right.start) ? right.start : Infinity));
}

// Two rides are the same recording when they start at the same second and hold the same number of records.
export function sameSession(left, right) {
  return finite(left.start) && left.start === right.start && left.recordCount === right.recordCount;
}

// How a measure moved from the first ride that has it to the last one, and which ride was best.
export function describeChange(values, better) {
  const present = values.map((value, index) => ({ value, index })).filter((entry) => finite(entry.value));
  if (present.length < 2) return null;
  const first = present[0];
  const last = present.at(-1);
  const difference = last.value - first.value;
  // Anything under 2% of the starting value is treated as no change.
  const level = Math.abs(difference) <= Math.max(Math.abs(first.value) * 0.02, 1e-9);
  const best = better
    ? present.reduce((top, entry) => ((better === "high" ? entry.value > top.value : entry.value < top.value) ? entry : top), present[0])
    : null;
  return {
    firstIndex: first.index,
    lastIndex: last.index,
    difference,
    direction: level ? "level" : !better ? (difference > 0 ? "up" : "down") : (difference > 0) === (better === "high") ? "better" : "worse",
    bestIndex: best ? best.index : null,
    count: present.length,
  };
}
