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
      { url: message.dataUrl, filename: message.fileName, saveAs: true },
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

  if (message.type === "NATIVE_PDF") {
    handleNativePdf(message, sender)
      .then((result) => sendResponse(result))
      .catch((err) =>
        sendResponse({ ok: false, error: err?.message || "PDF 생성 실패" })
      );
    return true;
  }

  if (message.type === "UI_BADGE") {
    const tabId = sender.tab?.id;
    if (tabId == null) return false;
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

async function handleNativePdf(message, sender) {
  const tabId = sender.tab?.id;
  if (!tabId) throw new Error("탭 ID를 확인할 수 없습니다.");

  const target = { tabId };
  const fileName = message.fileName || "untitled.pdf";

  try {
    await chrome.debugger.attach(target, "1.3");
  } catch (err) {
    throw new Error(
      "디버거 연결 실패 — DevTools가 열려 있거나 다른 디버거가 연결된 경우 닫고 재시도하세요."
    );
  }

  try {
    const result = await chrome.debugger.sendCommand(
      target,
      "Page.printToPDF",
      {
        printBackground: true,
        displayHeaderFooter: false,
        paperWidth: message.paperWidth || 8.27,
        paperHeight: message.paperHeight || 11.69,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
        scale: 1,
        preferCSSPageSize: Boolean(message.preferCSSPageSize)
      }
    );

    const dataUrl = `data:application/pdf;base64,${result.data}`;

    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download(
        { url: dataUrl, filename: fileName, saveAs: true },
        (id) => {
          if (chrome.runtime.lastError || !id) {
            reject(
              new Error(
                chrome.runtime.lastError?.message || "다운로드 시작 실패"
              )
            );
          } else {
            resolve(id);
          }
        }
      );
    });

    return { ok: true, downloadId };
  } finally {
    try {
      await chrome.debugger.detach(target);
    } catch (_) {}
  }
}
