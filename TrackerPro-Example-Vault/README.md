# Tracker Pro — Example Vault

This vault contains sample data and pre-built dashboards for **Tracker Pro**.

Data covers **April 5 2025 → April 4 2026** so all date ranges work on
first open (last-30-days, last-90-days, this-year, last-365-days, etc.).

## Setup

1. Open this folder as a vault in Obsidian (File → Open Vault → Open Folder as Vault).
2. Install the Tracker Pro plugin: drop `main.js`, `manifest.json`, `styles.css`
   into `.obsidian/plugins/obsidian-tracker-pro/`.
3. Enable the plugin in Settings → Community Plugins.
4. Open any file in `Dashboards/`.

## Vault Structure

```
Data/
  Daily/       365 notes — date, mood, energy, sleep, weight, steps, water
  Exercise/    245 notes — creation_date, exercise, sets, reps, time_min
  Journal/      60 notes — creation_date + body text (for fileMeta word counts)
  Finance/     260 notes — date, open, high, low, close, volume

Dashboards/
  Health Dashboard.md    line, bar, heatmap, calendar, scatter, radar, gauge, summary
  Exercise Dashboard.md  pie, donut, bar, line, heatmap, calendar, summary
  Finance Dashboard.md   candlestick, line, bar, summary
  Writing Dashboard.md   fileMeta bar, line, heatmap, summary
```
