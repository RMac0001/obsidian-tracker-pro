import { App, Modal, Notice } from "obsidian";

// ─── Unit Conversion Tables ───────────────────────────────────────────────────

const VOL_TO_ML: Record<string, number> = {
    tsp: 4.92892,   tsps: 4.92892,   teaspoon: 4.92892,   teaspoons: 4.92892,
    tbsp: 14.7868,  tbsps: 14.7868,  tablespoon: 14.7868, tablespoons: 14.7868,
    "fl oz": 29.5735,
    cup: 236.588,   cups: 236.588,
    pint: 473.176,  pints: 473.176,
    quart: 946.353, quarts: 946.353,
    l: 1000,
    ml: 1,
};

const WT_TO_G: Record<string, number> = {
    g: 1,
    kg: 1000,
    oz: 28.3495,
    lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
};

function nu(u: string): string { return u.toLowerCase().trim(); }

function singularize(u: string): string {
    if (u.endsWith("ves"))  return u.slice(0, -3) + "f";
    if (u.endsWith("ies"))  return u.slice(0, -3) + "y";
    if (u.endsWith("ses") || u.endsWith("xes") || u.endsWith("zes") ||
        u.endsWith("shes") || u.endsWith("ches")) return u.slice(0, -2);
    if (u.endsWith("s") && u.length > 2) return u.slice(0, -1);
    return u;
}

function classifyUnit(u: string): "volume" | "weight" | "named" {
    const n = nu(u);
    if (n in VOL_TO_ML) return "volume";
    if (n in WT_TO_G) return "weight";
    return "named";
}

function inMl(amount: number, unit: string): number | null {
    const f = VOL_TO_ML[nu(unit)];
    return f !== undefined ? amount * f : null;
}

function inG(amount: number, unit: string): number | null {
    const f = WT_TO_G[nu(unit)];
    return f !== undefined ? amount * f : null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Ingredient {
    amount: number;
    unit: string;
    linkText: string;
}

interface Nutrition {
    calories: number;
    carbs: number;
    fat: number;
    protein: number;
}

interface Skipped {
    name: string;
    reason: string;
}

// ─── Ingredient Parsing ───────────────────────────────────────────────────────

function parseAmount(s: string): number {
    if (s.includes("/")) {
        const [n, d] = s.split("/");
        return parseFloat(n) / parseFloat(d);
    }
    return parseFloat(s);
}

function extractSection(content: string, header: string): string | null {
    const lines = content.split("\n");
    const headerRe = new RegExp(`^#{1,6}\\s+${header}\\s*$`, "i");
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (headerRe.test(lines[i])) { start = i + 1; break; }
    }
    if (start === -1) return null;
    const out: string[] = [];
    for (let i = start; i < lines.length; i++) {
        if (/^#{1,6}\s/.test(lines[i])) break;
        out.push(lines[i]);
    }
    return out.join("\n");
}

function parseIngredientLine(line: string): Ingredient | null {
    if (!/^\s*-\s*\[[ xX]\]/.test(line)) return null;

    const linkMatch = line.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
    if (!linkMatch) return null;
    const linkText = linkMatch[1].trim();

    const stripped = line.replace(/^\s*-\s*\[[ xX]\]\s*/, "").trim();

    let amount = 0;
    let unit = "";

    // "fl oz" is a two-word unit — check before single-word fallback
    const flOzM = stripped.match(/^(\d+(?:[\/\.]\d+)?)\s+fl\s+oz\b/i);
    if (flOzM) {
        amount = parseAmount(flOzM[1]);
        unit = "fl oz";
    } else {
        const m = stripped.match(/^(\d+(?:[\/\.]\d+)?)\s+(\w+)?/);
        if (!m) return null;
        amount = parseAmount(m[1]);
        const raw = m[2] ?? "";
        unit = raw.startsWith("[") ? "" : raw;
    }

    return { amount, unit, linkText };
}

// ─── Ratio Calculation ────────────────────────────────────────────────────────

function calcRatio(
    amount: number,
    unit: string,
    fm: Record<string, unknown>,
    isRecipe: boolean
): number | string {
    if (isRecipe && (!fm.serving_size || !fm.serving_unit)) {
        return "recipe note missing serving fields";
    }

    const servingSize = Number(fm.serving_size) || 1;
    const servingUnit = String(fm.serving_unit ?? "").trim();
    const ingN = nu(unit);
    const srvN = nu(servingUnit);

    // Case 1: common_serving_unit match (food notes only)
    if (!isRecipe && fm.common_serving_unit) {
        const comN  = singularize(nu(String(fm.common_serving_unit)));
        const comSz = Number(fm.common_serving_size) || 1;
        if (singularize(ingN) === comN) return amount / comSz;
    }

    // Case 2: direct serving_unit match
    if (ingN === srvN) return amount / servingSize;

    // Case 3: same-dimension unit conversion
    const ingType = classifyUnit(ingN);
    const srvType = classifyUnit(srvN);

    if (ingType === "volume" && srvType === "volume") {
        const iMl = inMl(amount, ingN);
        const sMl = inMl(servingSize, srvN);
        if (iMl !== null && sMl !== null && sMl > 0) return iMl / sMl;
    }
    if (ingType === "weight" && srvType === "weight") {
        const iG = inG(amount, ingN);
        const sG = inG(servingSize, srvN);
        if (iG !== null && sG !== null && sG > 0) return iG / sG;
    }

    // Case 4: incompatible dimensions
    if (ingType !== "named" && srvType !== "named" && ingType !== srvType) {
        return "unit mismatch (volume vs weight)";
    }

    if (!unit) return "unit not convertible (no unit specified)";
    return `unit not convertible (used "${unit}", food note uses "${servingUnit || "unknown"}")`;
}

// ─── Notes Section Write-Back ─────────────────────────────────────────────────

function applyNotesSection(content: string, skipped: Skipped[]): string {
    const bulletLines = skipped.map(s => `- ${s.name} — ${s.reason}`);
    const newSection =
        "## Notes\n" +
        "**Skipped ingredients (not included in nutrition calculation):**\n" +
        bulletLines.join("\n") + "\n";

    const fileLines = content.split("\n");
    let start = -1;
    let end = fileLines.length;

    for (let i = 0; i < fileLines.length; i++) {
        if (/^## Notes\s*$/.test(fileLines[i])) {
            start = i;
        } else if (start !== -1 && i > start && /^## /.test(fileLines[i])) {
            end = i;
            break;
        }
    }

    if (start !== -1) {
        const before = fileLines.slice(0, start).join("\n");
        const after = end < fileLines.length ? "\n" + fileLines.slice(end).join("\n") : "";
        return before + "\n" + newSection + after;
    }
    return content.trimEnd() + "\n\n" + newSection;
}

// ─── Servings Modal ───────────────────────────────────────────────────────────

class ServingsModal extends Modal {
    private totals: Nutrition;
    private initial: number;
    private onConfirm: (servings: number) => void;

    constructor(app: App, totals: Nutrition, initial: number, onConfirm: (s: number) => void) {
        super(app);
        this.totals = totals;
        this.initial = initial;
        this.onConfirm = onConfirm;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: "Recipe Nutrition" });

        let servings = this.initial;

        const row = contentEl.createDiv({ cls: "tracker-pro-recipe-row" });
        row.createEl("label", { text: "Servings:", cls: "tracker-pro-recipe-label" });
        const input = row.createEl("input") as HTMLInputElement;
        input.type = "number";
        input.min = "1";
        input.value = String(servings);
        input.addClass("tracker-pro-recipe-input");

        const calRow = contentEl.createDiv({ cls: "tracker-pro-recipe-cal-row" });
        const calDisplay = calRow.createEl("span", { cls: "tracker-pro-recipe-cal" });
        calRow.createEl("span", { text: " · Max 350 cal/serving", cls: "tracker-pro-recipe-hint" });

        const update = (s: number) => {
            calDisplay.setText(`${Math.round(this.totals.calories / s)} cal/serving`);
        };
        update(servings);

        input.addEventListener("input", () => {
            const v = parseInt(input.value);
            if (v >= 1) { servings = v; update(v); }
        });

        const btnRow = contentEl.createDiv({ cls: "tracker-pro-recipe-btns" });
        const confirmBtn = btnRow.createEl("button", { text: "Confirm", cls: "mod-cta" });
        confirmBtn.addEventListener("click", () => {
            const v = Math.max(1, parseInt(input.value) || 1);
            this.close();
            this.onConfirm(v);
        });
        btnRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    }

    onClose(): void { this.contentEl.empty(); }
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function calculateRecipeNutrition(app: App): Promise<void> {
    const file = app.workspace.getActiveFile();
    if (!file) { new Notice("No active note."); return; }

    const content = await app.vault.read(file);
    const section = extractSection(content, "Ingredients");
    if (!section) { new Notice("No Ingredients section found."); return; }

    const totals: Nutrition = { calories: 0, carbs: 0, fat: 0, protein: 0 };
    const skipped: Skipped[] = [];
    let resolved = 0;

    // Build ingredient list; record every checklist line that can't be resolved
    // as a skipped item so it appears in the Notes section.
    const parsed: Ingredient[] = [];
    for (const line of section.split("\n")) {
        if (!/^\s*-\s*\[[ xX]\]/.test(line)) continue; // non-checklist — ignore silently
        const linkMatch = line.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
        if (!linkMatch) {
            const text = line.replace(/^\s*-\s*\[[ xX]\]\s*/, "").trim();
            skipped.push({ name: text || "(unrecognized line)", reason: "no wiki-link" });
            continue;
        }
        const ing = parseIngredientLine(line);
        if (ing) {
            parsed.push(ing);
        } else {
            skipped.push({ name: linkMatch[1].trim(), reason: "could not parse ingredient line" });
        }
    }

    for (const ing of parsed) {
        const linked = app.metadataCache.getFirstLinkpathDest(ing.linkText, file.path);
        if (!linked) {
            skipped.push({ name: ing.linkText, reason: "no food note found" });
            continue;
        }

        const fm = (app.metadataCache.getFileCache(linked)?.frontmatter ?? {}) as Record<string, unknown>;
        const isRecipe = linked.basename.startsWith("Recipe -");

        const ratio = calcRatio(ing.amount, ing.unit, fm, isRecipe);
        if (typeof ratio === "string") {
            skipped.push({ name: ing.linkText, reason: ratio });
            continue;
        }

        totals.calories += (Number(fm.calories) || 0) * ratio;
        totals.carbs    += (Number(fm.carbs)    || 0) * ratio;
        totals.fat      += (Number(fm.fat)      || 0) * ratio;
        totals.protein  += (Number(fm.protein)  || 0) * ratio;
        resolved++;
    }

    // Write skipped items when resolved === 0 (no modal — nothing to confirm/cancel)
    if (resolved === 0) {
        if (skipped.length > 0) {
            await app.vault.modify(file, applyNotesSection(content, skipped));
        }
        new Notice("No matching food notes found. Skipped ingredients written to Notes section.");
        return;
    }

    const suggested = Math.max(1, Math.ceil(totals.calories / 350));

    new ServingsModal(app, totals, suggested, async (servings) => {
        // Write Notes first using original content (before processFrontMatter runs),
        // so the Ingredients section is preserved byte-for-byte.
        if (skipped.length > 0) {
            await app.vault.modify(file, applyNotesSection(content, skipped));
        }

        await app.fileManager.processFrontMatter(file, (fm) => {
            fm.calories = Math.round(totals.calories / servings);
            fm.carbs    = Math.round(totals.carbs    / servings);
            fm.fat      = Math.round(totals.fat      / servings);
            fm.protein  = Math.round(totals.protein  / servings);
            fm.servings = servings;
        });

        new Notice("Recipe nutrition calculated.");
    }).open();
}
