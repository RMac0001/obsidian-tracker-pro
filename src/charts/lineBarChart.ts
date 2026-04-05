import { Chart, ChartConfiguration } from "chart.js/auto";
import { SeriesData, TrackerConfig } from "../types";
import { formatDateLabel } from "../aggregator";

// ─── Shared Label Builder ─────────────────────────────────────────────────────

function buildLabels(series: SeriesData[], config: TrackerConfig): string[] {
  const dates = series[0]?.points.map((p) => p.date) ?? [];
  return dates.map((d) => formatDateLabel(d, config.aggregate ?? "daily"));
}

// ─── Line Chart ───────────────────────────────────────────────────────────────

export function renderLineChart(
  canvas: HTMLCanvasElement,
  series: SeriesData[],
  config: TrackerConfig
): Chart {
  const labels = buildLabels(series, config);

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
              const unit = config.yAxis?.unit ?? "";
              return `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2)}${unit}`;
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
          min: config.yAxis?.min,
          max: config.yAxis?.max,
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
              const unit = config.yAxis?.unit ?? "";
              return `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2)}${unit}`;
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
          min: config.yAxis?.min,
          max: config.yAxis?.max,
          stacked: false,
        },
      },
    },
  };

  return new Chart(canvas, chartConfig);
}
