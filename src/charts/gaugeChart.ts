import { SeriesData, TrackerConfig } from "../types";

// ─── Gauge (SVG) ──────────────────────────────────────────────────────────────
// Renders a half-circle gauge using the latest value from the first series.

export function renderGaugeChart(
  container: HTMLElement,
  allSeries: SeriesData[],
  config: TrackerConfig
): void {
  const series = allSeries[0];
  const valid  = series?.points.filter((p) => p.value !== null) ?? [];
  const latest = valid.length > 0 ? (valid[valid.length - 1].value as number) : 0;

  const min = config.min ?? 0;
  const max = config.max ?? 100;
  const clamped = Math.min(max, Math.max(min, latest));
  const pct = (clamped - min) / (max - min); // 0–1

  // Gauge arc: half circle from 180° to 0° (left to right)
  const W = 300, H = 180;
  const cx = W / 2, cy = H - 20;
  const r = 110;

  function polarToXY(angleDeg: number, radius: number) {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    };
  }

  // Thresholds → color zones
  const thresholds = config.thresholds ?? [
    { value: min + (max - min) * 0.33, color: "#e74c3c" },
    { value: min + (max - min) * 0.66, color: "#f7c948" },
    { value: max, color: "#43c59e" },
  ];

  function buildArcPath(startPct: number, endPct: number) {
    // Angle: 180° = left (min), 0° = right (max). Mapped: angle = 180 - pct*180
    const startAngle = 180 - startPct * 180;
    const endAngle   = 180 - endPct * 180;
    const start = polarToXY(startAngle, r);
    const end   = polarToXY(endAngle, r);
    const largeArc = Math.abs(endPct - startPct) > 0.5 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  }

  // Needle
  const needleAngle = 180 - pct * 180;
  const needleTip   = polarToXY(needleAngle, r - 15);
  const needleLeft  = polarToXY(needleAngle + 90, 8);
  const needleRight = polarToXY(needleAngle - 90, 8);

  // Build zone paths
  let prevPct = 0;
  const zonePaths: string[] = [];
  for (const t of thresholds) {
    const endPct = (t.value - min) / (max - min);
    zonePaths.push(
      `<path d="${buildArcPath(prevPct, Math.min(endPct, 1))}" stroke="${t.color}" stroke-width="18" fill="none" stroke-linecap="butt"/>`
    );
    prevPct = endPct;
    if (prevPct >= 1) break;
  }

  // Min / max labels
  const minPos = polarToXY(180, r + 18);
  const maxPos = polarToXY(0, r + 18);

  const svg = `
<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" 
     style="width:100%;max-width:${W}px;display:block;margin:auto;">
  ${config.title ? `<text x="${cx}" y="16" text-anchor="middle" font-size="13" font-weight="bold" fill="currentColor">${config.title}</text>` : ""}
  <!-- Background arc -->
  <path d="${buildArcPath(0, 1)}" stroke="#e8e8e8" stroke-width="18" fill="none" stroke-linecap="butt"/>
  <!-- Color zones -->
  ${zonePaths.join("\n  ")}
  <!-- Needle -->
  <polygon points="${needleTip.x},${needleTip.y} ${needleLeft.x},${needleLeft.y} ${cx},${cy} ${needleRight.x},${needleRight.y}"
           fill="currentColor" opacity="0.75"/>
  <circle cx="${cx}" cy="${cy}" r="8" fill="currentColor"/>
  <!-- Value label -->
  <text x="${cx}" y="${cy - 20}" text-anchor="middle" font-size="20" font-weight="bold" fill="currentColor">
    ${clamped.toFixed(1)}${config.yAxis?.unit ?? ""}
  </text>
  <!-- Min / Max -->
  <text x="${minPos.x}" y="${minPos.y}" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.6">${min}</text>
  <text x="${maxPos.x}" y="${maxPos.y}" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.6">${max}</text>
  <!-- Series name -->
  <text x="${cx}" y="${H - 4}" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.7">${series?.name ?? ""}</text>
</svg>`;

  container.innerHTML = svg;
}
