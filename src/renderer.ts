import { App } from "obsidian";
import { TrackerConfig, ParseError } from "./types";
import { collectRawEntries, buildSeriesData, buildOHLCData, buildFrequencyData } from "./dataCollector";
import { aggregateAllSeries } from "./aggregator";
import { renderLineChart, renderBarChart } from "./charts/lineBarChart";
import { renderPieChart } from "./charts/pieChart";
import { renderScatterChart } from "./charts/scatterChart";
import { renderRadarChart } from "./charts/radarChart";
import { renderGaugeChart } from "./charts/gaugeChart";
import { renderHeatmapChart } from "./charts/heatmapChart";
import { renderCalendarChart } from "./charts/calendarChart";
import { renderCandlestickChart } from "./charts/candlestickChart";
import { renderSummaryChart } from "./charts/summaryChart";

// ─── Error Display ────────────────────────────────────────────────────────────

export function renderErrors(container: HTMLElement, errors: ParseError[]): void {
  container.empty();
  const box = container.createEl("div", { cls: "tracker-pro-error" });
  box.createEl("strong", { text: "⚠ Tracker Pro" });
  const ul = box.createEl("ul");
  for (const e of errors) {
    const msg = e.line !== undefined ? `Line ${e.line + 1}: ${e.message}` : e.message;
    ul.createEl("li", { text: msg });
  }
}

// ─── No Data Display ──────────────────────────────────────────────────────────

function renderEmpty(container: HTMLElement, config: TrackerConfig): void {
  container.empty();
  const box = container.createEl("div", { cls: "tracker-pro-empty" });
  box.createEl("span", { text: "📊 No data found" });
  box.createEl("small", { text: `No notes matching the config were found in the specified date range.` });
}

// ─── Main Render ──────────────────────────────────────────────────────────────

export async function renderTracker(
  app: App,
  container: HTMLElement,
  config: TrackerConfig
): Promise<void> {
  container.empty();
  container.addClass("tracker-pro-container");

  // Apply size (not for summary — it's a table, height makes no sense)
  if (config.height && config.type !== "summary") container.style.height = config.height + "px";
  if (config.width)  container.style.width  = config.width;

  // ── Candlestick: own data path ─────────────────────────────────────────────
  if (config.type === "candlestick") {
    const entries = await collectRawEntries(app, config);
    const data    = buildOHLCData(entries, config);
    if (data.length === 0) { renderEmpty(container, config); return; }
    renderCandlestickChart(container, data, config);
    return;
  }

  // ── Pie / Donut: frequency data ────────────────────────────────────────────
  if (config.type === "pie" || config.type === "donut") {
    const entries = await collectRawEntries(app, config);
    const freq    = buildFrequencyData(entries, config);
    if (freq.size === 0) { renderEmpty(container, config); return; }
    const canvas = container.createEl("canvas");
    renderPieChart(canvas, freq, config);
    return;
  }

  // ── Heatmap ────────────────────────────────────────────────────────────────
  if (config.type === "heatmap") {
    const entries = await collectRawEntries(app, config);
    const raw     = buildSeriesData(entries, config);
    const series  = aggregateAllSeries(raw, config.aggregate ?? "daily", config.period);
    if (series.length === 0 || series[0].points.length === 0) { renderEmpty(container, config); return; }
    renderHeatmapChart(container, series, config);
    return;
  }

  // ── Calendar ───────────────────────────────────────────────────────────────
  if (config.type === "calendar") {
    const entries = await collectRawEntries(app, config);
    const raw     = buildSeriesData(entries, config);
    const series  = aggregateAllSeries(raw, "daily", config.period);
    if (series.length === 0 || series[0].points.length === 0) { renderEmpty(container, config); return; }
    renderCalendarChart(container, series, config);
    return;
  }

  // ── Gauge ──────────────────────────────────────────────────────────────────
  if (config.type === "gauge") {
    const entries = await collectRawEntries(app, config);
    const raw     = buildSeriesData(entries, config);
    const series  = aggregateAllSeries(raw, config.aggregate ?? "daily", config.period);
    if (series.length === 0) { renderEmpty(container, config); return; }
    renderGaugeChart(container, series, config);
    return;
  }

  // ── Radar ──────────────────────────────────────────────────────────────────
  if (config.type === "radar") {
    const entries = await collectRawEntries(app, config);
    const raw     = buildSeriesData(entries, config);
    const series  = aggregateAllSeries(raw, config.aggregate ?? "daily", config.period);
    if (series.length === 0) { renderEmpty(container, config); return; }
    const canvas = container.createEl("canvas");
    renderRadarChart(canvas, series, config);
    return;
  }

  // ── Scatter ────────────────────────────────────────────────────────────────
  if (config.type === "scatter") {
    const entries = await collectRawEntries(app, config);
    const raw     = buildSeriesData(entries, config);
    // No aggregation for scatter — raw daily values needed as pairs
    if (raw.length < 2) {
      renderErrors(container, [{ message: "Scatter chart needs at least 2 properties" }]);
      return;
    }
    const canvas = container.createEl("canvas");
    renderScatterChart(canvas, raw, config);
    return;
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  if (config.type === "summary") {
    const entries = await collectRawEntries(app, config);
    const raw     = config.properties
      ? buildSeriesData(entries, config)
      : [{ name: "presence", points: entries.map(e => ({ date: e.date, value: 1 })), color: "" }];
    if (raw.length === 0) { renderEmpty(container, config); return; }
    renderSummaryChart(container, raw, config);
    return;
  }

  // ── Line / Bar ─────────────────────────────────────────────────────────────
  const entries = await collectRawEntries(app, config);
  const raw     = buildSeriesData(entries, config);
  const series  = aggregateAllSeries(raw, config.aggregate ?? "daily", config.period);

  if (series.length === 0 || series.every((s) => s.points.length === 0)) {
    renderEmpty(container, config);
    return;
  }

  const canvas = container.createEl("canvas");
  if (config.type === "bar") {
    renderBarChart(canvas, series, config);
  } else {
    renderLineChart(canvas, series, config);
  }
}
