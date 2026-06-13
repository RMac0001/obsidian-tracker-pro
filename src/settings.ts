import { App, PluginSettingTab, Setting } from "obsidian";
import Tracker from "./main";

export interface TrackerSettings {
    // ── Achievements ──────────────────────────────────────────────────────────
    achievementsDailyNotesFolder: string;
    achievementsFoodLogFolder:    string;
    achievementsExerciseFolder:   string;
    achievementsWnFolder:         string;
    achievementsStartWeight:      number;
    achievementsGoalWeight:       number;
    achievementsCalorieGoal:      number;
    achievementsProteinPct:       number;
    achievementsFatPct:           number;
    achievementsCarbPct:          number;
    achievementsMacroTolerance:   number;

    // ── Bills ─────────────────────────────────────────────────────────────────
    billsMasterFolder:  string;
    billsPaymentFolder: string;

    // ── Meal Logger ───────────────────────────────────────────────────────────
    mealLogFolder: string;
    mealLogFilename: string;
    foodFolder: string;
    recipeFolder: string;

    // ── Reading Challenge ─────────────────────────────────────────────────────
    bookNotesFolder:  string;
    bookNotePrefix:   string;
    readingGoalFile:  string;

    // ── Vitamins ──────────────────────────────────────────────────────────────
    vitaminsFolder: string;
    vitaminPeriods: string[];

    // ── Tracker Pro General Settings ──────────────────────────────────────────
    folder: string;
    dateFormat: string;
    dateProperty: string;
}

export const DEFAULT_SETTINGS: TrackerSettings = {
    // ── Achievements ──────────────────────────────────────────────────────────
    achievementsDailyNotesFolder: "Data/Daily Notes",
    achievementsFoodLogFolder:    "Data/Food Logs",
    achievementsExerciseFolder:   "Data/Exercise Notes",
    achievementsWnFolder:         "Data/Weight Loss Notes",
    achievementsStartWeight:      366.2,
    achievementsGoalWeight:       180,
    achievementsCalorieGoal:      1750,
    achievementsProteinPct:       40,
    achievementsFatPct:           30,
    achievementsCarbPct:          30,
    achievementsMacroTolerance:   5,

    // ── Bills ─────────────────────────────────────────────────────────────────
    billsMasterFolder:  "Data/Bills",
    billsPaymentFolder: "Data/Bills/Payments/BP-{{DATE:YYYY}}/BP-{{DATE:YYYY-MM}}",

    // ── Meal Logger ───────────────────────────────────────────────────────────
    mealLogFolder:   "Food/Logs/{{DATE:YYYY}}/{{DATE:YYYY-MM}}",
    mealLogFilename: "{{DATE:YYYY-MM-DD}}",
    foodFolder:      "Food/Database",
    recipeFolder:    "Recipes",

    // ── Reading Challenge ─────────────────────────────────────────────────────
    bookNotesFolder: "Data/Book Reviews",
    bookNotePrefix:  "BR-",
    readingGoalFile: "Data/Reading Goals.md",

    // ── Vitamins ──────────────────────────────────────────────────────────────
    vitaminsFolder: "Data/Vitamins",
    vitaminPeriods: ["Morning", "Evening"],

    // ── Tracker Pro General Settings ──────────────────────────────────────────
    folder: "/",
    dateFormat: "YYYY-MM-DD",
    dateProperty: "",
};

export class TrackerSettingTab extends PluginSettingTab {
    plugin: Tracker;

    constructor(app: App, plugin: Tracker) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ── Settings section order ────────────────────────────────────────────
        // Sections are ordered alphabetically by heading name.
        // When adding a new settings section, insert it in alphabetical order here
        // and add a matching entry to the interface comment block in DEFAULT_SETTINGS.
        // Current order: Achievements · Bills · Meal Logger · Reading Challenge · Vitamins · Tracker Pro General Settings
        // ─────────────────────────────────────────────────────────────────────

        // ── Achievements ──────────────────────────────────────────────────────

        containerEl.createEl("h2", { text: "Achievements" });

        new Setting(containerEl)
            .setName("Daily notes folder")
            .setDesc("Folder containing daily notes with a `weight` frontmatter property.")
            .addText(text => text
                .setPlaceholder("Data/Daily Notes")
                .setValue(this.plugin.settings.achievementsDailyNotesFolder)
                .onChange(async value => {
                    this.plugin.settings.achievementsDailyNotesFolder = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Food log folder")
            .setDesc("Folder containing daily food log notes with `cal_total`, `carbs_total`, `fat_total`, `protein_total` frontmatter properties.")
            .addText(text => text
                .setPlaceholder("Data/Food Logs")
                .setValue(this.plugin.settings.achievementsFoodLogFolder)
                .onChange(async value => {
                    this.plugin.settings.achievementsFoodLogFolder = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Exercise notes folder")
            .setDesc("Folder containing exercise notes. Any note in this folder counts as an exercise day.")
            .addText(text => text
                .setPlaceholder("Data/Exercise Notes")
                .setValue(this.plugin.settings.achievementsExerciseFolder)
                .onChange(async value => {
                    this.plugin.settings.achievementsExerciseFolder = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Weight loss notes folder")
            .setDesc("Folder containing weight loss session notes with an optional `resistance_wins` frontmatter property (integer).")
            .addText(text => text
                .setPlaceholder("Data/Weight Loss Notes")
                .setValue(this.plugin.settings.achievementsWnFolder)
                .onChange(async value => {
                    this.plugin.settings.achievementsWnFolder = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Starting weight (lbs)")
            .setDesc("Your official starting weight. Used to calculate weight milestone badges.")
            .addText(text => text
                .setValue(String(this.plugin.settings.achievementsStartWeight))
                .onChange(async value => {
                    const n = parseFloat(value);
                    if (!isNaN(n)) { this.plugin.settings.achievementsStartWeight = n; await this.plugin.saveSettings(); }
                }));

        new Setting(containerEl)
            .setName("Goal weight (lbs)")
            .setDesc("Your target weight. Milestones are calculated between start and goal.")
            .addText(text => text
                .setValue(String(this.plugin.settings.achievementsGoalWeight))
                .onChange(async value => {
                    const n = parseFloat(value);
                    if (!isNaN(n)) { this.plugin.settings.achievementsGoalWeight = n; await this.plugin.saveSettings(); }
                }));

        new Setting(containerEl)
            .setName("Calorie goal (kcal)")
            .setDesc("Days at or below this value count toward calorie badge progress.")
            .addText(text => text
                .setValue(String(this.plugin.settings.achievementsCalorieGoal))
                .onChange(async value => {
                    const n = parseFloat(value);
                    if (!isNaN(n)) { this.plugin.settings.achievementsCalorieGoal = n; await this.plugin.saveSettings(); }
                }));

        new Setting(containerEl)
            .setName("Protein target (%)")
            .setDesc("Target percentage of calories from protein.")
            .addText(text => text
                .setValue(String(this.plugin.settings.achievementsProteinPct))
                .onChange(async value => {
                    const n = parseFloat(value);
                    if (!isNaN(n)) { this.plugin.settings.achievementsProteinPct = n; await this.plugin.saveSettings(); }
                }));

        new Setting(containerEl)
            .setName("Fat target (%)")
            .setDesc("Target percentage of calories from fat.")
            .addText(text => text
                .setValue(String(this.plugin.settings.achievementsFatPct))
                .onChange(async value => {
                    const n = parseFloat(value);
                    if (!isNaN(n)) { this.plugin.settings.achievementsFatPct = n; await this.plugin.saveSettings(); }
                }));

        new Setting(containerEl)
            .setName("Carb target (%)")
            .setDesc("Target percentage of calories from carbohydrates.")
            .addText(text => text
                .setValue(String(this.plugin.settings.achievementsCarbPct))
                .onChange(async value => {
                    const n = parseFloat(value);
                    if (!isNaN(n)) { this.plugin.settings.achievementsCarbPct = n; await this.plugin.saveSettings(); }
                }));

        new Setting(containerEl)
            .setName("Macro tolerance (%)")
            .setDesc("Allowed deviation from each macro target. A day counts as balanced if all three macros are within this many percentage points of their targets.")
            .addText(text => text
                .setValue(String(this.plugin.settings.achievementsMacroTolerance))
                .onChange(async value => {
                    const n = parseFloat(value);
                    if (!isNaN(n)) { this.plugin.settings.achievementsMacroTolerance = n; await this.plugin.saveSettings(); }
                }));

        // ── Bills ─────────────────────────────────────────────────────────────

        containerEl.createEl("h2", { text: "Bills" });

        containerEl.createEl("p", {
            text: "Path templates support {{DATE:FORMAT}} tokens — the same syntax as the Meal Logger. " +
                  "FORMAT is any moment.js format string, e.g. {{DATE:YYYY}}, {{DATE:MM}}, {{DATE:MMMM}}.",
            attr: { style: "font-size:0.85em;color:var(--text-muted);margin:0 0 12px;" },
        });

        new Setting(containerEl)
            .setName("Master bills folder")
            .setDesc(
                "Folder where your master bill definition notes are stored. " +
                "Each note should be named Bill-{Name}.md with bill_active, bill_due_date, bill_frequency, and bill_type fields."
            )
            .addText((text) =>
                text
                    .setPlaceholder("Data/Bills")
                    .setValue(this.plugin.settings.billsMasterFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.billsMasterFolder = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Payment notes folder")
            .setDesc(
                "Folder path template where monthly payment notes are stored. " +
                "Supports {{DATE:FORMAT}} tokens (e.g. {{DATE:YYYY}}, {{DATE:MM}}, {{DATE:MMMM}}). " +
                "The filename is always BP-{Bill Name}-YYYY-MM.md.\n" +
                "Example: Data/Bills/Payments/BP-{{DATE:YYYY}}/BP-{{DATE:YYYY-MM}}"
            )
            .addText((text) =>
                text
                    .setPlaceholder("Data/Bills/Payments/BP-{{DATE:YYYY}}/BP-{{DATE:YYYY-MM}}")
                    .setValue(this.plugin.settings.billsPaymentFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.billsPaymentFolder = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        // ── Meal Logger ───────────────────────────────────────────────────────

        containerEl.createEl("h2", { text: "Meal Logger" });

        containerEl.createEl("p", {
            text: "Use {{DATE:FORMAT}} tokens in path and filename templates. " +
                  "Examples: {{DATE:YYYY}}, {{DATE:YYYY-MM}}, {{DATE:YYYY-MM-DD}}.",
            attr: { style: "font-size:0.85em;color:var(--text-muted);margin:0 0 12px;" },
        });

        new Setting(containerEl)
            .setName("Meal log folder")
            .setDesc(
                "Folder path where daily food log notes are stored. Supports {{DATE:FORMAT}} tokens.\n" +
                "Example: Food/Logs/{{DATE:YYYY}}/{{DATE:YYYY-MM}}"
            )
            .addText((text) =>
                text
                    .setPlaceholder("Food/Logs/{{DATE:YYYY}}/{{DATE:YYYY-MM}}")
                    .setValue(this.plugin.settings.mealLogFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.mealLogFolder = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Meal log filename")
            .setDesc(
                "Filename template for daily food log notes (without .md). Supports {{DATE:FORMAT}} tokens.\n" +
                "Example: {{DATE:YYYY-MM-DD}}"
            )
            .addText((text) =>
                text
                    .setPlaceholder("{{DATE:YYYY-MM-DD}}")
                    .setValue(this.plugin.settings.mealLogFilename)
                    .onChange(async (value) => {
                        this.plugin.settings.mealLogFilename = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Food database folder")
            .setDesc(
                "Folder containing individual food notes. Each note should have calories, protein, fat, and carbs frontmatter fields (per serving)."
            )
            .addText((text) =>
                text
                    .setPlaceholder("Food/Database")
                    .setValue(this.plugin.settings.foodFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.foodFolder = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Recipes folder")
            .setDesc(
                "Folder containing recipe notes. Each note should have calories, protein, fat, and carbs frontmatter fields (per serving)."
            )
            .addText((text) =>
                text
                    .setPlaceholder("Recipes")
                    .setValue(this.plugin.settings.recipeFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.recipeFolder = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        // ── Reading Challenge ─────────────────────────────────────────────────

        containerEl.createEl("h2", { text: "Reading Challenge" });

        new Setting(containerEl)
            .setName("Book notes folder")
            .setDesc("Path to the folder containing your book review notes.")
            .addText((text) =>
                text
                    .setPlaceholder("Data/Book Reviews")
                    .setValue(this.plugin.settings.bookNotesFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.bookNotesFolder = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Book note prefix")
            .setDesc("Filename prefix used to identify book notes.")
            .addText((text) =>
                text
                    .setPlaceholder("BR-")
                    .setValue(this.plugin.settings.bookNotePrefix)
                    .onChange(async (value) => {
                        this.plugin.settings.bookNotePrefix = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Reading goal file")
            .setDesc("Full path to your reading goal note (folder + filename).")
            .addText((text) =>
                text
                    .setPlaceholder("Data/Reading Goals.md")
                    .setValue(this.plugin.settings.readingGoalFile)
                    .onChange(async (value) => {
                        this.plugin.settings.readingGoalFile = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        // ── Vitamins ──────────────────────────────────────────────────────────

        containerEl.createEl("h2", { text: "Vitamins" });

        new Setting(containerEl)
            .setName("Vitamins folder")
            .setDesc("Folder containing your vitamin notes.")
            .addText((text) =>
                text
                    .setPlaceholder("Data/Vitamins")
                    .setValue(this.plugin.settings.vitaminsFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.vitaminsFolder = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        // Vitamin periods drag-to-reorder list
        new Setting(containerEl)
            .setName("Vitamin periods")
            .setDesc("Time-of-day sections for vitamin grouping. Drag to reorder, × to delete.");

        const periodsListEl = containerEl.createEl("div", {
            attr: {
                style: "border:1px solid var(--background-modifier-border);border-radius:6px;" +
                       "padding:6px 8px;margin:0 0 8px;",
            },
        });

        const renderPeriodsList = () => {
            periodsListEl.empty();
            const periods = this.plugin.settings.vitaminPeriods;
            let dragSrcIdx: number | null = null;

            for (let i = 0; i < periods.length; i++) {
                const item = periodsListEl.createEl("div", {
                    attr: {
                        draggable: "true",
                        style: "display:flex;align-items:center;gap:8px;padding:4px 6px;" +
                               "border-radius:4px;user-select:none;",
                    },
                });

                item.createEl("span", {
                    text: "⠿",
                    attr: { style: "cursor:grab;color:var(--text-muted);font-size:1.1em;line-height:1;" },
                });

                item.createEl("span", { text: periods[i], attr: { style: "flex:1;" } });

                const delBtn = item.createEl("button", { text: "✕" });
                delBtn.setAttribute("style", "padding:1px 6px;font-size:0.8em;line-height:1.4;" +
                    "background:none;border:1px solid var(--background-modifier-border);" +
                    "border-radius:4px;cursor:pointer;color:var(--text-muted);");
                delBtn.addEventListener("click", async () => {
                    this.plugin.settings.vitaminPeriods.splice(i, 1);
                    await this.plugin.saveSettings();
                    renderPeriodsList();
                });

                item.addEventListener("dragstart", (e) => {
                    dragSrcIdx = i;
                    (e as DragEvent).dataTransfer!.effectAllowed = "move";
                    item.style.opacity = "0.5";
                });
                item.addEventListener("dragend", () => { item.style.opacity = "1"; });
                item.addEventListener("dragover", (e) => {
                    e.preventDefault();
                    (e as DragEvent).dataTransfer!.dropEffect = "move";
                    item.style.background = "var(--background-modifier-hover)";
                });
                item.addEventListener("dragleave", () => { item.style.background = ""; });
                item.addEventListener("drop", async (e) => {
                    e.preventDefault();
                    item.style.background = "";
                    if (dragSrcIdx === null || dragSrcIdx === i) return;
                    const arr = this.plugin.settings.vitaminPeriods;
                    const [moved] = arr.splice(dragSrcIdx, 1);
                    arr.splice(i, 0, moved);
                    dragSrcIdx = null;
                    await this.plugin.saveSettings();
                    renderPeriodsList();
                });
            }
        };

        renderPeriodsList();

        const addPeriodRow = containerEl.createEl("div", {
            attr: { style: "display:flex;gap:8px;margin-bottom:16px;" },
        });
        const addPeriodInput = addPeriodRow.createEl("input", {
            attr: {
                type: "text",
                placeholder: "New period name",
                style: "flex:1;padding:4px 10px;" +
                    "border:1px solid var(--background-modifier-border);" +
                    "border-radius:6px;background:var(--background-primary);color:var(--text-normal);",
            },
        }) as HTMLInputElement;

        const doAddPeriod = async () => {
            const val = addPeriodInput.value.trim();
            if (!val) return;
            this.plugin.settings.vitaminPeriods.push(val);
            await this.plugin.saveSettings();
            addPeriodInput.value = "";
            renderPeriodsList();
        };

        addPeriodRow.createEl("button", { text: "Add" }).addEventListener("click", doAddPeriod);
        addPeriodInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doAddPeriod(); });

        // ── Tracker Pro General Settings ──────────────────────────────────────

        containerEl.createEl("h2", { text: "Tracker Pro General Settings" });

        new Setting(containerEl)
            .setName("Default folder location")
            .setDesc(
                "Files in this folder will be parsed and used as input data of the tracker plugin.\n" +
                "You can also override it using 'folder' argument in the tracker codeblock."
            )
            .addText((text) =>
                text
                    .setPlaceholder("Folder Path")
                    .setValue(this.plugin.settings.folder)
                    .onChange(async (value) => {
                        this.plugin.settings.folder = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Default date format")
            .setDesc(
                "This format is used to parse the date in your diary title.\n" +
                "You can also override it using 'dateFormat' argument in the tracker codeblock."
            )
            .addText((text) =>
                text
                    .setPlaceholder("YYYY-MM-DD")
                    .setValue(this.plugin.settings.dateFormat)
                    .onChange(async (value) => {
                        this.plugin.settings.dateFormat = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Default date property")
            .setDesc(
                "Frontmatter key to read the date from (e.g. \"date\", \"created\").\n" +
                "When set, the date is read from this frontmatter property instead of the filename.\n" +
                "Leave empty to keep using the filename (original behaviour).\n" +
                "You can also override this per block using the 'dateProperty' argument."
            )
            .addText((text) =>
                text
                    .setPlaceholder("frontmatter key, e.g. date")
                    .setValue(this.plugin.settings.dateProperty)
                    .onChange(async (value) => {
                        this.plugin.settings.dateProperty = value.trim();
                        await this.plugin.saveSettings();
                    })
            );
    }
}
