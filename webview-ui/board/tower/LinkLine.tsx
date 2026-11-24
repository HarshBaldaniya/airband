import { useEffect, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useInternalNode, type EdgeProps } from "@xyflow/react";
import type { ConnectionView } from "../../../src/vscode/protocol";
import { charsToTokens, tokens } from "../../lib/format";
import { useDismiss } from "../../lib/useDismiss";
import { send } from "../../lib/vscode";
import { ArrowLeft, ArrowLeftRight, ArrowRight, Check, I, Pause, Play, ToolMark, Unlink, X } from "../../components/Icons";
import { facingEnds, sideEnds } from "./edges";
import type { LineEdge } from "./types";

type LinkLevelName = "ping" | "brief" | "full";
/** How much a link sends: a line per ask is plenty to stay in step, and costs the least. */
const LINK_LEVEL_OPTIONS: { key: LinkLevelName; label: string; hint: string; tip: string }[] = [
  { key: "ping", label: "Ping", hint: "A line per ask · fewest tokens", tip: "What was asked and what was done, one line each. The rest is in the chat's flightlog." },
  { key: "brief", label: "Brief", hint: "Asked, done, open, files", tip: "A short paragraph per ask: what was asked, what was done, what is open, files and PRs." },
  { key: "full", label: "Full", hint: "The words themselves · most tokens", tip: "Every ask and reply word for word, up to a cap. Costs the most." },
];

/**
 * A link between the nearest sides of two cards. While it shares, glowing dots
 * travel along it the way the work flows (both ways for a two-way link); a
 * fresh update makes it glow and the dots hurry. A new link draws itself in.
 */
export function LinkLine({ id, source, target, data }: EdgeProps<LineEdge>) {
  const a = useInternalNode(source);
  const b = useInternalNode(target);
  const [menu, setMenu] = useState(false);
  // What the person just picked, shown at once until Airband's own answer arrives (and replaces it).
  const [picked, setPicked] = useState<{ dir?: "both" | "ab" | "ba"; paused?: boolean; level?: LinkLevelName }>({});
  const answer = `${data?.forward.id}|${data?.back?.id}|${data?.forward.paused}|${data?.back?.paused}|${data?.forward.level}|${data?.back?.level}`;
  useEffect(() => setPicked({}), [answer]);
  const labelRef = useRef<HTMLDivElement>(null);
  // The menu closes on a click anywhere else, and on Esc.
  useDismiss(menu, labelRef, () => setMenu(false));
  if (!a || !b || !data) return null;
  const { sx, sy, tx, ty, sp, tp } = data.sides ? sideEnds(a, b, data.sides) : facingEnds(a, b);
  const [path, lx, ly] = getBezierPath({ sourceX: sx, sourceY: sy, sourcePosition: sp, targetX: tx, targetY: ty, targetPosition: tp });
  const conns = [data.forward, data.back].filter((c): c is ConnectionView => !!c);
  const both = picked.dir ? picked.dir === "both" : !!data.back;
  const reversed = picked.dir === "ba";
  const paused = picked.paused ?? conns.every((c) => c.paused);
  const level: LinkLevelName = picked.level ?? conns[0]?.level ?? "ping";
  const updates = conns.reduce((n, c) => n + c.updates, 0);
  const chars = conns.reduce((n, c) => n + c.chars, 0);
  const tone = paused ? "paused" : "live";
  const setDirection = (want: "both" | "ab" | "ba") => {
    setPicked((p) => ({ ...p, dir: want }));
    send({ type: "direction", a: data.forward.from.id, b: data.forward.to.id, want });
  };
  const fromTool = data.forward.from.tool.toLowerCase();
  const toTool = data.forward.to.tool.toLowerCase();
  const dur = data.fresh ? 1.4 : 2.8;
  return (
    <g className={`link ${tone} ${data.fresh ? "fresh" : ""} ${menu ? "selected" : ""}`}>
      <defs>
        <linearGradient id={`g-${id}`} gradientUnits="userSpaceOnUse" x1={sx} y1={sy} x2={tx} y2={ty}>
          <stop offset="0" className={`stop tool-${fromTool}`} />
          <stop offset="1" className={`stop tool-${toTool}`} />
        </linearGradient>
      </defs>
      {!both && (
        <defs>
          <marker id={`end-${id}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M1 1 L9 5 L1 9" className={`arrowhead tool-${toTool}`} />
          </marker>
        </defs>
      )}
      <BaseEdge id={id} path={path} interactionWidth={26} style={{ stroke: "transparent" }} />
      <path d={path} className="linkglow" fill="none" style={paused ? undefined : { stroke: `url(#g-${id})` }} />
      <path d={path} className="linkbase" fill="none" pathLength={1} markerEnd={both ? undefined : `url(#end-${id})`} style={paused ? undefined : { stroke: `url(#g-${id})` }} />
      {!paused && <path d={path} className={`comet tool-${fromTool}`} fill="none" pathLength={100} style={{ animationDuration: `${dur}s` }} />}
      {!paused && both && <path d={path} className={`comet back tool-${toTool}`} fill="none" pathLength={100} style={{ animationDuration: `${dur}s`, animationDelay: `${-dur / 2}s` }} />}
      <EdgeLabelRenderer>
        <div ref={labelRef} className={`edgelabel nodrag nopan ${tone} ${data.fresh ? "fresh" : ""}`} style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
          <button className="edgepill" onClick={() => setMenu((v) => !v)} aria-expanded={menu} data-tip={paused ? "Paused: nothing is shared until you resume it. Click to change" : updates ? `${updates} update${updates === 1 ? "" : "s"} shared so far, about ${tokens(charsToTokens(chars))} tokens. Click to change this channel` : "Connected: the first update goes with the next reply. Click to change"}>
            <ToolMark tool={data.forward.from.tool} size={13} />
            {both ? <ArrowLeftRight {...I} size={12} /> : reversed ? <ArrowLeft {...I} size={12} /> : <ArrowRight {...I} size={12} />}
            <ToolMark tool={data.forward.to.tool} size={13} />
            <span className="pillsep" aria-hidden="true" />
            {paused ? "Paused" : updates ? `${updates} update${updates === 1 ? "" : "s"} · ~${tokens(charsToTokens(chars))}` : "Sharing"}
          </button>
          <button
            className="edgex"
            onClick={() => send({ type: "disconnectMany", ids: conns.map((c) => c.id) })}
            aria-label="Close channel"
            data-tip="Close channel"
          >
            <X {...I} size={11} />
          </button>
          {menu && (
            <div className="edgemenu" role="menu">
              <div className="menusection">Who shares with whom</div>
              {(
                [
                  { key: "both", Arrow: ArrowLeftRight, tip: "Both ways: each gets the other's work" },
                  { key: "ab", Arrow: ArrowRight, tip: `${data.forward.from.title} shares with ${data.forward.to.title}` },
                  { key: "ba", Arrow: ArrowLeft, tip: `${data.forward.to.title} shares with ${data.forward.from.title}` },
                ] as const
              ).map((o) => {
                const on = (both ? "both" : reversed ? "ba" : "ab") === o.key;
                return (
                  <button
                    key={o.key}
                    role="menuitemradio"
                    aria-checked={on}
                    aria-label={o.tip}
                    data-tip={o.tip}
                    className={`diropt ${on ? "on" : ""}`}
                    onClick={() => {
                      setDirection(o.key);
                      setMenu(false);
                    }}
                  >
                    <span className="check" aria-hidden="true">
                      {on ? <Check {...I} size={13} /> : null}
                    </span>
                    <span className="dirlabel">
                      <ToolMark tool={data.forward.from.tool} size={12} />
                      <span className="ellipsis">{data.forward.from.title}</span>
                      <o.Arrow {...I} size={14} className="dirarrow" />
                      <ToolMark tool={data.forward.to.tool} size={12} />
                      <span className="ellipsis">{data.forward.to.title}</span>
                    </span>
                  </button>
                );
              })}
              <div className="menusep" />
              <div className="menusection">What it sends after each reply</div>
              {LINK_LEVEL_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  role="menuitemradio"
                  aria-checked={level === o.key}
                  className={`diropt ${level === o.key ? "on" : ""}`}
                  data-tip={o.tip}
                  onClick={() => {
                    setPicked((p) => ({ ...p, level: o.key }));
                    send({ type: "linkLevel", ids: conns.map((c) => c.id), level: o.key });
                    setMenu(false);
                  }}
                >
                  <span className="check" aria-hidden="true">
                    {level === o.key ? <Check {...I} size={13} /> : null}
                  </span>
                  <span className="levellabel">
                    {o.label}
                    <small>{o.hint}</small>
                  </span>
                </button>
              ))}
              <div className="menusep" />
              <button role="menuitem" onClick={() => (setPicked((p) => ({ ...p, paused: !paused })), conns.forEach((c) => send({ type: "pause", connectionId: c.id, paused: !paused })), setMenu(false))}>
                <span className="check" aria-hidden="true">
                  {paused ? <Play {...I} size={13} /> : <Pause {...I} size={13} />}
                </span>
                {paused ? "Resume sharing" : "Pause sharing"}
              </button>
              <button role="menuitem" className="danger" onClick={() => (send({ type: "disconnectMany", ids: conns.map((c) => c.id) }), setMenu(false))}>
                <span className="check" aria-hidden="true">
                  <Unlink {...I} size={13} />
                </span>
                Close channel
              </button>
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </g>
  );
}
