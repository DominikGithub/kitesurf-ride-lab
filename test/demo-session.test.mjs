import assert from "node:assert/strict";
import { test } from "node:test";
import { createDemoActivity } from "../public/demo-session.js";

const METRES_PER_DEGREE = 111320;
const fields = createDemoActivity().records.map((record) => record.fields);

function metresBetween(start, end) {
  const north = (end.position_lat - start.position_lat) * METRES_PER_DEGREE;
  const east = (end.position_long - start.position_long) * METRES_PER_DEGREE * Math.cos(start.position_lat * Math.PI / 180);
  return Math.hypot(north, east);
}

test("the demo session is identical on every load", () => {
  assert.deepEqual(createDemoActivity().records.map((record) => record.fields), fields);
});

test("the demo session is 90 minutes sampled once per second", () => {
  assert.equal(fields.length, 90 * 60 + 1);
  fields.slice(1).forEach((record, index) => assert.equal(record.timestamp - fields[index].timestamp, 1));
});

test("the demo track moves continuously at plausible speeds", () => {
  const fastest = Math.max(...fields.map((record) => record.enhanced_speed));
  assert.ok(fastest > 8 && fastest < 12, `top speed ${fastest} m/s`);
  const longestStep = Math.max(...fields.slice(1).map((record, index) => metresBetween(fields[index], record)));
  assert.ok(longestStep < 13, `longest one-second step ${longestStep} m`);
  fields.slice(1).forEach((record, index) => assert.ok(record.distance >= fields[index].distance));
});

test("the demo rider starts and finishes at the same spot on the beach", () => {
  assert.ok(metresBetween(fields[0], fields.at(-1)) < 25);
  assert.ok(fields[0].enhanced_speed < 1 && fields.at(-1).enhanced_speed < 1);
});

test("the demo heart rate stays in a human range and rises while riding", () => {
  const heartRates = fields.map((record) => record.heart_rate);
  assert.ok(Math.min(...heartRates) > 80 && Math.max(...heartRates) < 175);
  const average = (records) => records.reduce((total, record) => total + record.heart_rate, 0) / records.length;
  const riding = fields.filter((record) => record.enhanced_speed > 5);
  const resting = fields.filter((record) => record.enhanced_speed < 1);
  assert.ok(average(riding) - average(resting) > 15);
});
