// ─── Chart Types ────────────────────────────────────────────────────────────

export type ChartType =
  | "line"
  | "bar"
  | "pie"
  | "donut"
  | "heatmap"
  | "scatter"
  | "radar"
  | "gauge"
  | "candlestick"
  | "calendar"
  | "summary"
  | "table"
  | "daily-table";

// ─── Aggregation ─────────────────────────────────────────────────────────────

export type AggregateType =
  | "daily"
  | "weekly"
  | "monthly"
  | "cumulative"
  | "moving-average";

// ─── Axis Configuration ───────────────────────────────────────────────────────

export interface AxisConfig {
  label?: string;
  min?: number;
  max?: number;
  unit?: string;
}

// ─── Candlestick Property Mapping ─────────────────────────────────────────────

export interface CandlestickProperties {
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

// ─── Main Config Block ────────────────────────────────────────────────────────
// This is what users write inside ```tracker ... ``` code fences.

export interface TrackerConfig {
  // Required
  type: ChartType;

  // Data source — at least one of folder/file/files must be set
  folder?: string;
  file?: string;
  files?: string[];

  // Date range — shorthand string OR explicit start/end
  dateRange?: string; // e.g. "last-30-days", "this-year", "last-3-months"
  startDate?: string; // ISO date: 2024-01-01
  endDate?: string;   // ISO date: 2024-12-31

  // Properties to pull from frontmatter.
  // For most charts: string[] e.g. ["mood", "energy"]
  // For candlestick: CandlestickProperties object
  properties: string[] | CandlestickProperties;

  // Aggregation
  aggregate?: AggregateType;   // default: "daily"
  period?: number;              // window size for moving-average (default: 7)

  // Visuals
  title?: string;
  subtitle?: string;
  colors?: string[];            // per-series hex colors
  width?: string;               // CSS width e.g. "100%", "400px"
  height?: number;              // px

  // Axis options (line / bar / scatter)
  xAxis?: AxisConfig;
  yAxis?: AxisConfig;

  // Heatmap specific
  colorScheme?: "green" | "blue" | "red" | "orange" | "purple";

  // Gauge specific
  min?: number;
  max?: number;
  thresholds?: { value: number; color: string }[];

  // Radar specific
  labels?: string[];            // explicit labels when property names aren't enough

  // Calendar specific
  dateProperty?: string;        // frontmatter key that holds the date (default: uses file date)

  // Misc
  showLegend?: boolean;
  summary?: { template?: string };

  // FileMeta source
  source?: "frontmatter" | "fileMeta";
  target?: string;  // e.g. "numWords", "numChars", "numSentences", "numLinks", "size"
  missingValue?: number | "skip" | "zero"; // how to handle nulls (default: "skip")

  // Table chart
  groupBy?: string;             // frontmatter key to group rows by
  groupLabel?: string;          // header label for the group column (default: groupBy)
  columns?: TableColumnDef[];   // column definitions

  // Daily-table chart
  rows?: (string | { label: string; key: string })[];  // meal row definitions
  totalRow?: string;            // label for per-day total row (omit to hide)
  showEmptyRows?: boolean;      // show rows with zero values (default: true)
  dateFormat?: string;          // moment.js format for the date column (default: MM/DD/YY)
}

// ─── Internal Data Structures ─────────────────────────────────────────────────

export interface RawEntry {
  date: Date;
  filePath: string;
  frontmatter: Record<string, unknown>;
}

export interface DataPoint {
  date: Date;
  value: number | null;
}

export interface SeriesData {
  name: string;
  points: DataPoint[];
  color?: string;
}

export interface OHLCDataPoint {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface ParseError {
  message: string;
  line?: number;
}

// ─── Table Column Definition ──────────────────────────────────────────────────

export interface TableColumnDef {
  label: string;
  value: string; // "count" | "sum(prop)" | "mean(prop)" | "max(prop)" | "min(prop)"
}
