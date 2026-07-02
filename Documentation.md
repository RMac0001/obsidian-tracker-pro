## Full Reference

Tracker Pro is an Obsidian plugin that reads YAML frontmatter from your notes
and renders them as charts and summaries. It requires no Dataview dependency.

---

## Table of Contents

1. [Installation](#installation)
2. [Global Settings](#global-settings)
3. [Meal Logger](#meal-logger)
   - [Vault Structure](#vault-structure)
   - [Daily Log Frontmatter](#daily-log-frontmatter)
   - [Log meal](#log-meal)
   - [Clear meal](#clear-meal)
   - [Edit meal log](#edit-meal-log)
   - [Calculate Recipe Nutrition](#calculate-recipe-nutrition)
   - [Recalculate Food Note Calories](#recalculate-food-note-calories)
4. [How It Works](#how-it-works)
5. [Core Parameters](#core-parameters)
   - [Data Source](#data-source)
   - [Date Handling](#date-handling)
   - [Date Selector](#dateselector)
   - [Properties](#properties)
   - [Aggregation](#aggregation)
   - [Visuals](#visuals)
6. [Chart Types](#chart-types)
   - [line](#line)
   - [bar](#bar)
   - [pie](#pie)
   - [donut](#donut)
   - [heatmap](#heatmap)
   - [calendar](#calendar)
   - [scatter](#scatter)
   - [radar](#radar)
   - [gauge](#gauge)
   - [candlestick](#candlestick)
   - [summary](#summary)
   - [table](#table)
   - [daily-table](#daily-table)
   - [bills](#bills)
7. [Reading Challenge](#reading-challenge)
8. [Advanced Features](#advanced-features)
   - [source: fileMeta](#source-filemeta)
   - [dateAggregation](#dateaggregation)
9. [Full Parameter Reference](#full-parameter-reference)

---

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the plugin release.
2. Create the folder `.obsidian/plugins/obsidian-tracker-pro/` inside your vault.
3. Drop the three files into that folder.
4. In Obsidian: **Settings → Community Plugins → Installed Plugins**, find
   **Tracker Pro** and enable it.

---

## Global Settings

Open **Settings → Tracker Pro** to configure defaults that apply to every block:

**Charts**

| Setting | Description |
|---|---|
| **Default folder location** | Folder scanned for notes when no `folder` is set in the block. Defaults to `/` (entire vault). |
| **Default date format** | Format used to parse dates in note filenames (e.g. `YYYY-MM-DD`). |
| **Default date property** | Frontmatter key to read dates from instead of the filename. Leave empty to keep using the filename. Can be overridden per block with `dateProperty`. |

**Meal Logger**

| Setting | Description |
|---|---|
| **Meal log folder** | Folder path for daily meal log notes. Supports `{{DATE:FORMAT}}` tokens (e.g. `Data/Food Logs/{{DATE:YYYY}}/{{DATE:YYYY-MM}}`). |
| **Meal log filename** | Filename template for daily log notes. Supports `{{DATE:FORMAT}}` tokens (e.g. `{{DATE:YYYY-MM-DD}}`). |
| **Food database folder** | Folder containing individual food notes (e.g. `Data/Food`). |
| **Recipes folder** | Folder containing recipe notes (e.g. `Data/Recipes`). |

**Bills**

| Setting | Description |
|---|---|
| **Bills master folder** | Folder containing master bill notes (default: `Data/Bills`). |
| **Bills payment folder template** | Folder template for monthly payment notes. Supports `{{DATE:FORMAT}}` tokens (default: `Data/Bills/Payments/BP-{{DATE:YYYY}}/BP-{{DATE:YYYY-MM}}`). |

**Reading Challenge**

| Setting | Description |
|---|---|
| **Book notes folder** | Folder containing your book review notes (default: `Data/Book Reviews`). |
| **Book note prefix** | Filename prefix that identifies book notes (default: `BR-`). Only notes whose basename starts with this prefix are counted. |
| **Reading goal file** | Path to the note holding your annual reading goals (default: `Data/Reading Goals.md`). |

---

## Meal Logger

The Meal Logger is a set of commands for logging and editing daily food and nutrition data. All commands are available from the command palette.

---

### Vault Structure

**Daily log notes** — one note per day at the path defined by your settings:

```
Data/Food Logs/2026/2026-05/2026-05-07.md
```

**Food database notes** — one note per food item in your `Food database folder`:

```yaml
food_name: Peanut Butter
serving_size: 2
serving_unit: oz
calories: 190
protein: 7
fat: 16
carbs: 8
```

The optional `common_serving_size` and `common_serving_unit` fields let you define a named "common" unit (e.g. one egg, one slice of bread) alongside the measured unit:

```yaml
food_name: Eggs
serving_size: 50
serving_unit: g
calories: 70
protein: 6
fat: 5
carbs: 0
common_serving_size: 1
common_serving_unit: egg
```

When both fields are present, the logging modal shows a dual-unit input (see [Log meal](#log-meal)).

**Recipe notes** — one note per recipe in your `Recipes folder`:

```yaml
recipe_name: Cup of Coffee
servings: 1
calories: 45
protein: 0
fat: 2
carbs: 5
```

---

### Daily Log Frontmatter

The plugin writes 20 nutrition fields automatically — totals for the full day plus a breakdown per meal:

```yaml
cal_total: 1580       protein_total: 95      fat_total: 62      carbs_total: 180
cal_breakfast: 380    protein_breakfast: 20  fat_breakfast: 14  carbs_breakfast: 42
cal_lunch: 620        protein_lunch: 38      fat_lunch: 24      carbs_lunch: 68
cal_dinner: 490       protein_dinner: 30     fat_dinner: 20     carbs_dinner: 58
cal_snacks: 90        protein_snacks: 7      fat_snacks: 4      carbs_snacks: 12
```

These fields are what `daily-table` and `table` chart blocks read.

---

### Log meal

Run **Tracker Pro: Log meal** from the command palette.

1. Pick a meal type — Breakfast, Lunch, Dinner, or Snacks
2. Search the food database or recipes by name
3. Enter the amount (see amount modal below)
4. Choose to add more items or finish

If today's log note doesn't exist it is created automatically. If it does exist, entries are appended to the correct meal section and frontmatter totals are updated.

**Remove last item** — while building a meal, a "Remove last item (Name)" option appears in the menu whenever the list isn't empty. Selecting it pops the last entry and loops back.

**Amount modal — standard food (no common serving):**

Enter the amount in the food's measured unit (e.g. oz, g, cup). The modal shows the serving size and calories per serving as a hint.

**Amount modal — food with `common_serving_size` / `common_serving_unit`:**

The modal shows two info lines — one for the measured serving, one for the common serving — each with its calorie count. A number input paired with a unit dropdown lets you enter either unit:

- Select the **common unit** (e.g. egg) to enter a count of whole items
- Select the **measured unit** (e.g. g) to enter a precise weight or volume

A **Total: X cal** line updates live as you type or switch units. The Add button is disabled until a valid positive amount is entered.

The log line records both units for readability:

```
- [[Eggs]] (2 eggs / 100 g) — 140 cal | 12g protein | 10g fat | 0g carbs
```

or, if you entered the measured unit:

```
- [[Eggs]] (100 g / 2 eggs) — 140 cal | 12g protein | 10g fat | 0g carbs
```

**Amount modal — recipe:**

Enter the number of servings. The modal shows calories per serving as a hint.

**Log line format:**

```
- [[Peanut Butter]] (2 oz) — 190 cal | 7g protein | 16g fat | 8g carbs
- [[Eggs]] (2 eggs / 100 g) — 140 cal | 12g protein | 10g fat | 0g carbs
- [[Recipe - Cup of Coffee]] (1 serving) — 45 cal | 0g protein | 2g fat | 5g carbs
```

---

### Clear meal

Run **Tracker Pro: Clear meal** from the command palette.

1. Pick a meal type
2. Confirm

Zeroes all 8 frontmatter fields for that meal, removes all bullet lines from that section, and recalculates the four `_total` fields.

---

### Edit meal log

Run **Tracker Pro: Edit meal log** from the command palette.

Opens the edit modal for today's log. If no log exists for today, a blank one is created automatically with zeroed frontmatter and all four meal sections.

**Switch date** — a button in the modal header opens a picker of the 30 most recent log files so you can edit any past log without closing the modal.

Four edit actions are always available:

| Action | Description |
|---|---|
| **Change quantity** | Pick a meal and item, adjust the amount — saves and recalculates |
| **Remove item** | Pick a meal and item to delete |
| **Add item to a meal** | Full food/recipe search; choose which meal to add to |
| **Add a meal block** | Pick the meal type first, then search for the item |

**Save and recalculate** — on save, nutrition values are re-pulled fresh from the source food/recipe notes (not re-summed from stored log values). A timestamped bullet is appended to a `## Notes` section at the bottom of the file:

```
- 2026-05-07 — Log recalculated
```

---

### Calculate Recipe Nutrition

Run **Tracker Pro: Calculate Recipe Nutrition** from the command palette with any recipe note open.

Reads the `# Ingredients` section of the active note, resolves each `[[wiki-link]]` to a food or recipe note in the vault, calculates total nutrition, and writes per-serving macros back to the note's frontmatter.

**Ingredient line format** — checklist items with an amount, optional unit, and a wiki-link:

```
- [ ] 16 oz [[Refried Beans]]
- [ ] 1 cup [[Sour Cream]]
- [ ] 1 cup shredded [[Cheddar Cheese]]
- [ ] 2 cups [[Salsa]], drained
- [ ] 1 cup [[Recipe - Guacamole]]
- [ ] 3 ripe [[Avocado|avocados]]
```

- The **amount** is the first number on the line (integers, decimals, and fractions like `1/2` are all supported)
- The **unit** is the word immediately after the amount (`oz`, `cup`, `tbsp`, etc.)
- The **food note** is the text inside `[[ ]]` — pipe aliases are stripped (`[[Avocado|avocados]]` → looks up `Avocado`)
- Lines with no wiki-link, and wiki-links that can't be resolved in the vault, are silently skipped

**Unit handling:**

| Situation | Behaviour |
|---|---|
| Ingredient unit matches `common_serving_unit` (food notes only) | `amount / common_serving_size × nutrition` |
| Ingredient unit matches `serving_unit` directly | `amount / serving_size × nutrition` |
| Both units are volume (tsp, tbsp, fl oz, cup, pint, quart, l, ml) | Converted to ml, then ratio applied |
| Both units are weight (g, kg, oz, lb/lbs) | Converted to g, then ratio applied |
| Volume vs weight | Skipped — "unit mismatch (volume vs weight)" |
| Named unit (jar, can, piece…) that doesn't match | Skipped — "unit not convertible" |

**Sub-recipes** — any wiki-link resolving to a file whose name starts with `Recipe -` is treated as a sub-recipe. The same unit matching applies using the recipe's `serving_size` and `serving_unit`. The recipe's `calories`, `carbs`, `fat`, `protein` values are already per-serving.

**Servings modal** — after totalling nutrition, a modal shows the suggested serving count (capped at 350 cal/serving, minimum 1). The number is editable and the cal/serving display updates live. Click **Confirm** to write values or **Cancel** to abort.

**Frontmatter written** (per serving, rounded to nearest integer):

```yaml
calories: 245
carbs: 18
fat: 14
protein: 9
servings: 6
```

**Skipped ingredients** — if any ingredients couldn't be resolved, a `## Notes` section is appended (or updated) at the bottom of the note:

```markdown
## Notes
**Skipped ingredients (not included in nutrition calculation):**
- taco seasoning — no food note found
- Mystery Sauce — unit mismatch (volume vs weight)
```

**Calorie calculation** — `calories` is always derived from macros using the Atwater factors (`carbs × 4 + fat × 9 + protein × 4`), applied to the already-rounded per-serving macro values. The modal preview and the written frontmatter field always show the same number.

---

### Recalculate Food Note Calories

Run **Tracker Pro: Recalculate Food Note Calories** from the command palette with any food note open.

Reads `carbs`, `fat`, and `protein` from the note's frontmatter, computes `calories` using the Atwater formula (`carbs × 4 + fat × 9 + protein × 4`), writes the result back to `calories`, and shows a notice with the before and after values:

```
Calories updated: 180 → 193
```

Useful for correcting existing food notes where the stored `calories` field doesn't match the macros. The command does nothing (with a descriptive notice) if the note has no frontmatter or if all three macro fields are 0 or missing.

---

## How It Works

Each Tracker Pro chart is a fenced code block with the language tag `tracker-pro`:

````
```tracker-pro
type: line
folder: Data/Daily
properties:
  - mood
dateRange: last-30-days
```
````

Tracker Pro:
1. Finds all `.md` files matching your `folder` / `file` / `files` setting.
2. Reads each file's frontmatter via Obsidian's metadata cache.
3. Extracts a date for each file (from frontmatter or filename).
4. Filters files to the requested date range.
5. Extracts the numeric value(s) for each `properties` entry.
6. Aggregates same-date values (if multiple notes share a date).
7. Renders the chart using Chart.js (canvas) or SVG.

---

## Core Parameters

### Data Source

At least one of `folder`, `file`, or `files` must be present.

```yaml
# Scan an entire folder (recursive)
folder: Data/Daily

# A single specific file
file: Data/Special Note

# A hand-picked list of files
files:
  - Data/NoteA
  - Data/NoteB
```

---

### Date Handling

**`dateProperty`** — frontmatter key to read the date from.

```yaml
dateProperty: creation_date
```

If omitted, Tracker Pro looks for common frontmatter keys (`date`, `created`,
`day`, `timestamp`) and then falls back to the filename pattern `YYYY-MM-DD`.

---

**`dateRange`** — preset shorthand for the date window.

| Value | Meaning |
|---|---|
| `today` | Today only |
| `last-N-days` | Last N calendar days (e.g. `last-7-days`, `last-30-days`) |
| `last-N-weeks` | Last N weeks |
| `last-N-months` | Last N months |
| `last-N-years` | Last N years |
| `this-week` | Sunday through today |
| `this-month` | 1st of month through today |
| `this-year` | Jan 1 through today |
| `last-week` | Previous full calendar week (Sunday → Saturday) |
| `last-month` | Previous full calendar month (1st → last day) |
| `last-year` | Full previous calendar year |
| `all` | Jan 1 2000 through today |

```yaml
dateRange: last-30-days
```

Alternatively, use explicit dates:

```yaml
startDate: 2025-01-01
endDate:   2025-03-31
```

---

### `dateSelector`

Add `dateSelector: true` to render an interactive date-range dropdown above the chart.

```yaml
dateSelector: true
```

Choosing a preset immediately re-renders the chart for that range. Choosing **Custom…** reveals two date pickers; updating either re-renders immediately. The selector stays in place across re-renders — only the chart is updated.

**Available presets in the dropdown:**

| Option | Equivalent `dateRange` |
|---|---|
| Today | `today` |
| This Week | `this-week` |
| This Month | `this-month` |
| This Year | `this-year` |
| Last Week | `last-week` |
| Last Month | `last-month` |
| Last Year | `last-year` |
| Last 7 Days | `last-7-days` |
| Last 30 Days | `last-30-days` |
| Last 90 Days | `last-90-days` |
| Last 6 Months | `last-6-months` |
| Last 12 Months | `last-12-months` |
| All Time | `all` |
| Custom… | uses `startDate` / `endDate` |

The initial selection reflects the `dateRange` set in the block (defaults to **Last 30 Days** if none is set).

---

### Properties

A list of frontmatter keys to chart. Each becomes one series.

```yaml
properties:
  - mood
  - energy
```

For **candlestick** charts, `properties` is a mapping instead:

```yaml
properties:
  open:   open_price
  high:   high_price
  low:    low_price
  close:  close_price
  volume: volume   # optional
```

For **summary**, **table**, **daily-table**, and **fileMeta** charts, `properties` is optional.

---

### Aggregation

**`aggregate`** — how to roll up multiple data points per time bucket.

| Value | Description |
|---|---|
| `daily` | One value per calendar day (default). Same-date values are summed. |
| `weekly` | Values grouped by week (Sunday start), averaged. |
| `monthly` | Values grouped by calendar month, averaged. |
| `cumulative` | Running total over time. |
| `moving-average` | Rolling average over the last `period` data points. |

```yaml
aggregate: weekly
```

**`period`** — window size for `moving-average` (default: `7`).

```yaml
aggregate: moving-average
period: 14
```

> **Note on same-date bucketing:** When multiple notes share the same date (common
> with exercise logs), Tracker Pro sums all their values before aggregating. This
> is the correct behaviour for properties like `sets` and `reps` where you want
> the daily total, not the last note's value.

---

**`missingValue`** — how to handle days with no data.

| Value | Description |
|---|---|
| `skip` | Gap in the line / bar missing (default). |
| `zero` | Missing days treated as 0. |
| `N` | Missing days treated as a specific number. |

```yaml
missingValue: zero
```

---

### Visuals

```yaml
title: My Chart Title
subtitle: A short subtitle
height: 350          # chart height in pixels (default: 300)
width: 100%          # CSS width (default: 100%)
showLegend: true     # show/hide legend (default: true)

colors:              # hex colors, one per series
  - "#4f86f7"
  - "#f76c6c"

colorScheme: green   # for heatmap and calendar: green | blue | red | orange | purple

xAxis:
  label: Date
yAxis:
  label: Score (1–10)
  min: 0
  max: 10
  unit: " kg"        # appended to tooltip values
```

---

## Chart Types

### `line`

Plots one or more numeric properties over time as connected lines.

**Good for:** trends, scores over time, any continuous data.

```yaml
type: line
folder: Data/Daily
dateRange: last-30-days
properties:
  - mood
  - energy
title: Mood & Energy
colors:
  - "#4f86f7"
  - "#43c59e"
yAxis:
  min: 0
  max: 10
  label: Score
showLegend: true
```

**Line-specific options:**

| Parameter       | Description                                                            |
| --------------- | ---------------------------------------------------------------------- |
| `aggregate`     | `daily` (default), `weekly`, `monthly`, `cumulative`, `moving-average` |
| `period`        | Window for `moving-average` (default: 7)                               |
| `missingValue`  | `skip` (gap), `zero`, or a number                                      |
| `yAxis.min/max` | Force Y axis bounds                                                    |
| `yAxis.unit`    | Suffix appended to tooltip (e.g. `" kg"`)                              |

---

### `bar`

Same data as `line` but rendered as vertical bars.

**Good for:** counts, weekly/monthly totals, anything where the column height
is more readable than a line.

```yaml
type: bar
folder: Data/Daily
dateRange: last-30-days
properties:
  - sleep
title: Sleep Duration
colors:
  - "#9b59b6"
yAxis:
  label: Hours
  min: 0
aggregate: daily
showLegend: false
```

**Bar-specific options:** identical to `line`. Multiple `properties` entries
render as grouped bars side by side.

---

### `pie`

Shows the **frequency distribution** of a categorical property. Each unique
value found in the frontmatter becomes a slice.

**Good for:** exercise type mix, tag distribution, habit categories.

```yaml
type: pie
folder: Data/Exercise
dateProperty: creation_date
dateRange: last-30-days
properties:
  - exercise
title: Exercise Mix
showLegend: true
```

> **How frequency counting works:** for each note in range, the raw value of
> each listed property is counted. Array values (tags) are counted per item.

---

### `donut`

Identical to `pie` but rendered as a doughnut ring.

```yaml
type: donut
folder: Data/Exercise
dateProperty: creation_date
dateRange: last-90-days
properties:
  - exercise
title: 90-Day Exercise Mix
colors:
  - "#4f86f7"
  - "#f76c6c"
  - "#43c59e"
  - "#f7c948"
  - "#9b59b6"
```

---

### `heatmap`

GitHub-style contribution grid. Each cell is one day, coloured by value
intensity.

**Good for:** visualising habit consistency, activity levels, anything
calendar-shaped.

```yaml
type: heatmap
folder: Data/Daily
dateRange: this-year
properties:
  - mood
colorScheme: blue
title: Mood Heatmap
```

**Heatmap-specific options:**

| Parameter | Values | Description |
|---|---|---|
| `colorScheme` | `green` `blue` `red` `orange` `purple` | Cell colour palette (default: `green`) |

Days with no data are shown in the lightest shade. Hover over a cell for
the date and value tooltip.

---

### `calendar`

A monthly HTML calendar with coloured day cells and navigation controls.

**Good for:** day-level review of any single metric. Interactively browse
months.

```yaml
type: calendar
folder: Data/Daily
dateRange: this-month
properties:
  - mood
colorScheme: green
title: Mood
```

**Controls:**

| Button | Action |
|---|---|
| `‹` | Previous month |
| `○` | Jump to today |
| `›` | Next month |

Click a highlighted day to pin its value label. Hover for a tooltip.

**Calendar-specific options:**

| Parameter | Description |
|---|---|
| `colorScheme` | Colour palette for data intensity |
| `colors` | Override the accent colour directly (e.g. `colors: ["#e74c3c"]`) |

---

### `scatter`

Plots two properties against each other as X/Y dots. Each note provides one
point. List the X property first, Y property second.

**Good for:** correlations (sleep vs mood, steps vs energy).

```yaml
type: scatter
folder: Data/Daily
dateRange: last-90-days
properties:
  - sleep    # → X axis
  - mood     # → Y axis
title: Sleep vs Mood
xAxis:
  label: Sleep (hours)
yAxis:
  label: Mood score
colors:
  - "#4f86f7"
```

For more than two properties, pairs are grouped: `[0,1]`, `[2,3]`, etc.

---

### `radar`

Spider chart with one axis per property. Uses the **latest value** of each
series.

**Good for:** multi-dimensional snapshot (mood, energy, sleep, water all at once).

```yaml
type: radar
folder: Data/Daily
dateRange: last-30-days
properties:
  - mood
  - energy
  - sleep
  - water
title: 30-Day Snapshot
labels:
  - Mood
  - Energy
  - Sleep
  - Water (L)
colors:
  - "#4f86f7"
yAxis:
  min: 0
  max: 10
```

**Radar-specific options:**

| Parameter | Description |
|---|---|
| `labels` | Override axis labels (defaults to property names) |
| `yAxis.min/max` | Force radial scale bounds |

---

### `gauge`

Half-circle gauge showing the **latest value** of the first property.

**Good for:** showing current level against a target range (e.g. mood, weight,
completion percentage).

```yaml
type: gauge
folder: Data/Daily
dateRange: last-7-days
properties:
  - mood
min: 0
max: 10
title: Current Mood
thresholds:
  - value: 3
    color: "#e74c3c"
  - value: 6
    color: "#f7c948"
  - value: 10
    color: "#43c59e"
```

**Gauge-specific options:**

| Parameter | Required | Description |
|---|---|---|
| `min` | Yes | Left edge (minimum) value |
| `max` | Yes | Right edge (maximum) value |
| `thresholds` | No | Coloured zones. Each entry needs `value` (upper bound) and `color`. Defaults to red/yellow/green thirds. |

---

### `candlestick`

OHLC (Open / High / Low / Close) financial chart rendered as SVG candles.
Bullish candles (close ≥ open) and bearish candles (close < open) are coloured
separately.

**Good for:** tracking anything with four measurements per period — price,
range of scores, experiment results.

```yaml
type: candlestick
folder: Data/Finance
dateRange: last-60-days
properties:
  open:   open
  high:   high
  low:    low
  close:  close
  volume: volume   # optional — adds tooltip info
title: Stock Price
colors:
  - "#43c59e"   # bullish (up candle)
  - "#f76c6c"   # bearish (down candle)
height: 350
```

**Candlestick-specific options:**

| Parameter | Description |
|---|---|
| `properties.open` | Frontmatter key for open value |
| `properties.high` | Frontmatter key for high value |
| `properties.low` | Frontmatter key for low value |
| `properties.close` | Frontmatter key for close value |
| `properties.volume` | Frontmatter key for volume (optional) |
| `colors[0]` | Bullish candle colour (default: `#43c59e`) |
| `colors[1]` | Bearish candle colour (default: `#f76c6c`) |

---

### `summary`

A label/value table built from a template string with computed variables.
No canvas or SVG — pure text.

**Good for:** dashboards, streaks, totals at a glance.

```yaml
type: summary
folder: Data/Exercise
dateProperty: creation_date
dateRange: this-year
title: Exercise Stats
summary:
  template: |
    Total sessions: {{totalDays()}}
    Current streak: {{currentStreak()}}
    Longest streak: {{maxStreak()}}
    Days since last session: {{currentBreaks()}}
    Longest break: {{maxBreaks()}}
```

> **Always use `|` after `template:`, never `>`.**
> `|` is YAML's literal block scalar — it preserves newlines exactly as written,
> which is required for each stat to render on its own row.
> `>` is the folded scalar — it collapses all newlines into spaces, causing every
> stat to run together in a single cell.

Lines containing a `:` are split into a **label | value** two-column table row.
Lines without `:` span the full width.

A **Copy** button appears in the top-right corner of every summary block. Clicking
it copies the rendered stats to the clipboard as plain text, one stat per line.

**Template variables:**

| Variable | Description |
|---|---|
| `{{totalDays()}}` | Count of days that have at least one non-zero value |
| `{{currentStreak()}}` | Consecutive days up to today (resets if you missed yesterday) |
| `{{maxStreak()}}` | Longest consecutive-day run in the date range |
| `{{currentBreaks()}}` | Days since the last active day (0 if active today) |
| `{{maxBreaks()}}` | Longest gap between active days |
| `{{sum()}}` | Sum of all values across all series and all days |
| `{{mean()}}` | Average value per data point (active days only) |
| `{{max()}}` | Highest single value in the range |
| `{{min()}}` | Lowest single value in the range |
| `{{meanHM()}}` | Average of the `properties` values formatted as hours and minutes (e.g. `6 hours, 33 minutes`). Input values are assumed to be in minutes. Falls back to minutes-only when the average is under 60. |
| `{{meanDateDiff(field1, field2)}}` | Average calendar days between two date frontmatter fields. Skips notes missing either field. Handles both string (`YYYY-MM-DD`) and js-yaml-coerced Date values. |

**Named-argument functions**

These operate on a single named property. The property must be listed in `properties`.

| Variable | Description |
|---|---|
| `{{mean(propName)}}` | Average daily value for the named property |
| `{{sum(propName)}}` | Total sum for the named property |
| `{{max(propName)}}` | Highest single-day value for the named property |
| `{{min(propName)}}` | Lowest single-day value for the named property |
| `{{carbPct(macroProp, calProp)}}` | Carb calories as % of total (macro × 4 / cal mean × 100) |
| `{{fatPct(macroProp, calProp)}}` | Fat calories as % of total (macro × 9 / cal mean × 100) |
| `{{proteinPct(macroProp, calProp)}}` | Protein calories as % of total (macro × 4 / cal mean × 100) |
| `{{tdee(calProp)}}` | Estimated TDEE (kcal) derived from calorie intake and weight change over the display range. Uses `weight` from the Achievements daily-notes folder by default — override with a `tdee:` block (see below). Returns `N/A` when fewer than two weight readings are available. |
| `{{deficit(calProp)}}` | Estimated daily calorie deficit (positive = deficit, negative = surplus). Calculated as `tdee − avgCal`. Returns `N/A` when TDEE data is unavailable. |

**TDEE and deficit configuration**

Both `{{tdee(calProp)}}` and `{{deficit(calProp)}}` derive TDEE from the weight-change-over-calories formula:

```
tdee = avgCal − (weightChange_lbs × 3500 / daysInPeriod)
deficit = tdee − avgCal
```

By default the weight readings are pulled from the **Achievements › Daily notes folder** setting using the `weight` frontmatter property. Override either with an optional `tdee:` block inside the tracker code fence:

```yaml
type: summary
folder: Data/Food Logs
dateRange: last-30-days
properties:
  - cal_total
summary:
  template: |
    Avg calories: {{mean(cal_total)}}
    Est. TDEE: {{tdee(cal_total)}}
    Est. deficit: {{deficit(cal_total)}} kcal/day
tdee:
  weightFolder: Data/Daily Notes   # optional — overrides the Achievements setting
  weightProperty: weight           # optional — defaults to "weight"
```

Weight readings are matched first to notes whose date falls within the chart's display range. If fewer than two readings exist in the range, the two most-recent readings from the entire folder are used as a fallback.

Unrecognised property names render as `?` rather than crashing.

**Using `properties` with `summary`**

`properties` is **optional** for `summary`. When omitted, streak calculations
use note *presence* (active = note exists that day). When included, calculations
use the numeric values (active = value is non-null and non-zero).

```yaml
# Streak based on whether notes exist (no properties needed)
type: summary
folder: Data/Exercise
dateProperty: creation_date
dateRange: this-year
title: Exercise Consistency
summary:
  template: |
    Current streak: {{currentStreak()}}
    Longest streak: {{maxStreak()}}
    Total sessions: {{totalDays()}}
```

```yaml
# Aggregated totals using a numeric property
type: summary
folder: Data/Exercise
dateProperty: creation_date
dateRange: last-30-days
properties:
  - sets
title: Sets — Last 30 Days
summary:
  template: |
    Total sets: {{sum()}}
    Daily average: {{mean()}}
    Best day: {{max()}}
    Active days: {{totalDays()}}
```

```yaml
# Date diff and hours/minutes formatting
type: summary
folder: Data/Book Reviews
dateProperty: read_complete
dateRange: all
properties:
  - reading_time
title: Reading Stats
summary:
  template: |
    Avg. days to complete: {{meanDateDiff(read_start, read_complete)}} days
    Avg. time per book: {{meanHM()}}
```

```yaml
# Named-property aggregates and macro percentages
type: summary
folder: Data/Food Logs
dateProperty: creation_date
dateRange: this-year
properties:
  - cal_total
  - carbs_total
  - fat_total
  - protein_total
title: Daily Averages
summary:
  template: |
    Avg calories: {{mean(cal_total)}}
    Avg carbs %: {{carbPct(carbs_total, cal_total)}}
    Avg fat %: {{fatPct(fat_total, cal_total)}}
    Avg protein %: {{proteinPct(protein_total, cal_total)}}
```

---

### `table`

Groups notes by any frontmatter property and displays per-group aggregations
as a sortable table. No canvas or SVG — pure HTML.

**Good for:** exercise breakdowns by movement, project task counts, any
dataset where you want rows per category rather than a time series.

```yaml
type: table
folder: Data/Exercise Notes
dateProperty: creation_date
dateRange: last-30-days
groupBy: exercise
groupLabel: Exercise
columns:
  - label: Sessions
    value: count
  - label: Sets
    value: sum(sets)
  - label: Reps
    value: sum(reps)
  - label: Minutes
    value: sum(time_min)
title: Exercise Summary — Last 30 Days
```

**Required parameters:**

| Parameter | Description |
|---|---|
| `groupBy` | Frontmatter key whose value defines each row. Notes missing this property are excluded. |
| `columns` | List of column definitions. Each entry requires a `label` and a `value` expression (see below). |

**Optional parameters:**

| Parameter | Description |
|---|---|
| `groupLabel` | Header text for the group column. Defaults to the `groupBy` key name. |
| `title` | Title shown above the table. |
| `dateRange` / `startDate` / `endDate` | Standard date range parameters — works the same as all other chart types. |
| `dateProperty` | Frontmatter key for the note date — works the same as all other chart types. |

**Column `value` expressions:**

| Expression   | Description                                                     |
| ------------ | --------------------------------------------------------------- |
| `count`      | Number of notes in the group within the date range              |
| `sum(prop)`  | Sum of a frontmatter property across all notes in the group     |
| `mean(prop)` | Average of a frontmatter property across all notes in the group |
| `max(prop)`  | Highest value of a frontmatter property in the group            |
| `min(prop)`  | Lowest value of a frontmatter property in the group             |

Rows are sorted alphabetically by the `groupBy` value. Notes where the
`groupBy` property is absent are silently excluded. `properties` is not
needed — column values are resolved directly from the `columns` expressions.

**More examples:**

```yaml
# Book reading tracker — group by genre
type: table
folder: Data/Books
dateRange: this-year
groupBy: genre
groupLabel: Genre
columns:
  - label: Books
    value: count
  - label: Avg Rating
    value: mean(rating)
  - label: Best Rating
    value: max(rating)
title: Reading by Genre
```

```yaml
# Project work log — group by project name
type: table
folder: Data/Work Log
dateRange: last-30-days
groupBy: project
columns:
  - label: Entries
    value: count
  - label: Total Hours
    value: sum(hours)
  - label: Avg Hours
    value: mean(hours)
title: Time by Project
```

---

### `daily-table`

A per-day table optimised for meal and nutrition logs. Each row is a date (summary
mode) or a date/meal combination (expanded mode). Column values use the `{row}`
placeholder to reference the current row's key — so one column definition covers
every row automatically.

**Good for:** daily food logs, nutrition breakdowns by meal, any dataset where
you want to see multiple sub-categories per day in a single table.

---

#### Summary mode (one row per day)

Omit `rows:` to get one row per day. Column expressions use `{row}` = `"total"`,
so `sum(cal_{row})` reads `cal_total` from frontmatter.

```yaml
type: daily-table
folder: Food/Logs/{{DATE:YYYY}}/{{DATE:YYYY-MM}}
dateRange: last-7-days
dateFormat: MM/DD/YY
columns:
  - label: Calories
    value: sum(cal_{row})
  - label: Protein
    value: sum(protein_{row}) & "g"
  - label: Fat
    value: sum(fat_{row}) & "g"
  - label: Carbs
    value: sum(carbs_{row}) & "g"
title: Daily Nutrition — Last 7 Days
```

---

#### Expanded mode (one sub-row per meal)

Add `rows:` to break each day into per-meal sub-rows. On each row, `{row}` is
substituted with that row's key (lowercase by default).

```yaml
type: daily-table
folder: Food/Logs/{{DATE:YYYY}}/{{DATE:YYYY-MM}}
dateRange: last-7-days
rows:
  - Breakfast
  - Lunch
  - Dinner
  - Snacks
totalRow: Daily Total
showEmptyRows: false
dateFormat: MM/DD/YY
columns:
  - label: Calories
    value: sum(cal_{row})
  - label: Protein
    value: sum(protein_{row}) & "g"
  - label: Fat
    value: sum(fat_{row}) & "g"
  - label: Carbs
    value: sum(carbs_{row}) & "g"
  - label: Carbs %
    value: sum(carbs_{row} * 4) / sum(cal_{row}) * 100 & "%"
title: Meal Breakdown — Last 7 Days
```

Row `Breakfast` maps to key `breakfast`. To use a custom key, use the long form:

```yaml
rows:
  - label: Morning
    key: breakfast
  - label: Midday
    key: lunch
```

**How `{row}` works:**

The `{row}` placeholder is replaced with the row's key before the expression is
evaluated. So:

| Row | Expression | Evaluated as |
|-----|-----------|--------------|
| Breakfast | `sum(cal_{row})` | `sum(cal_breakfast)` |
| Lunch     | `sum(cal_{row})` | `sum(cal_lunch)` |
| Total     | `sum(cal_{row})` | `sum(cal_total)` |

**Required parameters:**

| Parameter | Description |
|---|---|
| `columns` | List of `{ label, value }` column definitions. Use `{row}` in `value`. |

**Optional parameters:**

| Parameter | Default | Description |
|---|---|---|
| `rows` | — | List of row definitions. Omit for summary mode. Each entry is a string (key = lowercase) or `{ label, key }`. |
| `totalRow` | — | Label for the per-day total sub-row. Omit to hide it. Uses key `"total"`. |
| `showEmptyRows` | `true` | Set `false` to hide meal rows where the first column is 0. |
| `dateFormat` | `MM/DD/YY` | moment.js date format for the Date column (e.g. `YYYY-MM-DD`, `ddd MM/DD`). |
| `title` | — | Title shown above the table. |
| `dateRange` / `startDate` / `endDate` | — | Standard date range — same as all other chart types. |
| `dateProperty` | — | Frontmatter key for the note date. |

**Column `value` expressions:**

Identical to the `table` chart — supports `sum()`, `mean()`, `max()`, `min()`,
`count`, arithmetic, `&` concatenation, and quoted string literals. For a
single-entry context (one log note per day), `sum(cal_breakfast)` simply returns
the `cal_breakfast` value from that day's frontmatter.

```yaml
# Calorie percentage breakdown
- label: Fat %
  value: sum(fat_{row} * 9) / sum(cal_{row}) * 100 & "%"

# Concatenation
- label: Summary
  value: sum(cal_{row}) & " cal / " & sum(protein_{row}) & "g protein"
```

---

### `bills`

An interactive bill payment tracker. Reads master bill notes and payment notes
from your vault and renders a two-section table (This Month / Next Month) with
checkboxes for recording payments.

**Good for:** tracking recurring bills, subscriptions, and any regular payment
obligations across one or more billing frequencies.

**Vault structure required:**

| Path | Purpose |
|---|---|
| `Data/Bills/Bill-{Name}.md` | Master bill note (permanent, one per bill) |
| `Data/Bills/Payments/BP-{{DATE:YYYY}}/BP-{{DATE:YYYY-MM}}/BP-{Name}-YYYY-MM.md` | Payment note (one per bill per month) |

> Folder paths are configurable in **Settings → Bills**. The payment folder supports `{{DATE:FORMAT}}` tokens — the same syntax used in the Meal Logger — where FORMAT is any moment.js format string (e.g. `{{DATE:YYYY}}`, `{{DATE:MM}}`, `{{DATE:MMMM}}`).

**Master note frontmatter fields:**

```yaml
bill_active: true             # checkbox property — true = active
bill_amount_due: 180          # optional — omit for variable bills
bill_company: Ottawa Hydro
bill_due_date: 2026-03-15     # anchor date; future occurrences calculated from here
bill_frequency: monthly       # monthly | quarterly | annual
bill_type: Utility
```

**Codeblock syntax:**

```yaml
type: bills
bill_type: Utility   # optional — omit to show all active bills
title: My Bills      # optional
```

**Rendered output:**

Two sections — *This Month* and *Next Month* — each containing a table of bills
sorted alphabetically by name.

| Column | Description |
|---|---|
| ☐ | Checkbox — checked when `bill_status: paid` |
| Bill | `bill_name` — rendered as a link to the master note. Click the header to sort. |
| Company | `bill_company` |
| Due Date | Formatted as `May 15` |
| Amount Due | `bill_amount_due` or `—` if blank |
| Amount Paid | `bill_amount_paid` or `—` |
| Paid Date | `bill_paid_date` formatted as `May 12` or `—` |

All data columns are sortable by clicking the header (↑ asc → ↓ desc → clear). A **Columns ▾** button lets you hide any column; the master-note link shifts to the Company column if Bill is hidden.

**Visual states:**

| State | Appearance |
|---|---|
| Overdue (unpaid and due ≤ today) | Entire row bold red |
| Paid | Checkbox checked, renders normally |
| Upcoming | Renders normally |

**Checkbox interaction:**

Clicking an unchecked checkbox opens a **Record Payment** modal. Enter the
amount paid and click **Save** — the plugin re-reads the master note for
current values, rewrites the payment note with `bill_status: paid`,
`bill_amount_paid`, and `bill_paid_date` (today), then re-renders the table.

Checked boxes cannot be unchecked via the UI — edit the payment note directly
to reverse a payment.

**Auto-creation:** when the renderer encounters a next-month bill with no
payment note, it creates the note automatically using current master values.

**`Generate Monthly Bills` command:** run from the command palette at the start
of each month to create all this-month payment notes at once. The command is
idempotent — it skips notes that already exist.

**Due date calculation:**

`bill_due_date` is an anchor. Future occurrences are derived by adding the
frequency interval (1 / 3 / 12 months) until a date in the target month is
found. If the anchor day exceeds the days in the target month, it is clamped
(e.g. Jan 31 → Feb 28).

---

## Reading Challenge

The Reading Challenge renders inline in any note as a `tracker-pro` code block:

````
```tracker-pro
type: reading-challenge
year: 2026
```
````

`year` is optional — omit it to default to the current year. The block auto-refreshes when any book note or the goals file changes.

---

### Vault Setup

**Goals file** — a single note (default `Data/Reading Goals.md`) with one
`reading_goal_YYYY` number property per year:

```yaml
reading_goal_2024: 24
reading_goal_2025: 20
reading_goal_2026: 12
```

Each property is a standard Obsidian **number** type. Add a new line for each year you want to track.

**Book notes** — any `.md` file in your configured folder whose basename starts
with the configured prefix and has a `read_complete: YYYY-MM-DD` frontmatter field:

```yaml
title: The Name of the Wind
author: Patrick Rothfuss
series: The Kingkiller Chronicle
series_number: 1
read_complete: 2026-03-14
```

| Field | Required | Description |
|---|---|---|
| `read_complete` | Yes | Date the book was finished (`YYYY-MM-DD`). Notes without this field are ignored. |
| `title` | No | Display title. Falls back to the filename (prefix stripped, hyphens → spaces). |
| `author` | No | Shown to the right of the title. |
| `series` | No | Series name shown below the title. |
| `series_number` | No | Appended to the series name (e.g. `The Stormlight Archive #1`). |

---

### Block Layout

**Hero section** — a colored square badge tile on the left showing the year and a 📖 icon.
To the right: "Reading Challenge" title and a **year dropdown** to switch years in place.
A motivational subtitle beneath the title adapts to your progress:

| Situation | Subtitle |
|---|---|
| Current year, on track | "You're on track! Keep reading." |
| Current year, behind | "Press on! Read N book(s) to get back on track." |
| Past year, goal met | "Challenge complete! You met your goal." |
| Past year, goal missed | "You read N of G books." |
| Future year with goal | "Goal: G book(s)" |
| No goal set | (no subtitle) |

**Progress section** — bold stats line showing `N of G books read | D days left`
(or "Completed" for past years), followed by a pill-shaped progress bar with the
percentage label outside to the right: `[████░░░░] 25%`

**Book list** — numbered and sorted by `read_complete` date. Each entry shows:
- Clickable title link — opens the note in Obsidian
- Author to the right of the title
- Series line below (if `series` is set)

---

### Changing Years

The year dropdown in the hero re-renders the block in place for the selected year. The list includes all years that appear in the goals file plus the current year.

---

## Advanced Features

### `source: fileMeta`

Read values from the **file itself** rather than frontmatter. No numeric
property needed in your notes.

```yaml
type: bar
folder: Data/Journal
dateProperty: creation_date
dateRange: this-year
source: fileMeta
target: numWords
title: Words Per Entry
```

**`target` options:**

| Target | Description |
|---|---|
| `numWords` | Whitespace word count (frontmatter stripped) |
| `numChars` | Character count (frontmatter stripped) |
| `numSentences` | Sentence count (split on `.`, `!`, `?`) |
| `numLinks` | Internal wiki-links + embeds |
| `size` | Raw file size in bytes |

> **Note:** `numWords` is a simple whitespace count and will differ from
> tools like Novel Word Count. Use it for relative comparison, not absolute totals.

`source: fileMeta` works with all chart types. Combine with `aggregate` as
normal:

```yaml
type: line
folder: Data/Journal
dateProperty: creation_date
dateRange: this-year
source: fileMeta
target: numWords
aggregate: cumulative
title: Cumulative Words Written
```

---

### `dateAggregation`

When multiple notes share the same date (e.g. you log each exercise as a
separate note), Tracker Pro buckets them before building the time series.

The default behaviour is `sum` — daily values are added together, which is
correct for counts like `sets` and `reps`.

```yaml
type: bar
folder: Data/Exercise
dateProperty: creation_date
dateRange: last-30-days
properties:
  - sets
dateAggregation defaults to sum — no need to set it unless you want something else
```

Override with `dateAggregation`:

| Value | Description |
|---|---|
| `sum` | Add all same-date values (default) |
| `mean` | Average all same-date values |
| `max` | Keep the highest same-date value |
| `min` | Keep the lowest same-date value |
| `count` | Count how many notes exist on that date |

```yaml
# Count exercise sessions per day (ignores numeric values entirely)
type: bar
folder: Data/Exercise
dateProperty: creation_date
dateRange: last-30-days
properties:
  - sets
dateAggregation: count
title: Sessions Per Day
```

```yaml
# Track your peak single-set performance per day
type: line
folder: Data/Exercise
dateProperty: creation_date
dateRange: last-30-days
properties:
  - reps
dateAggregation: max
title: Daily Max Reps
```

---

## Full Parameter Reference

All available parameters in one table.

| Parameter          | Type                       | Default                             | Applies to                       | Description                                                            |
| ------------------ | -------------------------- | ----------------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| `type`             | string                     | —                                   | all                              | **Required.** Chart type.                                              |
| `folder`           | string                     | —                                   | all                              | Folder path to scan recursively.                                       |
| `file`             | string                     | —                                   | all                              | Single file path (without `.md`).                                      |
| `files`            | list                       | —                                   | all                              | List of file paths.                                                    |
| `dateRange`        | string                     | [[#Full list of dateRange options]] | all                              | Preset date window.                                                    |
| `startDate`        | ISO date                   | —                                   | all                              | Explicit range start.                                                  |
| `endDate`          | ISO date                   | —                                   | all                              | Explicit range end.                                                    |
| `dateProperty`     | string                     | —                                   | all                              | Frontmatter key for the note's date.                                   |
| `properties`       | list / map                 | —                                   | most                             | Frontmatter key(s) to chart. Optional for summary and table.           |
| `aggregate`        | string                     | `daily`                             | line, bar, heatmap, gauge, radar | Time aggregation mode.                                                 |
| `period`           | number                     | 7                                   | line, bar                        | Moving-average window size.                                            |
| `dateAggregation`  | string                     | `sum`                               | all                              | How to bucket same-date notes.                                         |
| `missingValue`     | `skip` / `zero` / N        | `skip`                              | line, bar                        | Handling of missing data points.                                       |
| `source`           | `frontmatter` / `fileMeta` | `frontmatter`                       | all                              | Where to read values from.                                             |
| `target`           | string                     | `numWords`                          | fileMeta only                    | Which file metric to read.                                             |
| `title`            | string                     | —                                   | all                              | Chart title.                                                           |
| `subtitle`         | string                     | —                                   | line, bar, pie, scatter, radar   | Subtitle below the title.                                              |
| `height`           | number                     | 300                                 | all except summary, table        | Chart height in pixels.                                                |
| `width`            | string                     | —                                   | all                              | CSS width (e.g. `400px`, `100%`).                                      |
| `colors`           | list                       | built-in palette                    | all                              | Per-series hex colours.                                                |
| `colorScheme`      | string                     | `green`                             | heatmap, calendar                | Named colour palette.                                                  |
| `showLegend`       | boolean                    | `true`                              | line, bar, pie, donut, radar     | Show / hide legend.                                                    |
| `xAxis.label`      | string                     | —                                   | line, bar, scatter               | X axis label text.                                                     |
| `xAxis.min/max`    | number                     | —                                   | scatter                          | X axis bounds.                                                         |
| `yAxis.label`      | string                     | —                                   | line, bar, scatter, radar        | Y axis label text.                                                     |
| `yAxis.min/max`    | number                     | —                                   | line, bar, scatter, radar        | Y axis bounds.                                                         |
| `yAxis.unit`       | string                     | —                                   | line, bar                        | Suffix added to tooltip values.                                        |
| `labels`           | list                       | property names                      | radar                            | Custom axis labels.                                                    |
| `min`              | number                     | —                                   | gauge                            | **Required for gauge.** Minimum value.                                 |
| `max`              | number                     | —                                   | gauge                            | **Required for gauge.** Maximum value.                                 |
| `thresholds`       | list                       | red/yellow/green                    | gauge                            | Colour zones: `value` + `color` pairs.                                 |
| `summary.template` | string                     | —                                   | summary                          | Multi-line template with `{{variable()}}` placeholders.                |
| `groupBy`          | string                     | —                                   | table                            | **Required for table.** Frontmatter key to group rows by.              |
| `groupLabel`       | string                     | groupBy key                         | table                            | Override header label for the group column.                            |
| `columns`          | list                       | —                                   | table, daily-table               | **Required for table/daily-table.** List of `{ label, value }` column definitions. |
| `rows`             | list                       | —                                   | daily-table                      | Meal row definitions. Omit for summary mode (one row per day). |
| `totalRow`         | string                     | —                                   | daily-table                      | Label for the per-day total sub-row (uses key `total`). Omit to hide. |
| `showEmptyRows`    | boolean                    | `true`                              | daily-table                      | Hide meal rows where the first column evaluates to 0. |
| `dateFormat`       | string                     | `MM/DD/YY`                          | daily-table                      | moment.js format for the date column. |
| `bill_type`        | string                     | —                                   | bills                            | Filter to bills matching this `bill_type` value. Omit to show all active bills. |
| `year`             | number                     | current year                        | reading-challenge                | Which year to display. |
| `dateSelector`     | boolean                    | `false`                             | all                              | Render an interactive date-range dropdown above the chart. |

### Full list of dateRange options

| Value         | What it covers                                          |
| ------------- | ------------------------------------------------------- |
| today         | Today only                                              |
| this-week     | Sunday of the current week → today                      |
| this-month    | 1st of the current month → today                        |
| this-year     | Jan 1 of the current year → today                       |
| last-week     | Previous full calendar week (Sunday → Saturday)         |
| last-month    | Previous full calendar month (1st → last day)           |
| last-year     | Full previous calendar year (Jan 1 – Dec 31)            |
| last-N-days   | N days ago → today (e.g. `last-7-days`, `last-30-days`) |
| last-N-weeks  | N weeks ago → today                                     |
| last-N-months | N months ago → today                                    |
| last-N-years  | N years ago → today                                     |
| all           | Jan 1 2000 → today                                      |
