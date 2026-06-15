import { AttrRange, CommentNode, ElementNode, HtmlNode, RootNode, TextNode } from "./ast";

const voidTags = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

const rawTextTags = new Set(["script", "style", "textarea", "title"]);

export interface ParsedHtml {
  root: RootNode;
  byId: Map<string, HtmlNode>;
}

export function parseHtml(source: string): ParsedHtml {
  let nextId = 1;
  const byId = new Map<string, HtmlNode>();
  const root: RootNode = { id: "dom_0", type: "root", start: 0, end: source.length, children: [] };
  byId.set(root.id, root);

  const stack: Array<ElementNode | RootNode> = [root];

  const addNode = <T extends Exclude<HtmlNode, RootNode>>(node: T): T => {
    node.parent = stack[stack.length - 1];
    stack[stack.length - 1].children.push(node);
    byId.set(node.id, node);
    return node;
  };

  const makeId = () => `dom_${nextId++}`;
  let index = 0;

  while (index < source.length) {
    if (source.startsWith("<!--", index)) {
      const close = source.indexOf("-->", index + 4);
      const end = close === -1 ? source.length : close + 3;
      const comment: CommentNode = {
        id: makeId(),
        type: "comment",
        start: index,
        end,
        value: source.slice(index + 4, close === -1 ? end : close)
      };
      addNode(comment);
      index = end;
      continue;
    }

    if (source[index] === "<") {
      if (source[index + 1] === "/") {
        const close = findTagEnd(source, index + 2);
        if (close === -1) {
          addText(index, source.length);
          break;
        }
        const tagName = readTagName(source, index + 2).name.toLowerCase();
        closeStackToTag(stack, tagName, index, close + 1);
        index = close + 1;
        continue;
      }

      if (source[index + 1] === "!" || source[index + 1] === "?") {
        const close = findTagEnd(source, index + 1);
        const end = close === -1 ? source.length : close + 1;
        const comment: CommentNode = {
          id: makeId(),
          type: "comment",
          start: index,
          end,
          value: source.slice(index, end)
        };
        addNode(comment);
        index = end;
        continue;
      }

      const tag = readTagName(source, index + 1);
      if (!tag.name) {
        addText(index, index + 1);
        index += 1;
        continue;
      }

      const close = findTagEnd(source, tag.end);
      if (close === -1) {
        addText(index, source.length);
        break;
      }

      const slashBeforeClose = findSlashBeforeClose(source, tag.end, close);
      const tagName = tag.name.toLowerCase();
      const selfClosing = slashBeforeClose || voidTags.has(tagName);
      const attrs = parseAttributes(source, tag.end, slashBeforeClose ? previousNonWhitespace(source, close - 1) : close);
      const element: ElementNode = {
        id: makeId(),
        type: "element",
        tagName,
        attrs: attrs.values,
        attrRanges: attrs.ranges,
        start: index,
        end: close + 1,
        openStart: index,
        openEnd: close + 1,
        selfClosing,
        children: []
      };
      addNode(element);

      if (selfClosing) {
        index = close + 1;
        continue;
      }

      if (rawTextTags.has(tagName)) {
        const closingStart = findRawTextClose(source, tagName, close + 1);
        const rawEnd = closingStart === -1 ? source.length : closingStart;
        if (rawEnd > close + 1) {
          const text: TextNode = {
            id: makeId(),
            type: "text",
            start: close + 1,
            end: rawEnd,
            value: source.slice(close + 1, rawEnd),
            parent: element
          };
          element.children.push(text);
          byId.set(text.id, text);
        }
        if (closingStart === -1) {
          element.end = source.length;
          index = source.length;
        } else {
          const closingEnd = findTagEnd(source, closingStart + 2);
          element.closeStart = closingStart;
          element.closeEnd = closingEnd === -1 ? source.length : closingEnd + 1;
          element.end = element.closeEnd;
          index = element.closeEnd;
        }
        continue;
      }

      stack.push(element);
      index = close + 1;
      continue;
    }

    const nextTag = source.indexOf("<", index);
    const end = nextTag === -1 ? source.length : nextTag;
    addText(index, end);
    index = end;
  }

  for (let i = 1; i < stack.length; i += 1) {
    const element = stack[i] as ElementNode;
    element.end = source.length;
  }

  return { root, byId };

  function addText(start: number, end: number): void {
    if (end <= start) {
      return;
    }
    const text: TextNode = {
      id: makeId(),
      type: "text",
      start,
      end,
      value: source.slice(start, end)
    };
    addNode(text);
  }
}

function readTagName(source: string, offset: number): { name: string; end: number } {
  let index = skipWhitespace(source, offset);
  const start = index;
  while (index < source.length && /[A-Za-z0-9:_-]/.test(source[index])) {
    index += 1;
  }
  return { name: source.slice(start, index), end: index };
}

function findTagEnd(source: string, offset: number): number {
  let quote: "\"" | "'" | undefined;
  for (let index = offset; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") {
      return index;
    }
  }
  return -1;
}

function findRawTextClose(source: string, tagName: string, offset: number): number {
  const lower = source.toLowerCase();
  return lower.indexOf(`</${tagName}`, offset);
}

function closeStackToTag(stack: Array<ElementNode | RootNode>, tagName: string, closeStart: number, closeEnd: number): void {
  for (let index = stack.length - 1; index >= 1; index -= 1) {
    const element = stack[index] as ElementNode;
    if (element.tagName === tagName) {
      element.closeStart = closeStart;
      element.closeEnd = closeEnd;
      element.end = closeEnd;
      stack.length = index;
      return;
    }
  }
}

function findSlashBeforeClose(source: string, start: number, close: number): boolean {
  const index = previousNonWhitespace(source, close - 1);
  return index >= start && source[index] === "/";
}

function previousNonWhitespace(source: string, offset: number): number {
  let index = offset;
  while (index >= 0 && /\s/.test(source[index])) {
    index -= 1;
  }
  return index;
}

function parseAttributes(source: string, start: number, end: number): { values: Record<string, string>; ranges: Record<string, AttrRange> } {
  const values: Record<string, string> = {};
  const ranges: Record<string, AttrRange> = {};
  let index = start;

  while (index < end) {
    index = skipWhitespace(source, index);
    if (index >= end) {
      break;
    }

    const nameStart = index;
    while (index < end && !/[\s=>/]/.test(source[index])) {
      index += 1;
    }
    const rawName = source.slice(nameStart, index);
    if (!rawName) {
      index += 1;
      continue;
    }
    const name = rawName.toLowerCase();
    index = skipWhitespace(source, index);

    let value = "";
    let valueStart: number | undefined;
    let valueEnd: number | undefined;
    let quote: "\"" | "'" | undefined;

    if (source[index] === "=") {
      index += 1;
      index = skipWhitespace(source, index);
      if (source[index] === "\"" || source[index] === "'") {
        quote = source[index] as "\"" | "'";
        index += 1;
        valueStart = index;
        while (index < end && source[index] !== quote) {
          index += 1;
        }
        valueEnd = index;
        value = source.slice(valueStart, valueEnd);
        if (source[index] === quote) {
          index += 1;
        }
      } else {
        valueStart = index;
        while (index < end && !/[\s>]/.test(source[index])) {
          index += 1;
        }
        valueEnd = index;
        value = source.slice(valueStart, valueEnd);
      }
    }

    values[name] = decodeHtml(value);
    ranges[name] = { nameStart, nameEnd: nameStart + rawName.length, valueStart, valueEnd, quote };
  }

  return { values, ranges };
}

function skipWhitespace(source: string, offset: number): number {
  let index = offset;
  while (index < source.length && /\s/.test(source[index])) {
    index += 1;
  }
  return index;
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replace(/"/g, "&quot;");
}
