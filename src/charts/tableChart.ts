import { RawEntry, TrackerConfig, TableColumnDef } from "../types";

// ─── Column Expression Evaluator ─────────────────────────────────────────────

function evalColumnValue(expr: string, entries: RawEntry[]): number {
  if (expr === "count") {
    return entries.length;
  }

  const match = expr.match(/^(sum|mean|max|min)\((.+)\)$/);
  if (!match) return 0;

  const [, fn, prop] = match;
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

// ─── Format Number ────────────────────────────────────────────────────────────

function fmt(n: number): string {
  // Show up to 1 decimal place, drop trailing zeros
  return n % 1 === 0 ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

// ─── Group-by Cell Renderer ───────────────────────────────────────────────────

function renderGroupByCell(parent: HTMLElement, key: string): void {
  const td         = parent.createEl("td");
  const wikiMatch  = key.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
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

  // Body rows
  // Always render the header; bail here if no data so an empty table shows
  if (entries.length === 0) return;

  const tbody = table.createEl("tbody");

  for (const key of sortedKeys) {
    const groupEntries = groups.get(key)!;
    const tr = tbody.createEl("tr");
    renderGroupByCell(tr, key);

    for (const col of columns) {
      const val = evalColumnValue(col.value, groupEntries);
      tr.createEl("td", { text: fmt(val) });
    }
  }

  // ── Totals row ────────────────────────────────────────────────────────────
  if (sortedKeys.length > 1 && columns.length > 0) {
    const tfoot = table.createEl("tfoot");
    const totalRow = tfoot.createEl("tr");
    totalRow.createEl("td", { text: "Total" });

    for (const col of columns) {
      // For count/sum: sum across all entries; for mean/max/min: compute over all
      const val = evalColumnValue(col.value, entries);
      totalRow.createEl("td", { text: fmt(val) });
    }
  }
}
