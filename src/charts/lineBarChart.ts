import { Chart, ChartConfiguration } from "chart.js/auto";
import { AxisConfig, SeriesData, TrackerConfig } from "../types";
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

// ─── Axis Resolution (shared by line + bar) ───────────────────────────────────

// Resolve a yAxis bound that may be a plain number or a mm:ss string
function resolveAxisBound(raw: unknown, isTimeFmt: boolean): number | undefined {
  if (typeof raw === "number") return raw;
  if (isTimeFmt && typeof raw === "string") return parseTimeToSeconds(raw) ?? undefined;
  return undefined;
}

interface AxisInfo {
  id: "y" | "y2";
  series: SeriesData[];
  isTimeFmt: boolean;
  min: number | undefined;
  max: number | undefined;
  unit: string;
  label?: string;
  singleColor?: string;
}

// Splits series across the primary (y) and secondary (y2) axes and resolves
// each axis's own isTimeFmt/min/max/unit/label independently. With no
// y2Axis config, this returns a single "y" axis built exactly as before.
function buildAxes(
  series: SeriesData[],
  config: TrackerConfig,
  kind: "line" | "bar"
): AxisInfo[] {
  const y2Conf = config.y2Axis;
  const y2Names = new Set(y2Conf?.properties ?? []);

  const primarySeries = series.filter((s) => !y2Names.has(s.name));
  const secondarySeries = series.filter((s) => y2Names.has(s.name));

  const buildOne = (
    id: "y" | "y2",
    axisSeries: SeriesData[],
    axisConf: AxisConfig | undefined
  ): AxisInfo => {
    const isTimeFmt = axisSeries.some((s) => s.isTimeFormat);
    const resolvedMin = resolveAxisBound((axisConf as any)?.min, isTimeFmt);
    const resolvedMax = resolveAxisBound((axisConf as any)?.max, isTimeFmt);
    const min = kind === "line" ? computeLineYMin(axisSeries, resolvedMin) : resolvedMin;

    return {
      id,
      series: axisSeries,
      isTimeFmt,
      min,
      max: resolvedMax,
      unit: axisConf?.unit ?? "",
      label: axisConf?.label,
      // Only tint an axis when y2Axis is present and that axis holds exactly one series.
      singleColor: y2Conf && axisSeries.length === 1 ? axisSeries[0].color : undefined,
    };
  };

  const axes: AxisInfo[] = [buildOne("y", primarySeries, config.yAxis)];
  if (y2Conf) axes.push(buildOne("y2", secondarySeries, y2Conf));
  return axes;
}

function buildScaleOptions(info: AxisInfo, isLeft: boolean, kind: "line" | "bar"): Record<string, unknown> {
  const ticks: Record<string, unknown> = {};
  if (info.isTimeFmt) ticks.callback = (val: unknown) => formatSecondsAsTime(val as number);
  if (info.singleColor) ticks.color = info.singleColor;

  const title: Record<string, unknown> = {
    display: !!info.label,
    text: info.label ?? "",
  };
  if (info.singleColor) title.color = info.singleColor;

  const scale: Record<string, unknown> = {
    position: isLeft ? "left" : "right",
    title,
    min: info.min,
    max: info.max,
    ticks,
    grid: { drawOnChartArea: isLeft },
  };
  if (kind === "bar") scale.stacked = false;
  return scale;
}

// ─── Dataset Builders (shared by line + bar, including combo override) ───────

function buildDatasets(
  series: SeriesData[],
  config: TrackerConfig,
  kind: "line" | "bar",
  labelsLen: number
): Record<string, unknown>[] {
  const y2Conf = config.y2Axis;
  const y2Names = new Set(y2Conf?.properties ?? []);

  const plan = series.map((s) => {
    const onY2 = y2Names.has(s.name);
    const axisId: "y" | "y2" = onY2 ? "y2" : "y";
    const datasetKind: "line" | "bar" = onY2 && y2Conf?.style ? y2Conf.style : kind;
    return { s, axisId, datasetKind, overrideType: datasetKind !== kind };
  });

  // A combo chart mixes line and bar datasets, so Chart.js's draw order (lower
  // `order` drawn last, i.e. on top) must be set explicitly on every dataset —
  // otherwise an un-overridden dataset defaults to order 0 and would wrongly
  // paint over a line dataset that was given an explicit, lower order.
  const comboActive = plan.some((p) => p.overrideType);

  return plan.map(({ s, axisId, datasetKind, overrideType }) => {
    if (datasetKind === "line") {
      return {
        ...(overrideType ? { type: "line" as const } : {}),
        ...(comboActive ? { order: 1 } : {}),
        label: s.name,
        data: s.points.map((p) => p.value),
        borderColor: s.color,
        backgroundColor: s.color + "22",
        tension: 0.3,
        fill: false,
        pointRadius: labelsLen > 60 ? 0 : 3,
        spanGaps: config.missingValue === "skip",
        yAxisID: axisId,
      };
    }

    return {
      ...(overrideType ? { type: "bar" as const } : {}),
      ...(comboActive ? { order: 2 } : {}),
      label: s.name,
      data: s.points.map((p) => p.value),
      backgroundColor: s.color + "cc",
      borderColor: s.color,
      borderWidth: 1,
      borderRadius: 3,
      yAxisID: axisId,
    };
  });
}

// Looks up the right axis's isTimeFmt/unit for the hovered dataset in a tooltip callback.
function axisInfoFor(axes: AxisInfo[], yAxisID: unknown): AxisInfo | undefined {
  const id = (yAxisID as "y" | "y2" | undefined) ?? "y";
  return axes.find((a) => a.id === id);
}

// ─── Line Chart ───────────────────────────────────────────────────────────────

export function renderLineChart(
  canvas: HTMLCanvasElement,
  series: SeriesData[],
  config: TrackerConfig
): Chart {
  const labels = buildLabels(series, config);
  const axes = buildAxes(series, config, "line");
  const datasets = buildDatasets(series, config, "line", labels.length);

  const scales: Record<string, unknown> = {
    x: {
      title: {
        display: !!config.xAxis?.label,
        text: config.xAxis?.label ?? "",
      },
    },
    y: buildScaleOptions(axes.find((a) => a.id === "y")!, true, "line"),
  };
  const y2Info = axes.find((a) => a.id === "y2");
  if (y2Info) scales.y2 = buildScaleOptions(y2Info, false, "line");

  const chartConfig: ChartConfiguration = {
    type: "line",
    data: { labels, datasets: datasets as any },
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
              const info = axisInfoFor(axes, ctx.dataset.yAxisID);
              const val = ctx.parsed.y;
              const formatted = info?.isTimeFmt ? formatSecondsAsTime(val) : val?.toFixed(2);
              return `${ctx.dataset.label}: ${formatted}${info?.unit ?? ""}`;
            },
          },
        },
      },
      scales: scales as any,
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
  const axes = buildAxes(series, config, "bar");
  const datasets = buildDatasets(series, config, "bar", labels.length);

  const scales: Record<string, unknown> = {
    x: {
      title: { display: !!config.xAxis?.label, text: config.xAxis?.label ?? "" },
      stacked: false,
    },
    y: buildScaleOptions(axes.find((a) => a.id === "y")!, true, "bar"),
  };
  const y2Info = axes.find((a) => a.id === "y2");
  if (y2Info) scales.y2 = buildScaleOptions(y2Info, false, "bar");

  const chartConfig: ChartConfiguration = {
    type: "bar",
    data: { labels, datasets: datasets as any },
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
              const info = axisInfoFor(axes, ctx.dataset.yAxisID);
              const val = ctx.parsed.y;
              const formatted = info?.isTimeFmt ? formatSecondsAsTime(val) : val?.toFixed(2);
              return `${ctx.dataset.label}: ${formatted}${info?.unit ?? ""}`;
            },
          },
        },
      },
      scales: scales as any,
    },
  };

  return new Chart(canvas, chartConfig);
}
