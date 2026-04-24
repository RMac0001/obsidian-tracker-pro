# Tracker Pro — Status

## What was done (v1.1.1 → v1.1.7)

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
- `Meal log folder` — e.g. `Food/Logs/{{DATE:YYYY}}/{{DATE:YYYY-MM}}`
- `Meal log filename` — e.g. `{{DATE:YYYY-MM-DD}}`
- `Food database folder` — e.g. `Food/Database`
- `Recipes folder` — e.g. `Recipes`

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
- Food Name (2 oz) — 220 cal | 14g protein | 8g fat | 0g carbs
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
