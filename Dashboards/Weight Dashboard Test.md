# Weight Progress Dashboard

> Data source: `Data/Daily Notes` — weekly weigh-in notes with a `weight` frontmatter property.
> Starting weight: **366.2 lbs** (January 1, 2026) | Goal: **180 lbs**

---

## Current Weight (Gauge)

```tracker-pro
type: gauge
folder: Data/Daily Notes
dateProperty: creation_date
dateRange: this-year
properties:
  - weight
min: 180
max: 366.2
title: Weight Progress
thresholds:
  - value: 270
    color: "#e74c3c"
  - value: 225
    color: "#f7c948"
  - value: 366.2
    color: "#43c59e"
```

---

## Progress Summary

```tracker-pro
type: summary
folder: Data/Daily Notes
dateProperty: creation_date
dateRange: this-year
properties:
  - weight
title: Weight Stats
summary:
  template: |
    Starting weight: 366.2 lbs
    Current weight: {{latest()}} lbs
    Lbs lost: {{diffFrom(366.2)}} lbs
    Lbs to goal: {{latestTo(180)}} lbs
    Lowest recorded: {{min()}} lbs
    Weigh-ins logged: {{totalDays()}}
```

---

## Weight Trend — This Year

```tracker-pro
type: line
folder: Data/Daily Notes
dateProperty: creation_date
dateRange: this-year
properties:
  - weight
title: Weight Trend
colors:
  - "#4f86f7"
yAxis:
  label: lbs
  min: 150
  max: 380
showLegend: false
```

> **Note on the gauge thresholds:** The gauge needle travels from `min` (180, goal) on the left to `max` (366.2, start) on the right. The thresholds define colour zones — red for the far range (270–366.2), yellow for the middle range (225–270), green for close to goal (180–225). The needle will sit at the current weight.
