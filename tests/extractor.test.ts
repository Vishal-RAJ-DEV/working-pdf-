import { describe, expect, it, beforeEach } from "vitest";
import { extractChatGPTConversation } from "../src/providers/chatgpt/chatgptExtractor";

describe("ChatGPT conversation extraction", () => {
  beforeEach(() => {
    document.title = "Binary Search - ChatGPT";
    document.body.innerHTML = "";
  });

  it("extracts roles in DOM order and excludes UI controls", () => {
    document.body.innerHTML = `
      <section data-testid="conversation-turn-0" data-turn-id="u1"><div data-message-author-role="user"><div data-testid="collapsible-user-message-content">Explain binary search <button>Copy</button></div></div></section>
      <section data-testid="conversation-turn-1" data-turn-id="a1"><div data-message-author-role="assistant"><div class="markdown"><h2>Answer</h2><p>Binary search is fast.</p><button aria-label="Read aloud">Read aloud</button></div></div></section>
    `;
    const data = extractChatGPTConversation(document, window.location);
    expect(data.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(data.messages.map((m) => m.order)).toEqual([0, 1]);
    expect(data.messages[0].id).toBe("u1");
    expect(data.messages[0].plainText).toBe("Explain binary search");
    expect(data.messages[1].plainText).not.toContain("Read aloud");
    expect(data.title).toBe("Binary Search");
  });

  it("extracts messages when the role is stored on the conversation turn wrapper", () => {
    document.body.innerHTML = `
      <article data-testid="conversation-turn-10" data-turn="user" data-turn-id="user-uuid">
        <div data-testid="collapsible-user-message-content">Explain the new ChatGPT layout</div>
      </article>
      <article data-testid="conversation-turn-11" data-turn="assistant" data-turn-id="assistant-uuid">
        <div class="markdown"><p>The turn wrapper owns the role.</p></div>
      </article>
    `;
    const data = extractChatGPTConversation(document, window.location);
    expect(data.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(data.messages.map((message) => message.id)).toEqual(["user-uuid", "assistant-uuid"]);
    expect(data.messages.map((message) => message.plainText)).toEqual([
      "Explain the new ChatGPT layout",
      "The turn wrapper owns the role."
    ]);
  });

  it("supports message UUID as a stable identity fallback", () => {
    document.body.innerHTML = `
      <article data-testid="conversation-turn-20" data-message-uuid="uuid-20" data-turn="user">
        <div data-testid="collapsible-user-message-content">Same text</div>
      </article>
    `;
    const data = extractChatGPTConversation(document, window.location);
    expect(data.messageCount).toBe(1);
    expect(data.messages[0].id).toBe("uuid-20");
  });

  it("deduplicates repeated role nodes by stable turn id", () => {
    document.body.innerHTML = `
      <section data-testid="conversation-turn-0" data-turn-id="same"><div data-message-author-role="user"><p>Hello</p></div><div data-message-author-role="user"><p>Hello duplicate</p></div></section>
    `;
    const data = extractChatGPTConversation(document, window.location);
    expect(data.messageCount).toBe(1);
  });

  it("marks extraction possibly partial when turn shells exceed mounted messages", () => {
    document.body.innerHTML = `
      <section data-testid="conversation-turn-0" data-turn="user"><div data-message-author-role="user"><p>Hello</p></div></section>
      <section data-testid="conversation-turn-1" data-turn="assistant"></section>
      <section data-testid="conversation-turn-2" data-turn="user"></section>
    `;
    const data = extractChatGPTConversation(document, window.location);
    expect(data.possiblyPartial).toBe(true);
  });


  it("keeps repeated identical messages distinct using stable conversation-turn identities", () => {
    document.body.innerHTML = `
      <section data-testid="conversation-turn-0"><div data-message-author-role="user"><p>next</p></div></section>
      <section data-testid="conversation-turn-1"><div data-message-author-role="assistant"><div class="markdown"><p>continue</p></div></div></section>
      <section data-testid="conversation-turn-2"><div data-message-author-role="user"><p>next</p></div></section>
      <section data-testid="conversation-turn-3"><div data-message-author-role="assistant"><div class="markdown"><p>continue</p></div></div></section>
      <section data-testid="conversation-turn-4"><div data-message-author-role="user"><p>next</p></div></section>
    `;
    const data = extractChatGPTConversation(document, window.location);
    expect(data.messageCount).toBe(5);
    expect(data.messages.map((message) => message.id)).toEqual([
      "conversation-turn-0",
      "conversation-turn-1",
      "conversation-turn-2",
      "conversation-turn-3",
      "conversation-turn-4"
    ]);
    expect(data.messages.map((message) => message.sourceOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  it("counts code and math nodes", () => {
    document.body.innerHTML = `
      <section data-testid="conversation-turn-0" data-turn-id="a1"><div data-message-author-role="assistant"><div class="markdown">
        <pre><code class="language-js">const x = 1;</code></pre>
        <p>Then <span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span></span>.</p>
      </div></div></section>`;
    const data = extractChatGPTConversation(document, window.location);
    expect(data.stats.codeBlocks).toBe(1);
    expect(data.stats.mathNodes).toBe(1);
  });
});
