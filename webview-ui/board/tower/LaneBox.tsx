import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { agoText } from "../../lib/format";
import { Folder, FolderOpen, I } from "../../components/Icons";
import type { LaneNode } from "./types";

/** A group's panel behind its cards: its heading (a folder's tile, name, when it was last active, how many). */
export const LaneBox = memo(function LaneBox({ data }: NodeProps<LaneNode>) {
  const l = data.lane;
  return (
    <div className={`lanebox ${l.folder ? "folder" : ""} ${l.here ? "here" : ""}`}>
      <div className="laneboxhead">
        {l.folder && <span className={`ftile ${l.here ? "here" : ""}`}>{l.here ? <FolderOpen {...I} size={15} /> : <Folder {...I} size={15} />}</span>}
        <span className="lanetitle">
          <span className="lanename ellipsis">{l.label}</span>
          {l.latest ? <span className="lanemeta">{agoText(l.latest)}</span> : null}
        </span>
        <span className="lanecount">{l.count}</span>
      </div>
    </div>
  );
});

