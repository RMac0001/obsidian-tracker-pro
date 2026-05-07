import { App, Modal, TFile, normalizePath } from "obsidian";
import { TrackerSettings } from "./settings";
import { TrackerConfig } from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BookData {
    title: string;
    author: string;
    series?: string;
    seriesNumber?: number;
    readComplete: string; // YYYY-MM-DD
    filePath: string;
}

type GoalMap = Record<string | number, number>;

type YearControl =
    | { type: "button"; onClick: () => void }
    | { type: "select"; years: number[]; onChange: (year: number) => void };

// ─── Data Readers ─────────────────────────────────────────────────────────────

function readGoals(app: App, settings: TrackerSettings): GoalMap {
    let goalPath = settings.readingGoalFile;
    if (!goalPath.endsWith(".md")) goalPath += ".md";
    const path = normalizePath(goalPath);
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
        console.warn(`Tracker Pro: reading goal file not found: ${path}`);
        return {};
    }
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return {};

    const goals: GoalMap = {};
    for (const key of Object.keys(fm)) {
        const match = key.match(/^reading_goal_(\d{4})$/);
        if (match) {
            const num = typeof fm[key] === "number" ? fm[key] as number : parseInt(String(fm[key]));
            if (!isNaN(num)) goals[parseInt(match[1])] = num;
        }
    }
    return goals;
}

function readAllBooks(app: App, settings: TrackerSettings): Map<number, BookData[]> {
    const folder  = settings.bookNotesFolder.replace(/\/$/, "");
    const prefix  = settings.bookNotePrefix;
    const byYear  = new Map<number, BookData[]>();

    for (const f of app.vault.getMarkdownFiles()) {
        if (!f.path.startsWith(folder + "/") || !f.basename.startsWith(prefix)) continue;

        const fm           = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
        const readComplete = String(fm.read_complete ?? "");
        if (!readComplete.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

        const year = parseInt(readComplete.slice(0, 4));

        let title = String(fm.title ?? "").trim();
        if (!title) {
            title = f.basename.slice(prefix.length).replace(/-/g, " ").trim();
        }
        if (!title) {
            title = f.basename;
        }

        const book: BookData = {
            title,
            author:      String(fm.author ?? ""),
            readComplete,
            filePath:    f.path,
        };

        if (fm.series)        book.series       = String(fm.series);
        if (fm.series_number != null) book.seriesNumber = Number(fm.series_number);

        if (!byYear.has(year)) byYear.set(year, []);
        byYear.get(year)!.push(book);
    }

    for (const books of byYear.values()) {
        books.sort((a, b) => a.readComplete.localeCompare(b.readComplete));
    }

    return byYear;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAvailableYears(goals: GoalMap): number[] {
    const currentYear = new Date().getFullYear();
    const goalYears   = Object.keys(goals).map(Number).filter((y) => !isNaN(y));
    return Array.from(new Set([...goalYears, currentYear])).sort((a, b) => b - a);
}

function daysLeft(year: number): number {
    const today      = new Date();
    const endOfYear  = new Date(year, 11, 31);
    return Math.max(0, Math.floor((endOfYear.getTime() - today.getTime()) / 86_400_000));
}

// ─── Year Selector Modal ──────────────────────────────────────────────────────

export class YearSelectorModal extends Modal {
    constructor(
        app: App,
        private settings: TrackerSettings,
        private onSelect: (year: number) => void
    ) {
        super(app);
    }

    onOpen(): void {
        const goals = readGoals(this.app, this.settings);
        const years = getAvailableYears(goals);

        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: "Select Year" });

        const list = contentEl.createEl("div", { cls: "tracker-pro-rc-year-list" });
        for (const year of years) {
            const btn = list.createEl("button", {
                text: String(year),
                cls: "tracker-pro-rc-year-btn",
            });
            btn.onclick = () => {
                this.close();
                this.onSelect(year);
            };
        }
    }

    onClose(): void { this.contentEl.empty(); }
}

// ─── Reading Challenge Modal ──────────────────────────────────────────────────

export class ReadingChallengeModal extends Modal {
    constructor(
        app: App,
        private settings: TrackerSettings,
        private year: number
    ) {
        super(app);
        this.modalEl.addClass("tracker-pro-rc-modal");
    }

    onOpen(): void {
        const goals    = readGoals(this.app, this.settings);
        const allBooks = readAllBooks(this.app, this.settings);
        const books    = allBooks.get(this.year) ?? [];
        const goal     = (goals[this.year] as number) ?? null;

        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("tracker-pro-reading-challenge");

        renderChallenge(contentEl, this.app, this.year, books, goal, {
            type: "button",
            onClick: () => {
                this.close();
                new YearSelectorModal(this.app, this.settings, (y) => {
                    new ReadingChallengeModal(this.app, this.settings, y).open();
                }).open();
            },
        });
    }

    onClose(): void { this.contentEl.empty(); }
}

// ─── Motivational Text ────────────────────────────────────────────────────────

function motivationalText(booksRead: number, goal: number | null, year: number): string {
    const currentYear = new Date().getFullYear();
    if (year < currentYear) {
        if (goal == null) return `${booksRead} book${booksRead !== 1 ? "s" : ""} read`;
        if (booksRead >= goal) return "Challenge complete! You met your goal.";
        return `You read ${booksRead} of ${goal} books.`;
    }
    if (year > currentYear) return goal != null ? `Goal: ${goal} book${goal !== 1 ? "s" : ""}` : "";
    if (goal == null) return "";

    const today      = new Date();
    const dayOfYear  = Math.floor((today.getTime() - new Date(year, 0, 1).getTime()) / 86_400_000) + 1;
    const daysInYear = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365;
    const behind     = Math.ceil(goal * (dayOfYear / daysInYear) - booksRead);

    if (behind <= 0) return "You're on track! Keep reading.";
    return `Press on! Read ${behind} book${behind !== 1 ? "s" : ""} to get back on track.`;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

function renderChallenge(
    el: HTMLElement,
    app: App,
    year: number,
    books: BookData[],
    goal: number | null,
    yearControl?: YearControl
): void {
    const currentYear = new Date().getFullYear();
    const booksRead   = books.length;
    const isPast      = year < currentYear;

    // ── Hero ──────────────────────────────────────────────────────────────────
    const hero = el.createEl("div", { cls: "tracker-pro-rc-hero" });

    // Left: colored badge tile
    const badge = hero.createEl("div", { cls: "tracker-pro-rc-badge" });
    badge.createEl("div", { text: String(year), cls: "tracker-pro-rc-badge-year" });
    badge.createEl("div", { text: "📖", cls: "tracker-pro-rc-badge-icon" });

    // Right: title + subtitle + change-year button
    const heroText = hero.createEl("div", { cls: "tracker-pro-rc-hero-text" });
    const heroTop  = heroText.createEl("div", { cls: "tracker-pro-rc-hero-top" });
    heroTop.createEl("span", { text: "Reading Challenge", cls: "tracker-pro-rc-title" });
    if (yearControl?.type === "button") {
        const changeBtn = heroTop.createEl("button", {
            text: "Change Year ▾",
            cls: "tracker-pro-rc-change-year",
        });
        changeBtn.onclick = yearControl.onClick;
    } else if (yearControl?.type === "select") {
        const select = heroTop.createEl("select", { cls: "tracker-pro-rc-year-select" });
        for (const y of yearControl.years) {
            const opt = select.createEl("option", { text: String(y) });
            opt.value = String(y);
            if (y === year) opt.selected = true;
        }
        select.addEventListener("change", () => yearControl.onChange(parseInt(select.value)));
    }

    const subtitle = motivationalText(booksRead, goal, year);
    if (subtitle) {
        heroText.createEl("div", { text: subtitle, cls: "tracker-pro-rc-subtitle" });
    }

    // ── Progress ──────────────────────────────────────────────────────────────
    const progress = el.createEl("div", { cls: "tracker-pro-rc-progress" });

    const countLine = goal != null
        ? `${booksRead} of ${goal} books read`
        : `${booksRead} book${booksRead !== 1 ? "s" : ""} read`;

    const remaining = daysLeft(year);
    const timeLine  = isPast
        ? "Completed"
        : `${remaining} day${remaining !== 1 ? "s" : ""} left`;

    progress.createEl("div", {
        text: `${countLine} | ${timeLine}`,
        cls: "tracker-pro-rc-count",
    });

    if (goal != null && goal > 0) {
        const pct    = Math.min(100, Math.round(booksRead / goal * 100));
        const barRow = progress.createEl("div", { cls: "tracker-pro-rc-bar-row" });
        const barWrap = barRow.createEl("div", { cls: "tracker-pro-rc-bar-wrap" });
        const barFill = barWrap.createEl("div", { cls: "tracker-pro-rc-bar-fill" });
        barFill.style.width = `${pct}%`;
        barRow.createEl("span", { text: `${pct}%`, cls: "tracker-pro-rc-pct" });
    }

    // ── Book List ─────────────────────────────────────────────────────────────
    el.createEl("div", { text: "Books Read", cls: "tracker-pro-rc-section-title" });
    el.createEl("hr", { cls: "tracker-pro-rc-divider" });

    if (books.length === 0) {
        el.createEl("div", { text: "No books read yet", cls: "tracker-pro-rc-empty" });
    } else {
        const list = el.createEl("ol", { cls: "tracker-pro-rc-book-list" });
        for (const book of books) {
            const item      = list.createEl("li", { cls: "tracker-pro-rc-book-item" });
            const titleLine = item.createEl("div", { cls: "tracker-pro-rc-book-title-line" });

            const titleLink = titleLine.createEl("a", {
                text: book.title,
                cls: "tracker-pro-rc-book-title internal-link",
            });
            titleLink.setAttribute("data-href", book.filePath);
            titleLink.onclick = (e) => {
                e.preventDefault();
                app.workspace.openLinkText(book.filePath, "", false);
            };

            if (book.author) {
                titleLine.createEl("span", {
                    text: ` · ${book.author}`,
                    cls: "tracker-pro-rc-book-author",
                });
            }

            if (book.series) {
                const seriesText = book.seriesNumber != null
                    ? `${book.series} #${book.seriesNumber}`
                    : book.series;
                item.createEl("div", {
                    text: seriesText,
                    cls: "tracker-pro-rc-book-series",
                });
            }
        }
    }

}

// ─── Inline Block Renderer ────────────────────────────────────────────────────

export function renderReadingChallengeBlock(
    el: HTMLElement,
    app: App,
    settings: TrackerSettings,
    config: TrackerConfig
): void {
    const goals    = readGoals(app, settings);
    const allBooks = readAllBooks(app, settings);
    const years    = getAvailableYears(goals);

    const render = (year: number) => {
        el.empty();
        el.addClass("tracker-pro-reading-challenge");
        const books = allBooks.get(year) ?? [];
        const goal  = (goals[year] as number) ?? null;
        renderChallenge(el, app, year, books, goal,
            { type: "select", years, onChange: render }
        );
    };

    render(config.year ?? new Date().getFullYear());
}

// ─── Command Entry Point ──────────────────────────────────────────────────────

export function openReadingChallenge(app: App, settings: TrackerSettings): void {
    new YearSelectorModal(app, settings, (year) => {
        new ReadingChallengeModal(app, settings, year).open();
    }).open();
}
