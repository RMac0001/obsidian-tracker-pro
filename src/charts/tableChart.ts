import { RawEntry, TrackerConfig, TableColumnDef } from "../types";

// ─── Multiplication alias ─────────────────────────────────────────────────────
// Replaces 'x' with '*' in common positions without stomping property names.
// Handles: "fat x 9", "fat_breakfast x 9", "fatx9", "9xfat"

function normalizeMult(expr: string): string {
  return expr
    .replace(/\s+x\s+/g, " * ")                          // "a x b"  → "a * b"
    .replace(/([a-zA-Z0-9_])\s*x\s*(\d)/g, "$1*$2")      // "propx9" → "prop*9"
    .replace(/(\d)\s*x\s*([a-zA-Z_(])/g, "$1*$2");       // "9xprop" → "9*prop"
}

// ─── Single-aggregation fast path ─────────────────────────────────────────────

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

// ─── Aggregate with inner expression ─────────────────────────────────────────
// Handles sum(fat_breakfast * 9), mean(fat/cal*100), etc.
// For each entry, substitutes property values into the expression, evaluates,
// then applies the aggregation function across all per-entry results.

function evalAggExpr(fn: string, innerExpr: string, entries: RawEntry[]): number {
  const inner = normalizeMult(innerExpr.trim());

  // Fast path: plain property name
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(inner)) {
    return evalAgg(fn, inner, entries);
  }

  // Collect all property-name identifiers (not followed by '(' — those are functions)
  const propRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b(?!\s*\()/g;
  const props = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = propRegex.exec(inner)) !== null) props.add(m[1]);

  const perEntry: number[] = [];
  for (const entry of entries) {
    let e = inner;
    for (const p of props) {
      const v = Number(entry.frontmatter[p] ?? 0);
      e = e.replace(new RegExp(`\\b${p}\\b`, "g"), String(isNaN(v) ? 0 : v));
    }
    try {
      // eslint-disable-next-line no-new-func
      const v = new Function("return (" + e + ")")() as number;
      if (isFinite(v) && !isNaN(v)) perEntry.push(v);
    } catch { /* skip bad entry */ }
  }

  if (perEntry.length === 0) return 0;
  switch (fn) {
    case "sum":   return perEntry.reduce((a, b) => a + b, 0);
    case "mean":  return perEntry.reduce((a, b) => a + b, 0) / perEntry.length;
    case "max":   return Math.max(...perEntry);
    case "min":   return Math.min(...perEntry);
    case "count": return entries.length;
    default:      return 0;
  }
}

// ─── Numeric expression evaluator ────────────────────────────────────────────
// Resolves all agg() calls to numbers, then evaluates the remaining arithmetic.

function evalNumericExpr(expr: string, entries: RawEntry[]): number {
  const normalized = normalizeMult(expr);

  // Replace agg(inner) — inner may contain nested parentheses
  const resolved = normalized
    .replace(
      /\b(sum|mean|max|min|count)\s*\(([^)(]*(?:\([^)(]*\)[^)(]*)*)\)/g,
      (_, fn, inner) => String(evalAggExpr(fn, inner, entries))
    )
    .replace(/\bcount\b/g, String(entries.length));

  try {
    // eslint-disable-next-line no-new-func
    const v = new Function("return (" + resolved + ")")() as number;
    return isFinite(v) && !isNaN(v) ? v : 0;
  } catch {
    return 0;
  }
}

// ─── Column expression evaluator ─────────────────────────────────────────────
//
// & is a string concatenation operator (like Excel / LibreOffice Calc).
// Each segment between & is one of:
//
//   "quoted text"          → literal string, inner spaces preserved
//   sum(prop * 9) / ...    → numeric expression, formatted with fmt()
//   bare words             → literal string, surrounding spaces preserved
//
// Examples:
//   sum(fat_breakfast * 9) / sum(cal_breakfast) * 100
//     → "42.1"
//
//   sum(fat_breakfast * 9) / sum(cal_breakfast) * 100 & "%"
//     → "42.1%"
//
//   "I ate " & sum(cal_breakfast) & " calories today"
//     → "I ate 380 calories today"
//
//   "Fat: " & sum(fat_breakfast * 9) / sum(cal_breakfast) * 100 & "% of calories"
//     → "Fat: 42.1% of calories"

function evalColumnValue(expr: string, entries: RawEntry[]): string {
  // ── Split on & outside quoted strings ────────────────────────────────────
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
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

  // ── Evaluate each part ────────────────────────────────────────────────────
  return parts
    .map((part) => {
      const trimmed = part.trim();

      // Quoted string literal — remove outer quotes, preserve inner content
      if (
        (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
      ) {
        return trimmed.slice(1, -1);
      }

      // Numeric expression — contains an agg function, arithmetic, or leading digit
      if (
        /\b(sum|mean|max|min|count)\s*[\((]/.test(trimmed) ||
        /\bcount\b/.test(trimmed) ||
        /[+\-*\/]/.test(trimmed) ||
        /\bx\b/.test(trimmed) ||
        /^\d/.test(trimmed)
      ) {
        return fmt(evalNumericExpr(trimmed, entries));
      }

      // Bare string literal — preserve surrounding spaces so "I ate & X & today"
      // naturally produces "I ate 380 today" without needing explicit spaces
      return part;
    })
    .join("");
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
