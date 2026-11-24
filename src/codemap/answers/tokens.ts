// The token budget every answer is cut to.
import { tokensFor } from "../../core/text";

export interface FindOptions {
  /** Most lines in the answer */
  limit?: number;
  /** Token budget for the answer (about 4 characters a token) */
  budget?: number;
  /** Files this chat has worked on: ranked up */
  focus?: string[];
}

/** Roughly how many tokens a text costs. */
export const tokensOf = (text: string) => tokensFor(text.length);
