// Two looks share one set of CSS custom properties in styles.css: "pop" (the default) and "calm".
// The canvas charts cannot read CSS on their own, so they ask for their colours here.
export const THEMES = Object.freeze(["pop", "calm"]);
export const DEFAULT_THEME = "pop";
const STORAGE_KEY = "rideLabTheme";

// Every colour and font a chart draws with, and the custom property it comes from.
export const CHART_TOKENS = Object.freeze({
  ink: "--chart-ink",
  label: "--chart-label",
  grid: "--chart-grid",
  gridStrong: "--chart-grid-strong",
  band: "--chart-band",
  halo: "--chart-halo",
  speed: "--chart-speed",
  heart: "--chart-heart",
  wind: "--chart-wind",
  line: "--chart-line",
  highlight: "--chart-highlight",
  sideA: "--side-a",
  sideB: "--side-b",
  sideNone: "--side-none",
  stopped: "--stopped",
  route: "--route",
  trackRiding: "--track-riding",
  trackIdle: "--track-idle",
  speed1: "--speed-1",
  speed2: "--speed-2",
  speed3: "--speed-3",
  speed4: "--speed-4",
  speed5: "--speed-5",
  font: "--chart-font",
});

export function normalizeTheme(name) {
  return THEMES.includes(name) ? name : DEFAULT_THEME;
}

export function otherTheme(name) {
  return normalizeTheme(name) === "pop" ? "calm" : "pop";
}

// "#rrggbb" with an opacity, for fills under a line and for dimmed strokes.
export function fade(color, opacity) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(color).trim());
  if (!match) return color;
  const value = Number.parseInt(match[1], 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
}

let cached = null;

export function palette() {
  if (cached) return cached;
  const style = getComputedStyle(document.documentElement);
  const colours = Object.fromEntries(Object.entries(CHART_TOKENS).map(([key, token]) => [key, style.getPropertyValue(token).trim()]));
  cached = {
    ...colours,
    sides: [colours.sideA, colours.sideB],
    speedSteps: [colours.speed1, colours.speed2, colours.speed3, colours.speed4, colours.speed5],
  };
  return cached;
}

export function chartFont(size, weight = "") {
  return `${weight ? `${weight} ` : ""}${size}px ${palette().font}`;
}

export function currentTheme() {
  return normalizeTheme(document.documentElement.dataset.theme);
}

export function storedTheme() {
  try {
    return normalizeTheme(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

// The look is the only thing the app keeps in the browser; a ride never goes into storage.
// It is only written when the person picks a look, not when the page restores one.
export function applyTheme(name, { remember = true } = {}) {
  const theme = normalizeTheme(name);
  document.documentElement.dataset.theme = theme;
  cached = null;
  if (!remember) return theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private windows and blocked storage: the look still applies for this visit.
  }
  return theme;
}
