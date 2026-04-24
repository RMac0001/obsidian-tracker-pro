import { RawEntry, TrackerConfig, TableColumnDef } from "../types";

// ─── Row Definition ────────────────────────────────────────────────────────────

interface RowDef {
  label: string;
  key: string;
}

function parseRows(rows: (string | { label: string; key: string })[]): RowDef[] {
  return rows.map((r) => {
    if (typeof r === "string") return { label: r, key: r.toLowerCase() };
    return { label: r.label ?? String(r), key: r.key ?? String(r).toLowerCase() };
  });
}

// ─── Numeric Helpers ───────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

// Substitutes all property identifiers with frontmatter values, then evaluates.
function evalPropExpr(expr: string, fm: Record<string, unknown>): number {
  const propRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b(?!\s*\()/g;
  const props = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = propRegex.exec(expr)) !== null) props.add(m[1]);

  let e = expr;
  for (const p of props) {
    const v = Number(fm[p] ?? 0);
    e = e.replace(new RegExp(`\\b${p}\\b`, "g"), String(isNaN(v) ? 0 : v));
  }

  try {
    // eslint-disable-next-line no-new-func
    const v = new Function("return (" + e + ")")() as number;
    return isFinite(v) && !isNaN(v) ? v : 0;
  } catch {
    return 0;
  }
}

// Resolves agg() calls against a single entry's frontmatter, then evaluates arithmetic.
// For a single-entry context, sum/mean/max/min all just evaluate the inner expression.
function evalNumericExpr(expr: string, fm: Record<string, unknown>): number {
  const resolved = expr
    .replace(
      /\b(sum|mean|max|min|count)\s*\(([^)(]*(?:\([^)(]*\)[^)(]*)*)\)/g,
      (_, fn, inner) => {
        if (fn === "count") return "1";
        return String(evalPropExpr(inner.trim(), fm));
      }
    )
    .replace(/\bcount\b/g, "1");

  try {
    // eslint-disable-next-line no-new-func
    const v = new Function("return (" + resolved + ")")() as number;
    return isFinite(v) && !isNaN(v) ? v : 0;
  } catch {
    return 0;
  }
}

// ─── Cell Expression Evaluator ─────────────────────────────────────────────────
// Substitutes {row} with rowKey, then evaluates as a string/numeric expression.
// & is the concatenation operator (like Excel). Supports quoted string literals.

function evalCellExpr(expr: string, rowKey: string, fm: Record<string, unknown>): string {
  const substituted = expr.replace(/\{row\}/g, rowKey);

  // Split on & outside quoted strings
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < substituted.length; i++) {
    const ch = substituted[i];
    if (inQuote) {
      if (ch === quoteChar) inQuote = false;
      current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
      current += ch;
    } else if (ch === "&") {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);

  return parts
    .map((part) => {
      const trimmed = part.trim();

      if (
        (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
      ) {
        return trimmed.slice(1, -1);
      }

      if (
        /\b(sum|mean|max|min|count)\s*[\((]/.test(trimmed) ||
        /\bcount\b/.test(trimmed) ||
        /[+\-*\/]/.test(trimmed) ||
        /^\d/.test(trimmed)
      ) {
        return fmt(evalNumericExpr(trimmed, fm));
      }

      // Bare text: preserve surrounding spaces so "Label & value" → "Label value"
      return part;
    })
    .join("");
}

// ─── Row Empty Check ───────────────────────────────────────────────────────────

function isRowEmpty(rowKey: string, fm: Record<string, unknown>, columns: TableColumnDef[]): boolean {
  if (columns.length === 0) return false;
  const val = evalCellExpr(columns[0].value, rowKey, fm);
  const n = parseFloat(val);
  return !isNaN(n) && n === 0;
}

// ─── Date Formatter ────────────────────────────────────────────────────────────

function formatDate(date: Date, format: string): string {
  const win = window as unknown as { moment?: (d: Date) => { format: (f: string) => string } };
  if (typeof window !== "undefined" && win.moment) {
    return win.moment(date).format(format);
  }
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

// ─── Main Renderer ─────────────────────────────────────────────────────────────

export function renderDailyTable(
  container: HTMLElement,
  entries: RawEntry[],
  config: TrackerConfig
): void {
  const columns      = config.columns ?? [];
  const dateFormat   = config.dateFormat ?? "MM/DD/YY";
  const showEmpty    = config.showEmptyRows !== false;
  const rowsConfig   = config.rows;
  const totalLabel   = config.totalRow;
  const isExpanded   = Array.isArray(rowsConfig) && rowsConfig.length > 0;
  const rowDefs      = isExpanded ? parseRows(rowsConfig!) : [];

  // Group entries by calendar date (YYYY-MM-DD). Last entry per date wins.
  const byDate = new Map<string, RawEntry>();
  for (const entry of entries) {
    const k =
      entry.date.getFullYear() +
      "-" + String(entry.date.getMonth() + 1).padStart(2, "0") +
      "-" + String(entry.date.getDate()).padStart(2, "0");
    byDate.set(k, entry);
  }

  const sortedDates = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));

  // ── Build table ──────────────────────────────────────────────────────────────
  const wrapper = container.createEl("div", { cls: "tracker-pro-table-wrapper" });

  if (config.title) {
    wrapper.createEl("div", { cls: "tracker-pro-table-title", text: config.title });
  }

  const table = wrapper.createEl("table", { cls: "tracker-pro-table tracker-pro-daily-table" });

  // Header
  const thead = table.createEl("thead");
  const headerRow = thead.createEl("tr");
  headerRow.createEl("th", { text: "Date" });
  if (isExpanded) headerRow.createEl("th", { text: "Meal" });
  for (const col of columns) headerRow.createEl("th", { text: col.label });

  if (entries.length === 0) return;

  const tbody = table.createEl("tbody");

  for (const dateKey of sortedDates) {
    const entry   = byDate.get(dateKey)!;
    const fm      = entry.frontmatter;
    const dateStr = formatDate(entry.date, dateFormat);

    if (isExpanded) {
      const visible = showEmpty
        ? rowDefs
        : rowDefs.filter((row) => !isRowEmpty(row.key, fm, columns));

      let firstRow = true;

      for (const row of visible) {
        const tr = tbody.createEl("tr");

        // Date cell — only on the first visible row of each date group
        const dateTd = tr.createEl("td", { cls: "tracker-pro-daily-date" });
        if (firstRow) { dateTd.setText(dateStr); firstRow = false; }

        tr.createEl("td", { text: row.label, cls: "tracker-pro-daily-meal" });
        for (const col of columns) {
          tr.createEl("td", { text: evalCellExpr(col.value, row.key, fm) });
        }
      }

      // Per-day total row
      if (totalLabel) {
        const tr = tbody.createEl("tr", { cls: "tracker-pro-daily-total" });
        const dateTd = tr.createEl("td", { cls: "tracker-pro-daily-date" });
        // Show date here if all meal rows were hidden
        if (firstRow) { dateTd.setText(dateStr); }
        tr.createEl("td", { text: totalLabel, cls: "tracker-pro-daily-meal tracker-pro-daily-total-label" });
        for (const col of columns) {
          tr.createEl("td", { text: evalCellExpr(col.value, "total", fm) });
        }
      }

    } else {
      // Summary mode: one row per date, key = "total"
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: dateStr, cls: "tracker-pro-daily-date" });
      for (const col of columns) {
        tr.createEl("td", { text: evalCellExpr(col.value, "total", fm) });
      }
    }
  }
}
