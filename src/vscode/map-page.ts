// The Map page: the map of this window's folder or of another project, a search over it, its
// module docs, and opening a file at a line.
import * as path from "node:path";
import * as vscode from "vscode";
import { CodeMap } from "../codemap/index";
import { codeHits, codeMapView, codeModuleView, knownProjects } from "./view-models";
import { openClaude } from "./open";
import type { Controller } from "./controller";

/** Folders picked with "Map another folder…", kept for the project list (a VS Code setting key). */
const MAPPED_FOLDERS = "airband.mappedFolders";
/** How many picked folders the project list keeps. */
const MAPPED_MAX = 20;

export class MapPageService {
  private shared?: { mapFor(root: string): CodeMap | undefined };
  private projectMaps = new Map<string, CodeMap>();

  constructor(private readonly app: Controller) {}

  /** The code map service from the extension, shared so the folder is mapped once. */
  useCodeMaps(service: { mapFor(root: string): CodeMap | undefined }): void {
    this.shared = service;
  }

  /** The map of this window's folder, or of another project picked on the Map page. */
  private mapFor(root = this.app.root): CodeMap | undefined {
    if (!root) return undefined;
    const shared = this.shared?.mapFor(root);
    if (shared) return shared;
    let map = this.projectMaps.get(root);
    if (!map) this.projectMaps.set(root, (map = new CodeMap(root)));
    return map;
  }

  async send(to: vscode.Webview, rebuild = false, root = this.app.root): Promise<void> {
    const map = this.mapFor(root);
    if (!map || !root) return;
    const projects = knownProjects(
      (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
      this.app.ctx.globalState.get<string[]>(MAPPED_FOLDERS, []),
    );
    if (!map.exists()) this.app.post({ type: "codeMap", data: { root, files: 0, decls: 0, languages: {}, modules: [], edges: [], unused: { files: 0, exports: 0, localOnly: 0, sample: [] }, staleDocs: [], conventions: [], allFiles: [], links: [], projects, building: true } }, to);
    await map.refresh({ full: rebuild });
    this.app.post({ type: "codeMap", data: { ...codeMapView(map, root), projects } }, to);
  }

  async find(q: string, root: string | undefined, to: vscode.Webview): Promise<void> {
    const map = this.mapFor(root);
    if (!map) return;
    await map.refresh();
    this.app.post({ type: "codeFind", q, hits: codeHits(map, q) }, to);
  }

  async module(id: string, root: string | undefined, to: vscode.Webview): Promise<void> {
    const map = this.mapFor(root);
    if (!map) return;
    await map.refresh();
    const data = codeModuleView(map, id);
    if (data) this.app.post({ type: "codeModule", data }, to);
  }

  async openFile(file: string, line: number | undefined, root?: string): Promise<void> {
    const base = root ?? this.app.root;
    if (!base) return;
    const at = Math.max(0, (line ?? 1) - 1);
    await vscode.window.showTextDocument(vscode.Uri.file(path.join(base, file)), { selection: new vscode.Range(at, 0, at, 0), preview: true });
  }

  /** Any folder on this computer, picked in the system's folder dialog; it stays in the project list. */
  async mapAnotherFolder(to: vscode.Webview): Promise<void> {
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: "Map this folder", title: "Map a project" });
    const root = picked?.[0]?.fsPath;
    if (!root) return;
    const list = [root, ...this.app.ctx.globalState.get<string[]>(MAPPED_FOLDERS, []).filter((r) => r !== root)].slice(0, MAPPED_MAX);
    await this.app.ctx.globalState.update(MAPPED_FOLDERS, list);
    this.app.post({ type: "codeRoot", root }, to);
  }

  async moduleDoc(id: string, action: "draft" | "open" | "approve", to: vscode.Webview, root?: string): Promise<void> {
    const map = this.mapFor(root);
    if (!map) return;
    const doc = map.moduleDoc(id);
    if (action === "draft") return void openClaude(undefined, `/airband:module-docs ${id}`);
    if (action === "open" && doc && doc.status !== "missing") return void vscode.window.showTextDocument(vscode.Uri.file(doc.file));
    if (action === "approve" && doc && doc.status !== "missing") {
      map.approveModuleDoc(id);
      this.app.post({ type: "toast", title: "Approved", text: `Agents now get the ${id} doc when they outline it. Commit docs/modules/ to share it.`, icon: "info" }, to);
      return this.send(to, false, root);
    }
  }
}
