import { ElementNode, isElement, RootNode } from "../html/ast";

export interface CssRule {
  selector: string;
  declarations: Record<string, string>;
  order: number;
}

export function collectCssRules(root: RootNode): CssRule[] {
  const rules: CssRule[] = [];
  let order = 0;

  visitElements(root, (element) => {
    if (element.tagName !== "style") {
      return;
    }
    const css = element.children.map((child) => (child.type === "text" ? child.value : "")).join("");
    for (const rule of parseCssRules(css)) {
      rules.push({ ...rule, order: order++ });
    }
  });

  return rules;
}

export function parseInlineStyle(value: string | undefined): Record<string, string> {
  if (!value) {
    return {};
  }
  const declarations: Record<string, string> = {};
  for (const part of value.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const key = part.slice(0, colon).trim().toLowerCase();
    const val = part.slice(colon + 1).trim();
    if (key && val) {
      declarations[key] = val;
    }
  }
  return declarations;
}

export function serializeInlineStyle(declarations: Record<string, string>): string {
  return Object.entries(declarations)
    .filter(([key, value]) => key && value)
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
}

export function getElementStyles(element: ElementNode, rules: CssRule[]): Record<string, string> {
  const declarations: Record<string, string> = {};
  const matchingRules = rules
    .filter((rule) => selectorMatches(rule.selector, element))
    .sort((a, b) => a.order - b.order);

  for (const rule of matchingRules) {
    Object.assign(declarations, rule.declarations);
  }
  Object.assign(declarations, parseInlineStyle(element.attrs.style));
  return declarations;
}

export function visitElements(root: RootNode | ElementNode, visitor: (element: ElementNode) => void): void {
  for (const child of root.children) {
    if (!isElement(child)) {
      continue;
    }
    visitor(child);
    visitElements(child, visitor);
  }
}

function parseCssRules(css: string): CssRule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  const regex = /([^{}]+)\{([^{}]+)\}/g;
  let match: RegExpExecArray | null;
  let order = 0;
  while ((match = regex.exec(withoutComments))) {
    const selectors = match[1].split(",").map((selector) => selector.trim()).filter(Boolean);
    const declarations = parseInlineStyle(match[2]);
    for (const selector of selectors) {
      rules.push({ selector, declarations, order: order++ });
    }
  }
  return rules;
}

function selectorMatches(selector: string, element: ElementNode): boolean {
  const last = selector.trim().split(/\s+/).pop();
  if (!last || /[>+~:[\]]/.test(last)) {
    return false;
  }

  if (last === "*") {
    return true;
  }

  const id = element.attrs.id;
  const classes = classList(element);
  const tagMatch = last.match(/^[A-Za-z][A-Za-z0-9_-]*/)?.[0]?.toLowerCase();
  const idMatch = last.match(/#([A-Za-z0-9_-]+)/)?.[1];
  const classMatches = Array.from(last.matchAll(/\.([A-Za-z0-9_-]+)/g)).map((match) => match[1]);

  if (tagMatch && tagMatch !== element.tagName) {
    return false;
  }
  if (idMatch && idMatch !== id) {
    return false;
  }
  return classMatches.every((className) => classes.includes(className));
}

export function classList(element: ElementNode): string[] {
  return (element.attrs.class ?? "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
