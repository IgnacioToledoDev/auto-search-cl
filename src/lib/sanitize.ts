import { HTMLElement, Node, NodeType, parse } from "node-html-parser";

/**
 * Characters invisible to a human reader but readable by a model, commonly
 * used to smuggle prompt-injection text: Unicode tag characters, bidi
 * controls, zero-width characters, soft hyphen and BOM.
 */
const INVISIBLE =
  /[\u{E0000}-\u{E007F}​-‏‪-‮⁠-⁤⁦-⁩؜᠎­﻿]/gu;

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, "");
}

const DROPPED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "SVG", "IFRAME"]);
const BLOCK_TAGS = new Set([
  "P", "DIV", "BR", "LI", "UL", "OL", "TR", "TD", "TH", "TABLE", "SECTION",
  "ARTICLE", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "FOOTER", "DT", "DD",
]);

function isHidden(el: HTMLElement): boolean {
  if (el.hasAttribute("hidden")) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  const style = el.getAttribute("style") ?? "";
  return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style);
}

function collect(node: Node, out: string[]): void {
  if (node.nodeType === NodeType.TEXT_NODE) {
    out.push(node.text);
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  const tag = node.tagName ?? "";
  if (DROPPED_TAGS.has(tag) || isHidden(node)) return;
  const block = BLOCK_TAGS.has(tag);
  if (block) out.push(" ");
  for (const child of node.childNodes) collect(child, out);
  if (block) out.push(" ");
}

/**
 * Reduce HTML to the text a human would see: drops comments, script/style and
 * hidden elements, strips tags, decodes entities, removes invisible
 * characters and collapses whitespace.
 */
export function visibleHtml(html: string): string {
  const root = parse(stripInvisible(html), { comment: false });
  const parts: string[] = [];
  collect(root, parts);
  return stripInvisible(parts.join("")).replace(/\s+/g, " ").trim();
}
