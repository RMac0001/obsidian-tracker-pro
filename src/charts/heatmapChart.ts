import { SeriesData, TrackerConfig } from "../types";

// ─── Color Schemes ────────────────────────────────────────────────────────────

const COLOR_SCHEMES: Record<string, string[]> = {
  green:  ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
  blue:   ["#ebedf0", "#b8d9f8", "#6fb0f5", "#2e86de", "#1558a0"],
  red:    ["#ebedf0", "#f9b8b8", "#f57272", "#e03434", "#9c1515"],
  orange: ["#ebedf0", "#fdd9a0", "#fbb041", "#f07c00", "#a85200"],
  purple: ["#ebedf0", "#d5b8f8", "#a96ef5", "#7c2fed", "#500a9c"],
};

function getColor(value: number | null, max: number, scheme: string[]): string {
  if (value === null || value === 0) return scheme[0];
  const pct = Math.min(value / max, 1);
  const idx = Math.ceil(pct * (scheme.length - 1));
  return scheme[Math.max(1, idx)];
}

// ─── Heatmap Renderer ─────────────────────────────────────────────────────────

export function renderHeatmapChart(
  container: HTMLElement,
  series: SeriesData[],
  config: TrackerConfig
): void {
  const s = series[0];
  if (!s || s.points.length === 0) {
    container.innerHTML = "<p>No data</p>";
    return;
  }

  const scheme = COLOR_SCHEMES[config.colorScheme ?? "green"];

  // Build date → value map
  const valueMap = new Map<string, number>();
  let maxVal = 0;
  for (const pt of s.points) {
    if (pt.value === null) continue;
    const key = `${pt.date.getFullYear()}-${String(pt.date.getMonth() + 1).padStart(2,"0")}-${String(pt.date.getDate()).padStart(2,"0")}`;
    valueMap.set(key, pt.value);
    if (pt.value > maxVal) maxVal = pt.value;
  }

  // Determine year span
  const allDates = s.points.map((p) => p.date);
  const startDate = allDates[0];
  const endDate   = allDates[allDates.length - 1];

  // Build weekly columns
  const CELL = 12, GAP = 2, CELL_STEP = CELL + GAP;
  const MONTH_LABEL_H = 18, DOW_LABEL_W = 24;
  const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Find Sunday ≤ startDate
  const cursor = new Date(startDate);
  cursor.setDate(cursor.getDate() - cursor.getDay());

  const columns: Array<Array<{ date: Date; key: string }>> = [];

  while (cursor <= endDate) {
    const col: Array<{ date: Date; key: string }> = [];
    for (let d = 0; d < 7; d++) {
      col.push({
        date: new Date(cursor),
        key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2,"0")}-${String(cursor.getDate()).padStart(2,"0")}`,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    columns.push(col);
  }

  const W = DOW_LABEL_W + columns.length * CELL_STEP + 10;
  const H = MONTH_LABEL_H + 7 * CELL_STEP + 10;

  // Build month label positions
  const monthLabels: Array<{ x: number; label: string }> = [];
  let lastMonth = -1;
  columns.forEach((col, i) => {
    const m = col[0].date.getMonth();
    if (m !== lastMonth) {
      monthLabels.push({ x: DOW_LABEL_W + i * CELL_STEP, label: MONTHS[m] });
      lastMonth = m;
    }
  });

  // Build cells
  let cells = "";
  columns.forEach((col, ci) => {
    col.forEach((cell, ri) => {
      const inRange = cell.date >= startDate && cell.date <= endDate;
      const v = valueMap.get(cell.key) ?? null;
      const color = inRange ? getColor(v, maxVal, scheme) : scheme[0];
      const tooltip = inRange
        ? `${cell.key}: ${v !== null ? v : "no data"}`
        : "";
      const x = DOW_LABEL_W + ci * CELL_STEP;
      const y = MONTH_LABEL_H + ri * CELL_STEP;
      cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${color}">
        ${tooltip ? `<title>${tooltip}</title>` : ""}
      </rect>`;
    });
  });

  // DOW labels (Mon, Wed, Fri)
  const dowLabels = [1, 3, 5].map((d) => {
    const y = MONTH_LABEL_H + d * CELL_STEP + CELL - 2;
    return `<text x="0" y="${y}" font-size="9" fill="currentColor" opacity="0.5">${DOW_LABELS[d].slice(0, 3)}</text>`;
  }).join("");

  const monthLabelSvg = monthLabels.map(({ x, label }) =>
    `<text x="${x}" y="${MONTH_LABEL_H - 4}" font-size="10" fill="currentColor" opacity="0.7">${label}</text>`
  ).join("");

  // Legend
  const legendX = DOW_LABEL_W;
  const legendY = H - 4;
  const legendCells = scheme.map((c, i) =>
    `<rect x="${legendX + i * (CELL + 3)}" y="${legendY}" width="${CELL}" height="${CELL}" rx="2" fill="${c}"/>`
  ).join("");

  const titleSvg = config.title
    ? `<text x="${DOW_LABEL_W}" y="12" font-size="13" font-weight="bold" fill="currentColor">${config.title}</text>`
    : "";

  const svgH = config.title ? H + 20 : H;
  const offsetY = config.title ? 20 : 0;

  const svg = `
<svg viewBox="0 0 ${W} ${svgH + CELL + 10}" xmlns="http://www.w3.org/2000/svg"
     style="width:100%;max-width:${W}px;display:block;overflow:visible;">
  ${titleSvg}
  <g transform="translate(0,${offsetY})">
    ${monthLabelSvg}
    ${dowLabels}
    ${cells}
    ${legendCells}
    <text x="${legendX + scheme.length * (CELL + 3) + 4}" y="${legendY + CELL - 1}" font-size="9" fill="currentColor" opacity="0.6">more</text>
    <text x="${legendX - 26}" y="${legendY + CELL - 1}" font-size="9" fill="currentColor" opacity="0.6">less</text>
  </g>
</svg>`;

  container.innerHTML = svg;
}
