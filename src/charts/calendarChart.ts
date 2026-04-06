import { SeriesData, TrackerConfig } from "../types";

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const DOW_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const COLOR_SCHEMES: Record<string, string> = {
  green:  "#2ea44f",
  blue:   "#4f86f7",
  red:    "#e74c3c",
  orange: "#e67e22",
  purple: "#9b59b6",
};

export function renderCalendarChart(
  container: HTMLElement,
  series: SeriesData[],
  config: TrackerConfig
): void {
  const s = series[0];
  if (!s || s.points.length === 0) {
    container.innerHTML = "<p>No data</p>";
    return;
  }

  // Build value map: "YYYY-MM-DD" -> number
  const valueMap = new Map<string, number>();
  let maxVal = 0;
  for (const pt of s.points) {
    if (pt.value === null) continue;
    const key = pt.date.toISOString().slice(0, 10);
    valueMap.set(key, pt.value);
    if (pt.value > maxVal) maxVal = pt.value;
  }

  // Resolve accent color
  const schemeColor = config.colorScheme ? COLOR_SCHEMES[config.colorScheme] : null;
  const accentColor = config.colors?.[0] ?? schemeColor ?? COLOR_SCHEMES.blue;

  // Always start on the current month
  const today = new Date();
  let viewYear  = today.getFullYear();
  let viewMonth = today.getMonth();

  // Today
  const todayStr = today.toISOString().slice(0, 10);

  function hexToRgb(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
  }

  function cellBg(value: number): string {
    const pct = maxVal > 0 ? Math.min(value / maxVal, 1) : 0.3;
    const alpha = 0.15 + pct * 0.75;
    const [r, g, b] = hexToRgb(accentColor);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function dateKey(y: number, m: number, d: number): string {
    return `${y}-${String(m + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }

  function render() {
    container.empty();

    const wrap = container.createDiv({ cls: "tpro-cal-wrap" });

    // ── Header ────────────────────────────────────────────────────────────────
    const header = wrap.createDiv({ cls: "tpro-cal-header" });

    const monthLabel = header.createDiv({ cls: "tpro-cal-monthlabel" });
    monthLabel.createSpan({ cls: "tpro-cal-month", text: MONTHS[viewMonth].slice(0, 3) });
    monthLabel.createEl("br");
    monthLabel.createSpan({ cls: "tpro-cal-year", text: String(viewYear) });

    if (config.title) {
      header.createDiv({ cls: "tpro-cal-title", text: config.title });
    }

    const nav = header.createDiv({ cls: "tpro-cal-nav" });
    const btnPrev = nav.createEl("button", { cls: "tpro-cal-btn", text: "‹" });
    const btnToday = nav.createEl("button", { cls: "tpro-cal-btn tpro-cal-btn-dot", text: "○" });
    const btnNext = nav.createEl("button", { cls: "tpro-cal-btn", text: "›" });

    btnPrev.addEventListener("click", () => {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      render();
    });
    btnNext.addEventListener("click", () => {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      render();
    });
    btnToday.addEventListener("click", () => {
      const t = new Date();
      viewYear = t.getFullYear();
      viewMonth = t.getMonth();
      render();
    });

    // ── DOW Row ───────────────────────────────────────────────────────────────
    const grid = wrap.createDiv({ cls: "tpro-cal-grid" });

    DOW_LABELS.forEach(d => {
      grid.createDiv({ cls: "tpro-cal-dow", text: d });
    });

    // ── Day Cells ─────────────────────────────────────────────────────────────
    const firstDow = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrev  = new Date(viewYear, viewMonth, 0).getDate();

    // Tooltip element (shared)
    const tooltip = wrap.createDiv({ cls: "tpro-cal-tooltip" });
    tooltip.style.display = "none";

    // Leading overflow (prev month)
    for (let i = 0; i < firstDow; i++) {
      const day = daysInPrev - firstDow + i + 1;
      const cell = grid.createDiv({ cls: "tpro-cal-cell tpro-cal-overflow" });
      cell.createSpan({ text: String(day) });
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      const key = dateKey(viewYear, viewMonth, day);
      const value = valueMap.get(key);
      const isToday = key === todayStr;

      const cell = grid.createDiv({ cls: "tpro-cal-cell" + (isToday ? " tpro-cal-today" : "") });
      if (isToday) cell.style.setProperty("--accent", accentColor);

      const span = cell.createSpan({ text: String(day) });

      if (value !== undefined) {
        cell.style.background = cellBg(value);
        cell.style.cursor = "pointer";
        cell.addClass("tpro-cal-hasvalue");

        cell.addEventListener("mouseenter", (e) => {
          tooltip.setText(`${key}: ${value}`);
          tooltip.style.display = "block";
        });
        cell.addEventListener("mouseleave", () => {
          tooltip.style.display = "none";
        });
        cell.addEventListener("click", () => {
          // Toggle a persistent label on click
          const existing = cell.querySelector(".tpro-cal-valuelabel");
          if (existing) {
            existing.remove();
          } else {
            // Remove any other open labels first
            wrap.querySelectorAll(".tpro-cal-valuelabel").forEach(el => el.remove());
            cell.createDiv({ cls: "tpro-cal-valuelabel", text: String(value) });
          }
        });
      }
    }

    // Trailing overflow (next month)
    const totalCells = firstDow + daysInMonth;
    const trailingCount = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= trailingCount; i++) {
      const cell = grid.createDiv({ cls: "tpro-cal-cell tpro-cal-overflow" });
      cell.createSpan({ text: String(i) });
    }

    // ── Styles (injected once per render) ─────────────────────────────────────
    const styleId = "tpro-cal-styles";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .tpro-cal-wrap { font-family: var(--font-interface, sans-serif); user-select: none; }
        .tpro-cal-header { display: flex; align-items: center; margin-bottom: 8px; }
        .tpro-cal-monthlabel { min-width: 60px; line-height: 1.1; }
        .tpro-cal-month { font-size: 1em; font-weight: 600; color: ${accentColor}; }
        .tpro-cal-year  { font-size: 1.4em; font-weight: 800; color: ${accentColor}; }
        .tpro-cal-title { flex: 1; text-align: center; font-size: 1.1em; font-weight: 600;
                          color: var(--text-normal); }
        .tpro-cal-nav   { display: flex; gap: 4px; margin-left: auto; }
        .tpro-cal-btn   { background: none; border: none; cursor: pointer; font-size: 1.2em;
                          color: var(--text-muted); padding: 2px 6px; border-radius: 4px;
                          line-height: 1; }
        .tpro-cal-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
        .tpro-cal-grid  { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
        .tpro-cal-dow   { text-align: center; font-size: 0.8em; color: var(--text-muted);
                          padding: 4px 0; font-weight: 500;
                          border-bottom: 1px solid var(--background-modifier-border); }
        .tpro-cal-cell  { text-align: center; padding: 6px 2px; border-radius: 6px;
                          font-size: 0.9em; color: var(--text-normal); position: relative;
                          min-height: 32px; }
        .tpro-cal-overflow { color: var(--text-faint) !important; }
        .tpro-cal-today span {
          display: inline-flex; align-items: center; justify-content: center;
          width: 24px; height: 24px; border-radius: 50%;
          background: ${accentColor}; color: #fff; font-weight: 700;
        }
        .tpro-cal-hasvalue { font-weight: 600; }
        .tpro-cal-valuelabel {
          position: absolute; bottom: 2px; left: 50%; transform: translateX(-50%);
          font-size: 0.65em; color: var(--text-muted); white-space: nowrap;
          background: var(--background-primary); border-radius: 3px;
          padding: 0 3px; pointer-events: none;
        }
        .tpro-cal-tooltip {
          position: fixed; background: var(--background-secondary);
          border: 1px solid var(--background-modifier-border);
          border-radius: 6px; padding: 4px 8px; font-size: 0.8em;
          color: var(--text-normal); pointer-events: none; z-index: 9999;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
      `;
      document.head.appendChild(style);
    }
  }

  render();
}
