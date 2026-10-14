import { App, TFile } from "obsidian";
import { TrackerSettings } from "./settings";

/**
 * Resolves {{DATE:FORMAT}} tokens in a template string using moment.js.
 * If a date is provided it is used; otherwise the current date is used.
 * FORMAT is any moment.js format string (e.g. YYYY, MM, YYYY-MM, MMMM).
 */
export function resolveDateTemplate(template: string, date?: Date): string {
    const m = date
        ? (window as any).moment(date)
        : (window as any).moment();
    return template.replace(/\{\{DATE:([^}]+)\}\}/g, (_, fmt) => m.format(fmt));
}

// ─── Unit Normalization ────────────────────────────────────────────────────────

export const UNIT_CANONICAL: Record<string, string> = {
    c: "cup",
    cup: "cup",       cups: "cup",
    oz: "oz",         ounce: "oz",      ounces: "oz",
    "fl oz": "fl oz", "fl. oz": "fl oz", "fluid oz": "fl oz",
    "fluid ounce": "fl oz", "fluid ounces": "fl oz",
    tbsp: "tbsp",     tablespoon: "tbsp", tablespoons: "tbsp",
    tsp: "tsp",       teaspoon: "tsp",    teaspoons: "tsp",
    lb: "lb",         lbs: "lb",          pound: "lb",   pounds: "lb",
    g: "g",           gram: "g",          grams: "g",
    kg: "kg",         kilogram: "kg",     kilograms: "kg",
    ml: "ml",         milliliter: "ml",   milliliters: "ml",
    l: "l",           liter: "l",         liters: "l",
    slice: "slice",   slices: "slice",
    piece: "piece",   pieces: "piece",
    serving: "serving", servings: "serving",
    pint: "pint",     pints: "pint",    pt: "pint",
    quart: "quart",   quarts: "quart",  qt: "quart",
};

export function normalizeUnit(unit: string): string {
    const key = unit.toLowerCase().trim();
    return UNIT_CANONICAL[key] ?? key;
}

export function fmt2(n: number): string {
    return parseFloat(n.toFixed(2)).toString();
}

// ─── Time Value Helpers ────────────────────────────────────────────────────────

const TIME_VALUE_RE = /^\d{1,3}:\d{2}$/;

export function parseTimeToSeconds(raw: string): number | null {
    const trimmed = raw.trim();
    if (!TIME_VALUE_RE.test(trimmed)) return null;
    const [minutesStr, secondsStr] = trimmed.split(":");
    const minutes = parseInt(minutesStr, 10);
    const seconds = parseInt(secondsStr, 10);
    if (seconds > 59) return null;
    return minutes * 60 + seconds;
}

export function formatSecondsAsTime(totalSeconds: number): string {
    const rounded = Math.round(totalSeconds);
    const m = Math.floor(rounded / 60);
    const s = rounded % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Config Date Helpers ────────────────────────────────────────────────────────
// Parses startDate/endDate values from a tracker config block. Accepts
// YYYY-MM-DD, MM/DD/YYYY (single-digit month/day allowed), or a JS Date
// (what js-yaml produces for an unquoted ISO date, always at UTC midnight —
// its UTC Y/M/D is read off and rebuilt as local midnight to avoid shifting
// a day in negative-UTC-offset timezones).

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

export function parseConfigDate(raw: unknown): Date | null {
    let y: number, m: number, d: number;

    if (raw instanceof Date) {
        y = raw.getUTCFullYear();
        m = raw.getUTCMonth() + 1;
        d = raw.getUTCDate();
    } else if (typeof raw === "string") {
        const trimmed = raw.trim();
        const isoMatch = trimmed.match(ISO_DATE_RE);
        const usMatch = trimmed.match(US_DATE_RE);
        if (isoMatch) {
            y = Number(isoMatch[1]);
            m = Number(isoMatch[2]);
            d = Number(isoMatch[3]);
        } else if (usMatch) {
            m = Number(usMatch[1]);
            d = Number(usMatch[2]);
            y = Number(usMatch[3]);
        } else {
            return null;
        }
    } else {
        return null;
    }

    const date = new Date(y, m - 1, d);
    // Reject impossible dates (e.g. 02/31/2026) via a Y/M/D round-trip check
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
        return null;
    }
    return date;
}

export function toYMD(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

// ─── Named Colours ──────────────────────────────────────────────────────────────

const NAMED_COLORS: Record<string, string> = {
    red:    "#f76c6c",
    blue:   "#4f86f7",
    green:  "#43c59e",
    yellow: "#f7c948",
    orange: "#e67e22",
    purple: "#9b59b6",
    black:  "#333333",
};

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;
const HEX3_RE = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/;

export function resolveColor(input: string): string | null {
    const trimmed = input.trim();
    if (HEX6_RE.test(trimmed)) return trimmed;
    const hex3Match = trimmed.match(HEX3_RE);
    if (hex3Match) {
        const [, r, g, b] = hex3Match;
        return `#${r}${r}${g}${g}${b}${b}`;
    }
    const named = NAMED_COLORS[trimmed.toLowerCase()];
    if (named) return named;
    return null;
}

// ─── Slugify ────────────────────────────────────────────────────────────────────

export function slugify(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

// ─── Section Range ─────────────────────────────────────────────────────────────

export function findSectionRange(
    lines: string[],
    header: string
): { start: number; end: number } | null {
    const headerRe = new RegExp(`^#{1,6}\\s+${header}\\s*$`, "i");
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (headerRe.test(lines[i])) { start = i + 1; break; }
    }
    if (start === -1) return null;
    let end = lines.length;
    for (let i = start; i < lines.length; i++) {
        if (/^#{1,6}\s/.test(lines[i])) { end = i; break; }
    }
    return { start, end };
}

// ─── Exercise Display Name & Wikilinks ─────────────────────────────────────────
// Exercise notes are filed under an internal name (e.g. Exercise-Recumbent-Bike)
// with a human-facing display_name in frontmatter. Everywhere an exercise's
// identity is shown or keyed, resolve through this helper — never file.basename
// directly — and resolve wikilinks by their TARGET, never by trusting alias text
// (an alias can drift out of sync with the note's current display_name).

export function getExerciseDisplayName(app: App, file: TFile): string {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    const displayName = fm?.display_name;
    return displayName ? String(displayName) : file.basename;
}

export function parseWikilink(text: string): { target: string; alias?: string } | null {
    const m = text.trim().match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    if (!m) return null;
    return { target: m[1].trim(), alias: m[2]?.trim() };
}

export function resolveWikilinkTarget(app: App, target: string, sourcePath: string): TFile | null {
    return app.metadataCache.getFirstLinkpathDest(target.replace(/\.md$/, ""), sourcePath);
}

// ─── Candidate Files ───────────────────────────────────────────────────────────

export function getCandidateFiles(
    app: App,
    settings: TrackerSettings
): { file: TFile; isFood: boolean }[] {
    const foodFolder   = settings.foodFolder.replace(/\/$/, "");
    const recipeFolder = settings.recipeFolder.replace(/\/$/, "");
    const result: { file: TFile; isFood: boolean }[] = [];
    for (const file of app.vault.getMarkdownFiles()) {
        if (file.path.startsWith(foodFolder + "/")) {
            result.push({ file, isFood: true });
        } else if (file.path.startsWith(recipeFolder + "/")) {
            result.push({ file, isFood: false });
        }
    }
    return result;
}
