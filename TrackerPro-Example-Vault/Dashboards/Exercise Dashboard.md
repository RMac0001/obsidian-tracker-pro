# Exercise Dashboard

> Data source: `Data/Exercise` — one note per session with frontmatter:
> `creation_date`, `exercise`, `sets`, `reps`, `time_min`

---

## Exercise Mix — Last 30 Days (Pie)

```tracker-pro
type: pie
folder: Data/Exercise
dateProperty: creation_date
dateRange: last-30-days
properties:
  - exercise
title: Exercise Mix
showLegend: true
```

---

## Exercise Mix — Last 90 Days (Donut)

```tracker-pro
type: donut
folder: Data/Exercise
dateProperty: creation_date
dateRange: last-90-days
properties:
  - exercise
title: Exercise Mix (90 days)
colors:
  - "#4f86f7"
  - "#f76c6c"
  - "#43c59e"
  - "#f7c948"
  - "#9b59b6"
  - "#e67e22"
  - "#1abc9c"
  - "#e74c3c"
```

---

## Daily Sets — Last 30 Days (Bar)

```tracker-pro
type: bar
folder: Data/Exercise
dateProperty: creation_date
dateRange: last-30-days
properties:
  - sets
aggregate: daily
title: Daily Sets
colors:
  - "#4f86f7"
yAxis:
  label: Sets
showLegend: false
```

---

## Session Duration — Last 60 Days (Line)

```tracker-pro
type: line
folder: Data/Exercise
dateProperty: creation_date
dateRange: last-60-days
properties:
  - time_min
aggregate: daily
title: Session Duration
colors:
  - "#43c59e"
yAxis:
  label: Minutes
showLegend: false
```

---

## Exercise Activity Heatmap — Last Year

```tracker-pro
type: heatmap
folder: Data/Exercise
dateProperty: creation_date
dateRange: last-365-days
properties:
  - sets
colorScheme: orange
title: Exercise Activity
```

---

## Exercise Calendar — This Month

```tracker-pro
type: calendar
folder: Data/Exercise
dateProperty: creation_date
dateRange: this-month
properties:
  - time_min
colorScheme: green
title: Workout Time (min)
```

---

## Exercise Streak (Summary)

```tracker-pro
type: summary
folder: Data/Exercise
dateProperty: creation_date
dateRange: last-365-days
title: Exercise Stats — Last Year
summary:
  template: |
    Total sessions: {{totalDays()}}
    Current streak: {{currentStreak()}}
    Longest streak: {{maxStreak()}}
    Days since last session: {{currentBreaks()}}
    Longest break: {{maxBreaks()}}
```

---

## Sets Summary (Summary with values)

```tracker-pro
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
