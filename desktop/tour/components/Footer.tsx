import type { ReactNode } from "react";

export function Footer({ at, children }: { at: number; children: ReactNode }) {
  return (
    <footer>
      <span className="step">{at} of 3</span>
      {children}
    </footer>
  );
}
