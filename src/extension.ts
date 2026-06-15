import * as path from "path";
import * as vscode from "vscode";
import { deleteWorkspaceComponent, findLibraryComponent, getLibrary, saveWorkspaceComponent } from "./componentLibrary";
import { analyzeHtml } from "./engine/ruleEngine";
import { createMutationPatches, flattenNodes, Mutation } from "./mutations";

interface WebviewMessage {
  type: string;
  nodeId?: string;
  reveal?: boolean;
  mutation?: Mutation & { componentId?: string };
  componentId?: string;
  version?: number;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("reweave.open", async (resource?: vscode.Uri) => {
      const document = await resolveHtmlDocument(resource);
      if (!document) {
        vscode.window.showErrorMessage("请先打开一个 HTML 文件，再启动 Reweave。");
        return;
      }
      await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
      ReweavePanel.open(context, document.uri);
    })
  );
}

export function deactivate(): void {
  ReweavePanel.disposeAll();
}

async function resolveHtmlDocument(resource?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  if (resource) {
    return vscode.workspace.openTextDocument(resource);
  }

  const active = vscode.window.activeTextEditor?.document;
  if (active && isHtmlDocument(active)) {
    return active;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { HTML: ["html", "htm"] },
    title: "选择要在 Reweave 中打开的 HTML"
  });
  return picked?.[0] ? vscode.workspace.openTextDocument(picked[0]) : undefined;
}

function isHtmlDocument(document: vscode.TextDocument): boolean {
  const ext = path.extname(document.uri.fsPath).toLowerCase();
  return document.languageId === "html" || ext === ".html" || ext === ".htm";
}

/**
 * The panel is keyed by file URI and never assumes the TextDocument stays open.
 * VS Code closes a TextDocument as soon as its last editor tab goes away, so
 * every operation re-resolves the document on demand. This keeps the editor
 * fully functional even when the user closes the source editor tab.
 */
class ReweavePanel {
  private static panels = new Map<string, ReweavePanel>();
  private readonly disposables: vscode.Disposable[] = [];
  private sendTimer: NodeJS.Timeout | undefined;

  static open(context: vscode.ExtensionContext, uri: vscode.Uri): void {
    const key = uri.toString();
    const existing = ReweavePanel.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside, true);
      existing.queueState();
      return;
    }

    const roots = [
      vscode.Uri.joinPath(context.extensionUri, "media"),
      vscode.Uri.file(path.dirname(uri.fsPath)),
      ...(vscode.workspace.workspaceFolders || []).map((folder) => folder.uri)
    ];
    const panel = vscode.window.createWebviewPanel(
      "reweave.editor",
      `Reweave · ${path.basename(uri.fsPath)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: roots
      }
    );
    const instance = new ReweavePanel(context, panel, uri);
    ReweavePanel.panels.set(key, instance);
  }

  static disposeAll(): void {
    for (const panel of ReweavePanel.panels.values()) {
      panel.dispose();
    }
    ReweavePanel.panels.clear();
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
    private readonly uri: vscode.Uri
  ) {
    this.panel.webview.html = this.getHtml();

    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        this.handleMessage(message).catch((error) => {
          const text = error instanceof Error ? error.message : String(error);
          this.toast(`操作失败：${text}`, "warn");
          console.error("[reweave]", error);
        });
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === this.uri.toString()) {
          this.queueState();
        }
      })
    );
  }

  private dispose(): void {
    if (this.sendTimer) {
      clearTimeout(this.sendTimer);
      this.sendTimer = undefined;
    }
    ReweavePanel.panels.delete(this.uri.toString());
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  /** Re-opens the document on demand; cheap when it is already loaded. */
  private getDocument(): Thenable<vscode.TextDocument> {
    return vscode.workspace.openTextDocument(this.uri);
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.sendState();
        return;
      case "select":
        if (message.nodeId && message.reveal) {
          await this.revealSource(message.nodeId);
        }
        return;
      case "reveal":
        if (message.nodeId) {
          await this.revealSource(message.nodeId, true);
        }
        return;
      case "mutation":
        if (message.mutation) {
          await this.applyMutation(message.mutation);
        }
        return;
      case "saveComponent":
        if (message.nodeId) {
          await this.saveComponent(message.nodeId);
        }
        return;
      case "deleteComponent":
        if (message.componentId) {
          await this.deleteComponent(message.componentId);
        }
        return;
      case "openExternal":
        await vscode.env.openExternal(this.uri);
        this.toast("已用系统浏览器打开当前 HTML。", "info");
        return;
    }
  }

  private queueState(): void {
    if (this.sendTimer) {
      clearTimeout(this.sendTimer);
    }
    this.sendTimer = setTimeout(() => {
      this.sendState().catch((error) => {
        console.error("[reweave]", error);
      });
    }, 60);
  }

  private async sendState(): Promise<void> {
    const document = await this.getDocument();
    const html = document.getText();
    const ir = analyzeHtml(html);
    await this.panel.webview.postMessage({
      type: "state",
      html,
      ir,
      library: await getLibrary(this.uri),
      version: document.version,
      extensionVersion: this.getExtensionVersion(),
      fileName: path.basename(this.uri.fsPath),
      dirty: document.isDirty,
      baseHref: this.getBaseHref()
    });
  }

  /** Lets relative <img src>, <link href> etc. in the preview resolve against the file's folder. */
  private getBaseHref(): string {
    if (this.uri.scheme !== "file") {
      return "";
    }
    const dir = vscode.Uri.file(path.dirname(this.uri.fsPath));
    return `${this.panel.webview.asWebviewUri(dir).toString()}/`;
  }

  private getExtensionVersion(): string {
    const version = this.context.extension.packageJSON?.version;
    return typeof version === "string" && version ? version : "dev";
  }

  private toast(message: string, tone: "info" | "warn" | "success" = "info"): void {
    void this.panel.webview.postMessage({ type: "toast", message, tone });
  }

  private async revealSource(nodeId: string, focus = false): Promise<void> {
    const document = await this.getDocument();
    const ir = analyzeHtml(document.getText());
    const node = flattenNodes(ir).get(nodeId);
    if (!node) {
      return;
    }
    const start = document.positionAt(node.source.start);
    const end = document.positionAt(node.source.end);
    const range = new vscode.Range(start, end);
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
      preserveFocus: !focus
    });
    editor.selection = new vscode.Selection(start, end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private async applyMutation(rawMutation: Mutation & { componentId?: string }): Promise<void> {
    const document = await this.getDocument();
    const html = document.getText();
    const ir = analyzeHtml(html);
    let mutation: Mutation = rawMutation;

    if (rawMutation.kind === "insertHtml" && rawMutation.componentId) {
      const component = await findLibraryComponent(this.uri, rawMutation.componentId);
      if (!component) {
        this.toast("该组件已不存在。", "warn");
        return;
      }
      mutation = {
        kind: "insertHtml",
        nodeId: rawMutation.nodeId,
        html: component.html,
        position: rawMutation.position
      };
    }

    const patches = createMutationPatches(html, ir, mutation);
    if (!patches || patches.length === 0) {
      this.toast("这次编辑无法安全映射回源码，已放弃。", "warn");
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    for (const patch of patches) {
      edit.replace(
        this.uri,
        new vscode.Range(document.positionAt(patch.start), document.positionAt(patch.end)),
        patch.text
      );
    }
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      this.toast("VS Code 拒绝了这次源码修改。", "warn");
      return;
    }
    if (rawMutation.kind === "insertHtml") {
      this.toast("已插入组件，可用 VS Code 撤销。", "success");
    }
    await this.sendState();
  }

  private async saveComponent(nodeId: string): Promise<void> {
    const document = await this.getDocument();
    const html = document.getText();
    const ir = analyzeHtml(html);
    const node = flattenNodes(ir).get(nodeId);
    if (!node || node.kind === "root") {
      this.toast("请先选中一个具体组件再保存。", "warn");
      return;
    }
    const name = await vscode.window.showInputBox({
      title: "保存为组件",
      prompt: "为这个组件起一个名字（保存到工作区 .reweave/components.json）",
      value: node.label,
      validateInput: (value) => (value.trim() ? undefined : "名字不能为空")
    });
    if (!name || !name.trim()) {
      return;
    }
    const snippet = html.slice(node.source.start, node.source.end);
    const component = await saveWorkspaceComponent(this.uri, name.trim(), snippet);
    this.toast(`已保存「${component.name}」到组件库。`, "success");
    await this.sendState();
  }

  private async deleteComponent(componentId: string): Promise<void> {
    const removed = await deleteWorkspaceComponent(this.uri, componentId);
    this.toast(removed ? "已从组件库移除。" : "只能删除工作区组件。", removed ? "success" : "warn");
    await this.sendState();
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const cacheKey = encodeURIComponent(this.getExtensionVersion());
    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "webview.js"))
      .with({ query: `v=${cacheKey}` });
    const styleUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "webview.css"))
      .with({ query: `v=${cacheKey}` });
    // The preview iframe (srcdoc) inherits this CSP, so it must allow what a
    // normal browser would: inline/CDN styles & scripts, remote fonts/images.
    // A nonce is deliberately not used — it would disable 'unsafe-inline'.
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline' http: https:`,
      `script-src ${webview.cspSource} 'unsafe-inline' http: https:`,
      `img-src ${webview.cspSource} data: blob: http: https:`,
      `font-src ${webview.cspSource} data: http: https:`,
      `media-src ${webview.cspSource} data: blob: http: https:`,
      "connect-src http: https:",
      "frame-src data: blob:"
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Reweave</title>
</head>
<body>
  <div id="app"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
