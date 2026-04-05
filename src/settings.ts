import { App, PluginSettingTab, Setting } from "obsidian";
import Tracker from "./main";

export interface TrackerSettings {
    folder: string;
    dateFormat: string;
    dateProperty: string; // frontmatter key to use as date source (empty = use filename)
}

export const DEFAULT_SETTINGS: TrackerSettings = {
    folder: "/",
    dateFormat: "YYYY-MM-DD",
    dateProperty: "", // empty means fall back to filename date
};

export class TrackerSettingTab extends PluginSettingTab {
    plugin: Tracker;

    constructor(app: App, plugin: Tracker) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        let { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName("Default folder location")
            .setDesc(
                "Files in this folder will be parsed and used as input data of the tracker plugin.\nYou can also override it using 'folder' argument in the tracker codeblock."
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
                "This format is used to parse the date in your diary title.\nYou can also override it using 'dateFormat' argument in the tracker codeblock."
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
