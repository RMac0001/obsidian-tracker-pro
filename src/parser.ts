import * as yaml from "js-yaml";
import { TrackerConfig, ChartType, AggregateType, ParseError } from "./types";
import { resolveColor, parseConfigDate, toYMD } from "./utils";

// ─── Valid Values ─────────────────────────────────────────────────────────────

const VALID_CHART_TYPES: ChartType[] = [
  "line", "bar", "pie", "donut", "heatmap",
  "scatter", "radar", "gauge", "candlestick", "calendar", "summary", "table", "daily-table", "bills", "reading-challenge", "vitamins", "achievements",
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
  if (range === "today") {
    return { start: today, end: today };
  }
  if (range === "last-week") {
    const day = today.getDay();
    const end = new Date(today);
    end.setDate(today.getDate() - day - 1); // last Saturday
    const start = new Date(end);
    start.setDate(end.getDate() - 6);       // previous Sunday
    return { start, end };
  }
  if (range === "last-month") {
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return { start, end };
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

  // data source (bills, reading-challenge, and vitamins manage their own vault paths)
  if (raw.type !== "bills" && raw.type !== "reading-challenge" && raw.type !== "vitamins" && raw.type !== "achievements" && !raw.folder && !raw.file && !raw.files) {
    errors.push({
      message: "Must specify at least one of: folder, file, or files",
    });
  }

  // properties (not required for summary, table, daily-table, bills, or reading-challenge)
  if (raw.type !== "summary" && raw.type !== "table" && raw.type !== "daily-table" && raw.type !== "bills" && raw.type !== "reading-challenge" && raw.type !== "vitamins" && raw.type !== "achievements" && raw.source !== "fileMeta") {
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

  // startDate / endDate (explicit date range — normalised to YYYY-MM-DD below)
  let parsedStartDate: Date | null = null;
  let parsedEndDate: Date | null = null;

  if (raw.startDate !== undefined) {
    parsedStartDate = parseConfigDate(raw.startDate);
    if (parsedStartDate === null) {
      errors.push({ message: `Invalid startDate "${raw.startDate}" — use YYYY-MM-DD or MM/DD/YYYY` });
    }
  }
  if (raw.endDate !== undefined) {
    parsedEndDate = parseConfigDate(raw.endDate);
    if (parsedEndDate === null) {
      errors.push({ message: `Invalid endDate "${raw.endDate}" — use YYYY-MM-DD or MM/DD/YYYY` });
    }
  }
  if (parsedStartDate && parsedEndDate && parsedStartDate.getTime() > parsedEndDate.getTime()) {
    errors.push({ message: "startDate is after endDate" });
  }

  // gauge: min/max
  if (raw.type === "gauge") {
    if (raw.min === undefined || raw.max === undefined) {
      errors.push({ message: "Gauge charts require min and max fields" });
    }
  }

  // y2Axis (secondary y-axis for line/bar charts)
  if (raw.y2Axis !== undefined) {
    const y2 = raw.y2Axis as Record<string, unknown>;

    if (raw.type !== "line" && raw.type !== "bar") {
      errors.push({
        message: `y2Axis is only supported on "line" and "bar" charts (got type "${raw.type}")`,
      });
    }

    if (!Array.isArray(y2?.properties) || y2.properties.length === 0) {
      errors.push({
        message: "y2Axis.properties is required and must be a non-empty list",
      });
    } else {
      const mainProps = Array.isArray(raw.properties) ? (raw.properties as string[]) : [];
      const y2Props = y2.properties as string[];

      for (const p of y2Props) {
        if (!mainProps.includes(p)) {
          errors.push({
            message: `y2Axis.properties entry "${p}" must also appear in properties`,
          });
        }
      }

      const uniqueY2 = new Set(y2Props);
      if (mainProps.length > 0 && mainProps.every((p) => uniqueY2.has(p))) {
        errors.push({
          message: "y2Axis.properties cannot include every property — at least one must remain on the left axis",
        });
      }
    }

    if (y2?.style !== undefined && y2.style !== "line" && y2.style !== "bar") {
      errors.push({
        message: `y2Axis.style must be "line" or "bar" (got "${y2.style}")`,
      });
    }
  }

  const config = raw as unknown as TrackerConfig;

  if (parsedStartDate) config.startDate = toYMD(parsedStartDate);
  if (parsedEndDate) config.endDate = toYMD(parsedEndDate);

  if (raw.showSource !== undefined) config.showSource = Boolean(raw.showSource);
  if (raw.year !== undefined) config.year = Number(raw.year);
  if (raw.dateSelector !== undefined) config.dateSelector = Boolean(raw.dateSelector);

  // Apply defaults
  if (!config.aggregate) config.aggregate = "daily";
  if (!config.period) config.period = 7;
  if (config.showLegend === undefined) config.showLegend = true;
  if (!config.missingValue) config.missingValue = "skip";
  if (!config.colorScheme) config.colorScheme = "green";
  if (!config.height) config.height = 300;

  // Resolve named colours to hex (colors[] and thresholds[].color)
  const unknownColorError = (name: string) => ({
    message: `Unknown colour "${name}". Use a hex code or one of: red, blue, green, yellow, orange, purple, black.`,
  });

  if (Array.isArray(config.colors)) {
    config.colors = config.colors.map((c) => {
      const resolved = resolveColor(c);
      if (resolved === null) {
        errors.push(unknownColorError(c));
        return c;
      }
      return resolved;
    });
  }

  if (Array.isArray(config.thresholds)) {
    config.thresholds = config.thresholds.map((t) => {
      const resolved = resolveColor(t.color);
      if (resolved === null) {
        errors.push(unknownColorError(t.color));
        return t;
      }
      return { ...t, color: resolved };
    });
  }

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
  if (config.startDate || config.endDate) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // startDate/endDate are normalised to YYYY-MM-DD by validateConfig;
    // parse as local midnight, not UTC.
    const parseLocal = (s: string) => {
      const [y, m, d] = s.split("-").map(Number);
      return new Date(y, m - 1, d);
    };
    return {
      start: config.startDate ? parseLocal(config.startDate) : new Date(2000, 0, 1),
      end:   config.endDate ? parseLocal(config.endDate) : today,
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
