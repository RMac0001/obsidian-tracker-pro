import {
    App,
    FuzzySuggestModal,
    Modal,
    Notice,
    TFile,
    normalizePath,
} from "obsidian";
import { TrackerSettings } from "./settings";
import { resolveDateTemplate } from "./utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NutritionValues {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
}

interface FoodMeta {
    servingSize: number;  // e.g. 4  (in serving_unit)
    servingUnit: string;  // e.g. "oz"
    nutrition: NutritionValues; // per one serving_size amount
    commonServingSize?: number; // e.g. 1
    commonServingUnit?: string; // e.g. "egg"
}

interface MealEntry {
    name: string;
    displayAmount: string;   // "6 oz" | "1.5 servings"
    multiplier: number;      // factor applied to per-serving nutrition
    nutrition: NutritionValues; // already multiplied
}

interface ParsedEntry {
    name: string;           // e.g. "Peanut Butter"
    displayAmount: string;  // e.g. "2 oz" or "1.5 servings"
    rawLine: string;        // full original log line
}

type MealType = "Breakfast" | "Lunch" | "Dinner" | "Snacks";
type MealKey  = "breakfast" | "lunch" | "dinner" | "snacks";

const MEAL_TYPES: MealType[] = ["Breakfast", "Lunch", "Dinner", "Snacks"];
const MACROS = ["cal", "protein", "fat", "carbs"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mealKey(mealType: MealType): MealKey {
    return mealType.toLowerCase() as MealKey;
}

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

const UNIT_CANONICAL: Record<string, string> = {
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
};

function normalizeUnit(unit: string): string {
    const key = unit.toLowerCase().trim();
    return UNIT_CANONICAL[key] ?? key;
}

function fmt2(n: number): string {
    return parseFloat(n.toFixed(2)).toString();
}

function getFoodMeta(app: App, file: TFile): FoodMeta {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const meta: FoodMeta = {
        servingSize: Number(fm.serving_size ?? 1),
        servingUnit: String(fm.serving_unit ?? "serving"),
        nutrition: {
            calories: Number(fm.calories ?? 0),
            protein:  Number(fm.protein  ?? 0),
            fat:      Number(fm.fat      ?? 0),
            carbs:    Number(fm.carbs    ?? 0),
        },
    };
    if (fm.common_serving_size !== undefined && fm.common_serving_unit !== undefined) {
        meta.commonServingSize = Number(fm.common_serving_size);
        meta.commonServingUnit = String(fm.common_serving_unit);
    }
    return meta;
}

function getRecipeMeta(app: App, file: TFile): FoodMeta {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    return {
        servingSize: 1,
        servingUnit: "serving",
        nutrition: {
            calories: Number(fm.calories ?? 0),
            protein:  Number(fm.protein  ?? 0),
            fat:      Number(fm.fat      ?? 0),
            carbs:    Number(fm.carbs    ?? 0),
        },
    };
}

function sumNutrition(entries: MealEntry[]): NutritionValues {
    return entries.reduce(
        (acc, e) => ({
            calories: acc.calories + e.nutrition.calories,
            protein:  acc.protein  + e.nutrition.protein,
            fat:      acc.fat      + e.nutrition.fat,
            carbs:    acc.carbs    + e.nutrition.carbs,
        }),
        { calories: 0, protein: 0, fat: 0, carbs: 0 }
    );
}

// ─── Modals ───────────────────────────────────────────────────────────────────

class StringSuggestModal extends FuzzySuggestModal<string> {
    constructor(
        app: App,
        private options: string[],
        placeholder: string,
        private onChoose: (val: string) => void
    ) {
        super(app);
        this.setPlaceholder(placeholder);
    }
    getItems(): string[] { return this.options; }
    getItemText(item: string): string { return item; }
    onChooseItem(item: string): void { this.onChoose(item); }
}

class FileSuggestModal extends FuzzySuggestModal<TFile> {
    constructor(
        app: App,
        private files: TFile[],
        placeholder: string,
        private onChoose: (file: TFile) => void
    ) {
        super(app);
        this.setPlaceholder(placeholder);
    }
    getItems(): TFile[] { return this.files; }
    getItemText(file: TFile): string { return file.basename; }
    onChooseItem(file: TFile): void { this.onChoose(file); }
}

class AmountModal extends Modal {
    private input!: HTMLInputElement;

    constructor(
        app: App,
        private itemName: string,
        private meta: FoodMeta,
        private isFood: boolean,
        private onSubmit: (multiplier: number, displayAmount: string) => void,
        private defaultValue?: number,
        private defaultUnit?: string,
        private buttonLabel = "Add to meal"
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: this.itemName });

        const hasCommon = !!(this.meta.commonServingSize && this.meta.commonServingUnit);

        if (this.isFood && hasCommon) {
            const cSize          = this.meta.commonServingSize!;
            const cUnit          = this.meta.commonServingUnit!;
            const calPerMeasured = this.meta.nutrition.calories;
            const calPerCommon   = round1((1 / cSize) * calPerMeasured);

            contentEl.createEl("p", {
                text: `Measured serving: ${this.meta.servingSize} ${this.meta.servingUnit} — ${calPerMeasured} cal per serving`,
                attr: { style: "margin:4px 0 2px;color:var(--text-muted);font-size:0.85em;" },
            });
            contentEl.createEl("p", {
                text: `Common serving: ${cSize} ${cUnit} — ${calPerCommon} cal per serving`,
                attr: { style: "margin:2px 0 12px;color:var(--text-muted);font-size:0.85em;" },
            });

            contentEl.createEl("label", {
                text: "Amount",
                attr: { style: "font-size:0.9em;color:var(--text-muted);" },
            });

            const inputRow = contentEl.createEl("div", {
                cls: "tracker-pro-amount-input-row",
                attr: { style: "display:flex;gap:8px;margin:6px 0 8px;" },
            });

            this.input = inputRow.createEl("input", {
                attr: {
                    type: "number",
                    min: "0.01",
                    step: "0.5",
                    style:
                        "flex:1;padding:8px 10px;font-size:1.1em;" +
                        "border:1px solid var(--background-modifier-border);" +
                        "border-radius:6px;background:var(--background-primary);" +
                        "color:var(--text-normal);",
                },
            });

            const unitSelect = inputRow.createEl("select", {
                attr: {
                    style:
                        "padding:0 10px;font-size:1.0em;" +
                        "border:1px solid var(--background-modifier-border);" +
                        "border-radius:6px;background:var(--background-primary);" +
                        "color:var(--text-normal);cursor:pointer;",
                },
            });
            const optCommon   = unitSelect.createEl("option", { text: cUnit });
            optCommon.value   = "common";
            const optMeasured = unitSelect.createEl("option", { text: this.meta.servingUnit });
            optMeasured.value = "measured";

            // Determine default selected unit — prefer common unless defaultUnit matches servingUnit
            let useServingUnit = false;
            if (this.defaultUnit) {
                const du = this.defaultUnit.toLowerCase();
                const su = this.meta.servingUnit.toLowerCase();
                useServingUnit = normalizeUnit(du) === normalizeUnit(this.meta.servingUnit);
            }
            unitSelect.value = useServingUnit ? "measured" : "common";

            this.input.value = this.defaultValue !== undefined ? String(this.defaultValue) : String(cSize);
            this.input.focus();
            this.input.select();

            const totalLine = contentEl.createEl("p", {
                attr: { style: "margin:0 0 12px;font-size:0.9em;color:var(--text-muted);" },
            });

            const btn = contentEl.createEl("button", {
                text: this.buttonLabel,
                attr: { style: "width:100%;padding:8px;cursor:pointer;" },
            });

            const updateTotal = () => {
                const amt = parseFloat(this.input.value);
                if (isNaN(amt) || amt <= 0) {
                    totalLine.textContent = "Total: —";
                    btn.disabled = true;
                    return;
                }
                btn.disabled = false;
                const isCommon = unitSelect.value === "common";
                const totalCal = isCommon
                    ? round1((amt / cSize) * calPerMeasured)
                    : round1((amt / this.meta.servingSize) * calPerMeasured);
                totalLine.textContent = `Total: ${totalCal} cal`;
            };

            updateTotal();
            this.input.addEventListener("input", updateTotal);
            let prevUnit = unitSelect.value;
            unitSelect.addEventListener("change", () => {
                const currentAmt = parseFloat(this.input.value);
                const newUnit    = unitSelect.value;
                if (!isNaN(currentAmt) && currentAmt > 0) {
                    if (prevUnit === "common" && newUnit === "measured") {
                        this.input.value = fmt2((currentAmt / cSize) * this.meta.servingSize);
                    } else if (prevUnit === "measured" && newUnit === "common") {
                        this.input.value = fmt2((currentAmt / this.meta.servingSize) * cSize);
                    }
                }
                prevUnit = newUnit;
                updateTotal();
            });

            btn.onclick = () => {
                const amt = parseFloat(this.input.value);
                if (isNaN(amt) || amt <= 0) { new Notice("Please enter a valid amount."); return; }
                this.close();
                const isCommon = unitSelect.value === "common";
                if (isCommon) {
                    const multiplier    = amt / cSize;
                    const measuredAmt   = fmt2((amt / cSize) * this.meta.servingSize);
                    const displayAmount = `${amt} ${cUnit} / ${measuredAmt} ${this.meta.servingUnit}`;
                    this.onSubmit(multiplier, displayAmount);
                } else {
                    const multiplier    = amt / this.meta.servingSize;
                    const commonAmt     = fmt2((amt / this.meta.servingSize) * cSize);
                    const displayAmount = `${amt} ${this.meta.servingUnit} / ${commonAmt} ${cUnit}`;
                    this.onSubmit(multiplier, displayAmount);
                }
            };
            this.input.addEventListener("keydown", (e) => { if (e.key === "Enter") btn.click(); });

        } else if (this.isFood) {
            contentEl.createEl("p", {
                text: `1 serving = ${this.meta.servingSize} ${this.meta.servingUnit}  ·  ${this.meta.nutrition.calories} cal per serving`,
                attr: { style: "margin:4px 0 12px;color:var(--text-muted);font-size:0.85em;" },
            });
            contentEl.createEl("label", {
                text: `Amount (${this.meta.servingUnit})`,
                attr: { style: "font-size:0.9em;color:var(--text-muted);" },
            });
            this.input = contentEl.createEl("input", {
                attr: {
                    type: "number", min: "0.01", step: "0.5",
                    style:
                        "display:block;width:100%;padding:8px 10px;font-size:1.1em;" +
                        "border:1px solid var(--background-modifier-border);" +
                        "border-radius:6px;background:var(--background-primary);" +
                        "color:var(--text-normal);margin:6px 0 12px;",
                },
            });
            this.input.value = this.defaultValue !== undefined ? String(this.defaultValue) : String(this.meta.servingSize);
            this.input.focus();
            this.input.select();
            const btn = contentEl.createEl("button", {
                text: this.buttonLabel,
                attr: { style: "width:100%;padding:8px;cursor:pointer;" },
            });
            btn.disabled = !(parseFloat(this.input.value) > 0);
            this.input.addEventListener("input", () => { btn.disabled = !(parseFloat(this.input.value) > 0); });
            btn.onclick = () => {
                const val = parseFloat(this.input.value);
                if (isNaN(val) || val <= 0) { new Notice("Please enter a valid amount."); return; }
                this.close();
                this.onSubmit(val / this.meta.servingSize, `${val} ${this.meta.servingUnit}`);
            };
            this.input.addEventListener("keydown", (e) => { if (e.key === "Enter") btn.click(); });

        } else {
            contentEl.createEl("p", {
                text: `${this.meta.nutrition.calories} cal per serving`,
                attr: { style: "margin:4px 0 12px;color:var(--text-muted);font-size:0.85em;" },
            });
            contentEl.createEl("label", {
                text: "Servings",
                attr: { style: "font-size:0.9em;color:var(--text-muted);" },
            });
            this.input = contentEl.createEl("input", {
                attr: {
                    type: "number", min: "0.01", step: "0.25",
                    style:
                        "display:block;width:100%;padding:8px 10px;font-size:1.1em;" +
                        "border:1px solid var(--background-modifier-border);" +
                        "border-radius:6px;background:var(--background-primary);" +
                        "color:var(--text-normal);margin:6px 0 12px;",
                },
            });
            this.input.value = this.defaultValue !== undefined ? String(this.defaultValue) : "1";
            this.input.focus();
            this.input.select();
            const btn = contentEl.createEl("button", {
                text: this.buttonLabel,
                attr: { style: "width:100%;padding:8px;cursor:pointer;" },
            });
            btn.disabled = !(parseFloat(this.input.value) > 0);
            this.input.addEventListener("input", () => { btn.disabled = !(parseFloat(this.input.value) > 0); });
            btn.onclick = () => {
                const val = parseFloat(this.input.value);
                if (isNaN(val) || val <= 0) { new Notice("Please enter a valid amount."); return; }
                this.close();
                this.onSubmit(val, `${val} ${val === 1 ? "serving" : "servings"}`);
            };
            this.input.addEventListener("keydown", (e) => { if (e.key === "Enter") btn.click(); });
        }
    }

    onClose(): void { this.contentEl.empty(); }
}

// ─── Frontmatter Builder ──────────────────────────────────────────────────────

function buildUpdatedFrontmatter(
    existing: Record<string, any>,
    mealType: MealType,
    entries: MealEntry[],
    settings: TrackerSettings
): Record<string, any> {
    const key           = mealKey(mealType);
    const mealNutrition = sumNutrition(entries);
    const fm: Record<string, any> = { ...existing };
    const dateKey       = settings.dateProperty || "creation_date";

    if (!fm[dateKey]) {
        fm[dateKey] = (window as any).moment().format("YYYY-MM-DD");
    }

    // Ensure all 20 nutrition fields exist
    for (const m of (["breakfast", "lunch", "dinner", "snacks"] as MealKey[])) {
        for (const macro of MACROS) {
            if (!(`${macro}_${m}` in fm)) fm[`${macro}_${m}`] = 0;
        }
    }
    for (const macro of MACROS) {
        if (!(`${macro}_total` in fm)) fm[`${macro}_total`] = 0;
    }

    // Accumulate into this meal
    fm[`cal_${key}`]     = round1((fm[`cal_${key}`]     || 0) + mealNutrition.calories);
    fm[`protein_${key}`] = round1((fm[`protein_${key}`] || 0) + mealNutrition.protein);
    fm[`fat_${key}`]     = round1((fm[`fat_${key}`]     || 0) + mealNutrition.fat);
    fm[`carbs_${key}`]   = round1((fm[`carbs_${key}`]   || 0) + mealNutrition.carbs);

    // Recalculate totals from all four meals
    const allKeys = ["breakfast", "lunch", "dinner", "snacks"] as MealKey[];
    fm.cal_total     = round1(allKeys.reduce((s, m) => s + (fm[`cal_${m}`]     || 0), 0));
    fm.protein_total = round1(allKeys.reduce((s, m) => s + (fm[`protein_${m}`] || 0), 0));
    fm.fat_total     = round1(allKeys.reduce((s, m) => s + (fm[`fat_${m}`]     || 0), 0));
    fm.carbs_total   = round1(allKeys.reduce((s, m) => s + (fm[`carbs_${m}`]   || 0), 0));

    return fm;
}

// ─── Note Content Helpers ─────────────────────────────────────────────────────

function buildEntryLines(entries: MealEntry[]): string {
    return entries
        .map(
            (e) =>
                `- [[${e.name}]] (${e.displayAmount}) — ` +
                `${round1(e.nutrition.calories)} cal | ` +
                `${round1(e.nutrition.protein)}g protein | ` +
                `${round1(e.nutrition.fat)}g fat | ` +
                `${round1(e.nutrition.carbs)}g carbs`
        )
        .join("\n");
}

function buildNewNoteContent(
    mealType: MealType,
    entries: MealEntry[],
    fm: Record<string, any>
): string {
    let content = "---\n";
    for (const [k, v] of Object.entries(fm)) {
        content += `${k}: ${v}\n`;
    }
    content += "---\n\n";

    for (const meal of MEAL_TYPES) {
        content += `## ${meal}\n`;
        if (meal === mealType) {
            content += buildEntryLines(entries) + "\n";
        }
        content += "\n";
    }
    return content;
}

// ─── Folder Creation ──────────────────────────────────────────────────────────

async function ensureFolders(app: App, filePath: string): Promise<void> {
    const parts = filePath.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!app.vault.getAbstractFileByPath(current)) {
            try { await app.vault.createFolder(current); } catch { /* already exists */ }
        }
    }
}

// ─── Today's Note Path ────────────────────────────────────────────────────────

function resolveTodayPath(settings: TrackerSettings): string {
    const folder   = resolveDateTemplate(settings.mealLogFolder);
    const filename = resolveDateTemplate(settings.mealLogFilename);
    return normalizePath(`${folder}/${filename}.md`);
}

// ─── Save Meal ────────────────────────────────────────────────────────────────

async function saveMeal(
    app: App,
    settings: TrackerSettings,
    mealType: MealType,
    entries: MealEntry[]
): Promise<void> {
    const filePath = resolveTodayPath(settings);
    const existing = app.vault.getAbstractFileByPath(filePath);

    if (existing instanceof TFile) {
        // Update frontmatter
        await (app as any).fileManager.processFrontMatter(
            existing,
            (fm: Record<string, any>) => {
                const updated = buildUpdatedFrontmatter(fm, mealType, entries, settings);
                for (const key of Object.keys(fm)) delete fm[key];
                Object.assign(fm, updated);
            }
        );

        // Append entry lines to the correct meal section
        const content    = await app.vault.read(existing);
        const entryLines = buildEntryLines(entries);
        const header     = `## ${mealType}`;
        const lines      = content.split("\n");
        const headerIdx  = lines.findIndex((l) => l.trim() === header);

        if (headerIdx !== -1) {
            let nextSection = lines.length;
            for (let i = headerIdx + 1; i < lines.length; i++) {
                if (lines[i].startsWith("## ")) { nextSection = i; break; }
            }
            let lastContent = headerIdx;
            for (let i = headerIdx + 1; i < nextSection; i++) {
                if (lines[i].trim() !== "") lastContent = i;
            }
            lines.splice(lastContent + 1, 0, ...entryLines.split("\n"));
            await app.vault.modify(existing, lines.join("\n"));
        } else {
            const appended = content.trimEnd() + `\n\n## ${mealType}\n${entryLines}\n`;
            await app.vault.modify(existing, appended);
        }

        new Notice(`✓ ${mealType} added to today's food log`);
    } else {
        // Create new note
        await ensureFolders(app, filePath);
        const fm      = buildUpdatedFrontmatter({}, mealType, entries, settings);
        const content = buildNewNoteContent(mealType, entries, fm);
        await app.vault.create(filePath, content);
        new Notice(`✓ Today's food log created with ${mealType}`);
    }
}

// ─── Shared Frontmatter Helpers ───────────────────────────────────────────────

function zeroMealInFrontmatter(
    fm: Record<string, any>,
    mealType: MealType
): void {
    const key = mealKey(mealType);
    fm[`cal_${key}`]     = 0;
    fm[`protein_${key}`] = 0;
    fm[`fat_${key}`]     = 0;
    fm[`carbs_${key}`]   = 0;
    recalcTotals(fm);
}

function subtractFromFrontmatter(
    fm: Record<string, any>,
    mealType: MealType,
    nutrition: NutritionValues
): void {
    const key = mealKey(mealType);
    fm[`cal_${key}`]     = round1((fm[`cal_${key}`]     || 0) - nutrition.calories);
    fm[`protein_${key}`] = round1((fm[`protein_${key}`] || 0) - nutrition.protein);
    fm[`fat_${key}`]     = round1((fm[`fat_${key}`]     || 0) - nutrition.fat);
    fm[`carbs_${key}`]   = round1((fm[`carbs_${key}`]   || 0) - nutrition.carbs);
    recalcTotals(fm);
}

function recalcTotals(fm: Record<string, any>): void {
    const allKeys = ["breakfast", "lunch", "dinner", "snacks"] as MealKey[];
    fm.cal_total     = round1(allKeys.reduce((s, m) => s + (fm[`cal_${m}`]     || 0), 0));
    fm.protein_total = round1(allKeys.reduce((s, m) => s + (fm[`protein_${m}`] || 0), 0));
    fm.fat_total     = round1(allKeys.reduce((s, m) => s + (fm[`fat_${m}`]     || 0), 0));
    fm.carbs_total   = round1(allKeys.reduce((s, m) => s + (fm[`carbs_${m}`]   || 0), 0));
}

function getMealSectionLines(
    lines: string[],
    mealType: MealType
): { headerIdx: number; nextSection: number; entryLines: string[] } {
    const header    = `## ${mealType}`;
    const headerIdx = lines.findIndex((l) => l.trim() === header);
    if (headerIdx === -1) return { headerIdx: -1, nextSection: -1, entryLines: [] };

    let nextSection = lines.length;
    for (let i = headerIdx + 1; i < lines.length; i++) {
        if (lines[i].startsWith("## ")) { nextSection = i; break; }
    }

    const entryLines = lines
        .slice(headerIdx + 1, nextSection)
        .filter((l) => l.trimStart().startsWith("- "));

    return { headerIdx, nextSection, entryLines };
}

// ─── Clear Meal ───────────────────────────────────────────────────────────────

export function clearMeal(app: App, settings: TrackerSettings): void {
    new StringSuggestModal(app, MEAL_TYPES, "Which meal to clear?", (mealTypeStr) => {
        const mealType = mealTypeStr as MealType;

        new StringSuggestModal(
            app,
            [`Yes — clear ${mealType}`, "Cancel"],
            `Clear all ${mealType} entries from today's log?`,
            async (choice) => {
                if (!choice.startsWith("Yes")) return;

                const filePath = resolveTodayPath(settings);
                const file     = app.vault.getAbstractFileByPath(filePath);
                if (!(file instanceof TFile)) {
                    new Notice("No food log found for today.");
                    return;
                }

                await (app as any).fileManager.processFrontMatter(
                    file,
                    (fm: Record<string, any>) => zeroMealInFrontmatter(fm, mealType)
                );

                const content              = await app.vault.read(file);
                const lines                = content.split("\n");
                const { headerIdx, nextSection } = getMealSectionLines(lines, mealType);

                if (headerIdx !== -1) {
                    const filtered = lines.filter(
                        (_, i) => !(i > headerIdx && i < nextSection && lines[i].trimStart().startsWith("- "))
                    );
                    await app.vault.modify(file, filtered.join("\n"));
                }

                new Notice(`✓ ${mealType} cleared from today's log`);
            }
        ).open();
    }).open();
}

// ─── Log Parsing ──────────────────────────────────────────────────────────────

function extractBody(content: string): string {
    const lines = content.split("\n");
    if (lines[0] !== "---") return content;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] === "---") return lines.slice(i + 1).join("\n");
    }
    return content;
}

function parseLogLine(line: string): ParsedEntry | null {
    const m = line.match(/^-\s+\[\[(.+?)\]\]\s+\((.+?)\)/);
    if (!m) return null;
    return { name: m[1], displayAmount: m[2], rawLine: line };
}

function parseMealSections(body: string): Map<MealType, ParsedEntry[]> {
    const meals = new Map<MealType, ParsedEntry[]>(
        MEAL_TYPES.map((mt) => [mt, []])
    );
    const lines = body.split("\n");
    let currentMeal: MealType | null = null;

    for (const line of lines) {
        const hm = line.match(/^##\s+(.+)/);
        if (hm) {
            const heading = hm[1].trim() as MealType;
            currentMeal = MEAL_TYPES.includes(heading) ? heading : null;
            continue;
        }
        if (currentMeal && line.trimStart().startsWith("- ")) {
            const parsed = parseLogLine(line);
            if (parsed) meals.get(currentMeal)!.push(parsed);
        }
    }
    return meals;
}

function parseNotesLines(body: string): string[] {
    const lines = body.split("\n");
    let inNotes = false;
    const notes: string[] = [];
    for (const line of lines) {
        if (line.trim() === "## Notes") { inNotes = true; continue; }
        if (inNotes) {
            if (line.startsWith("## ")) break;
            notes.push(line);
        }
    }
    while (notes.length && notes[notes.length - 1].trim() === "") notes.pop();
    return notes;
}

// ─── File Lookup ──────────────────────────────────────────────────────────────

function findItemFile(
    app: App,
    name: string,
    settings: TrackerSettings
): { file: TFile; isFood: boolean } | null {
    const allMd    = app.vault.getMarkdownFiles();
    const foodBase = settings.foodFolder.replace(/\/$/, "");
    const recBase  = settings.recipeFolder.replace(/\/$/, "");

    const foodFile = allMd.find(
        (f) => f.path.startsWith(foodBase + "/") && f.basename === name
    );
    if (foodFile) return { file: foodFile, isFood: true };

    const recFile = allMd.find(
        (f) => f.path.startsWith(recBase + "/") && f.basename === name
    );
    if (recFile) return { file: recFile, isFood: false };

    return null;
}

function multiplierFromDisplay(displayAmount: string, meta: FoodMeta, isFood: boolean): number {
    if (!isFood) {
        const num = parseFloat(displayAmount);
        return isNaN(num) ? 1 : num;
    }
    const firstPart = displayAmount.split("/")[0].trim();
    const m = firstPart.match(/^([\d.]+)\s+(.*)/);
    if (!m) {
        const num = parseFloat(displayAmount);
        return isNaN(num) ? 1 : num / meta.servingSize;
    }
    const amount  = parseFloat(m[1]);
    const unitRaw = m[2].trim().toLowerCase();
    if (meta.commonServingUnit && meta.commonServingSize) {
        if (normalizeUnit(unitRaw) === normalizeUnit(meta.commonServingUnit)) {
            return amount / meta.commonServingSize;
        }
    }
    return amount / meta.servingSize;
}

// ─── Recent Log Files ─────────────────────────────────────────────────────────

function getMealLogBaseFolder(settings: TrackerSettings): string {
    const template   = settings.mealLogFolder;
    const tokenCount = (template.match(/\{\{DATE:/g) ?? []).length;
    if (tokenCount === 0) return template.replace(/\/$/, "");
    const resolved   = resolveDateTemplate(template);
    const parts      = resolved.split("/");
    return parts.slice(0, Math.max(0, parts.length - tokenCount)).join("/");
}

function getRecentLogFiles(app: App, settings: TrackerSettings, limit: number): TFile[] {
    const base = getMealLogBaseFolder(settings);
    const files = app.vault.getMarkdownFiles();
    const filtered = base
        ? files.filter((f) => f.path.startsWith(base + "/"))
        : files;
    return filtered
        .sort((a, b) => b.stat.mtime - a.stat.mtime)
        .slice(0, limit);
}

// ─── Recalculate and Save ─────────────────────────────────────────────────────

async function recalcAndSave(
    app: App,
    settings: TrackerSettings,
    file: TFile,
    meals: Map<MealType, ParsedEntry[]>,
    notesLines: string[]
): Promise<void> {
    const allKeys = ["breakfast", "lunch", "dinner", "snacks"] as MealKey[];

    const mealTotals: Record<MealKey, NutritionValues> = {
        breakfast: { calories: 0, protein: 0, fat: 0, carbs: 0 },
        lunch:     { calories: 0, protein: 0, fat: 0, carbs: 0 },
        dinner:    { calories: 0, protein: 0, fat: 0, carbs: 0 },
        snacks:    { calories: 0, protein: 0, fat: 0, carbs: 0 },
    };

    const freshLines = new Map<MealType, string[]>();

    for (const mealType of MEAL_TYPES) {
        const key     = mealKey(mealType);
        const entries = meals.get(mealType) ?? [];
        const lines: string[] = [];

        for (const entry of entries) {
            const found = findItemFile(app, entry.name, settings);
            let nutrition: NutritionValues;

            if (found) {
                // Re-pull fresh from source note
                const meta       = found.isFood
                    ? getFoodMeta(app, found.file)
                    : getRecipeMeta(app, found.file);
                const multiplier = multiplierFromDisplay(entry.displayAmount, meta, found.isFood);
                nutrition = {
                    calories: meta.nutrition.calories * multiplier,
                    protein:  meta.nutrition.protein  * multiplier,
                    fat:      meta.nutrition.fat      * multiplier,
                    carbs:    meta.nutrition.carbs    * multiplier,
                };
            } else {
                // Source note not found — fall back to stored values in the log line
                const m = entry.rawLine.match(
                    /— ([\d.]+) cal \| ([\d.]+)g protein \| ([\d.]+)g fat \| ([\d.]+)g carbs/
                );
                nutrition = m
                    ? { calories: parseFloat(m[1]), protein: parseFloat(m[2]), fat: parseFloat(m[3]), carbs: parseFloat(m[4]) }
                    : { calories: 0, protein: 0, fat: 0, carbs: 0 };
            }

            mealTotals[key].calories += nutrition.calories;
            mealTotals[key].protein  += nutrition.protein;
            mealTotals[key].fat      += nutrition.fat;
            mealTotals[key].carbs    += nutrition.carbs;

            lines.push(
                `- [[${entry.name}]] (${entry.displayAmount}) — ` +
                `${round1(nutrition.calories)} cal | ` +
                `${round1(nutrition.protein)}g protein | ` +
                `${round1(nutrition.fat)}g fat | ` +
                `${round1(nutrition.carbs)}g carbs`
            );
        }
        freshLines.set(mealType, lines);
    }

    // Update frontmatter in-place
    await (app as any).fileManager.processFrontMatter(
        file,
        (fm: Record<string, any>) => {
            for (const m of allKeys) {
                fm[`cal_${m}`]     = round1(mealTotals[m].calories);
                fm[`protein_${m}`] = round1(mealTotals[m].protein);
                fm[`fat_${m}`]     = round1(mealTotals[m].fat);
                fm[`carbs_${m}`]   = round1(mealTotals[m].carbs);
            }
            fm.cal_total     = round1(allKeys.reduce((s, m) => s + mealTotals[m].calories, 0));
            fm.protein_total = round1(allKeys.reduce((s, m) => s + mealTotals[m].protein,  0));
            fm.fat_total     = round1(allKeys.reduce((s, m) => s + mealTotals[m].fat,      0));
            fm.carbs_total   = round1(allKeys.reduce((s, m) => s + mealTotals[m].carbs,    0));
        }
    );

    // Rebuild body (meal sections + Notes)
    const d       = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    let body = "";
    for (const mealType of MEAL_TYPES) {
        body += `## ${mealType}\n`;
        const lines = freshLines.get(mealType) ?? [];
        if (lines.length > 0) body += lines.join("\n") + "\n";
        body += "\n";
    }
    body += `## Notes\n`;
    if (notesLines.length > 0) body += notesLines.join("\n") + "\n";
    body += `- ${dateStr} — Log recalculated\n`;

    // Extract the frontmatter block (already updated by processFrontMatter) and rewrite body
    const updated = await app.vault.read(file);
    const fmLines = updated.split("\n");
    let fmEnd     = -1;
    if (fmLines[0] === "---") {
        for (let i = 1; i < fmLines.length; i++) {
            if (fmLines[i] === "---") { fmEnd = i; break; }
        }
    }
    const fmBlock = fmEnd !== -1 ? fmLines.slice(0, fmEnd + 1).join("\n") : "";
    await app.vault.modify(file, fmBlock + "\n\n" + body);
}

// ─── Edit Meal Log Modal ──────────────────────────────────────────────────────

class EditMealLogModal extends Modal {
    private meals: Map<MealType, ParsedEntry[]> = new Map(
        MEAL_TYPES.map((mt) => [mt, []])
    );
    private notesLines: string[] = [];

    constructor(
        app: App,
        private settings: TrackerSettings,
        private file: TFile
    ) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.setText("Loading…");
        this.loadFile().then(() => this.render());
    }

    private async loadFile(): Promise<void> {
        const content   = await this.app.vault.read(this.file);
        const body      = extractBody(content);
        this.meals      = parseMealSections(body);
        this.notesLines = parseNotesLines(body);
    }

    render(): void {
        const { contentEl } = this;
        contentEl.empty();

        // ── Header ────────────────────────────────────────────────────────────
        const header = contentEl.createEl("div", { cls: "tracker-pro-edit-header" });
        header.createEl("span", {
            text: this.file.basename,
            cls: "tracker-pro-edit-title",
        });
        const switchBtn = header.createEl("button", {
            text: "Switch date",
            cls: "tracker-pro-edit-switch",
        });
        switchBtn.onclick = () => this.switchDate();

        // ── Item summary ──────────────────────────────────────────────────────
        const summary = contentEl.createEl("div", { cls: "tracker-pro-edit-summary" });
        let hasItems = false;
        for (const mealType of MEAL_TYPES) {
            const count = (this.meals.get(mealType) ?? []).length;
            if (count === 0) continue;
            hasItems = true;
            summary.createEl("span", {
                text: `${mealType}: ${count} item${count !== 1 ? "s" : ""}`,
                cls: "tracker-pro-edit-summary-item",
            });
        }
        if (!hasItems) {
            summary.createEl("span", {
                text: "No items logged yet",
                attr: { style: "color:var(--text-muted);font-size:0.85em;" },
            });
        }

        // ── Actions ───────────────────────────────────────────────────────────
        contentEl.createEl("p", {
            text: "What would you like to do?",
            attr: { style: "margin:12px 0 8px;color:var(--text-muted);font-size:0.9em;" },
        });

        const actionList = contentEl.createEl("div", { cls: "tracker-pro-edit-actions" });

        const actions: { label: string; fn: () => void }[] = [
            { label: "Change quantity on an item", fn: () => this.changeQuantity() },
            { label: "Remove an item",             fn: () => this.removeItem() },
            { label: "Add an item to a meal",      fn: () => this.addItem() },
            { label: "Add a meal block",            fn: () => this.addMealBlock() },
        ];

        for (const action of actions) {
            const btn = actionList.createEl("button", {
                text: action.label,
                cls: "tracker-pro-edit-action-btn",
            });
            btn.onclick = () => action.fn();
        }

        // ── Save ──────────────────────────────────────────────────────────────
        const saveBtn = contentEl.createEl("button", {
            text: "Save and recalculate",
            cls: "tracker-pro-edit-save",
        });
        saveBtn.onclick = () => this.save();
    }

    private switchDate(): void {
        const files = getRecentLogFiles(this.app, this.settings, 30);
        if (files.length === 0) {
            new Notice("No log files found.");
            return;
        }
        new FileSuggestModal(
            this.app,
            files,
            "Select a log to edit…",
            async (f) => {
                this.file = f;
                await this.loadFile();
                this.render();
            }
        ).open();
    }

    private changeQuantity(): void {
        const mealsWithEntries = MEAL_TYPES.filter(
            (mt) => (this.meals.get(mt) ?? []).length > 0
        );
        if (mealsWithEntries.length === 0) {
            new Notice("No items to change.");
            return;
        }

        new StringSuggestModal(
            this.app,
            mealsWithEntries,
            "Which meal?",
            (mealTypeStr) => {
                const mealType = mealTypeStr as MealType;
                const entries  = this.meals.get(mealType) ?? [];
                const labels   = entries.map((e) => `${e.name} (${e.displayAmount})`);

                new StringSuggestModal(
                    this.app,
                    labels,
                    "Change quantity on which item?",
                    (label) => {
                        const idx   = labels.indexOf(label);
                        const entry = entries[idx];

                        const found = findItemFile(this.app, entry.name, this.settings);
                        if (!found) {
                            new Notice(`Cannot find source file for "${entry.name}".`);
                            this.render();
                            return;
                        }

                        const meta         = found.isFood
                            ? getFoodMeta(this.app, found.file)
                            : getRecipeMeta(this.app, found.file);
                        const firstPart    = entry.displayAmount.split("/")[0].trim();
                        const amtUnitMatch = firstPart.match(/^([\d.]+)\s+(.*)/);
                        const currentAmount = amtUnitMatch
                            ? parseFloat(amtUnitMatch[1])
                            : parseFloat(entry.displayAmount);
                        const currentUnit  = amtUnitMatch ? amtUnitMatch[2].trim() : undefined;

                        new AmountModal(
                            this.app,
                            entry.name,
                            meta,
                            found.isFood,
                            (_multiplier, displayAmount) => {
                                entry.displayAmount = displayAmount;
                                this.render();
                            },
                            isNaN(currentAmount) ? undefined : currentAmount,
                            currentUnit,
                            "Update"
                        ).open();
                    }
                ).open();
            }
        ).open();
    }

    private removeItem(): void {
        const mealsWithEntries = MEAL_TYPES.filter(
            (mt) => (this.meals.get(mt) ?? []).length > 0
        );
        if (mealsWithEntries.length === 0) {
            new Notice("No items to remove.");
            return;
        }

        new StringSuggestModal(
            this.app,
            mealsWithEntries,
            "Which meal?",
            (mealTypeStr) => {
                const mealType = mealTypeStr as MealType;
                const entries  = this.meals.get(mealType)!;
                const labels   = entries.map((e) => `${e.name} (${e.displayAmount})`);

                new StringSuggestModal(
                    this.app,
                    labels,
                    "Remove which item?",
                    (label) => {
                        const idx = labels.indexOf(label);
                        entries.splice(idx, 1);
                        this.render();
                    }
                ).open();
            }
        ).open();
    }

    private addItem(): void {
        new StringSuggestModal(
            this.app,
            MEAL_TYPES,
            "Add to which meal?",
            (mealTypeStr) => this.searchAndAdd(mealTypeStr as MealType)
        ).open();
    }

    private addMealBlock(): void {
        new StringSuggestModal(
            this.app,
            MEAL_TYPES,
            "Which meal type?",
            (mealTypeStr) => this.searchAndAdd(mealTypeStr as MealType)
        ).open();
    }

    private searchAndAdd(mealType: MealType): void {
        new StringSuggestModal(
            this.app,
            ["Search food database", "Search recipes"],
            "Food or recipe?",
            (choice) => {
                const isFood = choice === "Search food database";
                const folder = isFood ? this.settings.foodFolder : this.settings.recipeFolder;
                const label  = isFood ? "foods" : "recipes";
                const files  = this.app.vault
                    .getMarkdownFiles()
                    .filter((f) => f.path.startsWith(folder.replace(/\/$/, "") + "/"));

                if (files.length === 0) {
                    new Notice(`No files found in: ${folder}`);
                    return;
                }

                new FileSuggestModal(
                    this.app,
                    files,
                    `Search ${label}…`,
                    (file) => {
                        const meta = isFood
                            ? getFoodMeta(this.app, file)
                            : getRecipeMeta(this.app, file);

                        new AmountModal(
                            this.app,
                            file.basename,
                            meta,
                            isFood,
                            (multiplier, displayAmount) => {
                                const nutrition = {
                                    calories: meta.nutrition.calories * multiplier,
                                    protein:  meta.nutrition.protein  * multiplier,
                                    fat:      meta.nutrition.fat      * multiplier,
                                    carbs:    meta.nutrition.carbs    * multiplier,
                                };
                                const rawLine =
                                    `- [[${file.basename}]] (${displayAmount}) — ` +
                                    `${round1(nutrition.calories)} cal | ` +
                                    `${round1(nutrition.protein)}g protein | ` +
                                    `${round1(nutrition.fat)}g fat | ` +
                                    `${round1(nutrition.carbs)}g carbs`;

                                this.meals.get(mealType)!.push({
                                    name: file.basename,
                                    displayAmount,
                                    rawLine,
                                });
                                new Notice(`Added: ${file.basename}`);
                                this.render();
                            }
                        ).open();
                    }
                ).open();
            }
        ).open();
    }

    private save(): void {
        recalcAndSave(this.app, this.settings, this.file, this.meals, this.notesLines)
            .then(() => {
                new Notice(`✓ ${this.file.basename} saved and recalculated`);
                this.close();
            })
            .catch((e) => {
                new Notice(`Error saving: ${String(e)}`);
                console.error(e);
            });
    }

    onClose(): void { this.contentEl.empty(); }
}

// ─── Edit Meal Log ────────────────────────────────────────────────────────────

export function editMealLog(app: App, settings: TrackerSettings): void {
    const todayPath = resolveTodayPath(settings);
    const todayFile = app.vault.getAbstractFileByPath(todayPath);

    if (todayFile instanceof TFile) {
        new EditMealLogModal(app, settings, todayFile).open();
        return;
    }

    // No log for today — create a blank one then open the modal
    (async () => {
        await ensureFolders(app, todayPath);
        const fm      = buildUpdatedFrontmatter({}, "Breakfast", [], settings);
        // Zero out Breakfast too (buildUpdatedFrontmatter only zeroes the given meal)
        for (const meal of MEAL_TYPES) {
            const k = mealKey(meal);
            fm[`cal_${k}`] = 0; fm[`protein_${k}`] = 0;
            fm[`fat_${k}`] = 0; fm[`carbs_${k}`]   = 0;
        }
        const content = buildNewNoteContent("Breakfast", [], fm);
        const newFile = await app.vault.create(todayPath, content);
        new EditMealLogModal(app, settings, newFile).open();
    })();
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function logMeal(app: App, settings: TrackerSettings): Promise<void> {
    const entries: MealEntry[] = [];

    new StringSuggestModal(
        app,
        MEAL_TYPES,
        "Which meal are you logging?",
        (mealTypeStr) => promptForItem(mealTypeStr as MealType)
    ).open();

    function promptForItem(mealType: MealType): void {
        const runningTotal = sumNutrition(entries);
        const totalLabel   =
            entries.length > 0
                ? `  (${entries.length} item${entries.length > 1 ? "s" : ""} · ${round1(runningTotal.calories)} cal)`
                : "";

        const itemOptions = [
            "Search food database",
            "Search recipes",
        ];
        if (entries.length > 0) {
            itemOptions.push(`Remove last item (${entries[entries.length - 1].name})`);
        }
        itemOptions.push(`Done — save ${mealType}${totalLabel}`);

        new StringSuggestModal(
            app,
            itemOptions,
            "Add another item or finish...",
            (choice) => {
                if (choice.startsWith("Remove last item")) {
                    entries.pop();
                    promptForItem(mealType);
                    return;
                }

                if (choice.startsWith("Done")) {
                    if (entries.length === 0) {
                        new Notice("No items added — meal not saved.");
                        return;
                    }
                    saveMeal(app, settings, mealType, entries).catch((e) => {
                        new Notice(`Error saving meal: ${String(e)}`);
                        console.error(e);
                    });
                    return;
                }

                const isFood = choice === "Search food database";
                const folder = isFood ? settings.foodFolder : settings.recipeFolder;
                const label  = isFood ? "foods" : "recipes";
                const files  = app.vault
                    .getMarkdownFiles()
                    .filter((f) => f.path.startsWith(folder.replace(/\/$/, "") + "/"));

                if (files.length === 0) {
                    new Notice(`No files found in: ${folder}`);
                    promptForItem(mealType);
                    return;
                }

                new FileSuggestModal(app, files, `Search ${label}...`, (file) => {
                    const meta = isFood ? getFoodMeta(app, file) : getRecipeMeta(app, file);

                    new AmountModal(app, file.basename, meta, isFood, (multiplier, displayAmount) => {
                        entries.push({
                            name: file.basename,
                            displayAmount,
                            multiplier,
                            nutrition: {
                                calories: meta.nutrition.calories * multiplier,
                                protein:  meta.nutrition.protein  * multiplier,
                                fat:      meta.nutrition.fat      * multiplier,
                                carbs:    meta.nutrition.carbs    * multiplier,
                            },
                        });
                        new Notice(`Added: ${file.basename} — ${displayAmount}`);
                        promptForItem(mealType);
                    }).open();
                }).open();
            }
        ).open();
    }
}
