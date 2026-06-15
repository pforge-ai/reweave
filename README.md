# Reweave

**Reweave is a local visual editor for AI-generated HTML.**

AI can generate polished standalone HTML pages quickly, but editing them afterward often means digging through long inline styles, nested containers, and source code that no longer matches what you are looking at. Reweave gives you a rendered preview, a navigable component outline, and source-safe edits so you can see what the page is, select what you mean, edit it, and keep the HTML as clean code in your Git repository.

[中文说明](./README.zh-CN.md)

## TL;DR

Reweave lets you open an HTML file in VS Code, see the rendered page, click the part you want to change, edit text, style, structure, or reusable blocks, and write the change back to the original source file.

It is not an AI page generator. It is the editing layer after AI has generated the page.

## Why

AI-generated HTML is often good enough to start from and annoying to maintain:

- The visual result is easy to understand, but the source is noisy.
- Content, layout, and inline CSS are mixed together.
- Small edits can turn into manual source hunting.
- You still want the final artifact to be a normal HTML file that works with GitHub, reviews, diffs, and deployment.

Reweave keeps the HTML file as the source of truth and adds a local visual editing layer on top.

## Features

- **Rendered preview**: view the HTML in an isolated iframe with desktop, tablet, mobile, and full-width viewport presets.
- **Click-to-select editing**: select elements from the canvas or outline and edit mapped text and attributes.
- **Source-safe writeback**: edits become minimal `WorkspaceEdit` patches against the original HTML.
- **Source following**: selecting a component can reveal its source range in the VS Code editor.
- **Inline text editing**: double-click text in the preview to edit it in place.
- **Component outline**: search, fold, navigate, and drag reorder same-level components.
- **Repeat group editing**: repeated cards/items are detected and can be edited together.
- **Reusable components**: save selected HTML as a workspace component and insert built-in or saved snippets before/after the selected target.
- **Offline and deterministic**: no model calls, no network dependency, no hidden generation step.

## Install From VSIX

Build the extension package:

```bash
npm install
npm run package
```

Then install the generated `reweave-*.vsix` in VS Code:

```bash
code --install-extension reweave-0.2.6.vsix
```

## Development

```bash
npm install
npm run compile
npm test
```

In VS Code, open this folder, press `F5` to launch the Extension Development Host, open `samples/report.html`, and run `Reweave: Open in Reweave`.

To inspect the webview outside VS Code:

```bash
npm run compile
node scripts/build-harness.js samples/report.html
open /tmp/reweave-harness.html
```

You can also pass any local HTML file:

```bash
node scripts/build-harness.js /path/to/page.html
```

## Architecture

```text
HTML document in VS Code
  -> deterministic parser with source ranges
  -> rule engine creates a component IR
  -> webview renders preview, outline, inspector, and library
  -> user action becomes a structured mutation
  -> mutation becomes minimal source patches
  -> VS Code WorkspaceEdit writes back to the HTML file
```

## Current Boundaries

- The parser is intentionally conservative and dependency-light.
- Stylesheet-derived properties are heuristic and focused on simple selectors.
- Reweave edits existing HTML; it does not generate new pages from prompts.
- Complex web apps with build pipelines are out of scope for now. The sweet spot is standalone HTML, especially AI-generated pages, reports, prototypes, and documentation pages.

## License

MIT
