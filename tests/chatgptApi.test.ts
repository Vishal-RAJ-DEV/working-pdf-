import { describe, expect, it } from "vitest";
import { normalizeChatGPTApiConversation } from "../src/providers/chatgpt/chatgptApi";

describe("ChatGPT API extraction", () => {
  it("follows current_node to the root and ignores inactive branches/system messages", () => {
    const raw = {
      id: "conv-1",
      title: "API Conversation",
      current_node: "a2",
      mapping: {
        root: { id: "root", parent: null, children: ["u1"], message: null },
        u1: {
          id: "u1",
          parent: "root",
          children: ["a1"],
          message: {
            id: "m1",
            author: { role: "user" },
            content: { content_type: "text", parts: ["Explain binary search"] }
          }
        },
        a1: {
          id: "a1",
          parent: "u1",
          children: ["a2", "inactive"],
          message: {
            id: "m2",
            author: { role: "assistant" },
            content: { content_type: "text", parts: ["Binary search is O(log n)."] }
          }
        },
        inactive: {
          id: "inactive",
          parent: "a1",
          children: [],
          message: {
            id: "inactive-message",
            author: { role: "user" },
            content: { content_type: "text", parts: ["Old regenerated branch"] }
          }
        },
        a2: {
          id: "a2",
          parent: "a1",
          children: [],
          message: {
            id: "m3",
            author: { role: "assistant" },
            content: { content_type: "text", parts: ["Use the middle element each step."] }
          }
        },
        system: {
          id: "system",
          parent: "root",
          children: [],
          message: {
            id: "sys",
            author: { role: "system" },
            content: { content_type: "text", parts: ["hidden"] }
          }
        }
      }
    };

    const data = normalizeChatGPTApiConversation(raw, { href: "https://chatgpt.com/c/conv-1" } as Location);
    expect(data?.messageCount).toBe(2);
    expect(data?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(data?.messages[1].plainText).toContain("Binary search is O(log n).");
    expect(data?.messages[1].plainText).toContain("Use the middle element each step.");
  });

  it("preserves fenced code, headings, lists, links, and inline math", () => {
    const raw = {
      id: "conv-2",
      title: "Rich",
      current_node: "a1",
      mapping: {
        root: { id: "root", parent: null, children: ["u1"] },
        u1: {
          id: "u1",
          parent: "root",
          children: ["a1"],
          message: { id: "m1", author: { role: "user" }, content: { content_type: "text", parts: ["Show code"] } }
        },
        a1: {
          id: "a1",
          parent: "u1",
          children: [],
          message: {
            id: "m2",
            author: { role: "assistant" },
            content: {
              content_type: "text",
              parts: [
                "# Answer\n\nHere is \`x = 1\` and $x^2$.\n\n- one\n- two\n\n\`\`\`cpp\nint x = 1;\n\`\`\`"
              ]
            }
          }
        }
      }
    };

    const data = normalizeChatGPTApiConversation(raw, { href: "https://chatgpt.com/c/conv-2" } as Location);
    expect(data?.messages[1].blocks.some((block) => block.type === "heading")).toBe(true);
    expect(data?.messages[1].blocks.some((block) => block.type === "unordered-list")).toBe(true);
    const inlineMath = data?.messages[1].blocks.some((block) =>
      (block.type === "paragraph" || block.type === "heading") && block.children.some((child) => child.type === "math")
    );
    expect(inlineMath).toBe(true);
    expect(data?.messages[1].blocks.some((block) => block.type === "code" && block.language === "cpp")).toBe(true);
  });
});
