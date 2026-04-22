import { Plugin } from "obsidian";
import { parseTrackerConfig } from "./parser";
import { renderTracker, renderErrors } from "./renderer";
import {
    TrackerSettings,
    DEFAULT_SETTINGS,
    TrackerSettingTab,
} from "./settings";
import { logMeal, clearMeal, editMealLog } from "./mealLogger";

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
            name: "Edit today's meal log",
            callback: () => editMealLog(this.app, this.settings),
        });

        // ── Tracker code block processor ──────────────────────────────────────
        this.registerMarkdownCodeBlockProcessor(
            "tracker-pro",
            async (source, el, _ctx) => {
                const container = el.createDiv({ cls: "tracker-pro-root" });

                let src = source;
                if (
                    this.settings.folder &&
                    this.settings.folder !== "/" &&
                    !/^folder\s*:/m.test(src)
                ) {
                    src = `folder: "${this.settings.folder}"\n` + src;
                }

                const { config, errors } = parseTrackerConfig(src);

                if (errors.length > 0 || !config) {
                    renderErrors(container, errors.length > 0 ? errors : [{ message: "Unknown parse error" }]);
                    return;
                }

                if (!config.dateProperty && this.settings.dateProperty) {
                    config.dateProperty = this.settings.dateProperty;
                }

                try {
                    await renderTracker(this.app, container, config);
                } catch (e) {
                    renderErrors(container, [{ message: String(e) }]);
                }
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
