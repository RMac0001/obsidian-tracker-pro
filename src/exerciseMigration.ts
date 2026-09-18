import { App, Modal, Notice, TFile, normalizePath } from "obsidian";
import { TrackerSettings } from "./settings";
import {
    resolveDateTemplate, slugify, getExerciseDisplayName, parseWikilink, resolveWikilinkTarget,
} from "./utils";

// One-time, safely re-runnable migration of legacy Data/Exercise Notes entries
// (EN-YYYY-MM-DD-HHmmss.md, one note per single exercise) into the Data/Workouts
// session-note schema. Data/Exercise Notes is never modified or deleted — this
// only ever creates new files in the workout log folder.
//
// Field mapping is intentionally NOT routed through writeWorkoutLogContent
// (the live Log workout/Edit workout log write path): migrated cardio entries
// copy pace/speed directly from the legacy note rather than recomputing them
// from duration+distance (distance was never recorded on any legacy entry),
// which is a genuinely different rule from live logging, not a shortcut.

// ─── Small local helpers (this file's own copies, per the existing per-file convention) ──

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

function isCardioMode(mode: string): boolean {
    return mode.trim().toLowerCase() === "cardio";
}

function getWorkoutLogBaseFolder(settings: TrackerSettings): string {
    const template = settings.workoutLogFolder;
    const tokenCount = (template.match(/\{\{DATE:/g) ?? []).length;
    if (tokenCount === 0) return template.replace(/\/$/, "");
    const resolved = resolveDateTemplate(template);
    const parts = resolved.split("/");
    return parts.slice(0, Math.max(0, parts.length - tokenCount)).join("/");
}

// Legacy notes use a single "# Notes" heading (vs. the live plugin's "## Notes").
function parseLegacyNotesBody(content: string): string[] {
    const lines = content.split("\n");
    let inNotes = false;
    const notes: string[] = [];
    for (const line of lines) {
        if (line.trim() === "# Notes") { inNotes = true; continue; }
        if (inNotes) {
            if (/^#{1,6}\s/.test(line)) break;
            notes.push(line);
        }
    }
    while (notes.length && notes[notes.length - 1].trim() === "") notes.pop();
    while (notes.length && notes[0].trim() === "") notes.shift();
    return notes;
}

function parseLegacyFilenameDate(basename: string): Date | null {
    const m = basename.match(/^EN-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})$/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────

class ConfirmModal extends Modal {
    private resolved = false;
    constructor(app: App, private message: string, private resolve: (confirmed: boolean) => void) {
        super(app);
    }
    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("p", { text: this.message });
        const btnRow = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;margin-top:12px;" } });
        const yesBtn = btnRow.createEl("button", { text: "Continue", cls: "mod-cta" });
        yesBtn.addEventListener("click", () => { this.resolved = true; this.close(); this.resolve(true); });
        btnRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    }
    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) this.resolve(false);
    }
}

// ─── Main Command ─────────────────────────────────────────────────────────────

interface ReviewItem { file: string; reason: string; }

export async function migrateLegacyExerciseNotes(app: App, settings: TrackerSettings): Promise<void> {
    const legacyFolder = settings.achievementsExerciseFolder.replace(/\/$/, "");
    const legacyFiles = app.vault.getMarkdownFiles().filter(f => f.path.startsWith(legacyFolder + "/"));

    if (legacyFiles.length === 0) {
        new Notice(`No legacy exercise notes found in ${settings.achievementsExerciseFolder}.`);
        return;
    }

    const confirmed = await new Promise<boolean>(res => new ConfirmModal(
        app,
        `This creates up to ${legacyFiles.length} new session notes in Data/Workouts from your ` +
        `${settings.achievementsExerciseFolder} entries. Nothing in ${settings.achievementsExerciseFolder} ` +
        `is changed or deleted. Continue?`,
        res
    ).open());
    if (!confirmed) return;

    let migrated = 0;
    let skippedExisting = 0;
    const review: ReviewItem[] = [];

    for (const legacyFile of legacyFiles) {
        const legacyDate = parseLegacyFilenameDate(legacyFile.basename);
        if (!legacyDate) {
            review.push({ file: legacyFile.path, reason: "Filename doesn't match EN-YYYY-MM-DD-HHmmss" });
            continue;
        }

        const destFolder = resolveDateTemplate(settings.workoutLogFolder, legacyDate);
        const destFilename = resolveDateTemplate(settings.workoutLogFilename, legacyDate);
        const destPath = normalizePath(`${destFolder}/${destFilename}.md`);

        if (app.vault.getAbstractFileByPath(destPath)) {
            skippedExisting++;
            continue;
        }

        const fm = app.metadataCache.getFileCache(legacyFile)?.frontmatter ?? {};

        // Resolve the exercise link by TARGET only — both bare [[Exercise-X]] /
        // [[Exercise-X|alias]] and full-path [[Data/Exercises/Exercise-X.md|alias]]
        // forms appear in the vault; alias text is never trusted for identity.
        const rawLink = Array.isArray(fm.exercise) ? fm.exercise[0] : fm.exercise;
        const link = rawLink !== undefined && rawLink !== null ? parseWikilink(String(rawLink)) : null;
        const linkedFile = link ? resolveWikilinkTarget(app, link.target, legacyFile.path) : null;

        let displayName: string;
        let cardio: boolean;

        if (linkedFile) {
            displayName = getExerciseDisplayName(app, linkedFile);
            const exFm = app.metadataCache.getFileCache(linkedFile)?.frontmatter ?? {};
            cardio = isCardioMode(String(exFm.mode ?? ""));
        } else if (fm.mode !== undefined && String(fm.mode).trim() !== "") {
            displayName = link?.alias ?? link?.target ?? legacyFile.basename;
            cardio = isCardioMode(String(fm.mode));
        } else {
            review.push({ file: legacyFile.path, reason: "Couldn't resolve the exercise link and no mode fallback on the entry" });
            continue;
        }

        const slug = slugify(displayName);
        const timeMin = fm.time_min !== undefined ? Number(fm.time_min) : undefined;
        const creationDate = fm.creation_date !== undefined
            ? fm.creation_date
            : `${legacyDate.getFullYear()}-${String(legacyDate.getMonth() + 1).padStart(2, "0")}-${String(legacyDate.getDate()).padStart(2, "0")}`;

        const rollups: Record<string, unknown> = {};
        let bodyLine: string;
        let totalSets = 0;
        let totalVolume = 0;

        if (cardio) {
            // distance was never recorded on any legacy entry — omitted entirely,
            // not written as 0. Pace/speed are copied directly, not recomputed.
            if (fm.pace !== undefined) rollups[`${slug}_pace`] = fm.pace;
            if (fm.average_speed !== undefined) rollups[`${slug}_speed`] = Number(fm.average_speed);
            if (timeMin !== undefined) rollups[`${slug}_duration_min`] = timeMin;
            rollups[`${slug}_equipment`] = "";

            const paceStr  = fm.pace !== undefined ? `Pace ${fm.pace}/${settings.distanceUnit}` : "";
            const speedStr = fm.average_speed !== undefined ? `Speed ${fm.average_speed} ${settings.distanceUnit}/h` : "";
            const metricStr = [paceStr, speedStr].filter(Boolean).join(" · ");
            bodyLine = `- ${timeMin ?? 0} min${metricStr ? " · " + metricStr : ""}`;
        } else {
            // Reconstruct N identical "Set n: weight x round(reps/sets)" bullets,
            // then derive every rollup from those bullets the same way live
            // logging does — rather than copying the legacy reps total directly —
            // so a session's numbers are always internally self-consistent.
            const setsCount = Number(fm.sets ?? 0);
            const totalReps = Number(fm.reps ?? 0);
            const weight    = Number(fm.weight_lb ?? 0);
            const repsPerSet = setsCount > 0 ? Math.round(totalReps / setsCount) : 0;
            const sets = Array.from({ length: setsCount }, () => ({ weight, reps: repsPerSet }));

            const recomputedReps   = sets.reduce((s, x) => s + x.reps, 0);
            const recomputedVolume = sets.reduce((s, x) => s + x.weight * x.reps, 0);
            const topWeight        = sets.length ? Math.max(...sets.map(s => s.weight)) : 0;

            rollups[`${slug}_sets`]       = sets.length;
            rollups[`${slug}_reps`]       = recomputedReps;
            rollups[`${slug}_top_weight`] = topWeight;
            rollups[`${slug}_volume`]     = recomputedVolume;
            if (timeMin !== undefined) rollups[`${slug}_duration_min`] = timeMin;
            rollups[`${slug}_equipment`] = "";

            totalSets   = sets.length;
            totalVolume = recomputedVolume;

            bodyLine = sets.length
                ? sets.map((s, i) => `- Set ${i + 1}: ${s.weight} ${settings.weightUnit} × ${s.reps}`).join("\n")
                : "";
        }

        await ensureFolders(app, destPath);
        await app.vault.create(destPath, "");
        const newFile = app.vault.getAbstractFileByPath(destPath);
        if (!(newFile instanceof TFile)) {
            review.push({ file: legacyFile.path, reason: "Failed to create destination session note" });
            continue;
        }

        await app.fileManager.processFrontMatter(newFile, (nfm) => {
            nfm.creation_date = creationDate;
            if (timeMin !== undefined) nfm.time_min = timeMin;
            for (const [k, v] of Object.entries(rollups)) nfm[k] = v;
            nfm.total_sets   = totalSets;
            nfm.total_volume = totalVolume;
        });

        const notesLines  = parseLegacyNotesBody(await app.vault.read(legacyFile));
        const headingLink = linkedFile ? `[[${linkedFile.basename}|${displayName}]]` : displayName;
        let body = `## ${headingLink} — \n${bodyLine ? bodyLine + "\n" : ""}\n## Notes\n`;
        if (notesLines.length > 0) body += notesLines.join("\n") + "\n";

        const updated = await app.vault.read(newFile);
        const fmLines = updated.split("\n");
        let fmEnd = -1;
        if (fmLines[0] === "---") {
            for (let i = 1; i < fmLines.length; i++) {
                if (fmLines[i] === "---") { fmEnd = i; break; }
            }
        }
        const fmBlock = fmEnd !== -1 ? fmLines.slice(0, fmEnd + 1).join("\n") : "";
        await app.vault.modify(newFile, fmBlock + "\n\n" + body);

        migrated++;
    }

    if (review.length > 0) {
        const reportPath = normalizePath(`${getWorkoutLogBaseFolder(settings)}/Migration Report.md`);
        let reportContent = `# Migration Report\n\n${review.length} entr${review.length !== 1 ? "ies" : "y"} ` +
            `needed review during the last migration run:\n\n`;
        for (const item of review) {
            reportContent += `- **${item.file}** — ${item.reason}\n`;
        }
        const existingReport = app.vault.getAbstractFileByPath(reportPath);
        if (existingReport instanceof TFile) {
            await app.vault.modify(existingReport, reportContent);
        } else {
            await ensureFolders(app, reportPath);
            await app.vault.create(reportPath, reportContent);
        }
    }

    const parts = [`${migrated} migrated`];
    if (skippedExisting > 0) parts.push(`${skippedExisting} already migrated`);
    if (review.length > 0) parts.push(`${review.length} need review — see Migration Report.md`);
    new Notice(`✓ Legacy exercise note migration: ${parts.join(", ")}.`);
}
