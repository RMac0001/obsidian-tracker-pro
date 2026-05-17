# Tracker Pro — Status

## What was done (v1.1.1 → v1.4.1)

---

### v1.4.1 — Calculate Recipe Nutrition Command

**New command: `Calculate Recipe Nutrition`**
- Run from the command palette with a recipe note open
- Reads the `# Ingredients` section and resolves each `[[wiki-link]]` to a food or sub-recipe note
- Extracts amount and unit from each line; applies unit conversion (volume↔volume, weight↔weight) before calculating contribution
- Sub-recipes detected by `Recipe -` filename prefix; per-serving values multiplied by resolved serving ratio
- Shows a confirmation modal with a suggested serving count (≤350 cal/serving), editable with live cal/serving update
- Writes `calories`, `carbs`, `fat`, `protein` (per serving, rounded), and `servings` to frontmatter via `processFrontMatter`
- Appends a `## Notes` section listing any skipped ingredients with the skip reason (no note found, unit mismatch, not convertible, recipe missing fields)

**Unit conversion support:**
- Volume: tsp, tbsp, fl oz, cup, pint, quart, l, ml (all converted to ml for comparison)
- Weight: g, kg, oz, lb/lbs (all converted to g for comparison)
- Named/count units (jar, can, serving, piece, etc.) matched directly against `common_serving_unit` or `serving_unit`

---

### v1.4.0 — Interactive Date Range Selector

**`dateSelector: true` — interactive dropdown above any chart**
- Add `dateSelector: true` to any chart block and a date-range `<select>` renders above the chart
- Selecting a preset re-renders only the chart portion; the selector stays in place
- Choosing **Custom…** reveals two `<input type="date">` fields; updating either date re-renders immediately
- Works with all chart types that support `dateRange`

**New `dateRange` presets**
- `today` — start = today, end = today
- `last-week` — the previous full calendar week (Sunday → Saturday)
- `last-month` — the previous full calendar month (1st → last day)

**Dropdown options (in order):** Today · This Week · This Month · This Year · Last Week · Last Month · Last Year · Last 7 Days · Last 30 Days · Last 90 Days · Last 6 Months · Last 12 Months · All Time · Custom…

---

### v1.3.3 — Edit Meal Log works without an existing log

**Edit meal log — no log required**
- Previously showed "No food log found for today" and aborted if today's log didn't exist yet
- Now creates a blank log note automatically (zeroed frontmatter, all four meal sections) and opens the edit modal on it

---

### v1.3.2 — Summary `min()` + Reading Challenge inline

**`min()` template variable for summary charts**
- Adds `{{min()}}` alongside the existing `{{max()}}`, `{{mean()}}`, and `{{sum()}}` variables
- Returns the lowest non-null value across all series points in the date range

**Reading Challenge converted to inline block**
- `type: reading-challenge` now renders directly in a note as a `tracker-pro` code block — no command or modal needed
- Year selector is a `<select>` dropdown in the hero that re-renders in place
- Removed the **Tracker Pro: Reading Challenge** command (superseded by the inline block)
- Goals file uses `reading_goal_YYYY: N` number properties (one per year) instead of a nested map

---

### v1.1.1 — Meal Logger

The core meal logging feature was integrated from the handoff files.

**New command: `Log meal`**
- Fuzzy modal to pick meal type (Breakfast / Lunch / Dinner / Snacks)
- Loop: search food database or recipes, enter amount, add more items
- Foods: amount in the food's unit (oz, cup, etc.) — math: `amount / serving_size × nutrition`
- Recipes: number of servings — math: `servings × nutrition`
- On save: creates today's log note if it doesn't exist, or appends to the correct section if it does
- Daily log note path is templated: `mealLogFolder` and `mealLogFilename` support `{{DATE:FORMAT}}` tokens

**Four new settings fields:**
- `Meal log folder` — e.g. `Data/Food Logs/{{DATE:YYYY}}/{{DATE:YYYY-MM}}`
- `Meal log filename` — e.g. `{{DATE:YYYY-MM-DD}}`
- `Food database folder` — e.g. `Data/Food`
- `Recipes folder` — e.g. `Data/Recipes`

**Daily log frontmatter schema** — 20 fields written automatically:
```
cal_total, protein_total, fat_total, carbs_total
cal_breakfast, protein_breakfast, fat_breakfast, carbs_breakfast
cal_lunch, protein_lunch, fat_lunch, carbs_lunch
cal_dinner, protein_dinner, fat_dinner, carbs_dinner
cal_snacks, protein_snacks, fat_snacks, carbs_snacks
```

---

### v1.1.2 — Meal Log Editing

Three editing features added to the meal logger.

**During logging — Remove last item**
While building a meal, a "Remove last item (Name)" option appears in the menu whenever the list isn't empty. Pops the last entry and loops back.

**New command: `Clear meal`**
- Pick meal type → confirm
- Zeroes its 8 frontmatter fields, removes all bullet lines from that section, recalculates all four `_total` fields

**New command: `Edit today's meal log`**
- Pick meal type → fuzzy-pick which logged item to remove
- Parses nutrition numbers directly from the log line
- Removes the line from the note body, subtracts from frontmatter, recalculates totals

Log line format:
```
- [[Peanut Butter]] (2 oz) — 220 cal | 14g protein | 8g fat | 0g carbs
- [[Recipe - Cup of Coffee]] (1 serving) — 45 cal | 0g protein | 2g fat | 5g carbs
```

---

### v1.1.3 — Table Wiki Link Fix

Table `groupBy` cells were rendering `[[Data/Exercises/Exercise-Walk.md|Walk]]` as raw text instead of a clickable link.

Fixed by adding `renderGroupByCell()`: detects `[[path|display]]` or `[[path]]` patterns and creates a proper Obsidian internal-link `<a>` element. Falls back to plain text for non-link values.

---

### v1.1.4 — Table Expression Arithmetic

Column values can now use arithmetic between aggregation calls, and a `&` suffix for display units.

```yaml
value: sum(carbs_breakfast) / sum(cal_breakfast) * 100
value: sum(cal_breakfast)&%
```

---

### v1.1.5 — Table Height Fix

The parser was defaulting `config.height = 300` for all chart types, and the renderer was applying it to everything except `summary`. Tables were getting a 300px container with a large empty space below the rows.

Fixed by excluding `table` type from the height assignment — tables now size to their content.

---

### v1.1.6 — Expression Engine Redesign

The column value expression system was fully redesigned.

**`&` is now a string concatenation operator** (like Excel/LibreOffice Calc):
```yaml
value: "I ate " & sum(cal_breakfast) & " calories today"
# → "I ate 380 calories today"
```

**Quoted string literals** — recommended standard for text parts:
```yaml
value: "Fat: " & sum(fat_breakfast * 9) / sum(cal_breakfast) * 100 & "% of cals"
```

**Bare text** also works — surrounding spaces are preserved:
```yaml
value: I ate & sum(cal_breakfast) & today
# → "I ate 380 today"
```

**Inner expressions in aggregation functions** — evaluated per-entry before aggregating:
```yaml
value: sum(fat_breakfast * 9)                                    # per entry: fat*9, then sum
value: mean(fat / cal * 100)                                     # per entry: fat/cal*100, then mean
value: sum(fat_breakfast * 9) / sum(cal_breakfast) * 100         # outer arithmetic
```

---

### v1.1.8 — Daily Table Chart

A new `type: daily-table` chart for per-day nutrition and meal logging.

**Two modes:**

**Summary mode** (no `rows:`) — one row per day, `{row}` = `"total"`:
```yaml
type: daily-table
folder: Food/Logs/{{DATE:YYYY}}/{{DATE:YYYY-MM}}
dateRange: last-7-days
columns:
  - label: Calories
    value: sum(cal_{row})
  - label: Protein
    value: sum(protein_{row}) & "g"
```

**Expanded mode** (`rows:` defined) — one sub-row per meal per day, date shown only on the first visible row:
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
  - label: Fat %
    value: sum(fat_{row} * 9) / sum(cal_{row}) * 100 & "%"
```

**`{row}` placeholder** — substituted with the row's key (e.g. `"breakfast"`) before expression evaluation. `totalRow` always uses key `"total"`.

**New parameters:** `rows`, `totalRow`, `showEmptyRows`, `dateFormat`

---

### v1.1.7 — Remove `x` Multiplication Alias

The `x` multiplication alias was removed. Use `*` only.

---

### v1.2.0 — Bills Tracker

A new `type: bills` chart and `Generate Monthly Bills` command for tracking recurring bills and subscriptions.

**Vault structure:**
```
Data/Bills/
  Bill-Internet.md          ← master bill notes
  Bill-Electricity.md
  Payments/
    BP-2026/BP-2026-05/
      Internet-2026-05.md   ← monthly payment notes (auto-created)
      Electricity-2026-05.md
```

**Master bill frontmatter fields:**
```yaml
bill_active: true               # checkbox property — true = active
bill_amount_due: 89.99          # optional for variable bills
bill_company: Xfinity
bill_due_date: 2024-01-15       # anchor date — day-of-month + billing start
bill_frequency: monthly         # monthly / quarterly / annually
bill_type: Utility
```

**Payment note frontmatter fields** (alphabetical, auto-written):
```yaml
bill_amount_due: 89.99
bill_amount_paid: 89.99
bill_company: Xfinity
bill_due_date: 2026-05-15
bill_name: Internet
bill_paid_date: 2026-05-14
bill_status: paid               # paid / unpaid
bill_type: Utility
```

**Codeblock:**
```yaml
type: bills
bill_type: Utility   # optional — omit to show all active bills
```

**Rendered output:**
- Two sections — *This Month* and *Next Month*
- Columns: ☐ (paid checkbox), Bill, Company, Due, Amount Due, Amount Paid, Paid Date
- Overdue rows (unpaid + due date ≤ today) render in bold red
- Clicking the checkbox opens a *Record Payment* modal to confirm amount and paid date

**`Generate Monthly Bills` command:**
- Scans all active master notes and creates any missing payment notes for the current month

---

### v1.3.1 — Reading Challenge

New **Tracker Pro: Reading Challenge** command. Opens a year selector then renders an
interactive reading progress modal with a Goodreads-style layout.

**Hero section**
- Colored square badge tile on the left — year in large bold white text with a 📖 icon below; uses `--color-accent`
- To the right: **Reading Challenge** title + **Change Year ▾** button on the same row
- Motivational subtitle adapts to your situation:
  - On track → "You're on track! Keep reading."
  - Behind → "Press on! Read N book(s) to get back on track."
  - Past year met → "Challenge complete! You met your goal."
  - Past year missed → "You read N of G books."
  - Future year → "Goal: G book(s)"

**Progress section**
- Bold stats line: `N of G books read | D days left` (or "Completed" for past years)
- Pill-shaped progress bar with the percentage label outside to the right: `[████░░░░] 25%`

**Book list** — numbered, sorted by finish date
- Clickable title (opens the note), author to the right
- Optional series line below (e.g. `The Stormlight Archive #1`)

**Historical summary table** — one row per year in the goal file
- Columns: Year / Goal / Read / Result (✅ Met / ❌ Missed / In progress)

**Vault setup:**
- Goals: a single note (default `Data/Reading Goals.md`) with one `reading_goal_YYYY` number property per year, e.g. `reading_goal_2026: 12`
- Books: any note in the configured folder whose basename starts with the configured prefix and has `read_complete: YYYY-MM-DD` in frontmatter

**Three new settings:** Book notes folder · Book note prefix · Reading goal file

---

### v1.3.0 — Auto-Refresh Cache Fix

Fixed the bills chart not updating after recording a payment.
The chart now waits for Obsidian's metadata cache to process the
saved payment note before re-rendering, so the paid status,
amount, and date appear immediately without navigating away.

---

### v1.2.9 — Edit Meal Log v2

The "Edit today's meal log" command has been replaced by a unified **Edit meal log** command.

On invoke, today's log opens immediately in a persistent modal. A **Switch date** button in the modal header opens a fuzzy picker of the 30 most recent log files (newest first) to switch to any past log without closing the modal.

**Four edit actions available at any time:**
- **Change quantity** — pick a meal and item, pre-fills the current amount, re-uses the AmountModal
- **Remove item** — pick a meal and item to delete; meal heading is always retained
- **Add item to a meal** — full food/recipe search, same UX as Log Meal
- **Add a meal block** — same as above; picks meal type first then searches

**Save and recalculate:** on save, nutrition values are re-pulled fresh from each food/recipe source note (not re-summed from stored log values). A timestamped `- YYYY-MM-DD — Log recalculated` bullet is appended to a `## Notes` section at the bottom of the file (created automatically on first save). The entire file is rewritten.

---

### v1.2.8 — Auto-Refresh on File Change

`tracker-pro` code blocks now automatically re-render whenever a file in their
configured data source changes. Uses `metadataCache.on("changed")` (fires after
frontmatter is re-parsed, not just after disk write) scoped to a
`MarkdownRenderChild` for proper lifecycle management — listeners are cleaned up
when the block leaves the DOM.

The ↻ Refresh button has been removed from the bills chart as it is no longer
needed.

---

### v1.2.7 — Fix `maxBreaks()` Ignoring Range Start

`calcMaxBreak` was only looking at gaps between existing entries, so a gap from the range start date to the first entry was never considered. For example, a `this-year` range with no entries until April would report a much smaller longest break than the actual ~98-day gap from January.

Fixed by passing `rangeStartMs` (derived from the minimum `pt.date` across all series, which the data collector clips to the range start) into `calcMaxBreak` and including the lead gap as a candidate before scanning between entries.

---

### v1.2.6 — Fix Duplicate Payment Notes on Sync

The chart was auto-creating next-month payment notes on every render. When both mobile and desktop rendered before Obsidian Sync propagated the file, each device created the same note independently — producing sync conflict duplicates.

Fixed by removing auto-creation from the renderer entirely. Next-month bills now display from master note data (same as this month) until a payment note actually exists. The **Generate Monthly Bills** command remains the correct way to pre-create payment notes in bulk; paying a bill via the checkbox also creates the file on first use.

---

### v1.2.5 — Persist Bills Sort and Column Visibility

Sort column, sort direction, and hidden columns are now saved to `localStorage` and restored when navigating back to the note. State is scoped per `bill_type` filter, so different bills charts can have independent preferences.

---

### v1.2.4 — Bills Table Column Sorting and Hiding

**Column sorting:** click any column header to sort ascending (↑), click again for descending (↓), click a third time to clear. The active sort column header is highlighted.

**Column hiding:** a **Columns ▾** dropdown in the top-right of the chart lets you toggle any column on or off. Both settings persist across re-renders (refresh, checkbox, etc.) until the note is reloaded.

The master note link priority (Bill name → Company → none) updates automatically as columns are hidden.

---

### v1.2.3 — Bills Table Master Note Linking

The Bill column now renders as an Obsidian internal link to the master bill note. Clicking the bill name opens `Data/Bills/Bill-{Name}.md` directly.

Priority order if columns are ever hidden: Bill name link first, Company link second, no link if both hidden. Currently both columns are always shown so the Bill column always carries the link.

---

### v1.2.2 — Bills Settings Fix and Refresh Button

- Fixed the Bills settings section header which still showed the old `{YYYY}`, `{MM}` variable syntax instead of `{{DATE:FORMAT}}`
- Added a **↻ Refresh** button to the bills chart so the view can be manually reloaded after recording a payment (useful when the metadata cache hasn't updated yet)

---

### v1.2.1 — Configurable Bill Folder Paths

The hardcoded bill paths were replaced with two plugin settings, letting users store bills anywhere in their vault. The payment folder template uses the same `{{DATE:FORMAT}}` token syntax as the Meal Logger, with FORMAT being any moment.js format string.

**Two new settings fields:**
- `Bills master folder` — e.g. `Data/Bills` (default)
- `Bills payment folder template` — e.g. `Data/Bills/Payments/BP-{{DATE:YYYY}}/BP-{{DATE:YYYY-MM}}` (default)

---

### Release Workflow Fix

The `.github/workflows/releases.yml` was broken — it used `yarn` instead of `npm`, referenced non-existent action versions (v6), and included a `yarn zip` step with no matching script. Fixed to use `npm install` / `npm run build`, correct action versions (v4), and removed the zip step.

Now when you publish a release on GitHub with a new tag, the workflow automatically builds and attaches `main.js`, `manifest.json`, and `styles.css`.

---

## Roadmap

These were discussed but not yet built:

### 1. Conditional formatting in tables
Color cells based on thresholds (green / yellow / red). Most impactful for nutrition and exercise tracking. Would reuse the threshold concept already present in the gauge chart.

```yaml
columns:
  - label: Calories
    value: sum(cal_total)
    thresholds:
      - value: 1800  color: green
      - value: 2200  color: orange
      - value: 9999  color: red
```

### 2. Stacked bar chart
A `stacked: true` option on the existing bar chart. Natural fit for visualizing macros (carbs / fat / protein) per day as a single stacked bar.

### 3. Recent foods in the meal logger
Track the last 10–15 logged foods and show them at the top of the search. High-value UX improvement, especially on mobile where typing is friction.

### 4. Multi-folder data sources
A `folders:` array to query across multiple folders in one chart block. Currently limited to a single `folder:`, `file:`, or explicit `files:` list.

### 5. Click-through on table rows
Clicking a row opens the source note. Very Obsidian-native and useful for drilling into a specific day's log from a summary table.

### 6. Meals Feature

[[Tracker Pro - Meals Feature|Meals]] would be a saved combination of Foods and/or Recipes that are always eaten together, always representing one serving of the complete plate. They would live in `Data/Meals/` alongside `Data/Food/` and `Data/Recipes/`. Tabled for now
