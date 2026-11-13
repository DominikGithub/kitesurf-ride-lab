// All tracks in this file are synthetic. Do not add recorded sessions as fixtures.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDemoActivity, createDemoSeries } from "../public/demo-session.js";
import { DEFAULT_PROGRESS_METRICS, PROGRESS_KINDS, PROGRESS_METRICS, describeChange, sameSession, sortSessions, summarizeSession } from "../public/progress.js";
import { resolveWindAnnotation } from "../public/wind-annotation.js";
import { START, near, syntheticTrack } from "../test-helpers/synthetic-track.mjs";

const EAST = 80;
const WEST = 260;
const beach = { seconds: 60, speed: 0.4 };
const leg = (heading, speed = 7, seconds = 90) => ({ seconds, speed, heading });
const slowTurn = { seconds: 3, speed: 2.8, heading: 170 };
const activityFrom = (phases) => ({ records: syntheticTrack(phases), session: null });

test("every measure has a known kind, a group and a note", () => {
  const keys = PROGRESS_METRICS.map((metric) => metric.key);
  assert.equal(new Set(keys).size, keys.length);
  PROGRESS_METRICS.forEach((metric) => {
    assert.ok(PROGRESS_KINDS[metric.kind], `${metric.key} has kind ${metric.kind}`);
    assert.ok(metric.group && metric.label && metric.note, metric.key);
    assert.ok([null, "high", "low"].includes(metric.better), metric.key);
  });
  assert.ok(DEFAULT_PROGRESS_METRICS.length >= 4 && DEFAULT_PROGRESS_METRICS.length <= 6);
  assert.ok(PROGRESS_METRICS.filter((metric) => metric.needsWind).every((metric) => !metric.defaultOn), "wind measures are opt-in");
});

test("boils a ride down to its measures", () => {
  const lap = [leg(EAST), slowTurn, leg(WEST), slowTurn];
  const summary = summarizeSession(activityFrom([beach, ...lap, ...lap, leg(EAST), { seconds: 18, speed: 0.3, heading: 170 }, leg(WEST), beach]));
  assert.equal(summary.available, true);
  assert.equal(summary.start, START);
  near(summary.metrics.ridingSpeed, 7, 0.3, "riding speed");
  near(summary.metrics.turnSuccess, 4 / 5, 0.001, "turns made");
  near(summary.metrics.speedKept, 0.4, 0.03, "speed kept");
  near(summary.metrics.legLength, 630, 40, "typical leg length");
  near(summary.metrics.longestRide, 5 * 90 + 12, 20, "longest ride without a stop");
  assert.ok(summary.metrics.boardShare > 0.9 && summary.metrics.boardShare < 1);
  assert.equal(summary.metrics.heartRate, null, "no heart rate recorded");
  assert.equal(summary.metrics.upwindAngle, null, "no wind given");
  assert.equal(summary.hasWind, false);
});

test("leaves measures empty when there is too little to go on", () => {
  const short = summarizeSession(activityFrom([beach, leg(EAST), slowTurn, leg(WEST), beach]));
  assert.equal(short.metrics.turnSuccess, null, "one turn is not a rate");
  assert.equal(short.metrics.speedKept, null);
  assert.equal(short.metrics.sideGap, null);
  assert.ok(short.metrics.ridingSpeed > 0);
  const still = summarizeSession(activityFrom([{ seconds: 300, speed: 0.5 }]));
  assert.equal(still.available, false);
  assert.ok(Object.values(still.metrics).every((value) => value === null));
});

test("fills the upwind measures when a wind direction is given", () => {
  const activity = activityFrom([beach, leg(EAST), slowTurn, leg(WEST), slowTurn, leg(EAST), beach]);
  const summary = summarizeSession(activity, { recordWind: activity.records.map(() => ({ windDirection: 20 })) });
  assert.equal(summary.hasWind, true);
  near(summary.metrics.upwindAngle, 60, 3, "closest angle to the wind");
  near(summary.metrics.upwindGround, 630 * 0.5, 40, "ground gained");
});

test("orders rides by date and spots the same recording twice", () => {
  const rides = [{ start: 300, recordCount: 10 }, { start: null, recordCount: 5 }, { start: 100, recordCount: 10 }];
  assert.deepEqual(sortSessions(rides).map((ride) => ride.start), [100, 300, null]);
  assert.equal(sameSession({ start: 100, recordCount: 10 }, { start: 100, recordCount: 10 }), true);
  assert.equal(sameSession({ start: 100, recordCount: 10 }, { start: 100, recordCount: 11 }), false);
  assert.equal(sameSession({ start: null, recordCount: 10 }, { start: null, recordCount: 10 }), false);
});

test("says whether a measure got better, worse or stayed level", () => {
  assert.equal(describeChange([5, 6, 7], "high").direction, "better");
  assert.equal(describeChange([5, 6, 7], "low").direction, "worse");
  assert.equal(describeChange([20, 14], "low").direction, "better");
  assert.equal(describeChange([100, 101], "high").direction, "level");
  assert.equal(describeChange([5, 7], null).direction, "up");
  // Rides without the measure are skipped, and the best ride is found among the rest.
  const change = describeChange([null, 5, 9, null, 7], "high");
  assert.deepEqual([change.firstIndex, change.lastIndex, change.bestIndex, change.count], [1, 4, 2, 3]);
  near(change.difference, 2, 1e-9, "difference between first and last");
  assert.equal(describeChange([null, 5, null], "high"), null);
  assert.equal(describeChange([5, 7], null).bestIndex, null);
});

test("the demo season is the same on every load and shows a rider improving", async () => {
  const series = createDemoSeries();
  assert.equal(series.length, 6);
  const rides = series.map(({ activity }) => summarizeSession(activity));
  assert.deepEqual(rides.map((ride) => ride.start), sortSessions(rides).map((ride) => ride.start), "already in date order");
  assert.equal(new Set(rides.map((ride) => ride.start)).size, 6);
  assert.deepEqual(createDemoSeries().map(({ activity }) => summarizeSession(activity).metrics), rides.map((ride) => ride.metrics));
  const [first, last] = [rides[0].metrics, rides.at(-1).metrics];
  assert.ok(last.ridingSpeed > first.ridingSpeed, "faster");
  assert.ok(last.turnSuccess > first.turnSuccess, "more turns made");
  assert.ok(last.boardShare > first.boardShare, "more time on the board");
  assert.equal(describeChange(rides.map((ride) => ride.metrics.turnSuccess), "high").direction, "better");
  // The upwind measures work on the demo without the network: its wind is stored in the activity.
  const { recordWind } = await resolveWindAnnotation(series[0].activity, () => { throw new Error("the demo must not need the network"); });
  assert.ok(Number.isFinite(summarizeSession(series[0].activity, { recordWind }).metrics.upwindAngle));
  // The single documentation session is untouched by the season.
  assert.equal(summarizeSession(createDemoActivity()).start, createDemoActivity().records[0].fields.timestamp);
});
