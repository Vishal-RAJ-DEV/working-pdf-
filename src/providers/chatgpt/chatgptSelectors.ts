export const CHATGPT_SELECTORS = {
  // Current ChatGPT turn/message markers. Keep class names out of the discovery layer
  // because the app frequently regenerates hashed CSS classes.
  roleNodes: [
    '[data-message-author-role="user"]',
    '[data-message-author-role="assistant"]',
    '[data-role="user"]',
    '[data-role="assistant"]',
    '[data-message-author="user"]',
    '[data-message-author="assistant"]'
  ].join(','),
  turnShells: [
    '[data-testid^="conversation-turn-"]',
    '[data-testid^="conversation-turn"]',
    '[data-turn-id]',
    '[data-message-uuid]',
    'article[data-turn]',
    'section[data-turn]',
    'article[data-message-author-role]',
    'section[data-message-author-role]'
  ].join(','),
  fallbackRoleNodes: '[data-turn="user"], [data-turn="assistant"]',
  userContent: [
    '[data-testid="collapsible-user-message-content"]',
    '[data-testid="collapsible-user-message-root"]',
    '.whitespace-pre-wrap'
  ].join(','),
  assistantContent: [
    '.markdown',
    '[class*="markdown"]',
    '.prose'
  ].join(','),
  streaming: [
    '[data-testid="stop-button"]',
    'button[aria-label*="Stop generating" i]',
    'button[aria-label*="Stop streaming" i]'
  ].join(','),
  ignored: [
    'button', '[role="button"]', '[role="menu"]', '[role="menuitem"]',
    '[data-testid*="copy"]', '[data-testid*="feedback"]', '[data-testid*="regenerate"]',
    '[data-testid*="share"]', '[data-testid*="read-aloud"]',
    '[aria-label*="Copy" i]', '[aria-label*="copied" i]', '[aria-label*="Read aloud" i]',
    '[aria-label*="Good response" i]', '[aria-label*="Bad response" i]', '[aria-label*="Regenerate" i]',
    'script', 'style', 'noscript', 'iframe', 'template'
  ].join(',')
} as const;
