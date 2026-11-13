import { dateFromFit, decodeFit, getField } from "./fit-decoder.js";
import { analyzeCoaching } from "./coaching.js";
import { createDemoActivity, createDemoSeries } from "./demo-session.js";
import { DEFAULT_PROGRESS_METRICS, PROGRESS_KINDS, PROGRESS_METRICS, describeChange, sameSession, sortSessions, summarizeSession } from "./progress.js";
import { sectionContainsIndex, segmentTrack } from "./track-segmentation.js";
import { analyzeTrackWater } from "./track-water.js";
import { calculateWindCoaching, resolveWindAnnotation, summarizeAnnotatedWind } from "./wind-annotation.js";

const $ = (selector) => document.querySelector(selector);
const input = $("#fitInput");
const emptyState = $("#emptyState");
const dashboard = $("#dashboard");
const dropTarget = $("#dropTarget");
const errorBanner = $("#errorBanner");
const speedCanvas = $("#speedChart");
const heartCanvas = $("#heartChart");
const mapCanvas = $("#mapCanvas");
const mapTiles = $("#mapTiles");
const overviewIntro = $("#overviewIntro");
const speedEffortPage = $("#speedEffortPage");
const rideSegmentsPage = $("#rideSegmentsPage");
const analysisEmpty = $("#analysisEmpty");
const analysisBody = $("#analysisBody");
const rideSegmentsEmpty = $("#rideSegmentsEmpty");
const rideSegmentsBody = $("#rideSegmentsBody");
const analysisSpeedCanvas = $("#analysisSpeedChart");
const analysisHeartCanvas = $("#analysisHeartChart");
const analysisWindCanvas = $("#analysisWindChart");
const analysisMapCanvas = $("#analysisMapCanvas");
const mapWindIndicator = $("#mapWindIndicator");
const analysisMapWindIndicator = $("#analysisMapWindIndicator");
const inventoryToggle = $("#inventoryToggle");
const inventoryTableWrap = $("#inventoryTableWrap");
const analysisMapTiles = $("#analysisMapTiles");
const segmentsMapCanvas = $("#segmentsMapCanvas");
const segmentsMapTiles = $("#segmentsMapTiles");
const segmentsList = $("#segmentsList");
const coachingPage = $("#coachingPage");
const coachingEmpty = $("#coachingEmpty");
const coachingBody = $("#coachingBody");
const coachingTurnCanvas = $("#coachingTurnChart");
const coachingMapCanvas = $("#coachingMapCanvas");
const coachingMapTiles = $("#coachingMapTiles");
const progressPage = $("#progressPage");
const trackWaterPage = $("#trackWaterPage");
const trackWaterEmpty = $("#trackWaterEmpty");
const trackWaterBody = $("#trackWaterBody");
const trackWaterWindCanvas = $("#trackWaterWindPlot");
const trackWaterChartCanvas = $("#trackWaterUpwindChart");
const trackWaterMapCanvas = $("#trackWaterMapCanvas");
const trackWaterMapTiles = $("#trackWaterMapTiles");

const isDemoMode = new URLSearchParams(window.location.search).has("demo");
const OVERVIEW_POINT_LIMIT = 720;
const MAP_POINT_LIMIT = 720;
const ANALYSIS_POINT_LIMIT = 900;
const SEGMENT_COLORS = ["#b8d354", "#d77a61", "#e0a463", "#6c9296", "#8eaa2d", "#965743", "#4f8f83", "#b28bca", "#c49a5a", "#5b7891"];

let currentActivity = null;
let visualFrame = null;
let analysisSelectionIndex = null;
let analysisRenderState = { speed: null, heart: null, wind: null, map: null };
let selectedSegmentIndex = null;
let segmentRenderState = { map: null };
let coachingRenderState = { marks: [], mapMarks: [], hoveredTurn: null, coaching: null };
const emptyTrackWaterState = (mode = "stops") => ({ mode, analysis: null, chart: null, hoveredPoint: null, hoveredEvent: null, hoveredMapPoint: null, mapMarks: [], mapPoints: [] });
let trackWaterRenderState = emptyTrackWaterState();
// The progress page keeps its own list of rides, independent of the ride open on the other pages.
const progressState = { sessions: [], selected: new Set(DEFAULT_PROGRESS_METRICS), cards: [], hoveredIndex: null, nextId: 0, busy: false, windBusy: false, demoLoaded: false };
let windAnnotationRequest = 0;
let analysisMapFocus = null;
const mapLayoutCache = new WeakMap();
const mapZoomState = new WeakMap();
const mapPanState = new WeakMap();
const mapPointerState = new WeakMap();

function setText(selector, value) {
  $(selector).textContent = value;
}

function number(value, digits = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "—";
}

function formatDuration(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60).toString().padStart(2, "0");
  const remainder = (total % 60).toString().padStart(2, "0");
  return hours ? `${hours}:${minutes}:${remainder}` : `${minutes}:${remainder}`;
}

function formatDurationClock(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  const totalCentiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const wholeSeconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  const clock = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${wholeSeconds.toString().padStart(2, "0")}`;
  return centiseconds ? `${clock}.${centiseconds.toString().padStart(2, "0")}` : clock;
}

function formatDistance(metres) {
  if (typeof metres !== "number" || !Number.isFinite(metres)) return "—";
  return metres >= 1000 ? `${number(metres / 1000, 2)} km` : `${number(metres, 0)} m`;
}

function formatSpeed(metresPerSecond) {
  return typeof metresPerSecond === "number" && Number.isFinite(metresPerSecond) ? `${number(metresPerSecond * 3.6, 1)} km/h` : "—";
}

function formatWindSpeed(metresPerSecond) {
  return typeof metresPerSecond === "number" && Number.isFinite(metresPerSecond) ? `${number(metresPerSecond * 1.943844, 1)} ktn` : "—";
}

function formatWindDirection(direction) {
  if (typeof direction !== "number" || !Number.isFinite(direction)) return "—";
  const normalized = ((direction % 360) + 360) % 360;
  return `${number(normalized, 0)} deg ${compassDirection(normalized)}`;
}

function compassDirection(direction) {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(direction / 45) % 8];
}

function formatDate(value, withTime = true) {
  const date = dateFromFit(value);
  if (!date || Number.isNaN(date.getTime())) return "Date not available";
  return date.toLocaleString(undefined, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
}

function formatTime(value) {
  const date = dateFromFit(value);
  if (!date || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(undefined, { timeStyle: "short" });
}

function formatTimeRange(start, end) {
  const date = dateFromFit(start);
  if (!date || Number.isNaN(date.getTime())) return "Date not available";
  return `${formatDate(start, false)} · ${formatTime(start)} – ${formatTime(end)}`;
}

function showError(error) {
  setText("#errorText", ` ${error.message || "Unknown parsing error."}`);
  errorBanner.classList.remove("hidden");
}

function hideError() {
  errorBanner.classList.add("hidden");
}

function chooseFirst(...values) {
  return values.find((value) => typeof value === "number" && Number.isFinite(value)) ?? null;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function formatFeeling(value) {
  const labels = { 1: "Poor", 2: "Average", 3: "Good", 4: "Very good", 5: "Excellent" };
  if (typeof value !== "number" || !Number.isFinite(value)) return "not recorded";
  return labels[value] ? `${labels[value]} (${number(value)}/5)` : `Score ${number(value)}`;
}

function within(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

function recordDistance(record) {
  return chooseFirst(getField(record, "distance"));
}

function recordSpeed(record, previousRecord) {
  const measured = chooseFirst(getField(record, "enhanced_speed"), getField(record, "speed"));
  if (measured !== null) return measured;
  if (!previousRecord) return null;
  const distance = recordDistance(record);
  const previousDistance = recordDistance(previousRecord);
  const timestamp = getField(record, "timestamp");
  const previousTimestamp = getField(previousRecord, "timestamp");
  if (distance === null || previousDistance === null || timestamp === null || previousTimestamp === null) return null;
  const elapsed = timestamp - previousTimestamp;
  return elapsed > 0 ? Math.max(0, (distance - previousDistance) / elapsed) : null;
}

function recordPosition(record) {
  const latitude = getField(record, "position_lat");
  const longitude = getField(record, "position_long");
  return typeof latitude === "number" && typeof longitude === "number" && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
    ? { latitude, longitude }
    : null;
}

function downsampleValues(values, limit = OVERVIEW_POINT_LIMIT) {
  const clean = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (clean.length <= limit) return clean;
  const sampled = [];
  for (let index = 0; index < limit; index += 1) {
    const start = Math.floor((index * clean.length) / limit);
    const end = Math.max(start + 1, Math.floor(((index + 1) * clean.length) / limit));
    const bucket = clean.slice(start, end);
    sampled.push(bucket.reduce((sum, value) => sum + value, 0) / bucket.length);
  }
  return sampled;
}

function downsamplePoints(points, limit = MAP_POINT_LIMIT) {
  if (points.length <= limit) return points;
  return Array.from({ length: limit }, (_, index) => points[Math.round((index * (points.length - 1)) / (limit - 1))]);
}

function summarize(activity) {
  const session = activity.session;
  const records = activity.records;
  const recordDistances = records.map(recordDistance).filter((value) => value !== null && value >= 0);
  const recordStart = getField(records[0], "timestamp");
  const recordEnd = getField(records.at(-1), "timestamp");
  const recordDuration = recordStart !== null && recordEnd !== null ? Math.max(0, recordEnd - recordStart) : null;
  const starts = chooseFirst(getField(session, "start_time"), recordStart, getField(activity.fileId, "time_created"));
  const sessionDuration = chooseFirst(getField(session, "total_elapsed_time"), getField(session, "total_timer_time"));
  const duration = chooseFirst(sessionDuration, recordDuration);
  const ends = chooseFirst(recordEnd, starts !== null && duration !== null ? starts + duration : null);
  const calculatedDuration = starts !== null && ends !== null ? Math.max(0, ends - starts) : duration;
  const sessionDistance = getField(session, "total_distance");
  const recordDistanceTotal = recordDistances.length ? Math.max(...recordDistances) : null;
  const distance = recordDistanceTotal !== null && (sessionDistance === null || sessionDistance < recordDistanceTotal * 0.75) ? recordDistanceTotal : chooseFirst(sessionDistance, recordDistanceTotal);
  const speeds = records.map((record, index) => recordSpeed(record, records[index - 1])).filter((value) => value !== null && value >= 0);
  const heartRates = records.map((record) => getField(record, "heart_rate")).filter((value) => value !== null && value > 0);
  const recordCalories = records.map((record) => getField(record, "calories")).filter((value) => value !== null && value >= 0);
  const gpsAccuracyValues = records.map((record) => getField(record, "gps_accuracy")).filter((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const fatRatioValues = records.map((record) => getField(record, "fp")).filter((value) => typeof value === "number" && Number.isFinite(value));
  const ngpValues = records.map((record) => getField(record, "ngp")).filter((value) => typeof value === "number" && Number.isFinite(value));
  const avgSpeed = chooseFirst(within(getField(session, "avg_speed"), 0, 100), distance !== null && duration ? distance / duration : null, speeds.length ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : null);
  const maxSpeed = chooseFirst(within(getField(session, "max_speed"), 0, 100), speeds.length ? Math.max(...speeds) : null);
  const avgHeartRate = chooseFirst(within(getField(session, "avg_heart_rate"), 20, 250), heartRates.length ? heartRates.reduce((sum, value) => sum + value, 0) / heartRates.length : null);
  const maxHeartRate = chooseFirst(within(getField(session, "max_heart_rate"), 20, 250), heartRates.length ? Math.max(...heartRates) : null);
  const minHeartRate = chooseFirst(within(getField(session, "min_heart_rate"), 20, 250), heartRates.length ? Math.min(...heartRates) : null);
  const heartRateZoneSeconds = Array.isArray(getField(session, "time_in_hr_zone"))
    ? getField(session, "time_in_hr_zone").map((value) => within(value, 0, 86400)).filter((value) => value !== null)
    : null;
  return {
    activity,
    session,
    records,
    duration,
    calculatedDuration,
    ends,
    timer: within(getField(session, "total_timer_time"), 0, 86400),
    distance,
    avgSpeed,
    maxSpeed,
    avgHeartRate,
    maxHeartRate,
    minHeartRate,
    trainingStressScore: within(getField(session, "training_stress_score"), 0, 10000),
    trainingEffect: within(getField(session, "total_training_effect"), 0, 10),
    heartRateZoneSeconds,
    gpsAccuracy: average(gpsAccuracyValues),
    calories: chooseFirst(within(getField(session, "total_calories"), 0, 100000), recordCalories.length ? Math.max(...recordCalories) : null),
    carbs: chooseFirst(getField(session, "carbs")),
    fat: chooseFirst(getField(session, "fat")),
    recoveryTime: chooseFirst(getField(session, "recovery_time")),
    peakEpoc: chooseFirst(getField(session, "peak_epoc")),
    feeling: chooseFirst(getField(session, "feeling")),
    fatRatio: chooseFirst(getField(session, "fp"), average(fatRatioValues)),
    avgNgp: chooseFirst(getField(session, "avg_ngp"), average(ngpValues)),
    ascent: within(getField(session, "total_ascent"), 0, 10000),
    descent: within(getField(session, "total_descent"), 0, 10000),
    starts,
    speeds,
  };
}

function sessionTitle(summary) {
  return summary.activity.isDemo ? "Demo kite-surf session" : "Kite-surf session";
}

function drawChart(canvas, values, options = {}) {
  const wrapper = canvas.parentElement;
  const width = Math.max(200, Math.floor(wrapper.clientWidth));
  const height = Math.max(170, Math.floor(wrapper.clientHeight));
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  const clean = downsampleValues(values, Math.min(OVERVIEW_POINT_LIMIT, Math.max(180, Math.ceil(width * 1.25))));
  if (!clean.length) return false;

  const padding = { top: 18, right: 10, bottom: 12, left: 40 };
  const min = options.min ?? Math.min(...clean);
  const max = options.max ?? Math.max(...clean);
  const range = max - min || 1;
  const x = (index) => padding.left + (index / Math.max(clean.length - 1, 1)) * (width - padding.left - padding.right);
  const y = (value) => height - padding.bottom - ((value - min) / range) * (height - padding.top - padding.bottom);

  context.fillStyle = "#9ba5a3";
  context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "right";
  context.textBaseline = "middle";
  context.strokeStyle = "rgba(55, 77, 80, 0.16)";
  context.lineWidth = 1;
  for (let line = 0; line < 4; line += 1) {
    const lineY = padding.top + (line / 3) * (height - padding.top - padding.bottom);
    const tickValue = max - (line / 3) * (max - min);
    context.fillText(options.axisLabel ? options.axisLabel(tickValue) : number(tickValue, 0), padding.left - 8, lineY);
    context.beginPath();
    context.moveTo(padding.left, lineY);
    context.lineTo(width - padding.right, lineY);
    context.stroke();
  }

  const gradient = context.createLinearGradient(0, padding.top, 0, height);
  gradient.addColorStop(0, options.fillTop ?? "rgba(195, 224, 78, 0.32)");
  gradient.addColorStop(1, options.fillBottom ?? "rgba(195, 224, 78, 0.02)");
  context.beginPath();
  clean.forEach((value, index) => {
    if (index === 0) context.moveTo(x(index), y(value));
    else context.lineTo(x(index), y(value));
  });
  context.lineTo(x(clean.length - 1), height - padding.bottom);
  context.lineTo(x(0), height - padding.bottom);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();

  context.beginPath();
  clean.forEach((value, index) => {
    if (index === 0) context.moveTo(x(index), y(value));
    else context.lineTo(x(index), y(value));
  });
  context.strokeStyle = options.line ?? "#afc84c";
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.stroke();
  context.fillStyle = options.line ?? "#afc84c";
  context.beginPath();
  context.arc(x(clean.length - 1), y(clean[clean.length - 1]), 3.5, 0, Math.PI * 2);
  context.fill();
  return true;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function downsampleSeries(points, limit) {
  if (points.length <= limit) return points;
  return Array.from({ length: limit }, (_, index) => points[Math.round((index * (points.length - 1)) / (limit - 1))]);
}

function nearestSeriesPoint(points, targetIndex) {
  return points.reduce((nearest, point) => Math.abs(point.index - targetIndex) < Math.abs(nearest.index - targetIndex) ? point : nearest, points[0]);
}

function drawLinkedChart(canvas, records, valueFor, options = {}, selectedIndex = null) {
  const wrapper = canvas.parentElement;
  canvas.style.display = "block";
  const width = Math.max(240, Math.floor(wrapper.clientWidth));
  const height = Math.max(options.minHeight ?? 190, Math.floor(wrapper.clientHeight));
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const points = records.map((record, index) => ({ index, value: valueFor(record, index) })).filter((point) => typeof point.value === "number" && Number.isFinite(point.value));
  if (!points.length) return { visible: false, points: [], nearestIndexForX: () => null };

  const padding = { top: 18, right: 12, bottom: 12, left: 40 };
  const startTime = getField(records[0], "timestamp");
  const endTime = getField(records.at(-1), "timestamp");
  const hasTimeRange = typeof startTime === "number" && typeof endTime === "number" && endTime > startTime;
  const recordRatio = (index) => {
    if (hasTimeRange) {
      const timestamp = getField(records[index], "timestamp");
      if (typeof timestamp === "number" && Number.isFinite(timestamp)) return clamp((timestamp - startTime) / (endTime - startTime), 0, 1);
    }
    return index / Math.max(records.length - 1, 1);
  };
  const x = (index) => padding.left + recordRatio(index) * (width - padding.left - padding.right);
  const min = options.min ?? Math.min(...points.map((point) => point.value));
  const max = options.max ?? Math.max(...points.map((point) => point.value));
  const range = max - min || 1;
  const y = (value) => height - padding.bottom - ((value - min) / range) * (height - padding.top - padding.bottom);

  context.strokeStyle = "rgba(55, 77, 80, 0.16)";
  context.lineWidth = 1;
  context.fillStyle = "#9ba5a3";
  context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (let line = 0; line < 4; line += 1) {
    const lineY = padding.top + (line / 3) * (height - padding.top - padding.bottom);
    const tickValue = max - (line / 3) * (max - min);
    context.fillText(options.axisLabel ? options.axisLabel(tickValue) : number(tickValue, 0), padding.left - 8, lineY);
    context.beginPath();
    context.moveTo(padding.left, lineY);
    context.lineTo(width - padding.right, lineY);
    context.stroke();
  }

  const visiblePoints = downsampleSeries(points, Math.min(ANALYSIS_POINT_LIMIT, Math.max(220, Math.ceil(width * 1.7))));
  const gradient = context.createLinearGradient(0, padding.top, 0, height);
  gradient.addColorStop(0, options.fillTop ?? "rgba(184, 211, 84, .30)");
  gradient.addColorStop(1, options.fillBottom ?? "rgba(184, 211, 84, .02)");
  context.beginPath();
  visiblePoints.forEach((point, index) => {
    if (index === 0) context.moveTo(x(point.index), y(point.value));
    else context.lineTo(x(point.index), y(point.value));
  });
  context.lineTo(x(visiblePoints.at(-1).index), height - padding.bottom);
  context.lineTo(x(visiblePoints[0].index), height - padding.bottom);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();

  context.beginPath();
  visiblePoints.forEach((point, index) => {
    if (index === 0) context.moveTo(x(point.index), y(point.value));
    else context.lineTo(x(point.index), y(point.value));
  });
  context.strokeStyle = options.line ?? "#b8d354";
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.stroke();

  const activePoint = selectedIndex === null ? null : nearestSeriesPoint(points, selectedIndex);
  if (selectedIndex !== null) {
    const cursorX = x(selectedIndex);
    context.strokeStyle = "rgba(23, 37, 42, .42)";
    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(cursorX, padding.top);
    context.lineTo(cursorX, height - padding.bottom);
    context.stroke();
    context.setLineDash([]);
  }
  if (activePoint) {
    const activeX = x(activePoint.index);
    const activeY = y(activePoint.value);
    context.fillStyle = "rgba(251, 252, 248, .95)";
    context.strokeStyle = options.line ?? "#b8d354";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(activeX, activeY, 6, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  return {
    visible: true,
    points,
    nearestIndexForX(pointerX) {
      const target = clamp(pointerX, padding.left, width - padding.right);
      return points.reduce((nearest, point) => Math.abs(x(point.index) - target) < Math.abs(x(nearest.index) - target) ? point : nearest).index;
    },
  };
}

function webMercatorPoint(point, zoom) {
  const worldSize = 256 * 2 ** zoom;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, point.latitude));
  const latitudeRadians = latitude * Math.PI / 180;
  return {
    x: ((point.longitude + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + Math.sin(latitudeRadians)) / (1 - Math.sin(latitudeRadians))) / (4 * Math.PI)) * worldSize,
  };
}

function tileXWrapped(value, tileCount) {
  return ((value % tileCount) + tileCount) % tileCount;
}

function loadMapTiles(points, width, height, tileContainer, requestedZoom = null) {
  tileContainer.replaceChildren();
  if (points.length < 2) return null;

  let fitZoom = 3;
  let fitProjected = points.map((point) => webMercatorPoint(point, fitZoom));
  for (let zoom = 17; zoom >= 3; zoom -= 1) {
    const candidate = points.map((point) => webMercatorPoint(point, zoom));
    const candidateWidth = Math.max(...candidate.map((point) => point.x)) - Math.min(...candidate.map((point) => point.x));
    const candidateHeight = Math.max(...candidate.map((point) => point.y)) - Math.min(...candidate.map((point) => point.y));
    fitZoom = zoom;
    fitProjected = candidate;
    if (candidateWidth <= width * 0.68 && candidateHeight <= height * 0.68) break;
  }
  const maxZoom = Math.min(19, fitZoom + 6);
  const selectedZoom = clamp(requestedZoom ?? fitZoom, fitZoom, maxZoom);
  const projected = selectedZoom === fitZoom ? fitProjected : points.map((point) => webMercatorPoint(point, selectedZoom));

  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const pan = mapPanState.get(tileContainer) ?? { x: 0, y: 0 };
  const viewportLeft = centerX - width / 2 - pan.x;
  const viewportTop = centerY - height / 2 - pan.y;
  const firstTileX = Math.floor(viewportLeft / 256) - 1;
  const lastTileX = Math.floor((viewportLeft + width) / 256) + 1;
  const firstTileY = Math.floor(viewportTop / 256) - 1;
  const lastTileY = Math.floor((viewportTop + height) / 256) + 1;
  const tileCount = 2 ** selectedZoom;

  for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
    if (tileY < 0 || tileY >= tileCount) continue;
    for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
      const tile = document.createElement("img");
      tile.alt = "";
      tile.loading = "eager";
      tile.decoding = "async";
      // OpenStreetMap's tile servers block requests that carry no Referer; this sends the origin only, never the path.
      tile.referrerPolicy = "strict-origin-when-cross-origin";
      tile.src = `https://tile.openstreetmap.org/${selectedZoom}/${tileXWrapped(tileX, tileCount)}/${tileY}.png`;
      tile.style.left = `${tileX * 256 - viewportLeft}px`;
      tile.style.top = `${tileY * 256 - viewportTop}px`;
      tileContainer.append(tile);
    }
  }
  return { projected, viewportLeft, viewportTop, zoom: selectedZoom, fitZoom, maxZoom };
}

function updateWindDirectionIndicator(indicator, recordWind, selectedIndex = null) {
  if (!indicator) return;
  if (!Array.isArray(recordWind)) {
    indicator.classList.add("hidden");
    return;
  }
  const windSamples = recordWind.map((wind, index) => ({ wind, index })).filter(({ wind }) => {
    return wind && typeof wind.windSpeed === "number" && Number.isFinite(wind.windSpeed)
      && typeof wind.windDirection === "number" && Number.isFinite(wind.windDirection);
  });
  if (!windSamples.length) {
    indicator.classList.add("hidden");
    return;
  }

  const selectedWind = selectedIndex === null || selectedIndex === undefined
    ? summarizeAnnotatedWind(windSamples.map(({ wind }) => wind))
    : windSamples.reduce((nearest, candidate) => Math.abs(candidate.index - selectedIndex) < Math.abs(nearest.index - selectedIndex) ? candidate : nearest, windSamples[0]).wind;
  if (!selectedWind) {
    indicator.classList.add("hidden");
    return;
  }

  indicator.classList.remove("hidden");
  indicator.querySelector(".map-wind-arrow").style.setProperty("--wind-angle", `${selectedWind.windDirection + 180}deg`);
  indicator.setAttribute("aria-label", `Wind direction ${formatWindDirection(selectedWind.windDirection)}`);
}

function focusBounds(focus) {
  if (!focus) return null;
  const indices = focus.indices?.filter((index) => typeof index === "number" && Number.isFinite(index)) ?? [];
  const startIndex = indices.length ? Math.min(...indices) : focus.startIndex;
  const endIndex = indices.length ? Math.max(...indices) : focus.endIndex;
  return typeof startIndex === "number" && typeof endIndex === "number" ? { startIndex, endIndex } : null;
}

function drawRoute(context, route, color, width, segmentMatches = () => true) {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];
    if (!segmentMatches(start, end)) continue;
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
  }
  context.stroke();
}

function drawFocusedRoute(context, route, focus) {
  const bounds = focusBounds(focus);
  if (!bounds) {
    drawRoute(context, route, "#d77a61", 3);
    return;
  }
  drawRoute(context, route, "#7e8d89", 3, (start, end) => {
    const midpoint = (start.index + end.index) / 2;
    return midpoint >= bounds.startIndex && midpoint <= bounds.endIndex;
  });
  drawRoute(context, route, "#d77a61", 3, (start, end) => (start.index + end.index) / 2 < bounds.startIndex);
  drawRoute(context, route, "#6c9296", 3, (start, end) => (start.index + end.index) / 2 > bounds.endIndex);
  drawRoute(context, route, "#b8d354", 5, (start, end) => {
    const midpoint = (start.index + end.index) / 2;
    return midpoint >= bounds.startIndex && midpoint <= bounds.endIndex;
  });
}

function drawFocusMarker(context, route, focus) {
  if (!focus || typeof focus.centerIndex !== "number" || !route.length) return;
  const marker = route.reduce((nearest, point) => Math.abs(point.index - focus.centerIndex) < Math.abs(nearest.index - focus.centerIndex) ? point : nearest, route[0]);
  context.fillStyle = "rgba(251, 252, 248, .95)";
  context.strokeStyle = "#17252a";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(marker.x, marker.y, 9, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = "#b8d354";
  context.beginPath();
  context.arc(marker.x, marker.y, 5, 0, Math.PI * 2);
  context.fill();
}

function drawMap(canvas, records, options = {}) {
  const wrapper = canvas.parentElement;
  // A canvas is inline by default; block layout prevents its text baseline from
  // growing an auto-sized map wrapper after each linked hover redraw.
  canvas.style.display = "block";
  const width = Math.max(240, Math.floor(wrapper.clientWidth));
  const height = Math.max(210, Math.floor(wrapper.clientHeight));
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  updateWindDirectionIndicator(options.windIndicator, options.recordWind, options.selectedIndex);
  const tileContainer = options.tileContainer ?? mapTiles;
  const points = records.map((record, index) => {
    const position = recordPosition(record);
    return position ? { ...position, index } : null;
  }).filter(Boolean);
  if (points.length < 2) {
    tileContainer.replaceChildren();
    mapLayoutCache.delete(tileContainer);
    return { visible: false, count: points.length, points, nearestIndexForPoint: () => null };
  }

  const bounds = points.reduce((result, point) => ({
    minLatitude: Math.min(result.minLatitude, point.latitude),
    maxLatitude: Math.max(result.maxLatitude, point.latitude),
    minLongitude: Math.min(result.minLongitude, point.longitude),
    maxLongitude: Math.max(result.maxLongitude, point.longitude),
  }), { minLatitude: 90, maxLatitude: -90, minLongitude: 180, maxLongitude: -180 });
  const requestedZoom = mapZoomState.get(tileContainer) ?? null;
  const pan = mapPanState.get(tileContainer) ?? { x: 0, y: 0 };
  const layoutKey = [width, height, points.length, bounds.minLatitude.toFixed(6), bounds.maxLatitude.toFixed(6), bounds.minLongitude.toFixed(6), bounds.maxLongitude.toFixed(6), requestedZoom ?? "auto", pan.x.toFixed(1), pan.y.toFixed(1)].join(":");
  const cachedLayout = mapLayoutCache.get(tileContainer);
  const map = cachedLayout?.key === layoutKey ? cachedLayout.map : loadMapTiles(points, width, height, tileContainer, requestedZoom);
  if (cachedLayout?.key !== layoutKey) mapLayoutCache.set(tileContainer, { key: layoutKey, map });
  const route = downsamplePoints(points).map((point) => ({ ...webMercatorPoint(point, map.zoom), index: point.index }));
  const project = (point) => ({ x: point.x - map.viewportLeft, y: point.y - map.viewportTop, index: point.index });
  const projectedRoute = route.map(project);

  drawRoute(context, projectedRoute, "rgba(255, 255, 255, .9)", 6);
  drawFocusedRoute(context, projectedRoute, options.focus);

  const start = projectedRoute[0];
  const finish = projectedRoute.at(-1);
  context.fillStyle = "#17252a";
  context.beginPath();
  context.arc(start.x, start.y, 5, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#b8d354";
  context.beginPath();
  context.arc(finish.x, finish.y, 5, 0, Math.PI * 2);
  context.fill();

  drawFocusMarker(context, projectedRoute, options.focus);

  const hitPoints = map.projected.map((point, index) => ({ ...project(point), index: points[index].index }));
  const activePoint = options.selectedIndex === null || options.selectedIndex === undefined
    ? null
    : hitPoints.reduce((nearest, point) => Math.abs(point.index - options.selectedIndex) < Math.abs(nearest.index - options.selectedIndex) ? point : nearest, hitPoints[0]);
  if (activePoint) {
    context.fillStyle = "rgba(251, 252, 248, .95)";
    context.strokeStyle = "#17252a";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(activePoint.x, activePoint.y, 8, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = "#d77a61";
    context.beginPath();
    context.arc(activePoint.x, activePoint.y, 4, 0, Math.PI * 2);
    context.fill();
  }

  return {
    visible: true,
    count: points.length,
    points,
    nearestIndexForPoint(pointerX, pointerY) {
      return hitPoints.reduce((nearest, point) => {
        const distance = (point.x - pointerX) ** 2 + (point.y - pointerY) ** 2;
        const nearestDistance = (nearest.x - pointerX) ** 2 + (nearest.y - pointerY) ** 2;
        return distance < nearestDistance ? point : nearest;
      }, hitPoints[0]).index;
    },
  };
}

function sectionColor(index) {
  return SEGMENT_COLORS[index % SEGMENT_COLORS.length];
}

function drawSectionMarker(context, point, label, selected, color) {
  context.fillStyle = "rgba(251, 252, 248, .96)";
  context.strokeStyle = selected ? "#17252a" : color;
  context.lineWidth = selected ? 3 : 2;
  context.beginPath();
  context.arc(point.x, point.y, selected ? 11 : 8, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = selected ? "#17252a" : color;
  context.font = "700 9px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, point.x, point.y + .5);
}

function drawSegmentedMap(canvas, segmentation, options = {}) {
  const wrapper = canvas.parentElement;
  canvas.style.display = "block";
  const width = Math.max(240, Math.floor(wrapper.clientWidth));
  const height = Math.max(260, Math.floor(wrapper.clientHeight));
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const routePoints = segmentation.routeRuns.flat();
  const tileContainer = options.tileContainer ?? segmentsMapTiles;
  if (routePoints.length < 2) {
    tileContainer.replaceChildren();
    mapLayoutCache.delete(tileContainer);
    return { visible: false, count: routePoints.length, nearestSectionForPoint: () => null };
  }

  const bounds = routePoints.reduce((result, point) => ({
    minLatitude: Math.min(result.minLatitude, point.latitude),
    maxLatitude: Math.max(result.maxLatitude, point.latitude),
    minLongitude: Math.min(result.minLongitude, point.longitude),
    maxLongitude: Math.max(result.maxLongitude, point.longitude),
  }), { minLatitude: 90, maxLatitude: -90, minLongitude: 180, maxLongitude: -180 });
  const requestedZoom = mapZoomState.get(tileContainer) ?? null;
  const pan = mapPanState.get(tileContainer) ?? { x: 0, y: 0 };
  const layoutKey = [width, height, routePoints.length, bounds.minLatitude.toFixed(6), bounds.maxLatitude.toFixed(6), bounds.minLongitude.toFixed(6), bounds.maxLongitude.toFixed(6), requestedZoom ?? "auto", pan.x.toFixed(1), pan.y.toFixed(1)].join(":");
  const cachedLayout = mapLayoutCache.get(tileContainer);
  const map = cachedLayout?.key === layoutKey ? cachedLayout.map : loadMapTiles(routePoints, width, height, tileContainer, requestedZoom);
  if (cachedLayout?.key !== layoutKey) mapLayoutCache.set(tileContainer, { key: layoutKey, map });
  const project = (point) => {
    const projected = webMercatorPoint(point, map.zoom);
    return { x: projected.x - map.viewportLeft, y: projected.y - map.viewportTop, index: point.index };
  };
  const projectedRuns = segmentation.routeRuns.map((run) => run.map(project));
  const projectedPoints = projectedRuns.flat();
  const selected = typeof options.selectedIndex === "number" ? segmentation.sections[options.selectedIndex] : null;

  projectedRuns.forEach((run) => drawRoute(context, run, "rgba(255, 255, 255, .9)", 7));
  projectedRuns.forEach((run) => drawRoute(context, run, "#879793", 2.5));
  segmentation.sections.forEach((section, index) => {
    const isSelected = selected ? selected.id === section.id : false;
    const color = isSelected ? "#b8d354" : section.type === "active" && !selected ? sectionColor(index) : "rgba(126, 141, 137, .55)";
    const width = isSelected ? 6 : selected ? 2 : 4;
    projectedRuns.forEach((run) => drawRoute(context, run, color, width, (start, end) => sectionContainsIndex(section, (start.index + end.index) / 2)));
  });

  const sectionMarkers = segmentation.sections.map((section, index) => {
    const points = projectedPoints.filter((point) => sectionContainsIndex(section, point.index));
    if (!points.length) return null;
    return { point: points[Math.floor(points.length / 2)], index };
  }).filter(Boolean);
  sectionMarkers.forEach(({ point, index }) => {
    const section = segmentation.sections[index];
    const color = section.type === "active" ? sectionColor(index) : "#9ba5a3";
    drawSectionMarker(context, point, String(index + 1), selected?.id === section.id, color);
  });

  // Turn points between the legs of the selected section.
  (selected?.legs ?? []).slice(1).forEach((leg) => {
    const point = projectedPoints.find((candidate) => candidate.index >= leg.startIndex);
    if (!point) return;
    context.fillStyle = "#fbfcf8";
    context.strokeStyle = "#17252a";
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });

  const start = projectedPoints[0];
  const finish = projectedPoints.at(-1);
  context.fillStyle = "#17252a";
  context.beginPath();
  context.arc(start.x, start.y, 5, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#b8d354";
  context.beginPath();
  context.arc(finish.x, finish.y, 5, 0, Math.PI * 2);
  context.fill();

  return {
    visible: true,
    count: routePoints.length,
    nearestSectionForPoint(pointerX, pointerY) {
      const nearest = projectedPoints.reduce((candidate, point) => {
        const distance = (point.x - pointerX) ** 2 + (point.y - pointerY) ** 2;
        const candidateDistance = (candidate.x - pointerX) ** 2 + (candidate.y - pointerY) ** 2;
        return distance < candidateDistance ? point : candidate;
      }, projectedPoints[0]);
      const section = segmentation.sections.find((item) => sectionContainsIndex(item, nearest.index));
      return section ? section.id : null;
    },
  };
}

function mapContainerForTarget(target) {
  if (target === "analysis") return analysisMapTiles;
  if (target === "segments") return segmentsMapTiles;
  if (target === "track-water") return trackWaterMapTiles;
  if (target === "coaching") return coachingMapTiles;
  return mapTiles;
}

function changeMapZoom(target, delta) {
  const tileContainer = mapContainerForTarget(target);
  const cachedLayout = mapLayoutCache.get(tileContainer);
  const minZoom = cachedLayout?.map?.fitZoom ?? 3;
  const maxZoom = cachedLayout?.map?.maxZoom ?? 19;
  const currentZoom = clamp(mapZoomState.get(tileContainer) ?? cachedLayout?.map?.zoom ?? minZoom, minZoom, maxZoom);
  const nextZoom = clamp(currentZoom + delta, minZoom, maxZoom);
  const currentPan = mapPanState.get(tileContainer);
  if (currentPan && nextZoom !== currentZoom) {
    const scale = 2 ** (nextZoom - currentZoom);
    mapPanState.set(tileContainer, { x: currentPan.x * scale, y: currentPan.y * scale });
  }
  mapZoomState.set(tileContainer, nextZoom);
  mapLayoutCache.delete(tileContainer);
  scheduleVisualRender();
}

function fitMapToTrack(target) {
  const tileContainer = mapContainerForTarget(target);
  if (target === "analysis") {
    analysisMapFocus = null;
    updateCoachingFocusUI();
  }
  mapZoomState.delete(tileContainer);
  mapPanState.delete(tileContainer);
  mapLayoutCache.delete(tileContainer);
  scheduleVisualRender();
}

function panMap(tileContainer, deltaX, deltaY) {
  const current = mapPanState.get(tileContainer) ?? { x: 0, y: 0 };
  mapPanState.set(tileContainer, { x: current.x + deltaX, y: current.y + deltaY });
  mapLayoutCache.delete(tileContainer);
  scheduleVisualRender();
}

function focusAnalysisMap(focusKey) {
  const summary = currentActivity;
  const focus = summary?.windCoachingFocus?.[focusKey];
  if (!focus) return;
  if (analysisMapFocus?.key === focusKey) {
    analysisMapFocus = null;
    updateCoachingFocusUI();
    scheduleVisualRender();
    return;
  }

  const points = summary.records.map((record, index) => {
    const position = recordPosition(record);
    return position ? { ...position, index } : null;
  }).filter(Boolean);
  const candidates = focus.indices
    ? points.filter((point) => focus.indices.includes(point.index))
    : points.filter((point) => point.index >= focus.startIndex && point.index <= focus.endIndex);
  if (!candidates.length) return;

  const target = candidates[Math.floor(candidates.length / 2)];
  analysisMapFocus = { ...focus, key: focusKey, centerIndex: target.index };
  updateCoachingFocusUI();
  scheduleVisualRender();
}

function updateCoachingFocusUI() {
  document.querySelectorAll("[data-map-focus]").forEach((tile) => {
    tile.classList.toggle("is-map-focused", tile.dataset.mapFocus === analysisMapFocus?.key);
    // Only tiles that have something to show on the map behave like buttons.
    const actionable = Boolean(currentActivity?.windCoachingFocus?.[tile.dataset.mapFocus]);
    tile.classList.toggle("is-actionable", actionable);
    if (actionable) {
      tile.setAttribute("role", "button");
      tile.tabIndex = 0;
    } else {
      tile.removeAttribute("role");
      tile.removeAttribute("tabindex");
    }
  });
}

function pendingWindAnnotation() {
  return {
    status: "loading",
    coverage: { timestampCount: 0, coveredRecordCount: 0, ratio: 0, complete: false },
  };
}

function windStatusText(wind) {
  if (wind?.isDemo) return "Synthetic demo wind";
  if (wind?.status === "loading") return "Checking local FIT data";
  if (wind?.status === "ready" && wind.source === "open-meteo") return "Modelled sea-grid wind";
  if (wind?.status === "ready") return "Saved FIT weather";
  if (wind?.status === "partial") return "Partial wind coverage";
  return "Wind data unavailable";
}

function windMessage(wind) {
  if (wind?.isDemo) return "Synthetic El Gouna weather for documentation only. It does not come from a FIT file or a weather service.";
  if (wind?.status === "loading") return "Checking saved FIT weather before requesting a modelled annotation.";
  if (!wind?.samples?.length) return wind?.error || "No recorded wind data is available for this session.";
  const coverage = wind.coverage;
  const coverageText = `${number(coverage.coveredRecordCount)} of ${number(coverage.timestampCount)} timestamped FIT records`;
  if (wind.source === "open-meteo") {
    return `${wind.sourceLabel}. Hourly modelled wind was matched locally to ${coverageText}; the FIT file and full track stayed in your browser.`;
  }
  if (!coverage.complete) return `${wind.sourceLabel}. ${coverageText} have usable saved wind data.${wind.error ? ` ${wind.error}` : ""}`;
  return `${wind.sourceLabel}. ${coverageText} are covered by wind samples already stored in this FIT file.`;
}

function resetWindCoaching() {
  setText("#analysisBestVmg", "—");
  setText("#analysisBestVmgDetail", "Needs complete GPS and wind coverage");
  setText("#analysisTackAngle", "—");
  setText("#analysisTackAngleDetail", "Needs a stable upwind leg");
  setText("#analysisTurnDrift", "—");
  setText("#analysisTurnDriftDetail", "Needs a detected turn");
  setText("#analysisLegComparison", "—");
  setText("#analysisLegComparisonDetail", "Needs two valid upwind legs");
}

function renderWindCoaching(summary) {
  const wind = summary.wind;
  if (!wind?.coverage?.complete || !wind.recordWind?.length) {
    summary.windCoaching = null;
    summary.windCoachingFocus = null;
    resetWindCoaching();
    updateCoachingFocusUI();
    return;
  }
  const coaching = calculateWindCoaching(summary.records, wind.recordWind);
  summary.windCoaching = coaching;
  const bestLeg = coaching.bestLeg;
  const bestLegFocus = bestLeg && bestLeg.startIndex !== null && bestLeg.endIndex !== null
    ? { startIndex: bestLeg.startIndex, endIndex: bestLeg.endIndex }
    : null;
  summary.windCoachingFocus = {
    bestVmg: bestLegFocus,
    tackAngle: bestLegFocus,
    legComparison: bestLegFocus,
    turn: coaching.turnIndices?.length ? { indices: coaching.turnIndices } : null,
  };
  updateCoachingFocusUI();
  setText("#analysisBestVmg", bestLeg ? formatSpeed(bestLeg.vmg) : "—");
  setText("#analysisBestVmgDetail", bestLeg ? `${formatDuration(bestLeg.duration)} over ${formatDistance(bestLeg.distance)}` : "No stable upwind leg found");
  setText("#analysisTackAngle", bestLeg ? `${number(bestLeg.tackAngle, 0)} deg` : "—");
  setText("#analysisTackAngleDetail", bestLeg ? `${formatSpeed(bestLeg.speed)} average board speed` : "No stable upwind leg found");
  setText("#analysisTurnDrift", coaching.averageDownwindTurnDisplacement === null ? "—" : `${number(coaching.averageDownwindTurnDisplacement, 1)} m`);
  setText("#analysisTurnDriftDetail", coaching.turnCount ? `Average across ${number(coaching.turnCount)} detected turns` : "No stable turns found");
  setText("#analysisLegComparison", coaching.bestLegVmgGain === null ? "—" : `+${formatSpeed(coaching.bestLegVmgGain)}`);
  setText("#analysisLegComparisonDetail", coaching.bestLegVmgGain === null
    ? coaching.validLegCount ? "Only one valid upwind leg" : "No stable upwind legs found"
    : `Above the median of ${number(coaching.validLegCount)} valid legs`);
}

function renderWindPanels(summary) {
  const wind = summary.wind ?? pendingWindAnnotation();
  const conditions = wind.recordWind ? summarizeAnnotatedWind(wind.recordWind) : null;
  const coverage = wind.coverage ?? { timestampCount: 0, coveredRecordCount: 0, ratio: 0 };
  const coverageText = coverage.timestampCount ? `${number(coverage.ratio * 100, 0)}%` : "—";
  const status = windStatusText(wind);
  const message = windMessage(wind);
  setText("#analysisWindStatus", status);
  setText("#analysisWindSpeed", conditions ? formatWindSpeed(conditions.windSpeed) : "—");
  setText("#analysisWindDirection", conditions ? formatWindDirection(conditions.windDirection) : "—");
  setText("#analysisWindGusts", conditions ? formatWindSpeed(conditions.windGusts) : "—");
  setText("#analysisWindCoverage", coverageText);
  setText("#analysisWindMessage", message);
  setText("#detailWindSpeed", conditions ? formatWindSpeed(conditions.windSpeed) : "not recorded");
  renderWindCoaching(summary);
}

function renderCharts(summary) {
  const speedValues = summary.records.map((record, index) => recordSpeed(record, summary.records[index - 1]));
  const heartValues = summary.records.map((record) => getField(record, "heart_rate"));
  const speedVisible = drawChart(speedCanvas, speedValues, { min: 0, line: "#b8d354", fillTop: "rgba(184, 211, 84, .30)", axisLabel: (value) => number(value * 3.6, 0) });
  const heartVisible = drawChart(heartCanvas, heartValues, { line: "#d77a61", fillTop: "rgba(215, 122, 97, .27)", fillBottom: "rgba(215, 122, 97, .02)", axisLabel: (value) => number(value, 0) });
  const map = drawMap(mapCanvas, summary.records, { recordWind: summary.wind?.recordWind, windIndicator: mapWindIndicator });
  $("#speedEmpty").classList.toggle("hidden", speedVisible);
  $("#heartEmpty").classList.toggle("hidden", heartVisible);
  $("#mapEmpty").classList.toggle("hidden", map.visible);
  setText("#speedStart", summary.records.length ? formatDuration(0) : "start");
  setText("#speedEnd", summary.duration ? formatDuration(summary.duration) : "finish");
  setText("#heartMin", summary.minHeartRate === null ? "min —" : `min ${number(summary.minHeartRate)} bpm`);
  setText("#heartMax", summary.maxHeartRate === null ? "max —" : `max ${number(summary.maxHeartRate)} bpm`);
  setText("#mapAccuracy", summary.gpsAccuracy === null ? "" : `avg GPS ±${number(summary.gpsAccuracy, 1)} m`);
  setText("#mapPointCount", `${number(map.count)} points`);
}

function valueAtNearestPoint(renderState, targetIndex) {
  if (!renderState?.points.length) return null;
  return nearestSeriesPoint(renderState.points, targetIndex);
}

function renderAnalysisReadout(summary) {
  const selectedRecord = analysisSelectionIndex === null ? null : summary.records[analysisSelectionIndex];
  if (!selectedRecord) {
    setText("#analysisPointTimestamp", "—");
    setText("#analysisPointTime", "—");
    setText("#analysisPointSpeed", "—");
    setText("#analysisPointHeart", "—");
    setText("#analysisPointDistance", "—");
    return;
  }

  const selectedTimestamp = getField(selectedRecord, "timestamp");
  const elapsed = typeof selectedTimestamp === "number" && typeof summary.starts === "number" ? Math.max(0, selectedTimestamp - summary.starts) : null;
  const speedPoint = valueAtNearestPoint(analysisRenderState.speed, analysisSelectionIndex);
  const heartPoint = valueAtNearestPoint(analysisRenderState.heart, analysisSelectionIndex);
  setText("#analysisPointTimestamp", formatTime(selectedTimestamp));
  setText("#analysisPointTime", elapsed === null ? "—" : formatDuration(elapsed));
  setText("#analysisPointSpeed", speedPoint ? formatSpeed(speedPoint.value) : "—");
  setText("#analysisPointHeart", heartPoint ? `${number(heartPoint.value)} bpm` : "—");
  setText("#analysisPointDistance", formatDistance(getField(selectedRecord, "distance")));
}

function renderAnalysis(summary) {
  const records = summary.records;
  const speed = drawLinkedChart(analysisSpeedCanvas, records, (record, index) => recordSpeed(record, records[index - 1]), {
    min: 0,
    line: "#b8d354",
    fillTop: "rgba(184, 211, 84, .30)",
    axisLabel: (value) => number(value * 3.6, 0),
  }, analysisSelectionIndex);
  const heart = drawLinkedChart(analysisHeartCanvas, records, (record) => getField(record, "heart_rate"), {
    line: "#d77a61",
    fillTop: "rgba(215, 122, 97, .27)",
    fillBottom: "rgba(215, 122, 97, .02)",
    axisLabel: (value) => number(value, 0),
  }, analysisSelectionIndex);
  const wind = drawLinkedChart(analysisWindCanvas, records, (_, index) => summary.wind?.recordWind?.[index]?.windDirection, {
    minHeight: 0,
    line: "#17252a",
    fillTop: "rgba(23, 37, 42, .18)",
    fillBottom: "rgba(23, 37, 42, .02)",
    axisLabel: (value) => `${number(value, 0)} deg`,
  }, analysisSelectionIndex);
  const map = drawMap(analysisMapCanvas, records, {
    tileContainer: analysisMapTiles,
    selectedIndex: analysisSelectionIndex,
    recordWind: summary.wind?.recordWind,
    windIndicator: analysisMapWindIndicator,
    focus: analysisMapFocus,
  });
  analysisRenderState = { speed, heart, wind, map };

  $("#analysisSpeedEmpty").classList.toggle("hidden", speed.visible);
  $("#analysisHeartEmpty").classList.toggle("hidden", heart.visible);
  $("#analysisWindEmpty").classList.toggle("hidden", wind.visible);
  $("#analysisMapEmpty").classList.toggle("hidden", map.visible);
  setText("#analysisSpeedEnd", summary.duration ? formatDuration(summary.duration) : "finish");
  setText("#analysisHeartMin", summary.minHeartRate === null ? "min —" : `min ${number(summary.minHeartRate)} bpm`);
  setText("#analysisHeartMax", summary.maxHeartRate === null ? "max —" : `max ${number(summary.maxHeartRate)} bpm`);
  setText("#analysisMapAccuracy", summary.gpsAccuracy === null ? "" : `avg GPS ±${number(summary.gpsAccuracy, 1)} m`);
  setText("#analysisMapPointCount", `${number(map.count)} points`);
  setText("#analysisActivityTitle", sessionTitle(summary));
  setText("#analysisActivityDate", formatDate(summary.starts));
  renderAnalysisReadout(summary);
}

function renderSegmentList(segmentation) {
  segmentsList.replaceChildren();
  if (!segmentation.sections.length) {
    const empty = document.createElement("p");
    empty.className = "segment-card-empty";
    empty.textContent = "No sections were detected in this session.";
    segmentsList.append(empty);
    return;
  }
  segmentation.sections.forEach((section, index) => {
    const card = document.createElement("button");
    card.className = `segment-card${section.type === "inactive" ? " is-inactive" : ""}${selectedSegmentIndex === index ? " is-selected" : ""}`;
    card.type = "button";
    card.dataset.segmentIndex = String(index);
    card.setAttribute("aria-pressed", selectedSegmentIndex === index ? "true" : "false");
    card.style.setProperty("--segment-color", section.type === "active" ? sectionColor(index) : "#9ba5a3");

    const color = document.createElement("i");
    color.className = "segment-card-color";
    color.setAttribute("aria-hidden", "true");
    const body = document.createElement("span");
    const title = document.createElement("strong");
    title.className = "segment-card-title";
    title.textContent = section.label;
    const meta = document.createElement("small");
    meta.className = "segment-card-meta";
    meta.textContent = `${formatTime(section.startTimestamp)} · ${formatDuration(section.duration)} · ${formatDistance(section.distance)}`;
    body.append(title, meta);
    if (section.legs.length) {
      const legs = document.createElement("small");
      legs.className = "segment-card-meta";
      legs.textContent = `${number(section.legs.length)} ${section.legs.length === 1 ? "leg" : "legs"} · median ${formatDuration(section.medianLegDuration)}`;
      body.append(legs);
    }
    if (section.averageHeartRate !== null) {
      const heart = document.createElement("small");
      heart.className = "segment-card-heart";
      const trend = section.heartRateTrend === null ? "" : ` · trend ${section.heartRateTrend >= 0 ? "+" : "-"}${number(Math.abs(section.heartRateTrend), 0)} bpm`;
      heart.textContent = `HR ${number(section.averageHeartRate, 0)} bpm${trend}`;
      body.append(heart);
    }
    const speed = document.createElement("strong");
    speed.className = "segment-card-speed";
    speed.textContent = formatSpeed(section.averageSpeed);
    card.append(color, body, speed);
    segmentsList.append(card);
  });
}

function renderRideSegments(summary) {
  const segmentation = summary.segmentation;
  renderSegmentList(segmentation);
  const map = drawSegmentedMap(segmentsMapCanvas, segmentation, {
    tileContainer: segmentsMapTiles,
    selectedIndex: selectedSegmentIndex,
  });
  segmentRenderState = { map };
  const averageSpeed = segmentation.averageActiveSpeed;
  setText("#segmentsCount", number(segmentation.activeSections.length));
  setText("#segmentsActiveTime", formatDuration(segmentation.activeDuration));
  setText("#segmentsAverageSpeed", formatSpeed(averageSpeed));
  setText("#segmentsDistance", formatDistance(segmentation.activeDistance));
  setText("#segmentsSummaryCopy", `The track is split into speed-defined sections for comparing active riding, inactive periods, distance, and heart-rate response. An active section is at least ${number(segmentation.options.minimumActiveSeconds)} seconds where the ${number(segmentation.options.smoothingSeconds)}-second median speed stays above ${formatSpeed(segmentation.options.activeSpeedMps)}, with stops shorter than ${number(segmentation.options.mergeGapSeconds)} seconds bridged. Active sections are divided into legs at turns; ${number(segmentation.legCount)} ${segmentation.legCount === 1 ? "leg was" : "legs were"} found. The complete timeline is shown below.`);
  setText("#segmentsListMeta", `${number(segmentation.sections.length)} detected`);
  setText("#segmentsMapAccuracy", summary.gpsAccuracy === null ? "" : `avg GPS ±${number(summary.gpsAccuracy, 1)} m`);
  setText("#segmentsMapPointCount", `${number(map.count)} points`);
  setText("#segmentsActivityTitle", sessionTitle(summary));
  setText("#segmentsActivityDate", formatDate(summary.starts));
  $("#segmentsMapEmpty").classList.toggle("hidden", map.visible);
}

function setAnalysisSelection(index) {
  if (analysisSelectionIndex === index) return;
  analysisSelectionIndex = index;
  scheduleVisualRender();
}

function clearAnalysisSelection() {
  if (analysisSelectionIndex === null) return;
  analysisSelectionIndex = null;
  scheduleVisualRender();
}

function bindMapPanning(canvas, tileContainer) {
  canvas.addEventListener("pointerdown", (event) => {
    if (!currentActivity || !mapLayoutCache.get(tileContainer)?.map) return;
    mapPointerState.set(canvas, {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      dragging: false,
    });
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    const state = mapPointerState.get(canvas);
    if (!state || state.pointerId !== event.pointerId) return;
    const totalX = event.clientX - state.startX;
    const totalY = event.clientY - state.startY;
    if (!state.dragging && Math.hypot(totalX, totalY) < 3) return;
    state.dragging = true;
    panMap(tileContainer, event.clientX - state.lastX, event.clientY - state.lastY);
    state.lastX = event.clientX;
    state.lastY = event.clientY;
  });
  const endDrag = (event) => {
    const state = mapPointerState.get(canvas);
    if (!state || state.pointerId !== event.pointerId) return;
    mapPointerState.delete(canvas);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
}

function canvasPointerPosition(canvas, event) {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function bindAnalysisInteractions() {
  const bindChart = (canvas, key) => {
    canvas.addEventListener("pointermove", (event) => {
      const renderState = analysisRenderState[key];
      if (!renderState?.visible) return;
      const { x } = canvasPointerPosition(canvas, event);
      setAnalysisSelection(renderState.nearestIndexForX(x));
    });
    canvas.addEventListener("pointerleave", clearAnalysisSelection);
  };
  bindChart(analysisSpeedCanvas, "speed");
  bindChart(analysisHeartCanvas, "heart");
  bindChart(analysisWindCanvas, "wind");
  analysisMapCanvas.addEventListener("pointermove", (event) => {
    const renderState = analysisRenderState.map;
    if (mapPointerState.get(analysisMapCanvas)?.dragging) return;
    if (!renderState?.visible) return;
    const position = canvasPointerPosition(analysisMapCanvas, event);
    setAnalysisSelection(renderState.nearestIndexForPoint(position.x, position.y));
  });
  analysisMapCanvas.addEventListener("pointerleave", clearAnalysisSelection);
}

function bindSegmentInteractions() {
  segmentsList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-segment-index]");
    if (!card || !currentActivity) return;
    const segmentIndex = Number(card.dataset.segmentIndex);
    selectedSegmentIndex = selectedSegmentIndex === segmentIndex ? null : segmentIndex;
    scheduleVisualRender();
  });
}

const COACHING_SIDE_COLORS = ["#2a78d6", "#eb6834"];
const COACHING_NEUTRAL_COLOR = "#898781";
const COACHING_STOPPED_COLOR = "#d03b3b";
const COACHING_MAP_CONTEXT_SECONDS = 25;
const COACHING_TONE_LABELS = { focus: "Work on", strength: "Going well", note: "Worth knowing" };

function coachingFor(summary) {
  const recordWind = summary.wind?.recordWind?.some(Boolean) ? summary.wind.recordWind : null;
  if (!summary.coaching || summary.coachingWind !== recordWind) {
    summary.coaching = analyzeCoaching(summary.segmentation, { recordWind });
    summary.coachingWind = recordWind;
  }
  return summary.coaching;
}

function element(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function statTile(label, value, detail) {
  const tile = element("div", "segments-stat");
  tile.append(element("span", "", label), element("strong", "", value), element("small", "", detail));
  return tile;
}

function formatShare(share) {
  return typeof share === "number" && Number.isFinite(share) ? `${number(share * 100, 0)}%` : "—";
}

function formatSeconds(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  return seconds < 90 ? `${number(seconds, 0)} s` : formatDuration(seconds);
}

function formatSignedDistance(metres) {
  if (typeof metres !== "number" || !Number.isFinite(metres)) return "—";
  if (Math.abs(metres) < 0.5) return "0 m";
  return `${metres >= 0 ? "+" : "−"}${formatDistance(Math.abs(metres))}`;
}

function sideSwatch(sideKey) {
  return element("i", `coaching-swatch${sideKey === 0 || sideKey === 1 ? ` is-side-${sideKey}` : ""}`);
}

function sideLabel(coaching, sideKey) {
  return coaching.sides[sideKey]?.label ?? "another direction";
}

function renderCoachingTakeaways(coaching) {
  const cards = coaching.takeaways.map((takeaway) => {
    const card = element("article", `coaching-takeaway is-${takeaway.tone}`);
    card.append(element("span", "coaching-takeaway-tone", COACHING_TONE_LABELS[takeaway.tone]), element("strong", "", takeaway.title), element("p", "", takeaway.text));
    return card;
  });
  $("#coachingTakeaways").replaceChildren(...(cards.length ? cards : [element("p", "coaching-takeaway-empty", "Not enough turns or riding time in this session to draw conclusions.")]));
}

function drawTurnChart(coaching) {
  const wrapper = coachingTurnCanvas.parentElement;
  const width = Math.max(240, Math.floor(wrapper.clientWidth));
  const height = Math.max(200, Math.floor(wrapper.clientHeight));
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  coachingTurnCanvas.width = width * ratio;
  coachingTurnCanvas.height = height * ratio;
  const context = coachingTurnCanvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const padding = { top: 12, right: 14, bottom: 48, left: 44 };
  const plotBottom = height - padding.bottom;
  const stopLane = plotBottom + 17;
  const duration = Math.max(coaching.sessionEnd - coaching.sessionStart, 1);
  const x = (timestamp) => padding.left + ((timestamp - coaching.sessionStart) / duration) * (width - padding.left - padding.right);
  const y = (share) => plotBottom - share * (plotBottom - padding.top);

  // Time not spent riding: before the first ride, long breaks, and after the last ride.
  context.fillStyle = "rgba(23, 37, 42, .06)";
  const idle = [
    [coaching.sessionStart, coaching.waterStart],
    ...coaching.stops.filter((stop) => stop.kind === "break").map((stop) => [stop.startTimestamp, stop.endTimestamp]),
    [coaching.waterEnd, coaching.sessionEnd],
  ];
  idle.forEach(([from, to]) => context.fillRect(x(from), padding.top, Math.max(0, x(to) - x(from)), stopLane + 9 - padding.top));

  context.strokeStyle = "rgba(55, 77, 80, 0.16)";
  context.lineWidth = 1;
  context.fillStyle = "#9ba5a3";
  context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "right";
  context.textBaseline = "middle";
  [0, 0.25, 0.5, 0.75, 1].forEach((share) => {
    context.fillText(`${share * 100}%`, padding.left - 8, y(share));
    context.beginPath();
    context.moveTo(padding.left, y(share));
    context.lineTo(width - padding.right, y(share));
    context.stroke();
  });
  context.fillText("stop", padding.left - 8, stopLane);
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  const tickStep = [300, 600, 900, 1200, 1800, 3600].find((step) => duration / step <= 7) ?? 7200;
  for (let elapsed = 0; elapsed <= duration; elapsed += tickStep) {
    const label = `${Math.floor(elapsed / 3600)}:${String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0")}`;
    context.textAlign = elapsed === 0 ? "left" : "center";
    context.fillText(label, x(coaching.sessionStart + elapsed), height - 8);
  }

  const marks = coaching.turns.map((turn) => ({ turn, x: x(turn.timestamp), y: turn.outcome === "made" ? y(turn.speedKept) : stopLane }));
  const drawMark = (mark, hovered) => {
    if (mark.turn.outcome === "made") {
      context.fillStyle = "#fbfcf8";
      context.beginPath();
      context.arc(mark.x, mark.y, 6, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = COACHING_SIDE_COLORS[mark.turn.toSide] ?? COACHING_NEUTRAL_COLOR;
      context.beginPath();
      context.arc(mark.x, mark.y, 4, 0, Math.PI * 2);
      context.fill();
    } else {
      const cross = (color, lineWidth, size) => {
        context.strokeStyle = color;
        context.lineWidth = lineWidth;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(mark.x - size, mark.y - size);
        context.lineTo(mark.x + size, mark.y + size);
        context.moveTo(mark.x + size, mark.y - size);
        context.lineTo(mark.x - size, mark.y + size);
        context.stroke();
      };
      cross("#fbfcf8", 5.5, 4.5);
      cross(COACHING_STOPPED_COLOR, 2, 4);
    }
    if (hovered) {
      context.strokeStyle = "#17252a";
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(mark.x, mark.y, 9, 0, Math.PI * 2);
      context.stroke();
    }
  };
  marks.forEach((mark) => drawMark(mark, false));
  const hovered = marks.find((mark) => mark.turn === coachingRenderState.hoveredTurn);
  if (hovered) drawMark(hovered, true);
  coachingRenderState.marks = marks;
  coachingRenderState.coaching = coaching;
}

// The GPS track as one list of points, each tagged with the run it belongs to so gaps are not bridged.
function coachingTrackPoints(segmentation) {
  segmentation.flatRoute ??= segmentation.routeRuns.flatMap((run, runIndex) => run.map((point) => ({ ...point, run: runIndex })));
  return segmentation.flatRoute;
}

// Every turn of the chart at the place it happened, so a detected turn can be checked against the track.
function drawCoachingMap(coaching) {
  const canvas = coachingMapCanvas;
  const wrapper = canvas.parentElement;
  canvas.style.display = "block";
  const width = Math.max(240, Math.floor(wrapper.clientWidth));
  const height = Math.max(220, Math.floor(wrapper.clientHeight));
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const points = coachingTrackPoints(currentActivity.segmentation);
  const tileContainer = coachingMapTiles;
  $("#coachingMapEmpty").classList.toggle("hidden", points.length >= 2);
  if (points.length < 2) {
    tileContainer.replaceChildren();
    mapLayoutCache.delete(tileContainer);
    coachingRenderState.mapMarks = [];
    return;
  }
  const bounds = points.reduce((result, point) => ({
    minLatitude: Math.min(result.minLatitude, point.latitude),
    maxLatitude: Math.max(result.maxLatitude, point.latitude),
    minLongitude: Math.min(result.minLongitude, point.longitude),
    maxLongitude: Math.max(result.maxLongitude, point.longitude),
  }), { minLatitude: 90, maxLatitude: -90, minLongitude: 180, maxLongitude: -180 });
  const requestedZoom = mapZoomState.get(tileContainer) ?? null;
  const pan = mapPanState.get(tileContainer) ?? { x: 0, y: 0 };
  const layoutKey = [width, height, points.length, bounds.minLatitude.toFixed(6), bounds.maxLatitude.toFixed(6), bounds.minLongitude.toFixed(6), bounds.maxLongitude.toFixed(6), requestedZoom ?? "auto", pan.x.toFixed(1), pan.y.toFixed(1)].join(":");
  const cachedLayout = mapLayoutCache.get(tileContainer);
  const map = cachedLayout?.key === layoutKey ? cachedLayout.map : loadMapTiles(points, width, height, tileContainer, requestedZoom);
  if (cachedLayout?.key !== layoutKey) mapLayoutCache.set(tileContainer, { key: layoutKey, map });
  const project = (point) => {
    const projected = webMercatorPoint(point, map.zoom);
    return { x: projected.x - map.viewportLeft, y: projected.y - map.viewportTop };
  };
  const projected = points.map(project);

  strokeTrack(context, points, projected, () => true, "rgba(255, 255, 255, .9)", 5);
  strokeTrack(context, points, projected, () => true, "#879793", 1.75);

  const hovered = coachingRenderState.hoveredTurn;
  const marks = coaching.turns.filter((turn) => turn.position).map((turn) => ({ turn, ...project(turn.position) }));
  const drawMark = (mark) => {
    if (mark.turn.outcome === "made") drawDot(context, mark, 4, COACHING_SIDE_COLORS[mark.turn.toSide] ?? COACHING_NEUTRAL_COLOR);
    else drawCross(context, mark.x, mark.y, false);
  };
  marks.forEach(drawMark);
  // The stretch ridden into and out of the hovered turn, drawn dark so its shape can be judged.
  if (hovered) {
    const from = hovered.timestamp - COACHING_MAP_CONTEXT_SECONDS;
    const to = hovered.timestamp + (hovered.restartSeconds ?? 0) + COACHING_MAP_CONTEXT_SECONDS;
    strokeTrack(context, points, projected, (point) => point.timestamp >= from && point.timestamp <= to, "#fbfcf8", 7);
    strokeTrack(context, points, projected, (point) => point.timestamp >= from && point.timestamp <= to, "#17252a", 3.5);
  }

  const hoveredMark = marks.find((mark) => mark.turn === hovered);
  if (hoveredMark) {
    drawMark(hoveredMark);
    context.strokeStyle = "#17252a";
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(hoveredMark.x, hoveredMark.y, 10, 0, Math.PI * 2);
    context.stroke();
  }
  coachingRenderState.mapMarks = marks;
}

function setHoveredTurn(turn) {
  if (turn === coachingRenderState.hoveredTurn) return;
  coachingRenderState.hoveredTurn = turn;
  const { coaching } = coachingRenderState;
  if (!coaching) return;
  drawTurnChart(coaching);
  drawCoachingMap(coaching);
  showTurnTooltip(turn ? coachingRenderState.marks.find((mark) => mark.turn === turn) : null);
}

function showTurnTooltip(mark) {
  const tooltip = $("#coachingTurnTooltip");
  if (!mark) {
    tooltip.classList.add("hidden");
    return;
  }
  const { coaching } = coachingRenderState;
  const { turn } = mark;
  const line = (text) => element("span", "", text);
  const onto = element("span");
  onto.append(sideSwatch(turn.toSide), document.createTextNode(`onto ${sideLabel(coaching, turn.toSide)} legs`));
  const lines = turn.outcome === "made"
    ? [
      element("strong", "", `${formatShare(turn.speedKept)} speed kept`),
      line(`${formatTime(turn.timestamp)} · ${formatDuration(turn.timestamp - coaching.sessionStart)} in`),
      onto,
      line(`In at ${formatSpeed(turn.entrySpeed)}, slowest ${formatSpeed(turn.slowestSpeed)}`),
      line(turn.recoverySeconds === null ? "Not back to speed before the next turn" : `Back to speed in ${formatSeconds(turn.recoverySeconds)}`),
    ]
    : [
      element("strong", "", "Ended in a stop"),
      line(`${formatTime(turn.timestamp)} · ${formatDuration(turn.timestamp - coaching.sessionStart)} in`),
      onto,
      line(`Riding again after ${formatSeconds(turn.restartSeconds)}`),
    ];
  tooltip.replaceChildren(...lines);
  tooltip.classList.remove("hidden");
  const wrapper = coachingTurnCanvas.parentElement;
  const left = clamp(mark.x + 14, 0, Math.max(0, wrapper.clientWidth - tooltip.offsetWidth));
  const above = mark.y - tooltip.offsetHeight - 12;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${above >= 0 ? above : Math.min(mark.y + 14, Math.max(0, wrapper.clientHeight - tooltip.offsetHeight))}px`;
}

function renderCoachingTurns(coaching) {
  const summary = coaching.turnSummary;
  setText("#coachingTurnCopy", `A turn is the change of direction between two legs. Speed kept compares the slowest moment of the turn with your speed going into it, and a turn that ends in a stop counts as not made. ${number(summary.attempted)} ${summary.attempted === 1 ? "turn was" : "turns were"} found.`);
  $("#coachingTurnStats").replaceChildren(
    statTile("Turns made", summary.attempted ? `${number(summary.made)} of ${number(summary.attempted)}` : "—", `${number(summary.stopped)} ended in a stop`),
    statTile("Success rate", formatShare(summary.successRate), "ridden through without stopping"),
    statTile("Speed kept", formatShare(summary.medianSpeedKept), summary.medianSpeedLost === null ? "median of the turns made" : `median, losing ${formatSpeed(summary.medianSpeedLost)}`),
    statTile("Back to speed", formatSeconds(summary.medianRecoverySeconds), `median time to ${formatShare(coaching.options.recoveryShare)} of entry speed`),
  );

  const legendEntry = (swatch, text) => {
    const entry = element("span");
    entry.append(swatch, document.createTextNode(text));
    return entry;
  };
  const legend = coaching.sides.map((side) => legendEntry(sideSwatch(side.key), `turn onto ${side.label} legs`));
  if (coaching.turns.some((turn) => turn.outcome === "made" && turn.toSide === null)) legend.push(legendEntry(sideSwatch(null), "turn onto another direction"));
  legend.push(legendEntry(element("i", "coaching-swatch is-stopped"), "turn ended in a stop"), legendEntry(element("i", "coaching-swatch is-break"), "not riding"));
  $("#coachingTurnLegend").replaceChildren(...legend);

  $("#coachingTurnEmpty").classList.toggle("hidden", coaching.turns.length > 0);
  if (!coaching.turns.includes(coachingRenderState.hoveredTurn)) {
    coachingRenderState.hoveredTurn = null;
    showTurnTooltip(null);
  }
  drawTurnChart(coaching);
  drawCoachingMap(coaching);
  const placed = coaching.turns.filter((turn) => turn.position).length;
  setText("#coachingMapNote", `Hover a turn in the chart or on the map to find it in the other. The dark line is the ${number(COACHING_MAP_CONTEXT_SECONDS)} seconds before and after it.${placed < coaching.turns.length ? ` ${number(coaching.turns.length - placed)} of ${number(coaching.turns.length)} turns have no GPS fix nearby and are missing from the map.` : ""}`);

  const cell = (text, className = "") => element("td", className, text);
  $("#coachingTurnTableBody").replaceChildren(...coaching.turns.map((turn) => {
    const row = element("tr");
    const time = cell(formatTime(turn.timestamp));
    time.append(element("small", "", `${formatDuration(turn.timestamp - coaching.sessionStart)} in`));
    const onto = element("td");
    onto.append(sideSwatch(turn.toSide), document.createTextNode(sideLabel(coaching, turn.toSide)));
    const made = turn.outcome === "made";
    row.append(
      time,
      onto,
      cell(made ? "Made" : "Ended in a stop"),
      cell(made ? formatSpeed(turn.entrySpeed) : "—", "is-number"),
      cell(made ? formatSpeed(turn.slowestSpeed) : "—", "is-number"),
      cell(made ? formatShare(turn.speedKept) : "—", "is-number"),
      cell(made ? (turn.recoverySeconds === null ? "not before next turn" : formatSeconds(turn.recoverySeconds)) : `riding after ${formatSeconds(turn.restartSeconds)}`, "is-number"),
    );
    return row;
  }));
}

function renderCoachingSides(coaching) {
  const table = $("#coachingSideTable");
  const sides = coaching.sideBalance;
  if (sides.length < 2 || sides.some((side) => !side.legCount)) {
    const row = element("tr");
    row.append(element("td", "is-muted", "Not enough legs in two directions to compare."));
    table.replaceChildren(row);
    return;
  }
  const head = element("tr");
  head.append(element("th"));
  sides.forEach((side) => {
    const heading = element("th", "is-number");
    heading.append(sideSwatch(side.key), document.createTextNode(`Heading ${side.label}`));
    head.append(heading);
  });
  // better: which value wins ("high" or "low"), or null when there is no better direction.
  const row = (label, values, texts, better = null) => {
    const line = element("tr");
    line.append(element("td", "", label));
    const comparable = better && values.every((value) => typeof value === "number" && Number.isFinite(value)) && values[0] !== values[1];
    const winner = comparable ? ((values[0] > values[1]) === (better === "high") ? 0 : 1) : null;
    texts.forEach((text, index) => line.append(element("td", `is-number${winner === index ? " is-better" : ""}`, text)));
    return line;
  };
  const each = (pick) => sides.map(pick);
  const body = element("tbody");
  body.append(
    row("Legs", each((side) => side.legCount), each((side) => number(side.legCount))),
    row("Time riding", each((side) => side.seconds), each((side) => formatDuration(side.seconds))),
    row("Average speed", each((side) => side.averageSpeed), each((side) => formatSpeed(side.averageSpeed)), "high"),
    row("Median leg", each((side) => side.medianLegSeconds), each((side) => `${formatSeconds(side.medianLegSeconds)} · ${formatDistance(side.medianLegDistance)}`)),
    row("Turns onto this side made", each((side) => side.turns.successRate), each((side) => (side.turns.attempted ? `${number(side.turns.made)} of ${number(side.turns.attempted)}` : "—")), "high"),
    row("Speed kept in those turns", each((side) => side.turns.medianSpeedKept), each((side) => formatShare(side.turns.medianSpeedKept)), "high"),
    row("Back to speed after them", each((side) => side.turns.medianRecoverySeconds), each((side) => formatSeconds(side.turns.medianRecoverySeconds)), "low"),
    row("Stops mid-leg", each((side) => side.midLegStops), each((side) => number(side.midLegStops)), "low"),
  );
  const header = element("thead");
  header.append(head);
  table.replaceChildren(header, body);
}

function renderCoachingStops(coaching, summary) {
  const stops = coaching.stopSummary;
  const options = summary.segmentation.options;
  setText("#coachingStopCopy", `A stop is any stretch out on the water where you stayed below ${formatSpeed(options.lowMovementSpeedMps)} for at least ${number(coaching.options.minimumStopSeconds)} seconds. Getting up for less than ${number(coaching.options.minimumRideSeconds)} seconds and going down again counts as a failed restart of the same stop. Stops longer than ${number(coaching.options.breakSeconds / 60)} minutes count as breaks.`);
  const where = [`${number(stops.stopsInTurns)} in a turn`, `${number(stops.stopsMidLeg)} mid-leg`];
  if (stops.stopsUnclear) where.push(`${number(stops.stopsUnclear)} unclear`);
  $("#coachingStopStats").replaceChildren(
    statTile("Stops", number(stops.stopCount), where.join(" · ")),
    statTile("Typical restart", formatSeconds(stops.medianRestartSeconds), stops.longestRestartSeconds === null ? "no stops" : `longest ${formatSeconds(stops.longestRestartSeconds)}${stops.failedRestarts ? ` · ${number(stops.failedRestarts)} failed ${stops.failedRestarts === 1 ? "restart" : "restarts"}` : ""}`),
    statTile("Time on board", formatShare(stops.boardShareOfWater), "of water time, breaks left out"),
    statTile("Riding time", formatDuration(stops.boardSeconds), `${formatShare(stops.boardShareOfSession)} of the whole session`),
    statTile("Breaks", number(stops.breakCount), stops.breakCount ? `${formatDuration(stops.breakSeconds)} in total` : `none longer than ${number(coaching.options.breakSeconds / 60)} minutes`),
    statTile("Stops per hour", stops.stopsPerHour === null ? "—" : number(stops.stopsPerHour, 1), "of time on the board"),
  );
}

function renderCoachingUpwind(coaching, wind) {
  const upwind = coaching.upwind;
  const stats = $("#coachingUpwindStats");
  setText("#coachingUpwindSource", upwind ? windStatusText(wind) : "");
  stats.classList.toggle("hidden", !upwind);
  $("#coachingUpwindSections").classList.toggle("hidden", !upwind);
  if (!upwind) {
    setText("#coachingUpwindCopy", wind?.status === "loading"
      ? "Upwind figures need a wind direction. Wind data is still loading."
      : "Upwind figures need a wind direction, and none is available for this session.");
    stats.replaceChildren();
    return;
  }
  setText("#coachingUpwindCopy", "Each leg's course is compared with the wind direction at that moment: 0 degrees is straight into the wind and 90 degrees is straight across it. These figures are only as accurate as the wind direction, and modelled hourly wind is approximate.");
  const net = upwind.netMetres;
  stats.replaceChildren(
    statTile("Closest to the wind", upwind.closest ? `${number(upwind.closest.angleToWind, 0)} deg` : "—", upwind.closest ? `${formatSpeed(upwind.closest.boardSpeed)} over ${formatSeconds(upwind.closest.seconds)}` : "no upwind leg found"),
    statTile("Typical angle", `${upwind.sides.map((side) => (side.medianAngleToWind === null ? "—" : number(side.medianAngleToWind, 0))).join(" · ")} deg`, `median to the wind, heading ${upwind.sides.map((side) => side.label).join(" · ")}`),
    statTile("Best upwind progress", upwind.fastest ? formatSpeed(upwind.fastest.upwindSpeed) : "—", upwind.fastest ? `made good at ${number(upwind.fastest.angleToWind, 0)} deg to the wind` : "no upwind leg found"),
    statTile("Ground gained", formatSignedDistance(net), `${formatDistance(upwind.gainedMetres)} upwind, ${formatDistance(upwind.lostMetres)} downwind`),
  );
  $("#coachingUpwindSectionBody").replaceChildren(...upwind.sections.map((section) => {
    const row = element("tr");
    const name = element("td", "", section.label);
    name.append(element("small", "", `${formatTime(section.startTimestamp)} – ${formatTime(section.endTimestamp)}`));
    row.append(
      name,
      element("td", "is-number", number(section.legCount)),
      element("td", "is-number", section.legCount ? formatSignedDistance(section.netMetres) : "—"),
    );
    return row;
  }));
}

function renderCoachingFatigue(coaching) {
  const fatigue = coaching.fatigue;
  $("#coachingFatigueTable").classList.toggle("hidden", !fatigue);
  if (!fatigue) {
    setText("#coachingFatigueCopy", `Comparing the start of a session with its end needs at least ${number(coaching.options.minimumRidingSecondsForFatigue / 60)} minutes of riding.`);
    $("#coachingFatigueBody").replaceChildren();
    return;
  }
  const sentences = [fatigue.drop
    ? `Riding speed dropped by ${formatShare(fatigue.drop.speedDrop)} from ${formatTime(fatigue.drop.timestamp)} and did not come back. That can be fatigue or dropping wind.`
    : `No lasting drop in riding speed${fatigue.speedChange === null ? "." : `: the last quarter was ${fatigue.speedChange >= 0 ? "+" : "−"}${formatShare(Math.abs(fatigue.speedChange))} against the first.`}`];
  if (fatigue.heartRateDrift !== null) sentences.push(`Heart rate while riding ${fatigue.heartRateDrift >= 0 ? "rose" : "fell"} ${number(Math.abs(fatigue.heartRateDrift), 0)} bpm from the first quarter to the last.`);
  if (fatigue.heartRateRecovery) {
    const recovery = fatigue.heartRateRecovery;
    sentences.push(`In the first ${number(recovery.seconds)} seconds of a longer stop it ${recovery.beatsPerMinute >= 0 ? "fell" : "rose"} by a median of ${number(Math.abs(recovery.beatsPerMinute), 0)} bpm (${number(recovery.stopCount)} ${recovery.stopCount === 1 ? "stop" : "stops"}).`);
  }
  setText("#coachingFatigueCopy", sentences.join(" "));
  $("#coachingFatigueBody").replaceChildren(...fatigue.quarters.map((quarter) => {
    const row = element("tr", fatigue.drop && quarter.number >= fatigue.drop.quarter ? "coaching-row-mark" : "");
    const name = element("td", "", `Quarter ${quarter.number}`);
    name.append(element("small", "", `${formatTime(quarter.startTimestamp)} – ${formatTime(quarter.endTimestamp)}${fatigue.drop?.quarter === quarter.number ? " · speed dropped here" : ""}`));
    row.append(
      name,
      element("td", "is-number", formatSpeed(quarter.medianSpeed)),
      element("td", "is-number", quarter.turns.attempted ? `${number(quarter.turns.made)} of ${number(quarter.turns.attempted)}` : "—"),
      element("td", "is-number", formatShare(quarter.turns.medianSpeedKept)),
      element("td", "is-number", number(quarter.stopCount)),
      element("td", "is-number", quarter.averageHeartRate === null ? "—" : `${number(quarter.averageHeartRate, 0)} bpm`),
    );
    return row;
  }));
}

function renderCoachingBests(coaching) {
  const bests = coaching.personalBests;
  $("#coachingBestStats").replaceChildren(
    statTile("Best 10 seconds", formatSpeed(bests.tenSeconds?.speed), bests.tenSeconds ? `at ${formatTime(bests.tenSeconds.timestamp)}` : "not enough data"),
    statTile("Best 100 m", formatSpeed(bests.hundredMetres?.speed), bests.hundredMetres ? `in ${number(bests.hundredMetres.seconds, 0)} s` : "not enough data"),
    statTile("Best 500 m", formatSpeed(bests.fiveHundredMetres?.speed), bests.fiveHundredMetres ? `in ${formatSeconds(bests.fiveHundredMetres.seconds)}` : "not enough data"),
    statTile("Longest leg", formatDistance(bests.longestLeg?.distance), bests.longestLeg ? `${formatSeconds(bests.longestLeg.seconds)} at ${formatSpeed(bests.longestLeg.averageSpeed)}` : "no legs found"),
    statTile("Longest ride, no stop", formatSeconds(bests.longestRide?.seconds), bests.longestRide ? `${formatDistance(bests.longestRide.distance)} at ${formatSpeed(bests.longestRide.averageSpeed)}` : "no riding found"),
  );
}

function renderCoaching(summary) {
  const coaching = coachingFor(summary);
  setText("#coachingActivityTitle", sessionTitle(summary));
  setText("#coachingActivityDate", formatDate(summary.starts));
  $("#coachingUnavailable").classList.toggle("hidden", coaching.available);
  $("#coachingSections").classList.toggle("hidden", !coaching.available);
  if (!coaching.available) return;
  renderCoachingTakeaways(coaching);
  renderCoachingTurns(coaching);
  renderCoachingSides(coaching);
  renderCoachingStops(coaching, summary);
  renderCoachingUpwind(coaching, summary.wind);
  renderCoachingFatigue(coaching);
  renderCoachingBests(coaching);
}

function bindCoachingInteractions() {
  // The pointer only has to be near a turn, not exactly on it.
  coachingTurnCanvas.addEventListener("pointermove", (event) => {
    const { x, y } = canvasPointerPosition(coachingTurnCanvas, event);
    const nearest = coachingRenderState.marks.reduce((best, mark) => {
      const distance = Math.hypot(mark.x - x, mark.y - y);
      return distance < 28 && (!best || distance < best.distance) ? { mark, distance } : best;
    }, null)?.mark ?? null;
    setHoveredTurn(nearest?.turn ?? null);
  });
  coachingTurnCanvas.addEventListener("pointerleave", () => setHoveredTurn(null));
  coachingMapCanvas.addEventListener("pointermove", (event) => {
    if (mapPointerState.get(coachingMapCanvas)?.dragging) return setHoveredTurn(null);
    const { x, y } = canvasPointerPosition(coachingMapCanvas, event);
    const nearest = coachingRenderState.mapMarks.reduce((best, mark) => {
      const distance = Math.hypot(mark.x - x, mark.y - y);
      return distance < 18 && (!best || distance < best.distance) ? { mark, distance } : best;
    }, null)?.mark ?? null;
    return setHoveredTurn(nearest?.turn ?? null);
  });
  coachingMapCanvas.addEventListener("pointerleave", () => setHoveredTurn(null));
}

const TRACK_WATER_RIDING_COLOR = "#2a78d6";
const TRACK_WATER_IDLE_COLOR = "#9aa5a2";
const TRACK_WATER_STOP_COLOR = "#d03b3b";
// One hue from light (slow) to dark (fast), chosen to stand out against the blue of the water tiles.
const TRACK_WATER_SPEED_COLORS = ["#fde2a6", "#f8b84e", "#ec8a2a", "#c35a17", "#7f340b"];
const TRACK_WATER_CONTEXT_LABELS = { turn: "In a turn", leg: "Mid-leg", unclear: "Unclear" };

function trackWaterFor(summary) {
  const coaching = coachingFor(summary);
  if (!summary.trackWater || summary.trackWaterCoaching !== coaching) {
    summary.trackWater = analyzeTrackWater(summary.segmentation, coaching, { recordWind: summary.coachingWind });
    summary.trackWaterCoaching = coaching;
  }
  return summary.trackWater;
}

function prepareCanvas(canvas, minimumWidth = 200, minimumHeight = 160) {
  const wrapper = canvas.parentElement;
  const width = Math.max(minimumWidth, Math.floor(wrapper.clientWidth));
  const height = Math.max(minimumHeight, Math.floor(wrapper.clientHeight));
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

// A round step (1, 2 or 5 times a power of ten) that gives roughly the wanted number of ticks.
function niceStep(span, wantedTicks) {
  const raw = Math.max(span, 1e-9) / wantedTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
}

function placeTooltip(tooltip, wrapper, x, y) {
  const left = clamp(x + 14, 0, Math.max(0, wrapper.clientWidth - tooltip.offsetWidth));
  const above = y - tooltip.offsetHeight - 12;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${above >= 0 ? above : Math.min(y + 14, Math.max(0, wrapper.clientHeight - tooltip.offsetHeight))}px`;
}

// Strokes the stretches of the track whose end point matches, never joining across a GPS gap.
function strokeTrack(context, points, projected, matches, color, width) {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].run !== points[index - 1].run || !matches(points[index])) continue;
    context.moveTo(projected[index - 1].x, projected[index - 1].y);
    context.lineTo(projected[index].x, projected[index].y);
  }
  context.stroke();
}

function drawDot(context, point, radius, fill, ring = "#fbfcf8") {
  context.fillStyle = ring;
  context.beginPath();
  context.arc(point.x, point.y, radius + 2, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = fill;
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
}

function drawCross(context, x, y, hovered) {
  const stroke = (color, lineWidth, size) => {
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(x - size, y - size);
    context.lineTo(x + size, y + size);
    context.moveTo(x + size, y - size);
    context.lineTo(x - size, y + size);
    context.stroke();
  };
  stroke("#fbfcf8", 6.5, 5.5);
  stroke(TRACK_WATER_STOP_COLOR, 2.5, 5);
  if (hovered) {
    context.strokeStyle = "#17252a";
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(x, y, 11, 0, Math.PI * 2);
    context.stroke();
  }
}

function drawHoverMarker(context, point) {
  context.fillStyle = "rgba(251, 252, 248, .95)";
  context.strokeStyle = "#17252a";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(point.x, point.y, 6, 0, Math.PI * 2);
  context.fill();
  context.stroke();
}

function drawWindUpPlot(analysis) {
  const { context, width, height } = prepareCanvas(trackWaterWindCanvas);
  const { points } = analysis;
  const padding = { top: 40, right: 18, bottom: 34, left: 18 };
  const range = (pick) => points.reduce((result, point) => [Math.min(result[0], pick(point)), Math.max(result[1], pick(point))], [Infinity, -Infinity]);
  const [minCross, maxCross] = range((point) => point.crosswind);
  const [minUp, maxUp] = range((point) => point.upwind);
  const scale = Math.min(
    (width - padding.left - padding.right) / Math.max(maxCross - minCross, 20),
    (height - padding.top - padding.bottom) / Math.max(maxUp - minUp, 20),
  );
  const centreX = padding.left + (width - padding.left - padding.right) / 2;
  const centreY = padding.top + (height - padding.top - padding.bottom) / 2;
  const project = (point) => ({
    x: centreX + (point.crosswind - (minCross + maxCross) / 2) * scale,
    y: centreY - (point.upwind - (minUp + maxUp) / 2) * scale,
  });
  const projected = points.map(project);

  // The level of the launch: above it is ground gained, below it is ground lost.
  const launchPoint = project(analysis.launch);
  context.strokeStyle = "rgba(55, 77, 80, 0.3)";
  context.lineWidth = 1;
  context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(padding.left, launchPoint.y);
  context.lineTo(width - padding.right, launchPoint.y);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = "#9ba5a3";
  context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textBaseline = "bottom";
  context.textAlign = launchPoint.x > width / 2 ? "left" : "right";
  context.fillText("launch level", launchPoint.x > width / 2 ? padding.left : width - padding.right, launchPoint.y - 3);

  strokeTrack(context, points, projected, (point) => !point.riding, TRACK_WATER_IDLE_COLOR, 1.5);
  strokeTrack(context, points, projected, (point) => point.riding, TRACK_WATER_RIDING_COLOR, 1.75);
  drawDot(context, launchPoint, 5.5, "#17252a");
  drawDot(context, project(analysis.landing), 3, "#b8d354", "#17252a");

  // Wind arrow, pointing the way the wind blows.
  context.fillStyle = "#17252a";
  context.strokeStyle = "#17252a";
  context.textAlign = "center";
  context.textBaseline = "top";
  context.font = "700 9px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillText("WIND", width / 2, 6);
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(width / 2, 19);
  context.lineTo(width / 2, 30);
  context.stroke();
  context.beginPath();
  context.moveTo(width / 2 - 5, 28);
  context.lineTo(width / 2 + 5, 28);
  context.lineTo(width / 2, 35);
  context.closePath();
  context.fill();

  // Scale bar.
  const barMetres = niceStep(((width - padding.left - padding.right) * 0.3) / scale, 1);
  const barY = height - 14;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(padding.left, barY - 4);
  context.lineTo(padding.left, barY);
  context.lineTo(padding.left + barMetres * scale, barY);
  context.lineTo(padding.left + barMetres * scale, barY - 4);
  context.stroke();
  context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "left";
  context.textBaseline = "bottom";
  context.fillStyle = "#6f7d7e";
  context.fillText(formatDistance(barMetres), padding.left + barMetres * scale + 7, barY + 3);

  const hovered = trackWaterRenderState.hoveredPoint;
  if (hovered) drawHoverMarker(context, project(hovered));
}

function drawUpwindChart(analysis, coaching) {
  const { context, width, height } = prepareCanvas(trackWaterChartCanvas, 240, 200);
  const { points } = analysis;
  const padding = { top: 14, right: 14, bottom: 28, left: 54 };
  const plotBottom = height - padding.bottom;
  const duration = Math.max(analysis.sessionEnd - analysis.sessionStart, 1);
  const lowest = Math.min(0, ...points.map((point) => point.upwind));
  const highest = Math.max(0, ...points.map((point) => point.upwind));
  const step = niceStep(Math.max(highest - lowest, 20), 5);
  const minimum = Math.floor(lowest / step) * step;
  const maximum = Math.ceil(highest / step) * step;
  const x = (timestamp) => padding.left + ((timestamp - analysis.sessionStart) / duration) * (width - padding.left - padding.right);
  const y = (metres) => plotBottom - ((metres - minimum) / (maximum - minimum)) * (plotBottom - padding.top);

  // Time not spent riding: before the first ride, long breaks, and after the last ride.
  context.fillStyle = "rgba(23, 37, 42, .06)";
  const idle = [
    [analysis.sessionStart, analysis.waterStart],
    ...coaching.stops.filter((stop) => stop.kind === "break").map((stop) => [stop.startTimestamp, stop.endTimestamp]),
    [analysis.waterEnd, analysis.sessionEnd],
  ];
  idle.forEach(([from, to]) => context.fillRect(x(from), padding.top, Math.max(0, x(to) - x(from)), plotBottom - padding.top));

  context.lineWidth = 1;
  context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (let tick = minimum; tick <= maximum + step / 2; tick += step) {
    const level = Math.round(tick);
    context.strokeStyle = level === 0 ? "rgba(23, 37, 42, 0.45)" : "rgba(55, 77, 80, 0.16)";
    context.fillStyle = level === 0 ? "#17252a" : "#9ba5a3";
    context.fillText(level === 0 ? "launch" : `${level > 0 ? "+" : "−"}${number(Math.abs(level))} m`, padding.left - 8, y(level));
    context.beginPath();
    context.moveTo(padding.left, y(level));
    context.lineTo(width - padding.right, y(level));
    context.stroke();
  }
  context.fillStyle = "#9ba5a3";
  context.textBaseline = "alphabetic";
  const tickStep = [300, 600, 900, 1200, 1800, 3600].find((seconds) => duration / seconds <= 7) ?? 7200;
  for (let elapsed = 0; elapsed <= duration; elapsed += tickStep) {
    context.textAlign = elapsed === 0 ? "left" : "center";
    context.fillText(`${Math.floor(elapsed / 3600)}:${String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0")}`, x(analysis.sessionStart + elapsed), height - 8);
  }

  const projected = points.map((point) => ({ x: x(point.timestamp), y: y(point.upwind) }));
  strokeTrack(context, points, projected, (point) => !point.riding, TRACK_WATER_IDLE_COLOR, 1.5);
  strokeTrack(context, points, projected, (point) => point.riding, TRACK_WATER_RIDING_COLOR, 2);

  const hovered = trackWaterRenderState.hoveredPoint;
  if (hovered) {
    const marker = { x: x(hovered.timestamp), y: y(hovered.upwind) };
    context.strokeStyle = "rgba(23, 37, 42, 0.35)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(marker.x, padding.top);
    context.lineTo(marker.x, plotBottom);
    context.stroke();
    drawHoverMarker(context, marker);
  }
  trackWaterRenderState.chart = { x, y, left: padding.left, right: width - padding.right, duration };
}

function showTrackWaterChartTooltip(point) {
  const tooltip = $("#trackWaterChartTooltip");
  const { analysis, chart } = trackWaterRenderState;
  if (!point || !chart) {
    tooltip.classList.add("hidden");
    return;
  }
  tooltip.replaceChildren(
    element("strong", "", Math.abs(point.upwind) < 1 ? "Level with the launch" : `${formatDistance(Math.abs(point.upwind))} ${point.upwind >= 0 ? "upwind" : "downwind"}`),
    element("span", "", `${formatTime(point.timestamp)} · ${formatDuration(point.timestamp - analysis.sessionStart)} in`),
    element("span", "", point.riding ? `Riding at ${formatSpeed(point.speed)}` : "Not riding"),
  );
  tooltip.classList.remove("hidden");
  placeTooltip(tooltip, trackWaterChartCanvas.parentElement, chart.x(point.timestamp), chart.y(point.upwind));
}

function renderTrackWaterUpwind(analysis, summary, coaching) {
  const { wind, launchLanding } = analysis;
  const plots = $("#trackWaterPlots");
  const details = $("#trackWaterSectionDetails");
  plots.classList.toggle("hidden", !wind);
  details.classList.toggle("hidden", !wind);
  setText("#trackWaterWindSource", wind ? `${windStatusText(summary.wind)} · from ${formatWindDirection(wind.direction)}` : "");

  const edgeNote = launchLanding.startedRiding || launchLanding.endedRiding
    ? `the recording ${launchLanding.startedRiding && launchLanding.endedRiding ? "starts and ends" : launchLanding.startedRiding ? "starts" : "ends"} while riding`
    : null;
  if (!wind) {
    setText("#trackWaterUpwindCopy", summary.wind?.status === "loading"
      ? "Ground gained upwind needs a wind direction. Wind data is still loading."
      : "Ground gained upwind needs a wind direction, and none is available for this session. The distance between launch and landing does not depend on it.");
    $("#trackWaterUpwindStats").replaceChildren(
      statTile("Launch to landing", formatDistance(launchLanding.distance), edgeNote ?? "straight line between the two"),
      statTile("Landing against launch", "—", "needs a wind direction"),
      statTile("Highest point", "—", "needs a wind direction"),
      statTile("Lowest point", "—", "needs a wind direction"),
    );
    $("#trackWaterSectionBody").replaceChildren();
    trackWaterRenderState.hoveredPoint = null;
    showTrackWaterChartTooltip(null);
    return;
  }

  const sentences = [
    "Both plots are turned so the wind comes from the top, using one wind direction for the whole session. Up is ground gained against the wind, and the launch is the zero line.",
    launchLanding.uncertaintyMetres >= 5
      ? `These figures are only as good as the wind direction: if it is ${number(launchLanding.windErrorDegrees)} deg off, the landing figure moves by about ${formatDistance(launchLanding.uncertaintyMetres)}, and positions at the far ends of the run move more.`
      : "These figures are only as good as the wind direction: when it is off, positions at the far ends of the run move the most.",
  ];
  if (wind.shiftDegrees > analysis.options.windShiftNoteDegrees) sentences.push(`The wind direction shifted by up to ${number(wind.shiftDegrees, 0)} deg during the session, so one direction is a compromise.`);
  setText("#trackWaterUpwindCopy", sentences.join(" "));

  const offset = launchLanding.upwindMetres;
  const { highest, lowest, sections } = analysis.upwind;
  const best = sections.filter((section) => section.netMetres !== null).reduce((top, section) => (!top || section.netMetres > top.netMetres ? section : top), null);
  $("#trackWaterUpwindStats").replaceChildren(
    statTile("Landing against launch", launchLanding.distance < 15 ? "≈ 0 m" : `${formatDistance(Math.abs(offset))} ${offset >= 0 ? "upwind" : "downwind"}`, edgeNote ?? (launchLanding.distance < 15 ? `back at the launch, ${formatDistance(launchLanding.distance)} apart` : `${formatDistance(launchLanding.distance)} apart in a straight line`)),
    statTile("Highest point", formatSignedDistance(highest.metres), `against the launch, at ${formatTime(highest.timestamp)}`),
    statTile("Lowest point", formatSignedDistance(lowest.metres), `against the launch, at ${formatTime(lowest.timestamp)}`),
    statTile("Most ground gained", best ? formatSignedDistance(best.netMetres) : "—", best ? `in ${best.label.toLowerCase()}` : "no ride section with a track"),
  );
  $("#trackWaterSectionBody").replaceChildren(...sections.map((section) => {
    const row = element("tr");
    const name = element("td", "", section.label);
    name.append(element("small", "", `${formatTime(section.startTimestamp)} – ${formatTime(section.endTimestamp)}`));
    row.append(
      name,
      element("td", "is-number", formatSignedDistance(section.startMetres)),
      element("td", "is-number", formatSignedDistance(section.endMetres)),
      element("td", "is-number", formatSignedDistance(section.netMetres)),
    );
    return row;
  }));

  if (!analysis.points.includes(trackWaterRenderState.hoveredPoint)) {
    trackWaterRenderState.hoveredPoint = null;
    showTrackWaterChartTooltip(null);
  }
  drawWindUpPlot(analysis);
  drawUpwindChart(analysis, coaching);
}

function drawTrackWaterMap(analysis) {
  const canvas = trackWaterMapCanvas;
  const wrapper = canvas.parentElement;
  canvas.style.display = "block";
  const width = Math.max(240, Math.floor(wrapper.clientWidth));
  const height = Math.max(260, Math.floor(wrapper.clientHeight));
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const { points } = analysis;
  const tileContainer = trackWaterMapTiles;
  const bounds = points.reduce((result, point) => ({
    minLatitude: Math.min(result.minLatitude, point.latitude),
    maxLatitude: Math.max(result.maxLatitude, point.latitude),
    minLongitude: Math.min(result.minLongitude, point.longitude),
    maxLongitude: Math.max(result.maxLongitude, point.longitude),
  }), { minLatitude: 90, maxLatitude: -90, minLongitude: 180, maxLongitude: -180 });
  const requestedZoom = mapZoomState.get(tileContainer) ?? null;
  const pan = mapPanState.get(tileContainer) ?? { x: 0, y: 0 };
  const layoutKey = [width, height, points.length, bounds.minLatitude.toFixed(6), bounds.maxLatitude.toFixed(6), bounds.minLongitude.toFixed(6), bounds.maxLongitude.toFixed(6), requestedZoom ?? "auto", pan.x.toFixed(1), pan.y.toFixed(1)].join(":");
  const cachedLayout = mapLayoutCache.get(tileContainer);
  const map = cachedLayout?.key === layoutKey ? cachedLayout.map : loadMapTiles(points, width, height, tileContainer, requestedZoom);
  if (cachedLayout?.key !== layoutKey) mapLayoutCache.set(tileContainer, { key: layoutKey, map });
  const project = (point) => {
    const projected = webMercatorPoint(point, map.zoom);
    return { x: projected.x - map.viewportLeft, y: projected.y - map.viewportTop };
  };
  const projected = points.map(project);
  const speedMode = trackWaterRenderState.mode === "speed";

  strokeTrack(context, points, projected, () => true, "rgba(255, 255, 255, .9)", speedMode ? 7 : 5.5);
  strokeTrack(context, points, projected, (point) => !point.riding, "#879793", 2);
  if (speedMode) {
    TRACK_WATER_SPEED_COLORS.forEach((color, step) => strokeTrack(context, points, projected, (point) => point.riding && point.speedStep === step, color, 3));
  } else {
    strokeTrack(context, points, projected, (point) => point.riding, "rgba(23, 37, 42, .62)", 2.25);
  }
  drawDot(context, project(analysis.launch), 6, "#17252a");
  drawDot(context, project(analysis.landing), 3.5, "#b8d354", "#17252a");

  const marks = speedMode ? [] : analysis.events.filter((event) => event.placed).map((event) => ({ event, ...project(event.point) }));
  marks.forEach((mark) => drawCross(context, mark.x, mark.y, false));
  const hoveredMark = marks.find((mark) => mark.event === trackWaterRenderState.hoveredEvent);
  if (hoveredMark) drawCross(context, hoveredMark.x, hoveredMark.y, true);
  const hoveredPoint = speedMode ? trackWaterRenderState.hoveredMapPoint : null;
  if (hoveredPoint) drawHoverMarker(context, project(hoveredPoint));

  trackWaterRenderState.mapMarks = marks;
  trackWaterRenderState.mapPoints = speedMode ? points.map((point, index) => ({ point, ...projected[index] })).filter((entry) => entry.point.riding) : [];
  trackWaterRenderState.projectMapPoint = project;
}

function showTrackWaterMapTooltip(lines, x, y) {
  const tooltip = $("#trackWaterMapTooltip");
  if (!lines) {
    tooltip.classList.add("hidden");
    return;
  }
  tooltip.replaceChildren(...lines);
  tooltip.classList.remove("hidden");
  placeTooltip(tooltip, trackWaterMapCanvas.parentElement, x, y);
}

function trackWaterStopSentence(analysis) {
  const { events, cluster, zoneCounts, placedEventCount } = analysis;
  if (!events.length) return "No stops were found in this session.";
  const unplaced = events.length - placedEventCount;
  const sentences = [];
  if (cluster) {
    sentences.push(`${number(cluster.count)} of ${number(cluster.total)} stops happened at the ${cluster.zone} of your run, so that is the place to watch.`);
  } else if (zoneCounts.length && placedEventCount) {
    sentences.push(`The stops are spread along your run: ${zoneCounts.map((entry) => `${number(entry.count)} ${entry.zone === "middle" ? "in the middle" : `at the ${entry.zone}`}`).join(", ")}.`);
  } else if (placedEventCount) {
    sentences.push(`${number(placedEventCount)} ${placedEventCount === 1 ? "stop is" : "stops are"} marked on the map.`);
  }
  sentences.push(`Each stop is drawn at the last GPS fix before it, because the watch loses GPS in the water.`);
  if (unplaced) sentences.push(`${number(unplaced)} ${unplaced === 1 ? "stop" : "stops"} could not be placed: there was no fix within ${number(analysis.options.eventFixSeconds)} seconds.`);
  return sentences.join(" ");
}

function renderTrackWaterMap(analysis) {
  const speedMode = trackWaterRenderState.mode === "speed";
  document.querySelectorAll("[data-track-water-mode]").forEach((button) => {
    const active = button.dataset.trackWaterMode === trackWaterRenderState.mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  setText("#trackWaterMapTitle", speedMode ? "Where you were fast" : "Where the stops happened");
  setText("#trackWaterMapCopy", speedMode
    ? `Riding stretches are coloured by speed, light for slow and dark for fast, using the ${number(currentActivity.segmentation.options.smoothingSeconds)}-second median. Turns are always light; a light patch in the middle of a leg, or a zone that is dark on every pass, says something about the spot.`
    : trackWaterStopSentence(analysis));

  const entry = (swatch, text) => {
    const item = element("span");
    item.append(swatch, document.createTextNode(text));
    return item;
  };
  const legend = [];
  if (speedMode && analysis.speedScale) {
    const { bounds } = analysis.speedScale;
    const kilometres = (speed) => number(speed * 3.6, 0);
    TRACK_WATER_SPEED_COLORS.forEach((color, step) => {
      const swatch = element("i", "track-water-step");
      swatch.style.background = color;
      const text = step === 0 ? `under ${kilometres(bounds[1])}` : step === TRACK_WATER_SPEED_COLORS.length - 1 ? `over ${kilometres(bounds[step])} km/h` : `${kilometres(bounds[step])}–${kilometres(bounds[step + 1])}`;
      legend.push(entry(swatch, text));
    });
  } else {
    legend.push(entry(element("i", "coaching-swatch is-stopped"), "stop"), entry(element("i", "track-water-line is-track"), "riding"));
  }
  legend.push(entry(element("i", "track-water-line is-idle"), "not riding"), entry(element("i", "map-marker-dot start"), "launch"), entry(element("i", "map-marker-dot end"), "landing"));
  $("#trackWaterMapLegend").replaceChildren(...legend);

  if (!analysis.events.includes(trackWaterRenderState.hoveredEvent)) trackWaterRenderState.hoveredEvent = null;
  if (!analysis.points.includes(trackWaterRenderState.hoveredMapPoint)) trackWaterRenderState.hoveredMapPoint = null;
  if (!trackWaterRenderState.hoveredEvent && !trackWaterRenderState.hoveredMapPoint) showTrackWaterMapTooltip(null);
  drawTrackWaterMap(analysis);

  const rows = analysis.events.map((event) => {
    const row = element("tr");
    const time = element("td", "", formatTime(event.timestamp));
    time.append(element("small", "", `${formatDuration(event.timestamp - analysis.sessionStart)} in`));
    row.append(
      time,
      element("td", "", TRACK_WATER_CONTEXT_LABELS[event.context] ?? "Unclear"),
      element("td", event.placed ? "" : "is-muted", event.placed ? (event.zone ?? "on the map") : "no GPS fix nearby"),
      element("td", "is-number", formatSeconds(event.restartSeconds)),
    );
    return row;
  });
  if (!rows.length) {
    const row = element("tr");
    row.append(element("td", "is-muted", "No stops in this session."));
    rows.push(row);
  }
  $("#trackWaterStopBody").replaceChildren(...rows);
}

function renderTrackWater(summary) {
  const analysis = trackWaterFor(summary);
  setText("#trackWaterActivityTitle", sessionTitle(summary));
  setText("#trackWaterActivityDate", formatDate(summary.starts));
  $("#trackWaterUnavailable").classList.toggle("hidden", analysis.available);
  $("#trackWaterSections").classList.toggle("hidden", !analysis.available);
  trackWaterRenderState.analysis = analysis.available ? analysis : null;
  if (!analysis.available) return;
  renderTrackWaterUpwind(analysis, summary, coachingFor(summary));
  renderTrackWaterMap(analysis);
}

function bindTrackWaterInteractions() {
  const redrawPlots = () => {
    const { analysis } = trackWaterRenderState;
    drawWindUpPlot(analysis);
    drawUpwindChart(analysis, coachingFor(currentActivity));
  };
  trackWaterChartCanvas.addEventListener("pointermove", (event) => {
    const { analysis, chart } = trackWaterRenderState;
    if (!analysis?.wind || !chart) return;
    const { x } = canvasPointerPosition(trackWaterChartCanvas, event);
    const timestamp = analysis.sessionStart + ((clamp(x, chart.left, chart.right) - chart.left) / (chart.right - chart.left)) * chart.duration;
    const nearest = analysis.points.reduce((best, point) => (Math.abs(point.timestamp - timestamp) < Math.abs(best.timestamp - timestamp) ? point : best), analysis.points[0]);
    if (nearest === trackWaterRenderState.hoveredPoint) return;
    trackWaterRenderState.hoveredPoint = nearest;
    redrawPlots();
    showTrackWaterChartTooltip(nearest);
  });
  trackWaterChartCanvas.addEventListener("pointerleave", () => {
    if (!trackWaterRenderState.hoveredPoint || !trackWaterRenderState.analysis?.wind) return;
    trackWaterRenderState.hoveredPoint = null;
    redrawPlots();
    showTrackWaterChartTooltip(null);
  });

  const nearestWithin = (entries, x, y, limit) => entries.reduce((best, entry) => {
    const distance = Math.hypot(entry.x - x, entry.y - y);
    return distance < limit && (!best || distance < best.distance) ? { entry, distance } : best;
  }, null)?.entry ?? null;
  const clearMapHover = () => {
    if (!trackWaterRenderState.hoveredEvent && !trackWaterRenderState.hoveredMapPoint) return;
    trackWaterRenderState.hoveredEvent = null;
    trackWaterRenderState.hoveredMapPoint = null;
    showTrackWaterMapTooltip(null);
    if (trackWaterRenderState.analysis) drawTrackWaterMap(trackWaterRenderState.analysis);
  };
  trackWaterMapCanvas.addEventListener("pointermove", (event) => {
    const { analysis } = trackWaterRenderState;
    if (!analysis) return;
    if (mapPointerState.get(trackWaterMapCanvas)?.dragging) {
      clearMapHover();
      return;
    }
    const { x, y } = canvasPointerPosition(trackWaterMapCanvas, event);
    if (trackWaterRenderState.mode === "speed") {
      const hit = nearestWithin(trackWaterRenderState.mapPoints, x, y, 16);
      if ((hit?.point ?? null) === trackWaterRenderState.hoveredMapPoint) return;
      if (!hit) return clearMapHover();
      trackWaterRenderState.hoveredMapPoint = hit.point;
      drawTrackWaterMap(analysis);
      showTrackWaterMapTooltip([
        element("strong", "", formatSpeed(hit.point.speed)),
        element("span", "", `${formatTime(hit.point.timestamp)} · ${formatDuration(hit.point.timestamp - analysis.sessionStart)} in`),
      ], hit.x, hit.y);
      return;
    }
    const mark = nearestWithin(trackWaterRenderState.mapMarks, x, y, 24);
    if ((mark?.event ?? null) === trackWaterRenderState.hoveredEvent) return;
    if (!mark) return clearMapHover();
    trackWaterRenderState.hoveredEvent = mark.event;
    drawTrackWaterMap(analysis);
    showTrackWaterMapTooltip([
      element("strong", "", `Stop ${(TRACK_WATER_CONTEXT_LABELS[mark.event.context] ?? "Unclear").toLowerCase()}`),
      element("span", "", `${formatTime(mark.event.timestamp)} · ${formatDuration(mark.event.timestamp - analysis.sessionStart)} in`),
      ...(mark.event.zone ? [element("span", "", mark.event.zone === "middle" ? "In the middle of the run" : `At the ${mark.event.zone} of the run`)] : []),
      element("span", "", `Riding again after ${formatSeconds(mark.event.restartSeconds)}`),
    ], mark.x, mark.y);
  });
  trackWaterMapCanvas.addEventListener("pointerleave", clearMapHover);

  document.querySelectorAll("[data-track-water-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      if (trackWaterRenderState.mode === button.dataset.trackWaterMode) return;
      trackWaterRenderState.mode = button.dataset.trackWaterMode;
      trackWaterRenderState.hoveredEvent = null;
      trackWaterRenderState.hoveredMapPoint = null;
      showTrackWaterMapTooltip(null);
      if (currentActivity) scheduleVisualRender();
    });
  });
}

const PROGRESS_LINE_COLOR = "#2a78d6";
const PROGRESS_DIRECTION_WORDS = { better: "Better", worse: "Worse", level: "Level", up: "Up", down: "Down" };

function progressMetric(key) {
  return PROGRESS_METRICS.find((metric) => metric.key === key);
}

function selectedProgressMetrics() {
  return PROGRESS_METRICS.filter((metric) => progressState.selected.has(metric.key));
}

function progressDisplay(metric, value) {
  return typeof value === "number" && Number.isFinite(value) ? value * PROGRESS_KINDS[metric.kind].scale : null;
}

function formatProgressValue(metric, value) {
  const kind = PROGRESS_KINDS[metric.kind];
  const shown = progressDisplay(metric, value);
  return shown === null ? "—" : `${number(shown, kind.digits)}${kind.unit === "%" ? "" : " "}${kind.unit}`;
}

function formatProgressChange(metric, difference) {
  const kind = PROGRESS_KINDS[metric.kind];
  const shown = Math.abs(difference * kind.scale);
  return `${difference >= 0 ? "+" : "−"}${number(shown, kind.digits)} ${kind.changeUnit ?? kind.unit}`;
}

function progressDateLabel(session, withYear = false) {
  const date = dateFromFit(session.start);
  if (!date || Number.isNaN(date.getTime())) return "no date";
  return date.toLocaleDateString(undefined, withYear ? { dateStyle: "medium" } : { month: "short", day: "numeric" });
}

function setProgressStatus(lines) {
  const text = lines.filter(Boolean).join("\n");
  ["#progressStatus", "#progressEmptyStatus"].forEach((selector) => {
    $(selector).textContent = text;
    $(selector).classList.toggle("hidden", !text);
  });
}

function progressNeedsWind() {
  return selectedProgressMetrics().some((metric) => metric.needsWind);
}

function addProgressSession(source, activity) {
  const summary = summarizeSession(activity);
  if (progressState.sessions.some((session) => sameSession(session, summary))) return false;
  progressState.nextId += 1;
  progressState.sessions = sortSessions([...progressState.sessions, { id: progressState.nextId, wind: "none", ...source, ...summary }]);
  return true;
}

// Reads the chosen files one after another. Only the measures are kept; the decoded ride is dropped again.
async function addProgressFiles(files) {
  if (progressState.busy || !files.length) return;
  progressState.busy = true;
  const problems = [];
  let duplicates = 0;
  for (const [position, file] of files.entries()) {
    setProgressStatus([`Reading ride ${number(position + 1)} of ${number(files.length)}…`]);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      const activity = decodeFit(await file.arrayBuffer());
      if (!activity.records?.length) throw new Error("it contains no track records");
      if (!addProgressSession({ fileName: file.name, file }, activity)) duplicates += 1;
    } catch (error) {
      problems.push(`${file.name}: ${error.message || "could not be read"}`);
    }
  }
  progressState.busy = false;
  progressState.hoveredIndex = null;
  setProgressStatus([
    duplicates ? `${number(duplicates)} ${duplicates === 1 ? "file was" : "files were"} already loaded and skipped.` : "",
    problems.length ? `${number(problems.length)} ${problems.length === 1 ? "file" : "files"} could not be read:\n${problems.join("\n")}` : "",
  ]);
  renderProgress();
  ensureProgressWind();
}

// Upwind measures need a wind direction per ride: the weather saved in the FIT file if there is any,
// otherwise a lookup at Open-Meteo. This only runs once an upwind measure is switched on.
async function ensureProgressWind() {
  if (progressState.windBusy || !progressNeedsWind()) return;
  progressState.windBusy = true;
  for (const session of [...progressState.sessions]) {
    if (!progressNeedsWind()) break;
    if (session.wind !== "none" || !session.available || !progressState.sessions.includes(session)) continue;
    session.wind = "loading";
    renderProgress();
    try {
      const activity = session.activity ?? decodeFit(await session.file.arrayBuffer());
      const annotation = await resolveWindAnnotation(activity);
      const recordWind = annotation.recordWind?.some(Boolean) ? annotation.recordWind : null;
      const withWind = recordWind ? summarizeSession(activity, { recordWind }) : null;
      if (withWind?.hasWind) session.metrics = withWind.metrics;
      session.wind = withWind?.hasWind ? "ready" : "unavailable";
    } catch {
      session.wind = "unavailable";
    }
  }
  progressState.windBusy = false;
  renderProgress();
}

function loadProgressDemo() {
  if (progressState.demoLoaded) return;
  progressState.demoLoaded = true;
  createDemoSeries().forEach(({ fileName, activity }) => addProgressSession({ fileName, activity }, activity));
}

function openProgressSession(session) {
  if (session.activity) {
    render(session.activity, session.fileName);
    annotateWind(session.activity);
  } else {
    loadFile(session.file);
  }
  window.location.hash = "#overview";
}

function drawProgressChart(card) {
  const { canvas, metric } = card;
  const { context, width, height } = prepareCanvas(canvas, 200, 140);
  const sessions = progressState.sessions;
  const kind = PROGRESS_KINDS[metric.kind];
  const values = sessions.map((session) => progressDisplay(metric, session.metrics[metric.key]));
  const present = values.filter((value) => value !== null);
  const padding = { top: 24, right: 22, bottom: 26, left: 46 };
  const plotBottom = height - padding.bottom;
  const plotWidth = width - padding.left - padding.right;
  const x = (index) => (sessions.length > 1 ? padding.left + (index / (sessions.length - 1)) * plotWidth : padding.left + plotWidth / 2);
  card.x = x;

  context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
  if (!present.length) {
    context.fillStyle = "#9ba5a3";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(metric.needsWind ? "no wind direction for these rides yet" : "no ride has this measure", width / 2, height / 2);
    return;
  }

  let low = Math.min(...present);
  let high = Math.max(...present);
  const margin = high > low ? (high - low) * 0.18 : Math.max(Math.abs(high) * 0.1, 1);
  low -= margin;
  high += margin;
  if (metric.kind === "share") {
    low = Math.max(0, low);
    high = Math.min(100, high);
  } else if (Math.min(...present) >= 0) {
    low = Math.max(0, low);
  }
  const step = niceStep(high - low, 4);
  const y = (value) => plotBottom - ((value - low) / (high - low)) * (plotBottom - padding.top);

  context.lineWidth = 1;
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (let tick = Math.ceil(low / step) * step; tick <= high + step * 1e-6; tick += step) {
    context.strokeStyle = "rgba(55, 77, 80, 0.16)";
    context.fillStyle = "#9ba5a3";
    context.fillText(number(tick, step < 1 ? 1 : 0), padding.left - 8, y(tick));
    context.beginPath();
    context.moveTo(padding.left, y(tick));
    context.lineTo(width - padding.right, y(tick));
    context.stroke();
  }

  // Date labels: every ride when there is room, otherwise a spread of them, always including the last.
  const labelEvery = Math.max(1, Math.ceil(sessions.length / Math.max(2, Math.floor(plotWidth / 52))));
  const hovered = progressState.hoveredIndex;
  context.textBaseline = "alphabetic";
  sessions.forEach((session, index) => {
    const labelled = index === hovered || (hovered === null && (index % labelEvery === 0 || index === sessions.length - 1) && !(index !== sessions.length - 1 && sessions.length - 1 - index < labelEvery));
    if (!labelled) return;
    context.fillStyle = index === hovered ? "#17252a" : "#9ba5a3";
    context.textAlign = index === 0 && sessions.length > 1 ? "left" : index === sessions.length - 1 && sessions.length > 1 ? "right" : "center";
    context.fillText(progressDateLabel(session), x(index), height - 8);
  });

  if (hovered !== null) {
    context.strokeStyle = "rgba(23, 37, 42, 0.3)";
    context.beginPath();
    context.moveTo(x(hovered), padding.top - 6);
    context.lineTo(x(hovered), plotBottom);
    context.stroke();
  }

  // The line only joins rides that follow each other; a ride without the measure leaves a gap.
  context.strokeStyle = PROGRESS_LINE_COLOR;
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.beginPath();
  values.forEach((value, index) => {
    if (value === null) return;
    if (index === 0 || values[index - 1] === null) context.moveTo(x(index), y(value));
    else context.lineTo(x(index), y(value));
  });
  context.stroke();
  values.forEach((value, index) => {
    if (value !== null) drawDot(context, { x: x(index), y: y(value) }, index === hovered ? 5 : 3.5, PROGRESS_LINE_COLOR);
  });

  // Value labels on the first and last ride that have the measure, or on the hovered ride.
  const firstIndex = values.findIndex((value) => value !== null);
  const lastIndex = values.length - 1 - [...values].reverse().findIndex((value) => value !== null);
  const labelIndexes = hovered !== null ? (values[hovered] !== null ? [hovered] : []) : [...new Set([firstIndex, lastIndex])];
  context.fillStyle = "#17252a";
  context.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textBaseline = "alphabetic";
  labelIndexes.forEach((index) => {
    const text = `${number(values[index], kind.digits)}${kind.unit === "%" ? "%" : ""}`;
    const half = context.measureText(text).width / 2;
    context.textAlign = "center";
    context.fillText(text, clamp(x(index), padding.left + half - 4, width - half - 4), y(values[index]) - 9);
  });
}

function drawProgressCharts() {
  progressState.cards.forEach(drawProgressChart);
  document.querySelectorAll("#progressTable tbody tr").forEach((row, index) => row.classList.toggle("is-hovered", index === progressState.hoveredIndex));
}

function setProgressHover(index) {
  if (index === progressState.hoveredIndex) return;
  progressState.hoveredIndex = index;
  drawProgressCharts();
}

function progressChangeLine(metric, sessions) {
  const values = sessions.map((session) => session.metrics[metric.key]);
  const change = describeChange(values, metric.better);
  const line = element("span", "progress-change");
  if (!change) {
    const loading = metric.needsWind && sessions.some((session) => session.wind === "loading" || (session.wind === "none" && session.available));
    line.textContent = loading ? "Looking up the wind…" : values.some((value) => value !== null) ? "Only one ride has this measure" : metric.needsWind ? "No wind direction available" : "No ride has this measure";
    return { line, change };
  }
  const since = `since ${change.firstIndex === 0 ? "the first ride" : progressDateLabel(sessions[change.firstIndex])}`;
  line.classList.add(`is-${change.direction}`);
  line.textContent = change.direction === "level"
    ? `Level with ${change.firstIndex === 0 ? "the first ride" : progressDateLabel(sessions[change.firstIndex])}`
    : `${PROGRESS_DIRECTION_WORDS[change.direction]}: ${formatProgressChange(metric, change.difference)} ${since}`;
  return { line, change };
}

function renderProgressMenu() {
  const panel = $("#progressMenuPanel");
  setText("#progressMenuCount", `${number(progressState.selected.size)} of ${number(PROGRESS_METRICS.length)} shown`);
  // Built once and then only kept in step, so ticking a box does not move keyboard focus.
  if (panel.children.length) {
    panel.querySelectorAll("[data-progress-metric]").forEach((box) => {
      box.checked = progressState.selected.has(box.dataset.progressMetric);
    });
    return;
  }
  const groups = [...new Set(PROGRESS_METRICS.map((metric) => metric.group))].map((group) => {
    const block = element("div", "progress-menu-group");
    block.append(element("h4", "", group));
    if (group === "Upwind") block.append(element("p", "", "Looks up the wind for every ride: weather saved in the FIT file first, otherwise Open-Meteo with a rounded coordinate and the date."));
    PROGRESS_METRICS.filter((metric) => metric.group === group).forEach((metric) => {
      const label = element("label");
      const box = element("input");
      box.type = "checkbox";
      box.checked = progressState.selected.has(metric.key);
      box.dataset.progressMetric = metric.key;
      const text = element("span", "", metric.label);
      text.append(element("small", "", metric.note));
      label.append(box, text);
      block.append(label);
    });
    return block;
  });
  const foot = element("div", "progress-menu-foot");
  const reset = element("button", "text-button", "Back to the starting set");
  reset.type = "button";
  reset.dataset.progressReset = "true";
  foot.append(reset);
  panel.replaceChildren(...groups, foot);
}

function renderProgress() {
  const sessions = progressState.sessions;
  $("#progressEmpty").classList.toggle("hidden", sessions.length > 0);
  $("#progressBody").classList.toggle("hidden", sessions.length === 0);
  if (!sessions.length) {
    progressState.cards = [];
    return;
  }
  if (progressState.hoveredIndex !== null && progressState.hoveredIndex >= sessions.length) progressState.hoveredIndex = null;

  const dated = sessions.filter((session) => typeof session.start === "number");
  const idle = sessions.filter((session) => !session.available).length;
  setText("#progressTitle", `${number(sessions.length)} ${sessions.length === 1 ? "ride" : "rides"}${dated.length > 1 ? `, ${progressDateLabel(dated[0], true)} to ${progressDateLabel(dated.at(-1), true)}` : ""}`);
  const sentences = [sessions.length < 2
    ? "Add at least one more ride to see how a measure changes."
    : "Each chart follows one measure from ride to ride. Rides are in date order and evenly spaced, whatever the time between them. Hover a chart or a table row to read the same ride everywhere."];
  if (idle) sentences.push(`${number(idle)} ${idle === 1 ? "ride has" : "rides have"} no riding in ${idle === 1 ? "it" : "them"} and ${idle === 1 ? "leaves" : "leave"} a gap.`);
  if (progressNeedsWind()) {
    const ready = sessions.filter((session) => session.wind === "ready").length;
    const waiting = sessions.filter((session) => session.available && (session.wind === "none" || session.wind === "loading")).length;
    sentences.push(waiting
      ? `Looking up the wind: ${number(ready)} of ${number(sessions.filter((session) => session.available).length)} rides done.`
      : ready
        ? `Wind direction found for ${number(ready)} of ${number(sessions.filter((session) => session.available).length)} rides. Upwind measures are only as accurate as that direction, and modelled hourly wind is approximate.`
        : "No wind direction could be found for these rides, so the upwind measures stay empty.");
  }
  setText("#progressCopy", sentences.join(" "));
  renderProgressMenu();

  const metrics = selectedProgressMetrics();
  const latest = sessions.at(-1);
  progressState.cards = [];
  const cards = metrics.map((metric) => {
    const card = element("article", "progress-card panel");
    const head = element("div", "progress-card-head");
    const title = element("div");
    title.append(element("p", "panel-kicker", metric.group), element("h3", "", metric.label));
    const hide = element("button", "text-button", "Hide");
    hide.type = "button";
    hide.dataset.progressHide = metric.key;
    hide.setAttribute("aria-label", `Hide ${metric.label}`);
    head.append(title, hide);

    const { line, change } = progressChangeLine(metric, sessions);
    const shown = change ? sessions[change.lastIndex] : latest;
    const figures = element("div", "progress-card-figures");
    const value = element("strong", "", formatProgressValue(metric, shown.metrics[metric.key]));
    figures.append(value, element("small", "", `${shown === latest ? "latest ride" : "last ride with it"}, ${progressDateLabel(shown)}`), line);

    const wrap = element("div", "progress-chart-wrap");
    const canvas = element("canvas");
    canvas.setAttribute("aria-label", `${metric.label} from ride to ride`);
    wrap.append(canvas);
    card.append(head, figures, element("p", "progress-card-note", `${metric.note}${metric.better ? `; ${metric.better === "high" ? "higher" : "lower"} is better` : ""}`), wrap);
    progressState.cards.push({ canvas, metric });
    return card;
  });
  if (!cards.length) cards.push(element("p", "progress-grid-empty", "No measure is selected. Open Measures above and tick the ones you want to follow."));
  $("#progressGrid").replaceChildren(...cards);

  // The same numbers as a table, with the best ride for each measure in bold.
  const best = new Map(metrics.map((metric) => [metric.key, describeChange(sessions.map((session) => session.metrics[metric.key]), metric.better)?.bestIndex ?? null]));
  const headRow = element("tr");
  headRow.append(element("th", "", "Ride"), element("th", "is-number", "Length"));
  metrics.forEach((metric) => headRow.append(element("th", "is-number", metric.label)));
  headRow.append(element("th", "is-number", ""));
  const head = element("thead");
  head.append(headRow);
  const body = element("tbody");
  sessions.forEach((session, index) => {
    const row = element("tr");
    row.dataset.progressIndex = String(index);
    const name = element("td", "", typeof session.start === "number" ? `${progressDateLabel(session, true)}, ${formatTime(session.start)}` : "No date");
    name.append(element("small", "", session.available ? session.fileName : `${session.fileName} · no riding found`));
    row.append(name, element("td", "is-number", formatDuration(session.durationSeconds)));
    metrics.forEach((metric) => row.append(element("td", `is-number${best.get(metric.key) === index ? " is-best" : ""}`, formatProgressValue(metric, session.metrics[metric.key]))));
    const actions = element("td", "is-number progress-row-actions");
    const open = element("button", "text-button", "Open ›");
    open.type = "button";
    open.dataset.progressOpen = String(session.id);
    open.title = "Open this ride on the other pages";
    const remove = element("button", "text-button", "Remove");
    remove.type = "button";
    remove.dataset.progressRemove = String(session.id);
    actions.append(open, remove);
    row.append(actions);
    body.append(row);
  });
  $("#progressTable").replaceChildren(head, body);
  drawProgressCharts();
}

function bindProgressInteractions() {
  const progressInput = $("#progressInput");
  const choose = () => progressInput.click();
  $("#progressChooseButton").addEventListener("click", choose);
  $("#progressAddButton").addEventListener("click", choose);
  progressInput.addEventListener("change", () => {
    const files = [...(progressInput.files ?? [])];
    progressInput.value = "";
    addProgressFiles(files);
  });
  $("#progressClearButton").addEventListener("click", () => {
    progressState.sessions = [];
    progressState.hoveredIndex = null;
    setProgressStatus([]);
    renderProgress();
  });

  // Files can also be dropped anywhere on the page.
  ["dragenter", "dragover"].forEach((name) => progressPage.addEventListener(name, (event) => {
    event.preventDefault();
    progressPage.classList.add("is-dragging");
  }));
  ["dragleave", "drop"].forEach((name) => progressPage.addEventListener(name, (event) => {
    event.preventDefault();
    progressPage.classList.remove("is-dragging");
  }));
  progressPage.addEventListener("drop", (event) => addProgressFiles([...(event.dataTransfer?.files ?? [])].filter((file) => /\.fit$/i.test(file.name))));

  const menu = $("#progressMenu");
  $("#progressMenuPanel").addEventListener("change", (event) => {
    const key = event.target.dataset?.progressMetric;
    if (!key) return;
    if (event.target.checked) progressState.selected.add(key);
    else progressState.selected.delete(key);
    renderProgress();
    ensureProgressWind();
  });
  $("#progressMenuPanel").addEventListener("click", (event) => {
    if (!event.target.dataset?.progressReset) return;
    progressState.selected = new Set(DEFAULT_PROGRESS_METRICS);
    renderProgress();
  });
  document.addEventListener("click", (event) => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) menu.open = false;
  });

  $("#progressGrid").addEventListener("click", (event) => {
    const key = event.target.dataset?.progressHide;
    if (!key) return;
    progressState.selected.delete(key);
    renderProgress();
  });
  $("#progressGrid").addEventListener("pointermove", (event) => {
    const card = progressState.cards.find((entry) => entry.canvas === event.target);
    if (!card?.x || !progressState.sessions.length) return setProgressHover(null);
    const { x } = canvasPointerPosition(card.canvas, event);
    const nearest = progressState.sessions.reduce((best, _, index) => (Math.abs(card.x(index) - x) < Math.abs(card.x(best) - x) ? index : best), 0);
    return setProgressHover(nearest);
  });
  $("#progressGrid").addEventListener("pointerleave", () => setProgressHover(null));

  const table = $("#progressTable");
  table.addEventListener("pointerover", (event) => {
    const row = event.target.closest("tr[data-progress-index]");
    setProgressHover(row ? Number(row.dataset.progressIndex) : null);
  });
  table.addEventListener("pointerleave", () => setProgressHover(null));
  table.addEventListener("click", (event) => {
    const { progressOpen, progressRemove } = event.target.dataset ?? {};
    const session = progressState.sessions.find((entry) => String(entry.id) === (progressOpen ?? progressRemove));
    if (!session) return;
    if (progressOpen) return openProgressSession(session);
    progressState.sessions = progressState.sessions.filter((entry) => entry !== session);
    progressState.hoveredIndex = null;
    return renderProgress();
  });
}

function activePage() {
  const page = window.location.hash.slice(1);
  return ["overview", "speed-effort", "track-water", "ride-segments", "coaching", "progress"].includes(page) ? page : "overview";
}

function updatePage() {
  const page = activePage();
  const overviewActive = page === "overview";
  const analysisActive = page === "speed-effort";
  const segmentsActive = page === "ride-segments";
  const coachingActive = page === "coaching";
  const trackWaterActive = page === "track-water";
  setText("#pageLabel", { overview: "overview", "speed-effort": "session overview", "track-water": "track & water", "ride-segments": "ride segments", coaching: "coaching", progress: "progress" }[page]);
  const progressActive = page === "progress";
  progressPage.classList.toggle("hidden", !progressActive);
  if (progressActive && isDemoMode) loadProgressDemo();
  document.querySelectorAll("[data-page]").forEach((link) => link.classList.toggle("active", link.dataset.page === page));
  overviewIntro.classList.toggle("hidden", !overviewActive);
  emptyState.classList.toggle("hidden", !overviewActive || Boolean(currentActivity));
  dashboard.classList.toggle("hidden", !overviewActive || !currentActivity);
  speedEffortPage.classList.toggle("hidden", !analysisActive);
  analysisEmpty.classList.toggle("hidden", Boolean(currentActivity) || !analysisActive);
  analysisBody.classList.toggle("hidden", !currentActivity || !analysisActive);
  rideSegmentsPage.classList.toggle("hidden", !segmentsActive);
  rideSegmentsEmpty.classList.toggle("hidden", Boolean(currentActivity) || !segmentsActive);
  rideSegmentsBody.classList.toggle("hidden", !currentActivity || !segmentsActive);
  coachingPage.classList.toggle("hidden", !coachingActive);
  coachingEmpty.classList.toggle("hidden", Boolean(currentActivity) || !coachingActive);
  coachingBody.classList.toggle("hidden", !currentActivity || !coachingActive);
  trackWaterPage.classList.toggle("hidden", !trackWaterActive);
  trackWaterEmpty.classList.toggle("hidden", Boolean(currentActivity) || !trackWaterActive);
  trackWaterBody.classList.toggle("hidden", !currentActivity || !trackWaterActive);
  if (currentActivity || progressActive) scheduleVisualRender();
}

function scheduleVisualRender() {
  if (visualFrame !== null) return;
  visualFrame = requestAnimationFrame(() => {
    visualFrame = null;
    const page = activePage();
    if (page === "progress") {
      renderProgress();
      return;
    }
    if (!currentActivity) return;
    if (page === "speed-effort") renderAnalysis(currentActivity);
    else if (page === "ride-segments") renderRideSegments(currentActivity);
    else if (page === "coaching") renderCoaching(currentActivity);
    else if (page === "track-water") renderTrackWater(currentActivity);
    else renderCharts(currentActivity);
  });
}

function renderInventory(activity) {
  const body = $("#inventoryBody");
  const descriptions = {
    session: "One summary row for the activity",
    record: "Speed, effort, GPS, and sensor samples",
    lap: "Lap-level splits and totals",
    event: "State changes and activity events",
    device_info: "Device and battery information",
    weather_conditions: "Weather observations saved with the activity",
    activity: "Activity file summary",
    suunto_field_description: "Labels, units, and base types for developer fields",
    suunto_developer_id: "Developer data namespaces and application IDs",
  };
  const baseTypeNames = ["enum", "sint8", "uint8", "sint16", "uint16", "sint32", "uint32", "string", "float32", "float64", "uint8z", "uint16z", "uint32z", "byte", "sint64", "uint64", "uint64z"];
  const inventoryValue = (value, detail) => {
    if (Array.isArray(value)) return value.length > 10 ? `${number(value.length)} items` : `[${value.join(", ")}]`;
    if (value === null || value === undefined) return "not recorded";
    if (detail.name === "timestamp" || detail.name === "start_time" || detail.name === "time_created") return formatDate(value);
    if (detail.name.includes("elapsed_time") || detail.name.includes("timer_time")) return formatDuration(value);
    if (detail.name.includes("distance")) return formatDistance(value);
    if (detail.name.includes("speed")) return formatSpeed(value);
    if (typeof value === "number") return number(value, Number.isInteger(value) ? 0 : 3);
    return String(value);
  };
  const fieldDetailsFor = (globalNumber) => {
    const details = new Map();
    activity.messages.filter((message) => message.globalNumber === globalNumber).forEach((message) => {
      Object.entries(message.fieldDetails ?? {}).forEach(([name, detail]) => {
        if (!details.has(name)) details.set(name, detail);
      });
    });
    return [...details.values()].sort((a, b) => a.fieldNumber - b.fieldNumber || a.name.localeCompare(b.name));
  };
  const makeCell = (text, className = "") => {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = text;
    return cell;
  };
  body.replaceChildren();
  activity.messageTypes.filter((type) => type.globalNumber !== 0).sort((a, b) => b.count - a.count).forEach((type) => {
    const sectionMessages = activity.messages.filter((message) => message.globalNumber === type.globalNumber);
    const showValues = type.globalNumber !== 20 && type.count <= 10;
    const row = document.createElement("tr");
    const messageCell = document.createElement("td");
    const messageName = document.createElement("span");
    messageName.className = "message-name";
    messageName.textContent = type.name;
    const messageNumber = document.createElement("span");
    messageNumber.className = "message-number";
    messageNumber.textContent = `#${type.globalNumber}`;
    messageCell.append(messageName, messageNumber);
    row.append(messageCell);
    row.append(makeCell(descriptions[type.name] ?? "FIT message"));
    const countCell = makeCell("");
    countCell.className = "table-number";
    const count = document.createElement("strong");
    count.textContent = number(type.count);
    countCell.append(count);
    row.append(countCell);

    const fieldsCell = document.createElement("td");
    const sectionSummary = document.createElement("p");
    sectionSummary.className = "field-summary";
    sectionSummary.textContent = type.globalNumber === 20
      ? `${number(type.count)} time-series points; values omitted in the overview.`
      : type.count > 10
        ? `${number(type.count)} messages; values omitted to keep this section readable.`
        : `${number(type.count)} message${type.count === 1 ? "" : "s"}; representative values shown below.`;
    fieldsCell.append(sectionSummary);
    const fieldList = document.createElement("div");
    fieldList.className = "field-list";
    fieldDetailsFor(type.globalNumber).forEach((detail) => {
      const field = document.createElement("span");
      field.className = `field-token${detail.developer ? " developer-field" : ""}`;
      const typeNumber = typeof detail.baseType === "number" ? detail.baseType & 0x1f : null;
      const typeLabel = typeNumber === null ? "unknown FIT type" : baseTypeNames[typeNumber] ?? `type ${typeNumber}`;
      const units = detail.unit ? ` · ${detail.unit}` : "";
      const fieldName = document.createElement("span");
      fieldName.className = "field-name";
      fieldName.textContent = `${detail.name}${units} · ${typeLabel}`;
      field.append(fieldName);
      if (showValues) {
        const sourceMessage = sectionMessages.find((message) => message.fields[detail.name] !== undefined);
        const value = sourceMessage?.fields[detail.name];
        if (value !== undefined) {
          const fieldValue = document.createElement("span");
          fieldValue.className = "field-value";
          fieldValue.textContent = inventoryValue(value, detail);
          field.append(fieldValue);
        }
      }
      field.title = `${detail.label || detail.name} · ${typeLabel}${detail.developer ? " · developer field" : ""}`;
      fieldList.append(field);
    });
    fieldsCell.append(fieldList);
    row.append(fieldsCell);
    body.append(row);
  });
}

function render(activity, fileName) {
  mapZoomState.delete(mapTiles);
  mapZoomState.delete(analysisMapTiles);
  mapZoomState.delete(segmentsMapTiles);
  mapZoomState.delete(trackWaterMapTiles);
  mapZoomState.delete(coachingMapTiles);
  mapPanState.delete(mapTiles);
  mapPanState.delete(analysisMapTiles);
  mapPanState.delete(segmentsMapTiles);
  mapPanState.delete(trackWaterMapTiles);
  mapPanState.delete(coachingMapTiles);
  mapLayoutCache.delete(mapTiles);
  mapLayoutCache.delete(analysisMapTiles);
  mapLayoutCache.delete(segmentsMapTiles);
  mapLayoutCache.delete(trackWaterMapTiles);
  mapLayoutCache.delete(coachingMapTiles);
  currentActivity = summarize(activity);
  currentActivity.segmentation = segmentTrack(currentActivity.records);
  analysisSelectionIndex = null;
  selectedSegmentIndex = null;
  segmentRenderState = { map: null };
  coachingRenderState = { marks: [], mapMarks: [], hoveredTurn: null, coaching: null };
  trackWaterRenderState = emptyTrackWaterState(trackWaterRenderState.mode);
  analysisMapFocus = null;
  updateCoachingFocusUI();
  const summary = currentActivity;
  summary.wind = pendingWindAnnotation();
  const description = [summary.session, ...activity.messages]
    .map((message) => getField(message, "description"))
    .find((value) => typeof value === "string" && value.trim());
  setText("#fileStatus", fileName);
  setText("#activitySport", activity.isDemo ? "Demo kite surf" : "Kite surf");
  setText("#activityFile", fileName);
  setText("#activityTitle", sessionTitle(summary));
  const deviceName = activity.messages
    .filter((message) => message.globalNumber === 23)
    .map((message) => getField(message, "device_name"))
    .find((value) => typeof value === "string" && value.trim());
  setText("#activityDevice", deviceName || "Device not recorded");
  setText("#activityDate", formatDate(summary.starts));
  setText("#activityDescription", description || "");
  $("#activityNote").classList.toggle("hidden", !description);
  setText("#metricDuration", formatDuration(summary.duration));
  setText("#metricTimer", summary.timer && summary.duration && summary.timer !== summary.duration ? `${formatDuration(summary.timer)} moving` : "total session");
  setText("#metricDistance", formatDistance(summary.distance));
  setText("#metricAvgSpeed", formatSpeed(summary.avgSpeed));
  setText("#metricMaxSpeed", `max ${formatSpeed(summary.maxSpeed)}`);
  setText("#metricHeartRate", summary.avgHeartRate === null ? "—" : `${number(summary.avgHeartRate)} bpm`);
  setText("#metricMaxHeartRate", `max ${summary.maxHeartRate === null ? "—" : `${number(summary.maxHeartRate)} bpm`}`);
  setText("#effortTss", summary.trainingStressScore === null ? "—" : `${number(summary.trainingStressScore, 1)} TSS`);
  setText("#effortTrainingEffect", summary.trainingEffect === null ? "—" : number(summary.trainingEffect, 1));
  setText("#effortEpoc", summary.peakEpoc === null ? "—" : number(summary.peakEpoc, 1));
  setText("#effortRecovery", summary.recoveryTime === null ? "—" : formatDuration(summary.recoveryTime));
  const recoveryEnd = summary.recoveryTime !== null && summary.ends !== null ? summary.ends + summary.recoveryTime : null;
  setText("#effortRecoveryEnd", recoveryEnd === null ? "recovery end unavailable" : `relax until ${formatDate(recoveryEnd)}`);
  ["#effortZone1", "#effortZone2", "#effortZone3", "#effortZone4", "#effortZone5"].forEach((selector, index) => {
    const seconds = summary.heartRateZoneSeconds?.[index];
    setText(selector, seconds === undefined ? "—" : formatDuration(seconds));
  });
  setText("#detailTimeRange", formatTimeRange(summary.starts, summary.ends));
  setText("#detailDuration", formatDurationClock(summary.calculatedDuration));
  setText("#detailCalories", summary.calories === null ? "not recorded" : `${number(summary.calories)} kcal`);
  setText("#detailCarbs", summary.carbs === null ? "not recorded" : `${number(summary.carbs, 1)} g`);
  setText("#detailFat", summary.fat === null ? "not recorded" : `${number(summary.fat, 1)} g`);
  setText("#detailFeeling", formatFeeling(summary.feeling));
  setText("#detailFatRatio", summary.fatRatio === null ? "not recorded" : `${number(summary.fatRatio, 1)}%`);
  setText("#detailAvgNgp", summary.avgNgp === null ? "not recorded" : formatSpeed(summary.avgNgp));
  setText("#decoderNote", summary.calories === null
    ? "This export has no usable calorie data. The parser keeps missing FIT values blank instead of inventing a total."
    : "Unknown fields and developer fields are preserved in the in-memory activity model for future pages.");
  renderInventory(activity);
  renderWindPanels(summary);
  updatePage();
  scheduleVisualRender();
}

async function annotateWind(activity) {
  const request = ++windAnnotationRequest;
  try {
    const wind = await resolveWindAnnotation(activity);
    if (request !== windAnnotationRequest || currentActivity?.activity !== activity) return;
    currentActivity.wind = activity.isDemo ? { ...wind, isDemo: true } : wind;
    renderWindPanels(currentActivity);
    scheduleVisualRender();
  } catch (error) {
    if (request !== windAnnotationRequest || currentActivity?.activity !== activity) return;
    currentActivity.wind = {
      status: "unavailable",
      coverage: { timestampCount: 0, coveredRecordCount: 0, ratio: 0, complete: false },
      error: error.message || "Wind annotation is unavailable.",
      ...(activity.isDemo ? { isDemo: true } : {}),
    };
    renderWindPanels(currentActivity);
    scheduleVisualRender();
  }
}

async function loadFile(file, name = file.name) {
  hideError();
  let activity;
  try {
    activity = decodeFit(await file.arrayBuffer());
    if (!activity.messages.length) throw new Error("The FIT file contains no data messages.");
  } catch (error) {
    showError(error);
    return;
  }
  render(activity, name || "selected.fit");
  annotateWind(activity);
}

input.addEventListener("change", () => {
  if (input.files?.[0]) loadFile(input.files[0]);
});
$("#newFileButton").addEventListener("click", () => input.click());
$("#analysisLoadButton").addEventListener("click", () => input.click());
$("#segmentsLoadButton").addEventListener("click", () => input.click());
$("#coachingLoadButton").addEventListener("click", () => input.click());
$("#trackWaterLoadButton").addEventListener("click", () => input.click());
$("#dismissError").addEventListener("click", hideError);
inventoryToggle.addEventListener("click", () => {
  const expanded = inventoryToggle.getAttribute("aria-expanded") === "true";
  inventoryTableWrap.classList.toggle("hidden", expanded);
  inventoryToggle.setAttribute("aria-expanded", String(!expanded));
  inventoryToggle.textContent = expanded ? "Show inventory" : "Hide inventory";
});
document.querySelectorAll("[data-map-zoom]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.mapZoom === "fit") fitMapToTrack(button.dataset.mapZoomTarget);
    else changeMapZoom(button.dataset.mapZoomTarget, button.dataset.mapZoom === "in" ? 1 : -1);
  });
});
document.querySelectorAll("[data-map-focus]").forEach((tile) => {
  tile.addEventListener("click", () => focusAnalysisMap(tile.dataset.mapFocus));
  tile.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    focusAnalysisMap(tile.dataset.mapFocus);
  });
});
window.addEventListener("hashchange", updatePage);

["dragenter", "dragover"].forEach((eventName) => emptyState.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropTarget.classList.add("dragging");
}));
["dragleave", "drop"].forEach((eventName) => emptyState.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropTarget.classList.remove("dragging");
}));
emptyState.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files?.[0];
  if (file) loadFile(file);
});

window.addEventListener("resize", () => {
  if (currentActivity || activePage() === "progress") scheduleVisualRender();
});

bindAnalysisInteractions();
bindSegmentInteractions();
bindCoachingInteractions();
bindProgressInteractions();
bindTrackWaterInteractions();
bindMapPanning(analysisMapCanvas, analysisMapTiles);
bindMapPanning(segmentsMapCanvas, segmentsMapTiles);
bindMapPanning(trackWaterMapCanvas, trackWaterMapTiles);
bindMapPanning(coachingMapCanvas, coachingMapTiles);

if (isDemoMode) {
  const demoActivity = createDemoActivity();
  render(demoActivity, "synthetic-el-gouna-kite-session.fit");
  annotateWind(demoActivity);
} else {
  updatePage();
}
