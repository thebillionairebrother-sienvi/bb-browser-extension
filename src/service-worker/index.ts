// Service Worker Entry Point

// Configure side panel to open directly when user clicks the extension toolbar icon
function setupPanelBehavior() {
  if (typeof chrome !== 'undefined' && chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.warn('Failed to set panel behavior:', err);
    });
  }
}

// Configure immediately on script evaluation
setupPanelBehavior();

// And on install/update
chrome.runtime.onInstalled.addListener(() => {
  setupPanelBehavior();
});

// Fallback: in case openPanelOnActionClick is not supported in the runtime
if (typeof chrome !== 'undefined' && chrome.action?.onClicked) {
  chrome.action.onClicked.addListener(async (tab) => {
    try {
      if (tab?.windowId !== undefined && chrome.sidePanel?.open) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
      }
    } catch (err) {
      console.warn('Fallback open side panel:', err);
    }
  });
}

// Broadcast auth state change notifications to active extension views
function notifyAuthChange() {
  chrome.runtime.sendMessage({ type: 'AUTH_CHANGED' }).catch(() => {
    // Expected when no sidepanel view is currently open
  });
}

// Listen for tab navigation completion on Billionaire Brother domains to sync auth after login
if (typeof chrome !== 'undefined' && chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
      const url = tab.url.toLowerCase();
      if (
        url.includes('localhost:3000') ||
        url.includes('billionairebrother') ||
        url.includes('mybillionairebrother')
      ) {
        notifyAuthChange();
      }
    }
  });
}


