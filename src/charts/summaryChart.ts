import { App, TFile } from "obsidian";
import { SeriesData, TrackerConfig, RawEntry } from "../types";
import { TrackerSettings } from "../settings";
import { resolveStartEnd } from "../parser";

// ─── Streak / Break Calculations ──────────────────────────────────────────────

function toDateOnly(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const DAY_MS = 86400000;

function getActiveDays(series: SeriesData[]): Set<number> {
  const active = new Set<number>();
  for (const s of series) {
    for (const pt of s.points) {
      if (pt.value !== null && pt.value !== 0) {
        active.add(toDateOnly(pt.date));
      }
    }
  }
  return active;
}

function getSortedDays(active: Set<number>): number[] {
  return Array.from(active).sort((a, b) => a - b);
}

function calcMaxStreak(days: number[]): number {
  if (days.length === 0) return 0;
  let max = 1, cur = 1;
  for (let i = 1; i < days.length; i++) {
    if (days[i] - days[i - 1] === DAY_MS) {
      cur++;
      if (cur > max) max = cur;
    } else {
      cur = 1;
    }
  }
  return max;
}

function calcCurrentStreak(days: number[]): number {
  if (days.length === 0) return 0;
  const todayMs = toDateOnly(new Date());
  const lastDay = days[days.length - 1];
  // Streak is current only if last active day is today or yesterday
  if (lastDay < todayMs - DAY_MS) return 0;
  let streak = 1;
  for (let i = days.length - 2; i >= 0; i--) {
    if (days[i + 1] - days[i] === DAY_MS) streak++;
    else break;
  }
  return streak;
}

function calcCurrentBreak(days: number[]): number {
  if (days.length === 0) return 0;
  const todayMs = toDateOnly(new Date());
  const lastDay = days[days.length - 1];
  if (lastDay >= todayMs) return 0; // active today
  return Math.round((todayMs - lastDay) / DAY_MS);
}

function calcMaxBreak(days: number[], currentBreak: number, rangeStartMs: number): number {
  if (days.length === 0) return currentBreak;

  let max = currentBreak;

  // Gap from range start to first active day
  const leadGap = Math.round((days[0] - rangeStartMs) / DAY_MS);
  if (leadGap > max) max = leadGap;

  // Gaps between consecutive active days
  for (let i = 1; i < days.length; i++) {
    const gap = Math.round((days[i] - days[i - 1]) / DAY_MS) - 1;
    if (gap > max) max = gap;
  }

  return max;
}

function calcTotalDays(days: number[]): number {
  return days.length;
}

function calcSum(series: SeriesData[]): number {
  let total = 0;
  for (const s of series) {
    for (const pt of s.points) {
      if (pt.value !== null) total += pt.value;
    }
  }
  return total;
}

function calcMean(series: SeriesData[]): string {
  let total = 0, count = 0;
  for (const s of series) {
    for (const pt of s.points) {
      if (pt.value !== null) { total += pt.value; count++; }
    }
  }
  if (count === 0) return "0";
  return (total / count).toFixed(1);
}

function calcMax(series: SeriesData[]): number {
  let max = -Infinity;
  for (const s of series) {
    for (const pt of s.points) {
      if (pt.value !== null && pt.value > max) max = pt.value;
    }
  }
  return max === -Infinity ? 0 : max;
}

function calcMin(series: SeriesData[]): number {
  let min = Infinity;
  for (const s of series) {
    for (const pt of s.points) {
      if (pt.value !== null && pt.value < min) min = pt.value;
    }
  }
  return min === Infinity ? 0 : min;
}

function calcFirst(series: SeriesData[]): number | string {
  for (const s of series) {
    for (const pt of s.points) {
      if (pt.value !== null) return pt.value;
    }
  }
  return 0;
}

function calcLatest(series: SeriesData[]): number | string {
  let last: number | null = null;
  for (const s of series) {
    for (const pt of s.points) {
      if (pt.value !== null) last = pt.value;
    }
  }
  return last ?? 0;
}

// ─── Named-Property Aggregates ───────────────────────────────────────────────

function getSeriesByName(series: SeriesData[], name: string): SeriesData | undefined {
  return series.find(s => s.name === name);
}

function calcMeanFor(series: SeriesData[], propName: string): string {
  const s = getSeriesByName(series, propName);
  if (!s) return "?";
  let total = 0, count = 0;
  for (const pt of s.points) {
    if (pt.value !== null) { total += pt.value; count++; }
  }
  if (count === 0) return "0";
  return (total / count).toFixed(1);
}

function calcSumFor(series: SeriesData[], propName: string): string {
  const s = getSeriesByName(series, propName);
  if (!s) return "?";
  let total = 0;
  for (const pt of s.points) {
    if (pt.value !== null) total += pt.value;
  }
  return total.toFixed(1);
}

function calcMaxFor(series: SeriesData[], propName: string): string {
  const s = getSeriesByName(series, propName);
  if (!s) return "?";
  let max = -Infinity;
  for (const pt of s.points) {
    if (pt.value !== null && pt.value > max) max = pt.value;
  }
  return max === -Infinity ? "0" : String(max);
}

function calcMinFor(series: SeriesData[], propName: string): string {
  const s = getSeriesByName(series, propName);
  if (!s) return "?";
  let min = Infinity;
  for (const pt of s.points) {
    if (pt.value !== null && pt.value < min) min = pt.value;
  }
  return min === Infinity ? "0" : String(min);
}

// ─── Macro Percentage Helpers ─────────────────────────────────────────────────

function calcMacroMeanRaw(series: SeriesData[], propName: string): number {
  const s = getSeriesByName(series, propName);
  if (!s) return 0;
  let total = 0, count = 0;
  for (const pt of s.points) {
    if (pt.value !== null) { total += pt.value; count++; }
  }
  return count === 0 ? 0 : total / count;
}

function calcCarbPct(series: SeriesData[], macroProp: string, calProp: string): string {
  const macroMean = calcMacroMeanRaw(series, macroProp);
  const calMean   = calcMacroMeanRaw(series, calProp);
  if (calMean === 0) return "0%";
  return ((macroMean * 4) / calMean * 100).toFixed(1) + "%";
}

function calcFatPct(series: SeriesData[], macroProp: string, calProp: string): string {
  const macroMean = calcMacroMeanRaw(series, macroProp);
  const calMean   = calcMacroMeanRaw(series, calProp);
  if (calMean === 0) return "0%";
  return ((macroMean * 9) / calMean * 100).toFixed(1) + "%";
}

function calcProteinPct(series: SeriesData[], macroProp: string, calProp: string): string {
  const macroMean = calcMacroMeanRaw(series, macroProp);
  const calMean   = calcMacroMeanRaw(series, calProp);
  if (calMean === 0) return "0%";
  return ((macroMean * 4) / calMean * 100).toFixed(1) + "%";
}

// ─── Date Diff / HM Helpers ──────────────────────────────────────────────────

function calcMeanDateDiff(entries: RawEntry[], field1: string, field2: string): string {
  let total = 0;
  let count = 0;
  for (const entry of entries) {
    const raw1 = entry.frontmatter[field1];
    const raw2 = entry.frontmatter[field2];
    if (!raw1 || !raw2) continue;
    const toMs = (v: unknown): number | null => {
      if (v instanceof Date) {
        return Date.UTC(v.getFullYear(), v.getMonth(), v.getDate());
      }
      const s = String(v).trim();
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      return Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    };
    const ms1 = toMs(raw1);
    const ms2 = toMs(raw2);
    if (ms1 === null || ms2 === null) continue;
    const diff = Math.abs(ms2 - ms1) / 86_400_000;
    total += diff;
    count++;
  }
  if (count === 0) return "0";
  return (total / count).toFixed(1);
}

function calcMeanHM(series: SeriesData[]): string {
  let total = 0, count = 0;
  for (const s of series) {
    for (const pt of s.points) {
      if (pt.value !== null) { total += pt.value; count++; }
    }
  }
  if (count === 0) return "0 minutes";
  const avgMinutes = total / count;
  const hours = Math.floor(avgMinutes / 60);
  const minutes = Math.round(avgMinutes % 60);
  if (hours === 0) return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  return `${hours} hour${hours !== 1 ? "s" : ""}, ${minutes} minute${minutes !== 1 ? "s" : ""}`;
}

// ─── TDEE / Deficit Helpers ───────────────────────────────────────────────────

function getFileDateTdee(app: App, file: TFile): Date | null {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  if (fm.creation_date) {
    const raw = fm.creation_date instanceof Date
      ? `${fm.creation_date.getFullYear()}-${String(fm.creation_date.getMonth()+1).padStart(2,"0")}-${String(fm.creation_date.getDate()).padStart(2,"0")}`
      : String(fm.creation_date);
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  const m = file.basename.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function calcTdeeCore(
  app: App,
  settings: TrackerSettings,
  config: TrackerConfig,
  series: SeriesData[],
  start: Date,
  end: Date,
  calProp: string
): { tdee: number; deficit: number; dataAvailable: boolean } {
  const NA = { tdee: 0, deficit: 0, dataAvailable: false };

  const tdeeConf = config.tdee;
  const weightFolder = (tdeeConf?.weightFolder ?? settings.achievementsDailyNotesFolder).replace(/\/$/, "");
  const weightProp   = tdeeConf?.weightProperty ?? "weight";

  interface WPt { date: Date; weight: number }
  const allWeights: WPt[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (!file.path.startsWith(weightFolder + "/")) continue;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const w = Number(fm[weightProp]);
    if (!w || isNaN(w)) continue;
    const date = getFileDateTdee(app, file);
    if (!date) continue;
    allWeights.push({ date, weight: w });
  }
  allWeights.sort((a, b) => a.date.getTime() - b.date.getTime());
  if (allWeights.length < 2) return NA;

  const startMs = start.getTime();
  const endMs   = end.getTime() + 86400000;
  const inRange  = allWeights.filter(e => e.date.getTime() >= startMs && e.date.getTime() <= endMs);

  const pair = inRange.length >= 2
    ? [inRange[0], inRange[inRange.length - 1]]
    : [allWeights[allWeights.length - 2], allWeights[allWeights.length - 1]];

  const daysInPeriod = (pair[1].date.getTime() - pair[0].date.getTime()) / 86400000;
  if (daysInPeriod === 0) return NA;

  // Smooth endpoints by averaging a cluster of readings around each anchor
  const avgWindowDays = tdeeConf?.avgWindowDays ?? 3;
  const windowMs      = avgWindowDays * 86400000;
  const earlyMs       = pair[0].date.getTime();
  const lateMs        = pair[1].date.getTime();

  const earlyCluster = allWeights.filter(e => { const t = e.date.getTime(); return t >= earlyMs && t <= earlyMs + windowMs; });
  const lateCluster  = allWeights.filter(e => { const t = e.date.getTime(); return t >= lateMs - windowMs && t <= lateMs; });

  const avgCluster = (pts: { date: Date; weight: number }[]) =>
    pts.reduce((s, e) => s + e.weight, 0) / pts.length;

  const weightChange = avgCluster(lateCluster) - avgCluster(earlyCluster);

  const calSeries = series.find(s => s.name === calProp);
  if (!calSeries) return NA;
  let calTotal = 0, calCount = 0;
  for (const pt of calSeries.points) {
    if (pt.value !== null) { calTotal += pt.value; calCount++; }
  }
  if (calCount === 0) return NA;

  const avgCal  = calTotal / calCount;
  const tdee    = avgCal - (weightChange * 3500 / daysInPeriod);
  const deficit = tdee - avgCal;

  return { tdee, deficit, dataAvailable: true };
}

// ─── Template Engine ──────────────────────────────────────────────────────────

function applyTemplate(
  template: string,
  vars: Record<string, string | number>,
  twoArgResolver?: (fn: string, arg1: string, arg2: string) => string,
  latestVal: number = 0,
  series: SeriesData[] = []
): string {
  // Two-argument calls: {{fn(arg1, arg2)}}
  let result = template.replace(
    /\{\{(\w+)\(([^,)]+),\s*([^)]+)\)\}\}/g,
    (_, fn, a1, a2) => {
      if (twoArgResolver) return twoArgResolver(fn.trim(), a1.trim(), a2.trim());
      return `{{${fn}(${a1}, ${a2})}}`;
    }
  );
  // Single word-arg named aggregates: {{mean(prop)}}, {{sum(prop)}}, {{max(prop)}}, {{min(prop)}}
  result = result.replace(/\{\{(mean|sum|max|min)\((\w+)\)\}\}/g, (_, fn, prop) => {
    switch (fn) {
      case "mean": return calcMeanFor(series, prop);
      case "sum":  return calcSumFor(series, prop);
      case "max":  return calcMaxFor(series, prop);
      case "min":  return calcMinFor(series, prop);
      default:     return `{{${fn}(${prop})}}`;
    }
  });
  // One-numeric-arg calls: {{name(N)}}
  result = result.replace(/\{\{(\w+)\(([^)]+)\)\}\}/g, (_, name, rawArg) => {
    const n = parseFloat(rawArg);
    if (isNaN(n)) return `{{${name}(${rawArg})}}`;
    if (name === "diffFrom") return (n - latestVal).toFixed(1);
    if (name === "latestTo") return (latestVal - n).toFixed(1);
    return `{{${name}(${rawArg})}}`;
  });
  // Zero-argument calls: {{name()}}
  result = result.replace(/\{\{(\w+)\(\)\}\}/g, (_, name) => {
    return vars[name] !== undefined ? String(vars[name]) : `{{${name}()}}`;
  });
  return result;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

export function renderSummaryChart(
  container: HTMLElement,
  series: SeriesData[],
  config: TrackerConfig,
  entries: RawEntry[] = [],
  app?: App,
  settings?: TrackerSettings
): void {
  const summaryConfig = (config as any).summary as { template?: string } | undefined;
  let template = summaryConfig?.template ?? "Total: {{sum()}} days active";

  const active  = getActiveDays(series);
  const days    = getSortedDays(active);

  const { start, end } = resolveStartEnd(config);
  const rangeStartMs = toDateOnly(start);

  // Pre-compute TDEE-family tokens — shared cache avoids rerunning calcTdeeCore per calProp
  if (app && settings) {
    const tdeeCache = new Map<string, { tdee: number; deficit: number; dataAvailable: boolean }>();
    const ensureTdee = (calProp: string) => {
      if (!tdeeCache.has(calProp)) {
        tdeeCache.set(calProp, calcTdeeCore(app, settings, config, series, start, end, calProp));
      }
      return tdeeCache.get(calProp)!;
    };

    // {{tdee(calProp)}}, {{deficit(calProp)}}, {{tdeeCalories(calProp)}}
    template = template.replace(
      /\{\{(tdee|deficit|tdeeCalories)\((\w+)\)\}\}/g,
      (_, fn: string, calProp: string) => {
        const r = ensureTdee(calProp);
        if (!r.dataAvailable) return "N/A";
        if (fn === "tdee") return r.tdee.toFixed(0);
        if (fn === "deficit") return r.deficit.toFixed(0);
        return (r.tdee - r.deficit).toFixed(0); // tdeeCalories
      }
    );

    // {{targetIntake(calProp, ratePerWeek)}}
    template = template.replace(
      /\{\{targetIntake\((\w+),\s*(-?[\d.]+)\)\}\}/g,
      (_, calProp: string, rateStr: string) => {
        const r = ensureTdee(calProp);
        if (!r.dataAvailable) return "N/A";
        return (r.tdee - (parseFloat(rateStr) * 3500 / 7)).toFixed(0);
      }
    );
  }

  const currentBreak = calcCurrentBreak(days);

  const latestVal = calcLatest(series);
  const firstVal  = calcFirst(series);

  const vars: Record<string, string | number> = {
    maxStreak:     calcMaxStreak(days),
    currentStreak: calcCurrentStreak(days),
    maxBreaks:     calcMaxBreak(days, currentBreak, rangeStartMs),
    currentBreaks: currentBreak,
    totalDays:     calcTotalDays(days),
    sum:           calcSum(series),
    mean:          calcMean(series),
    max:           calcMax(series),
    min:           calcMin(series),
    meanHM:        calcMeanHM(series),
    first:         typeof firstVal  === "number" ? Number(firstVal.toFixed(1))  : firstVal,
    latest:        typeof latestVal === "number" ? Number(latestVal.toFixed(1)) : latestVal,
  };

  const latestNum = typeof latestVal === "number" ? latestVal : parseFloat(String(latestVal));
  const twoArgResolver = (fn: string, a1: string, a2: string): string => {
    if (fn === "meanDateDiff") return calcMeanDateDiff(entries, a1, a2);
    if (fn === "carbPct")      return calcCarbPct(series, a1, a2);
    if (fn === "fatPct")       return calcFatPct(series, a1, a2);
    if (fn === "proteinPct")   return calcProteinPct(series, a1, a2);
    return `{{${fn}(${a1}, ${a2})}}`;
  };
  const rendered = applyTemplate(template, vars, twoArgResolver, latestNum, series)
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);

  container.empty();
  const wrap = container.createDiv({ cls: "tpro-summary-wrap" });

  if (config.title) {
    wrap.createDiv({ cls: "tpro-summary-title", text: config.title });
  }

  const table = wrap.createEl("table", { cls: "tpro-summary-table" });

  for (const line of rendered) {
    // Lines with a colon become label: value rows
    const colonIdx = line.indexOf(":");
    if (colonIdx > -1) {
      const label = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      const row = table.createEl("tr");
      row.createEl("td", { cls: "tpro-summary-label", text: label });
      row.createEl("td", { cls: "tpro-summary-value", text: value });
    } else {
      const row = table.createEl("tr");
      const td = row.createEl("td", { cls: "tpro-summary-line", text: line });
      td.setAttribute("colspan", "2");
    }
  }

  // Inject styles once
  const styleId = "tpro-summary-styles";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .tpro-summary-wrap  { padding: 8px 0; }
      .tpro-summary-title { font-size: 1.1em; font-weight: 600;
                            margin-bottom: 8px; color: var(--text-normal); }
      .tpro-summary-table { border-collapse: collapse; width: 100%; }
      .tpro-summary-table tr + tr td { border-top: 1px solid var(--background-modifier-border); }
      .tpro-summary-label { padding: 4px 12px 4px 0; color: var(--text-muted);
                            font-size: 0.9em; white-space: nowrap; }
      .tpro-summary-value { padding: 4px 0; font-weight: 600;
                            color: var(--text-normal); font-size: 0.9em; }
      .tpro-summary-line  { padding: 4px 0; color: var(--text-normal); font-size: 0.9em; }
    `;
    document.head.appendChild(style);
  }
}
