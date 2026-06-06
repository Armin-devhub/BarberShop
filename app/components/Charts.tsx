// Lightweight SVG charts for the admin dashboard, built on react-native-svg so
// they render identically on the web PWA and in Expo Go. No external chart lib.

import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText
} from 'react-native-svg';

interface Pt {
  x: number;
  y: number;
}

// Catmull-Rom → cubic-bezier smoothing for a soft, modern line.
function smoothPath(pts: Pt[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

function pointsFor(values: number[], w: number, h: number, pad: number): Pt[] {
  const max = Math.max(1, ...values);
  const n = values.length;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  return values.map((v, i) => ({
    x: pad + i * stepX,
    y: pad + innerH * (1 - v / max)
  }));
}

/** Full-width smooth area chart with a soft gradient fill and an end dot. */
export function AreaChart({
  values,
  width,
  height = 130,
  color = '#6366F1'
}: {
  values: number[];
  width: number;
  height?: number;
  color?: string;
}) {
  if (width <= 0 || values.length === 0) return null;
  const pad = 8;
  const pts = pointsFor(values, width, height, pad);
  const line = smoothPath(pts);
  const last = pts[pts.length - 1];
  const first = pts[0];
  const area = `${line} L ${last.x},${height - pad} L ${first.x},${height - pad} Z`;
  const gid = 'areaGrad';
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.22} />
          <Stop offset="1" stopColor={color} stopOpacity={0.02} />
        </LinearGradient>
      </Defs>
      <Path d={area} fill={`url(#${gid})`} />
      <Path
        d={line}
        stroke={color}
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={last.x} cy={last.y} r={4} fill={color} stroke="#fff" strokeWidth={2} />
    </Svg>
  );
}

/** Compact sparkline (line + faint fill). Good inside KPI / feature cards. */
export function Sparkline({
  values,
  width,
  height = 44,
  color = '#FFFFFF',
  fillOpacity = 0.18
}: {
  values: number[];
  width: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
}) {
  if (width <= 0 || values.length === 0) return null;
  const pad = 4;
  const pts = pointsFor(values, width, height, pad);
  const line = smoothPath(pts);
  const last = pts[pts.length - 1];
  const first = pts[0];
  const area = `${line} L ${last.x},${height - pad} L ${first.x},${height - pad} Z`;
  return (
    <Svg width={width} height={height}>
      <Path d={area} fill={color} fillOpacity={fillOpacity} />
      <Path
        d={line}
        stroke={color}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={last.x} cy={last.y} r={3} fill={color} />
    </Svg>
  );
}

/** Vertical bar chart. Tallest bar is solid; the rest are tinted. Optional
 *  value labels render above each bar. */
export function BarChart({
  values,
  width,
  height = 130,
  color = '#6366F1',
  highlightMax = true,
  showValues = false,
  formatValue
}: {
  values: number[];
  width: number;
  height?: number;
  color?: string;
  highlightMax?: boolean;
  showValues?: boolean;
  formatValue?: (v: number) => string;
}) {
  if (width <= 0 || values.length === 0) return null;
  const topPad = showValues ? 16 : 4;
  const max = Math.max(1, ...values);
  const n = values.length;
  const gap = Math.max(4, Math.min(14, (width / n) * 0.3));
  const barW = (width - gap * (n - 1)) / n;
  const r = Math.min(6, barW / 2);
  const drawH = height - topPad;
  return (
    <Svg width={width} height={height}>
      {values.map((v, i) => {
        const h = v > 0 ? Math.max(3, (v / max) * drawH) : 0;
        const x = i * (barW + gap);
        const y = topPad + (drawH - h);
        const isMax = highlightMax && v === max && v > 0;
        return (
          <G key={i}>
            <Rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, 1)}
              rx={r}
              fill={color}
              fillOpacity={isMax ? 1 : 0.4}
            />
            {showValues && v > 0 && (
              <SvgText
                x={x + barW / 2}
                y={y - 4}
                fontSize={9}
                fontWeight="700"
                fill="#64748B"
                textAnchor="middle"
              >
                {formatValue ? formatValue(v) : String(v)}
              </SvgText>
            )}
          </G>
        );
      })}
    </Svg>
  );
}

export interface DonutSlice {
  value: number;
  color: string;
}

/** Donut with rounded segment gaps. Children render in the center hole. */
export function Donut({
  data,
  size = 150,
  thickness = 22
}: {
  data: DonutSlice[];
  size?: number;
  thickness?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;
  let offset = 0;
  return (
    <Svg width={size} height={size}>
      <G rotation={-90} origin={`${cx},${cy}`}>
        {/* Track */}
        <Circle cx={cx} cy={cy} r={r} stroke="#EEF0F3" strokeWidth={thickness} fill="none" />
        {total > 0 &&
          data.map((d, i) => {
            const frac = d.value / total;
            const len = frac * c;
            const el = (
              <Circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                stroke={d.color}
                strokeWidth={thickness}
                fill="none"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
      </G>
    </Svg>
  );
}

/** A horizontal gradient rectangle, used as a card background. */
export function GradientBg({
  width,
  height,
  from,
  to,
  radius = 16
}: {
  width: number;
  height: number;
  from: string;
  to: string;
  radius?: number;
}) {
  if (width <= 0 || height <= 0) return null;
  return (
    <Svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
      <Defs>
        <LinearGradient id="cardGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} rx={radius} ry={radius} fill="url(#cardGrad)" />
    </Svg>
  );
}
