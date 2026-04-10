import { SeriesData, DataPoint, AggregateType } from "./types";

// ─── Bucket Key Helpers ───────────────────────────────────────────────────────

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dailyKey(d: Date): string {
  return localDateKey(d);
}

function weekKey(d: Date): string {
  const tmp = new Date(d);
  tmp.setDate(d.getDate() - d.getDay()); // Sunday start
  return localDateKey(tmp);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Bucket Aggregator ────────────────────────────────────────────────────────

function bucketAggregate(
  points: DataPoint[],
  keyFn: (d: Date) => string
): DataPoint[] {
  const buckets = new Map<string, { sum: number; count: number; date: Date }>();

  for (const pt of points) {
    if (pt.value === null) continue;
    const key = keyFn(pt.date);
    const existing = buckets.get(key);
    if (existing) {
      existing.sum += pt.value;
      existing.count++;
    } else {
      buckets.set(key, { sum: pt.value, count: 1, date: pt.date });
    }
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({
      date: v.date,
      value: v.sum / v.count,
    }));
}

// ─── Cumulative ───────────────────────────────────────────────────────────────

function cumulativeAggregate(points: DataPoint[]): DataPoint[] {
  let running = 0;
  return points
    .filter((p) => p.value !== null)
    .map((p) => {
      running += p.value as number;
      return { date: p.date, value: running };
    });
}

// ─── Moving Average ───────────────────────────────────────────────────────────

function movingAverageAggregate(points: DataPoint[], period: number): DataPoint[] {
  const valid = points.filter((p) => p.value !== null) as Array<DataPoint & { value: number }>;
  if (valid.length === 0) return [];

  return valid.map((pt, i) => {
    const window = valid.slice(Math.max(0, i - period + 1), i + 1);
    const avg = window.reduce((s, p) => s + p.value, 0) / window.length;
    return { date: pt.date, value: avg };
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function aggregateSeries(
  series: SeriesData,
  type: AggregateType,
  period = 7
): SeriesData {
  let aggregated: DataPoint[];

  switch (type) {
    case "daily":
      aggregated = bucketAggregate(series.points, dailyKey);
      break;
    case "weekly":
      aggregated = bucketAggregate(series.points, weekKey);
      break;
    case "monthly":
      aggregated = bucketAggregate(series.points, monthKey);
      break;
    case "cumulative":
      aggregated = cumulativeAggregate(series.points);
      break;
    case "moving-average":
      aggregated = movingAverageAggregate(series.points, period);
      break;
    default:
      aggregated = series.points;
  }

  return { ...series, points: aggregated };
}

export function aggregateAllSeries(
  allSeries: SeriesData[],
  type: AggregateType,
  period = 7
): SeriesData[] {
  return allSeries.map((s) => aggregateSeries(s, type, period));
}

// ─── Date Label Formatter ─────────────────────────────────────────────────────

export function formatDateLabel(date: Date, aggregate: AggregateType): string {
  const opts: Intl.DateTimeFormatOptions = { timeZone: "UTC" };

  switch (aggregate) {
    case "monthly":
      return date.toLocaleDateString("en-US", { ...opts, year: "numeric", month: "short" });
    case "weekly":
      return "Wk " + date.toLocaleDateString("en-US", { ...opts, month: "short", day: "numeric" });
    default:
      return date.toLocaleDateString("en-US", { ...opts, month: "short", day: "numeric" });
  }
}
