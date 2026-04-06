# Tracker Pro — Status & Roadmap

## Overview

Tracker Pro is a ground-up rewrite of the Obsidian Tracker plugin. It shares no
code with the original fork. The architecture is clean and self-contained with no
dependency on Dataview.

---

## Implemented

### Change 1 — `dateProperty` support
Read the date from a frontmatter key instead of the filename. Configured globally
in plugin settings or per-block via `dateProperty: creation_date`.

### Change 2 — New chart architecture
Replaced the original Tracker rendering pipeline with a modular chart system:
- `src/parser.ts` — YAML config parsing and validation
- `src/dataCollector.ts` — file resolution, date extraction, value extraction
- `src/aggregator.ts` — daily / weekly / monthly / cumulative / moving-average
- `src/renderer.ts` — chart type routing
- `src/charts/` — one file per chart type

Supported chart types: `line`, `bar`, `pie`, `donut`, `heatmap`, `scatter`,
`radar`, `gauge`, `candlestick`, `calendar`, `summary`

### Change 3 — Interactive calendar chart
The `calendar` type renders an HTML calendar (not SVG grid) with:
- Month/year header in accent colour
- `‹ ○ ›` navigation (prev, today, next)
- Full grid with greyed-out overflow days from adjacent months
- Today highlighted with a filled circle
- Days with data shown with colour intensity scaled to value
- Hover tooltip showing date and value
- Click to pin value label on a day

Configurable via `colorScheme`, `monthCount`, `colsPerRow`.

### Change 4 — `source: fileMeta` support
Read values from file metadata instead of frontmatter. Configured via
`source: fileMeta` and `target: <metric>`.

Supported targets:

| target | description |
|---|---|
| `numWords` | Whitespace word count, frontmatter stripped |
| `numChars` | Character count, frontmatter stripped |
| `numSentences` | Sentence count |
| `numLinks` | Internal links + embeds |
| `size` | Raw file size in bytes |

Note: `numWords` will not match Novel Word Count — it is a naive whitespace
count. Relative activity tracking is accurate; absolute counts will differ.

### Change 5 — `summary` chart type with streak calculations
The `summary` type renders a label/value table from a template string.

Template variables:

| variable | description |
|---|---|
| `{{maxStreak()}}` | Longest consecutive day run |
| `{{currentStreak()}}` | Days in a row up to today |
| `{{maxBreaks()}}` | Longest gap between active days |
| `{{currentBreaks()}}` | Days since last active day |
| `{{totalDays()}}` | Total active days in range |
| `{{sum()}}` | Sum of all values |
| `{{mean()}}` | Average value per active day |
| `{{max()}}` | Highest single-day value |

`properties` is optional for `summary` — if omitted, note presence is used
for streak calculations.

### Change 6 — `dateAggregation` parameter
Buckets multiple same-date note values before building the time series.
Replaces prior last-write-wins behaviour.

Values: `sum` (default) | `mean` | `max` | `min` | `count`

---

## Roadmap

### Grouped exercise table (from Dataview)
Replace the following Dataview block pattern with a native tracker-pro block:

```dataviewjs
// Groups exercise notes by the `exercise` frontmatter property
// Aggregates sets, reps, time_min per exercise
// Renders three tables: last 7 / 30 / 365 days
```

**Proposed syntax:**
```yaml
type: table
folder: Data/Exercise Notes
dateProperty: creation_date
groupBy: exercise
columns:
  - label: Count
    value: count
  - label: Sets
    value: sum(sets)
  - label: Reps
    value: sum(reps)
  - label: Minutes
    value: sum(time_min)
windows:
  - label: "Last 7 Days"
    dateRange: last-7-days
  - label: "Last 30 Days"
    dateRange: last-30-days
  - label: "Last 365 Days"
    dateRange: last-365-days
```

**Scope decision:** Deferred. This is a table/reporting feature rather than a
charting feature. Worth building but outside the core charting scope of the
current architecture. Revisit once core chart types are stable.
