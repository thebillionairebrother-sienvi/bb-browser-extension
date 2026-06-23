// Service Worker Entry Point

chrome.runtime.onInstalled.addListener(() => {
  // Initialize context menus
  chrome.contextMenus.create({
    id: "bb-rewrite-copy",
    title: "Rewrite with BB Strategy",
    contexts: ["selection"]
  });
});

chrome.action.onClicked.addListener((tab) => {
  // Open side panel on action click (supported in Side Panel API)
  chrome.sidePanel.setOptions({ tabId: tab.id, path: 'src/sidepanel/index.html', enabled: true });
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "bb-rewrite-copy") {
    // Send selected text to side panel or content script for rewriting
    console.log("Rewriting selected text:", info.selectionText);
  }
});
