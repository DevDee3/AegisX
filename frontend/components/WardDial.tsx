"use client";

const TIER_COLOR: Record<string, string> = {
  LOW: "var(--signal-mint)",
  MEDIUM: "var(--signal-amber)",
  HIGH: "var(--signal-ember)",
  CRITICAL: "var(--signal-avalanche)",
};

// Mirrors RiskPolicy.sol exactly: lowMax=30, mediumMax=60, highMax=80.
// The tick marks on this dial are not decorative — they are the literal
// on-chain thresholds that decide ALLOW/REQUIRE_APPROVAL/DELAY/BLOCK.
const THRESHOLDS = [30, 60, 80];

const ARC_START = -120; // degrees
const ARC_END = 120;
const ARC_SPAN = ARC_END - ARC_START;

function angleForScore(score: number): number {
  return ARC_START + (score / 100) * ARC_SPAN;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

export function WardDial({ score, level }: { score: number; level: string }) {
  const cx = 110;
  const cy = 110;
  const r = 84;
  const color = TIER_COLOR[level] ?? "var(--ward-mist)";
  const needleAngle = angleForScore(score);

  return (
    <svg viewBox="0 0 220 150" width="220" height="150" role="img" aria-label={`Risk score ${score} out of 100, ${level}`}>
      {/* track */}
      <path d={arcPath(cx, cy, r, ARC_START, ARC_END)} fill="none" stroke="var(--ward-line)" strokeWidth="10" strokeLinecap="round" />
      {/* filled arc up to current score */}
      <path
        d={arcPath(cx, cy, r, ARC_START, needleAngle)}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        style={{ transition: "d 0.4s ease, stroke 0.3s ease" }}
      />
      {/* threshold ticks — the real on-chain boundaries */}
      {THRESHOLDS.map((t) => {
        const angle = angleForScore(t);
        const inner = polarToCartesian(cx, cy, r - 14, angle);
        const outer = polarToCartesian(cx, cy, r + 14, angle);
        return (
          <line
            key={t}
            x1={inner.x}
            y1={inner.y}
            x2={outer.x}
            y2={outer.y}
            stroke="var(--ward-mist-dim)"
            strokeWidth="1.5"
          />
        );
      })}
      <text x={cx} y={cy - 8} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="34" fontWeight="700" fill={color}>
        {score}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" letterSpacing="0.1em" fill="var(--ward-mist)">
        RISK / 100
      </text>
    </svg>
  );
}
