import { OHLCDataPoint, TrackerConfig } from "../types";

// ─── Candlestick (SVG) ────────────────────────────────────────────────────────

export function renderCandlestickChart(
  container: HTMLElement,
  data: OHLCDataPoint[],
  config: TrackerConfig
): void {
  if (data.length === 0) {
    container.innerHTML = "<p>No OHLC data</p>";
    return;
  }

  const BULL_COLOR  = config.colors?.[0] ?? "#43c59e";
  const BEAR_COLOR  = config.colors?.[1] ?? "#f76c6c";
  const PAD_LEFT    = 50, PAD_RIGHT = 16, PAD_TOP = 30, PAD_BOTTOM = 32;
  const W           = 700;
  const H           = config.height ?? 300;
  const chartW      = W - PAD_LEFT - PAD_RIGHT;
  const chartH      = H - PAD_TOP - PAD_BOTTOM;

  const allHighs  = data.map((d) => d.high);
  const allLows   = data.map((d) => d.low);
  const priceMin  = Math.min(...allLows);
  const priceMax  = Math.max(...allHighs);
  const priceRange = priceMax - priceMin || 1;

  function toY(price: number): number {
    return PAD_TOP + chartH - ((price - priceMin) / priceRange) * chartH;
  }

  const candleW   = Math.max(3, Math.min(14, (chartW / data.length) * 0.7));
  const spacing   = chartW / data.length;

  // Build candles
  let candlesSvg = "";
  data.forEach((d, i) => {
    const x    = PAD_LEFT + i * spacing + spacing / 2;
    const isBull = d.close >= d.open;
    const color  = isBull ? BULL_COLOR : BEAR_COLOR;

    const bodyTop = toY(Math.max(d.open, d.close));
    const bodyBot = toY(Math.min(d.open, d.close));
    const bodyH   = Math.max(1, bodyBot - bodyTop);

    const wickTop = toY(d.high);
    const wickBot = toY(d.low);

    candlesSvg += `
      <line x1="${x}" y1="${wickTop}" x2="${x}" y2="${wickBot}" stroke="${color}" stroke-width="1"/>
      <rect x="${x - candleW / 2}" y="${bodyTop}" width="${candleW}" height="${bodyH}"
            fill="${isBull ? color : color}" stroke="${color}" stroke-width="1">
        <title>${d.date.toISOString().slice(0, 10)} O:${d.open} H:${d.high} L:${d.low} C:${d.close}</title>
      </rect>`;
  });

  // Y-axis gridlines + labels
  const TICK_COUNT = 5;
  let gridSvg = "";
  for (let i = 0; i <= TICK_COUNT; i++) {
    const price = priceMin + (priceRange / TICK_COUNT) * i;
    const y = toY(price);
    gridSvg += `
      <line x1="${PAD_LEFT}" y1="${y}" x2="${W - PAD_RIGHT}" y2="${y}"
            stroke="currentColor" stroke-width="0.3" opacity="0.25"/>
      <text x="${PAD_LEFT - 4}" y="${y + 4}" text-anchor="end" font-size="9"
            fill="currentColor" opacity="0.6">${price.toFixed(2)}</text>`;
  }

  // X-axis date labels (every N candles to avoid crowding)
  const labelStep = Math.max(1, Math.ceil(data.length / 8));
  let xLabels = "";
  data.forEach((d, i) => {
    if (i % labelStep !== 0) return;
    const x = PAD_LEFT + i * spacing + spacing / 2;
    const label = d.date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    xLabels += `<text x="${x}" y="${H - 6}" text-anchor="middle" font-size="9"
      fill="currentColor" opacity="0.6">${label}</text>`;
  });

  const title = config.title
    ? `<text x="${W / 2}" y="16" text-anchor="middle" font-size="13" font-weight="bold" fill="currentColor">${config.title}</text>`
    : "";

  const svg = `
<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
     style="width:100%;max-width:${W}px;display:block;">
  ${title}
  <!-- Grid -->
  <rect x="${PAD_LEFT}" y="${PAD_TOP}" width="${chartW}" height="${chartH}" fill="none"/>
  ${gridSvg}
  <!-- Candles -->
  ${candlesSvg}
  <!-- X axis -->
  <line x1="${PAD_LEFT}" y1="${H - PAD_BOTTOM}" x2="${W - PAD_RIGHT}" y2="${H - PAD_BOTTOM}"
        stroke="currentColor" opacity="0.3"/>
  ${xLabels}
  <!-- Legend -->
  <rect x="${PAD_LEFT}" y="${PAD_TOP - 16}" width="10" height="10" fill="${BULL_COLOR}" rx="2"/>
  <text x="${PAD_LEFT + 13}" y="${PAD_TOP - 7}" font-size="9" fill="currentColor">Bullish</text>
  <rect x="${PAD_LEFT + 60}" y="${PAD_TOP - 16}" width="10" height="10" fill="${BEAR_COLOR}" rx="2"/>
  <text x="${PAD_LEFT + 73}" y="${PAD_TOP - 7}" font-size="9" fill="currentColor">Bearish</text>
</svg>`;

  container.innerHTML = svg;
}
