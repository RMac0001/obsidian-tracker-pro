import {
    App,
    FuzzySuggestModal,
    Modal,
    Notice,
    TFile,
    normalizePath,
} from "obsidian";
import { TrackerSettings } from "./settings";

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
}

interface MealEntry {
    name: string;
    displayAmount: string;   // "6 oz" | "1.5 servings"
    multiplier: number;      // factor applied to per-serving nutrition
    nutrition: NutritionValues; // already multiplied
}

type MealType = "Breakfast" | "Lunch" | "Dinner" | "Snacks";
type MealKey  = "breakfast" | "lunch" | "dinner" | "snacks";

const MEAL_TYPES: MealType[] = ["Breakfast", "Lunch", "Dinner", "Snacks"];
const MACROS = ["cal", "protein", "fat", "carbs"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveDateTemplate(template: string): string {
    return template.replace(/\{\{DATE:([^}]+)\}\}/g, (_, fmt) =>
        (window as any).moment().format(fmt)
    );
}

function mealKey(mealType: MealType): MealKey {
    return mealType.toLowerCase() as MealKey;
}

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

function getFoodMeta(app: App, file: TFile): FoodMeta {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    return {
        servingSize: Number(fm.serving_size ?? 1),
        servingUnit: String(fm.serving_unit ?? "serving"),
        nutrition: {
            calories: Number(fm.calories ?? 0),
            protein:  Number(fm.protein  ?? 0),
            fat:      Number(fm.fat      ?? 0),
            carbs:    Number(fm.carbs    ?? 0),
        },
    };
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

/**
 * Unified amount modal.
 *
 * Foods:   asks "How many oz?" (or whatever serving_unit is)
 *          multiplier = amount / serving_size
 *          default = serving_size (i.e. one serving pre-filled)
 *
 * Recipes: asks "How many servings?"
 *          multiplier = amount
 *          default = 1
 */
class AmountModal extends Modal {
    private input!: HTMLInputElement;

    constructor(
        app: App,
        private itemName: string,
        private meta: FoodMeta,
        private isFood: boolean,
        private onSubmit: (multiplier: number, displayAmount: string) => void
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;

        contentEl.createEl("h3", { text: this.itemName });

        // Context hint
        const hint = this.isFood
            ? `1 serving = ${this.meta.servingSize} ${this.meta.servingUnit}  ·  ${this.meta.nutrition.calories} cal per serving`
            : `${this.meta.nutrition.calories} cal per serving`;

        contentEl.createEl("p", {
            text: hint,
            attr: { style: "margin:4px 0 12px;color:var(--text-muted);font-size:0.85em;" },
        });

        // Label
        const labelText = this.isFood
            ? `Amount (${this.meta.servingUnit})`
            : "Servings";

        contentEl.createEl("label", {
            text: labelText,
            attr: { style: "font-size:0.9em;color:var(--text-muted);" },
        });

        this.input = contentEl.createEl("input", {
            attr: {
                type: "number",
                min: "0.01",
                step: this.isFood ? "0.5" : "0.25",
                style:
                    "display:block;width:100%;padding:8px 10px;font-size:1.1em;" +
                    "border:1px solid var(--background-modifier-border);" +
                    "border-radius:6px;background:var(--background-primary);" +
                    "color:var(--text-normal);margin:6px 0 12px;",
            },
        });

        // Pre-fill: one serving worth of the unit for foods, 1 for recipes
        this.input.value = this.isFood ? String(this.meta.servingSize) : "1";
        this.input.focus();
        this.input.select();

        const btn = contentEl.createEl("button", {
            text: "Add to meal",
            attr: { style: "width:100%;padding:8px;cursor:pointer;" },
        });
        btn.onclick = () => this.submit();
        this.input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this.submit();
        });
    }

    private submit(): void {
        const val = parseFloat(this.input.value);
        if (isNaN(val) || val <= 0) {
            new Notice("Please enter a valid amount.");
            return;
        }
        this.close();

        if (this.isFood) {
            const multiplier    = val / this.meta.servingSize;
            const unit          = this.meta.servingUnit;
            const displayAmount = `${val} ${unit}`;
            this.onSubmit(multiplier, displayAmount);
        } else {
            const multiplier    = val;
            const displayAmount = `${val} ${val === 1 ? "serving" : "servings"}`;
            this.onSubmit(multiplier, displayAmount);
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

    // Accumulate into this meal (safe to call twice for the same meal type)
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
                `- ${e.name} (${e.displayAmount}) — ` +
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

        new StringSuggestModal(
            app,
            [
                "Search food database",
                "Search recipes",
                `Done — save ${mealType}${totalLabel}`,
            ],
            "Add another item or finish...",
            (choice) => {
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
