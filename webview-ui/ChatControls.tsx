// The chat's model, shown read only on the sidebar row and the board card.
import type { ChatSession } from "../src/core/types";
import { modelName } from "./lib/format";

export function ModelPicker({ s }: { s: ChatSession }) {
  return <span className="modelname ellipsis">{modelName(s.model) ?? "–"}</span>;
}
