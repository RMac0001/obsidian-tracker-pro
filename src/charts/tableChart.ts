import { RawEntry, TrackerConfig, TableColumnDef } from "../types";

// ─── Aggregation Helpers ──────────────────────────────────────────────────────

function evalAgg(fn: string, prop: string, entries: RawEntry[]): number {
  if (fn === "count") return entries.length;

  const values: number[] = [];
  for (const entry of entries) {
    const raw = entry.frontmatter[prop];
    if (raw === undefined || raw === null) continue;
    const n = Number(raw);
    if (!isNaN(n)) values.push(n);
  }
  if (values.length === 0) return 0;

  switch (fn) {
    case "sum":  return values.reduce((a, b) => a + b, 0);
    case "mean": return values.reduce((a, b) => a + b, 0) / values.length;
    case "max":  return Math.max(...values);
    case "min":  return Math.min(...values);
    default:     return 0;
  }
}

// ─── Column Expression Evaluator ─────────────────────────────────────────────
//
// Supports:
//   Simple:      sum(cal_breakfast)
//   Arithmetic:  sum(carbs_breakfast)/sum(cal_breakfast)*100
//   With suffix: sum(carbs_breakfast)/sum(cal_breakfast)*100&%
//   With suffix: sum(cal_breakfast)& kcal
//
// The part after the first & is appended verbatim to the formatted number.

function evalColumnValue(expr: string, entries: RawEntry[]): string {
  // Split off optional display suffix (everything after the first &)
  const ampIdx  = expr.indexOf("&");
  const suffix  = ampIdx !== -1 ? expr.slice(ampIdx + 1) : "";
  const numExpr = ampIdx !== -1 ? expr.slice(0, ampIdx).trim() : expr.trim();

  // Replace every aggregation call (and bare "count") with its numeric value
  const resolved = numExpr.replace(
    /\b(sum|mean|max|min|count)\(([^)]*)\)|\bcount\b/g,
    (match, fn, prop) => {
      if (!fn) return String(entries.length);          // bare "count"
      return String(evalAgg(fn, prop.trim(), entries));
    }
  );

  // Evaluate the resulting arithmetic expression safely
  let value: number;
  try {
    // User-authored expression evaluated in an isolated function scope
    // eslint-disable-next-line no-new-func
    value = new Function("return (" + resolved + ")")() as number;
    if (!isFinite(value) || isNaN(value)) value = 0;
  } catch {
    value = 0;
  }

  return fmt(value) + suffix;
}

// ─── Format Number ────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

// ─── Group-by Cell Renderer ───────────────────────────────────────────────────

function renderGroupByCell(parent: HTMLElement, key: string): void {
  const td        = parent.createEl("td");
  const wikiMatch = key.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  if (wikiMatch) {
    const linkPath    = wikiMatch[1];
    const displayText = wikiMatch[2]
      ?? linkPath.replace(/\.md$/, "").split("/").pop()
      ?? linkPath;
    td.createEl("a", {
      text: displayText,
      cls:  "internal-link",
      attr: { "data-href": linkPath, href: linkPath },
    });
  } else {
    td.setText(key);
  }
}

// ─── Main Renderer ────────────────────────────────────────────────────────────

export function renderTableChart(
  container: HTMLElement,
  entries: RawEntry[],
  config: TrackerConfig
): void {
  const groupBy    = config.groupBy ?? "";
  const groupLabel = config.groupLabel ?? groupBy;
  const columns    = config.columns ?? [];

  // ── Group entries by groupBy value ──
  const groups = new Map<string, RawEntry[]>();

  for (const entry of entries) {
    const key = groupBy
      ? String(entry.frontmatter[groupBy] ?? "(unknown)")
      : "(all)";

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }

  // Sort groups alphabetically
  const sortedKeys = Array.from(groups.keys()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  // ── Build table ──────────────────────────────────────────────────────────
  const wrapper = container.createEl("div", { cls: "tracker-pro-table-wrapper" });

  if (config.title) {
    wrapper.createEl("div", { cls: "tracker-pro-table-title", text: config.title });
  }

  const table = wrapper.createEl("table", { cls: "tracker-pro-table" });

  // Header row
  const thead = table.createEl("thead");
  const headerRow = thead.createEl("tr");
  headerRow.createEl("th", { text: groupLabel });
  for (const col of columns) {
    headerRow.createEl("th", { text: col.label });
  }

  // Always render the header; bail here if no data so an empty table shows
  if (entries.length === 0) return;

  const tbody = table.createEl("tbody");

  for (const key of sortedKeys) {
    const groupEntries = groups.get(key)!;
    const tr = tbody.createEl("tr");
    renderGroupByCell(tr, key);

    for (const col of columns) {
      tr.createEl("td", { text: evalColumnValue(col.value, groupEntries) });
    }
  }

  // ── Totals row ────────────────────────────────────────────────────────────
  if (sortedKeys.length > 1 && columns.length > 0) {
    const tfoot = table.createEl("tfoot");
    const totalRow = tfoot.createEl("tr");
    totalRow.createEl("td", { text: "Total" });

    for (const col of columns) {
      totalRow.createEl("td", { text: evalColumnValue(col.value, entries) });
    }
  }
}
