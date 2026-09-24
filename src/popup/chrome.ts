import type { ExtensionRequest, ExtensionResponse } from "../types/messages";

export function isChatGPTUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "chatgpt.com"
      || parsed.hostname.endsWith(".chatgpt.com")
      || parsed.hostname === "chat.openai.com"
      || parsed.hostname.endsWith(".chat.openai.com")
    );
  } catch {
    return false;
  }
}

function sendMessageOnce(tabId: number, request: ExtensionRequest): Promise<{ response?: ExtensionResponse; error?: string }> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, request, (response: ExtensionResponse | undefined) => {
      const error = chrome.runtime.lastError?.message;
      if (error || !response) {
        resolve({ error: error ?? "No response from content script." });
        return;
      }
      resolve({ response });
    });
  });
}

/**
 * Static content scripts are not injected into tabs that were already open
 * when the extension was installed/reloaded. The popup is itself a user action,
 * so activeTab + scripting lets us recover by injecting the bundled content
 * script into the current tab and retrying the request.
 */
export async function sendToTab(tabId: number, request: ExtensionRequest): Promise<ExtensionResponse> {
  const first = await sendMessageOnce(tabId, request);
  if (first.response) return first.response;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["assets/content.js"]
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to inject the content script.";
    return {
      success: false,
      error: "CONTENT_SCRIPT_UNAVAILABLE",
      message: `ChatGPT page script is unavailable: ${message}`
    };
  }

  const second = await sendMessageOnce(tabId, request);
  if (second.response) return second.response;

  return {
    success: false,
    error: "CONTENT_SCRIPT_UNAVAILABLE",
    message: "The ChatGPT page script did not respond. Refresh the ChatGPT tab and try again."
  };
}
