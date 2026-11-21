// The little conversation with the companion: what was asked, a moving bar while it works, then
// its answer. Only the latest exchange: this is a helper, not a chat window.
import type { CompanionAnswer } from "../api";
import { AnswerCard, ThinkingCard } from "./Cards";

export interface ConversationProps {
  name: string;
  asking: boolean;
  question?: { text: string; at: number };
  answer?: CompanionAnswer;
  error?: string;
  onClose: () => void;
  onCloseError: () => void;
  onAsk: (q: string) => void;
}

export function Conversation({ name, asking, question, answer, error, onClose, onCloseError, onAsk }: ConversationProps) {
  if (error) return <AnswerCard answer={{ text: error, via: "action" }} onClose={onCloseError} onChoose={onAsk} />;
  if (asking) return <ThinkingCard name={name} question={question?.text} since={question?.at ?? Date.now()} />;
  if (answer) return <AnswerCard answer={answer} question={question?.text} onClose={onClose} onChoose={onAsk} />;
  return null;
}
