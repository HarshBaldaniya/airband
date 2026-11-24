// Every look the companion can have. A new design is one file in this folder, listed here.
import type { CompanionDesign } from "../types";
import { headset } from "./headset";

const DESIGNS: CompanionDesign[] = [headset];
const DEFAULT_DESIGN = headset;

export function designById(id: string | undefined): CompanionDesign {
  return DESIGNS.find((d) => d.id === id) ?? DEFAULT_DESIGN;
}
