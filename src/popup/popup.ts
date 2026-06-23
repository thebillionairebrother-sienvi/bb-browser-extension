document.getElementById('openPanel')?.addEventListener('click', async () => {
  try {
    const window = await chrome.windows.getCurrent();
    if (window.id !== undefined) {
      await chrome.sidePanel.open({ windowId: window.id });
    }
  } catch (err) {
    console.error('Failed to open side panel:', err);
  }
  // Close the popup after opening the panel
  window.close();
});
