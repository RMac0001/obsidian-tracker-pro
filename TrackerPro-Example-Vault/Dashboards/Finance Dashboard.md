# Finance Dashboard

> Data source: `Data/Finance` — one note per trading day with frontmatter:
> `date`, `open`, `high`, `low`, `close`, `volume`

---

## Price Chart — Last 60 Days (Candlestick)

```tracker-pro
type: candlestick
folder: Data/Finance
dateRange: last-60-days
properties:
  open: open
  high: high
  low: low
  close: close
  volume: volume
title: Stock Price
colors:
  - "#43c59e"
  - "#f76c6c"
height: 350
```

---

## Closing Price — This Year (Line)

```tracker-pro
type: line
folder: Data/Finance
dateRange: this-year
properties:
  - close
title: Closing Price
colors:
  - "#4f86f7"
yAxis:
  label: Price ($)
showLegend: false
```

---

## Monthly Average Close (Bar)

```tracker-pro
type: bar
folder: Data/Finance
dateRange: last-365-days
properties:
  - close
aggregate: monthly
title: Monthly Average Close
colors:
  - "#9b59b6"
yAxis:
  label: Avg Price ($)
showLegend: false
```

---

## Price Stats (Summary)

```tracker-pro
type: summary
folder: Data/Finance
dateRange: this-year
properties:
  - close
title: Close Price — This Year
summary:
  template: |
    Trading days: {{totalDays()}}
    Total close sum: {{sum()}}
    Average close: {{mean()}}
    Highest close: {{max()}}
```
