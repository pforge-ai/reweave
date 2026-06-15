export type HtmlNode = RootNode | ElementNode | TextNode | CommentNode;

export interface SourceRange {
  start: number;
  end: number;
}

export interface RootNode {
  id: string;
  type: "root";
  start: 0;
  end: number;
  children: HtmlNode[];
}

export interface AttrRange {
  nameStart: number;
  nameEnd: number;
  valueStart?: number;
  valueEnd?: number;
  quote?: "\"" | "'";
}

export interface ElementNode {
  id: string;
  type: "element";
  tagName: string;
  attrs: Record<string, string>;
  attrRanges: Record<string, AttrRange>;
  start: number;
  end: number;
  openStart: number;
  openEnd: number;
  closeStart?: number;
  closeEnd?: number;
  selfClosing: boolean;
  parent?: ElementNode | RootNode;
  children: HtmlNode[];
}

export interface TextNode {
  id: string;
  type: "text";
  start: number;
  end: number;
  value: string;
  parent?: ElementNode | RootNode;
}

export interface CommentNode {
  id: string;
  type: "comment";
  start: number;
  end: number;
  value: string;
  parent?: ElementNode | RootNode;
}

export function isElement(node: HtmlNode): node is ElementNode {
  return node.type === "element";
}

export function isText(node: HtmlNode): node is TextNode {
  return node.type === "text";
}
