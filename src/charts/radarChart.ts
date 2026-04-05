import { Chart, ChartConfiguration } from "chart.js/auto";
import { SeriesData, TrackerConfig } from "../types";

// ─── Radar Chart ──────────────────────────────────────────────────────────────
// Each property → one axis. Each note/date can be a separate dataset,
// or the latest value per property is used for a single snapshot.

export function renderRadarChart(
  canvas: HTMLCanvasElement,
  allSeries: SeriesData[],
  config: TrackerConfig
): Chart {
  // Labels: one per property
  const radarLabels =
    config.labels ?? allSeries.map((s) => s.name);

  // Determine if we draw multiple time-points or just the latest
  // Default: single snapshot using the last non-null value of each series
  const latestValues = allSeries.map((s) => {
    const valid = s.points.filter((p) => p.value !== null);
    return valid.length > 0 ? (valid[valid.length - 1].value as number) : 0;
  });

  const chartConfig: ChartConfiguration = {
    type: "radar",
    data: {
      labels: radarLabels,
      datasets: [
        {
          label: config.title ?? "Latest",
          data: latestValues,
          backgroundColor: (config.colors?.[0] ?? "#4f86f7") + "33",
          borderColor: config.colors?.[0] ?? "#4f86f7",
          borderWidth: 2,
          pointBackgroundColor: config.colors?.[0] ?? "#4f86f7",
          pointRadius: 4,
        },
      ],
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
        legend: { display: config.showLegend ?? true },
      },
      scales: {
        r: {
          min: config.yAxis?.min ?? 0,
          max: config.yAxis?.max,
          pointLabels: { font: { size: 12 } },
          ticks: { stepSize: 1 },
        },
      },
    },
  };

  return new Chart(canvas, chartConfig);
}
