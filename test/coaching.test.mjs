// All tracks in this file are synthetic. Do not add recorded sessions as fixtures.
import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeCoaching } from "../public/coaching.js";
import { createDemoActivity } from "../public/demo-session.js";
import { segmentTrack } from "../public/track-segmentation.js";
import { near, syntheticTrack } from "../test-helpers/synthetic-track.mjs";

const EAST = 80;
const WEST = 260;
const beach = { seconds: 60, speed: 0.4 };
const leg = (heading, speed = 7, seconds = 90) => ({ seconds, speed, heading });
const coach = (phases, extra) => {
  const records = syntheticTrack(phases);
  return analyzeCoaching(segmentTrack(records), typeof extra === "function" ? extra(records) : extra);
};

test("measures how much speed each turn keeps", () => {
  const result = coach([beach, leg(EAST), { seconds: 3, speed: 2.8, heading: 170 }, leg(WEST), { seconds: 3, speed: 4.2, heading: 170 }, leg(EAST), beach]);
  assert.equal(result.turnSummary.made, 2);
  assert.equal(result.turnSummary.stopped, 0);
  const [first, second] = result.turns;
  near(first.entrySpeed, 7, 0.01, "entry speed");
  near(first.speedKept, 0.4, 0.02, "speed kept in the slow turn");
  near(second.speedKept, 0.6, 0.02, "speed kept in the faster turn");
  near(first.speedLost, 4.2, 0.1, "speed lost");
  assert.ok(first.recoverySeconds >= 1 && first.recoverySeconds <= 4, `recovery ${first.recoverySeconds} s`);
  assert.deepEqual(result.sides.map((side) => side.label), ["E", "W"]);
  assert.equal(result.sides[first.toSide].label, "W");
  assert.equal(result.sides[second.toSide].label, "E");
});

test("counts a turn that ends in a stop as failed", () => {
  const result = coach([beach, leg(EAST), { seconds: 18, speed: 0.3, heading: 170 }, leg(WEST), beach]);
  assert.equal(result.turnSummary.attempted, 1);
  assert.equal(result.turnSummary.made, 0);
  assert.equal(result.turnSummary.successRate, 0);
  assert.equal(result.stops.length, 1);
  assert.equal(result.stops[0].kind, "stop");
  assert.equal(result.stops[0].context, "turn");
  near(result.stops[0].restartSeconds, 18, 5, "restart time");
  assert.equal(result.stopSummary.stopsInTurns, 1);
  assert.equal(result.sides[result.turns[0].toSide].label, "W");
});

test("tells a mid-leg stop from a stop in a turn", () => {
  const result = coach([beach, leg(EAST), { seconds: 18, speed: 0.3, heading: 170 }, leg(EAST), beach]);
  assert.equal(result.stops[0].context, "leg");
  assert.equal(result.stopSummary.stopsMidLeg, 1);
  assert.equal(result.turnSummary.attempted, 0);
  assert.equal(result.sideBalance.find((side) => side.label === "E").midLegStops, 1);
});

test("does not call a slow turn a stop", () => {
  const result = coach([beach, leg(EAST), { seconds: 4, speed: 1.4, heading: 170 }, leg(WEST), beach]);
  assert.equal(result.stops.length, 0);
  assert.equal(result.turnSummary.made, 1);
});

test("separates long breaks from stops and leaves them out of time on board", () => {
  const result = coach([beach, leg(EAST, 7, 300), { seconds: 240, speed: 0.3 }, leg(WEST, 7, 300), { seconds: 20, speed: 0.3, heading: 170 }, leg(EAST, 7, 280), beach]);
  const { stopSummary } = result;
  assert.equal(stopSummary.breakCount, 1);
  assert.equal(stopSummary.stopCount, 1);
  near(stopSummary.breakSeconds, 240, 8, "break time");
  near(stopSummary.boardSeconds, 880, 15, "time on board");
  near(stopSummary.boardShareOfWater, 880 / 900, 0.02, "share of water time on the board");
  near(stopSummary.longestRide.seconds, 300, 8, "longest ride without a stop");
  near(result.personalBests.longestRide.distance, 2100, 80, "longest ride distance");
});

test("compares the two riding directions", () => {
  const result = coach([beach, leg(EAST, 8), leg(WEST, 6), leg(EAST, 8), leg(WEST, 6), leg(EAST, 8), leg(WEST, 6), beach]);
  const east = result.sideBalance.find((side) => side.label === "E");
  const west = result.sideBalance.find((side) => side.label === "W");
  assert.equal(east.legCount, 3);
  assert.equal(west.legCount, 3);
  near(east.averageSpeed, 8, 0.4, "eastbound speed");
  near(west.averageSpeed, 6, 0.4, "westbound speed");
  assert.ok(result.takeaways.some((takeaway) => takeaway.title === "Faster heading E"), JSON.stringify(result.takeaways));
});

test("finds the best speed over 10 seconds, 100 m and 500 m", () => {
  const result = coach([beach, leg(EAST, 5, 100), leg(EAST, 10, 20), leg(EAST, 5, 100), beach]);
  const bests = result.personalBests;
  near(bests.tenSeconds.speed, 10, 0.01, "best 10 s");
  near(bests.hundredMetres.speed, 10, 0.01, "best 100 m");
  near(bests.hundredMetres.seconds, 10, 0.01, "time for 100 m");
  assert.ok(bests.fiveHundredMetres.speed > 5.5 && bests.fiveHundredMetres.speed < 7.5, `best 500 m ${bests.fiveHundredMetres.speed}`);
  near(bests.longestLeg.distance, 1200, 60, "longest leg");
});

test("reports angle to the wind and ground gained when a wind direction is given", () => {
  const phases = [beach, leg(EAST), leg(WEST), leg(EAST), beach];
  assert.equal(coach(phases).upwind, null);
  const { upwind } = coach(phases, (records) => ({ recordWind: records.map(() => ({ windDirection: 20 })) }));
  near(upwind.closest.angleToWind, 60, 3, "closest angle to the wind");
  near(upwind.gainedMetres, 2 * 630 * 0.5, 40, "ground gained upwind");
  near(upwind.lostMetres, 630 * 0.5, 30, "ground lost downwind");
  near(upwind.sides.find((side) => side.label === "W").medianAngleToWind, 120, 3, "westbound angle");
  assert.equal(upwind.sections.length, 1);
  assert.equal(upwind.sections[0].legCount, 3);
  near(upwind.sections[0].netMetres, 630 * 0.5, 40, "ground gained in the ride section");
  near(upwind.sections[0].netMetres, upwind.netMetres, 0.001, "section total against session total");
});

test("marks the point where riding speed dropped", () => {
  const session = (speedFor) => [beach, ...Array.from({ length: 16 }, (_, index) => leg(index % 2 ? WEST : EAST, speedFor(index), 100)), beach];
  const tired = coach(session((index) => (index < 8 ? 8 : 6))).fatigue;
  assert.equal(tired.drop.quarter, 3);
  near(tired.drop.speedDrop, 0.25, 0.02, "size of the drop");
  near(tired.speedChange, -0.25, 0.02, "last quarter against the first");
  const steady = coach(session(() => 7)).fatigue;
  assert.equal(steady.drop, null);
  assert.equal(coach([beach, leg(EAST), leg(WEST), beach]).fatigue, null);
});

test("has nothing to say about a track with no riding", () => {
  assert.equal(coach([{ seconds: 300, speed: 0.5 }]).available, false);
  assert.equal(analyzeCoaching(segmentTrack([])).available, false);
});

test("finds the demo rider's weak side", () => {
  const result = analyzeCoaching(segmentTrack(createDemoActivity().records));
  assert.deepEqual(result.sides.map((side) => side.label), ["NE", "SW"]);
  const [northEast, southWest] = result.sideBalance;
  assert.ok(result.turnSummary.attempted > 30);
  assert.ok(southWest.turns.successRate < northEast.turns.successRate);
  assert.ok(southWest.turns.medianSpeedKept < northEast.turns.medianSpeedKept);
  assert.equal(result.takeaways.length, 3);
  assert.ok(result.takeaways.some((takeaway) => takeaway.title.includes("SW")), JSON.stringify(result.takeaways));
  assert.ok(result.stopSummary.boardShareOfWater > 0.7 && result.stopSummary.boardShareOfWater < 1);
});
