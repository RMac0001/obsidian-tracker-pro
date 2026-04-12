import { App, TFile, TFolder } from "obsidian";
import { TrackerConfig, RawEntry, SeriesData, OHLCDataPoint, DataPoint } from "./types";
import { resolveStartEnd } from "./parser";

// ─── File Resolution ──────────────────────────────────────────────────────────

function resolveFiles(app: App, config: TrackerConfig): TFile[] {
  const files: TFile[] = [];

  if (config.folder) {
    const folder = app.vault.getAbstractFileByPath(
      config.folder.replace(/^\//, "")
    );
    if (folder instanceof TFolder) {
      collectFiles(folder, files);
    }
  }

  if (config.file) {
    const f = app.vault.getFileByPath(config.file.replace(/^\//, "") + (config.file.endsWith(".md") ? "" : ".md"));
    if (f) files.push(f);
  }

  if (config.files) {
    for (const fp of config.files) {
      const f = app.vault.getFileByPath(fp.replace(/^\//, "") + (fp.endsWith(".md") ? "" : ".md"));
      if (f) files.push(f);
    }
  }

  return files;
}

function collectFiles(folder: TFolder, out: TFile[]) {
  for (const child of folder.children) {
    if (child instanceof TFile && child.extension === "md") {
      out.push(child);
    } else if (child instanceof TFolder) {
      collectFiles(child, out);
    }
  }
}

// ─── Date Parsing ────────────────────────────────────────────────────────────
// IMPORTANT: bare ISO date strings like "2026-04-09" are parsed by JavaScript
// as UTC midnight. In any timezone behind UTC this shifts the local date back
// by one day. We always parse date-only strings as LOCAL midnight instead.

function parseLocalDate(raw: unknown): Date | null {
  if (!raw) return null;
  const str = String(raw).trim();

  // ISO date-only: YYYY-MM-DD → parse as local midnight
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(+iso[1], +iso[2] - 1, +iso[3]);
    return isNaN(d.getTime()) ? null : d;
  }

  // Everything else (datetime strings, locale strings like "04/09/2026"):
  // new Date() handles these as local time already
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Date Extraction ──────────────────────────────────────────────────────────

function extractDate(file: TFile, frontmatter: Record<string, unknown>, dateProperty?: string): Date | null {
  // 1. Explicit dateProperty in frontmatter
  if (dateProperty && frontmatter[dateProperty]) {
    const d = parseLocalDate(frontmatter[dateProperty]);
    if (d) return d;
  }

  // 2. Common frontmatter date fields
  for (const key of ["date", "created", "day", "timestamp"]) {
    if (frontmatter[key]) {
      const d = parseLocalDate(frontmatter[key]);
      if (d) return d;
    }
  }

  // 3. File name pattern: YYYY-MM-DD anywhere in basename
  const nameMatch = file.basename.match(/(\d{4}-\d{2}-\d{2})/);
  if (nameMatch) {
    const d = parseLocalDate(nameMatch[1]);
    if (d) return d;
  }

  // 4. File creation time
  return new Date(file.stat.ctime);
}

// ─── FileMeta Value Extraction ────────────────────────────────────────────────

const FRONTMATTER_RE = /^---[\s\S]*?---\n?/;

async function extractFileMetaValue(
  app: App,
  file: TFile,
  target: string
): Promise<number | null> {
  switch (target) {
    case "numWords": {
      const content = await app.vault.cachedRead(file);
      // Strip frontmatter before counting
      const body = content.replace(FRONTMATTER_RE, "").trim();
      if (!body) return 0;
      const words = body.match(/\S+/g);
      return words ? words.length : 0;
    }
    case "numChars": {
      const content = await app.vault.cachedRead(file);
      const body = content.replace(FRONTMATTER_RE, "").trim();
      return body.length;
    }
    case "numSentences": {
      const content = await app.vault.cachedRead(file);
      const body = content.replace(FRONTMATTER_RE, "").trim();
      if (!body) return 0;
      const sentences = body.match(/[^.!?]+[.!?]+/g);
      return sentences ? sentences.length : 0;
    }
    case "numLinks": {
      const cache = app.metadataCache.getFileCache(file);
      return (cache?.links?.length ?? 0) + (cache?.embeds?.length ?? 0);
    }
    case "size":
      return file.stat.size;
    default:
      return null;
  }
}

// ─── Numeric Value Extraction ─────────────────────────────────────────────────

function extractNumericValue(
  frontmatter: Record<string, unknown>,
  property: string
): number | null {
  const raw = frontmatter[property];
  if (raw === undefined || raw === null || raw === "") return null;

  if (typeof raw === "boolean") return raw ? 1 : 0;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseFloat(raw);
    if (!isNaN(n)) return n;
  }
  if (Array.isArray(raw)) return raw.length;

  return null;
}

// ─── Raw Entry Collection ─────────────────────────────────────────────────────

export async function collectRawEntries(
  app: App,
  config: TrackerConfig
): Promise<RawEntry[]> {
  const files = resolveFiles(app, config);
  const { start, end } = resolveStartEnd(config);
  const entries: RawEntry[] = [];
  const isFileMeta = (config as any).source === "fileMeta";
  const fileMetaTarget: string = (config as any).target ?? "numWords";

  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    const date = extractDate(file, frontmatter, config.dateProperty);

    if (!date) continue;

    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());

    if (d >= s && d <= e) {
      // For fileMeta, inject the computed value into a synthetic frontmatter key
      let fm = frontmatter;
      if (isFileMeta) {
        const val = await extractFileMetaValue(app, file, fileMetaTarget);
        fm = { ...frontmatter, [fileMetaTarget]: val };
      }
      entries.push({ date: d, filePath: file.path, frontmatter: fm });
    }
  }

  entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  return entries;
}

// ─── Series Builder ───────────────────────────────────────────────────────────

export function buildSeriesData(
  entries: RawEntry[],
  config: TrackerConfig
): SeriesData[] {
  const isFileMeta = (config as any).source === "fileMeta";
  const fileMetaTarget: string = (config as any).target ?? "numWords";

  // For fileMeta, the property to read is the synthetic key we injected
  const properties = isFileMeta
    ? [fileMetaTarget]
    : (config.properties as string[]);

  const defaultColors = [
    "#4f86f7", "#f76c6c", "#43c59e", "#f7c948",
    "#9b59b6", "#e67e22", "#1abc9c", "#e74c3c",
  ];

  return properties.map((prop, i) => {
    const points: DataPoint[] = entries.map((entry) => ({
      date: entry.date,
      value: extractNumericValue(entry.frontmatter, prop),
    }));

    return {
      name: prop,
      points,
      color: config.colors?.[i] ?? defaultColors[i % defaultColors.length],
    };
  });
}

// ─── OHLC Builder (Candlestick) ───────────────────────────────────────────────

export function buildOHLCData(
  entries: RawEntry[],
  config: TrackerConfig
): OHLCDataPoint[] {
  const props = config.properties as {
    open: string; high: string; low: string; close: string; volume?: string;
  };

  return entries
    .map((entry) => {
      const open  = extractNumericValue(entry.frontmatter, props.open);
      const high  = extractNumericValue(entry.frontmatter, props.high);
      const low   = extractNumericValue(entry.frontmatter, props.low);
      const close = extractNumericValue(entry.frontmatter, props.close);

      if (open === null || high === null || low === null || close === null) return null;

      const point: OHLCDataPoint = { date: entry.date, open, high, low, close };
      if (props.volume) {
        point.volume = extractNumericValue(entry.frontmatter, props.volume) ?? undefined;
      }
      return point;
    })
    .filter((p): p is OHLCDataPoint => p !== null);
}

// ─── Frequency Counter (Pie / Donut) ─────────────────────────────────────────

export function buildFrequencyData(
  entries: RawEntry[],
  config: TrackerConfig
): Map<string, number> {
  const properties = config.properties as string[];
  const freq = new Map<string, number>();

  for (const entry of entries) {
    for (const prop of properties) {
      const raw = entry.frontmatter[prop];
      if (raw === undefined || raw === null) continue;

      if (Array.isArray(raw)) {
        for (const item of raw) {
          const key = String(item);
          freq.set(key, (freq.get(key) ?? 0) + 1);
        }
      } else {
        const key = String(raw);
        freq.set(key, (freq.get(key) ?? 0) + 1);
      }
    }
  }

  return freq;
}
