// What the screen asks the Station: answer a request, ask the companion, tell or open a chat, change
// a setting, link a phone. The Station is the one the page was loaded from, its key in a cookie.
import type { CompanionAnswer, StationSettings } from "../../src/station/types";
import type { Answer } from "../../src/station/reply";
import { post } from "./transport";

export type { LiveChat } from "../../src/station/chats";
export type { AnswerChoice, CompanionAnswer, FinishedView, PendingView, StationSettings, StationState } from "../../src/station/types";
export { setTransport, watchState, type Transport } from "./transport";

export const api = {
  decide: (id: string, answer: Answer) => post<{ ok?: boolean }>("/api/decide", { id, ...answer }),
  ask: (text: string) => post<CompanionAnswer>("/api/ask", { text }),
  tell: (chatId: string, text: string) => post<{ title: string; when?: string }>("/api/tell", { chatId, text }),
  open: (chatId: string) => post<{ text: string }>("/api/open", { chatId }),
  dismiss: (chatId: string) => post<{ ok: boolean }>("/api/dismiss", { chatId }),
  settings: (patch: Partial<Omit<StationSettings, "companion">> & { companionName?: string; companionDesign?: string }) => post<StationSettings>("/api/settings", patch),
  linkPhone: () => post<{ url: string }>("/api/phone/link", {}),
  phoneCode: () => post<{ url?: string }>("/api/phone/code", {}),
  unlinkPhone: () => post<{ ok: boolean }>("/api/phone/unlink", {}),
  testPhone: () => post<{ results: { name: string; ok: boolean; status: number; why?: string }[] }>("/api/phone/test", {}),
};
