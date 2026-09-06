import { dateFromFit, decodeFit, getField } from "./fit-decoder.js";
import { createDemoActivity } from "./demo-session.js";
import { sectionContainsIndex, segmentTrack } from "./track-segmentation.js";
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
      tile.referrerPolicy = "no-referrer";
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
  setText("#segmentsSummaryCopy", `The track is split into speed-defined sections for comparing active riding, inactive periods, distance, and heart-rate response. Active sections require ${number(segmentation.options.minimumActiveWindows)} consecutive ${number(segmentation.options.windowSeconds)}-second windows above ${formatSpeed(segmentation.options.activeSpeedMps)}; the complete timeline is shown below.`);
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

function activePage() {
  const page = window.location.hash.slice(1);
  return ["overview", "speed-effort", "ride-segments"].includes(page) ? page : "overview";
}

function updatePage() {
  const page = activePage();
  const overviewActive = page === "overview";
  const analysisActive = page === "speed-effort";
  const segmentsActive = page === "ride-segments";
  setText("#pageLabel", overviewActive ? "overview" : analysisActive ? "session overview" : "ride segments");
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
  if (currentActivity) scheduleVisualRender();
}

function scheduleVisualRender() {
  if (visualFrame !== null) return;
  visualFrame = requestAnimationFrame(() => {
    visualFrame = null;
    if (!currentActivity) return;
    const page = activePage();
    if (page === "speed-effort") renderAnalysis(currentActivity);
    else if (page === "ride-segments") renderRideSegments(currentActivity);
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
  mapPanState.delete(mapTiles);
  mapPanState.delete(analysisMapTiles);
  mapPanState.delete(segmentsMapTiles);
  mapLayoutCache.delete(mapTiles);
  mapLayoutCache.delete(analysisMapTiles);
  mapLayoutCache.delete(segmentsMapTiles);
  currentActivity = summarize(activity);
  currentActivity.segmentation = segmentTrack(currentActivity.records);
  analysisSelectionIndex = null;
  selectedSegmentIndex = null;
  segmentRenderState = { map: null };
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
  if (currentActivity) scheduleVisualRender();
});

bindAnalysisInteractions();
bindSegmentInteractions();
bindMapPanning(analysisMapCanvas, analysisMapTiles);
bindMapPanning(segmentsMapCanvas, segmentsMapTiles);

if (new URLSearchParams(window.location.search).has("demo")) {
  const demoActivity = createDemoActivity();
  render(demoActivity, "synthetic-el-gouna-kite-session.fit");
  annotateWind(demoActivity);
} else {
  updatePage();
}
