import { App, FuzzySuggestModal, Notice, Platform, TFile } from "obsidian";
import { TrackerSettings } from "./settings";
import { parseRoutineBody, ExerciseTarget } from "./routineTracker";

// ─── Fixed Export Assumptions ─────────────────────────────────────────────────
// Timing and app settings are hardcoded per spec — not stored on the routine
// note, not prompted for at export time, not configurable anywhere.

const WORK_SECONDS = 60;
const REST_SECONDS = 30;

const FIXED_SETTINGS = {
    voiceEnabled: true,
    countdownEnabled: true,
    beepsEnabled: true,
    vibrateEnabled: true,
    keepScreenOn: true,
    halfwayCallout: false,
    ttsVoiceName: "",
    speechRate: 1,
    prepSeconds: 3,
};

interface CircuitCallerExercise {
    name: string;
    workSeconds: number;
    restSeconds: number;
}

interface CircuitCallerWorkout {
    name: string;
    rounds: number;
    defaultRestSeconds: number;
    prepOverrideSeconds: number;
    exercises: CircuitCallerExercise[];
}

interface CircuitCallerExport {
    version: number;
    exportedAt: number;
    settings: typeof FIXED_SETTINGS;
    workouts: CircuitCallerWorkout[];
}

function buildCircuitCallerExport(routineName: string, exercises: ExerciseTarget[]): CircuitCallerExport {
    return {
        version: 1,
        exportedAt: Date.now(),
        settings: { ...FIXED_SETTINGS },
        workouts: [
            {
                name: routineName,
                rounds: 1,
                defaultRestSeconds: REST_SECONDS,
                prepOverrideSeconds: -1,
                exercises: exercises.map(ex => ({
                    name: ex.name,
                    workSeconds: WORK_SECONDS,
                    restSeconds: REST_SECONDS,
                })),
            },
        ],
    };
}

function sanitizeFilename(name: string): string {
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
}

// ─── Suggest Modal ────────────────────────────────────────────────────────────

class FileSuggestModal extends FuzzySuggestModal<TFile> {
    private chosen = false;
    constructor(
        app: App,
        private files: TFile[],
        placeholder: string,
        private onChoose: (file: TFile | null) => void
    ) {
        super(app);
        this.setPlaceholder(placeholder);
    }
    getItems(): TFile[] { return this.files; }
    getItemText(file: TFile): string { return file.basename; }
    onChooseItem(file: TFile): void { this.chosen = true; this.onChoose(file); }
    onClose(): void {
        this.contentEl.empty();
        // Obsidian's own SuggestModal.selectSuggestion calls close() BEFORE
        // onChooseSuggestion on every selection, not just on cancel — so
        // onClose() always runs first. Defer the "was anything chosen?"
        // check by a macrotask so a real onChooseItem call (which runs a
        // moment later in that same stretch) gets to set `chosen` first and
        // win the race, instead of onClose always resolving null first and
        // silently discarding the real selection.
        setTimeout(() => { if (!this.chosen) this.onChoose(null); }, 0);
    }
}

// ─── Save — platform-specific, never written into the vault ──────────────────

async function saveOnDesktop(jsonStr: string, defaultFilename: string): Promise<void> {
    const electron = (window as any).require("electron");
    const dialog = electron?.remote?.dialog;
    if (!dialog) {
        new Notice("Save dialog unavailable on this desktop build. Please update Obsidian.");
        return;
    }

    const result = await dialog.showSaveDialog({
        defaultPath: defaultFilename,
        filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) {
        new Notice("Export cancelled.");
        return;
    }

    const fs = (window as any).require("fs");
    fs.writeFileSync(result.filePath, jsonStr, "utf8");
    new Notice(`✓ Exported to ${result.filePath}`);
}

async function saveOnMobile(jsonStr: string, filename: string): Promise<void> {
    const nav = navigator as any;
    const file = new File([jsonStr], filename, { type: "application/json" });

    if (!nav.canShare || !nav.canShare({ files: [file] })) {
        new Notice("File sharing isn't supported on this device. Please export from desktop instead.");
        return;
    }

    try {
        await nav.share({ files: [file], title: filename });
        new Notice(`✓ Shared ${filename}`);
    } catch (e) {
        if ((e as any)?.name === "AbortError") return; // user cancelled the share sheet
        new Notice("Share failed. Please export from desktop instead.");
        console.error(e);
    }
}

async function saveExportFile(data: CircuitCallerExport, filename: string): Promise<void> {
    const jsonStr = JSON.stringify(data, null, 2);
    if (Platform.isDesktopApp) {
        await saveOnDesktop(jsonStr, filename);
    } else {
        await saveOnMobile(jsonStr, filename);
    }
}

// ─── Main Command ─────────────────────────────────────────────────────────────

export async function exportRoutineCircuitCaller(app: App, settings: TrackerSettings): Promise<void> {
    const folder = settings.routineFolder.replace(/\/$/, "");
    const routineFiles = app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder + "/"));
    if (routineFiles.length === 0) {
        new Notice(`No routines found in ${settings.routineFolder}.`);
        return;
    }

    const routineFile = await new Promise<TFile | null>(res =>
        new FileSuggestModal(app, routineFiles, "Which routine to export?", res).open()
    );
    if (!routineFile) return;

    const exercises = parseRoutineBody(app, routineFile.path, await app.vault.read(routineFile));
    if (exercises.length === 0) {
        new Notice(`Routine "${routineFile.basename}" has no exercises.`);
        return;
    }

    const data = buildCircuitCallerExport(routineFile.basename, exercises);
    const filename = sanitizeFilename(routineFile.basename) + ".json";
    await saveExportFile(data, filename);
}
