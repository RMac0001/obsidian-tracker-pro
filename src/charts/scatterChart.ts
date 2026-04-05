import { Chart, ChartConfiguration } from "chart.js/auto";
import { SeriesData, TrackerConfig } from "../types";

// ─── Scatter Chart ────────────────────────────────────────────────────────────
// Two properties → X and Y axes. If more, each pair forms a series.

export function renderScatterChart(
  canvas: HTMLCanvasElement,
  allSeries: SeriesData[],
  config: TrackerConfig
): Chart {
  const datasets = [];

  // Pair properties: [x, y], [x2, y2], ...
  for (let i = 0; i + 1 < allSeries.length; i += 2) {
    const xSeries = allSeries[i];
    const ySeries = allSeries[i + 1];
    const label   = `${xSeries.name} vs ${ySeries.name}`;

    const points = xSeries.points
      .map((xPt, idx) => {
        const yPt = ySeries.points[idx];
        if (xPt.value === null || !yPt || yPt.value === null) return null;
        return { x: xPt.value, y: yPt.value };
      })
      .filter((p): p is { x: number; y: number } => p !== null);

    datasets.push({
      label,
      data: points,
      backgroundColor: (xSeries.color ?? "#4f86f7") + "99",
      borderColor: xSeries.color ?? "#4f86f7",
      pointRadius: 5,
    });
  }

  const chartConfig: ChartConfiguration = {
    type: "scatter",
    data: { datasets },
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
        x: {
          title: { display: !!config.xAxis?.label, text: config.xAxis?.label ?? allSeries[0]?.name ?? "X" },
          min: config.xAxis?.min,
          max: config.xAxis?.max,
        },
        y: {
          title: { display: !!config.yAxis?.label, text: config.yAxis?.label ?? allSeries[1]?.name ?? "Y" },
          min: config.yAxis?.min,
          max: config.yAxis?.max,
        },
      },
    },
  };

  return new Chart(canvas, chartConfig);
}
