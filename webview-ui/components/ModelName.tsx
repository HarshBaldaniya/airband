// The chat's model, by its short name, on the sidebar's details and the Tower's cards.
import type { ChatSession } from "../../src/core/types";
import { modelName } from "../lib/format";

export function ModelName({ s }: { s: ChatSession }) {
  return <span className="modelname ellipsis">{modelName(s.model) ?? "–"}</span>;
}
