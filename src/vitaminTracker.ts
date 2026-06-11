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
    // Map of period name → "YYYY-MM-DD" or "". Scalar migration normalises to this.
    lastTaken: Record<string, string>;
}

interface ParsedVitaminEntry {
    name: string;
    line: string;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayYMD(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function dateToYMD(val: any): string {
    if (!val) return "";
    if (val instanceof Date) {
        const y = val.getFullYear();
        const m = String(val.getMonth() + 1).padStart(2, "0");
        const d = String(val.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }
    return String(val);
}

function isTakenTodayForPeriod(lastTaken: Record<string, string>, period: string): boolean {
    const raw = lastTaken[period];
    const dateStr = dateToYMD(raw);
    if (!dateStr) return false;
    const parts = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!parts) return false;
    const today = new Date();
    return (
        today.getFullYear() === parseInt(parts[1]) &&
        today.getMonth() + 1 === parseInt(parts[2]) &&
        today.getDate() === parseInt(parts[3])
    );
}

// ─── vitamin_last_taken normalisation ─────────────────────────────────────────

function normalizeLastTaken(raw: any, sections: string[]): Record<string, string> {
    if (!raw) return {};
    if (typeof raw === "string" || raw instanceof Date) {
        // Scalar format — set every section to this date (migration handles persistence)
        const dateStr = dateToYMD(raw);
        const map: Record<string, string> = {};
        for (const s of sections) map[s] = dateStr;
        return map;
    }
    if (typeof raw === "object") {
        const map: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw)) map[k] = dateToYMD(v);
        return map;
    }
    return {};
}

// Rewrites vitamin_last_taken in raw file content as a quoted multiline YAML map.
function rewriteLastTakenMap(content: string, sections: string[], lastTakenMap: Record<string, string>): string {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return content;
    const fmBody = fmMatch[1];

    const mapLines = sections.map(s => `  ${s}: "${lastTakenMap[s] ?? ""}"`).join("\n");
    const newField = `vitamin_last_taken:\n${mapLines}`;

    // Match scalar or multiline map (key line + any subsequent indented lines)
    const fieldRegex = /^vitamin_last_taken:[^\n]*(?:\n[ \t][^\n]*)*/m;
    const newFmBody = fieldRegex.test(fmBody)
        ? fmBody.replace(fieldRegex, newField)
        : fmBody + `\n${newField}`;

    return content.replace(/^---\n[\s\S]*?\n---/, `---\n${newFmBody}\n---`);
}

// Background migration: rewrite scalar vitamin_last_taken to per-period map.
// Fire-and-forget — metadataCache event triggers re-render when write completes.
async function migrateScalarLastTaken(app: App, v: VitaminMeta, scalarDate: string): Promise<void> {
    const sections = vitaminTimeSections(v.time);
    const migratedMap: Record<string, string> = {};
    for (const s of sections) migratedMap[s] = scalarDate;
    try {
        await app.vault.process(v.file, (content: string) => {
            const fm = app.metadataCache.getFileCache(v.file)?.frontmatter ?? {};
            // Guard: only migrate if still scalar
            if (typeof fm.vitamin_last_taken !== "string") return content;
            return rewriteLastTakenMap(content, sections, migratedMap);
        });
    } catch {
        // Non-destructive: if write fails we keep using the in-memory normalised map
    }
}

// ─── General helpers ──────────────────────────────────────────────────────────

function parseDose(dose: string): number {
    const str = String(dose ?? "1");
    if (str.includes("/")) {
        return str.split("/").reduce((sum, p) => sum + (parseFloat(p.trim()) || 0), 0);
    }
    return parseFloat(str) || 1;
}

function doseDisplay(dose: string): string {
    return String(dose ?? "1").includes("/") ? "1" : String(dose ?? "1");
}

function vitaminTimeSections(time: string): string[] {
    return String(time ?? "").split("/").map(s => s.trim()).filter(s => s.length > 0);
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
            try { await app.vault.createFolder(current); } catch { /* exists */ }
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
    const timeSections = vitaminTimeSections(String(fm.vitamin_time ?? ""));
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
        lastTaken: normalizeLastTaken(fm.vitamin_last_taken, timeSections),
    };
}

function loadActiveVitamins(app: App, settings: TrackerSettings): VitaminMeta[] {
    const folder = settings.vitaminsFolder.replace(/\/$/, "");
    const result: VitaminMeta[] = [];
    for (const file of app.vault.getMarkdownFiles()) {
        if (!file.path.startsWith(folder + "/")) continue;
        const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        if (fm.vitamin_active !== true) continue;
        result.push(getVitaminMeta(app, file));
    }
    result.sort((a, b) => a.name.localeCompare(b.name));

    // Background-migrate any scalar vitamin_last_taken to per-period map
    for (const v of result) {
        const raw = app.metadataCache.getFileCache(v.file)?.frontmatter?.vitamin_last_taken;
        if (typeof raw === "string" && raw) {
            migrateScalarLastTaken(app, v, raw).catch(() => {});
        }
    }

    return result;
}

// ─── Active sections ──────────────────────────────────────────────────────────

function getActiveSections(vitamins: VitaminMeta[], periods: string[]): string[] {
    const seen = new Set<string>();
    for (const v of vitamins) {
        for (const s of vitaminTimeSections(v.time)) seen.add(s);
    }
    return periods.filter(p => seen.has(p));
}

// ─── Food log merge / build ───────────────────────────────────────────────────

function parseVitaminsSection(content: string): Map<string, ParsedVitaminEntry[]> {
    const result = new Map<string, ParsedVitaminEntry[]>();
    const vitSection = content.match(/## Vitamins\s*([\s\S]*?)(?=\n##\s|\n---\s*$|$)/);
    if (!vitSection) return result;

    let currentSection = "";
    for (const rawLine of vitSection[1].split("\n")) {
        const line = rawLine.trimEnd();
        const h3 = line.match(/^###\s+(.+)/);
        if (h3) {
            currentSection = h3[1].trim();
            if (!result.has(currentSection)) result.set(currentSection, []);
            continue;
        }
        if (/^##\s/.test(line)) break;
        if (!line.startsWith("- ") || !currentSection) continue;
        const nameMatch = line.match(/^- (.+?)(?:\s+—\s+|\s+-\s+)/);
        if (!nameMatch) continue;
        const arr = result.get(currentSection) ?? [];
        arr.push({ name: nameMatch[1], line });
        result.set(currentSection, arr);
    }
    return result;
}

function replaceVitaminsBlock(content: string, newBlock: string): string {
    const startIndex = content.search(/^## Vitamins/m);
    if (startIndex === -1) {
        return content.trimEnd() + "\n\n" + newBlock;
    }

    const afterBlock = content.slice(startIndex + "## Vitamins".length);
    const nextSectionMatch = afterBlock.search(/\n## /);

    const before  = content.slice(0, startIndex).trimEnd() + "\n\n";
    const after    = nextSectionMatch === -1 ? "" : afterBlock.slice(nextSectionMatch);
    const trailing = after.length > 0 ? "\n" + after.trimStart() : "";

    return before + newBlock + trailing;
}

function buildVitaminsSection(sectionMap: Map<string, ParsedVitaminEntry[]>, periods: string[]): string {
    const orderedSections = [
        ...periods.filter(p => (sectionMap.get(p)?.length ?? 0) > 0),
        ...[...sectionMap.keys()].filter(k => !periods.includes(k) && (sectionMap.get(k)?.length ?? 0) > 0),
    ];
    if (orderedSections.length === 0) return "";

    let block = "## Vitamins\n\n";
    for (const section of orderedSections) {
        const entries = sectionMap.get(section) ?? [];
        if (entries.length === 0) continue;
        block += `### ${section}\n`;
        for (const e of entries) block += e.line + "\n";
        block += "\n";
    }
    return block.trimEnd() + "\n";
}

function mergeVitaminEntries(existing: ParsedVitaminEntry[], incoming: ParsedVitaminEntry[]): ParsedVitaminEntry[] {
    const seen = new Set(existing.map(e => e.name));
    const merged = [...existing];
    for (const e of incoming) {
        if (!seen.has(e.name)) { seen.add(e.name); merged.push(e); }
    }
    return merged;
}

// ─── Frontmatter helpers ──────────────────────────────────────────────────────

function updateFrontmatterField(content: string, key: string, value: string): string {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return content;
    const fmBody = fmMatch[1];
    const regex = new RegExp(`^(${key}:).*$`, "m");
    const newFmBody = regex.test(fmBody)
        ? fmBody.replace(regex, `$1 ${value}`)
        : fmBody + `\n${key}: ${value}`;
    return content.replace(/^---\n[\s\S]*?\n---/, `---\n${newFmBody}\n---`);
}

// ─── Modals ───────────────────────────────────────────────────────────────────

class VitaminPickModal extends FuzzySuggestModal<VitaminMeta> {
    constructor(app: App, private vitamins: VitaminMeta[], private onChoose: (v: VitaminMeta) => void) {
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
    ) { super(app); }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: `Restocking ${this.vitamin.name}` });
        contentEl.createEl("p", {
            text: `Is this the same bottle size as before? Current: ${this.vitamin.count} · Brand: ${this.vitamin.brand}`,
            attr: { style: "color:var(--text-muted);margin-bottom:16px;" },
        });
        const row = contentEl.createEl("div", { attr: { style: "display:flex;gap:10px;" } });
        row.createEl("button", { text: "Same" }).addEventListener("click", () => { this.close(); this.onSame(); });
        row.createEl("button", { text: "Different" }).addEventListener("click", () => { this.close(); this.onDifferent(); });
    }
    onClose(): void { this.contentEl.empty(); }
}

class NewBottleModal extends Modal {
    constructor(app: App, private vitamin: VitaminMeta, private onConfirm: (brand: string, count: number) => void) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: `New bottle details — ${this.vitamin.name}` });

        const inputStyle = "display:block;width:100%;padding:8px 10px;" +
            "border:1px solid var(--background-modifier-border);" +
            "border-radius:6px;background:var(--background-primary);color:var(--text-normal);";

        contentEl.createEl("label", { text: "Brand", attr: { style: "font-size:0.9em;color:var(--text-muted);" } });
        const brandInput = contentEl.createEl("input", {
            attr: { type: "text", value: this.vitamin.brand, style: inputStyle + "margin:4px 0 12px;" },
        }) as HTMLInputElement;

        contentEl.createEl("label", { text: "Quantity", attr: { style: "font-size:0.9em;color:var(--text-muted);" } });
        const countInput = contentEl.createEl("input", {
            attr: { type: "number", min: "1", value: String(this.vitamin.count), style: inputStyle + "margin:4px 0 16px;" },
        }) as HTMLInputElement;

        contentEl.createEl("button", { text: "Confirm" }).addEventListener("click", () => {
            this.close();
            this.onConfirm(brandInput.value.trim(), parseInt(countInput.value) || this.vitamin.count);
        });
    }
    onClose(): void { this.contentEl.empty(); }
}

// ─── Resupply ─────────────────────────────────────────────────────────────────

async function resupplyVitamin(app: App, vitamin: VitaminMeta, newBrand: string | null, newCount: number | null): Promise<void> {
    const effectiveCount = newCount ?? vitamin.count;
    await app.vault.process(vitamin.file, (content: string) => {
        let result = updateFrontmatterField(content, "vitamin_on_hand", String(vitamin.onHand + effectiveCount));
        if (newBrand !== null && newBrand !== vitamin.brand)
            result = updateFrontmatterField(result, "vitamin_brand", newBrand);
        if (newCount !== null && newCount !== vitamin.count)
            result = updateFrontmatterField(result, "vitamin_count", String(newCount));
        return result;
    });
    new Notice(`✓ ${vitamin.name} restocked.`);
}

// ─── Main Render ──────────────────────────────────────────────────────────────

export function renderVitaminTrackerBlock(el: HTMLElement, app: App, settings: TrackerSettings): void {
    const vitamins = loadActiveVitamins(app, settings);
    const periods  = settings.vitaminPeriods?.length ? settings.vitaminPeriods : ["Morning", "Evening"];
    const today    = todayYMD();

    el.empty();

    if (vitamins.length === 0) {
        el.createEl("p", {
            text: "No active vitamins found. Add vitamin notes to your vitamins folder.",
            attr: { style: "color:var(--text-muted);padding:12px 0;" },
        });
        return;
    }

    const activeSections = getActiveSections(vitamins, periods);

    // checkboxMap key: "${vitaminName}::${section}" — independent per section
    const checkboxMap = new Map<string, { checked: boolean; input: HTMLInputElement }>();

    const wrapper = el.createEl("div", { cls: "tracker-pro-vitamins" });

    // ── Select All / Deselect All ────────────────────────────────────────────
    const headerRow = wrapper.createEl("div", {
        attr: { style: "display:flex;align-items:center;margin-bottom:10px;gap:10px;" },
    });
    const toggleBtn = headerRow.createEl("button", { text: "Select All" });

    const updateToggleBtn = () => {
        const eligibleKeys = [...checkboxMap.entries()].filter(([, e]) => !e.input.disabled).map(([k]) => k);
        const allChecked = eligibleKeys.length > 0 && eligibleKeys.every(k => checkboxMap.get(k)?.checked);
        toggleBtn.textContent = allChecked ? "Deselect All" : "Select All";
    };

    // ── Section groups ────────────────────────────────────────────────────────
    for (const section of activeSections) {
        wrapper.createEl("h4", {
            text: section,
            attr: { style: "margin:12px 0 6px;font-size:0.95em;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;" },
        });

        for (const v of vitamins.filter(x => vitaminTimeSections(x.time).includes(section))) {
            // Pre-deselect based on this specific period's last-taken date
            const taken = isTakenTodayForPeriod(v.lastTaken, section);
            const dose  = doseDisplay(v.dose);

            const row = wrapper.createEl("div", {
                attr: {
                    style: "display:flex;align-items:center;gap:8px;padding:4px 0;" +
                        (taken ? "opacity:0.45;pointer-events:none;" : ""),
                },
            });

            const cb = row.createEl("input", { attr: { type: "checkbox" } }) as HTMLInputElement;
            cb.disabled = taken;
            cb.checked  = !taken;

            const linkPath = v.file.path.replace(/\.md$/, "");
            const nameLink = row.createEl("a", { cls: "internal-link", text: v.name });
            nameLink.setAttribute("href", linkPath);
            nameLink.setAttribute("data-href", linkPath);

            let doseInfo = ` - ${dose} ${v.form}`;
            if (v.doseUnit) doseInfo += `, ${v.doseUnit}`;
            row.createEl("span", { text: doseInfo });

            const key = `${v.name}::${section}`;
            checkboxMap.set(key, { checked: cb.checked, input: cb });
            cb.addEventListener("change", () => {
                const entry = checkboxMap.get(key);
                if (entry) entry.checked = cb.checked;
                updateToggleBtn();
            });
        }
    }

    updateToggleBtn();

    toggleBtn.addEventListener("click", () => {
        const eligibleKeys = [...checkboxMap.entries()].filter(([, e]) => !e.input.disabled).map(([k]) => k);
        const allChecked = eligibleKeys.length > 0 && eligibleKeys.every(k => checkboxMap.get(k)?.checked);
        const newState = !allChecked;
        for (const key of eligibleKeys) {
            const entry = checkboxMap.get(key);
            if (entry) { entry.checked = newState; entry.input.checked = newState; }
        }
        updateToggleBtn();
    });

    // ── Buttons ───────────────────────────────────────────────────────────────
    const btnRow = wrapper.createEl("div", { attr: { style: "display:flex;gap:10px;margin-top:14px;" } });

    btnRow.createEl("button", { text: "Log Vitamins" }).addEventListener("click", () =>
        logVitamins(app, settings, vitamins, checkboxMap, today, el, periods)
    );

    btnRow.createEl("button", { text: "Resupply" }).addEventListener("click", () => {
        new VitaminPickModal(app, loadActiveVitamins(app, settings), (vitamin) => {
            new SameBottleModal(app, vitamin,
                async () => resupplyVitamin(app, vitamin, null, null),
                () => new NewBottleModal(app, vitamin, async (brand, count) =>
                    resupplyVitamin(app, vitamin, brand, count)
                ).open()
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
    container: HTMLElement,
    periods: string[]
): Promise<void> {
    // Build map: vitaminName → sections being logged
    const vitaminSectionsMap = new Map<string, string[]>();
    for (const [key, entry] of checkboxMap.entries()) {
        if (!entry.checked) continue;
        const sepIdx  = key.indexOf("::");
        const name    = key.slice(0, sepIdx);
        const section = key.slice(sepIdx + 2);
        const arr = vitaminSectionsMap.get(name) ?? [];
        arr.push(section);
        vitaminSectionsMap.set(name, arr);
    }

    if (vitaminSectionsMap.size === 0) {
        new Notice("No vitamins selected.");
        return;
    }

    // Update each vitamin note once
    for (const [name, loggedSections] of vitaminSectionsMap.entries()) {
        const v = vitamins.find(x => x.name === name);
        if (!v) continue;
        const dose     = parseDose(v.dose);
        const sections = vitaminTimeSections(v.time);

        await app.vault.process(v.file, (content: string) => {
            const fm = app.metadataCache.getFileCache(v.file)?.frontmatter ?? {};

            // Build updated lastTaken map: start from current, set logged sections to today
            const currentMap = normalizeLastTaken(fm.vitamin_last_taken, sections);
            for (const section of loggedSections) currentMap[section] = today;
            // Ensure all vitamin sections have an entry
            for (const s of sections) { if (!(s in currentMap)) currentMap[s] = ""; }

            // Decrement on_hand
            const currentOnHand = Number(fm.vitamin_on_hand ?? v.onHand);
            let result = updateFrontmatterField(content, "vitamin_on_hand",
                String(Math.max(0, currentOnHand - dose)));

            // Write lastTaken as per-period map
            result = rewriteLastTakenMap(result, sections, currentMap);
            return result;
        });
    }

    // Build food log section map
    const newSectionMap = new Map<string, ParsedVitaminEntry[]>();
    for (const [name, sections] of vitaminSectionsMap.entries()) {
        const v = vitamins.find(x => x.name === name);
        if (!v) continue;
        const dose = doseDisplay(v.dose);
        let line = `- ${v.name} - ${dose} ${v.form}`;
        if (v.doseUnit) line += `, ${v.doseUnit}`;

        for (const section of sections) {
            const arr = newSectionMap.get(section) ?? [];
            arr.push({ name: v.name, line });
            newSectionMap.set(section, arr);
        }
    }

    // Resolve food log, create if missing
    const logPath = resolveTodayLogPath(settings);
    let logFile   = app.vault.getAbstractFileByPath(logPath);

    if (!(logFile instanceof TFile)) {
        await ensureFolders(app, logPath);
        await app.vault.create(logPath, buildBlankLogContent());
        logFile = app.vault.getAbstractFileByPath(logPath);
    }
    if (!(logFile instanceof TFile)) { new Notice("Could not create food log."); return; }

    const logContent = await app.vault.read(logFile as TFile);
    const existingSectionMap = parseVitaminsSection(logContent);

    const mergedSectionMap = new Map<string, ParsedVitaminEntry[]>();
    for (const section of new Set([...existingSectionMap.keys(), ...newSectionMap.keys()])) {
        mergedSectionMap.set(section, mergeVitaminEntries(
            existingSectionMap.get(section) ?? [],
            newSectionMap.get(section) ?? []
        ));
    }

    const vitBlock = buildVitaminsSection(mergedSectionMap, periods);
    const newContent = replaceVitaminsBlock(logContent, vitBlock);

    await app.vault.modify(logFile as TFile, newContent);
    new Notice("✓ Vitamins logged.");
    renderVitaminTrackerBlock(container, app, settings);
}
