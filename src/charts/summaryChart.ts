import { SeriesData, TrackerConfig } from "../types";

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

function calcMaxBreak(days: number[]): number {
  if (days.length < 2) return 0;
  let max = 0;
  for (let i = 1; i < days.length; i++) {
    const gap = Math.round((days[i] - days[i - 1]) / DAY_MS) - 1;
    if (gap > max) max = gap;
  }
  return max;
}

function calcCurrentBreak(days: number[]): number {
  if (days.length === 0) return 0;
  const todayMs = toDateOnly(new Date());
  const lastDay = days[days.length - 1];
  if (lastDay >= todayMs) return 0; // active today
  return Math.round((todayMs - lastDay) / DAY_MS);
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

// ─── Template Engine ──────────────────────────────────────────────────────────

function applyTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\(\)\}\}/g, (_, name) => {
    return vars[name] !== undefined ? String(vars[name]) : `{{${name}()}}`;
  });
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

export function renderSummaryChart(
  container: HTMLElement,
  series: SeriesData[],
  config: TrackerConfig
): void {
  const summaryConfig = (config as any).summary as { template?: string } | undefined;
  const template = summaryConfig?.template ?? "Total: {{sum()}} days active";

  const active  = getActiveDays(series);
  const days    = getSortedDays(active);

  const vars: Record<string, string | number> = {
    maxStreak:     calcMaxStreak(days),
    currentStreak: calcCurrentStreak(days),
    maxBreaks:     calcMaxBreak(days),
    currentBreaks: calcCurrentBreak(days),
    totalDays:     calcTotalDays(days),
    sum:           calcSum(series),
    mean:          calcMean(series),
    max:           calcMax(series),
  };

  const rendered = applyTemplate(template, vars)
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
