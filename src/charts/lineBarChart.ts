import { Chart, ChartConfiguration } from "chart.js/auto";
import { SeriesData, TrackerConfig } from "../types";
import { formatDateLabel } from "../aggregator";
import { parseTimeToSeconds, formatSecondsAsTime } from "../utils";

// ─── Shared Label Builder ─────────────────────────────────────────────────────

function buildLabels(series: SeriesData[], config: TrackerConfig): string[] {
  const dates = series[0]?.points.map((p) => p.date) ?? [];
  return dates.map((d) => formatDateLabel(d, config.aggregate ?? "daily"));
}

// ─── Smart Y-axis Min (Line Chart) ────────────────────────────────────────────
// When the user hasn't set an explicit yAxis.min, find the data minimum and
// subtract 10% of the range so small variations (e.g. weight) are clearly
// visible rather than appearing as a flat line near the top of a 0-based axis.
// Falls back to 0 when data starts at zero, or returns a slight buffer below a
// flat line.

function computeLineYMin(
  series: SeriesData[],
  explicitMin: number | undefined
): number | undefined {
  if (explicitMin !== undefined && explicitMin !== null) return explicitMin;

  let dataMin = Infinity;
  let dataMax = -Infinity;

  for (const s of series) {
    for (const p of s.points) {
      if (p.value === null) continue;
      if (p.value < dataMin) dataMin = p.value;
      if (p.value > dataMax) dataMax = p.value;
    }
  }

  if (!isFinite(dataMin) || !isFinite(dataMax)) return undefined;
  if (dataMin === 0) return 0;

  const range = dataMax - dataMin;
  if (range === 0) return dataMin * 0.95; // flat line: add a little space below

  return dataMin - range * 0.10;
}

// ─── Line Chart ───────────────────────────────────────────────────────────────

// Resolve a yAxis bound that may be a plain number or a mm:ss string
function resolveAxisBound(raw: unknown, isTimeFmt: boolean): number | undefined {
  if (typeof raw === "number") return raw;
  if (isTimeFmt && typeof raw === "string") return parseTimeToSeconds(raw) ?? undefined;
  return undefined;
}

export function renderLineChart(
  canvas: HTMLCanvasElement,
  series: SeriesData[],
  config: TrackerConfig
): Chart {
  const labels = buildLabels(series, config);
  const isTimeFmt = series.some(s => s.isTimeFormat);
  const resolvedMin = resolveAxisBound((config.yAxis as any)?.min, isTimeFmt);
  const resolvedMax = resolveAxisBound((config.yAxis as any)?.max, isTimeFmt);
  const yMin = computeLineYMin(series, resolvedMin);
  const unit = config.yAxis?.unit ?? "";

  const chartConfig: ChartConfiguration = {
    type: "line",
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.name,
        data: s.points.map((p) => p.value),
        borderColor: s.color,
        backgroundColor: s.color + "22",
        tension: 0.3,
        fill: false,
        pointRadius: labels.length > 60 ? 0 : 3,
        spanGaps: config.missingValue === "skip",
      })),
    },
    options: {
      responsive: true,
      animation: false,
      plugins: {
        title: {
          display: !!config.title,
          text: config.title ?? "",
          font: { size: 14, weight: "bold" },
        },
        subtitle: {
          display: !!config.subtitle,
          text: config.subtitle ?? "",
        },
        legend: { display: config.showLegend ?? true },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = ctx.parsed.y;
              const formatted = isTimeFmt ? formatSecondsAsTime(val) : val?.toFixed(2);
              return `${ctx.dataset.label}: ${formatted}${unit}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: {
            display: !!config.xAxis?.label,
            text: config.xAxis?.label ?? "",
          },
        },
        y: {
          title: {
            display: !!config.yAxis?.label,
            text: config.yAxis?.label ?? "",
          },
          min: yMin,
          max: resolvedMax,
          ticks: isTimeFmt
            ? { callback: (val) => formatSecondsAsTime(val as number) }
            : {},
        },
      },
    },
  };

  return new Chart(canvas, chartConfig);
}

// ─── Bar Chart ────────────────────────────────────────────────────────────────

export function renderBarChart(
  canvas: HTMLCanvasElement,
  series: SeriesData[],
  config: TrackerConfig
): Chart {
  const labels = buildLabels(series, config);
  const isTimeFmt = series.some(s => s.isTimeFormat);
  const resolvedMin = resolveAxisBound((config.yAxis as any)?.min, isTimeFmt);
  const resolvedMax = resolveAxisBound((config.yAxis as any)?.max, isTimeFmt);
  const unit = config.yAxis?.unit ?? "";

  const chartConfig: ChartConfiguration = {
    type: "bar",
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.name,
        data: s.points.map((p) => p.value),
        backgroundColor: s.color + "cc",
        borderColor: s.color,
        borderWidth: 1,
        borderRadius: 3,
      })),
    },
    options: {
      responsive: true,
      animation: false,
      plugins: {
        title: {
          display: !!config.title,
          text: config.title ?? "",
          font: { size: 14, weight: "bold" },
        },
        subtitle: { display: !!config.subtitle, text: config.subtitle ?? "" },
        legend: { display: (config.showLegend ?? true) && series.length > 1 },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = ctx.parsed.y;
              const formatted = isTimeFmt ? formatSecondsAsTime(val) : val?.toFixed(2);
              return `${ctx.dataset.label}: ${formatted}${unit}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: !!config.xAxis?.label, text: config.xAxis?.label ?? "" },
          stacked: false,
        },
        y: {
          title: { display: !!config.yAxis?.label, text: config.yAxis?.label ?? "" },
          min: resolvedMin,
          max: resolvedMax,
          stacked: false,
          ticks: isTimeFmt
            ? { callback: (val) => formatSecondsAsTime(val as number) }
            : {},
        },
      },
    },
  };

  return new Chart(canvas, chartConfig);
}
