import { SourceRange } from "../html/ast";

export type ComponentKind = "root" | "block" | "repeat-group" | "repeat-item" | "leaf";
export type PropKind = "link" | "image" | "text" | "color" | "spacing" | "typography" | "layout" | "raw-style";

export interface TextSlot {
  id: string;
  label: string;
  value: string;
  source: SourceRange;
  domPath: string;
}

/**
 * A prop slot writes back to the source in one of three ways:
 * - target "attribute": replace the attribute value range (`source`).
 * - target "inline-style" with `source`: merge into the existing style="" value range.
 * - target "inline-style" without `source`: insert a brand-new style attribute at `insertAt`
 *   (used to override values that currently come from a stylesheet).
 */
export interface PropSlot {
  id: string;
  key: string;
  label: string;
  kind: PropKind;
  value: string;
  target: "attribute" | "inline-style";
  origin: "inline" | "attribute" | "stylesheet";
  attrName?: string;
  styleName?: string;
  source?: SourceRange;
  insertAt?: number;
  domPath: string;
}

export interface EditableSlots {
  text: TextSlot[];
  props: PropSlot[];
}

export interface ComponentNode {
  id: string;
  kind: ComponentKind;
  label: string;
  tagName: string;
  classList: string[];
  source: SourceRange;
  domPath: string;
  parentId?: string;
  repeatGroupId?: string;
  repeatIndex?: number;
  repeatCount?: number;
  /** True when the repeat group was matched by the relaxed fingerprint (structure similar, not identical). */
  approximate?: boolean;
  signals: string[];
  editable: EditableSlots;
  children: ComponentNode[];
}

export interface AnalysisStats {
  elementCount: number;
  componentCount: number;
  repeatGroupCount: number;
  textSlotCount: number;
  propSlotCount: number;
  durationMs: number;
}

export interface ComponentIR {
  version: 2;
  generatedAt: string;
  docTitle?: string;
  /** Most used colors in the document, ordered by frequency. */
  palette: string[];
  root: ComponentNode;
  nodes: ComponentNode[];
  stats: AnalysisStats;
}
