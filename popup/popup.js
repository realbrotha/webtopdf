const fullBtn = document.getElementById("fullBtn");
const regionBtn = document.getElementById("regionBtn");
const elementBtn = document.getElementById("elementBtn");
const statusEl = document.getElementById("status");

const CAPTURE_SCRIPT = "content/capture.js";

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function assertInjectableUrl(url) {
  if (!url) {
    throw new Error("탭 URL을 확인할 수 없습니다.");
  }
  const u = url.toLowerCase();
  if (
    u.startsWith("chrome://") ||
    u.startsWith("edge://") ||
    u.startsWith("devtools://") ||
    u.startsWith("chrome-untrusted://")
  ) {
    throw new Error("이 페이지에서는 사용할 수 없습니다. 일반 웹사이트(https) 탭에서 시도하세요.");
  }
  if (u.startsWith("chrome-extension://")) {
    throw new Error("확장 프로그램 페이지에서는 사용할 수 없습니다.");
  }
  if (
    u.includes("chromewebstore.google.com") ||
    u.includes("chrome.google.com/webstore")
  ) {
    throw new Error("웹스토어 페이지에서는 사용할 수 없습니다.");
  }
}

async function ensureCaptureScript(tabId, allFrames) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames },
      files: [CAPTURE_SCRIPT]
    });
  } catch (_e) {
    const msg = chrome.runtime.lastError?.message || _e?.message || String(_e);
    if (/cannot access|extensions gallery|forbidden/i.test(msg)) {
      throw new Error("이 페이지에서는 스크립트를 실행할 수 없습니다.");
    }
    throw new Error(msg || "스크립트 주입에 실패했습니다.");
  }
}

function setBusy(busy, text = "") {
  fullBtn.disabled = busy;
  regionBtn.disabled = busy;
  elementBtn.disabled = busy;
  statusEl.textContent = text;
}

async function runCapture(mode) {
  setBusy(true, "작업 시작...");
  try {
    const tab = await getActiveTab();
    if (!tab?.id) {
      throw new Error("활성 탭을 찾지 못했습니다.");
    }

    assertInjectableUrl(tab.url);
    await ensureCaptureScript(tab.id, mode !== "full");

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "START_CAPTURE",
      mode
    });

    if (!response?.ok) {
      throw new Error(response?.error || "캡처에 실패했습니다.");
    }

    // 영역/요소: 수신 확인 후 닫아 첫 클릭을 선택 동작에 쓴다.
    if (mode === "region" || mode === "element") {
      window.close();
      return;
    }

    setBusy(false, "완료");
  } catch (error) {
    setBusy(false, error.message || "오류");
  }
}

fullBtn.addEventListener("click", () => runCapture("full"));
regionBtn.addEventListener("click", () => runCapture("region"));
elementBtn.addEventListener("click", () => runCapture("element"));
