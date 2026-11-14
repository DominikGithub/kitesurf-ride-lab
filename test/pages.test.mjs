import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PAGE, PAGES, resolvePage } from "../public/pages.js";

test("opens each page by its own address, with or without the hash sign", () => {
  PAGES.forEach((page) => {
    assert.equal(resolvePage(`#${page.id}`), page.id);
    assert.equal(resolvePage(page.id), page.id);
  });
});

test("starts on the coaching page", () => {
  assert.equal(DEFAULT_PAGE, "coach");
  assert.equal(resolvePage(""), "coach");
  assert.equal(resolvePage("#"), "coach");
  assert.equal(resolvePage(undefined), "coach");
  assert.equal(resolvePage("#no-such-page"), "coach");
});

test("keeps addresses from before the pages were renamed working", () => {
  assert.equal(resolvePage("#coaching"), "coach");
  assert.equal(resolvePage("#speed-effort"), "replay");
  assert.equal(resolvePage("#track-water"), "upwind-stops");
  assert.equal(resolvePage("#overview"), "body");
  assert.equal(resolvePage("#ride-segments"), "coach");
});

test("keeps the pages for one ride apart from the page that compares rides", () => {
  assert.deepEqual(PAGES.filter((page) => page.group === "ride").map((page) => page.id), ["coach", "replay", "upwind-stops", "body"]);
  assert.deepEqual(PAGES.filter((page) => page.group === "all").map((page) => page.id), ["progress"]);
});
