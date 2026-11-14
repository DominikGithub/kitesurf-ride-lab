// The pages of the app and the address each one answers to.
// "ride" pages look at the one ride that is open; "all" pages compare several rides.
export const PAGES = Object.freeze([
  Object.freeze({ id: "coach", label: "Coach", group: "ride" }),
  Object.freeze({ id: "replay", label: "Replay", group: "ride" }),
  Object.freeze({ id: "upwind-stops", label: "Upwind & stops", group: "ride" }),
  Object.freeze({ id: "body", label: "Body", group: "ride" }),
  Object.freeze({ id: "progress", label: "Progress", group: "all" }),
]);

export const DEFAULT_PAGE = "coach";

// Addresses from before the pages were renamed, so old links and bookmarks still open the right page.
const FORMER_ADDRESSES = Object.freeze({
  coaching: "coach",
  "speed-effort": "replay",
  "track-water": "upwind-stops",
  overview: "body",
});

export function resolvePage(hash) {
  const name = String(hash ?? "").replace(/^#/, "");
  if (PAGES.some((page) => page.id === name)) return name;
  return FORMER_ADDRESSES[name] ?? DEFAULT_PAGE;
}
