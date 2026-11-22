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

function Figure({ mood, look, blinking, gesture, phase, count, size, label }: FigureProps) {
  const sitting = mood === "resting";
  const happy = mood === "done" || mood === "hello";
  const eyesOpen = !sitting && !happy && mood !== "dizzy";
  const glance = gesture === "look-left" ? -1 : gesture === "look-right" ? 1 : 0;
  const px = Math.max(-1, Math.min(1, glance || look.dx)) * 4.5;
  const py = Math.max(-1, Math.min(1, glance ? 0 : look.dy)) * 3 + (mood === "thinking" ? -4 : mood === "working" ? 1.5 : 0);
  const show = (on: boolean) => (on ? "fig-on" : "fig-off");
  // Depth: the face sits on the front of a round body, so as the figure looks aside the face slides
  // that way and the headset follows a little less (a head turning in 3D).
  const turn = Math.max(-1, Math.min(1, glance || look.dx));
  const face = { transform: `translate(${turn * 7}px, ${Math.max(-1, Math.min(1, look.dy)) * 2}px)` };
  // The headset is one rigid piece on the head: it turns a little, less than the face.
  const headset = { transform: `translateX(${turn * 2.5}px)` };
  return (
    <svg className={`figure design-headset mood-${mood}${gesture ? ` gesture-${gesture}` : ""}${phase ? ` phase-${phase}` : ""}`} width={size} height={size * 1.2} viewBox="0 0 200 240" role="img" aria-label={label}>
      <defs>
        <radialGradient id="headset-body" cx="36%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#f7ae8a" />
          <stop offset="45%" stopColor="#e07a4f" />
          <stop offset="100%" stopColor="#b85733" />
        </radialGradient>
        <radialGradient id="headset-belly" cx="45%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#f7b393" />
          <stop offset="100%" stopColor="#e2885f" />
        </radialGradient>
        <linearGradient id="headset-rim" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffd2b8" stopOpacity="0" />
          <stop offset="85%" stopColor="#ffd2b8" stopOpacity="0" />
          <stop offset="100%" stopColor="#ffd2b8" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id="headset-cup" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4a4a54" />
          <stop offset="100%" stopColor="#1c1c22" />
        </linearGradient>
        <radialGradient id="headset-arm" cx="40%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#e8875c" />
          <stop offset="100%" stopColor="#a9502f" />
        </radialGradient>
        <radialGradient id="headset-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffb38a" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#e07a4f" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#e07a4f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="fig-float">
        <g className="fig-body">
          <ellipse className={`fig-glow ${show(!sitting)}`} cx="100" cy="204" rx="40" ry="9" fill="url(#headset-glow)" />
          <g className="fig-antenna">
            <line x1="100" y1="44" x2="100" y2="20" stroke="#2a2a30" strokeWidth="5" strokeLinecap="round" />
            <circle className="fig-light" cx="100" cy="15" r="8" fill={LIGHT[mood]} />
          </g>
          <ellipse cx="78" cy="186" rx="15" ry="8" fill="#a24c2b" />
          <ellipse cx="122" cy="186" rx="15" ry="8" fill="#a24c2b" />
          <ellipse className="fig-arm-left" cx="34" cy="140" rx="10" ry="15" fill="url(#headset-arm)" />
          <ellipse className="fig-arm-right" cx="166" cy="140" rx="10" ry="15" fill="url(#headset-arm)" />
          <rect x="32" y="40" width="136" height="146" rx="62" fill="url(#headset-body)" />
          <rect x="32" y="40" width="136" height="146" rx="62" fill="url(#headset-rim)" />
          <ellipse cx="70" cy="64" rx="20" ry="10" fill="#fff" opacity="0.18" transform="rotate(-18 70 64)" />
          <g className="fig-face" style={face}>
          <ellipse cx="100" cy="156" rx="42" ry="25" fill="url(#headset-belly)" />

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
          <ellipse className={`fig-yawn ${show(phase === "dozing")}`} cx="100" cy="133" rx="9" ry="11" fill="#6b2a14" />
          </g>
          <g className="fig-headset" style={headset}>
            <path d="M35 86 C35 52 64 37 100 37 C136 37 165 52 165 86" stroke="#2a2a30" strokeWidth="9" fill="none" strokeLinecap="round" />
            <path d="M44 66 C54 50 74 43 96 42" stroke="#5a5a64" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.7" />
            <rect x="24" y="82" width="22" height="38" rx="10" fill="url(#headset-cup)" />
            <rect x="154" y="82" width="22" height="38" rx="10" fill="url(#headset-cup)" />
            <rect x="27" y="88" width="5" height="24" rx="2.5" fill="#5a5a64" opacity="0.6" />
            <rect x="157" y="88" width="5" height="24" rx="2.5" fill="#5a5a64" opacity="0.6" />
            <path d="M35 118 C38 140 56 151 74 151" stroke="#2a2a30" strokeWidth="5" fill="none" strokeLinecap="round" />
            <circle cx="78" cy="151" r="6" fill="#2a2a30" />
          </g>
        </g>
      </g>

      <g className={`fig-startle ${show(phase === "waking")}`} stroke="#f3c96e" strokeWidth="5" strokeLinecap="round">
        <path d="M30 52 L18 40" />
        <path d="M26 72 L10 70" />
        <path d="M170 52 L182 40" />
        <path d="M174 72 L190 70" />
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

/** The figure's face in a round tile, for headers and lists. */
function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <linearGradient id="headset-mark-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a2a22" />
          <stop offset="100%" stopColor="#1f1b19" />
        </linearGradient>
        <radialGradient id="headset-mark-body" cx="38%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#f7ae8a" />
          <stop offset="50%" stopColor="#e07a4f" />
          <stop offset="100%" stopColor="#b85733" />
        </radialGradient>
        <clipPath id="headset-mark-clip">
          <circle cx="60" cy="60" r="60" />
        </clipPath>
      </defs>
      <circle cx="60" cy="60" r="60" fill="url(#headset-mark-tile)" />
      <g clipPath="url(#headset-mark-clip)">
        <line x1="60" y1="30" x2="60" y2="14" stroke="#2a2a30" strokeWidth="4" strokeLinecap="round" />
        <circle cx="60" cy="12" r="5.5" fill="#3fb57d" />
        <rect x="20" y="28" width="80" height="104" rx="38" fill="url(#headset-mark-body)" />
        <path d="M22 62 C22 40 39 30 60 30 C81 30 98 40 98 62" stroke="#2a2a30" strokeWidth="6" fill="none" strokeLinecap="round" />
        <rect x="14" y="56" width="13" height="24" rx="6" fill="#2a2a30" />
        <rect x="93" y="56" width="13" height="24" rx="6" fill="#2a2a30" />
        <ellipse cx="48" cy="70" rx="9" ry="10.5" fill="#fff" />
        <ellipse cx="72" cy="70" rx="9" ry="10.5" fill="#fff" />
        <circle cx="49.5" cy="71.5" r="5" fill="#141416" />
        <circle cx="73.5" cy="71.5" r="5" fill="#141416" />
        <circle cx="51.5" cy="69" r="1.6" fill="#fff" />
        <circle cx="75.5" cy="69" r="1.6" fill="#fff" />
        <ellipse cx="37" cy="84" rx="6" ry="3.5" fill="#f6b496" />
        <ellipse cx="83" cy="84" rx="6" ry="3.5" fill="#f6b496" />
        <path d="M54 86 Q60 91 66 86" stroke="#141416" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

// The antenna light is at (100, 15) of 200 by 240, the sleeping mouth near (110, 127), above the head near (128, 50).
export const headset: CompanionDesign = { id: "headset", title: "Headset", aspect: 1.2, Figure, Mark, spots: { antenna: [0.5, 0.0625], mouth: [0.525, 0.54], above: [0.64, 0.21] } };
