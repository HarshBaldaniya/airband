// The shape of a tool's answer, and the fence around words from other chats or a repository.
import { fenced, fenceNote, newFenceTag } from "../core/fence";

export const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError } : {}) });

/** An answer made of words other chats wrote (or a note a repository carries): fenced as data. */
export const data = (t: string, whose = "from the person's AI chats", after?: string) => {
  const tag = newFenceTag();
  return text(`${fenceNote(tag, whose)}\n${fenced(t, tag)}${after ? `\n${after}` : ""}`);
};
