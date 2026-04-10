import * as yaml from "js-yaml";
import { TrackerConfig, ChartType, AggregateType, ParseError } from "./types";

// ─── Valid Values ─────────────────────────────────────────────────────────────

const VALID_CHART_TYPES: ChartType[] = [
  "line", "bar", "pie", "donut", "heatmap",
  "scatter", "radar", "gauge", "candlestick", "calendar", "summary",
];

const VALID_AGGREGATES: AggregateType[] = [
  "daily", "weekly", "monthly", "cumulative", "moving-average",
];

// ─── Date Range Parser ────────────────────────────────────────────────────────

export function parseDateRange(
  range: string
): { start: Date; end: Date } | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const match = range.match(/^last-(\d+)-(days?|weeks?|months?|years?)$/);
  if (match) {
    const n = parseInt(match[1]);
    const unit = match[2].replace(/s$/, "");
    const start = new Date(today);
    if (unit === "day") start.setDate(today.getDate() - n);
    else if (unit === "week") start.setDate(today.getDate() - n * 7);
    else if (unit === "month") start.setMonth(today.getMonth() - n);
    else if (unit === "year") start.setFullYear(today.getFullYear() - n);
    return { start, end: today };
  }

  if (range === "this-year") {
    return {
      start: new Date(today.getFullYear(), 0, 1),
      end: today,
    };
  }
  if (range === "this-month") {
    return {
      start: new Date(today.getFullYear(), today.getMonth(), 1),
      end: today,
    };
  }
  if (range === "this-week") {
    const day = today.getDay();
    const start = new Date(today);
    start.setDate(today.getDate() - day);
    return { start, end: today };
  }
  if (range === "last-year") {
    return {
      start: new Date(today.getFullYear() - 1, 0, 1),
      end: new Date(today.getFullYear() - 1, 11, 31),
    };
  }
  if (range === "all") {
    return {
      start: new Date(2000, 0, 1),
      end: today,
    };
  }

  return null;
}

// ─── Config Validation ────────────────────────────────────────────────────────

function validateConfig(
  raw: Record<string, unknown>
): { config: TrackerConfig; errors: ParseError[] } {
  const errors: ParseError[] = [];

  // type
  if (!raw.type) {
    errors.push({ message: "Missing required field: type" });
  } else if (!VALID_CHART_TYPES.includes(raw.type as ChartType)) {
    errors.push({
      message: `Unknown chart type "${raw.type}". Valid types: ${VALID_CHART_TYPES.join(", ")}`,
    });
  }

  // data source
  if (!raw.folder && !raw.file && !raw.files) {
    errors.push({
      message: "Must specify at least one of: folder, file, or files",
    });
  }

  // properties (not required for summary — presence of files is enough)
  if (raw.type !== "summary" && raw.source !== "fileMeta") {
    if (!raw.properties) {
      errors.push({ message: "Missing required field: properties" });
    } else if (raw.type === "candlestick") {
      const p = raw.properties as Record<string, string>;
      if (!p.open || !p.high || !p.low || !p.close) {
        errors.push({
          message: 'Candlestick requires properties with keys: open, high, low, close',
        });
      }
    } else if (!Array.isArray(raw.properties)) {
      errors.push({
        message: "properties must be a list (e.g. properties:\\n  - mood)",
      });
    }
  }

  // aggregate
  if (raw.aggregate && !VALID_AGGREGATES.includes(raw.aggregate as AggregateType)) {
    errors.push({
      message: `Unknown aggregate "${raw.aggregate}". Valid: ${VALID_AGGREGATES.join(", ")}`,
    });
  }

  // gauge: min/max
  if (raw.type === "gauge") {
    if (raw.min === undefined || raw.max === undefined) {
      errors.push({ message: "Gauge charts require min and max fields" });
    }
  }

  const config = raw as unknown as TrackerConfig;

  // Apply defaults
  if (!config.aggregate) config.aggregate = "daily";
  if (!config.period) config.period = 7;
  if (config.showLegend === undefined) config.showLegend = true;
  if (!config.missingValue) config.missingValue = "skip";
  if (!config.colorScheme) config.colorScheme = "green";
  if (!config.height) config.height = 300;

  return { config, errors };
}

// ─── Main Parser ─────────────────────────────────────────────────────────────

export function parseTrackerConfig(
  source: string
): { config: TrackerConfig | null; errors: ParseError[] } {
  let raw: Record<string, unknown>;

  try {
    raw = yaml.load(source) as Record<string, unknown>;
  } catch (e: unknown) {
    const yamlError = e as { mark?: { line?: number }; message?: string };
    return {
      config: null,
      errors: [
        {
          message: `YAML parse error: ${yamlError?.message ?? String(e)}`,
          line: yamlError?.mark?.line,
        },
      ],
    };
  }

  if (!raw || typeof raw !== "object") {
    return {
      config: null,
      errors: [{ message: "Config block is empty or not valid YAML" }],
    };
  }

  const { config, errors } = validateConfig(raw);

  if (errors.length > 0) {
    return { config: null, errors };
  }

  return { config, errors: [] };
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

export function resolveStartEnd(
  config: TrackerConfig
): { start: Date; end: Date } {
  if (config.startDate && config.endDate) {
    // Parse ISO date strings as local midnight, not UTC
    const parseLocal = (s: string) => {
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
    };
    return {
      start: parseLocal(config.startDate),
      end:   parseLocal(config.endDate),
    };
  }
  if (config.dateRange) {
    const resolved = parseDateRange(config.dateRange);
    if (resolved) return resolved;
  }
  // Default: last 30 days
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 30);
  return { start, end };
}
