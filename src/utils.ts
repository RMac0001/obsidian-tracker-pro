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
