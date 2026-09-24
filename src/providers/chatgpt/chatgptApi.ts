import type { ContentBlock, InlineNode, MathNode } from "../../types/content";
import type { ConversationData, ConversationMessage } from "../../types/conversation";
import { parseBlocks, blocksToPlainText } from "../../parser/blockParser";
import { chatGPTParserContext } from "./chatgptParser";
import { buildConversationStats } from "./chatgptExtractor";

interface ChatGPTApiSession {
  accessToken?: string;
  account?: { id?: string };
  accountId?: string;
  user?: { account_id?: string; accountId?: string };
}

interface ChatGPTApiNode {
  id?: string;
  parent?: string | null;
  children?: string[];
  message?: {
    id?: string;
    author?: { role?: string };
    content?: {
      content_type?: string;
      language?: string;
      parts?: unknown[];
    };
    metadata?: Record<string, unknown>;
    create_time?: number | null;
  } | null;
}

interface ChatGPTApiConversation {
  id?: string;
  title?: string;
  current_node?: string;
  mapping?: Record<string, ChatGPTApiNode>;
}

function textFromParts(parts: unknown[] | undefined): string {
  if (!Array.isArray(parts)) return "";
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      out.push(part);
      continue;
    }
    if (part && typeof part === "object") {
      const value = (part as Record<string, unknown>).text;
      if (typeof value === "string") {
        out.push(value);
        continue;
      }
      const contentType = (part as Record<string, unknown>).content_type;
      if (contentType === "image_asset_pointer") {
        const pointer = (part as Record<string, unknown>).asset_pointer;
        out.push(`[Image: ${typeof pointer === "string" ? pointer : "image"}]`);
      }
    }
  }
  return out.join("\n").trim();
}

function codeBlock(code: string, language?: string): ContentBlock {
  const normalized = code.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n").map((line, index) => ({
    number: index + 1,
    tokens: [{ text: line, tokenType: "plain" as const }],
    plainText: line
  }));
  const lengths = normalized.split("\n").map((line) => line.length);
  const maxLineLength = lengths.length ? Math.max(...lengths) : 0;
  return {
    type: "code",
    language: language?.trim() || undefined,
    displayLanguage: language?.trim() || undefined,
    code: normalized,
    lines,
    source: "plain",
    lineCount: normalized === "" ? 0 : lines.length,
    hasLongLines: maxLineLength > 100,
    maxLineLength,
    tabSize: 4
  };
}

function mathBlock(source: string, displayMode: "inline" | "block"): MathNode {
  return {
    type: "math",
    displayMode,
    source,
    sourceFormat: "latex",
    fallbackText: source,
    renderStrategy: "latex",
    sourceLength: source.length
  };
}

function appendTextWithBreaks(parent: Element, text: string): void {
  const parts = text.replace(/\r\n?/g, "\n").split("\n");
  parts.forEach((part, index) => {
    if (part) parent.appendChild(parent.ownerDocument.createTextNode(part));
    if (index < parts.length - 1) parent.appendChild(parent.ownerDocument.createElement("br"));
  });
}

function appendInline(parent: Element, source: string): void {
  let i = 0;
  let buffer = "";

  const flush = () => {
    if (!buffer) return;
    appendTextWithBreaks(parent, buffer);
    buffer = "";
  };

  while (i < source.length) {
    if (source[i] === "\`") {
      const end = source.indexOf("\`", i + 1);
      if (end >= 0) {
        flush();
        const code = parent.ownerDocument.createElement("code");
        code.textContent = source.slice(i + 1, end);
        parent.appendChild(code);
        i = end + 1;
        continue;
      }
    }

    if (source.startsWith("**", i) || source.startsWith("__", i)) {
      const marker = source.slice(i, i + 2);
      const end = source.indexOf(marker, i + 2);
      if (end > i + 2) {
        flush();
        const strong = parent.ownerDocument.createElement("strong");
        appendInline(strong, source.slice(i + 2, end));
        parent.appendChild(strong);
        i = end + 2;
        continue;
      }
    }

    if (source.startsWith("~~", i)) {
      const end = source.indexOf("~~", i + 2);
      if (end > i + 2) {
        flush();
        const del = parent.ownerDocument.createElement("del");
        appendInline(del, source.slice(i + 2, end));
        parent.appendChild(del);
        i = end + 2;
        continue;
      }
    }

    if (source[i] === "*" || source[i] === "_") {
      const marker = source[i];
      const end = source.indexOf(marker, i + 1);
      if (end > i + 1 && source[i + 1] !== " ") {
        flush();
        const em = parent.ownerDocument.createElement("em");
        appendInline(em, source.slice(i + 1, end));
        parent.appendChild(em);
        i = end + 1;
        continue;
      }
    }

    if (source[i] === "[") {
      const close = source.indexOf("]", i + 1);
      const openParen = close >= 0 ? source.indexOf("(", close + 1) : -1;
      const closeParen = openParen >= 0 ? source.indexOf(")", openParen + 1) : -1;
      if (close > i + 1 && openParen === close + 1 && closeParen > openParen + 1) {
        flush();
        const a = parent.ownerDocument.createElement("a");
        a.href = source.slice(openParen + 1, closeParen).trim();
        appendInline(a, source.slice(i + 1, close));
        parent.appendChild(a);
        i = closeParen + 1;
        continue;
      }
    }

    if (source[i] === "!" && source[i + 1] === "[") {
      const close = source.indexOf("]", i + 2);
      const openParen = close >= 0 ? source.indexOf("(", close + 1) : -1;
      const closeParen = openParen >= 0 ? source.indexOf(")", openParen + 1) : -1;
      if (close > i + 2 && openParen === close + 1 && closeParen > openParen + 1) {
        flush();
        const img = parent.ownerDocument.createElement("img");
        img.alt = source.slice(i + 2, close);
        img.src = source.slice(openParen + 1, closeParen).trim();
        parent.appendChild(img);
        i = closeParen + 1;
        continue;
      }
    }

    if (source[i] === "$" && source[i + 1] !== "$") {
      const end = source.indexOf("$", i + 1);
      if (end > i + 1) {
        flush();
        const math = parent.ownerDocument.createElement("span");
        math.setAttribute("data-latex", source.slice(i + 1, end));
        parent.appendChild(math);
        i = end + 1;
        continue;
      }
    }

    if (source.startsWith("\\(", i)) {
      const end = source.indexOf("\\)", i + 2);
      if (end > i + 2) {
        flush();
        const math = parent.ownerDocument.createElement("span");
        math.setAttribute("data-latex", source.slice(i + 2, end));
        parent.appendChild(math);
        i = end + 2;
        continue;
      }
    }

    buffer += source[i];
    i++;
  }
  flush();
}

function isTableSeparator(line: string): boolean {
  const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function appendMarkdownBlocks(root: Element, markdown: string): void {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  const paragraph = (text: string) => {
    const p = root.ownerDocument.createElement("p");
    appendInline(p, text);
    root.appendChild(p);
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([^ ]*)?\s*$/);
    if (fence) {
      const marker = fence[1];
      const language = fence[2] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      const pre = root.ownerDocument.createElement("pre");
      const code = root.ownerDocument.createElement("code");
      if (language) code.setAttribute("data-language", language);
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);
      root.appendChild(pre);
      continue;
    }

    const blockMath = line.trim().match(/^\\$\\$([\\s\\S]*)\\$\\$$/);
    if (blockMath) {
      const math = root.ownerDocument.createElement("div");
      math.setAttribute("data-latex", blockMath[1].trim());
      math.setAttribute("data-math-style", "block");
      root.appendChild(math);
      i++;
      continue;
    }
    if (line.trim() === "$$") {
      const mathLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "$$") {
        mathLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      const math = root.ownerDocument.createElement("div");
      math.setAttribute("data-latex", mathLines.join("\n").trim());
      math.setAttribute("data-math-style", "block");
      root.appendChild(math);
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      const h = root.ownerDocument.createElement(`h${heading[1].length}`);
      appendInline(h, heading[2]);
      root.appendChild(h);
      i++;
      continue;
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      root.appendChild(root.ownerDocument.createElement("hr"));
      i++;
      continue;
    }

    if (i + 1 < lines.length && line.includes("|") && isTableSeparator(lines[i + 1])) {
      const table = root.ownerDocument.createElement("table");
      const thead = root.ownerDocument.createElement("thead");
      const trHead = root.ownerDocument.createElement("tr");
      for (const cellText of splitTableRow(line)) {
        const th = root.ownerDocument.createElement("th");
        appendInline(th, cellText);
        trHead.appendChild(th);
      }
      thead.appendChild(trHead);
      table.appendChild(thead);
      i += 2;
      const tbody = root.ownerDocument.createElement("tbody");
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        const tr = root.ownerDocument.createElement("tr");
        for (const cellText of splitTableRow(lines[i])) {
          const td = root.ownerDocument.createElement("td");
          appendInline(td, cellText);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
        i++;
      }
      table.appendChild(tbody);
      root.appendChild(table);
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      const quote = root.ownerDocument.createElement("blockquote");
      appendMarkdownBlocks(quote, quoteLines.join("\n"));
      root.appendChild(quote);
      continue;
    }

    const ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
    if (ordered || unordered) {
      const isOrdered = Boolean(ordered);
      const list = root.ownerDocument.createElement(isOrdered ? "ol" : "ul");
      if (isOrdered && ordered?.[1] !== "1") list.setAttribute("start", ordered![1]);
      while (i < lines.length) {
        const match = isOrdered ? lines[i].match(/^\s*(\d+)[.)]\s+(.+)$/) : lines[i].match(/^\s*[-+*]\s+(.+)$/);
        if (!match) break;
        const li = root.ownerDocument.createElement("li");
        appendInline(li, match[2]);
        list.appendChild(li);
        i++;
      }
      root.appendChild(list);
      continue;
    }

    const paragraphLines = [line];
    i++;
    while (i < lines.length && lines[i].trim()) {
      if (/^\s{0,3}(`{3,}|~{3,})\s*/.test(lines[i]) || /^\s{0,3}#{1,6}\s+/.test(lines[i]) || /^\s*>/.test(lines[i]) || /^\s*[-+*]\s+/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i])) break;
      paragraphLines.push(lines[i]);
      i++;
    }
    paragraph(paragraphLines.join("\n"));
  }
}

function markdownToBlocks(markdown: string): ContentBlock[] {
  const doc = document.implementation.createHTMLDocument("api-markdown");
  const root = doc.createElement("div");
  appendMarkdownBlocks(root, markdown);
  return parseBlocks(root, chatGPTParserContext);
}

function extractRenderableBlocks(message: ChatGPTApiNode["message"]): ContentBlock[] {
  if (!message?.content) return [];
  const type = message.content.content_type ?? "";
  const parts = Array.isArray(message.content.parts) ? message.content.parts : [];
  const text = textFromParts(parts);
  if (!text && type !== "code") return [];

  if (type === "code" || type === "execution_output") {
    return text ? [codeBlock(text, message.content.language)] : [];
  }
  if (type === "thoughts" || type === "reasoning_recap" || type === "tether_browsing_display" || type === "tether_quote") {
    return [];
  }
  return markdownToBlocks(text);
}

function activePath(mapping: Record<string, ChatGPTApiNode>, currentNode?: string): ChatGPTApiNode[] {
  let nodeId = currentNode && mapping[currentNode] ? currentNode : undefined;

  if (!nodeId) {
    const leaves = Object.entries(mapping).filter(([, node]) => Array.isArray(node.children) && node.children.length === 0 && node.message?.author?.role && node.message.author.role !== "system");
    leaves.sort(([, a], [, b]) => (b.message?.create_time ?? 0) - (a.message?.create_time ?? 0));
    nodeId = leaves.at(0)?.[0];
  }

  const path: ChatGPTApiNode[] = [];
  const seen = new Set<string>();
  while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
    seen.add(nodeId);
    const node = mapping[nodeId];
    path.push(node);
    nodeId = node.parent ?? undefined;
  }
  path.reverse();
  return path;
}

function normalizeApiMessages(nodes: ChatGPTApiNode[]): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  for (const node of nodes) {
    const message = node.message;
    const role = message?.author?.role;
    if (role !== "user" && role !== "assistant") continue;
    if (message?.metadata?.is_visually_hidden_from_conversation === true) continue;
    const blocks = extractRenderableBlocks(message);
    if (!blocks.length) continue;
    const plainText = blocksToPlainText(blocks);
    if (!plainText.trim() && !blocks.some((block) => block.type === "image" || block.type === "math" || block.type === "code")) continue;

    const id = message?.id || node.id || `api-${messages.length}`;
    const previous = messages.at(-1);
    if (previous?.role === "assistant" && role === "assistant") {
      previous.blocks = [...previous.blocks, ...blocks];
      previous.plainText = blocksToPlainText(previous.blocks);
      continue;
    }

    messages.push({
      id,
      role,
      order: messages.length,
      sourceOrder: messages.length,
      identityQuality: "strong",
      plainText,
      blocks
    });
  }
  return messages;
}

export function normalizeChatGPTApiConversation(raw: unknown, location: Location): ConversationData | null {
  if (!raw || typeof raw !== "object") return null;
  const conversation = raw as ChatGPTApiConversation;
  if (!conversation.mapping || typeof conversation.mapping !== "object" || Array.isArray(conversation.mapping)) return null;

  const messages = normalizeApiMessages(activePath(conversation.mapping, conversation.current_node));
  if (!messages.length) return null;

  return {
    provider: "chatgpt",
    title: typeof conversation.title === "string" && conversation.title.trim() ? conversation.title.trim() : "ChatGPT Conversation",
    url: location.href,
    capturedUrl: location.href,
    capturedAt: new Date().toISOString(),
    conversationId: typeof conversation.id === "string" ? conversation.id : undefined,
    messageCount: messages.length,
    possiblyPartial: false,
    completeness: {
      state: "complete",
      collectedMessages: messages.length,
      reachedBeginning: true,
      verifiedBeginning: true,
      verifiedEnd: true,
      continuityVerified: true,
      beginningEvidence: "turn-ordinal",
      uniqueParsedMessages: messages.length,
      unresolvedGaps: 0
    },
    messages,
    stats: buildConversationStats(messages)
  };
}

export type ChatGPTPageApiResult =
  | { ok: true; conversation: unknown }
  | { ok: false; error: string };

function getConversationIdFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  const marker = parts.lastIndexOf("c");
  return marker >= 0 ? parts[marker + 1] ?? null : null;
}

export async function extractChatGPTConversationViaPage(tabId: number): Promise<ChatGPTPageApiResult> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async (): Promise<ChatGPTPageApiResult> => {
        const conversationId = (() => {
          const parts = location.pathname.split("/").filter(Boolean);
          const marker = parts.lastIndexOf("c");
          return marker >= 0 ? parts[marker + 1] ?? null : null;
        })();
        if (!conversationId) return { ok: false, error: "NO_CONVERSATION_ID" };

        try {
          const sessionResponse = await fetch("/api/auth/session", { credentials: "include", cache: "no-store", headers: { Accept: "application/json" } });
          if (!sessionResponse.ok) return { ok: false, error: `SESSION_${sessionResponse.status}` };
          const session = await sessionResponse.json();
          const accessToken = typeof session?.accessToken === "string" ? session.accessToken : "";
          if (!accessToken) return { ok: false, error: "NO_ACCESS_TOKEN" };

          const accountId = session?.account?.id ?? session?.accountId ?? session?.user?.account_id ?? session?.user?.accountId;
          const endpoint = `/backend-api/conversation/${encodeURIComponent(conversationId)}`;
          const headers: Record<string, string> = {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
            "X-OpenAI-Target-Path": endpoint,
            "X-OpenAI-Target-Route": "/backend-api/conversation/{conversation_id}"
          };
          if (typeof accountId === "string" && accountId) headers["ChatGPT-Account-ID"] = accountId;

          const response = await fetch(endpoint, { method: "GET", credentials: "include", cache: "no-store", headers });
          if (!response.ok) return { ok: false, error: `CONVERSATION_${response.status}` };
          return { ok: true, conversation: await response.json() };
        } catch {
          return { ok: false, error: "NETWORK_ERROR" };
        }
      }
    });
    const result = results[0]?.result;
    if (result && typeof result === "object" && "ok" in result) return result as ChatGPTPageApiResult;
    return { ok: false, error: "EMPTY_SCRIPT_RESULT" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "SCRIPT_EXECUTION_FAILED" };
  }
}
