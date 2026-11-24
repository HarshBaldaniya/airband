// What the extension last said about every chat, channel and plan, for any part of the page.
import { createContext, useContext } from "react";
import type { ViewState } from "../../src/vscode/protocol";

export const EMPTY_STATE: ViewState = {
  tools: [],
  sessions: [],
  connections: [],
  inbox: {},
  board: { members: [], positions: {} },
  totals: {},
  hooksOn: true,
  claudeExtension: true,
  loading: true,
};

export const ViewStateContext = createContext<ViewState>(EMPTY_STATE);

export const useViewState = (): ViewState => useContext(ViewStateContext);
