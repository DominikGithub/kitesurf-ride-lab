// All tracks in this file are synthetic. Do not add recorded sessions as fixtures.
import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeCoaching } from "../public/coaching.js";
import { createDemoActivity } from "../public/demo-session.js";
import { segmentTrack } from "../public/track-segmentation.js";
import { analyzeTrackWater } from "../public/track-water.js";
import { resolveWindAnnotation } from "../public/wind-annotation.js";
import { near, syntheticTrack } from "../test-helpers/synthetic-track.mjs";

const EAST = 80;
const WEST = 260;
const beach = { seconds: 60, speed: 0.4 };
const leg = (heading, speed = 7, seconds = 100) => ({ seconds, speed, heading });
const slowTurn = { seconds: 3, speed: 2.8, heading: 170 };
const windFrom = (direction) => (records) => records.map(() => ({ windDirection: direction }));

function analyze(phases, wind = null) {
  const records = syntheticTrack(phases);
  const segmentation = segmentTrack(records);
  const recordWind = wind ? wind(records) : null;
  return analyzeTrackWater(segmentation, analyzeCoaching(segmentation, { recordWind }), { recordWind });
}

test("measures ground gained in a frame with the wind at the top", () => {
  // Wind from the north; both legs point 60 degrees off it, so each 700 m leg gains 350 m.
  const result = analyze([beach, leg(60), leg(300), beach], windFrom(0));
  near(result.wind.direction, 0, 0.01, "wind direction");
  near(result.upwind.highest.metres, 700, 40, "highest point upwind");
  near(result.launchLanding.upwindMetres, 700, 40, "landing upwind of the launch");
  near(result.launchLanding.crosswindMetres, 0, 40, "landing level with the launch across the wind");
  assert.equal(result.upwind.sections.length, 1);
  near(result.upwind.sections[0].netMetres, 700, 40, "ground gained in the section");
  assert.ok(result.points.every((point) => Math.abs(point.upwind - point.north) < 0.001), "wind from the north makes upwind equal north");
});

test("reports how far downwind of the launch the rider came in", () => {
  const result = analyze([beach, leg(120), leg(240), beach], windFrom(0));
  near(result.launchLanding.upwindMetres, -700, 40, "landing downwind of the launch");
  near(result.launchLanding.distance, 700, 40, "straight-line distance");
  // 15 degrees of wind error on a 700 m upwind offset with no crosswind offset.
  near(result.launchLanding.uncertaintyMetres, 700 * (1 - Math.cos(15 * Math.PI / 180)), 12, "uncertainty");
  assert.equal(result.launchLanding.startedRiding, false);
  assert.equal(result.launchLanding.endedRiding, false);
});

test("still gives the distance between launch and landing without wind", () => {
  const result = analyze([beach, leg(120), leg(240), beach]);
  assert.equal(result.wind, null);
  assert.equal(result.upwind, null);
  assert.equal(result.launchLanding.upwindMetres, null);
  near(result.launchLanding.distance, 700, 40, "straight-line distance");
  assert.ok(result.points.every((point) => point.upwind === null));
});

test("flags a recording that starts or ends while riding", () => {
  const result = analyze([leg(EAST), leg(WEST)], windFrom(0));
  assert.equal(result.launchLanding.startedRiding, true);
  assert.equal(result.launchLanding.endedRiding, true);
});

test("places a stop at the last fix before GPS dropped out", () => {
  const result = analyze([beach, leg(EAST, 7, 90), { seconds: 18, speed: 0.3, heading: 170, gps: false }, leg(WEST, 7, 90), beach]);
  assert.equal(result.events.length, 1);
  const [event] = result.events;
  assert.equal(event.placed, true);
  assert.ok(event.point.timestamp <= event.timestamp, "the fix is not later than the stop");
  near(Math.hypot(event.point.east, event.point.north), 7 * 90, 60, "stop sits at the far end of the first leg");
  assert.equal(result.placedEventCount, 1);
});

test("leaves a stop unplaced when no fix is close enough", () => {
  const result = analyze([beach, leg(EAST, 7, 70), { seconds: 20, speed: 7, heading: EAST, gps: false }, { seconds: 40, speed: 0.3, heading: 170, gps: false }, leg(WEST, 7, 90), beach]);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].placed, false);
  assert.equal(result.placedEventCount, 0);
  assert.equal(result.cluster, null);
});

test("finds the end of the run where most stops happen", () => {
  const stop = { seconds: 18, speed: 0.3, heading: 170 };
  const lap = [leg(EAST, 7, 90), stop, leg(WEST, 7, 90), slowTurn];
  const result = analyze([beach, ...lap, ...lap, ...lap, leg(EAST, 7, 90), stop, leg(WEST, 7, 90), beach]);
  assert.equal(result.events.length, 4);
  assert.deepEqual(result.cluster, { zone: "E end", count: 4, total: 4 });
  assert.deepEqual(result.zoneCounts.map((entry) => entry.count), [0, 0, 4]);
});

test("grades riding speed into steps from slow to fast", () => {
  const result = analyze([beach, leg(EAST, 5, 120), leg(EAST, 9, 120), beach]);
  assert.equal(result.speedScale.bounds.length, 6);
  const riding = result.points.filter((point) => point.riding && point.speedStep !== null);
  const stepsAt = (speed) => new Set(riding.filter((point) => Math.abs(point.speed - speed) < 0.01).map((point) => point.speedStep));
  assert.deepEqual([...stepsAt(5)], [0]);
  assert.deepEqual([...stepsAt(9)], [4]);
  assert.ok(result.points.filter((point) => !point.riding).every((point) => point.speedStep === null));
});

test("has nothing to show without a track or without riding", () => {
  const still = segmentTrack(syntheticTrack([{ seconds: 300, speed: 0.5 }]));
  assert.equal(analyzeTrackWater(still, analyzeCoaching(still)).available, false);
  const blind = segmentTrack(syntheticTrack([{ seconds: 60, speed: 0.4, gps: false }, { seconds: 200, speed: 7, heading: EAST, gps: false }]));
  assert.equal(analyzeTrackWater(blind, analyzeCoaching(blind)).available, false);
  assert.equal(analyzeTrackWater(segmentTrack([]), { available: false }).available, false);
});

test("reads the demo session", async () => {
  const activity = createDemoActivity();
  const segmentation = segmentTrack(activity.records);
  const { recordWind } = await resolveWindAnnotation(activity, () => { throw new Error("the demo must not need the network"); });
  const coaching = analyzeCoaching(segmentation, { recordWind });
  const result = analyzeTrackWater(segmentation, coaching, { recordWind });
  assert.equal(result.available, true);
  near(result.wind.direction, 330, 12, "demo wind direction");
  assert.equal(result.events.length, coaching.stopSummary.stopCount);
  assert.equal(result.placedEventCount, result.events.length);
  assert.ok(result.upwind.highest.metres > result.upwind.lowest.metres);
  assert.ok(result.upwind.sections.every((section) => Number.isFinite(section.netMetres)));
  // The rider starts and finishes at the same spot on the beach.
  assert.ok(result.launchLanding.distance < 60, `launch to landing ${result.launchLanding.distance} m`);
});
