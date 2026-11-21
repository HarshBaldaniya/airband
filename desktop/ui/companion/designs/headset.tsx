// The "headset" design: a round orange figure with a headset and an antenna light, floating over a
// soft glow. The light says the state (blue working, amber needs you, green done) and the figure
// sits down to rest. Every part is always drawn and moods only fade parts in and out, so one mood
// flows into the next. Its moves are in headset.css.
import type { CompanionDesign, FigureProps, Mood } from "../types";
import "./headset.css";

const LIGHT: Record<Mood, string> = {
  hello: "#3fb57d",
  idle: "#8fd3ff",
  working: "#4f94f0",
  needs: "#e0a22c",
  done: "#3fb57d",
  resting: "#6b6b75",
  talking: "#E07A4F",
  thinking: "#b28cf5",
  dizzy: "#e0a22c",
};

const FONT = "-apple-system, system-ui, sans-serif";

function Figure({ mood, look, blinking, gesture, count, size, label }: FigureProps) {
  const sitting = mood === "resting";
  const happy = mood === "done" || mood === "hello";
  const eyesOpen = !sitting && !happy && mood !== "dizzy";
  const glance = gesture === "look-left" ? -1 : gesture === "look-right" ? 1 : 0;
  const px = Math.max(-1, Math.min(1, glance || look.dx)) * 4.5;
  const py = Math.max(-1, Math.min(1, glance ? 0 : look.dy)) * 3 + (mood === "thinking" ? -4 : mood === "working" ? 1.5 : 0);
  const show = (on: boolean) => (on ? "fig-on" : "fig-off");
  return (
    <svg className={`figure design-headset mood-${mood}${gesture ? ` gesture-${gesture}` : ""}`} width={size} height={size * 1.2} viewBox="0 0 200 240" role="img" aria-label={label}>
      <defs>
        <radialGradient id="headset-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffb38a" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#e07a4f" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#e07a4f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse className="fig-shadow" cx="100" cy="228" rx="46" ry="6" fill="#000" />
      <g className="fig-float">
        <g className="fig-body">
          <ellipse className={`fig-glow ${show(!sitting)}`} cx="100" cy="204" rx="40" ry="9" fill="url(#headset-glow)" />
          <g className="fig-antenna">
            <line x1="100" y1="44" x2="100" y2="20" stroke="#2a2a30" strokeWidth="5" strokeLinecap="round" />
            <circle className="fig-light" cx="100" cy="15" r="8" fill={LIGHT[mood]} />
          </g>
          <ellipse cx="78" cy="186" rx="15" ry="8" fill="#b85a34" />
          <ellipse cx="122" cy="186" rx="15" ry="8" fill="#b85a34" />
          <ellipse className="fig-arm-left" cx="34" cy="140" rx="10" ry="15" fill="#c9653d" />
          <ellipse className="fig-arm-right" cx="166" cy="140" rx="10" ry="15" fill="#c9653d" />
          <rect x="32" y="40" width="136" height="146" rx="62" fill="#E07A4F" />
          <ellipse cx="100" cy="156" rx="42" ry="25" fill="#ee9a74" />
          <ellipse cx="72" cy="66" rx="18" ry="9" fill="#f29a72" opacity="0.6" />
          <path d="M44 96 C44 50 70 36 100 36 C130 36 156 50 156 96" stroke="#2a2a30" strokeWidth="9" fill="none" strokeLinecap="round" />
          <rect x="24" y="82" width="22" height="36" rx="10" fill="#2a2a30" />
          <rect x="154" y="82" width="22" height="36" rx="10" fill="#2a2a30" />
          <path d="M35 116 C40 140 58 150 74 150" stroke="#2a2a30" strokeWidth="5" fill="none" strokeLinecap="round" />
          <circle cx="78" cy="150" r="6" fill="#2a2a30" />

          <g className={`fig-eyes ${show(eyesOpen)}${blinking ? " fig-blink" : ""}`}>
            <ellipse cx="80" cy="104" rx="14" ry={mood === "needs" ? 17 : 16} fill="#fff" />
            <ellipse cx="120" cy="104" rx="14" ry={mood === "needs" ? 17 : 16} fill="#fff" />
            <g className="fig-pupils" style={{ transform: `translate(${px}px, ${py}px)` }}>
              <circle cx="82" cy="106" r="7.5" fill="#141416" />
              <circle cx="122" cy="106" r="7.5" fill="#141416" />
              <circle cx="85" cy="102" r="2.5" fill="#fff" />
              <circle cx="125" cy="102" r="2.5" fill="#fff" />
            </g>
          </g>
          <g className={show(happy)} stroke="#141416" strokeWidth="4.5" fill="none" strokeLinecap="round">
            <path d="M66 108 Q80 94 94 108" />
            <path d="M106 108 Q120 94 134 108" />
          </g>
          <g className={show(sitting)} stroke="#141416" strokeWidth="4" fill="none" strokeLinecap="round">
            <path d="M68 108 Q80 116 92 108" />
            <path d="M108 108 Q120 116 132 108" />
          </g>
          <g className={show(mood === "dizzy")} stroke="#141416" strokeWidth="4" strokeLinecap="round" fill="none">
            <path className="fig-spin" d="M80 104 m-10 0 a10 10 0 1 0 20 0 a6 6 0 1 0 -12 0" />
            <path className="fig-spin" d="M120 104 m-10 0 a10 10 0 1 0 20 0 a6 6 0 1 0 -12 0" />
          </g>

          <ellipse className={`fig-cheek${happy || mood === "needs" ? " fig-blush" : ""}`} cx="62" cy="128" rx="9" ry="5" fill="#f6b496" />
          <ellipse className={`fig-cheek${happy || mood === "needs" ? " fig-blush" : ""}`} cx="138" cy="128" rx="9" ry="5" fill="#f6b496" />

          <path className={show(mood === "idle" || mood === "working" || mood === "thinking")} d="M92 128 Q100 135 108 128" stroke="#141416" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path className={show(happy)} d="M86 126 Q100 144 114 126 Z" fill="#6b2a14" />
          <ellipse className={`fig-mouth-talk ${show(mood === "talking")}`} cx="100" cy="132" rx="8" ry="6" fill="#6b2a14" />
          <ellipse className={show(mood === "needs" || mood === "dizzy")} cx="100" cy="133" rx="6.5" ry="6" fill="#6b2a14" />
          <circle className={show(sitting)} cx="100" cy="135" r="3.5" fill="#141416" />
        </g>
      </g>

      <g className={`fig-orbit ${show(mood === "working")}`}>
        <circle cx="100" cy="18" r="3.4" fill="#8fc0ff" />
        <circle cx="100" cy="18" r="2.6" fill="#8fc0ff" opacity="0.6" transform="rotate(120 100 118)" />
        <circle cx="100" cy="18" r="2" fill="#8fc0ff" opacity="0.35" transform="rotate(240 100 118)" />
      </g>
      <g className={`fig-badge ${show(mood === "needs")}`}>
        <circle cx="168" cy="36" r="17" fill="#e0a22c" />
        <text x="168" y="44" textAnchor="middle" fontSize={count > 9 ? 17 : 22} fontWeight="700" fill="#141416" fontFamily={FONT}>
          {count > 1 ? count : "!"}
        </text>
      </g>
      <g className={show(sitting)} fill="#a1a1aa" fontSize="16" fontWeight="700" fontFamily={FONT}>
        <text className="fig-z fig-z1" x="146" y="78">z</text>
        <text className="fig-z fig-z2" x="158" y="62">z</text>
        <text className="fig-z fig-z3" x="168" y="48">z</text>
      </g>
      <g className={show(happy)}>
        <path className="fig-sparkle fig-sparkle1" d="M30 50 L34 60 L44 64 L34 68 L30 78 L26 68 L16 64 L26 60 Z" fill="#3fb57d" />
        <path className="fig-sparkle fig-sparkle2" d="M170 30 L173 38 L181 41 L173 44 L170 52 L167 44 L159 41 L167 38 Z" fill="#f3c96e" />
        <path className="fig-sparkle fig-sparkle3" d="M176 108 L178.5 114 L184 116.5 L178.5 119 L176 125 L173.5 119 L168 116.5 L173.5 114 Z" fill="#8fd3ff" />
      </g>
      <g className={show(mood === "thinking")} fill="#b28cf5">
        <circle className="fig-dot fig-dot1" cx="150" cy="36" r="4" />
        <circle className="fig-dot fig-dot2" cx="163" cy="36" r="4" />
        <circle className="fig-dot fig-dot3" cx="176" cy="36" r="4" />
      </g>
    </svg>
  );
}

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size * 1.1} viewBox="0 0 200 220" aria-hidden="true">
      <rect x="32" y="40" width="136" height="146" rx="60" fill="#E07A4F" />
      <line x1="100" y1="42" x2="100" y2="18" stroke="#2a2a30" strokeWidth="8" />
      <circle cx="100" cy="14" r="12" fill="#3fb57d" />
      <ellipse cx="80" cy="104" rx="16" ry="18" fill="#fff" />
      <ellipse cx="120" cy="104" rx="16" ry="18" fill="#fff" />
      <circle cx="82" cy="106" r="9" fill="#141416" />
      <circle cx="122" cy="106" r="9" fill="#141416" />
    </svg>
  );
}

export const headset: CompanionDesign = { id: "headset", title: "Headset", aspect: 1.2, Figure, Mark };
