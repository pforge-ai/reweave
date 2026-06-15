// Dev-only: renders the webview outside VS Code for visual inspection.
// Usage: node scripts/build-harness.js [path/to/file.html] && open /tmp/reweave-harness.html
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { analyzeHtml } = require("../out/engine/ruleEngine");

const rootDir = path.join(__dirname, "..");
const sourcePath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(rootDir, "samples", "report.html");
const html = fs.readFileSync(sourcePath, "utf8");
const ir = analyzeHtml(html);
const css = fs.readFileSync(path.join(rootDir, "media", "webview.css"), "utf8");
const js = fs.readFileSync(path.join(rootDir, "media", "webview.js"), "utf8");

const library = [
  {
    id: "builtin-callout",
    name: "提示块",
    source: "built-in",
    description: "用于突出一段说明、提醒或结论，包含标题和正文。",
    html: "<section class=\"reweave-callout\" style=\"padding: 20px\"><h2>Important</h2><p>Detail.</p></section>"
  },
  { id: "ws-1", name: "我的卡片", source: "workspace", html: "<article class=\"card\"><h2>标题</h2><p>正文</p></article>" }
];

const state = {
  type: "state",
  html,
  ir,
  library,
  version: 3,
  fileName: path.basename(sourcePath),
  dirty: true,
  baseHref: `${pathToFileURL(path.dirname(sourcePath)).toString()}/`
};
const serializedState = JSON.stringify(state).replace(/</g, "\\u003c");

const harness = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Reweave harness</title>
<style>
:root {
  --vscode-foreground: #cccccc;
  --vscode-descriptionForeground: #9d9d9d;
  --vscode-editor-background: #1e1e1e;
  --vscode-sideBar-background: #252526;
  --vscode-titleBar-activeBackground: #2d2d30;
  --vscode-editorWidget-background: #2d2d30;
  --vscode-panel-border: #3c3c3c;
  --vscode-input-background: #3c3c3c;
  --vscode-input-foreground: #cccccc;
  --vscode-input-border: #3c3c3c;
  --vscode-badge-background: #4d4d4d;
  --vscode-badge-foreground: #ffffff;
  --vscode-list-hoverBackground: #2a2d2e;
  --vscode-list-activeSelectionBackground: #094771;
  --vscode-list-activeSelectionForeground: #ffffff;
  --vscode-focusBorder: #4f8ef7;
  --vscode-textLink-foreground: #4daafc;
  --vscode-toolbar-hoverBackground: rgba(90, 93, 94, 0.31);
  --vscode-editor-font-family: "SF Mono", Menlo, monospace;
  --vscode-textCodeBlock-background: #1a1a1a;
  --vscode-errorForeground: #f48771;
  --vscode-font-family: -apple-system, "PingFang SC", sans-serif;
}
${css}
</style>
</head>
<body>
<div id="app"></div>
<script>
const __state = ${serializedState};
window.acquireVsCodeApi = () => ({
  postMessage(message) {
    console.log("[to host]", JSON.stringify(message).slice(0, 200));
    if (message.type === "ready") {
      setTimeout(() => window.postMessage(__state, "*"), 30);
    }
  },
  getState() { return undefined; },
  setState() {}
});
</script>
<script>
${js}
</script>
</body>
</html>`;

const out = "/tmp/reweave-harness.html";
fs.writeFileSync(out, harness);
console.log(`harness written to ${out}`);
