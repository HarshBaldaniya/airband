// The props a chat row and its details share.
import type { HTMLAttributes } from "react";
import type { ChatSession } from "../../src/core/types";
import type { MergedLink } from "./grouping";

export interface RowProps {
  /** Shown inside a folder's group: drawn under it, on its guide line. */
  nested?: boolean;
  /** The chat is from another folder, and its group doesn't already say which. */
  showFolder: boolean;
  /** More than one AI tool has chats here, so each row shows which. */
  manyTools: boolean;
  s: ChatSession;
  links: MergedLink[];
  waiting?: number;
  waitingFrom?: string[];
  expanded: boolean;
  linking: string | null;
  linked: boolean;
  dropTarget: boolean;
  isDragging: boolean;
  onToggleExpand: () => void;
  onLink: () => void;
  onPickLink: () => void;
  onBranch: () => void;
  drag: HTMLAttributes<HTMLDivElement> & { draggable: boolean };
}
