import { Chart, ChartConfiguration } from "chart.js/auto";
import { TrackerConfig } from "../types";

const DEFAULT_COLORS = [
  "#4f86f7", "#f76c6c", "#43c59e", "#f7c948", "#9b59b6",
  "#e67e22", "#1abc9c", "#e74c3c", "#3498db", "#2ecc71",
];

// ─── Pie / Donut ──────────────────────────────────────────────────────────────

export function renderPieChart(
  canvas: HTMLCanvasElement,
  freq: Map<string, number>,
  config: TrackerConfig
): Chart {
  const labels = Array.from(freq.keys());
  const data   = Array.from(freq.values());
  const colors = labels.map((_, i) =>
    config.colors?.[i] ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]
  );

  const chartConfig: ChartConfiguration = {
    type: config.type === "donut" ? "doughnut" : "pie",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors.map((c) => c + "cc"),
          borderColor: colors,
          borderWidth: 1,
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
        legend: {
          display: config.showLegend ?? true,
          position: "right",
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = (ctx.dataset.data as number[]).reduce(
                (a, b) => a + b, 0
              );
              const pct = (((ctx.parsed as number) / total) * 100).toFixed(1);
              return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
            },
          },
        },
      },
    },
  };

  return new Chart(canvas, chartConfig);
}
