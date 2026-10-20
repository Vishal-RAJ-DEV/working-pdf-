import { describe, expect, it } from "vitest";
import { normalizeChatGPTApiConversation } from "../src/providers/chatgpt/chatgptApi";
import { blocksToPlainText } from "../src/parser/blockParser";

describe("ChatGPT API extraction", () => {
  it("removes rich UI component tags while preserving their readable text", () => {
    const raw = {
      id: "conv-rich-ui",
      title: "Rich UI",
      current_node: "a1",
      mapping: {
        root: { id: "root", parent: null, children: ["u1"] },
        u1: { id: "u1", parent: "root", children: ["a1"], message: { id: "m1", author: { role: "user" }, content: { content_type: "text", parts: ["Show the array"] } } },
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
                "Let's follow this process.\n<box border radius=\"lg\" padding={3} gap={3}>\n<text color=\"secondary\" size=\"sm\">Array: [1, 3, 4, 2, 2]</text>\n<box background=\"#DCEAFE\">Index 0\n<title size=\"xl\">1</title>\n</box>\n<icon name=\"arrow-down\" size=\"xl\"/>\n<text color=\"secondary\">nums[0] = 1</text>\n</box>"
              ]
            }
          }
        }
      }
    };

    const data = normalizeChatGPTApiConversation(raw, { href: "https://chatgpt.com/c/conv-rich-ui" });
    const text = data?.messages[1].plainText ?? "";
    expect(text).toContain("Array: [1, 3, 4, 2, 2]");
    expect(text).toContain("Index 0");
    expect(text).toContain("nums[0] = 1");
    expect(text).not.toContain("<box");
    expect(text).not.toContain("<text");
    expect(text).not.toContain("<icon");
  });


  it("parses single-line and multiline bracket display math as math blocks", () => {
    const raw = {
      id: "conv-display-math",
      title: "Display math",
      current_node: "a1",
      mapping: {
        root: { id: "root", parent: null, children: ["u1"] },
        u1: { id: "u1", parent: "root", children: ["a1"], message: { id: "m1", author: { role: "user" }, content: { content_type: "text", parts: ["Explain this equation"] } },
        a1: {
          id: "a1",
          parent: "u1",
          children: [],
          message: {
            id: "m2",
            author: { role: "assistant" },
            content: {
              content_type: "text",
              parts: ["The first equation:", "\\\\[", "2d_s = d_f", "\\\\]", "Then:", "\\\\[ d_s \\\\equiv 0 \\\\pmod{\\\\lambda} \\\\]"]
            }
          }
        }
      }
    };

    const data = normalizeChatGPTApiConversation(raw, { href: "https://chatgpt.com/c/conv-display-math" });
    const mathBlocks = data?.messages[1].blocks.filter((block) => block.type === "math") ?? [];
    expect(mathBlocks).toHaveLength(2);
    expect(mathBlocks[0]).toMatchObject({ type: "math", displayMode: "block", source: "2d_s = d_f" });
    expect(mathBlocks[1]).toMatchObject({ type: "math", displayMode: "block", source: "d_s \\equiv 0 \\pmod{\\lambda}" });
    expect(data?.messages[1].plainText).not.toContain("\\[");
  });

  it("removes internal file citation markers from exported text", () => {
    const raw = {
      id: "conv-file",
      title: "File",
      current_node: "a1",
      mapping: {
        root: { id: "root", parent: null, children: ["u1"] },
        u1: {
          id: "u1",
          parent: "root",
          children: ["a1"],
          message: { id: "m1", author: { role: "user" }, content: { content_type: "text", parts: ["Explain this"] } }
        },
        a1: {
          id: "a1",
          parent: "u1",
          children: [],
          message: {
            id: "m2",
            author: { role: "assistant" },
            content: { content_type: "text", parts: ["Here is the answer. fileciteturn0file0L25-L43"] }
          }
        }
      }
    };

    const data = normalizeChatGPTApiConversation(raw, { href: "https://chatgpt.com/c/conv-file" });
    expect(data?.messages[1].plainText).toBe("Here is the answer.");
    expect(data?.messages[1].plainText).not.toContain("filecite");
  });


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
    const unorderedList = data?.messages[1].blocks.find((block) => block.type === "unordered-list");
    expect(unorderedList).toBeDefined();
    if (unorderedList?.type === "unordered-list") {
      expect(unorderedList.items.map((item) => blocksToPlainText(item.blocks))).toEqual(["one", "two"]);
    }
    const inlineMath = data?.messages[1].blocks.some((block) =>
      (block.type === "paragraph" || block.type === "heading") && block.children.some((child) => child.type === "math")
    );
    expect(inlineMath).toBe(true);
    expect(data?.messages[1].blocks.some((block) => block.type === "code" && block.language === "cpp")).toBe(true);
  });
});
