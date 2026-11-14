import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CHART_TOKENS, DEFAULT_THEME, THEMES, fade, normalizeTheme, otherTheme } from "../public/theme.js";

const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

// The custom properties declared in the block that starts with the given selector.
function tokensIn(selector) {
  const start = styles.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} is missing from styles.css`);
  const block = styles.slice(start, styles.indexOf("}", start));
  return new Map([...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

const pop = tokensIn(":root");
const calm = tokensIn(':root[data-theme="calm"]');

test("both looks define exactly the same names", () => {
  assert.ok(pop.size > 20, "the default look defines its tokens");
  assert.deepEqual([...calm.keys()].sort(), [...pop.keys()].sort());
});

test("every colour a chart asks for exists in both looks", () => {
  Object.values(CHART_TOKENS).forEach((token) => {
    assert.ok(pop.has(token), `${token} is missing from the default look`);
    assert.ok(calm.has(token), `${token} is missing from the calm look`);
  });
});

test("colours that get faded are plain six-digit hex in both looks", () => {
  ["--chart-speed", "--chart-heart", "--chart-wind", "--chart-halo", "--track-idle"].forEach((token) => {
    [pop, calm].forEach((look) => assert.match(look.get(token), /^#[0-9a-f]{6}$/i, `${token} is ${look.get(token)}`));
  });
});

test("fades a hex colour and leaves anything else alone", () => {
  assert.equal(fade("#ff4d6d", 0.25), "rgba(255, 77, 109, 0.25)");
  assert.equal(fade("#000000", 1), "rgba(0, 0, 0, 1)");
  assert.equal(fade("rgba(1, 2, 3, .5)", 0.2), "rgba(1, 2, 3, .5)");
});

test("switches between the two looks and falls back to the default", () => {
  assert.deepEqual([...THEMES], ["pop", "calm"]);
  assert.equal(DEFAULT_THEME, "pop");
  assert.equal(otherTheme("pop"), "calm");
  assert.equal(otherTheme("calm"), "pop");
  assert.equal(normalizeTheme("calm"), "calm");
  assert.equal(normalizeTheme("neon"), "pop");
  assert.equal(normalizeTheme(null), "pop");
});
