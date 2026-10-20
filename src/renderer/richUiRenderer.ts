import type { RichUiBlock } from "../types/content";
import { el } from "./dom";

interface RichNode { tag: string; attrs: string; children: Array<RichNode | string>; }
const COMPONENT_TAGS = new Set(["box","row","col","grid","grid-item","flow","flow-item","card","text","title","caption","label","badge","icon","divider","spacer","list","list-item","table","table-row","table-cell","table-section","svg","blockquote","button","pressable","AsyncImage","AsyncImageGroup","AsyncVideo","img","a","Entity","Link","Chart","MapWidgetV2"]);

function parseMarkup(source: string): RichNode {
  const root: RichNode = { tag: "root", attrs: "", children: [] };
  const stack: RichNode[] = [root];
  const token = /<\/?([A-Za-z][\w-]*)\b([^>]*?)>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(source))) {
    if (match.index > cursor) stack[stack.length - 1].children.push(source.slice(cursor, match.index));
    const full = match[0], tag = match[1], attrs = match[2] ?? "";
    if (!COMPONENT_TAGS.has(tag)) {
      stack[stack.length - 1].children.push(full);
      cursor = token.lastIndex;
      continue;
    }
    if (full.startsWith("</")) {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
    } else {
      const node: RichNode = { tag, attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!full.endsWith("/>")) stack.push(node);
    }
    cursor = token.lastIndex;
  }
  if (cursor < source.length) stack[stack.length - 1].children.push(source.slice(cursor));
  return root;
}

function getAttr(attrs: string, name: string): string | undefined {
  const quoted = attrs.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*"([^"]*)"'));
  const single = attrs.match(new RegExp("(?:^|\\s)" + name + "\\s*=\\s*'([^']*)'"));
  const braced = attrs.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*\\{([^}]*)\\}'));
  const value = quoted?.[1] ?? single?.[1] ?? braced?.[1];
  if (value !== undefined) return value.replace(/^["']|["']$/g, "");
  return new RegExp("(?:^|\\s)" + name + "(?:\\s|$)").test(attrs) ? "true" : undefined;
}
function numericAttr(attrs: string, name: string): number | undefined {
  const raw = getAttr(attrs, name);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
function setStyle(element: HTMLElement, node: RichNode): void {
  const a = node.attrs, padding = numericAttr(a, "padding"), gap = numericAttr(a, "gap");
  const radius = getAttr(a, "radius"), background = getAttr(a, "background");
  const align = getAttr(a, "align"), width = getAttr(a, "width"), direction = getAttr(a, "direction");
  if (padding !== undefined) element.style.padding = (padding * 4) + "px";
  if (gap !== undefined) element.style.gap = (gap * 4) + "px";
  if (radius) element.style.borderRadius = ({sm:"4px",md:"8px",lg:"12px",full:"9999px"} as Record<string,string>)[radius] ?? radius;
  if (background && /^(#[0-9a-f]{3,8}|transparent|white|black|[a-z]+)$/i.test(background)) element.style.backgroundColor = background;
  if (getAttr(a, "border")) element.style.border = "1px solid var(--pdf-rule)";
  if (align === "center") element.style.alignItems = "center";
  if (align === "end" || align === "right") element.style.alignItems = "flex-end";
  if (align === "start" || align === "left") element.style.alignItems = "flex-start";
  if (getAttr(a, "justify") === "center") element.style.justifyContent = "center";
  if (getAttr(a, "justify") === "between") element.style.justifyContent = "space-between";
  if (width && /^(\d+(\.\d+)?(px|%|rem|em|vw))$/.test(width)) element.style.width = width;
  if (direction === "row") element.style.flexDirection = "row";
  if (direction === "column") element.style.flexDirection = "column";
  if (["box","row","col","grid","grid-item","flow","flow-item","card"].includes(node.tag)) {
    element.style.display = "flex";
    element.style.flexDirection = node.tag === "row" ? "row" : "column";
    element.style.alignItems ||= "stretch";
  }
  if (node.tag === "grid") element.style.flexWrap = "wrap";
  if (node.tag === "grid-item") element.style.flex = "1 1 120px";
  if (node.tag === "text" || node.tag === "caption" || node.tag === "label") {
    const size = getAttr(a, "size");
    if (size === "sm") element.style.fontSize = ".82em";
    if (size === "lg") element.style.fontSize = "1.15em";
    if (size === "xl") element.style.fontSize = "1.3em";
    if (getAttr(a, "color") === "secondary") element.style.color = "var(--pdf-muted)";
  }
  if (node.tag === "title") { element.style.fontWeight = "600"; element.style.fontSize = "1.12em"; }
  if (node.tag === "badge") { element.style.display = "inline-block"; element.style.border = "1px solid var(--pdf-rule)"; element.style.borderRadius = "9999px"; element.style.padding = ".12em .5em"; }
}
function safeImageUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = value.trim();
  if (/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function renderImage(document: Document, node: RichNode): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "rich-ui-image-wrap";
  const src = safeImageUrl(getAttr(node.attrs, "src") ?? getAttr(node.attrs, "url"));
  const alt = getAttr(node.attrs, "alt") ?? getAttr(node.attrs, "query") ?? getAttr(node.attrs, "fallback") ?? "Image";
  const img = document.createElement("img");
  img.className = "rich-ui-image";
  img.alt = alt;
  if (src) {
    img.src = src;
    const width = getAttr(node.attrs, "width");
    const height = getAttr(node.attrs, "height");
  if (width && /^(\d+(\.\d+)?(px|%|rem|em|vw))$/.test(width)) element.style.width = width;
    if (height && /^(\d+(\.\d+)?(px|%|rem|em|vh))$/.test(height)) img.style.height = height;
    const fit = getAttr(node.attrs, "fit");
    img.style.objectFit = fit === "contain" || fit === "cover" ? fit : "contain";
    const radius = getAttr(node.attrs, "radius");
    if (radius) img.style.borderRadius = ({sm:"4px",md:"8px",lg:"12px",full:"9999px"} as Record<string,string>)[radius] ?? radius;
    wrapper.appendChild(img);
  } else {
    wrapper.classList.add("rich-ui-image-placeholder");
    wrapper.textContent = alt ? "[Image: " + alt + "]" : "[Image]";
  }
  return wrapper;
}

function renderNode(document: Document, node: RichNode): Node {
  if (node.tag === "root") {
    const f = document.createDocumentFragment();
    node.children.forEach(child => f.appendChild(renderNode(document, typeof child === "string" ? {tag:"raw-text",attrs:"",children:[child]} : child)));
    return f;
  }
  if (node.tag === "raw-text") {
    const f = document.createDocumentFragment();
    const parts = node.children.join("").replace(/\r\n?/g,"\n").split("\n");
    parts.forEach((part,index) => {
      if (part.trim()) { const p=document.createElement("p"); p.textContent=part.trim(); f.appendChild(p); }
      else if (index > 0 && index < parts.length-1) f.appendChild(document.createElement("br"));
    });
    return f;
  }
  if (node.tag === "AsyncImage" || node.tag === "img") return renderImage(document, node);
  if (node.tag === "AsyncImageGroup") {
    const group = document.createElement("div");
    group.className = "rich-ui-image-group";
    const src = getAttr(node.attrs, "src") ?? getAttr(node.attrs, "url");
    if (src) group.appendChild(renderImage(document, node));
    else {
      const placeholder = document.createElement("div");
      placeholder.className = "rich-ui-image-placeholder";
      placeholder.textContent = "[Images" + (getAttr(node.attrs, "query") ? ": " + getAttr(node.attrs, "query") : "") + "]";
      group.appendChild(placeholder);
    }
    return group;
  }
  if (node.tag === "AsyncVideo") {
    const placeholder = document.createElement("div");
    placeholder.className = "rich-ui-image-placeholder";
    placeholder.textContent = "[Video]";
    return placeholder;
  }
  if (node.tag === "Link" || node.tag === "a") {
    const href = safeImageUrl(getAttr(node.attrs, "url") ?? getAttr(node.attrs, "href"));
    const link = document.createElement("a");
    if (href) link.href = href;
    node.children.forEach(child => link.appendChild(renderNode(document, typeof child === "string" ? {tag:"raw-text",attrs:"",children:[child]} : child)));
    return link;
  }
  if (node.tag === "icon") {
    const span = document.createElement("span"), name = getAttr(node.attrs,"name") ?? "";
    span.className = "rich-ui-icon";
    span.textContent = name.includes("arrow-down") ? "↓" : name.includes("arrow-up") ? "↑" : name.includes("check") ? "✓" : name.includes("close") ? "×" : name.includes("chevron") ? "⌄" : "•";
    return span;
  }
  if (node.tag === "divider") return document.createElement("hr");
  if (node.tag === "spacer") { const s=document.createElement("div"); s.style.height=((numericAttr(node.attrs,"minSize") ?? 2)*4)+"px"; return s; }
  let tag = "div";
  if (node.tag === "title") tag = "h4";
  if (node.tag === "list") tag = getAttr(node.attrs,"marker") === "number" ? "ol" : "ul";
  if (node.tag === "list-item") tag = "li";
  if (node.tag === "blockquote") tag = "blockquote";
  if (node.tag === "table") tag = "table";
  if (node.tag === "table-section") tag = getAttr(node.attrs,"header") === "true" ? "thead" : "tbody";
  if (node.tag === "table-row") tag = "tr";
  if (node.tag === "table-cell") tag = getAttr(node.attrs,"header") === "true" ? "th" : "td";
  if (node.tag === "badge") tag = "span";
  const element = document.createElement(tag);
  element.classList.add("rich-ui-node", "rich-ui-" + node.tag.toLowerCase());
  setStyle(element, node);
  node.children.forEach(child => element.appendChild(renderNode(document, typeof child === "string" ? {tag:"raw-text",attrs:"",children:[child]} : child)));
  return element;
}
export function renderRichUiBlock(document: Document, block: RichUiBlock): HTMLElement {
  const root = el(document, "div", "rich-ui-block");
  root.appendChild(renderNode(document, parseMarkup(block.source)));
  return root;
}
