import { escapeHtmlAttribute, escapeHtmlText } from "./html/parser";
import { parseInlineStyle, serializeInlineStyle } from "./engine/styles";
import { ComponentIR, ComponentNode, PropSlot } from "./engine/types";

export interface SourcePatch {
  start: number;
  end: number;
  text: string;
  description: string;
}

export type Mutation =
  | { kind: "setText"; nodeId: string; slotId: string; value: string; sync?: boolean }
  | { kind: "setProp"; nodeId: string; propId: string; value: string; sync?: boolean }
  | { kind: "deleteNode"; nodeId: string }
  | { kind: "duplicateNode"; nodeId: string }
  | { kind: "moveNode"; nodeId: string; direction: "up" | "down" }
  | { kind: "reorderNode"; nodeId: string; targetId: string; position: "before" | "after" }
  | { kind: "insertHtml"; nodeId?: string; html: string; position?: "before" | "after" };

export function createMutationPatches(source: string, ir: ComponentIR, mutation: Mutation): SourcePatch[] | undefined {
  const nodeMap = flattenNodes(ir);

  switch (mutation.kind) {
    case "setText": {
      const node = nodeMap.get(mutation.nodeId);
      if (!node) {
        return undefined;
      }
      const slotIndex = node.editable.text.findIndex((item) => item.id === mutation.slotId);
      const slot = node.editable.text[slotIndex];
      if (!slot || !validRange(source, slot.source.start, slot.source.end)) {
        return undefined;
      }
      const patches: SourcePatch[] = [{
        start: slot.source.start,
        end: slot.source.end,
        text: escapeHtmlText(mutation.value),
        description: "修改文本"
      }];
      if (mutation.sync) {
        for (const sibling of repeatSiblings(ir, node)) {
          const peer = sibling.editable.text[slotIndex];
          if (peer && peer.label === slot.label && validRange(source, peer.source.start, peer.source.end)) {
            patches.push({
              start: peer.source.start,
              end: peer.source.end,
              text: escapeHtmlText(mutation.value),
              description: "同步文本"
            });
          }
        }
      }
      return normalizePatches(patches);
    }

    case "setProp": {
      const node = nodeMap.get(mutation.nodeId);
      if (!node) {
        return undefined;
      }
      const propIndex = node.editable.props.findIndex((item) => item.id === mutation.propId);
      const prop = node.editable.props[propIndex];
      if (!prop) {
        return undefined;
      }
      const patch = createPropPatch(source, prop, mutation.value);
      if (!patch) {
        return undefined;
      }
      const patches: SourcePatch[] = [patch];
      if (mutation.sync) {
        for (const sibling of repeatSiblings(ir, node)) {
          const peer = sibling.editable.props[propIndex];
          if (peer && peer.key === prop.key && peer.target === prop.target) {
            const peerPatch = createPropPatch(source, peer, mutation.value);
            if (peerPatch) {
              patches.push({ ...peerPatch, description: `同步 ${prop.key}` });
            }
          }
        }
      }
      return normalizePatches(patches);
    }

    case "deleteNode": {
      const node = nodeMap.get(mutation.nodeId);
      if (!canEditNode(source, node)) {
        return undefined;
      }
      const range = expandDeletionRange(source, node.source.start, node.source.end);
      return [{ start: range.start, end: range.end, text: "", description: "删除组件" }];
    }

    case "duplicateNode": {
      const node = nodeMap.get(mutation.nodeId);
      if (!canEditNode(source, node)) {
        return undefined;
      }
      return [{
        start: node.source.end,
        end: node.source.end,
        text: formatDuplicate(source, node.source.start, node.source.end),
        description: "复制组件"
      }];
    }

    case "moveNode": {
      const node = nodeMap.get(mutation.nodeId);
      if (!canEditNode(source, node) || !node.parentId) {
        return undefined;
      }
      const parent = nodeMap.get(node.parentId);
      if (!parent) {
        return undefined;
      }
      const siblings = parent.children
        .filter((child) => canEditNode(source, child))
        .sort((a, b) => a.source.start - b.source.start);
      const index = siblings.findIndex((child) => child.id === node.id);
      const other = mutation.direction === "up" ? siblings[index - 1] : siblings[index + 1];
      if (!other) {
        return undefined;
      }
      const swap = createSwapPatch(
        source,
        mutation.direction === "up" ? other : node,
        mutation.direction === "up" ? node : other
      );
      return swap ? [swap] : undefined;
    }

    case "reorderNode": {
      const node = nodeMap.get(mutation.nodeId);
      const target = nodeMap.get(mutation.targetId);
      if (!canEditNode(source, node) || !canEditNode(source, target) || node.id === target.id) {
        return undefined;
      }
      if (!node.parentId || node.parentId !== target.parentId) {
        return undefined;
      }
      return createReorderPatches(source, node, target, mutation.position);
    }

    case "insertHtml": {
      const node = nodeMap.get(mutation.nodeId ?? "");
      const position = mutation.position ?? "after";
      const insertAt = getInsertPoint(source, node, position);
      const text = formatInsertedHtml(source, insertAt, mutation.html);
      return [{ start: insertAt, end: insertAt, text, description: "插入组件" }];
    }
  }
}

/** Apply patches to a source string; patches must be non-overlapping. Used by tests. */
export function applyPatchesToSource(source: string, patches: SourcePatch[]): string {
  const ordered = [...patches].sort((a, b) => b.start - a.start);
  let result = source;
  for (const patch of ordered) {
    result = result.slice(0, patch.start) + patch.text + result.slice(patch.end);
  }
  return result;
}

export function flattenNodes(ir: ComponentIR): Map<string, ComponentNode> {
  const map = new Map<string, ComponentNode>();
  const visit = (node: ComponentNode) => {
    map.set(node.id, node);
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(ir.root);
  return map;
}

function repeatSiblings(ir: ComponentIR, node: ComponentNode): ComponentNode[] {
  if (!node.repeatGroupId || node.kind !== "repeat-item") {
    return [];
  }
  return ir.nodes.filter(
    (candidate) =>
      candidate.id !== node.id
      && candidate.kind === "repeat-item"
      && candidate.repeatGroupId === node.repeatGroupId
  );
}

function normalizePatches(patches: SourcePatch[]): SourcePatch[] | undefined {
  const ordered = [...patches].sort((a, b) => a.start - b.start);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].start < ordered[index - 1].end) {
      return undefined;
    }
  }
  return ordered;
}

function createPropPatch(source: string, prop: PropSlot, value: string): SourcePatch | undefined {
  if (prop.target === "attribute" && prop.source && validRange(source, prop.source.start, prop.source.end)) {
    return {
      start: prop.source.start,
      end: prop.source.end,
      text: escapeHtmlAttribute(value),
      description: `修改 ${prop.attrName}`
    };
  }

  if (prop.target === "inline-style" && prop.styleName) {
    if (prop.source && validRange(source, prop.source.start, prop.source.end)) {
      const current = source.slice(prop.source.start, prop.source.end);
      const styles = parseInlineStyle(current);
      styles[prop.styleName] = value;
      return {
        start: prop.source.start,
        end: prop.source.end,
        text: serializeInlineStyle(styles),
        description: `修改 ${prop.styleName}`
      };
    }
    if (prop.insertAt !== undefined && prop.insertAt >= 0 && prop.insertAt <= source.length) {
      const text = ` style="${escapeHtmlAttribute(`${prop.styleName}: ${value}`)}"`;
      return {
        start: prop.insertAt,
        end: prop.insertAt,
        text,
        description: `覆写 ${prop.styleName}`
      };
    }
  }

  return undefined;
}

function canEditNode(source: string, node: ComponentNode | undefined): node is ComponentNode {
  return Boolean(node && node.kind !== "root" && validRange(source, node.source.start, node.source.end));
}

function validRange(source: string, start: number, end: number): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && end <= source.length;
}

function expandDeletionRange(source: string, start: number, end: number): { start: number; end: number } {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const lineEndIndex = source.indexOf("\n", end);
  const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex + 1;
  const before = source.slice(lineStart, start);
  const after = source.slice(end, lineEnd);
  if (/^\s*$/.test(before) && /^\s*$/.test(after)) {
    return { start: lineStart, end: lineEnd };
  }
  return { start, end };
}

function formatDuplicate(source: string, start: number, end: number): string {
  const snippet = source.slice(start, end);
  if (isOwnLineElement(source, start, end)) {
    const indent = indentationBefore(source, start);
    return `\n${indent}${snippet.trimStart()}`;
  }
  return snippet;
}

function createSwapPatch(source: string, first: ComponentNode, second: ComponentNode): SourcePatch | undefined {
  if (first.source.end > second.source.start) {
    return undefined;
  }
  const firstText = source.slice(first.source.start, first.source.end);
  const middle = source.slice(first.source.end, second.source.start);
  const secondText = source.slice(second.source.start, second.source.end);
  return {
    start: first.source.start,
    end: second.source.end,
    text: `${secondText}${middle}${firstText}`,
    description: "移动组件"
  };
}

function createReorderPatches(
  source: string,
  node: ComponentNode,
  target: ComponentNode,
  position: "before" | "after"
): SourcePatch[] | undefined {
  const removal = expandDeletionRange(source, node.source.start, node.source.end);
  const snippet = source.slice(node.source.start, node.source.end);
  const targetOwnLine = isOwnLineElement(source, target.source.start, target.source.end);
  const indent = indentationBefore(source, target.source.start);

  let insertAt: number;
  let text: string;
  if (position === "before") {
    if (targetOwnLine) {
      insertAt = source.lastIndexOf("\n", target.source.start - 1) + 1;
      text = `${indent}${snippet}\n`;
    } else {
      insertAt = target.source.start;
      text = snippet;
    }
  } else {
    if (targetOwnLine) {
      const lineEnd = source.indexOf("\n", target.source.end);
      insertAt = lineEnd === -1 ? target.source.end : lineEnd + 1;
      text = lineEnd === -1 ? `\n${indent}${snippet}` : `${indent}${snippet}\n`;
    } else {
      insertAt = target.source.end;
      text = snippet;
    }
  }

  if (insertAt >= removal.start && insertAt <= removal.end) {
    return undefined;
  }

  return normalizePatches([
    { start: removal.start, end: removal.end, text: "", description: "移动组件" },
    { start: insertAt, end: insertAt, text, description: "移动组件" }
  ]);
}

function getInsertPoint(source: string, node: ComponentNode | undefined, position: "before" | "after"): number {
  if (node && validRange(source, node.source.start, node.source.end)) {
    return position === "before" ? node.source.start : node.source.end;
  }
  const bodyClose = source.toLowerCase().lastIndexOf("</body>");
  return bodyClose === -1 ? source.length : bodyClose;
}

function formatInsertedHtml(source: string, insertAt: number, html: string): string {
  const snippet = html.trim();
  const indent = indentationBefore(source, insertAt);
  const formatted = snippet.split(/\r?\n/).map((line) => `${indent}${line}`).join("\n");
  const needsBefore = insertAt > 0 && source[insertAt - 1] !== "\n";
  const needsAfter = insertAt < source.length && source[insertAt] !== "\n";
  return `${needsBefore ? "\n" : ""}${formatted}${needsAfter ? "\n" : ""}`;
}

function indentationBefore(source: string, index: number): string {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  const prefix = source.slice(lineStart, index);
  return /^\s*$/.test(prefix) ? prefix : "";
}

function isOwnLineElement(source: string, start: number, end: number): boolean {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const lineEndIndex = source.indexOf("\n", end);
  const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
  return /^\s*$/.test(source.slice(lineStart, start)) && /^\s*$/.test(source.slice(end, lineEnd));
}
