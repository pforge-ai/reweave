import { performance } from "perf_hooks";
import { ElementNode, HtmlNode, isElement, isText, RootNode, TextNode } from "../html/ast";
import { decodeHtml, parseHtml } from "../html/parser";
import { classList, collectCssRules, CssRule, getElementStyles, parseInlineStyle } from "./styles";
import { ComponentIR, ComponentKind, ComponentNode, PropKind, PropSlot, TextSlot } from "./types";

const semanticLabels: Record<string, string> = {
  body: "文档",
  header: "页眉",
  nav: "导航",
  main: "主内容",
  section: "区块",
  article: "文章",
  aside: "侧栏",
  footer: "页脚",
  figure: "图表",
  table: "表格",
  form: "表单",
  blockquote: "引述"
};

const ignoredTags = new Set(["head", "meta", "link", "style", "script", "title", "template", "noscript"]);

const classLabels: Array<[RegExp, string]> = [
  [/\bhero\b/i, "Hero"],
  [/\b(navbar|nav|menu)\b/i, "导航"],
  [/\b(card|tile)\b/i, "卡片"],
  [/\b(cards|grid|gallery|columns)\b/i, "栅格"],
  [/\b(feature|benefit)\b/i, "特性"],
  [/\b(price|pricing|plan)\b/i, "价目"],
  [/\b(testimonial|quote|review)\b/i, "引述"],
  [/\b(faq|accordion)\b/i, "FAQ"],
  [/\b(cta|call-to-action)\b/i, "CTA"],
  [/\b(timeline)\b/i, "时间线"],
  [/\b(step|stepper)\b/i, "步骤"],
  [/\b(stat|metric|kpi)\b/i, "指标"],
  [/\b(banner)\b/i, "横幅"],
  [/\b(badge|tag|chip)\b/i, "徽标"],
  [/\b(sidebar)\b/i, "侧栏"],
  [/\b(footer)\b/i, "页脚"],
  [/\b(header)\b/i, "页眉"],
  [/\b(button|btn)\b/i, "按钮"],
  [/\b(list|items)\b/i, "列表"]
];

/** Stylesheet-derived properties that the inspector exposes as inline-style overrides. */
const computedWhitelist = [
  "color",
  "background-color",
  "background",
  "border-color",
  "border-radius",
  "padding",
  "margin",
  "gap",
  "font-size",
  "font-weight",
  "line-height",
  "text-align"
];

interface RepeatInfo {
  groupId: string;
  index: number;
  count: number;
  container: ElementNode;
  labelBase: string;
  approximate: boolean;
}

interface RepeatContainerInfo {
  groupId: string;
  count: number;
  approximate: boolean;
  itemLabelBase: string;
}

export function analyzeHtml(source: string): ComponentIR {
  const started = performance.now();
  const { root } = parseHtml(source);
  const cssRules = collectCssRules(root);
  const repeatItems = new Map<ElementNode, RepeatInfo>();
  const repeatContainers = new Map<ElementNode, RepeatContainerInfo>();
  const strictCache = new Map<ElementNode, string>();
  const looseCache = new Map<ElementNode, string>();
  const allElements: ElementNode[] = [];

  walkElements(root, (element) => allElements.push(element));
  detectRepeats(root, strictCache, looseCache, repeatItems, repeatContainers);

  const body = allElements.find((element) => element.tagName === "body")
    ?? allElements.find((element) => !ignoredTags.has(element.tagName))
    ?? createSyntheticBody(source);

  let componentSeq = 0;
  let blockSeq = 1;
  const componentByElement = new Map<ElementNode, ComponentNode>();
  const nodes: ComponentNode[] = [];

  const rootComponent = createComponent(body, undefined, true);
  walkComponentChildren(body, rootComponent);

  for (const [element, component] of componentByElement) {
    component.editable = {
      text: collectTextSlots(element, componentByElement).slice(0, 24),
      props: collectPropSlots(source, element, componentByElement, cssRules).slice(0, 40)
    };
  }

  const ended = performance.now();
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    docTitle: extractDocTitle(allElements),
    palette: extractPalette(cssRules, allElements),
    root: rootComponent,
    nodes,
    stats: {
      elementCount: allElements.length,
      componentCount: nodes.length,
      repeatGroupCount: countRepeatGroups(repeatContainers),
      textSlotCount: nodes.reduce((sum, node) => sum + node.editable.text.length, 0),
      propSlotCount: nodes.reduce((sum, node) => sum + node.editable.props.length, 0),
      durationMs: Math.round((ended - started) * 100) / 100
    }
  };

  function walkComponentChildren(element: ElementNode, current: ComponentNode): void {
    for (const child of element.children) {
      if (!isElement(child) || ignoredTags.has(child.tagName)) {
        continue;
      }
      const candidate = shouldCreateComponent(child, current, cssRules, repeatItems, repeatContainers);
      const next = candidate ? createComponent(child, current, false) : current;
      walkComponentChildren(child, next);
    }
  }

  function createComponent(element: ElementNode, parent: ComponentNode | undefined, forcedRoot: boolean): ComponentNode {
    const repeatInfo = repeatItems.get(element);
    const repeatContainer = repeatContainers.get(element);
    const classes = classList(element);
    const signals = collectSignals(element, cssRules, repeatInfo, repeatContainer);
    const kind = getKind(element, forcedRoot, repeatInfo, repeatContainer);
    const label = getLabel(element, kind, repeatInfo, repeatContainer, () => blockSeq++);
    const component: ComponentNode = {
      id: `cmp_${componentSeq++}`,
      kind,
      label,
      tagName: element.tagName,
      classList: classes,
      source: { start: element.start, end: element.end },
      domPath: getDomPath(element),
      parentId: parent?.id,
      repeatGroupId: repeatInfo?.groupId ?? repeatContainer?.groupId,
      repeatIndex: repeatInfo ? repeatInfo.index : undefined,
      repeatCount: repeatInfo ? repeatInfo.count : repeatContainer?.count,
      approximate: repeatInfo?.approximate || repeatContainer?.approximate || undefined,
      signals,
      editable: { text: [], props: [] },
      children: []
    };

    componentByElement.set(element, component);
    nodes.push(component);
    if (parent) {
      parent.children.push(component);
    }
    return component;
  }
}

function countRepeatGroups(repeatContainers: Map<ElementNode, RepeatContainerInfo>): number {
  const ids = new Set<string>();
  for (const info of repeatContainers.values()) {
    ids.add(info.groupId);
  }
  return ids.size;
}

function shouldCreateComponent(
  element: ElementNode,
  current: ComponentNode,
  cssRules: CssRule[],
  repeatItems: Map<ElementNode, RepeatInfo>,
  repeatContainers: Map<ElementNode, RepeatContainerInfo>
): boolean {
  if (ignoredTags.has(element.tagName)) {
    return false;
  }
  if (repeatItems.has(element) || repeatContainers.has(element)) {
    return true;
  }
  if (semanticLabels[element.tagName] && element.tagName !== "body") {
    return true;
  }
  if (getClassLabel(element)) {
    return true;
  }
  if (isLayoutContainer(element, cssRules)) {
    return true;
  }
  if (["body", "main", "section", "article", "aside"].includes(current.tagName)) {
    return elementChildren(element).length > 0 || hasMeaningfulText(element);
  }
  return false;
}

function collectSignals(
  element: ElementNode,
  cssRules: CssRule[],
  repeatInfo?: RepeatInfo,
  repeatContainer?: RepeatContainerInfo
): string[] {
  const signals: string[] = [];
  if (repeatInfo) {
    signals.push(repeatInfo.approximate ? "重复项 (近似)" : "重复项");
  }
  if (repeatContainer) {
    signals.push(repeatContainer.approximate ? "重复组 (近似)" : "重复组");
  }
  if (semanticLabels[element.tagName]) {
    signals.push("语义标签");
  }
  if (getClassLabel(element)) {
    signals.push("class 模式");
  }
  if (isLayoutContainer(element, cssRules)) {
    signals.push("布局容器");
  }
  return signals;
}

function getKind(
  element: ElementNode,
  forcedRoot: boolean,
  repeatInfo?: RepeatInfo,
  repeatContainer?: RepeatContainerInfo
): ComponentKind {
  if (forcedRoot) {
    return "root";
  }
  if (repeatInfo) {
    return "repeat-item";
  }
  if (repeatContainer) {
    return "repeat-group";
  }
  return elementChildren(element).length === 0 ? "leaf" : "block";
}

function getLabel(
  element: ElementNode,
  kind: ComponentKind,
  repeatInfo: RepeatInfo | undefined,
  repeatContainer: RepeatContainerInfo | undefined,
  nextBlockNumber: () => number
): string {
  if (kind === "root") {
    return "文档";
  }
  if (repeatInfo) {
    const heading = firstHeadingText(element) ?? textSnippet(element, 12);
    return heading ? `${repeatInfo.labelBase} · ${heading}` : `${repeatInfo.labelBase} · ${repeatInfo.index}`;
  }
  if (repeatContainer) {
    const base = repeatContainer.itemLabelBase !== "重复项"
      ? repeatContainer.itemLabelBase
      : getClassLabel(element) ?? semanticLabels[element.tagName] ?? "重复组";
    return `${base} ×${repeatContainer.count}`;
  }

  const heading = firstHeadingText(element);
  const semantic = semanticLabels[element.tagName];
  if (semantic) {
    return heading ? `${semantic} · ${heading}` : semantic;
  }
  const classLabel = getClassLabel(element);
  if (classLabel) {
    return heading ? `${classLabel} · ${heading}` : classLabel;
  }
  const idLabel = humanizeIdentifier(element.attrs.id);
  if (idLabel) {
    return idLabel;
  }
  if (kind === "leaf") {
    const snippet = textSnippet(element, 12);
    return snippet ? `${element.tagName.toUpperCase()} · ${snippet}` : element.tagName.toUpperCase();
  }
  return heading ? `区块 · ${heading}` : `区块 ${nextBlockNumber()}`;
}

function getClassLabel(element: ElementNode): string | undefined {
  const combined = classList(element).join(" ");
  for (const [pattern, label] of classLabels) {
    if (pattern.test(combined)) {
      return label;
    }
  }
  return undefined;
}

function humanizeIdentifier(id: string | undefined): string | undefined {
  if (!id || !/^[A-Za-z][\w-]*$/.test(id)) {
    return undefined;
  }
  const words = id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!words) {
    return undefined;
  }
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function firstHeadingText(element: ElementNode): string | undefined {
  let found: string | undefined;
  const visit = (node: ElementNode): void => {
    if (found) {
      return;
    }
    if (/^h[1-6]$/.test(node.tagName)) {
      const text = textSnippet(node, 18);
      if (text) {
        found = text;
        return;
      }
    }
    for (const child of node.children) {
      if (isElement(child) && !ignoredTags.has(child.tagName)) {
        visit(child);
      }
    }
  };
  visit(element);
  return found;
}

function textSnippet(element: ElementNode, maxLength: number): string | undefined {
  const parts: string[] = [];
  let total = 0;
  const visit = (node: HtmlNode): void => {
    if (total >= maxLength + 4) {
      return;
    }
    if (isText(node)) {
      const value = node.value.replace(/\s+/g, " ").trim();
      if (value) {
        parts.push(value);
        total += value.length;
      }
      return;
    }
    if (isElement(node) && !ignoredTags.has(node.tagName)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  for (const child of element.children) {
    visit(child);
  }
  const joined = decodeHtml(parts.join(" ")).trim();
  if (!joined) {
    return undefined;
  }
  return joined.length > maxLength ? `${joined.slice(0, maxLength)}…` : joined;
}

function isLayoutContainer(element: ElementNode, cssRules: CssRule[]): boolean {
  const styles = getElementStyles(element, cssRules);
  if (styles.display === "grid" || styles.display === "flex" || styles.display === "inline-flex") {
    return elementChildren(element).length >= 2;
  }
  const classes = classList(element).join(" ");
  return /\b(grid|cards|columns|row|gallery|list)\b/i.test(classes) && elementChildren(element).length >= 2;
}

/**
 * Two-tier repeat detection. Consecutive siblings are grouped by a relaxed
 * fingerprint (tag + class pattern + direct-child shape); a group whose members
 * also share the strict recursive fingerprint is exact, otherwise approximate.
 * This keeps "three identical cards plus one with an extra badge" in one group.
 */
function detectRepeats(
  root: RootNode,
  strictCache: Map<ElementNode, string>,
  looseCache: Map<ElementNode, string>,
  repeatItems: Map<ElementNode, RepeatInfo>,
  repeatContainers: Map<ElementNode, RepeatContainerInfo>
): void {
  let groupSeq = 1;
  walkElements(root, (parent) => {
    const children = elementChildren(parent).filter((child) => !ignoredTags.has(child.tagName));
    if (children.length < 2) {
      return;
    }

    let start = 0;
    while (start < children.length) {
      const loose = looseFingerprint(children[start], looseCache);
      let end = start + 1;
      while (end < children.length && looseFingerprint(children[end], looseCache) === loose) {
        end += 1;
      }

      const count = end - start;
      if (count >= 2 && loose !== "empty") {
        const strictFirst = strictFingerprint(children[start], strictCache);
        let approximate = false;
        for (let index = start + 1; index < end; index += 1) {
          if (strictFingerprint(children[index], strictCache) !== strictFirst) {
            approximate = true;
            break;
          }
        }
        const groupId = `grp_${groupSeq++}`;
        const labelBase = getClassLabel(children[start])
          ?? semanticLabels[children[start].tagName]
          ?? defaultItemLabel(children[start]);
        repeatContainers.set(parent, { groupId, count, approximate, itemLabelBase: labelBase });
        for (let index = start; index < end; index += 1) {
          repeatItems.set(children[index], {
            groupId,
            index: index - start + 1,
            count,
            container: parent,
            labelBase,
            approximate
          });
        }
      }
      start = end;
    }
  });
}

const defaultItemLabels: Record<string, string> = {
  li: "列表项",
  tr: "表格行",
  a: "链接",
  p: "段落",
  img: "图片",
  button: "按钮",
  option: "选项",
  dt: "条目",
  dd: "释义"
};

function defaultItemLabel(element: ElementNode): string {
  return defaultItemLabels[element.tagName] ?? "重复项";
}

function strictFingerprint(element: ElementNode, cache: Map<ElementNode, string>): string {
  const cached = cache.get(element);
  if (cached) {
    return cached;
  }
  const classes = classPattern(element);
  const childElements = elementChildren(element);
  const textMarker = element.children.some((child) => isText(child) && child.value.trim()) ? "txt" : "";
  const childFingerprints = childElements.map((child) => strictFingerprint(child, cache)).join(",");
  const result = childElements.length === 0 && !textMarker
    ? "empty"
    : `${element.tagName}[${classes}](${textMarker}:${childFingerprints})`;
  cache.set(element, result);
  return result;
}

/**
 * Relaxed shape signature. When the element carries a class pattern, the class
 * itself is treated as the identity ("card" stays "card" even if one instance
 * has an extra badge). Class-less elements fall back to comparing the direct
 * child shape so anonymous divs do not over-group.
 */
function looseFingerprint(element: ElementNode, cache: Map<ElementNode, string>): string {
  const cached = cache.get(element);
  if (cached) {
    return cached;
  }
  const classes = classPattern(element);
  const childElements = elementChildren(element);
  const textMarker = element.children.some((child) => isText(child) && child.value.trim()) ? "txt" : "";
  let result: string;
  if (childElements.length === 0 && !textMarker) {
    result = "empty";
  } else if (classes) {
    result = `${element.tagName}[${classes}]`;
  } else {
    const childShape = childElements
      .map((child) => `${child.tagName}.${classPattern(child)}`)
      .join(",");
    result = `${element.tagName}[]{${textMarker}|${childShape}}`;
  }
  cache.set(element, result);
  return result;
}

function classPattern(element: ElementNode): string {
  return classList(element)
    .map((className) => className.toLowerCase().replace(/\d+/g, "#"))
    .sort()
    .join(".");
}

function extractDocTitle(elements: ElementNode[]): string | undefined {
  const title = elements.find((element) => element.tagName === "title");
  const titleText = title ? textFromChildren(title) : undefined;
  if (titleText) {
    return titleText;
  }
  const h1 = elements.find((element) => element.tagName === "h1");
  return h1 ? textSnippet(h1, 40) : undefined;
}

function textFromChildren(element: ElementNode): string | undefined {
  const value = element.children
    .filter(isText)
    .map((child) => child.value)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return value ? decodeHtml(value) : undefined;
}

const colorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;

function extractPalette(cssRules: CssRule[], elements: ElementNode[]): string[] {
  const counts = new Map<string, number>();
  const record = (value: string | undefined): void => {
    if (!value) {
      return;
    }
    for (const match of value.match(colorPattern) ?? []) {
      const color = match.toLowerCase();
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  };

  for (const rule of cssRules) {
    for (const value of Object.values(rule.declarations)) {
      record(value);
    }
  }
  for (const element of elements) {
    record(element.attrs.style);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([color]) => color);
}

function collectTextSlots(element: ElementNode, componentByElement: Map<ElementNode, ComponentNode>): TextSlot[] {
  const slots: TextSlot[] = [];
  let seq = 1;
  walkDescendants(element, componentByElement, (node) => {
    if (!isText(node) || !node.value.trim() || !node.parent || node.parent.type !== "element") {
      return;
    }
    const parent = node.parent;
    if (ignoredTags.has(parent.tagName)) {
      return;
    }
    const trimmed = trimSourceText(node);
    if (!trimmed) {
      return;
    }
    slots.push({
      id: `${element.id}_txt_${seq++}`,
      label: textSlotLabel(parent),
      value: decodeHtml(trimmed.value),
      source: { start: trimmed.start, end: trimmed.end },
      domPath: getDomPath(parent)
    });
  });
  return slots;
}

const textSlotLabels: Record<string, string> = {
  h1: "标题 H1",
  h2: "标题 H2",
  h3: "标题 H3",
  h4: "标题 H4",
  h5: "标题 H5",
  h6: "标题 H6",
  p: "段落",
  a: "链接文字",
  button: "按钮文字",
  li: "列表项",
  span: "文本",
  strong: "强调",
  em: "强调",
  blockquote: "引述",
  td: "单元格",
  th: "表头",
  caption: "表标题",
  figcaption: "图注",
  label: "标签",
  small: "辅助文字"
};

function textSlotLabel(parent: ElementNode): string {
  return textSlotLabels[parent.tagName] ?? `${parent.tagName.toUpperCase()} 文本`;
}

function collectPropSlots(
  source: string,
  element: ElementNode,
  componentByElement: Map<ElementNode, ComponentNode>,
  cssRules: CssRule[]
): PropSlot[] {
  const slots: PropSlot[] = [];
  let seq = 1;

  const collectAttrSlots = (target: ElementNode): void => {
    for (const attrName of ["href", "src", "alt"]) {
      const value = target.attrs[attrName];
      const range = target.attrRanges[attrName];
      if (value === undefined || range?.valueStart === undefined || range.valueEnd === undefined) {
        continue;
      }
      slots.push({
        id: `${element.id}_prop_${seq++}`,
        key: attrName,
        label: attrSlotLabel(target.tagName, attrName),
        kind: attrName === "href" ? "link" : attrName === "src" ? "image" : "text",
        value,
        target: "attribute",
        origin: "attribute",
        attrName,
        source: { start: range.valueStart, end: range.valueEnd },
        domPath: getDomPath(target)
      });
    }
  };

  collectAttrSlots(element);
  walkDescendantElements(element, componentByElement, collectAttrSlots);

  const styleRange = element.attrRanges.style;
  const styleSource = styleRange?.valueStart !== undefined && styleRange.valueEnd !== undefined
    ? { start: styleRange.valueStart, end: styleRange.valueEnd }
    : undefined;
  const styleInsertAt = styleSource ? undefined : findStyleInsertOffset(source, element);

  const inlineStyles = parseInlineStyle(element.attrs.style);
  for (const [styleName, value] of Object.entries(inlineStyles)) {
    slots.push({
      id: `${element.id}_prop_${seq++}`,
      key: styleName,
      label: styleName,
      kind: styleKind(styleName),
      value,
      target: "inline-style",
      origin: "inline",
      styleName,
      source: styleSource,
      domPath: getDomPath(element)
    });
  }

  const computed = getElementStyles(element, cssRules);
  for (const styleName of computedWhitelist) {
    if (inlineStyles[styleName] || !computed[styleName]) {
      continue;
    }
    slots.push({
      id: `${element.id}_prop_${seq++}`,
      key: styleName,
      label: styleName,
      kind: styleKind(styleName),
      value: computed[styleName],
      target: "inline-style",
      origin: "stylesheet",
      styleName,
      source: styleSource,
      insertAt: styleSource ? undefined : styleInsertAt,
      domPath: getDomPath(element)
    });
  }

  return slots;
}

const attrSlotLabelNames: Record<string, string> = {
  href: "链接地址",
  src: "资源地址",
  alt: "替代文本"
};

function attrSlotLabel(tagName: string, attrName: string): string {
  return `${tagName.toUpperCase()} ${attrSlotLabelNames[attrName] ?? attrName}`;
}

function styleKind(styleName: string): PropKind {
  if (styleName.includes("color") || styleName === "background") {
    return "color";
  }
  if (/^(padding|margin|gap|inset|top|left|right|bottom|width|height|max-|min-)/.test(styleName)) {
    return "spacing";
  }
  if (/^(font|line-height|letter-spacing|text-align|text-transform|text-decoration)/.test(styleName)) {
    return "typography";
  }
  if (/^(display|flex|grid|align|justify|order|position|z-index|overflow)/.test(styleName)) {
    return "layout";
  }
  return "raw-style";
}

/** Offset where a brand-new ` style="..."` attribute can be inserted into the open tag. */
function findStyleInsertOffset(source: string, element: ElementNode): number | undefined {
  let index = element.openEnd - 1;
  if (index <= element.openStart || source[index] !== ">") {
    return undefined;
  }
  let cursor = index - 1;
  while (cursor > element.openStart && /\s/.test(source[cursor])) {
    cursor -= 1;
  }
  if (source[cursor] === "/") {
    return cursor;
  }
  return cursor + 1;
}

function walkDescendants(root: ElementNode, componentByElement: Map<ElementNode, ComponentNode>, visitor: (node: HtmlNode) => void): void {
  for (const child of root.children) {
    const childComponent = isElement(child) ? componentByElement.get(child) : undefined;
    if (childComponent && childComponent.kind !== "leaf") {
      continue;
    }
    visitor(child);
    if (isElement(child)) {
      walkDescendants(child, componentByElement, visitor);
    }
  }
}

function walkDescendantElements(root: ElementNode, componentByElement: Map<ElementNode, ComponentNode>, visitor: (element: ElementNode) => void): void {
  walkDescendants(root, componentByElement, (node) => {
    if (isElement(node)) {
      visitor(node);
    }
  });
}

function trimSourceText(node: TextNode): { start: number; end: number; value: string } | undefined {
  const first = node.value.search(/\S/);
  if (first === -1) {
    return undefined;
  }
  const last = node.value.search(/\s*$/);
  const valueEndOffset = last === -1 ? node.value.length : last;
  return {
    start: node.start + first,
    end: node.start + valueEndOffset,
    value: node.value.slice(first, valueEndOffset)
  };
}

function getDomPath(element: ElementNode): string {
  const segments: string[] = [];
  let current: ElementNode | undefined = element;
  while (current) {
    if (current.tagName === "html" || current.tagName === "body") {
      segments.unshift(current.tagName);
    } else {
      segments.unshift(`${current.tagName}:nth-of-type(${nthOfType(current)})`);
    }
    current = current.parent && current.parent.type === "element" ? current.parent : undefined;
  }
  return segments.join(" > ");
}

function nthOfType(element: ElementNode): number {
  const parent = element.parent;
  if (!parent) {
    return 1;
  }
  let index = 0;
  for (const child of parent.children) {
    if (isElement(child) && child.tagName === element.tagName) {
      index += 1;
      if (child === element) {
        return index;
      }
    }
  }
  return 1;
}

function walkElements(root: RootNode | ElementNode, visitor: (element: ElementNode) => void): void {
  for (const child of root.children) {
    if (!isElement(child)) {
      continue;
    }
    visitor(child);
    walkElements(child, visitor);
  }
}

function elementChildren(element: ElementNode): ElementNode[] {
  return element.children.filter(isElement);
}

function hasMeaningfulText(element: ElementNode): boolean {
  return element.children.some((child) => isText(child) && child.value.trim().length > 0);
}

function createSyntheticBody(source: string): ElementNode {
  return {
    id: "synthetic_body",
    type: "element",
    tagName: "body",
    attrs: {},
    attrRanges: {},
    start: 0,
    end: source.length,
    openStart: 0,
    openEnd: 0,
    selfClosing: false,
    children: []
  };
}
