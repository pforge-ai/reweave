import * as vscode from "vscode";

export interface LibraryComponent {
  id: string;
  name: string;
  source: "built-in" | "workspace";
  html: string;
  description?: string;
  createdAt?: string;
}

export const builtInComponents: LibraryComponent[] = [
  {
    id: "builtin-callout",
    name: "提示块",
    source: "built-in",
    description: "用于突出一段说明、提醒或结论，包含标题和正文。",
    html: `<section class="reweave-callout" style="padding: 20px; border: 1px solid #d0d7de; border-radius: 8px; background: #f6f8fa;">
  <h2 style="margin: 0 0 8px;">Important note</h2>
  <p style="margin: 0;">Replace this with the supporting detail.</p>
</section>`
  },
  {
    id: "builtin-card-grid",
    name: "三列卡片",
    source: "built-in",
    description: "用于展示一组并列内容，插入后三个卡片会被识别为重复组。",
    html: `<section class="reweave-card-grid" style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px;">
  <article class="reweave-card" style="padding: 18px; border: 1px solid #d0d7de; border-radius: 8px;">
    <h3 style="margin: 0 0 8px;">First card</h3>
    <p style="margin: 0;">A compact reusable card.</p>
  </article>
  <article class="reweave-card" style="padding: 18px; border: 1px solid #d0d7de; border-radius: 8px;">
    <h3 style="margin: 0 0 8px;">Second card</h3>
    <p style="margin: 0;">Duplicate structure is detected as a repeat group.</p>
  </article>
  <article class="reweave-card" style="padding: 18px; border: 1px solid #d0d7de; border-radius: 8px;">
    <h3 style="margin: 0 0 8px;">Third card</h3>
    <p style="margin: 0;">Edit one item or move it in the outline.</p>
  </article>
</section>`
  },
  {
    id: "builtin-cta",
    name: "行动区",
    source: "built-in",
    description: "用于页面结尾或段落结尾的行动引导，包含标题、说明和按钮。",
    html: `<section class="reweave-cta" style="padding: 28px; text-align: center; background: #102a43; color: white; border-radius: 8px;">
  <h2 style="margin: 0 0 10px;">Ready to continue?</h2>
  <p style="margin: 0 0 16px;">Add a clear next step for the reader.</p>
  <a href="#" style="display: inline-block; color: #102a43; background: white; padding: 10px 14px; border-radius: 6px; text-decoration: none;">Take action</a>
</section>`
  }
];

export async function getLibrary(documentUri: vscode.Uri): Promise<LibraryComponent[]> {
  return [...builtInComponents, ...(await loadWorkspaceComponents(documentUri))];
}

export async function findLibraryComponent(documentUri: vscode.Uri, id: string): Promise<LibraryComponent | undefined> {
  const library = await getLibrary(documentUri);
  return library.find((component) => component.id === id);
}

export async function saveWorkspaceComponent(documentUri: vscode.Uri, name: string, html: string): Promise<LibraryComponent> {
  const existing = await loadWorkspaceComponents(documentUri);
  const component: LibraryComponent = {
    id: `workspace-${Date.now().toString(36)}`,
    name,
    source: "workspace",
    html,
    createdAt: new Date().toISOString()
  };
  const next = [...existing, component];
  const folder = getLibraryFolderUri(documentUri);
  const uri = getLibraryUri(documentUri);
  await vscode.workspace.fs.createDirectory(folder);
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify({ components: next }, null, 2)));
  return component;
}

export async function deleteWorkspaceComponent(documentUri: vscode.Uri, id: string): Promise<boolean> {
  const existing = await loadWorkspaceComponents(documentUri);
  const next = existing.filter((component) => component.id !== id);
  if (next.length === existing.length) {
    return false;
  }
  const uri = getLibraryUri(documentUri);
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify({ components: next }, null, 2)));
  return true;
}

async function loadWorkspaceComponents(documentUri: vscode.Uri): Promise<LibraryComponent[]> {
  const uri = getLibraryUri(documentUri);
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { components?: LibraryComponent[] };
    return Array.isArray(parsed.components) ? parsed.components.filter(isLibraryComponent) : [];
  } catch {
    return [];
  }
}

function getLibraryUri(documentUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(getLibraryFolderUri(documentUri), "components.json");
}

function getLibraryFolderUri(documentUri: vscode.Uri): vscode.Uri {
  const folder = vscode.workspace.getWorkspaceFolder(documentUri);
  const base = folder?.uri ?? vscode.Uri.joinPath(documentUri, "..");
  return vscode.Uri.joinPath(base, ".reweave");
}

function isLibraryComponent(value: unknown): value is LibraryComponent {
  const component = value as Partial<LibraryComponent>;
  return typeof component.id === "string"
    && typeof component.name === "string"
    && typeof component.html === "string"
    && (component.source === "workspace" || component.source === "built-in");
}
