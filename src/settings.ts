import { App, PluginSettingTab, Setting } from "obsidian";
import Tracker from "./main";

export interface TrackerSettings {
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

    // ── Tracker Pro General Settings ──────────────────────────────────────────
    folder: string;
    dateFormat: string;
    dateProperty: string;
}

export const DEFAULT_SETTINGS: TrackerSettings = {
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
        // Current order: Bills · Meal Logger · Reading Challenge · Vitamins · Tracker Pro General Settings
        // ─────────────────────────────────────────────────────────────────────

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
