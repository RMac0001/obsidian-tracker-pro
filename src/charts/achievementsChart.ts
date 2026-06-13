import { App, TFile } from "obsidian";
import { TrackerSettings } from "../settings";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WeightEntry {
    date: Date;
    weight: number;
}

interface FoodLogEntry {
    date: Date;
    cal: number;
    carbs: number;
    fat: number;
    protein: number;
}

interface Badge {
    label: string;
    unlocked: boolean;
    earnedDate: Date | null;
    hint: string;
}

interface BadgeCategory {
    name: string;
    icon: string;
    badges: Badge[];
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

function dateToKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function parseLocalDate(s: string): Date | null {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
}

function getFileDate(app: App, file: TFile): Date | null {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const cd = fm.creation_date;
    if (cd) {
        const s = cd instanceof Date ? dateToKey(cd) : String(cd);
        const d = parseLocalDate(s);
        if (d) return d;
    }
    const m = file.basename.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    return null;
}

function formatDate(d: Date): string {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Stat Helpers ─────────────────────────────────────────────────────────────

function consecutiveStreak(sortedDates: Date[]): number {
    if (sortedDates.length === 0) return 0;
    let maxStreak = 1;
    let cur = 1;
    for (let i = 1; i < sortedDates.length; i++) {
        const diffDays = Math.round((sortedDates[i].getTime() - sortedDates[i - 1].getTime()) / 86400000);
        if (diffDays === 1) {
            cur++;
            if (cur > maxStreak) maxStreak = cur;
        } else {
            cur = 1;
        }
    }
    return maxStreak;
}

function findStreakEarnedDate(sortedDates: Date[], tier: number): Date | null {
    let i = 0;
    while (i < sortedDates.length) {
        let runLen = 1;
        let j = i + 1;
        while (j < sortedDates.length) {
            const diff = Math.round((sortedDates[j].getTime() - sortedDates[j - 1].getTime()) / 86400000);
            if (diff === 1) { runLen++; j++; } else break;
        }
        if (runLen >= tier) return sortedDates[i + tier - 1];
        i = j;
    }
    return null;
}

function macroPercent(grams: number, calsPerGram: number, totalCal: number): number {
    if (totalCal === 0) return 0;
    return (grams * calsPerGram / totalCal) * 100;
}

// ─── Data Collection ──────────────────────────────────────────────────────────

function collectWeightData(app: App, settings: TrackerSettings): WeightEntry[] {
    const folder = settings.achievementsDailyNotesFolder.replace(/\/$/, "");
    const result: WeightEntry[] = [];
    for (const file of app.vault.getMarkdownFiles()) {
        if (!file.path.startsWith(folder + "/")) continue;
        const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        const weight = Number(fm.weight);
        if (!weight || isNaN(weight)) continue;
        const date = getFileDate(app, file);
        if (!date) continue;
        result.push({ date, weight });
    }
    result.sort((a, b) => a.date.getTime() - b.date.getTime());
    return result;
}

function collectFoodLogData(app: App, settings: TrackerSettings): FoodLogEntry[] {
    const folder = settings.achievementsFoodLogFolder.replace(/\/$/, "");
    const result: FoodLogEntry[] = [];
    for (const file of app.vault.getMarkdownFiles()) {
        if (!file.path.startsWith(folder + "/")) continue;
        const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        if (fm.cal_total === undefined || fm.cal_total === null) continue;
        const date = getFileDate(app, file);
        if (!date) continue;
        result.push({
            date,
            cal:     Number(fm.cal_total)    || 0,
            carbs:   Number(fm.carbs_total)  || 0,
            fat:     Number(fm.fat_total)    || 0,
            protein: Number(fm.protein_total) || 0,
        });
    }
    result.sort((a, b) => a.date.getTime() - b.date.getTime());
    return result;
}

function collectExerciseDates(app: App, settings: TrackerSettings): Set<string> {
    const folder = settings.achievementsExerciseFolder.replace(/\/$/, "");
    const result = new Set<string>();
    for (const file of app.vault.getMarkdownFiles()) {
        if (!file.path.startsWith(folder + "/")) continue;
        const date = getFileDate(app, file);
        if (date) result.add(dateToKey(date));
    }
    return result;
}

function collectResistanceWins(app: App, settings: TrackerSettings): number {
    const folder = settings.achievementsWnFolder.replace(/\/$/, "");
    let total = 0;
    for (const file of app.vault.getMarkdownFiles()) {
        if (!file.path.startsWith(folder + "/")) continue;
        const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        total += Math.max(0, Math.round(Number(fm.resistance_wins) || 0));
    }
    return total;
}

// ─── Badge Builders ───────────────────────────────────────────────────────────

function buildWeightBadges(weightData: WeightEntry[], settings: TrackerSettings): Badge[] {
    const { achievementsStartWeight: start, achievementsGoalWeight: goal } = settings;
    const thresholds: number[] = [];
    let t = start - 20;
    while (t >= goal) {
        thresholds.push(Math.round(t));
        t -= 20;
    }
    return thresholds.map(threshold => {
        const hit = weightData.find(e => e.weight <= threshold);
        return {
            label: `${threshold} lbs`,
            unlocked: !!hit,
            earnedDate: hit ? hit.date : null,
            hint: `Reach ${threshold} lbs`,
        };
    });
}

function buildStreakBadges(
    sortedDates: Date[],
    tiers: number[],
    labelFn: (t: number) => string,
    hintFn: (t: number) => string
): Badge[] {
    const longest = consecutiveStreak(sortedDates);
    return tiers.map(tier => {
        const unlocked = longest >= tier;
        return {
            label: labelFn(tier),
            unlocked,
            earnedDate: unlocked ? findStreakEarnedDate(sortedDates, tier) : null,
            hint: hintFn(tier),
        };
    });
}

function buildCountBadges(
    qualifyingDays: Date[],
    tiers: number[],
    labelFn: (t: number) => string,
    hintFn: (t: number) => string
): Badge[] {
    return tiers.map(tier => ({
        label: labelFn(tier),
        unlocked: qualifyingDays.length >= tier,
        earnedDate: qualifyingDays.length >= tier ? qualifyingDays[tier - 1] : null,
        hint: hintFn(tier),
    }));
}

function buildResistanceBadges(total: number): Badge[] {
    return [1, 5, 10, 25, 50].map(tier => ({
        label: `${tier} Resistance Win${tier > 1 ? "s" : ""}`,
        unlocked: total >= tier,
        earnedDate: null,
        hint: `${tier} win${tier > 1 ? "s" : ""}`,
    }));
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderCategory(container: HTMLElement, category: BadgeCategory): void {
    const unlocked = category.badges.filter(b => b.unlocked).length;
    const catEl = container.createEl("div", { cls: "tracker-pro-achievements-category" });

    const headerEl = catEl.createEl("div", { cls: "tracker-pro-achievements-category-header" });
    headerEl.createEl("h3", { text: category.name });
    headerEl.createEl("span", {
        text: `${unlocked} of ${category.badges.length} unlocked`,
        cls: "tracker-pro-achievements-category-count",
    });

    const grid = catEl.createEl("div", { cls: "tracker-pro-achievements-grid" });
    for (const badge of category.badges) {
        const badgeEl = grid.createEl("div", { cls: "tracker-pro-achievement-badge" });
        badgeEl.createEl("div", {
            cls: `tracker-pro-achievement-icon ${badge.unlocked ? "unlocked" : "locked"}`,
            text: badge.unlocked ? category.icon : "🔒",
        });
        badgeEl.createEl("div", { cls: "tracker-pro-achievement-label", text: badge.label });
        const dateText = badge.unlocked
            ? (badge.earnedDate ? formatDate(badge.earnedDate) : "Earned")
            : badge.hint;
        badgeEl.createEl("div", { cls: "tracker-pro-achievement-date", text: dateText });
    }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function renderAchievementsBlock(el: HTMLElement, app: App, settings: TrackerSettings): void {
    const weightData          = collectWeightData(app, settings);
    const foodLogData         = collectFoodLogData(app, settings);
    const exerciseDateSet     = collectExerciseDates(app, settings);
    const totalResistanceWins = collectResistanceWins(app, settings);

    // Deduplicate food log entries by date (first per day; data already sorted ascending)
    const uniqueFoodLogMap = new Map<string, FoodLogEntry>();
    for (const e of foodLogData) {
        const key = dateToKey(e.date);
        if (!uniqueFoodLogMap.has(key)) uniqueFoodLogMap.set(key, e);
    }
    const uniqueFoodLog = [...uniqueFoodLogMap.values()];

    // Sorted unique food log dates for streak computation
    const foodLogDates = uniqueFoodLog.map(e => e.date);

    // Sorted unique exercise date objects
    const sortedExerciseDates = [...exerciseDateSet]
        .sort()
        .map(s => { const m = s.match(/(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; })
        .filter((d): d is Date => d !== null);

    // Calorie qualifying days (sorted, deduped)
    const calorieQualDays = uniqueFoodLog
        .filter(e => e.cal <= settings.achievementsCalorieGoal)
        .map(e => e.date);

    // Macro balance qualifying days
    const macroQualDays = uniqueFoodLog
        .filter(e => {
            if (e.cal <= 0) return false;
            const tol = settings.achievementsMacroTolerance;
            return (
                Math.abs(macroPercent(e.protein, 4, e.cal) - settings.achievementsProteinPct) <= tol &&
                Math.abs(macroPercent(e.fat, 9, e.cal) - settings.achievementsFatPct) <= tol &&
                Math.abs(macroPercent(e.carbs, 4, e.cal) - settings.achievementsCarbPct) <= tol
            );
        })
        .map(e => e.date);

    const categories: BadgeCategory[] = [
        {
            name: "Weight Milestones",
            icon: "⚖️",
            badges: buildWeightBadges(weightData, settings),
        },
        {
            name: "Tracked Day Streaks",
            icon: "📋",
            badges: buildStreakBadges(foodLogDates, [3, 7, 14, 30, 60, 90], t => `${t}-Day Tracking Streak`, t => `${t}-day streak`),
        },
        {
            name: "Exercise Streaks",
            icon: "🚴",
            badges: buildStreakBadges(sortedExerciseDates, [3, 7, 14, 21, 30], t => `${t}-Day Exercise Streak`, t => `${t}-day streak`),
        },
        {
            name: "Calorie Goal",
            icon: "🎯",
            badges: buildCountBadges(calorieQualDays, [7, 14, 30, 60, 90], t => `${t} Days Under Calorie Goal`, t => `${t} days`),
        },
        {
            name: "Macro Balance",
            icon: "🥗",
            badges: buildCountBadges(macroQualDays, [7, 14, 30, 60, 90], t => `${t} Days Macro Balanced`, t => `${t} days`),
        },
        {
            name: "Resistance Wins",
            icon: "💪",
            badges: buildResistanceBadges(totalResistanceWins),
        },
    ];

    el.empty();
    const wrapper = el.createEl("div", { cls: "tracker-pro-achievements" });
    wrapper.createEl("p", {
        text: `Macro balance target: ${settings.achievementsProteinPct}% protein / ${settings.achievementsFatPct}% fat / ${settings.achievementsCarbPct}% carbs  ±${settings.achievementsMacroTolerance}%`,
        attr: { style: "font-size: 0.8em; color: var(--text-muted); margin-bottom: 16px;" },
    });

    for (const category of categories) {
        if (category.badges.length === 0) continue;
        renderCategory(wrapper, category);
    }
}
