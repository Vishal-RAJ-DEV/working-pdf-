import type { MessageIdentityQuality } from "../../types/conversation";
import { CHATGPT_SELECTORS } from "./chatgptSelectors";

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function shouldIgnoreChatGPTElement(element: Element): boolean {
  if (element.matches(CHATGPT_SELECTORS.ignored)) return true;
  if (element.getAttribute("hidden") !== null) return true;
  if (element.getAttribute("aria-hidden") === "true" && !element.matches('.katex, .katex *, math, math *')) return true;
  const testId = element.getAttribute("data-testid")?.toLowerCase() ?? "";
  if (["copy", "feedback", "regenerate", "share", "read-aloud"].some((token) => testId.includes(token))) return true;
  return false;
}

export function normalizeRole(value: string | null): "user" | "assistant" | null {
  return value === "user" || value === "assistant" ? value : null;
}

/**
 * Resolve a role from the element itself. ChatGPT has used several data-* names
 * for the same semantic information over time.
 */
export function getRole(element: Element): "user" | "assistant" | null {
  const semanticRole =
    normalizeRole(element.getAttribute("data-message-author-role")) ??
    normalizeRole(element.getAttribute("data-turn")) ??
    normalizeRole(element.getAttribute("data-role")) ??
    normalizeRole(element.getAttribute("data-message-author")) ??
    normalizeRole(element.getAttribute("data-message-role"));
  if (semanticRole) return semanticRole;

  // Current ChatGPT variants have also used structural classes/markers.
  if (element.matches(".agent-turn") || element.querySelector(".agent-turn")) return "assistant";
  if (element.matches(".user-turn") || element.matches('[data-testid="user-message"]') || element.querySelector(".user-turn")) return "user";

  // .text-message is shared by user and assistant. Resolve it only from
  // distinctive content/metadata so we never classify arbitrary UI text.
  if (element.matches(".text-message")) {
    if (element.getAttribute("data-message-model-slug")) return "assistant";
    if (element.querySelector(".user-message-bubble-color, [class*='user-message-bubble']")) return "user";
    if (element.querySelector(".markdown, .prose")) return "assistant";
    if (element.querySelector(".whitespace-pre-wrap")) return "user";
  }

  return null;
}

/**
 * Resolve a role carried by a descendant of a turn wrapper.
 */
function getDescendantRole(element: Element): Element | null {
  return element.querySelector(
    '[data-message-author-role="user"], [data-message-author-role="assistant"], [data-role="user"], [data-role="assistant"], [data-message-author="user"], [data-message-author="assistant"], [data-message-role="user"], [data-message-role="assistant"], .agent-turn, .user-turn, [data-testid="user-message"], .text-message'
  );
}

export function getTurnRole(element: Element): "user" | "assistant" | null {
  return getRole(element) ?? (getDescendantRole(element) ? getRole(getDescendantRole(element)!) : null);
}

export interface MessageIdentity {
  id: string;
  quality: MessageIdentityQuality;
  ordinal?: number;
}

function parseTurnOrdinal(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const patterns = [
    /conversation-turn[-_:]?(\d+)/i,
    /turn[-_:]?(\d+)/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const parsed = Number(match[1]);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }

  return undefined;
}

export function findTurnShell(node: Element): Element {
  return (
    node.closest(
      '[data-testid^="conversation-turn-"], [data-testid^="conversation-turn"], [data-turn-id], [data-turn-id-container], [data-message-id], [data-message-uuid], [data-testid="user-message"], [data-message-role="user"], [data-message-role="assistant"], section[data-turn-id], article[data-turn-id], li[data-message-role], .agent-turn, .user-turn, .text-message, article[data-turn], section[data-turn], article[id], section[id]'
    ) ?? node
  );
}

export function getMessageIdentity(node: Element, role: "user" | "assistant", fallbackOrder: number): MessageIdentity {
  const shell = findTurnShell(node);
  const testId = node.getAttribute("data-testid") ?? shell.getAttribute("data-testid");
  const ordinal = parseTurnOrdinal(testId);
  const direct =
    node.getAttribute("data-message-id")
    ?? node.getAttribute("data-message-uuid")
    ?? shell.getAttribute("data-message-id")
    ?? shell.getAttribute("data-message-uuid")
    ?? shell.getAttribute("data-turn-id")
    ?? testId
    ?? shell.id;

  if (direct?.trim()) return { id: direct.trim(), quality: "strong", ordinal };

  const normalized = (node.textContent ?? "").replace(/\s+/g, " ").trim();
  return {
    id: `fallback-${role}-${fnv1a(normalized)}-${fallbackOrder}`,
    quality: "contextual"
  };
}

export function getStableMessageId(node: Element, role: "user" | "assistant", fallbackOrder: number): string {
  return getMessageIdentity(node, role, fallbackOrder).id;
}

export function findMessageContent(roleNode: Element, role: "user" | "assistant"): Element {
  if (role === "user") return roleNode.querySelector(CHATGPT_SELECTORS.userContent) ?? roleNode;
  return roleNode.querySelector(CHATGPT_SELECTORS.assistantContent) ?? roleNode;
}

export function isElementMeaningfullyVisible(element: Element): boolean {
  if (element.getAttribute("hidden") !== null || element.getAttribute("aria-hidden") === "true") return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return true;
}

export function isConversationStreaming(document: Document): boolean {
  return Array.from(document.querySelectorAll(CHATGPT_SELECTORS.streaming)).some(isElementMeaningfullyVisible);
}

export function conversationIdFromLocation(location: Location): string | undefined {
  const match = location.pathname.match(/\/c\/([^/?#]+)/);
  return match?.[1];
}

export function conversationIdentityFromLocation(location: Location): string {
  return conversationIdFromLocation(location) ?? `${location.hostname}${location.pathname}${location.search}`;
}

function isUsefulScrollCandidate(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const scrollableOverflow = /(auto|scroll|overlay)/.test(style.overflowY);
  const hasRange = element.scrollHeight > element.clientHeight + 100;
  const usefulViewport = element.clientHeight >= Math.min(280, Math.max(120, window.innerHeight * 0.25));
  return scrollableOverflow && hasRange && usefulViewport;
}

export function findConversationScrollElement(document: Document): HTMLElement {
  // Do not derive the scroller from a message's ancestor. ChatGPT's layout has
  // changed independently from its turn markup. Prefer the conversation area,
  // then fall back to the largest nested scroll container.
  const scopedSelectors = [
    'main [class*="overflow-y-auto"]',
    'main [class*="overflow-auto"]',
    'main [class*="overflow-y-scroll"]',
    'main [data-radix-scroll-area-viewport]',
    'main [data-scroll-root="true"]',
    '[data-scroll-root="true"]',
    'main'
  ];

  for (const selector of scopedSelectors) {
    const candidates = Array.from(document.querySelectorAll(selector))
      .filter((node): node is HTMLElement => node instanceof HTMLElement);

    for (const candidate of candidates) {
      if (isUsefulScrollCandidate(candidate)) return candidate;
    }
  }

  let best: HTMLElement | null = null;
  let bestRange = 0;
  for (const candidate of Array.from(document.querySelectorAll("*"))) {
    if (!(candidate instanceof HTMLElement)) continue;
    if (!isUsefulScrollCandidate(candidate)) continue;
    const range = candidate.scrollHeight - candidate.clientHeight;
    if (range > bestRange) {
      best = candidate;
      bestRange = range;
    }
  }

  if (best) return best;
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

export function dispatchSyntheticScroll(document: Document, element: HTMLElement): void {
  const EventCtor = document.defaultView?.Event ?? Event;
  element.dispatchEvent(new EventCtor("scroll", { bubbles: true }));
}
