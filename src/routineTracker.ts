import {
    App,
    FuzzySuggestModal,
    Modal,
    Notice,
    TFile,
    normalizePath,
} from "obsidian";
import { TrackerSettings } from "./settings";
import { resolveDateTemplate, findSectionRange, slugify, parseTimeToSeconds, formatSecondsAsTime } from "./utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExerciseTarget {
    name: string;
    targetSets?: number;
    targetRepRange?: string;
}

interface LoggedSet {
    weight: number;
    reps: number;
}

interface LoggedStrengthExercise {
    kind: "strength";
    name: string;
    equipment: string;
    sets: LoggedSet[];
}

interface LoggedCardioExercise {
    kind: "cardio";
    name: string;
    equipment: string;
    cardioMetric: "Pace" | "Speed";
    durationMin: number;
    distance: number;
    avgHr?: number;
    peakHr?: number;
}

type LoggedExercise = LoggedStrengthExercise | LoggedCardioExercise;

function isStrength(ex: LoggedExercise): ex is LoggedStrengthExercise { return ex.kind === "strength"; }
function isCardioLog(ex: LoggedExercise): ex is LoggedCardioExercise { return ex.kind === "cardio"; }

interface LastSetHint {
    weight: number;
    reps: number;
}

interface LastCardioHint {
    durationMin: number;
    distance: number;
    pace?: string;
    speed?: number;
}

// Category is free text on exercise notes — compare case-insensitively so
// "cardio", "Cardio", " Cardio " etc. are all treated the same.
function isCardioCategory(category: string): boolean {
    return category.trim().toLowerCase() === "cardio";
}

// ─── Shared Helpers ───────────────────────────────────────────────────────────

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

function extractBody(content: string): string {
    const lines = content.split("\n");
    if (lines[0] !== "---") return content;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] === "---") return lines.slice(i + 1).join("\n");
    }
    return content;
}

function getExerciseFiles(app: App, settings: TrackerSettings): TFile[] {
    const folder = settings.exerciseFolder.replace(/\/$/, "");
    return app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder + "/"));
}

function getRoutineFiles(app: App, settings: TrackerSettings): TFile[] {
    const folder = settings.routineFolder.replace(/\/$/, "");
    return app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder + "/"));
}

// ─── Suggest Modals ───────────────────────────────────────────────────────────

class StringSuggestModal extends FuzzySuggestModal<string> {
    private chosen = false;
    constructor(
        app: App,
        private options: string[],
        placeholder: string,
        private onChoose: (val: string | null) => void
    ) {
        super(app);
        this.setPlaceholder(placeholder);
    }
    getItems(): string[] { return this.options; }
    getItemText(item: string): string { return item; }
    onChooseItem(item: string): void { this.chosen = true; this.onChoose(item); }
    onClose(): void {
        this.contentEl.empty();
        if (!this.chosen) this.onChoose(null);
    }
}

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
        if (!this.chosen) this.onChoose(null);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Exercise Database
// ═══════════════════════════════════════════════════════════════════════════

interface ExerciseFormResult {
    name: string;
    category: string;
    description: string;
    defaultEquipment: string;
    cardioMetric?: "Pace" | "Speed";
}

async function loadExerciseForEdit(
    app: App,
    file: TFile
): Promise<{ category: string; description: string; defaultEquipment: string; cardioMetric: string }> {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const content = await app.vault.read(file);
    return {
        category: String(fm.category ?? ""),
        defaultEquipment: String(fm.default_equipment ?? ""),
        cardioMetric: String(fm.cardio_metric ?? ""),
        description: extractBody(content).trim(),
    };
}

function buildExerciseContent(
    category: string,
    defaultEquipment: string,
    cardioMetric: string | undefined,
    description: string
): string {
    let content = "";
    if (category || defaultEquipment || cardioMetric) {
        content += "---\n";
        if (category) content += `category: ${category}\n`;
        if (defaultEquipment) content += `default_equipment: ${defaultEquipment}\n`;
        if (cardioMetric) content += `cardio_metric: ${cardioMetric}\n`;
        content += "---\n\n";
    }
    if (description) content += description + "\n";
    return content;
}

class ExerciseFormModal extends Modal {
    private resolved = false;
    constructor(
        app: App,
        private isEdit: boolean,
        private initial: { name: string; category: string; description: string; defaultEquipment: string; cardioMetric: string },
        private equipmentTypes: string[],
        private resolve: (result: ExerciseFormResult | null) => void
    ) { super(app); }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: this.isEdit ? `Edit exercise: ${this.initial.name}` : "New exercise" });

        const labelStyle = "font-size:0.9em;color:var(--text-muted);";
        const inputStyle = "display:block;width:100%;padding:8px 10px;margin:4px 0 12px;" +
            "border:1px solid var(--background-modifier-border);border-radius:6px;" +
            "background:var(--background-primary);color:var(--text-normal);";

        contentEl.createEl("label", { text: "Name", attr: { style: labelStyle } });
        const nameAttrs: Record<string, string> = { type: "text", value: this.initial.name, style: inputStyle };
        if (this.isEdit) nameAttrs.disabled = "true";
        const nameInput = contentEl.createEl("input", { attr: nameAttrs }) as HTMLInputElement;

        contentEl.createEl("label", { text: "Category (optional)", attr: { style: labelStyle } });
        const categoryInput = contentEl.createEl("input", {
            attr: { type: "text", value: this.initial.category, style: inputStyle },
        }) as HTMLInputElement;

        // Cardio metric — shown only when category is Cardio (e.g. "Cardio")
        const metricWrap = contentEl.createDiv();
        metricWrap.createEl("label", { text: "Cardio metric", attr: { style: labelStyle } });
        const metricSelect = metricWrap.createEl("select", { attr: { style: inputStyle } }) as HTMLSelectElement;
        for (const m of ["Pace", "Speed"]) {
            const opt = metricSelect.createEl("option", { text: m });
            opt.value = m;
        }
        metricSelect.value = this.initial.cardioMetric === "Speed" ? "Speed" : "Pace";

        const updateMetricVisibility = () => {
            metricWrap.style.display = isCardioCategory(categoryInput.value) ? "" : "none";
        };
        updateMetricVisibility();
        categoryInput.addEventListener("input", updateMetricVisibility);

        contentEl.createEl("label", { text: "Default equipment (optional)", attr: { style: labelStyle } });
        const equipmentSelect = contentEl.createEl("select", { attr: { style: inputStyle } }) as HTMLSelectElement;
        const noneOpt = equipmentSelect.createEl("option", { text: "— None —" });
        noneOpt.value = "";
        for (const eq of this.equipmentTypes) {
            const opt = equipmentSelect.createEl("option", { text: eq });
            opt.value = eq;
        }
        equipmentSelect.value = this.equipmentTypes.includes(this.initial.defaultEquipment)
            ? this.initial.defaultEquipment
            : "";

        contentEl.createEl("label", { text: "Description (optional)", attr: { style: labelStyle } });
        const descInput = contentEl.createEl("textarea", {
            attr: { rows: "4", style: inputStyle },
        }) as HTMLTextAreaElement;
        descInput.value = this.initial.description;

        const btnRow = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;" } });
        const saveBtn = btnRow.createEl("button", { text: this.isEdit ? "Save" : "Create", cls: "mod-cta" });
        saveBtn.addEventListener("click", () => {
            const name = this.isEdit ? this.initial.name : nameInput.value.trim();
            if (!name) { new Notice("Name is required."); return; }
            const category = categoryInput.value.trim();
            this.resolved = true;
            this.close();
            this.resolve({
                name,
                category,
                description: descInput.value.trim(),
                defaultEquipment: equipmentSelect.value,
                cardioMetric: isCardioCategory(category) ? (metricSelect.value as "Pace" | "Speed") : undefined,
            });
        });
        btnRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

        (this.isEdit ? categoryInput : nameInput).focus();
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) this.resolve(null);
    }
}

export async function createEditExercise(app: App, settings: TrackerSettings): Promise<void> {
    const files = getExerciseFiles(app, settings);
    const CREATE_NEW = "+ Create new exercise";
    const options = [CREATE_NEW, ...files.map(f => f.basename)];

    const choice = await new Promise<string | null>(res =>
        new StringSuggestModal(app, options, "Search exercises or create new…", res).open()
    );
    if (choice === null) return;

    let isEdit = false;
    let initial = { name: "", category: "", description: "", defaultEquipment: "", cardioMetric: "" };

    if (choice !== CREATE_NEW) {
        const existingFile = files.find(f => f.basename === choice);
        if (existingFile) {
            isEdit = true;
            initial = { name: existingFile.basename, ...(await loadExerciseForEdit(app, existingFile)) };
        }
    }

    const result = await new Promise<ExerciseFormResult | null>(res =>
        new ExerciseFormModal(app, isEdit, initial, settings.equipmentTypes, res).open()
    );
    if (!result) return;

    const folder = settings.exerciseFolder.replace(/\/$/, "");
    const filePath = normalizePath(`${folder}/${result.name}.md`);
    const content = buildExerciseContent(result.category, result.defaultEquipment, result.cardioMetric, result.description);

    await ensureFolders(app, filePath);
    const existingAtPath = app.vault.getAbstractFileByPath(filePath);
    if (existingAtPath instanceof TFile) {
        await app.vault.modify(existingAtPath, content);
    } else {
        await app.vault.create(filePath, content);
    }

    new Notice(`✓ Exercise "${result.name}" ${isEdit ? "updated" : "created"}.`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Routines
// ═══════════════════════════════════════════════════════════════════════════
// Line format: "N. [[Exercise Name]] — target sets × rep range" (suffix optional).
// Parsing/serialization mirrors the bullet-prefix + wikilink regex approach used
// for recipe ingredient lines in recipeNormalizer.ts, adapted to numbered lines.

function formatTargetSuffix(target: ExerciseTarget): string {
    if (target.targetSets && target.targetRepRange) return `${target.targetSets} × ${target.targetRepRange}`;
    if (target.targetSets) return `${target.targetSets} sets`;
    if (target.targetRepRange) return `${target.targetRepRange} reps`;
    return "";
}

function formatRoutineExerciseLine(idx: number, target: ExerciseTarget): string {
    const suffix = formatTargetSuffix(target);
    return suffix ? `${idx}. [[${target.name}]] — ${suffix}` : `${idx}. [[${target.name}]]`;
}

function parseRoutineExerciseLine(line: string): ExerciseTarget | null {
    const m = line.match(/^\d+\.\s+\[\[(.+?)\]\](?:\s+—\s+(.*))?$/);
    if (!m) return null;
    const name = m[1];
    const suffix = m[2]?.trim();
    if (!suffix) return { name };

    const bothM = suffix.match(/^(\d+)\s*×\s*(.+)$/);
    if (bothM) return { name, targetSets: parseInt(bothM[1], 10), targetRepRange: bothM[2].trim() };

    const setsOnlyM = suffix.match(/^(\d+)\s*sets?$/i);
    if (setsOnlyM) return { name, targetSets: parseInt(setsOnlyM[1], 10) };

    const repsOnlyM = suffix.match(/^(.+?)\s*reps?$/i);
    if (repsOnlyM) return { name, targetRepRange: repsOnlyM[1].trim() };

    return { name, targetRepRange: suffix };
}

export function parseRoutineBody(content: string): ExerciseTarget[] {
    const lines = content.split("\n");
    const range = findSectionRange(lines, "Exercises");
    if (!range) return [];
    const result: ExerciseTarget[] = [];
    for (let i = range.start; i < range.end; i++) {
        const parsed = parseRoutineExerciseLine(lines[i].trim());
        if (parsed) result.push(parsed);
    }
    return result;
}

function buildRoutineContent(category: string, exercises: ExerciseTarget[]): string {
    let content = "";
    if (category) content += `---\ncategory: ${category}\n---\n\n`;
    content += "## Exercises\n";
    exercises.forEach((ex, i) => { content += formatRoutineExerciseLine(i + 1, ex) + "\n"; });
    return content;
}

class RoutineNameModal extends Modal {
    private resolved = false;
    constructor(app: App, private resolve: (result: { name: string; category: string } | null) => void) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "New routine" });

        const labelStyle = "font-size:0.9em;color:var(--text-muted);";
        const inputStyle = "display:block;width:100%;padding:8px 10px;margin:4px 0 12px;" +
            "border:1px solid var(--background-modifier-border);border-radius:6px;" +
            "background:var(--background-primary);color:var(--text-normal);";

        contentEl.createEl("label", { text: "Name", attr: { style: labelStyle } });
        const nameInput = contentEl.createEl("input", { attr: { type: "text", style: inputStyle } }) as HTMLInputElement;

        contentEl.createEl("label", { text: "Category (optional)", attr: { style: labelStyle } });
        const categoryInput = contentEl.createEl("input", { attr: { type: "text", style: inputStyle } }) as HTMLInputElement;

        const btnRow = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;" } });
        const nextBtn = btnRow.createEl("button", { text: "Next", cls: "mod-cta" });
        nextBtn.addEventListener("click", () => {
            const name = nameInput.value.trim();
            if (!name) { new Notice("Name is required."); return; }
            this.resolved = true;
            this.close();
            this.resolve({ name, category: categoryInput.value.trim() });
        });
        btnRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

        nameInput.focus();
        nameInput.addEventListener("keydown", e => { if (e.key === "Enter") nextBtn.click(); });
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) this.resolve(null);
    }
}

class RoutineTargetModal extends Modal {
    private resolved = false;
    constructor(
        app: App,
        private exerciseName: string,
        private resolve: (result: { targetSets?: number; targetRepRange?: string } | null) => void
    ) { super(app); }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: `Add ${this.exerciseName}` });

        const labelStyle = "font-size:0.9em;color:var(--text-muted);";
        const inputStyle = "display:block;width:100%;padding:8px 10px;margin:4px 0 12px;" +
            "border:1px solid var(--background-modifier-border);border-radius:6px;" +
            "background:var(--background-primary);color:var(--text-normal);";

        contentEl.createEl("label", { text: "Target sets (optional)", attr: { style: labelStyle } });
        const setsInput = contentEl.createEl("input", { attr: { type: "number", min: "1", style: inputStyle } }) as HTMLInputElement;

        contentEl.createEl("label", { text: "Target rep range (optional, e.g. 8-12)", attr: { style: labelStyle } });
        const repsInput = contentEl.createEl("input", { attr: { type: "text", style: inputStyle } }) as HTMLInputElement;

        const btnRow = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;" } });
        const addBtn = btnRow.createEl("button", { text: "Add", cls: "mod-cta" });
        addBtn.addEventListener("click", () => {
            this.resolved = true;
            this.close();
            const targetSets = parseInt(setsInput.value, 10);
            const targetRepRange = repsInput.value.trim();
            this.resolve({
                targetSets: isNaN(targetSets) ? undefined : targetSets,
                targetRepRange: targetRepRange || undefined,
            });
        });
        btnRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

        setsInput.focus();
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) this.resolve(null);
    }
}

export async function createEditRoutine(app: App, settings: TrackerSettings): Promise<void> {
    const routineFiles = getRoutineFiles(app, settings);
    const CREATE_NEW = "+ Create new routine";
    const options = [CREATE_NEW, ...routineFiles.map(f => f.basename)];

    const choice = await new Promise<string | null>(res =>
        new StringSuggestModal(app, options, "Search routines or create new…", res).open()
    );
    if (choice === null) return;

    let name = "";
    let category = "";
    let exercises: ExerciseTarget[] = [];

    if (choice === CREATE_NEW) {
        const created = await new Promise<{ name: string; category: string } | null>(res =>
            new RoutineNameModal(app, res).open()
        );
        if (!created) return;
        name = created.name;
        category = created.category;
    } else {
        const file = routineFiles.find(f => f.basename === choice);
        if (!file) return;
        name = file.basename;
        const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        category = String(fm.category ?? "");
        exercises = parseRoutineBody(await app.vault.read(file));
    }

    const exerciseFiles = getExerciseFiles(app, settings);
    if (exerciseFiles.length === 0) {
        new Notice(`No exercises found in ${settings.exerciseFolder}. Create some exercises first.`);
        return;
    }

    let done = false;
    while (!done) {
        const labels = exercises.map((e, i) => {
            const suffix = formatTargetSuffix(e);
            return `${i + 1}. ${e.name}${suffix ? ` (${suffix})` : ""}`;
        });
        const menuOptions = [
            "Add an exercise",
            ...(exercises.length > 0 ? ["Reorder an exercise", "Remove an exercise"] : []),
            `Done — save routine (${exercises.length} exercise${exercises.length !== 1 ? "s" : ""})`,
        ];
        const menuChoice = await new Promise<string | null>(res =>
            new StringSuggestModal(app, menuOptions, `Routine: ${name}`, res).open()
        );
        if (menuChoice === null) { new Notice("Create/edit routine cancelled."); return; }

        if (menuChoice === "Add an exercise") {
            const file = await new Promise<TFile | null>(res =>
                new FileSuggestModal(app, exerciseFiles, "Search exercise database…", res).open()
            );
            if (!file) continue;
            const target = await new Promise<{ targetSets?: number; targetRepRange?: string } | null>(res =>
                new RoutineTargetModal(app, file.basename, res).open()
            );
            if (!target) continue;
            exercises.push({ name: file.basename, ...target });
            new Notice(`Added: ${file.basename}`);
            continue;
        }

        if (menuChoice === "Reorder an exercise") {
            const which = await new Promise<string | null>(res =>
                new StringSuggestModal(app, labels, "Move which exercise?", res).open()
            );
            if (which === null) continue;
            const idx = labels.indexOf(which);
            const direction = await new Promise<string | null>(res =>
                new StringSuggestModal(app, ["Move up", "Move down"], "Direction?", res).open()
            );
            if (direction === null) continue;
            const newIdx = direction === "Move up" ? idx - 1 : idx + 1;
            if (newIdx < 0 || newIdx >= exercises.length) { new Notice("Can't move further in that direction."); continue; }
            [exercises[idx], exercises[newIdx]] = [exercises[newIdx], exercises[idx]];
            continue;
        }

        if (menuChoice === "Remove an exercise") {
            const which = await new Promise<string | null>(res =>
                new StringSuggestModal(app, labels, "Remove which exercise?", res).open()
            );
            if (which === null) continue;
            exercises.splice(labels.indexOf(which), 1);
            continue;
        }

        done = true; // "Done — save routine…"
    }

    if (exercises.length === 0) {
        new Notice("Routine not saved — no exercises added.");
        return;
    }

    const folder = settings.routineFolder.replace(/\/$/, "");
    const filePath = normalizePath(`${folder}/${name}.md`);
    await ensureFolders(app, filePath);
    const content = buildRoutineContent(category, exercises);
    const existingAtPath = app.vault.getAbstractFileByPath(filePath);
    if (existingAtPath instanceof TFile) {
        await app.vault.modify(existingAtPath, content);
    } else {
        await app.vault.create(filePath, content);
    }

    new Notice(`✓ Routine "${name}" saved with ${exercises.length} exercise${exercises.length !== 1 ? "s" : ""}.`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Log Workout
// ═══════════════════════════════════════════════════════════════════════════

function getFileDateWL(app: App, file: TFile): Date | null {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const cd = fm.creation_date;
    if (cd) {
        const s = cd instanceof Date
            ? `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, "0")}-${String(cd.getDate()).padStart(2, "0")}`
            : String(cd);
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    }
    return new Date(file.stat.ctime);
}

function getWorkoutLogBaseFolder(settings: TrackerSettings): string {
    const template = settings.workoutLogFolder;
    const tokenCount = (template.match(/\{\{DATE:/g) ?? []).length;
    if (tokenCount === 0) return template.replace(/\/$/, "");
    const resolved = resolveDateTemplate(template);
    const parts = resolved.split("/");
    return parts.slice(0, Math.max(0, parts.length - tokenCount)).join("/");
}

// Scans past workout logs (most recent first) for the exercise+equipment pair and
// returns the set with the highest weight from the first matching session found.
async function findLastLoggedSet(
    app: App,
    settings: TrackerSettings,
    exerciseName: string,
    equipment: string
): Promise<LastSetHint | null> {
    const slug = slugify(exerciseName);
    const base = getWorkoutLogBaseFolder(settings);
    const files = app.vault.getMarkdownFiles().filter(f => !base || f.path.startsWith(base + "/"));

    const matches = files
        .filter(f => (app.metadataCache.getFileCache(f)?.frontmatter ?? {})[`${slug}_equipment`] === equipment)
        .sort((a, b) => (getFileDateWL(app, b)?.getTime() ?? 0) - (getFileDateWL(app, a)?.getTime() ?? 0));

    const heading = `## ${exerciseName} — ${equipment}`;

    for (const file of matches) {
        const lines = (await app.vault.read(file)).split("\n");
        const headerIdx = lines.findIndex(l => l.trim() === heading);
        if (headerIdx === -1) continue;

        let best: LastSetHint | null = null;
        for (let i = headerIdx + 1; i < lines.length; i++) {
            if (lines[i].startsWith("## ")) break;
            const m = lines[i].match(/^-\s+Set\s+\d+:\s+([\d.]+)\s+\S+\s+×\s+(\d+)/);
            if (m) {
                const weight = parseFloat(m[1]);
                const reps = parseInt(m[2], 10);
                if (!best || weight > best.weight) best = { weight, reps };
            }
        }
        if (best) return best;
    }
    return null;
}

// Cardio rollups are stored directly as frontmatter fields, so — unlike strength's
// top-weight/reps pairing — no body parsing is needed to recover the hint.
async function findLastLoggedCardio(
    app: App,
    settings: TrackerSettings,
    exerciseName: string,
    equipment: string
): Promise<LastCardioHint | null> {
    const slug = slugify(exerciseName);
    const base = getWorkoutLogBaseFolder(settings);
    const files = app.vault.getMarkdownFiles().filter(f => !base || f.path.startsWith(base + "/"));

    const matches = files
        .filter(f => (app.metadataCache.getFileCache(f)?.frontmatter ?? {})[`${slug}_equipment`] === equipment)
        .sort((a, b) => (getFileDateWL(app, b)?.getTime() ?? 0) - (getFileDateWL(app, a)?.getTime() ?? 0));

    for (const file of matches) {
        const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        const durationMin = Number(fm[`${slug}_duration_min`]);
        const distance = Number(fm[`${slug}_distance`]);
        if (isNaN(durationMin) || isNaN(distance)) continue;
        return {
            durationMin,
            distance,
            pace: fm[`${slug}_pace`] !== undefined ? String(fm[`${slug}_pace`]) : undefined,
            speed: fm[`${slug}_speed`] !== undefined ? Number(fm[`${slug}_speed`]) : undefined,
        };
    }
    return null;
}

function formatStrengthHint(hint: LastSetHint | null, weightUnit: string): string | null {
    return hint ? `${hint.weight} ${weightUnit} × ${hint.reps}` : null;
}

function formatCardioHint(
    hint: LastCardioHint | null,
    distanceUnit: string,
    cardioMetric: "Pace" | "Speed"
): string | null {
    if (!hint) return null;
    const metricStr = cardioMetric === "Pace" && hint.pace
        ? `Pace ${hint.pace}/${distanceUnit}`
        : cardioMetric === "Speed" && hint.speed !== undefined
            ? `Speed ${hint.speed} ${distanceUnit}/h`
            : "";
    return `${hint.durationMin} min · ${hint.distance} ${distanceUnit}${metricStr ? " · " + metricStr : ""}`;
}

class EquipmentModal extends Modal {
    private resolved = false;
    private hintEl!: HTMLParagraphElement;

    constructor(
        app: App,
        private exerciseName: string,
        private equipmentTypes: string[],
        private defaultEquipment: string,
        private getHint: (equipment: string) => Promise<string | null>,
        private resolve: (equipment: string | null) => void
    ) { super(app); }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: this.exerciseName });

        contentEl.createEl("label", {
            text: "Equipment for this session",
            attr: { style: "font-size:0.9em;color:var(--text-muted);" },
        });
        const select = contentEl.createEl("select", {
            attr: {
                style: "display:block;width:100%;padding:8px 10px;margin:4px 0 8px;" +
                    "border:1px solid var(--background-modifier-border);border-radius:6px;" +
                    "background:var(--background-primary);color:var(--text-normal);",
            },
        }) as HTMLSelectElement;
        for (const eq of this.equipmentTypes) {
            const opt = select.createEl("option", { text: eq });
            opt.value = eq;
        }
        select.value = this.equipmentTypes.includes(this.defaultEquipment)
            ? this.defaultEquipment
            : (this.equipmentTypes[0] ?? "");

        this.hintEl = contentEl.createEl("p", {
            attr: { style: "margin:0 0 12px;font-size:0.85em;color:var(--text-muted);" },
        });
        this.updateHint(select.value);
        select.addEventListener("change", () => this.updateHint(select.value));

        const btnRow = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;" } });
        const continueBtn = btnRow.createEl("button", { text: "Continue", cls: "mod-cta" });
        continueBtn.addEventListener("click", () => {
            this.resolved = true;
            this.close();
            this.resolve(select.value);
        });
        btnRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    }

    private updateHint(equipment: string): void {
        this.hintEl.setText("Loading last log…");
        this.getHint(equipment).then(hint => {
            this.hintEl.setText(hint ? `Last (${equipment}): ${hint}` : `No previous log for ${equipment}.`);
        });
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) this.resolve(null);
    }
}

class SetLoggingModal extends Modal {
    private sets: LoggedSet[] = [];
    private resolved = false;
    private listEl!: HTMLDivElement;
    private weightInput!: HTMLInputElement;
    private repsInput!: HTMLInputElement;
    private nextBtn!: HTMLButtonElement;

    constructor(
        app: App,
        private exerciseName: string,
        private equipment: string,
        private weightUnit: string,
        private resolve: (sets: LoggedSet[] | null) => void
    ) { super(app); }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: `${this.exerciseName} — ${this.equipment}` });

        this.listEl = contentEl.createDiv({
            attr: { style: "margin-bottom:10px;font-size:0.9em;color:var(--text-muted);" },
        });
        this.renderList();

        const inputStyle = "width:100%;padding:8px 10px;font-size:1.05em;" +
            "border:1px solid var(--background-modifier-border);border-radius:6px;" +
            "background:var(--background-primary);color:var(--text-normal);";

        const inputRow = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;margin-bottom:10px;" } });

        const weightCol = inputRow.createDiv({ attr: { style: "flex:1;" } });
        weightCol.createEl("label", { text: `Weight (${this.weightUnit})`, attr: { style: "font-size:0.85em;color:var(--text-muted);" } });
        this.weightInput = weightCol.createEl("input", { attr: { type: "number", step: "0.5", min: "0", style: inputStyle } }) as HTMLInputElement;

        const repsCol = inputRow.createDiv({ attr: { style: "flex:1;" } });
        repsCol.createEl("label", { text: "Reps", attr: { style: "font-size:0.85em;color:var(--text-muted);" } });
        this.repsInput = repsCol.createEl("input", { attr: { type: "number", step: "1", min: "0", style: inputStyle } }) as HTMLInputElement;

        const addBtn = contentEl.createEl("button", {
            text: "Add set",
            attr: { style: "width:100%;padding:8px;margin-bottom:12px;cursor:pointer;" },
        });
        addBtn.addEventListener("click", () => this.addSet());
        this.repsInput.addEventListener("keydown", e => { if (e.key === "Enter") this.addSet(); });

        const btnRow = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;" } });
        this.nextBtn = btnRow.createEl("button", { text: "Next exercise", cls: "mod-cta" });
        this.nextBtn.disabled = true;
        this.nextBtn.addEventListener("click", () => {
            this.resolved = true;
            this.close();
            this.resolve(this.sets);
        });
        btnRow.createEl("button", { text: "Skip exercise" }).addEventListener("click", () => {
            this.resolved = true;
            this.close();
            this.resolve(null);
        });

        this.weightInput.focus();
    }

    private addSet(): void {
        const weight = parseFloat(this.weightInput.value);
        const reps = parseInt(this.repsInput.value, 10);
        if (isNaN(weight) || isNaN(reps)) { new Notice("Enter both weight and reps."); return; }
        this.sets.push({ weight, reps });
        this.nextBtn.disabled = false;
        this.weightInput.value = "";
        this.repsInput.value = "";
        this.weightInput.focus();
        this.renderList();
    }

    private renderList(): void {
        this.listEl.empty();
        if (this.sets.length === 0) {
            this.listEl.setText("No sets logged yet.");
            return;
        }
        this.sets.forEach((s, i) => {
            this.listEl.createDiv({ text: `Set ${i + 1}: ${s.weight} ${this.weightUnit} × ${s.reps}` });
        });
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) this.resolve(null);
    }
}

interface CardioEntryResult {
    durationMin: number;
    distance: number;
    avgHr?: number;
    peakHr?: number;
}

class CardioEntryModal extends Modal {
    private resolved = false;

    constructor(
        app: App,
        private exerciseName: string,
        private equipment: string,
        private distanceUnit: string,
        private resolve: (result: CardioEntryResult | null) => void
    ) { super(app); }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: `${this.exerciseName} — ${this.equipment}` });

        const labelStyle = "font-size:0.9em;color:var(--text-muted);";
        const inputStyle = "display:block;width:100%;padding:8px 10px;margin:4px 0 12px;" +
            "border:1px solid var(--background-modifier-border);border-radius:6px;" +
            "background:var(--background-primary);color:var(--text-normal);";

        contentEl.createEl("label", { text: "Duration (minutes)", attr: { style: labelStyle } });
        const durationInput = contentEl.createEl("input", { attr: { type: "number", step: "0.5", min: "0", style: inputStyle } }) as HTMLInputElement;

        contentEl.createEl("label", { text: `Distance (${this.distanceUnit})`, attr: { style: labelStyle } });
        const distanceInput = contentEl.createEl("input", { attr: { type: "number", step: "0.01", min: "0", style: inputStyle } }) as HTMLInputElement;

        contentEl.createEl("label", { text: "Avg heart rate — BPM (optional)", attr: { style: labelStyle } });
        const avgHrInput = contentEl.createEl("input", { attr: { type: "number", step: "1", min: "0", style: inputStyle } }) as HTMLInputElement;

        contentEl.createEl("label", { text: "Peak heart rate — BPM (optional)", attr: { style: labelStyle } });
        const peakHrInput = contentEl.createEl("input", { attr: { type: "number", step: "1", min: "0", style: inputStyle } }) as HTMLInputElement;

        const btnRow = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;" } });
        const doneBtn = btnRow.createEl("button", { text: "Done", cls: "mod-cta" });
        doneBtn.addEventListener("click", () => {
            const durationMin = parseFloat(durationInput.value);
            const distance = parseFloat(distanceInput.value);
            if (isNaN(durationMin) || isNaN(distance)) { new Notice("Enter both duration and distance."); return; }
            const avgHr = parseFloat(avgHrInput.value);
            const peakHr = parseFloat(peakHrInput.value);
            this.resolved = true;
            this.close();
            this.resolve({
                durationMin,
                distance,
                avgHr: isNaN(avgHr) ? undefined : avgHr,
                peakHr: isNaN(peakHr) ? undefined : peakHr,
            });
        });
        btnRow.createEl("button", { text: "Skip exercise" }).addEventListener("click", () => {
            this.resolved = true;
            this.close();
            this.resolve(null);
        });

        durationInput.focus();
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) this.resolve(null);
    }
}

async function logOneExercise(
    app: App,
    settings: TrackerSettings,
    exerciseName: string,
    exerciseFiles: TFile[]
): Promise<LoggedExercise | null> {
    const exerciseFile = exerciseFiles.find(f => f.basename === exerciseName);
    const fm = exerciseFile ? (app.metadataCache.getFileCache(exerciseFile)?.frontmatter ?? {}) : {};
    const defaultEquipment = String(fm.default_equipment ?? settings.equipmentTypes[0] ?? "");
    const cardio = isCardioCategory(String(fm.category ?? ""));
    const cardioMetric: "Pace" | "Speed" = fm.cardio_metric === "Speed" ? "Speed" : "Pace";

    const getHint = cardio
        ? (eq: string) => findLastLoggedCardio(app, settings, exerciseName, eq)
            .then(hint => formatCardioHint(hint, settings.distanceUnit, cardioMetric))
        : (eq: string) => findLastLoggedSet(app, settings, exerciseName, eq)
            .then(hint => formatStrengthHint(hint, settings.weightUnit));

    const equipment = await new Promise<string | null>(res =>
        new EquipmentModal(app, exerciseName, settings.equipmentTypes, defaultEquipment, getHint, res).open()
    );
    if (!equipment) return null;

    if (cardio) {
        const entry = await new Promise<CardioEntryResult | null>(res =>
            new CardioEntryModal(app, exerciseName, equipment, settings.distanceUnit, res).open()
        );
        if (!entry) return null;
        return { kind: "cardio", name: exerciseName, equipment, cardioMetric, ...entry };
    }

    const sets = await new Promise<LoggedSet[] | null>(res =>
        new SetLoggingModal(app, exerciseName, equipment, settings.weightUnit, res).open()
    );
    if (!sets || sets.length === 0) return null;

    return { kind: "strength", name: exerciseName, equipment, sets };
}

function computeCardioMetricField(ex: LoggedCardioExercise): { key: string; value: string | number } {
    return ex.cardioMetric === "Pace"
        ? { key: "pace", value: formatSecondsAsTime((ex.durationMin * 60) / ex.distance) }
        : { key: "speed", value: Number(((ex.distance * 60) / ex.durationMin).toFixed(1)) };
}

function formatCardioBodyLine(ex: LoggedCardioExercise, settings: TrackerSettings): string {
    const metric = computeCardioMetricField(ex);
    const metricStr = ex.cardioMetric === "Pace"
        ? `Pace ${metric.value}/${settings.distanceUnit}`
        : `Speed ${metric.value} ${settings.distanceUnit}/h`;
    let line = `- ${ex.durationMin} min · ${ex.distance} ${settings.distanceUnit} · ${metricStr}`;
    if (ex.avgHr !== undefined || ex.peakHr !== undefined) {
        const parts: string[] = [];
        if (ex.avgHr !== undefined) parts.push(`avg ${ex.avgHr}`);
        if (ex.peakHr !== undefined) parts.push(`peak ${ex.peakHr}`);
        line += ` · HR ${parts.join(" / ")}`;
    }
    return line;
}

interface WorkoutTotals {
    totalSets: number;
    totalVolume: number;
    totalDurationMin: number;
}

// Shared by Log workout (new file) and Edit workout log (existing file) so both
// commands recompute every rollup fresh from the current exercise list — never
// incrementally adjusted from what was previously stored.
async function writeWorkoutLogContent(
    app: App,
    settings: TrackerSettings,
    file: TFile,
    routineName: string | null,
    exercises: LoggedExercise[],
    notesLines: string[] = []
): Promise<WorkoutTotals> {
    const strengthLogged = exercises.filter(isStrength);
    const cardioLogged   = exercises.filter(isCardioLog);
    const totalSets        = strengthLogged.reduce((s, ex) => s + ex.sets.length, 0);
    const totalVolume       = strengthLogged.reduce((s, ex) => s + ex.sets.reduce((ss, x) => ss + x.weight * x.reps, 0), 0);
    const totalDurationMin = cardioLogged.reduce((s, ex) => s + ex.durationMin, 0);

    await app.fileManager.processFrontMatter(file, (fm) => {
        // Clear everything except creation_date, then rebuild fresh — so a
        // removed exercise's fields (or a stale routine:) can't linger.
        for (const key of Object.keys(fm)) {
            if (key !== "creation_date") delete fm[key];
        }
        fm.creation_date = fm.creation_date ?? (window as any).moment().format("YYYY-MM-DD");
        if (routineName) fm.routine = routineName;
        for (const ex of exercises) {
            const slug = slugify(ex.name);
            if (ex.kind === "strength") {
                fm[`${slug}_sets`]       = ex.sets.length;
                fm[`${slug}_reps`]       = ex.sets.reduce((s, x) => s + x.reps, 0);
                fm[`${slug}_top_weight`] = ex.sets.length ? Math.max(...ex.sets.map(s => s.weight)) : 0;
                fm[`${slug}_volume`]     = ex.sets.reduce((s, x) => s + x.weight * x.reps, 0);
                fm[`${slug}_equipment`]  = ex.equipment;
            } else {
                const metric = computeCardioMetricField(ex);
                fm[`${slug}_duration_min`] = ex.durationMin;
                fm[`${slug}_distance`]     = ex.distance;
                fm[`${slug}_${metric.key}`] = metric.value;
                if (ex.avgHr !== undefined) fm[`${slug}_avg_hr`] = ex.avgHr;
                if (ex.peakHr !== undefined) fm[`${slug}_peak_hr`] = ex.peakHr;
                fm[`${slug}_equipment`] = ex.equipment;
            }
        }
        fm.total_sets         = totalSets;
        fm.total_volume       = totalVolume;
        fm.total_duration_min = totalDurationMin;
    });

    // Rebuild body: one heading + entry per exercise, in logged order, then trailing Notes
    let body = "";
    for (const ex of exercises) {
        body += `## ${ex.name} — ${ex.equipment}\n`;
        if (ex.kind === "strength") {
            ex.sets.forEach((s, i) => {
                body += `- Set ${i + 1}: ${s.weight} ${settings.weightUnit} × ${s.reps}\n`;
            });
        } else {
            body += formatCardioBodyLine(ex, settings) + "\n";
        }
        body += "\n";
    }
    body += "## Notes\n";
    if (notesLines.length > 0) body += notesLines.join("\n") + "\n";

    const updated = await app.vault.read(file);
    const fmLines = updated.split("\n");
    let fmEnd = -1;
    if (fmLines[0] === "---") {
        for (let i = 1; i < fmLines.length; i++) {
            if (fmLines[i] === "---") { fmEnd = i; break; }
        }
    }
    const fmBlock = fmEnd !== -1 ? fmLines.slice(0, fmEnd + 1).join("\n") : "";
    await app.vault.modify(file, fmBlock + "\n\n" + body);

    return { totalSets, totalVolume, totalDurationMin };
}

async function saveWorkoutLog(
    app: App,
    settings: TrackerSettings,
    routineName: string | null,
    logged: LoggedExercise[]
): Promise<void> {
    const folder = resolveDateTemplate(settings.workoutLogFolder);
    const filename = resolveDateTemplate(settings.workoutLogFilename);
    const filePath = normalizePath(`${folder}/${filename}.md`);

    await ensureFolders(app, filePath);
    await app.vault.create(filePath, "");
    const file = app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) { new Notice("Failed to create workout log."); return; }

    const { totalSets, totalVolume, totalDurationMin } = await writeWorkoutLogContent(app, settings, file, routineName, logged);

    const parts: string[] = [];
    if (logged.some(isStrength)) parts.push(`${totalSets} sets, ${totalVolume} total volume`);
    if (logged.some(isCardioLog)) parts.push(`${totalDurationMin} cardio minutes`);
    new Notice(`✓ Workout logged: ${parts.join(" · ")}.`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Edit Workout Log
// ═══════════════════════════════════════════════════════════════════════════

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

// Reconstructs the logged exercises from an existing session note. Each
// heading section is tagged strength/cardio by looking up the CURRENT
// category on the source exercise note (the same rule Log workout uses),
// with a body-shape fallback for a since-deleted or since-recategorized
// exercise note so parsing degrades gracefully instead of losing data.
function parseWorkoutLogBody(
    app: App,
    exerciseFiles: TFile[],
    content: string
): LoggedExercise[] {
    const lines = extractBody(content).split("\n");
    const result: LoggedExercise[] = [];
    let i = 0;

    while (i < lines.length) {
        const headingMatch = lines[i].match(/^## (.+)$/);
        if (!headingMatch || headingMatch[1] === "Notes") { i++; continue; }

        const headingText = headingMatch[1];
        const sepIdx = headingText.lastIndexOf(" — ");
        i++;
        if (sepIdx === -1) continue; // malformed heading — skip without consuming as data

        const name = headingText.slice(0, sepIdx);
        const equipment = headingText.slice(sepIdx + 3);

        const sectionLines: string[] = [];
        while (i < lines.length && !lines[i].startsWith("## ")) {
            sectionLines.push(lines[i]);
            i++;
        }

        const exerciseFile = exerciseFiles.find(f => f.basename === name);
        const fm = exerciseFile ? (app.metadataCache.getFileCache(exerciseFile)?.frontmatter ?? {}) : {};
        const category = String(fm.category ?? "");
        const setLines = sectionLines.filter(l => /^-\s+Set\s+\d+:/.test(l));

        const cardio = exerciseFile && category
            ? isCardioCategory(category)
            : setLines.length === 0 && sectionLines.some(l => l.trim().startsWith("-"));

        if (!cardio) {
            const sets: LoggedSet[] = [];
            for (const line of setLines) {
                const m = line.match(/^-\s+Set\s+\d+:\s+([\d.]+)\s+\S+\s+×\s+(\d+)/);
                if (m) sets.push({ weight: parseFloat(m[1]), reps: parseInt(m[2], 10) });
            }
            result.push({ kind: "strength", name, equipment, sets });
        } else {
            const cardioMetric: "Pace" | "Speed" = fm.cardio_metric === "Speed" ? "Speed" : "Pace";
            const dataLine = sectionLines.find(l => l.trim().startsWith("-"));
            let durationMin = 0, distance = 0;
            let avgHr: number | undefined, peakHr: number | undefined;
            if (dataLine) {
                const m = dataLine.match(/^-\s+([\d.]+)\s+min\s+·\s+([\d.]+)\s+\S+/);
                if (m) { durationMin = parseFloat(m[1]); distance = parseFloat(m[2]); }
                const avgM = dataLine.match(/HR\s+avg\s+([\d.]+)/);
                const peakM = dataLine.match(/peak\s+([\d.]+)/);
                if (avgM) avgHr = parseFloat(avgM[1]);
                if (peakM) peakHr = parseFloat(peakM[1]);
            }
            result.push({ kind: "cardio", name, equipment, cardioMetric, durationMin, distance, avgHr, peakHr });
        }
    }

    return result;
}

export async function logWorkout(app: App, settings: TrackerSettings): Promise<void> {
    const PICK_ROUTINE = "Pick a routine";
    const AD_HOC = "Log without a routine";
    const entryChoice = await new Promise<string | null>(res =>
        new StringSuggestModal(app, [PICK_ROUTINE, AD_HOC], "How do you want to log?", res).open()
    );
    if (entryChoice === null) return;

    const exerciseFiles = getExerciseFiles(app, settings);
    const logged: LoggedExercise[] = [];
    let routineName: string | null = null;

    if (entryChoice === PICK_ROUTINE) {
        const routineFiles = getRoutineFiles(app, settings);
        if (routineFiles.length === 0) {
            new Notice(`No routines found in ${settings.routineFolder}. Create a routine first.`);
            return;
        }

        const routineFile = await new Promise<TFile | null>(res =>
            new FileSuggestModal(app, routineFiles, "Which routine?", res).open()
        );
        if (!routineFile) return;

        const targets = parseRoutineBody(await app.vault.read(routineFile));
        if (targets.length === 0) {
            new Notice(`Routine "${routineFile.basename}" has no exercises.`);
            return;
        }
        routineName = routineFile.basename;

        for (const target of targets) {
            const result = await logOneExercise(app, settings, target.name, exerciseFiles);
            if (result) logged.push(result);
        }
    }

    // Ad hoc entry lands here with nothing logged yet — this loop is then its whole flow.
    // Routine entry reuses the same loop to optionally log exercises outside the routine.
    if (exerciseFiles.length === 0) {
        if (logged.length === 0) {
            new Notice(`No exercises found in ${settings.exerciseFolder}. Create some exercises first.`);
            return;
        }
    } else {
        const addPrompt = routineName ? "Add an exercise not in this routine" : "Add an exercise";
        while (true) {
            const choice = await new Promise<string | null>(res =>
                new StringSuggestModal(app, [addPrompt, "Finish workout"], "Anything else?", res).open()
            );
            if (choice === null || choice === "Finish workout") break;

            const file = await new Promise<TFile | null>(res =>
                new FileSuggestModal(app, exerciseFiles, "Search exercise database…", res).open()
            );
            if (!file) continue;

            const result = await logOneExercise(app, settings, file.basename, exerciseFiles);
            if (result) logged.push(result);
        }
    }

    if (logged.length === 0) {
        new Notice("Workout not saved — no exercises logged.");
        return;
    }

    await saveWorkoutLog(app, settings, routineName, logged);
}

// ─── Field-Edit Modals ────────────────────────────────────────────────────────

class SetEditModal extends Modal {
    private resolved = false;
    constructor(
        app: App,
        private initial: LoggedSet,
        private weightUnit: string,
        private resolve: (result: LoggedSet | null) => void
    ) { super(app); }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "Set" });

        const labelStyle = "font-size:0.9em;color:var(--text-muted);";
        const inputStyle = "display:block;width:100%;padding:8px 10px;margin:4px 0 12px;" +
            "border:1px solid var(--background-modifier-border);border-radius:6px;" +
            "background:var(--background-primary);color:var(--text-normal);";

        contentEl.createEl("label", { text: `Weight (${this.weightUnit})`, attr: { style: labelStyle } });
        const weightInput = contentEl.createEl("input", {
            attr: { type: "number", step: "0.5", min: "0", value: String(this.initial.weight), style: inputStyle },
        }) as HTMLInputElement;

        contentEl.createEl("label", { text: "Reps", attr: { style: labelStyle } });
        const repsInput = contentEl.createEl("input", {
            attr: { type: "number", step: "1", min: "0", value: String(this.initial.reps), style: inputStyle },
        }) as HTMLInputElement;

        const btnRow = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;" } });
        const saveBtn = btnRow.createEl("button", { text: "Save", cls: "mod-cta" });
        saveBtn.addEventListener("click", () => {
            const weight = parseFloat(weightInput.value);
            const reps = parseInt(repsInput.value, 10);
            if (isNaN(weight) || isNaN(reps)) { new Notice("Enter both weight and reps."); return; }
            this.resolved = true;
            this.close();
            this.resolve({ weight, reps });
        });
        btnRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

        weightInput.focus();
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) this.resolve(null);
    }
}

class CardioFieldsEditModal extends Modal {
    private resolved = false;
    constructor(
        app: App,
        private initial: { durationMin: number; distance: number },
        private distanceUnit: string,
        private resolve: (result: { durationMin: number; distance: number } | null) => void
    ) { super(app); }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "Duration / distance" });

        const labelStyle = "font-size:0.9em;color:var(--text-muted);";
        const inputStyle = "display:block;width:100%;padding:8px 10px;margin:4px 0 12px;" +
            "border:1px solid var(--background-modifier-border);border-radius:6px;" +
            "background:var(--background-primary);color:var(--text-normal);";

        contentEl.createEl("label", { text: "Duration (minutes)", attr: { style: labelStyle } });
        const durationInput = contentEl.createEl("input", {
            attr: { type: "number", step: "0.5", min: "0", value: String(this.initial.durationMin), style: inputStyle },
        }) as HTMLInputElement;

        contentEl.createEl("label", { text: `Distance (${this.distanceUnit})`, attr: { style: labelStyle } });
        const distanceInput = contentEl.createEl("input", {
            attr: { type: "number", step: "0.01", min: "0", value: String(this.initial.distance), style: inputStyle },
        }) as HTMLInputElement;

        const btnRow = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;" } });
        const saveBtn = btnRow.createEl("button", { text: "Save", cls: "mod-cta" });
        saveBtn.addEventListener("click", () => {
            const durationMin = parseFloat(durationInput.value);
            const distance = parseFloat(distanceInput.value);
            if (isNaN(durationMin) || isNaN(distance)) { new Notice("Enter both duration and distance."); return; }
            this.resolved = true;
            this.close();
            this.resolve({ durationMin, distance });
        });
        btnRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

        durationInput.focus();
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) this.resolve(null);
    }
}

class HeartRateEditModal extends Modal {
    private resolved = false;
    constructor(
        app: App,
        private initial: { avgHr?: number; peakHr?: number },
        private resolve: (result: { avgHr?: number; peakHr?: number } | null) => void
    ) { super(app); }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "Heart rate" });

        const labelStyle = "font-size:0.9em;color:var(--text-muted);";
        const inputStyle = "display:block;width:100%;padding:8px 10px;margin:4px 0 12px;" +
            "border:1px solid var(--background-modifier-border);border-radius:6px;" +
            "background:var(--background-primary);color:var(--text-normal);";

        contentEl.createEl("label", { text: "Avg heart rate — BPM (optional, leave blank to skip)", attr: { style: labelStyle } });
        const avgInput = contentEl.createEl("input", {
            attr: {
                type: "number", step: "1", min: "0", style: inputStyle,
                value: this.initial.avgHr !== undefined ? String(this.initial.avgHr) : "",
            },
        }) as HTMLInputElement;

        contentEl.createEl("label", { text: "Peak heart rate — BPM (optional, leave blank to skip)", attr: { style: labelStyle } });
        const peakInput = contentEl.createEl("input", {
            attr: {
                type: "number", step: "1", min: "0", style: inputStyle,
                value: this.initial.peakHr !== undefined ? String(this.initial.peakHr) : "",
            },
        }) as HTMLInputElement;

        const btnRow = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;" } });
        const saveBtn = btnRow.createEl("button", { text: "Save", cls: "mod-cta" });
        saveBtn.addEventListener("click", () => {
            const avgHr = parseFloat(avgInput.value);
            const peakHr = parseFloat(peakInput.value);
            this.resolved = true;
            this.close();
            this.resolve({
                avgHr: isNaN(avgHr) ? undefined : avgHr,
                peakHr: isNaN(peakHr) ? undefined : peakHr,
            });
        });
        btnRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

        avgInput.focus();
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) this.resolve(null);
    }
}

// ─── Edit Workout Log Modal ───────────────────────────────────────────────────

function getRecentWorkoutLogFiles(app: App, settings: TrackerSettings, limit: number): TFile[] {
    const base = getWorkoutLogBaseFolder(settings);
    const files = app.vault.getMarkdownFiles();
    const filtered = base ? files.filter(f => f.path.startsWith(base + "/")) : files;
    return filtered.sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, limit);
}

class EditWorkoutLogModal extends Modal {
    private routineName: string | null = null;
    private exercises: LoggedExercise[] = [];
    private notesLines: string[] = [];
    private exerciseFiles: TFile[];

    constructor(app: App, private settings: TrackerSettings, private file: TFile) {
        super(app);
        this.exerciseFiles = getExerciseFiles(app, settings);
    }

    onOpen(): void {
        this.contentEl.setText("Loading…");
        this.loadFile().then(() => this.render());
    }

    private async loadFile(): Promise<void> {
        const content = await this.app.vault.read(this.file);
        const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter ?? {};
        this.routineName = fm.routine ? String(fm.routine) : null;
        this.exercises = parseWorkoutLogBody(this.app, this.exerciseFiles, content);
        this.notesLines = parseNotesLines(extractBody(content));
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("div", { text: this.file.basename, attr: { style: "font-weight:600;margin-bottom:2px;" } });
        if (this.routineName) {
            contentEl.createEl("div", {
                text: `Routine: ${this.routineName}`,
                attr: { style: "color:var(--text-muted);font-size:0.85em;margin-bottom:8px;" },
            });
        }

        const summary = contentEl.createDiv({ attr: { style: "margin:8px 0 12px;" } });
        if (this.exercises.length === 0) {
            summary.createEl("p", {
                text: "No exercises logged in this session.",
                attr: { style: "color:var(--text-muted);font-size:0.85em;" },
            });
        }
        for (const ex of this.exercises) {
            const line = ex.kind === "strength"
                ? `${ex.name} (${ex.equipment}): ${ex.sets.length} set${ex.sets.length !== 1 ? "s" : ""}` +
                  (ex.sets.length ? `, top ${Math.max(...ex.sets.map(s => s.weight))} ${this.settings.weightUnit}` : "")
                : `${ex.name} (${ex.equipment}): ${ex.durationMin} min · ${ex.distance} ${this.settings.distanceUnit}`;
            summary.createDiv({ text: line, attr: { style: "padding:2px 0;font-size:0.9em;" } });
        }

        const actionList = contentEl.createDiv({ attr: { style: "display:flex;flex-direction:column;gap:6px;margin-bottom:12px;" } });
        const actions: { label: string; fn: () => void }[] = [
            { label: "Edit an exercise", fn: () => this.editExercise() },
            { label: "Add an exercise", fn: () => this.addExercise() },
            { label: "Remove an exercise", fn: () => this.removeExercise() },
        ];
        for (const action of actions) {
            const btn = actionList.createEl("button", { text: action.label });
            btn.onclick = () => action.fn();
        }

        const saveBtn = contentEl.createEl("button", {
            text: "Save and recalculate",
            cls: "mod-cta",
            attr: { style: "width:100%;margin-top:8px;" },
        });
        saveBtn.onclick = () => this.save();
    }

    private editExercise(): void {
        if (this.exercises.length === 0) { new Notice("No exercises to edit."); return; }
        const labels = this.exercises.map(ex => `${ex.name} (${ex.equipment})`);
        new StringSuggestModal(this.app, labels, "Edit which exercise?", (label) => {
            if (label === null) { this.render(); return; }
            const ex = this.exercises[labels.indexOf(label)];
            if (ex.kind === "strength") this.editStrengthExercise(ex);
            else this.editCardioExercise(ex);
        }).open();
    }

    private editStrengthExercise(ex: LoggedStrengthExercise): void {
        const options = ["Change equipment", "Change a set", "Add a set", "Remove a set", "Done"];
        new StringSuggestModal(this.app, options, `${ex.name} — ${ex.equipment}`, (choice) => {
            if (choice === null || choice === "Done") { this.render(); return; }

            if (choice === "Change equipment") {
                new StringSuggestModal(this.app, this.settings.equipmentTypes, "New equipment?", (eq) => {
                    if (eq) ex.equipment = eq;
                    this.render();
                }).open();
                return;
            }

            if (choice === "Change a set") {
                if (ex.sets.length === 0) { new Notice("No sets to change."); this.render(); return; }
                const setLabels = ex.sets.map((s, i) => `Set ${i + 1}: ${s.weight} ${this.settings.weightUnit} × ${s.reps}`);
                new StringSuggestModal(this.app, setLabels, "Change which set?", (setLabel) => {
                    if (setLabel === null) { this.render(); return; }
                    const setIdx = setLabels.indexOf(setLabel);
                    new SetEditModal(this.app, ex.sets[setIdx], this.settings.weightUnit, (updated) => {
                        if (updated) ex.sets[setIdx] = updated;
                        this.render();
                    }).open();
                }).open();
                return;
            }

            if (choice === "Add a set") {
                new SetEditModal(this.app, { weight: 0, reps: 0 }, this.settings.weightUnit, (added) => {
                    if (added) ex.sets.push(added);
                    this.render();
                }).open();
                return;
            }

            // "Remove a set"
            if (ex.sets.length === 0) { new Notice("No sets to remove."); this.render(); return; }
            const setLabels = ex.sets.map((s, i) => `Set ${i + 1}: ${s.weight} ${this.settings.weightUnit} × ${s.reps}`);
            new StringSuggestModal(this.app, setLabels, "Remove which set?", (setLabel) => {
                if (setLabel !== null) ex.sets.splice(setLabels.indexOf(setLabel), 1);
                this.render();
            }).open();
        }).open();
    }

    private editCardioExercise(ex: LoggedCardioExercise): void {
        const options = ["Change equipment", "Edit duration/distance", "Edit heart rate", "Done"];
        new StringSuggestModal(this.app, options, `${ex.name} — ${ex.equipment}`, (choice) => {
            if (choice === null || choice === "Done") { this.render(); return; }

            if (choice === "Change equipment") {
                new StringSuggestModal(this.app, this.settings.equipmentTypes, "New equipment?", (eq) => {
                    if (eq) ex.equipment = eq;
                    this.render();
                }).open();
                return;
            }

            if (choice === "Edit duration/distance") {
                new CardioFieldsEditModal(this.app, ex, this.settings.distanceUnit, (updated) => {
                    if (updated) { ex.durationMin = updated.durationMin; ex.distance = updated.distance; }
                    this.render();
                }).open();
                return;
            }

            // "Edit heart rate" — pace/speed is never edited directly; it's
            // always recomputed from duration/distance on save.
            new HeartRateEditModal(this.app, ex, (updated) => {
                if (updated) { ex.avgHr = updated.avgHr; ex.peakHr = updated.peakHr; }
                this.render();
            }).open();
        }).open();
    }

    private addExercise(): void {
        if (this.exerciseFiles.length === 0) {
            new Notice(`No exercises found in ${this.settings.exerciseFolder}.`);
            return;
        }
        new FileSuggestModal(this.app, this.exerciseFiles, "Search exercise database…", (file) => {
            if (!file) { this.render(); return; }
            logOneExercise(this.app, this.settings, file.basename, this.exerciseFiles).then((result) => {
                if (result) {
                    this.exercises.push(result);
                    new Notice(`Added: ${file.basename}`);
                }
                this.render();
            });
        }).open();
    }

    private removeExercise(): void {
        if (this.exercises.length === 0) { new Notice("No exercises to remove."); return; }
        const labels = this.exercises.map(ex => `${ex.name} (${ex.equipment})`);
        new StringSuggestModal(this.app, labels, "Remove which exercise?", (label) => {
            if (label !== null) this.exercises.splice(labels.indexOf(label), 1);
            this.render();
        }).open();
    }

    private save(): void {
        const dateStr = (window as any).moment().format("YYYY-MM-DD");
        const newNotesLines = [...this.notesLines, `- ${dateStr} — Log recalculated`];

        writeWorkoutLogContent(this.app, this.settings, this.file, this.routineName, this.exercises, newNotesLines)
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

export function editWorkoutLog(app: App, settings: TrackerSettings): void {
    const files = getRecentWorkoutLogFiles(app, settings, 30);
    if (files.length === 0) {
        new Notice("No workout logs found.");
        return;
    }
    new FileSuggestModal(app, files, "Which workout session?", (file) => {
        if (file) new EditWorkoutLogModal(app, settings, file).open();
    }).open();
}
