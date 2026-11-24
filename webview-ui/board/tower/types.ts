// The Tower's nodes and lines, as React Flow holds them.
import { createContext } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { ConnectionView } from "../../../src/vscode/protocol";
import type { ChatSession } from "../../../src/core/types";
import type { Lane } from "./layout";

export type CardLink = { id: string; title: string; dir: "out" | "in" | "both" };
/** `inPanel`: the card sits in its folder's panel ("By folder"), which already names the folder. */
export type CardData = { s: ChatSession; links: CardLink[]; waiting?: number; from?: string[]; inPanel?: boolean };
export type CardNode = Node<CardData, "chat">;
export type LaneNode = Node<{ lane: Lane }, "lane">;

/** One line per pair of chats: one direction, or both. */
export type LineData = { forward: ConnectionView; back?: ConnectionView; fresh: boolean; sides?: { s: string; t: string } };
export type LineEdge = Edge<LineData, "link">;

/** Card-to-card linking: press Link on a card, then click another card. */
export const LinkMode = createContext<{ from: string | null; start: (id: string) => void }>({ from: null, start: () => {} });
