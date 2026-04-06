# Health Dashboard

> Data source: `Data/Daily` — one note per day with frontmatter properties:
> `date`, `mood`, `energy`, `sleep`, `weight`, `steps`, `water`

---

## Mood & Energy — Last 30 Days (Line)

```tracker-pro
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
  label: Score (1–10)
showLegend: true
```

---

## Sleep — Last 30 Days (Bar)

```tracker-pro
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
  max: 12
showLegend: false
```

---

## Steps — Weekly Totals (Bar, weekly aggregate)

```tracker-pro
type: bar
folder: Data/Daily
dateRange: last-90-days
properties:
  - steps
aggregate: weekly
title: Weekly Step Count
colors:
  - "#f7c948"
yAxis:
  label: Steps
showLegend: false
```

---

## Weight — Moving Average (Line, 7-day)

```tracker-pro
type: line
folder: Data/Daily
dateRange: this-year
properties:
  - weight
aggregate: moving-average
period: 7
title: Weight (7-day moving average)
colors:
  - "#e74c3c"
yAxis:
  label: kg
showLegend: false
```

---

## Mood Heatmap — This Year

```tracker-pro
type: heatmap
folder: Data/Daily
dateRange: this-year
properties:
  - mood
colorScheme: blue
title: Mood Heatmap
```

---

## Mood Calendar — This Month

```tracker-pro
type: calendar
folder: Data/Daily
dateRange: this-month
properties:
  - mood
colorScheme: green
title: Mood
```

---

## Sleep vs Mood (Scatter)

```tracker-pro
type: scatter
folder: Data/Daily
dateRange: last-90-days
properties:
  - sleep
  - mood
title: Sleep vs Mood
xAxis:
  label: Sleep (hours)
yAxis:
  label: Mood score
colors:
  - "#4f86f7"
```

---

## Daily Averages Snapshot (Radar)

```tracker-pro
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

---

## Current Mood Level (Gauge)

```tracker-pro
type: gauge
folder: Data/Daily
dateRange: last-7-days
properties:
  - mood
aggregate: daily
min: 0
max: 10
title: Mood (latest)
thresholds:
  - value: 3
    color: "#e74c3c"
  - value: 6
    color: "#f7c948"
  - value: 10
    color: "#43c59e"
```

---

## Wellbeing Summary

```tracker-pro
type: summary
folder: Data/Daily
dateRange: this-year
properties:
  - mood
title: Mood Stats — This Year
summary:
  template: |
    Total active days: {{totalDays()}}
    Current streak: {{currentStreak()}}
    Longest streak: {{maxStreak()}}
    Days since last log: {{currentBreaks()}}
    Longest gap: {{maxBreaks()}}
    Sum: {{sum()}}
    Daily average: {{mean()}}
    Best day: {{max()}}
```
