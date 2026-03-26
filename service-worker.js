chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  if (message.type === "CAPTURE_VISIBLE_TAB") {
    const windowId = sender.tab?.windowId;
    chrome.tabs.captureVisibleTab(
      windowId,
      { format: "png" },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ ok: true, dataUrl });
      }
    );
    return true;
  }

  if (message.type === "SAVE_PDF") {
    if (!message.dataUrl || !message.fileName) {
      sendResponse({ ok: false, error: "PDF 저장 파라미터 누락" });
      return false;
    }
    chrome.downloads.download(
      {
        url: message.dataUrl,
        filename: message.fileName,
        saveAs: true
      },
      (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          sendResponse({
            ok: false,
            error: chrome.runtime.lastError?.message || "다운로드 시작 실패"
          });
          return;
        }
        sendResponse({ ok: true, downloadId });
      }
    );
    return true;
  }

  if (message.type === "UI_BADGE") {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      return false;
    }
    const raw = String(message.label || "");
    const badgeText = raw.slice(0, 4);
    chrome.action.setBadgeText({ tabId, text: badgeText });
    if (badgeText) {
      chrome.action.setBadgeBackgroundColor({
        tabId,
        color: raw === "!" ? "#c62828" : "#2563eb"
      });
    }
    return false;
  }

  return false;
});
