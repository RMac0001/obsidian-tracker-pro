# Writing Dashboard

> Data source: `Data/Journal` — journal entries with `creation_date` frontmatter.
> Values are read from **file metadata** using `source: fileMeta` — no numeric
> frontmatter property needed.

---

## Words Written — Per Entry (Bar)

```tracker-pro
type: bar
folder: Data/Journal
dateProperty: creation_date
dateRange: last-365-days
source: fileMeta
target: numWords
title: Words Per Entry
colors:
  - "#4f86f7"
yAxis:
  label: Word count
showLegend: false
```

---

## Words Written — Cumulative (Line)

```tracker-pro
type: line
folder: Data/Journal
dateProperty: creation_date
dateRange: last-365-days
source: fileMeta
target: numWords
aggregate: cumulative
title: Cumulative Words Written
colors:
  - "#43c59e"
yAxis:
  label: Total words
showLegend: false
```

---

## Writing Activity Heatmap

```tracker-pro
type: heatmap
folder: Data/Journal
dateProperty: creation_date
dateRange: last-365-days
source: fileMeta
target: numWords
colorScheme: purple
title: Writing Activity
```

---

## Writing Summary

```tracker-pro
type: summary
folder: Data/Journal
dateProperty: creation_date
dateRange: last-365-days
source: fileMeta
target: numWords
title: Writing Stats — Last Year
summary:
  template: |
    Total entries: {{totalDays()}}
    Total words: {{sum()}}
    Average per entry: {{mean()}}
    Longest entry: {{max()}}
    Current streak: {{currentStreak()}}
    Longest streak: {{maxStreak()}}
```
