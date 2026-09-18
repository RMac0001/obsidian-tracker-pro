import { App } from "obsidian";
import { RawEntry, TrackerConfig, TableColumnDef } from "../types";
import { TrackerSettings } from "../settings";
import { getExerciseDisplayName, slugify } from "../utils";

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
  const inner = innerExpr.trim();

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
  // Replace agg(inner) — inner may contain nested parentheses
  const resolved = expr
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

// ─── Auto-Pivot (Workout Routines rollup keys) ────────────────────────────────
// The wide Data/Workouts session-note schema has no literal "exercise" key —
// values live under exercise-prefixed keys instead (bench_press_sets,
// walk_duration_min). When a table's groupBy value isn't a literal frontmatter
// key on the scanned notes, recover each note's exercise slug(s) by stripping
// the plugin's own known rollup suffixes off every key instead, and group by
// those. Auto-detected from logged data only — this never reads or affects
// the hand-maintained exercise database in Data/Exercises; that stays a
// completely separate system.

const ROLLUP_SUFFIXES = [
  "top_weight", "duration_min", "avg_hr", "peak_hr",
  "equipment", "distance", "volume", "speed", "sets", "reps", "pace",
];
const SLUG_SUFFIX_RE = new RegExp(`^(.+)_(${ROLLUP_SUFFIXES.join("|")})$`);

// Builds one virtualized RawEntry per (entry, slug) pair, with rollup keys
// remapped to their generic (unprefixed) name, so the existing column-value
// evaluator works unchanged against a slug's group exactly as it already does
// for literal groupBy values.
function buildPivotGroups(entries: RawEntry[]): Map<string, RawEntry[]> {
  const groups = new Map<string, RawEntry[]>();
  for (const entry of entries) {
    const perSlugFm = new Map<string, Record<string, unknown>>();
    for (const key of Object.keys(entry.frontmatter)) {
      const m = key.match(SLUG_SUFFIX_RE);
      if (!m) continue;
      const slug = m[1];
      const suffix = m[2];
      const genericKey = suffix === "duration_min" ? "time_min" : suffix;
      if (!perSlugFm.has(slug)) perSlugFm.set(slug, {});
      perSlugFm.get(slug)![genericKey] = entry.frontmatter[key];
    }
    for (const [slug, fm] of perSlugFm) {
      // No per-exercise duration for this session (e.g. a strength exercise
      // logged going forward, where duration only exists at the whole-session
      // level) — credit the session's full time_min unsplit, not zero.
      if (fm["time_min"] === undefined && entry.frontmatter["time_min"] !== undefined) {
        fm["time_min"] = entry.frontmatter["time_min"];
      }
      if (!groups.has(slug)) groups.set(slug, []);
      groups.get(slug)!.push({ ...entry, frontmatter: fm });
    }
  }
  return groups;
}

function resolveDisplayNameForSlug(slug: string, app: App, settings: TrackerSettings): string {
  const folder = settings.exerciseFolder.replace(/\/$/, "");
  for (const file of app.vault.getMarkdownFiles()) {
    if (!file.path.startsWith(folder + "/")) continue;
    if (slugify(getExerciseDisplayName(app, file)) === slug) return getExerciseDisplayName(app, file);
  }
  // Orphaned slug (exercise since deleted/renamed) — humanize rather than show raw text
  return slug.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
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
  config: TrackerConfig,
  app?: App,
  settings?: TrackerSettings
): void {
  const groupBy    = config.groupBy ?? "";
  const groupLabel = config.groupLabel ?? groupBy;
  const columns    = config.columns ?? [];

  const usePivot = !!groupBy && !!app && !!settings &&
    !entries.some(e => e.frontmatter[groupBy] !== undefined);

  // ── Group entries by groupBy value (or by auto-detected exercise slug) ──
  const groups = usePivot
    ? buildPivotGroups(entries)
    : (() => {
        const g = new Map<string, RawEntry[]>();
        for (const entry of entries) {
          const key = groupBy ? String(entry.frontmatter[groupBy] ?? "(unknown)") : "(all)";
          if (!g.has(key)) g.set(key, []);
          g.get(key)!.push(entry);
        }
        return g;
      })();

  const labelFor = (key: string) => usePivot ? resolveDisplayNameForSlug(key, app!, settings!) : key;

  // Sort groups alphabetically (by resolved display name when pivoted)
  const sortedKeys = Array.from(groups.keys()).sort((a, b) =>
    labelFor(a).localeCompare(labelFor(b), undefined, { sensitivity: "base" })
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
    if (usePivot) {
      tr.createEl("td", { text: labelFor(key) });
    } else {
      renderGroupByCell(tr, key);
    }

    for (const col of columns) {
      tr.createEl("td", { text: evalColumnValue(col.value, groupEntries) });
    }
  }

  // ── Totals row ────────────────────────────────────────────────────────────
  // Pivoted mode sums over the virtualized per-slug entries, not the raw
  // session notes — a literal "sets"/"time_min" key doesn't exist on those.
  if (sortedKeys.length > 1 && columns.length > 0) {
    const totalsSource = usePivot ? Array.from(groups.values()).flat() : entries;
    const tfoot = table.createEl("tfoot");
    const totalRow = tfoot.createEl("tr");
    totalRow.createEl("td", { text: "Total" });

    for (const col of columns) {
      totalRow.createEl("td", { text: evalColumnValue(col.value, totalsSource) });
    }
  }
}
