// The facts the code map keeps about each file: what it declares and what it imports.

export type DeclKind =
  | "function"
  | "component"
  | "hook"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "enum"
  | "const"
  | "namespace"
  | "route";

export interface Decl {
  /** Name */
  n: string;
  /** Kind */
  k: DeclKind;
  /** First and last line, 1-based */
  s: number;
  e: number;
  /** Exported (or public, for Python) */
  x?: boolean;
  /** The first line of its doc comment */
  d?: string;
  /** The class or namespace it sits in */
  p?: string;
  /** What it uses from this codebase: `name` (a local or imported name) or `ns.name` (via an imported module) */
  r?: string[];
  /** For a web route: "GET /items/{id}" */
  route?: string;
}

export interface Import {
  /** The module as written: "./x", "@/lib/y", "react", "app.core.db", ".models" */
  s: string;
  /** The names taken from it ("default", "*" for a namespace); only kept for this codebase's own modules */
  n?: string[];
  /** The local names they're bound to, where they differ ("default" → "Button") */
  as?: Record<string, string>;
  /** A re-export (`export ... from`) */
  re?: boolean;
}

export interface FileFacts {
  decls: Decl[];
  imports: Import[];
  lines: number;
  /** The name `export default` gives, when it names a declaration */
  def?: string;
}

/** Whether an import names this codebase's own module (decided by the indexer, which knows the aliases). */
export type IsLocal = (source: string) => boolean;
