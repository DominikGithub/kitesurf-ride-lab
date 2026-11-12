// All tracks in this file are synthetic. Do not add recorded sessions as fixtures.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDemoActivity } from "../public/demo-session.js";
import { segmentTrack } from "../public/track-segmentation.js";
import { START, near, syntheticTrack } from "../test-helpers/synthetic-track.mjs";

const offsets = (section) => [section.startTimestamp - START, section.endTimestamp - START];

test("places section boundaries within a few seconds of the speed change", () => {
  const { activeSections, sections } = segmentTrack(syntheticTrack([
    { seconds: 100, speed: 0.5 },
    { seconds: 200, speed: 7 },
    { seconds: 100, speed: 0.5 },
  ]));
  assert.equal(activeSections.length, 1);
  assert.deepEqual(sections.map((section) => section.type), ["inactive", "active", "inactive"]);
  const [start, end] = offsets(activeSections[0]);
  near(start, 100, 3, "section start");
  near(end, 300, 3, "section end");
});

test("bridges a short stop but splits on a long one", () => {
  const ride = (stopSeconds) => segmentTrack(syntheticTrack([
    { seconds: 60, speed: 0.5 },
    { seconds: 120, speed: 7 },
    { seconds: stopSeconds, speed: 0.3 },
    { seconds: 120, speed: 7 },
    { seconds: 60, speed: 0.5 },
  ])).activeSections;
  assert.equal(ride(15).length, 1);
  assert.equal(ride(60).length, 2);
});

test("keeps a one-minute ride and ignores a brief burst", () => {
  const ride = (seconds) => segmentTrack(syntheticTrack([
    { seconds: 90, speed: 0.5 },
    { seconds, speed: 7 },
    { seconds: 90, speed: 0.5 },
  ])).activeSections;
  assert.equal(ride(60).length, 1);
  assert.equal(ride(25).length, 0);
});

test("does not join riding across a recording pause", () => {
  const records = syntheticTrack([{ seconds: 400, speed: 7 }]);
  const paused = [...records.slice(0, 150), ...records.slice(250)];
  assert.equal(segmentTrack(paused).activeSections.length, 2);
});

test("splits an active section into legs at each turn", () => {
  const { activeSections, legCount } = segmentTrack(syntheticTrack([
    { seconds: 60, speed: 0.5 },
    { seconds: 90, speed: 7, heading: 80 },
    { seconds: 90, speed: 7, heading: 260 },
    { seconds: 90, speed: 7, heading: 80 },
    { seconds: 60, speed: 0.5 },
  ]));
  assert.equal(activeSections.length, 1);
  const { legs } = activeSections[0];
  assert.equal(legs.length, 3);
  assert.equal(legCount, 3);
  near(legs[1].startTimestamp - START, 150, 6, "first turn");
  near(legs[2].startTimestamp - START, 240, 6, "second turn");
  near(legs[1].heading, 260, 5, "middle leg heading");
  assert.equal(legs[0].startTimestamp, activeSections[0].startTimestamp);
  assert.equal(legs.at(-1).endTimestamp, activeSections[0].endTimestamp);
});

test("keeps a steady course with small corrections as one leg", () => {
  const { activeSections } = segmentTrack(syntheticTrack([
    { seconds: 60, speed: 7, heading: 80 },
    { seconds: 60, speed: 7, heading: 110 },
    { seconds: 60, speed: 7, heading: 70 },
  ]));
  assert.equal(activeSections[0].legs.length, 1);
});

test("segments the bundled demo session into riding blocks separated by breaks", () => {
  const result = segmentTrack(createDemoActivity().records);
  const { activeSections, sections } = result;
  assert.ok(activeSections.length >= 4, `expected several riding blocks, got ${activeSections.length}`);
  assert.equal(sections[0].type, "inactive");
  assert.equal(sections.at(-1).type, "inactive");
  sections.slice(1).forEach((section, index) => assert.equal(section.startTimestamp, sections[index].endTimestamp));
  near(result.activeDuration / 60, 60, 10, "minutes of riding");
  assert.ok(activeSections.every((section) => section.legs.length >= 1 && section.medianSpeed > 5));
  assert.ok(result.medianLegDuration >= 30 && result.medianLegDuration <= 120, `median leg ${result.medianLegDuration} s`);
});

test("returns no sections for an empty track", () => {
  const result = segmentTrack([]);
  assert.deepEqual(result.sections, []);
  assert.equal(result.legCount, 0);
});
