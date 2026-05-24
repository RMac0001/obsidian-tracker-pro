import { App } from "obsidian";
import { TrackerConfig, ParseError } from "./types";
import { TrackerSettings } from "./settings";
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
import { renderTableChart } from "./charts/tableChart";
import { renderDailyTable } from "./charts/dailyTableChart";
import { renderBillsChart } from "./charts/billsChart";
import { renderReadingChallengeBlock } from "./readingChallenge";

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

// ─── Chart Content ────────────────────────────────────────────────────────────

async function renderChartContent(
  app: App,
  el: HTMLElement,
  config: TrackerConfig,
  settings?: TrackerSettings
): Promise<void> {
  el.empty();

  // ── Candlestick: own data path ─────────────────────────────────────────────
  if (config.type === "candlestick") {
    const entries = await collectRawEntries(app, config);
    const data    = buildOHLCData(entries, config);
    if (data.length === 0) { renderEmpty(el, config); return; }
    renderCandlestickChart(el, data, config);
    return;
  }

  // ── Pie / Donut: frequency data ────────────────────────────────────────────
  if (config.type === "pie" || config.type === "donut") {
    const entries = await collectRawEntries(app, config);
    const freq    = buildFrequencyData(entries, config);
    if (freq.size === 0) { renderEmpty(el, config); return; }
    const canvas = el.createEl("canvas");
    renderPieChart(canvas, freq, config);
    return;
  }

  // ── Heatmap ────────────────────────────────────────────────────────────────
  if (config.type === "heatmap") {
    const entries = await collectRawEntries(app, config);
    const raw     = buildSeriesData(entries, config);
    const series  = aggregateAllSeries(raw, config.aggregate ?? "daily", config.period);
    if (series.length === 0 || series[0].points.length === 0) { renderEmpty(el, config); return; }
    renderHeatmapChart(el, series, config);
    return;
  }

  // ── Calendar ───────────────────────────────────────────────────────────────
  if (config.type === "calendar") {
    const entries = await collectRawEntries(app, config);
    const raw     = buildSeriesData(entries, config);
    const series  = aggregateAllSeries(raw, "daily", config.period);
    if (series.length === 0 || series[0].points.length === 0) { renderEmpty(el, config); return; }
    renderCalendarChart(el, series, config);
    return;
  }

  // ── Gauge ──────────────────────────────────────────────────────────────────
  if (config.type === "gauge") {
    const entries = await collectRawEntries(app, config);
    const raw     = buildSeriesData(entries, config);
    const series  = aggregateAllSeries(raw, config.aggregate ?? "daily", config.period);
    if (series.length === 0) { renderEmpty(el, config); return; }
    renderGaugeChart(el, series, config);
    return;
  }

  // ── Radar ──────────────────────────────────────────────────────────────────
  if (config.type === "radar") {
    const entries = await collectRawEntries(app, config);
    const raw     = buildSeriesData(entries, config);
    const series  = aggregateAllSeries(raw, config.aggregate ?? "daily", config.period);
    if (series.length === 0) { renderEmpty(el, config); return; }
    const canvas = el.createEl("canvas");
    renderRadarChart(canvas, series, config);
    return;
  }

  // ── Scatter ────────────────────────────────────────────────────────────────
  if (config.type === "scatter") {
    const entries = await collectRawEntries(app, config);
    const raw     = buildSeriesData(entries, config);
    if (raw.length < 2) {
      renderErrors(el, [{ message: "Scatter chart needs at least 2 properties" }]);
      return;
    }
    const canvas = el.createEl("canvas");
    renderScatterChart(canvas, raw, config);
    return;
  }

  // ── Table ─────────────────────────────────────────────────────────────────
  if (config.type === "table") {
    const entries = await collectRawEntries(app, config);
    renderTableChart(el, entries, config);
    return;
  }

  // ── Daily Table ────────────────────────────────────────────────────────────
  if (config.type === "daily-table") {
    const entries = await collectRawEntries(app, config);
    renderDailyTable(el, entries, config);
    return;
  }

  // ── Bills ──────────────────────────────────────────────────────────────────
  if (config.type === "bills") {
    await renderBillsChart(el, app, config, settings);
    return;
  }

  // ── Reading Challenge ──────────────────────────────────────────────────────
  if (config.type === "reading-challenge") {
    if (settings) renderReadingChallengeBlock(el, app, settings, config);
    return;
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  if (config.type === "summary") {
    const entries = await collectRawEntries(app, config);
    const raw     = config.properties
      ? buildSeriesData(entries, config)
      : [{ name: "presence", points: entries.map(e => ({ date: e.date, value: 1 })), color: "" }];
    if (raw.length === 0) { renderEmpty(el, config); return; }
    renderSummaryChart(el, raw, config, entries);
    return;
  }

  // ── Line / Bar ─────────────────────────────────────────────────────────────
  const entries = await collectRawEntries(app, config);
  const raw     = buildSeriesData(entries, config);
  const series  = aggregateAllSeries(raw, config.aggregate ?? "daily", config.period);

  if (series.length === 0 || series.every((s) => s.points.length === 0)) {
    renderEmpty(el, config);
    return;
  }

  const canvas = el.createEl("canvas");
  if (config.type === "bar") {
    renderBarChart(canvas, series, config);
  } else {
    renderLineChart(canvas, series, config);
  }
}

// ─── Date Selector ────────────────────────────────────────────────────────────

const DATE_OPTIONS: { label: string; value: string }[] = [
  { label: "Today",         value: "today" },
  { label: "This Week",     value: "this-week" },
  { label: "This Month",    value: "this-month" },
  { label: "This Year",     value: "this-year" },
  { label: "Last Week",     value: "last-week" },
  { label: "Last Month",    value: "last-month" },
  { label: "Last Year",     value: "last-year" },
  { label: "Last 7 Days",   value: "last-7-days" },
  { label: "Last 30 Days",  value: "last-30-days" },
  { label: "Last 90 Days",  value: "last-90-days" },
  { label: "Last 6 Months", value: "last-6-months" },
  { label: "Last 12 Months",value: "last-12-months" },
  { label: "All Time",      value: "all" },
  { label: "Custom…",       value: "custom" },
];

function renderDateSelector(
  selectorEl: HTMLElement,
  chartEl: HTMLElement,
  app: App,
  config: TrackerConfig,
  settings?: TrackerSettings
): void {
  let currentValue = config.dateRange ?? "last-30-days";
  if (config.startDate && config.endDate && !config.dateRange) currentValue = "custom";

  const select = selectorEl.createEl("select", { cls: "tracker-pro-date-select" });
  for (const opt of DATE_OPTIONS) {
    const el = select.createEl("option", { text: opt.label, value: opt.value });
    if (opt.value === currentValue) el.selected = true;
  }

  const customEl = selectorEl.createEl("div", { cls: "tracker-pro-date-custom" });
  if (currentValue !== "custom") customEl.addClass("hidden");

  const startInput = customEl.createEl("input") as HTMLInputElement;
  startInput.type = "date";
  startInput.value = config.startDate ?? "";

  const sep = customEl.createEl("span", { text: "→", cls: "tracker-pro-date-sep" });
  sep.style.color = "var(--text-muted)";

  const endInput = customEl.createEl("input") as HTMLInputElement;
  endInput.type = "date";
  endInput.value = config.endDate ?? "";

  const rerender = async () => {
    await renderChartContent(app, chartEl, config, settings);
  };

  const applyCustom = async () => {
    if (startInput.value && endInput.value) {
      config.startDate = startInput.value;
      config.endDate   = endInput.value;
      delete config.dateRange;
      await rerender();
    }
  };

  startInput.addEventListener("change", applyCustom);
  endInput.addEventListener("change", applyCustom);

  select.addEventListener("change", async () => {
    const val = select.value;
    if (val === "custom") {
      customEl.removeClass("hidden");
    } else {
      customEl.addClass("hidden");
      config.dateRange  = val;
      delete config.startDate;
      delete config.endDate;
      await rerender();
    }
  });
}

// ─── Main Render ──────────────────────────────────────────────────────────────

const NO_HEIGHT_TYPES = ["summary", "table", "daily-table", "bills", "reading-challenge"] as const;

export async function renderTracker(
  app: App,
  container: HTMLElement,
  config: TrackerConfig,
  settings?: TrackerSettings
): Promise<void> {
  container.empty();
  container.addClass("tracker-pro-container");

  // Apply size (charts only — tables and summaries size to their content)
  if (config.height && !NO_HEIGHT_TYPES.includes(config.type as typeof NO_HEIGHT_TYPES[number])) {
    container.style.height = config.height + "px";
  }
  if (config.width) container.style.width = config.width;

  if (config.dateSelector) {
    const selectorEl = container.createEl("div", { cls: "tracker-pro-date-selector" });
    const chartEl    = container.createEl("div");
    renderDateSelector(selectorEl, chartEl, app, config, settings);
    await renderChartContent(app, chartEl, config, settings);
  } else {
    await renderChartContent(app, container, config, settings);
  }
}
