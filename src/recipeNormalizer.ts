import { App, Modal, Notice, TFile, prepareFuzzySearch } from "obsidian";
import { TrackerSettings } from "./settings";
import { Skipped, applyNotesSection } from "./recipeCalculator";
import { findSectionRange, getCandidateFiles, UNIT_CANONICAL, fmt2 } from "./utils";

// ─── Seasoning Detection ───────────────────────────────────────────────────────

export const SEASONING_EXPLICIT = new Set([
    "garlic powder", "onion powder", "paprika", "smoked paprika", "cumin",
    "chili powder", "cayenne", "bay leaves", "bay leaf", "nutmeg", "cinnamon", "allspice",
]);

function isSeasoning(desc: string): boolean {
    const lower = desc.toLowerCase().trim();
    if (/\b(salt|pepper)\b/.test(lower)) return true;
    if (/seasoning\s*$/.test(lower)) return true;
    if (/^(dried|ground)\s+/.test(lower)) return true;
    if (SEASONING_EXPLICIT.has(lower)) return true;
    return false;
}

// ─── Unicode Fraction Map ──────────────────────────────────────────────────────

const UNICODE_FRACTIONS: Record<string, number> = {
    "¼": 0.25, "½": 0.5,  "¾": 0.75,
    "⅓": 1/3,  "⅔": 2/3,
    "⅕": 0.2,  "⅖": 0.4,  "⅗": 0.6,  "⅘": 0.8,
    "⅙": 1/6,  "⅚": 5/6,
    "⅛": 0.125,"⅜": 0.375,"⅝": 0.625,"⅞": 0.875,
};

const UNICODE_FRAC_RE = /^[¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/;

function parseFraction(s: string): number {
    const parts = s.split("/");
    return parseInt(parts[0]) / parseInt(parts[1]);
}

// ─── Prep-Action Lists ─────────────────────────────────────────────────────────

const PREP_ACTIONS = [
    "drained and rinsed", "finely chopped", "roughly chopped", "coarsely chopped",
    "finely diced", "thinly sliced", "finely grated",
    "chopped", "diced", "sliced", "minced", "grated", "shredded", "crushed",
    "melted", "softened", "torn", "drained", "rinsed", "peeled", "trimmed",
    "julienned", "cubed", "halved", "quartered", "zested", "juiced",
].sort((a, b) => b.length - a.length);

const TRAILING_PHRASES = [
    "plus more for serving", "plus more", "for garnish", "for serving",
    "to taste", "as needed",
    "cut into thirds", "cut into pieces", "cut into chunks",
    "cut in half", "cut into cubes", "cut into strips",
    "divided", "at room temperature", "room temperature",
    "thawed", "well drained", "lightly beaten",
].sort((a, b) => b.length - a.length);

const RECIPE_ADJECTIVES = [
    "extra-large", "low-sodium", "low sodium",
    "medium", "large", "small", "whole",
    "fresh", "frozen", "raw", "cooked",
    "extra large",
].sort((a, b) => b.length - a.length);

const CONTAINER_WORDS = new Set([
    "can", "cans", "jar", "jars",
    "bottle", "bottles", "package", "packages", "pkg",
    "carton", "cartons", "bag", "bags",
]);

// ─── Core Extraction ───────────────────────────────────────────────────────────

function extractCore(desc: string): { leading: string; core: string; trailing: string } {
    let text = desc;
    let leading = "";
    let trailing = "";

    // Strip one leading prep action (longest first)
    for (const action of PREP_ACTIONS) {
        if (text.toLowerCase().startsWith(action + " ")) {
            leading = text.slice(0, action.length + 1);
            text = text.slice(action.length + 1);
            break;
        }
    }

    // Strip one leading recipe adjective (discarded, not added to leading)
    for (const adj of RECIPE_ADJECTIVES) {
        if (text.toLowerCase().startsWith(adj + " ")) {
            text = text.slice(adj.length + 1);
            break;
        }
    }

    // Repeatedly strip trailing parentheticals and comma-clauses
    let changed = true;
    while (changed) {
        changed = false;

        // Trailing parenthetical
        const parenM = text.match(/^(.*?)(\s*\([^)]*\))$/);
        if (parenM && parenM[2]) {
            trailing = parenM[2] + trailing;
            text = parenM[1].trimEnd();
            changed = true;
            continue;
        }

        // Trailing comma-clause (prep action or trailing-only phrase)
        const commaIdx = text.lastIndexOf(",");
        if (commaIdx !== -1) {
            const afterComma = text.slice(commaIdx + 1).trim().toLowerCase();
            if (
                TRAILING_PHRASES.some(p => afterComma === p) ||
                PREP_ACTIONS.some(p => afterComma === p)
            ) {
                trailing = text.slice(commaIdx) + trailing;
                text = text.slice(0, commaIdx);
                changed = true;
            }
        }
    }

    return { leading, core: text.trim(), trailing };
}

// ─── Quantity Normalization ────────────────────────────────────────────────────

function normalizeQtyRest(qtyStr: string, rest: string): { normalized: string; foodDesc: string } {
    // Two-word unit: "fl oz"
    const flOzM = rest.match(/^(fl\.?\s*oz\.?)\s*(.*)/i);
    if (flOzM) {
        const remainder = flOzM[2];
        return {
            normalized: `${qtyStr} fl oz${remainder ? " " + remainder : ""}`,
            foodDesc: remainder,
        };
    }
    // Single-word unit with optional trailing period
    const wordM = rest.match(/^([a-zA-Z.]+)\s*(.*)/);
    if (wordM) {
        const rawUnit = wordM[1].replace(/\./g, "").toLowerCase();
        const canonical = UNIT_CANONICAL[rawUnit];
        if (canonical) {
            const remainder = wordM[2];
            return {
                normalized: `${qtyStr} ${canonical}${remainder ? " " + remainder : ""}`,
                foodDesc: remainder,
            };
        }
    }
    // No recognizable unit — just normalize the number
    return { normalized: `${qtyStr}${rest ? " " + rest : ""}`, foodDesc: rest };
}

interface ClassifiedLine {
    idx: number;
    bulletPrefix: string;
    originalContent: string;   // never changes
    type: "a" | "b" | "c" | "d" | "e";
    qtyPrefix: string;         // "2 tbsp " or "" — separates qty+unit from foodDesc
    foodDesc: string;          // current food description (updates after review modal)
    currentContent: string;    // full content after bullet (updated through steps)
    isSeasoning: boolean;
    linked: boolean;
    leftUnlinked: boolean;
}

function classifyContent(content: string): {
    type: "a" | "b" | "c" | "d" | "e";
    qtyPrefix: string;
    foodDesc: string;
} {
    // (a) Already linked
    if (content.includes("[[")) {
        return { type: "a", qtyPrefix: "", foodDesc: content };
    }

    // (b) No quantity — doesn't start with digit or unicode fraction
    if (!/^\d/.test(content) && !UNICODE_FRAC_RE.test(content)) {
        return { type: "b", qtyPrefix: "", foodDesc: content };
    }

    // (c) Packaged-quantity: count (amount-unit)
    const packedM = content.match(/^(\d+(?:\.\d+)?)\s+\((\d+(?:\.\d+)?)-([a-zA-Z.]+)\)(.*)/);
    if (packedM) {
        const count   = parseFloat(packedM[1]);
        const amount  = parseFloat(packedM[2]);
        const unitRaw = packedM[3].replace(/\./g, "").toLowerCase();
        const canonical = UNIT_CANONICAL[unitRaw];
        if (canonical) {
            const total     = count * amount;
            const restRaw   = packedM[4].trim();
            const restWords = restRaw.split(/\s+/);
            const foodDesc  = CONTAINER_WORDS.has(restWords[0]?.toLowerCase())
                ? restWords.slice(1).join(" ")
                : restRaw;
            return {
                type: "c",
                qtyPrefix: `${fmt2(total)} ${canonical} `,
                foodDesc,
            };
        }
        // Unit doesn't resolve → (e)
    }

    // Range check → (e)
    if (/^\d+(?:\.\d+)?[-]\d+/.test(content) || /^\d+(?:\.\d+)?\s+to\s+\d+/i.test(content)) {
        return { type: "e", qtyPrefix: "", foodDesc: content };
    }

    // (d) Simple quantity + optional unit

    // Mixed number: "1 1/2 cups ..."
    const mixedM = content.match(/^(\d+)\s+(\d+\/\d+)\s+(.*)/);
    if (mixedM) {
        const qty = parseInt(mixedM[1]) + parseFraction(mixedM[2]);
        const { normalized, foodDesc } = normalizeQtyRest(fmt2(qty), mixedM[3]);
        const qtyPrefix = normalized.slice(0, normalized.length - foodDesc.length);
        return { type: "d", qtyPrefix, foodDesc };
    }

    // ASCII fraction: "1/2 cup ..."
    const fracM = content.match(/^(\d+\/\d+)\s+(.*)/);
    if (fracM) {
        const qty = parseFraction(fracM[1]);
        const { normalized, foodDesc } = normalizeQtyRest(fmt2(qty), fracM[2]);
        const qtyPrefix = normalized.slice(0, normalized.length - foodDesc.length);
        return { type: "d", qtyPrefix, foodDesc };
    }

    // Unicode fraction: "½ cup ..."
    const uniChar = content[0];
    if (UNICODE_FRACTIONS[uniChar] !== undefined) {
        const qty     = UNICODE_FRACTIONS[uniChar];
        const rest    = content.slice(1).trimStart();
        const { normalized, foodDesc } = normalizeQtyRest(fmt2(qty), rest);
        const qtyPrefix = normalized.slice(0, normalized.length - foodDesc.length);
        return { type: "d", qtyPrefix, foodDesc };
    }

    // Decimal/integer: "2 tbsp ..."
    const numM = content.match(/^(\d+(?:\.\d+)?)\s*(.*)/);
    if (numM) {
        const qty     = parseFloat(numM[1]);
        const rest    = numM[2];
        const { normalized, foodDesc } = normalizeQtyRest(fmt2(qty), rest);
        const qtyPrefix = normalized.slice(0, normalized.length - foodDesc.length);
        return { type: "d", qtyPrefix, foodDesc };
    }

    return { type: "e", qtyPrefix: "", foodDesc: content };
}

// Heuristically re-extract foodDesc from text that may have an unknown qty format
function extractFoodDescFromText(text: string): { qtyPrefix: string; foodDesc: string } {
    const numM = text.match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)\s+(.*)/);
    if (numM) {
        return { qtyPrefix: `${numM[1]} ${numM[2]} `, foodDesc: numM[3] };
    }
    const numOnly = text.match(/^(\d+(?:\.\d+)?)\s+(.*)/);
    if (numOnly) {
        return { qtyPrefix: `${numOnly[1]} `, foodDesc: numOnly[2] };
    }
    return { qtyPrefix: "", foodDesc: text };
}

// ─── Link Helpers ──────────────────────────────────────────────────────────────

function naiveSingularPlural(s: string): string[] {
    if (s.endsWith("s") && s.length > 1) return [s, s.slice(0, -1)];
    return [s, s + "s"];
}

function buildLink(basename: string, core: string): string {
    const variants = naiveSingularPlural(core);
    if (variants.includes(basename)) return `[[${basename}]]`;
    return `[[${basename}|${core}]]`;
}

// ─── Review Modal (Step 3) ─────────────────────────────────────────────────────

class IngredientReviewModal extends Modal {
    constructor(
        app: App,
        private line: string,
        private current: number,
        private total: number,
        private resolve: (result: string | null) => void
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", {
            text: `Review ingredient (${this.current} of ${this.total})`,
        });
        contentEl.createEl("p", {
            text: this.line,
            attr: { style: "font-family:monospace;color:var(--text-muted);margin-bottom:12px;" },
        });

        const input = contentEl.createEl("input") as HTMLInputElement;
        input.type = "text";
        input.value = this.line;
        input.style.cssText = "width:100%;margin-bottom:16px;font-family:monospace;";

        const btnRow = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;" } });
        const confirmBtn = btnRow.createEl("button", { text: "Confirm", cls: "mod-cta" });
        confirmBtn.addEventListener("click", () => {
            this.close();
            this.resolve(input.value);
        });
        btnRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => {
            this.close();
            this.resolve(null);
        });

        input.focus();
        input.select();
    }

    onClose(): void { this.contentEl.empty(); }
}

// ─── Link Modal (Step 6) ───────────────────────────────────────────────────────

interface LinkResult {
    action: "link" | "create" | "unlinked";
    file?: TFile;
    name?: string;
}

interface LinkQueueItem {
    cl: ClassifiedLine;
    leading: string;
    core: string;
    trailing: string;
    candidates: { file: TFile; isFood: boolean }[];
}

class IngredientLinkModal extends Modal {
    private candidatePool: { file: TFile; isFood: boolean }[];
    private searchInput!: HTMLInputElement;
    private candidatesEl!: HTMLDivElement;

    constructor(
        app: App,
        private item: LinkQueueItem,
        private current: number,
        private total: number,
        allCandidates: { file: TFile; isFood: boolean }[],
        private resolve: (result: LinkResult | null) => void
    ) {
        super(app);
        this.candidatePool = allCandidates;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", {
            text: `Link ingredient (${this.current} of ${this.total})`,
        });
        contentEl.createEl("p", {
            text: this.item.cl.currentContent,
            attr: { style: "font-family:monospace;color:var(--text-muted);margin-bottom:12px;" },
        });

        // Search input + button
        const searchRow = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;margin-bottom:12px;" } });
        this.searchInput = searchRow.createEl("input") as HTMLInputElement;
        this.searchInput.type = "text";
        this.searchInput.value = this.item.core;
        this.searchInput.style.cssText = "flex:1;font-family:monospace;";
        const searchBtn = searchRow.createEl("button", { text: "Search" });
        searchBtn.addEventListener("click", () => this.renderCandidates(this.searchInput.value));

        this.searchInput.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter") this.renderCandidates(this.searchInput.value);
        });

        // Candidate buttons container
        this.candidatesEl = contentEl.createDiv({ attr: { style: "margin-bottom:12px;" } });
        this.renderCandidates(this.item.core);

        // Action buttons
        const btnRow = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;flex-wrap:wrap;" } });

        const createBtn = btnRow.createEl("button", { text: "Create new food note" });
        createBtn.addEventListener("click", () => {
            this.close();
            this.resolve({ action: "create", name: this.searchInput.value });
        });

        const skipBtn = btnRow.createEl("button", { text: "Leave unlinked" });
        skipBtn.addEventListener("click", () => {
            this.close();
            this.resolve({ action: "unlinked" });
        });

        const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener("click", () => {
            this.close();
            this.resolve(null);
        });
    }

    private renderCandidates(query: string): void {
        this.candidatesEl.empty();
        const searcher = prepareFuzzySearch(query);
        const results = this.candidatePool
            .map(c => ({ ...c, result: searcher(c.file.basename) }))
            .filter(c => c.result !== null && c.result.score > -1)
            .sort((a, b) => (b.result?.score ?? -Infinity) - (a.result?.score ?? -Infinity))
            .slice(0, 5);

        if (results.length === 0) {
            this.candidatesEl.createEl("p", {
                text: "No matches found.",
                attr: { style: "color:var(--text-muted);font-size:0.85em;" },
            });
            return;
        }

        for (const r of results) {
            const btn = this.candidatesEl.createEl("button");
            btn.style.cssText = "display:block;width:100%;text-align:left;margin-bottom:4px;";
            const label = r.isFood ? r.file.basename : `${r.file.basename} (Recipe)`;
            btn.setText(label);
            btn.addEventListener("click", () => {
                this.close();
                this.resolve({ action: "link", file: r.file });
            });
        }
    }

    onClose(): void { this.contentEl.empty(); }
}

// ─── Main Command ──────────────────────────────────────────────────────────────

export async function normalizeRecipeIngredients(app: App, settings: TrackerSettings): Promise<void> {
    const file = app.workspace.getActiveFile();
    if (!file) { new Notice("No active note."); return; }

    const content = await app.vault.read(file);
    const lines = content.split("\n");

    const range = findSectionRange(lines, "Ingredients");
    if (!range) { new Notice("No Ingredients section found."); return; }

    // ── Step 2: Classify and normalize quantities ─────────────────────────────

    const processedLines: ClassifiedLine[] = [];
    const toReview: ClassifiedLine[] = [];

    for (let i = range.start; i < range.end; i++) {
        const line = lines[i];
        const bulletM = line.match(/^(\s*[-*]\s+(?:\[[ xX]\]\s+)?)(.*)/);
        if (!bulletM) continue;

        const bulletPrefix  = bulletM[1];
        const originalContent = bulletM[2];
        const cls = classifyContent(originalContent);

        const cl: ClassifiedLine = {
            idx: i,
            bulletPrefix,
            originalContent,
            type: cls.type,
            qtyPrefix: cls.qtyPrefix,
            foodDesc: cls.foodDesc,
            currentContent: cls.type === "e" ? originalContent : cls.qtyPrefix + cls.foodDesc,
            isSeasoning: false,
            linked: false,
            leftUnlinked: false,
        };

        processedLines.push(cl);
        if (cls.type === "e") toReview.push(cl);
    }

    // ── Step 3: Resolve ambiguous quantities ──────────────────────────────────

    for (let i = 0; i < toReview.length; i++) {
        const item = toReview[i];
        const result = await new Promise<string | null>((res) => {
            new IngredientReviewModal(app, item.originalContent, i + 1, toReview.length, res).open();
        });
        if (result === null) {
            new Notice("Normalize Recipe Ingredients cancelled.");
            return;
        }
        item.currentContent = result;
        const reparsed = extractFoodDescFromText(result);
        item.qtyPrefix = reparsed.qtyPrefix;
        item.foodDesc  = reparsed.foodDesc;
    }

    // ── Step 4: Seasoning classification ──────────────────────────────────────

    for (const cl of processedLines) {
        if (cl.type === "a") continue;
        cl.isSeasoning = isSeasoning(cl.foodDesc);
    }

    // ── Step 5: Core extraction and exact/fuzzy matching ──────────────────────

    const candidateFiles = getCandidateFiles(app, settings);
    const toLink: LinkQueueItem[] = [];
    const skipped: Skipped[] = [];

    for (const cl of processedLines) {
        if (cl.type === "a" || cl.isSeasoning) continue;

        const { leading, core, trailing } = extractCore(cl.foodDesc);

        // Exact case-insensitive match (with naive singular/plural)
        const variants = naiveSingularPlural(core);
        const exactMatch = candidateFiles.find(
            c => variants.some(v => c.file.basename.toLowerCase() === v.toLowerCase())
        );

        if (exactMatch) {
            const link = buildLink(exactMatch.file.basename, core);
            cl.currentContent = cl.qtyPrefix + leading + link + trailing;
            cl.linked = true;
            continue;
        }

        // Fuzzy search
        const searcher = prepareFuzzySearch(core);
        const fuzzyResults = candidateFiles
            .map(c => ({ ...c, result: searcher(c.file.basename) }))
            .filter(c => c.result !== null && c.result.score > -1)
            .sort((a, b) => (b.result?.score ?? -Infinity) - (a.result?.score ?? -Infinity))
            .slice(0, 5);

        if (fuzzyResults.length > 0) {
            toLink.push({
                cl,
                leading,
                core,
                trailing,
                candidates: fuzzyResults.map(r => ({ file: r.file, isFood: r.isFood })),
            });
        } else {
            skipped.push({ name: core, reason: "no food note found, needs creation" });
        }
    }

    // ── Step 6: Resolve fuzzy-link candidates ─────────────────────────────────

    let leftUnlinkedCount = 0;

    for (let i = 0; i < toLink.length; i++) {
        const item = toLink[i];
        const result = await new Promise<LinkResult | null>((res) => {
            new IngredientLinkModal(
                app, item, i + 1, toLink.length, candidateFiles, res
            ).open();
        });
        if (result === null) {
            new Notice("Normalize Recipe Ingredients cancelled.");
            return;
        }
        if (result.action === "link" && result.file) {
            const link = buildLink(result.file.basename, item.core);
            item.cl.currentContent = item.cl.qtyPrefix + item.leading + link + item.trailing;
            item.cl.linked = true;
        } else if (result.action === "create") {
            skipped.push({
                name: result.name ?? item.core,
                reason: "no food note found, needs creation",
            });
        } else {
            leftUnlinkedCount++;
        }
    }

    // ── Step 7: Write ─────────────────────────────────────────────────────────

    const contentLines = content.split("\n");
    for (const cl of processedLines) {
        if (cl.type === "a") continue;
        contentLines[cl.idx] = cl.bulletPrefix + cl.currentContent;
    }
    let newContent = contentLines.join("\n");

    if (skipped.length > 0) {
        newContent = applyNotesSection(newContent, skipped);
    }

    await app.vault.modify(file, newContent);

    const normalizedCount = processedLines.filter(
        cl => cl.type !== "a" && cl.type !== "b" && cl.type !== "e" && cl.currentContent !== cl.originalContent
    ).length;
    const linkedCount = processedLines.filter(cl => cl.linked).length;
    const flaggedCount = skipped.length;

    new Notice(
        `Normalized ${normalizedCount} lines, linked ${linkedCount}, ${flaggedCount} flagged for new food notes, ${leftUnlinkedCount} left unlinked.`
    );
}
