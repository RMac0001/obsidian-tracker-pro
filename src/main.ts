import { Plugin, MarkdownRenderChild } from "obsidian";
import { parseTrackerConfig } from "./parser";
import { renderTracker, renderErrors } from "./renderer";
import {
    TrackerSettings,
    DEFAULT_SETTINGS,
    TrackerSettingTab,
} from "./settings";
import { logMeal, clearMeal, editMealLog } from "./mealLogger";
import { generateMonthlyBills } from "./charts/billsChart";
import { openReadingChallenge } from "./readingChallenge";
import { TrackerConfig } from "./types";

function isRelevantFile(changedPath: string, config: TrackerConfig): boolean {
    if (config.folder) {
        const folder = config.folder.replace(/^\//, "").replace(/\/$/, "");
        if (changedPath.startsWith(folder + "/") || changedPath === folder) {
            return true;
        }
    }

    if (config.file) {
        const normalized = config.file.replace(/^\//, "") +
            (config.file.endsWith(".md") ? "" : ".md");
        if (changedPath === normalized) return true;
    }

    if (config.files) {
        for (const fp of config.files) {
            const normalized = fp.replace(/^\//, "") +
                (fp.endsWith(".md") ? "" : ".md");
            if (changedPath === normalized) return true;
        }
    }

    return false;
}

export default class Tracker extends Plugin {
    settings: TrackerSettings;

    async onload() {
        console.log("loading tracker-pro plugin");

        await this.loadSettings();
        this.addSettingTab(new TrackerSettingTab(this.app, this));

        // ── Meal Logger commands ──────────────────────────────────────────────
        this.addCommand({
            id: "log-meal",
            name: "Log meal",
            callback: () => logMeal(this.app, this.settings),
        });

        this.addCommand({
            id: "clear-meal",
            name: "Clear meal",
            callback: () => clearMeal(this.app, this.settings),
        });

        this.addCommand({
            id: "edit-meal-log",
            name: "Edit meal log",
            callback: () => editMealLog(this.app, this.settings),
        });

        // ── Bill Tracker commands ─────────────────────────────────────────────
        this.addCommand({
            id: "generate-monthly-bills",
            name: "Generate Monthly Bills",
            callback: () => generateMonthlyBills(this.app, this.settings),
        });

        // ── Reading Challenge ─────────────────────────────────────────────────
        this.addCommand({
            id: "reading-challenge",
            name: "Tracker Pro: Reading Challenge",
            callback: () => openReadingChallenge(this.app, this.settings),
        });

        // ── Tracker code block processor ──────────────────────────────────────
        this.registerMarkdownCodeBlockProcessor(
            "tracker-pro",
            async (source, el, ctx) => {
                let src = source;
                if (
                    this.settings.folder &&
                    this.settings.folder !== "/" &&
                    !/^folder\s*:/m.test(src)
                ) {
                    src = `folder: "${this.settings.folder}"\n` + src;
                }

                const { config, errors } = parseTrackerConfig(src);

                const container = el.createDiv({ cls: "tracker-pro-root" });

                if (errors.length > 0 || !config) {
                    renderErrors(container, errors.length > 0 ? errors : [{ message: "Unknown parse error" }]);
                    return;
                }

                if (!config.dateProperty && this.settings.dateProperty) {
                    config.dateProperty = this.settings.dateProperty;
                }

                const render = async () => {
                    container.empty();
                    try {
                        await renderTracker(this.app, container, config, this.settings);
                    } catch (e) {
                        renderErrors(container, [{ message: String(e) }]);
                    }
                };

                await render();

                const child = new MarkdownRenderChild(container);

                child.registerEvent(
                    this.app.metadataCache.on("changed", (file) => {
                        if (isRelevantFile(file.path, config)) {
                            render();
                        }
                    })
                );

                ctx.addChild(child);
            }
        );
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData()
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    onunload() {
        console.log("unloading tracker-pro plugin");
    }
}
