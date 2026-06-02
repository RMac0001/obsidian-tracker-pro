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

interface VitaminMeta {
    file: TFile;
    name: string;
    brand: string;
    count: number;
    onHand: number;
    dose: string;
    doseUnit: string;
    form: string;
    time: string;
    lastTaken: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayYMD(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function isTakenToday(lastTaken: string): boolean {
    if (!lastTaken) return false;
    // Parse lastTaken as local date to compare with local today
    const parts = String(lastTaken).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!parts) return false;
    const y = parseInt(parts[1]);
    const m = parseInt(parts[2]);
    const d = parseInt(parts[3]);
    const today = new Date();
    return (
        today.getFullYear() === y &&
        today.getMonth() + 1 === m &&
        today.getDate() === d
    );
}

function parseDose(dose: string): number {
    const str = String(dose ?? "1");
    if (str.includes("/")) {
        return str.split("/").reduce((sum, part) => sum + (parseFloat(part.trim()) || 0), 0);
    }
    return parseFloat(str) || 1;
}

function doseDisplay(dose: string): string {
    // For split-dose "1/1", each session is 1 pill
    const str = String(dose ?? "1");
    if (str.includes("/")) return "1";
    return str;
}

function resolveTodayLogPath(settings: TrackerSettings): string {
    const folder   = resolveDateTemplate(settings.mealLogFolder);
    const filename = resolveDateTemplate(settings.mealLogFilename);
    return normalizePath(`${folder}/${filename}.md`);
}

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

function buildBlankLogContent(): string {
    const fm: Record<string, number> = {};
    for (const macro of ["cal", "protein", "fat", "carbs"]) {
        fm[`${macro}_total`] = 0;
        for (const meal of ["breakfast", "lunch", "dinner", "snacks"]) {
            fm[`${macro}_${meal}`] = 0;
        }
    }
    let content = "---\n";
    for (const [k, v] of Object.entries(fm)) content += `${k}: ${v}\n`;
    content += "---\n\n";
    for (const meal of ["Breakfast", "Lunch", "Dinner", "Snacks"]) {
        content += `## ${meal}\n\n`;
    }
    return content;
}

function getVitaminMeta(app: App, file: TFile): VitaminMeta {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    return {
        file,
        name:      String(fm.vitamin_name      ?? file.basename),
        brand:     String(fm.vitamin_brand     ?? ""),
        count:     Number(fm.vitamin_count     ?? 0),
        onHand:    Number(fm.vitamin_on_hand   ?? 0),
        dose:      String(fm.vitamin_dose      ?? "1"),
        doseUnit:  String(fm.vitamin_dose_unit ?? ""),
        form:      String(fm.vitamin_form      ?? ""),
        time:      String(fm.vitamin_time      ?? ""),
        lastTaken: String(fm.vitamin_last_taken ?? ""),
    };
}

function loadActiveVitamins(app: App, settings: TrackerSettings): VitaminMeta[] {
    const folder = settings.vitaminsFolder.replace(/\/$/, "");
    const files = app.vault.getMarkdownFiles()
        .filter(f => f.path.startsWith(folder + "/"));
    const result: VitaminMeta[] = [];
    for (const file of files) {
        const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        if (fm.vitamin_active !== true) continue;
        result.push(getVitaminMeta(app, file));
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
}

// ─── Merge Logic ──────────────────────────────────────────────────────────────

interface ParsedVitaminEntry {
    name: string;
    line: string; // full log line, e.g. "- Omega-3 — 1 Softgel, 1000 mg"
}

function parseVitaminsSection(content: string): {
    morning: ParsedVitaminEntry[];
    evening: ParsedVitaminEntry[];
} {
    const morning: ParsedVitaminEntry[] = [];
    const evening: ParsedVitaminEntry[] = [];

    const vitSection = content.match(/## Vitamins\s*([\s\S]*?)(?=\n##\s|\n---\s*$|$)/);
    if (!vitSection) return { morning, evening };

    const body = vitSection[1];
    let currentSection = "";
    for (const rawLine of body.split("\n")) {
        const line = rawLine.trimEnd();
        if (/^###\s*Morning/i.test(line)) { currentSection = "morning"; continue; }
        if (/^###\s*Evening/i.test(line)) { currentSection = "evening"; continue; }
        if (/^###\s/.test(line)) { currentSection = ""; continue; }
        if (/^##\s/.test(line)) break;
        if (!line.startsWith("- ")) continue;
        const nameMatch = line.match(/^- (.+?) —/);
        if (!nameMatch) continue;
        const entry: ParsedVitaminEntry = { name: nameMatch[1], line };
        if (currentSection === "morning") morning.push(entry);
        else if (currentSection === "evening") evening.push(entry);
    }
    return { morning, evening };
}

function buildVitaminsSection(
    morning: ParsedVitaminEntry[],
    evening: ParsedVitaminEntry[]
): string {
    let block = "## Vitamins\n\n";
    if (morning.length > 0) {
        block += "### Morning\n";
        for (const e of morning) block += e.line + "\n";
        block += "\n";
    }
    if (evening.length > 0) {
        block += "### Evening\n";
        for (const e of evening) block += e.line + "\n";
        block += "\n";
    }
    return block.trimEnd() + "\n";
}

function mergeVitaminEntries(
    existing: ParsedVitaminEntry[],
    newEntries: ParsedVitaminEntry[]
): ParsedVitaminEntry[] {
    const seen = new Set(existing.map(e => e.name));
    const merged = [...existing];
    for (const e of newEntries) {
        if (!seen.has(e.name)) {
            seen.add(e.name);
            merged.push(e);
        }
    }
    return merged;
}

// ─── Modals ───────────────────────────────────────────────────────────────────

class VitaminPickModal extends FuzzySuggestModal<VitaminMeta> {
    constructor(
        app: App,
        private vitamins: VitaminMeta[],
        private onChoose: (v: VitaminMeta) => void
    ) {
        super(app);
        this.setPlaceholder("Select a vitamin to resupply…");
    }
    getItems(): VitaminMeta[] { return this.vitamins; }
    getItemText(item: VitaminMeta): string { return item.name; }
    onChooseItem(item: VitaminMeta): void { this.onChoose(item); }
}

class SameBottleModal extends Modal {
    constructor(
        app: App,
        private vitamin: VitaminMeta,
        private onSame: () => void,
        private onDifferent: () => void
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: `Restocking ${this.vitamin.name}` });
        contentEl.createEl("p", {
            text: `Is this the same bottle size as before? Current: ${this.vitamin.count} · Brand: ${this.vitamin.brand}`,
            attr: { style: "color:var(--text-muted);margin-bottom:16px;" },
        });

        const btnRow = contentEl.createEl("div", {
            attr: { style: "display:flex;gap:10px;" },
        });

        const sameBtn = btnRow.createEl("button", { text: "Same" });
        sameBtn.addEventListener("click", () => {
            this.close();
            this.onSame();
        });

        const diffBtn = btnRow.createEl("button", { text: "Different" });
        diffBtn.addEventListener("click", () => {
            this.close();
            this.onDifferent();
        });
    }

    onClose(): void { this.contentEl.empty(); }
}

class NewBottleModal extends Modal {
    constructor(
        app: App,
        private vitamin: VitaminMeta,
        private onConfirm: (brand: string, count: number) => void
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: `New bottle details — ${this.vitamin.name}` });

        contentEl.createEl("label", { text: "Brand", attr: { style: "font-size:0.9em;color:var(--text-muted);" } });
        const brandInput = contentEl.createEl("input", {
            attr: {
                type: "text",
                value: this.vitamin.brand,
                style: "display:block;width:100%;margin:4px 0 12px;padding:8px 10px;" +
                    "border:1px solid var(--background-modifier-border);" +
                    "border-radius:6px;background:var(--background-primary);color:var(--text-normal);",
            },
        }) as HTMLInputElement;

        contentEl.createEl("label", { text: "Quantity", attr: { style: "font-size:0.9em;color:var(--text-muted);" } });
        const countInput = contentEl.createEl("input", {
            attr: {
                type: "number",
                min: "1",
                value: String(this.vitamin.count),
                style: "display:block;width:100%;margin:4px 0 16px;padding:8px 10px;" +
                    "border:1px solid var(--background-modifier-border);" +
                    "border-radius:6px;background:var(--background-primary);color:var(--text-normal);",
            },
        }) as HTMLInputElement;

        const confirmBtn = contentEl.createEl("button", { text: "Confirm" });
        confirmBtn.addEventListener("click", () => {
            const brand = brandInput.value.trim();
            const count = parseInt(countInput.value) || this.vitamin.count;
            this.close();
            this.onConfirm(brand, count);
        });
    }

    onClose(): void { this.contentEl.empty(); }
}

// ─── Resupply ──────────────────────────────────────────────────────────────────

async function resupplyVitamin(
    app: App,
    vitamin: VitaminMeta,
    newBrand: string | null,
    newCount: number | null
): Promise<void> {
    const effectiveCount = newCount ?? vitamin.count;
    await app.vault.process(vitamin.file, (content: string) => {
        let result = content;
        result = updateFrontmatterField(result, "vitamin_on_hand",
            String(vitamin.onHand + effectiveCount));
        if (newBrand !== null && newBrand !== vitamin.brand) {
            result = updateFrontmatterField(result, "vitamin_brand", newBrand);
        }
        if (newCount !== null && newCount !== vitamin.count) {
            result = updateFrontmatterField(result, "vitamin_count", String(newCount));
        }
        return result;
    });
    new Notice(`✓ ${vitamin.name} restocked.`);
}

// ─── Frontmatter Update Helpers ───────────────────────────────────────────────

function updateFrontmatterField(content: string, key: string, value: string): string {
    // Replace existing field in frontmatter block
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return content;
    const fmBody = fmMatch[1];
    const regex = new RegExp(`^(${key}:).*$`, "m");
    let newFmBody: string;
    if (regex.test(fmBody)) {
        newFmBody = fmBody.replace(regex, `$1 ${value}`);
    } else {
        newFmBody = fmBody + `\n${key}: ${value}`;
    }
    return content.replace(/^---\n[\s\S]*?\n---/, `---\n${newFmBody}\n---`);
}

// ─── Main Render ──────────────────────────────────────────────────────────────

export function renderVitaminTrackerBlock(
    el: HTMLElement,
    app: App,
    settings: TrackerSettings
): void {
    const vitamins = loadActiveVitamins(app, settings);
    const today = todayYMD();

    el.empty();

    if (vitamins.length === 0) {
        el.createEl("p", {
            text: "No active vitamins found. Add vitamin notes to your vitamins folder.",
            attr: { style: "color:var(--text-muted);padding:12px 0;" },
        });
        return;
    }

    // Track checkbox state: eligible = not taken today
    const checkboxMap = new Map<string, { checked: boolean; input: HTMLInputElement }>();

    const wrapper = el.createEl("div", { cls: "tracker-pro-vitamins" });

    // ── Select All / Deselect All ────────────────────────────────────────────
    const headerRow = wrapper.createEl("div", {
        attr: { style: "display:flex;align-items:center;margin-bottom:10px;gap:10px;" },
    });

    const toggleBtn = headerRow.createEl("button", { text: "Select All" });

    const updateToggleBtn = () => {
        const eligible = vitamins.filter(v => !isTakenToday(v.lastTaken));
        const allChecked = eligible.length > 0 && eligible.every(v => {
            const entry = checkboxMap.get(v.name);
            return entry?.checked ?? false;
        });
        toggleBtn.textContent = allChecked ? "Deselect All" : "Select All";
    };

    // ── Vitamin rows ─────────────────────────────────────────────────────────
    for (const v of vitamins) {
        const taken = isTakenToday(v.lastTaken);
        const dose = doseDisplay(v.dose);
        let label = `${v.name} — ${dose} ${v.form}`;
        if (v.doseUnit) label += `, ${v.doseUnit}`;

        const row = wrapper.createEl("div", {
            attr: {
                style: "display:flex;align-items:center;gap:8px;padding:4px 0;" +
                    (taken ? "opacity:0.45;pointer-events:none;" : ""),
            },
        });

        const cb = row.createEl("input", { attr: { type: "checkbox" } }) as HTMLInputElement;
        cb.disabled = taken;
        cb.checked = !taken; // pre-check eligible, pre-uncheck already taken

        row.createEl("span", { text: label });

        checkboxMap.set(v.name, { checked: cb.checked, input: cb });

        cb.addEventListener("change", () => {
            const entry = checkboxMap.get(v.name);
            if (entry) entry.checked = cb.checked;
            updateToggleBtn();
        });
    }

    updateToggleBtn();

    toggleBtn.addEventListener("click", () => {
        const eligible = vitamins.filter(v => !isTakenToday(v.lastTaken));
        const allChecked = eligible.length > 0 && eligible.every(v => {
            return checkboxMap.get(v.name)?.checked ?? false;
        });
        const newState = !allChecked;
        for (const v of eligible) {
            const entry = checkboxMap.get(v.name);
            if (entry) {
                entry.checked = newState;
                entry.input.checked = newState;
            }
        }
        updateToggleBtn();
    });

    // ── Buttons ──────────────────────────────────────────────────────────────
    const btnRow = wrapper.createEl("div", {
        attr: { style: "display:flex;gap:10px;margin-top:14px;" },
    });

    const logBtn = btnRow.createEl("button", { text: "Log Vitamins" });
    logBtn.addEventListener("click", () => logVitamins(app, settings, vitamins, checkboxMap, today, el));

    const resupplyBtn = btnRow.createEl("button", { text: "Resupply" });
    resupplyBtn.addEventListener("click", () => {
        const allActive = loadActiveVitamins(app, settings);
        new VitaminPickModal(app, allActive, async (vitamin) => {
            new SameBottleModal(
                app,
                vitamin,
                async () => {
                    await resupplyVitamin(app, vitamin, null, null);
                },
                () => {
                    new NewBottleModal(app, vitamin, async (brand, count) => {
                        await resupplyVitamin(app, vitamin, brand, count);
                    }).open();
                }
            ).open();
        }).open();
    });
}

// ─── Log Action ───────────────────────────────────────────────────────────────

async function logVitamins(
    app: App,
    settings: TrackerSettings,
    vitamins: VitaminMeta[],
    checkboxMap: Map<string, { checked: boolean; input: HTMLInputElement }>,
    today: string,
    container: HTMLElement
): Promise<void> {
    const selected = vitamins.filter(v => checkboxMap.get(v.name)?.checked);

    if (selected.length === 0) {
        new Notice("No vitamins selected.");
        return;
    }

    // Update each selected vitamin note
    for (const v of selected) {
        const dose = parseDose(v.dose);
        await app.vault.process(v.file, (content: string) => {
            let result = content;
            const currentOnHand = Number(
                app.metadataCache.getFileCache(v.file)?.frontmatter?.vitamin_on_hand ?? v.onHand
            );
            const newOnHand = Math.max(0, currentOnHand - dose);
            result = updateFrontmatterField(result, "vitamin_on_hand", String(newOnHand));
            result = updateFrontmatterField(result, "vitamin_last_taken", today);
            return result;
        });
    }

    // Build food log vitamin entries
    const newMorning: ParsedVitaminEntry[] = [];
    const newEvening: ParsedVitaminEntry[] = [];

    for (const v of selected) {
        const singleDose = doseDisplay(v.dose);
        let line = `- ${v.name} — ${singleDose} ${v.form}`;
        if (v.doseUnit) line += `, ${v.doseUnit}`;

        const entry: ParsedVitaminEntry = { name: v.name, line };
        const time = v.time.toLowerCase();
        if (time === "morning" || time === "morning/evening") newMorning.push(entry);
        if (time === "evening" || time === "morning/evening") newEvening.push({ ...entry });
    }

    // Write to food log
    const logPath = resolveTodayLogPath(settings);
    let logFile = app.vault.getAbstractFileByPath(logPath);

    if (!(logFile instanceof TFile)) {
        await ensureFolders(app, logPath);
        await app.vault.create(logPath, buildBlankLogContent());
        logFile = app.vault.getAbstractFileByPath(logPath);
    }

    if (!(logFile instanceof TFile)) {
        new Notice("Could not create food log.");
        return;
    }

    const logContent = await app.vault.read(logFile as TFile);
    const { morning: existingMorning, evening: existingEvening } = parseVitaminsSection(logContent);

    const mergedMorning = mergeVitaminEntries(existingMorning, newMorning);
    const mergedEvening = mergeVitaminEntries(existingEvening, newEvening);

    const vitBlock = buildVitaminsSection(mergedMorning, mergedEvening);

    let newContent: string;
    if (/^## Vitamins/m.test(logContent)) {
        // Replace existing vitamins section
        newContent = logContent.replace(/^## Vitamins[\s\S]*?(?=\n##\s|\n---\s*$|$)/m, vitBlock);
    } else {
        // Append at end
        newContent = logContent.trimEnd() + "\n\n" + vitBlock;
    }

    await app.vault.modify(logFile as TFile, newContent);

    new Notice("✓ Vitamins logged.");

    // Re-render the block to update pre-deselect state
    renderVitaminTrackerBlock(container, app, settings);
}
