(() => {
  if (window.__scrollCaptureInjected) return;
  window.__scrollCaptureInjected = true;

  let isRunning = false;
  let toastEl = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const TOAST_MARK = "data-wtpdf-toast";
  const PRINT_STYLE_ID = "wtpdf-print-style";
  const PATH_ATTR = "data-wtpdf-path";
  const TARGET_ATTR = "data-wtpdf-target";
  const PX_PER_INCH = 96;

  function sanitizeFileName(name) {
    return (
      (name || "untitled")
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100) || "untitled"
    );
  }

  function isExtensionUiRoot() {
    try {
      return window.top === window && window.frameElement == null;
    } catch (_) {
      return false;
    }
  }

  function notifyToolbarBadge(label) {
    try {
      chrome.runtime.sendMessage({ type: "UI_BADGE", label: label || "" });
    } catch (_) {}
  }

  /* ── Toast ── */

  function purgeExtensionToasts() {
    if (!isExtensionUiRoot()) return;
    try {
      document
        .querySelectorAll(`[${TOAST_MARK}]`)
        .forEach((el) => el.remove());
    } catch (_) {}
    toastEl = null;
    notifyToolbarBadge("");
  }

  function showToast(text, isError = false) {
    if (!isExtensionUiRoot()) return;
    if (!toastEl || !toastEl.isConnected) {
      purgeExtensionToasts();
      toastEl = document.createElement("div");
      toastEl.setAttribute(TOAST_MARK, "1");
      Object.assign(toastEl.style, {
        position: "fixed",
        left: "12px",
        bottom: "12px",
        zIndex: "2147483647",
        padding: "8px 12px",
        borderRadius: "8px",
        fontSize: "12px",
        fontFamily:
          '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        color: "#fff",
        maxWidth: "min(360px, calc(100vw - 24px))",
        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
        pointerEvents: "none"
      });
      (document.body || document.documentElement).appendChild(toastEl);
    }
    toastEl.style.background = isError
      ? "rgba(195,40,40,0.92)"
      : "rgba(0,0,0,0.78)";
    toastEl.textContent = text;
    if (
      isError ||
      (text && (text.includes("실패") || text.includes("오류")))
    ) {
      notifyToolbarBadge("!");
    } else if (text && !text.includes("완료")) {
      notifyToolbarBadge("···");
    } else {
      notifyToolbarBadge("");
    }
  }

  function hideToast() {
    purgeExtensionToasts();
  }

  /* ── Metrics ── */

  function getDocMetrics() {
    const root = document.documentElement;
    const body = document.body;
    return {
      docWidth: Math.max(
        root.scrollWidth,
        body ? body.scrollWidth : 0,
        root.clientWidth
      ),
      docHeight: Math.max(
        root.scrollHeight,
        body ? body.scrollHeight : 0,
        root.clientHeight
      ),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  }


  /* ── Selection UI ── */

  async function selectRegion() {
    if (!isExtensionUiRoot()) return null;
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "2147483647",
        cursor: "crosshair",
        background: "rgba(0,0,0,0.2)"
      });

      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "absolute",
        border: "2px solid #2d74ff",
        background: "rgba(45,116,255,0.16)"
      });
      overlay.appendChild(box);

      const tip = document.createElement("div");
      tip.textContent = "드래그해서 영역 선택 (ESC 취소)";
      Object.assign(tip.style, {
        position: "fixed",
        top: "12px",
        left: "12px",
        zIndex: "2147483647",
        padding: "8px 10px",
        borderRadius: "8px",
        background: "rgba(0,0,0,0.72)",
        color: "#fff",
        fontSize: "12px",
        pointerEvents: "none",
        maxWidth: "min(320px, calc(100vw - 24px))"
      });
      overlay.appendChild(tip);

      let startX = 0;
      let startY = 0;
      let dragging = false;

      const cleanup = () => {
        window.removeEventListener("keydown", onKeydown, true);
        overlay.remove();
      };

      const onKeydown = (e) => {
        if (e.key === "Escape") {
          cleanup();
          resolve(null);
        }
      };

      overlay.addEventListener("mousedown", (e) => {
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        box.style.left = `${startX}px`;
        box.style.top = `${startY}px`;
        box.style.width = "0px";
        box.style.height = "0px";
      });

      overlay.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const x = Math.min(startX, e.clientX);
        const y = Math.min(startY, e.clientY);
        box.style.left = `${x}px`;
        box.style.top = `${y}px`;
        box.style.width = `${Math.abs(e.clientX - startX)}px`;
        box.style.height = `${Math.abs(e.clientY - startY)}px`;
      });

      overlay.addEventListener("mouseup", (e) => {
        if (!dragging) return;
        dragging = false;
        const x = Math.min(startX, e.clientX);
        const y = Math.min(startY, e.clientY);
        const w = Math.abs(e.clientX - startX);
        const h = Math.abs(e.clientY - startY);
        cleanup();
        if (w < 8 || h < 8) {
          resolve(null);
          return;
        }
        resolve({ vx: x, vy: y, width: w, height: h });
      });

      window.addEventListener("keydown", onKeydown, true);
      document.documentElement.appendChild(overlay);
    });
  }

  async function selectElement() {
    if (!isExtensionUiRoot()) return null;
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "2147483647",
        cursor: "pointer",
        background: "rgba(0,0,0,0.1)"
      });

      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "fixed",
        border: "2px solid #ff9f1a",
        background: "rgba(255,159,26,0.14)",
        pointerEvents: "none",
        display: "none"
      });
      overlay.appendChild(box);

      const tip = document.createElement("div");
      tip.textContent = "요소 위에 마우스 올린 뒤 클릭 (ESC 취소)";
      Object.assign(tip.style, {
        position: "fixed",
        top: "12px",
        left: "12px",
        zIndex: "2147483647",
        padding: "8px 10px",
        borderRadius: "8px",
        background: "rgba(0,0,0,0.72)",
        color: "#fff",
        fontSize: "12px",
        pointerEvents: "none",
        maxWidth: "min(320px, calc(100vw - 24px))"
      });
      overlay.appendChild(tip);

      let currentElement = null;

      const cleanup = () => {
        window.removeEventListener("keydown", onKeydown, true);
        overlay.removeEventListener("mousemove", onMouseMove, true);
        overlay.removeEventListener("click", onClick, true);
        overlay.remove();
      };

      const onKeydown = (e) => {
        if (e.key === "Escape") {
          cleanup();
          resolve(null);
        }
      };

      const onMouseMove = (e) => {
        overlay.style.pointerEvents = "none";
        const target = document.elementFromPoint(e.clientX, e.clientY);
        overlay.style.pointerEvents = "auto";

        if (
          !target ||
          target === document.documentElement ||
          target === document.body
        ) {
          box.style.display = "none";
          currentElement = null;
          return;
        }

        const rect = target.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) {
          box.style.display = "none";
          currentElement = null;
          return;
        }

        currentElement = target;
        box.style.display = "block";
        box.style.left = `${rect.left}px`;
        box.style.top = `${rect.top}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
      };

      const onClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const picked = currentElement;
        cleanup();
        resolve(picked || null);
      };

      overlay.addEventListener("mousemove", onMouseMove, true);
      overlay.addEventListener("click", onClick, true);
      window.addEventListener("keydown", onKeydown, true);
      document.documentElement.appendChild(overlay);
    });
  }

  /* ── Print CSS injection / element marking ── */

  function injectPrintStyle(cssText) {
    removePrintStyle();
    const style = document.createElement("style");
    style.id = PRINT_STYLE_ID;
    style.textContent = cssText;
    (document.head || document.documentElement).appendChild(style);
  }

  function removePrintStyle() {
    document.getElementById(PRINT_STYLE_ID)?.remove();
  }

  function markElementPath(el) {
    el.setAttribute(TARGET_ATTR, "1");
    let parent = el.parentElement;
    while (parent && parent !== document.documentElement) {
      parent.setAttribute(PATH_ATTR, "1");
      parent = parent.parentElement;
    }
  }

  function cleanupElementMarkers() {
    document
      .querySelectorAll(`[${PATH_ATTR}]`)
      .forEach((n) => n.removeAttribute(PATH_ATTR));
    document
      .querySelectorAll(`[${TARGET_ATTR}]`)
      .forEach((n) => n.removeAttribute(TARGET_ATTR));
  }



  /* ── Screenshot-based region capture helpers ── */

  async function captureVisibleTab() {
    const response = await chrome.runtime.sendMessage({
      type: "CAPTURE_VISIBLE_TAB"
    });
    if (!response?.ok || !response.dataUrl) {
      throw new Error(response?.error || "뷰포트 캡처 실패");
    }
    return response.dataUrl;
  }

  function dataUrlToImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("이미지 로드 실패"));
      img.src = dataUrl;
    });
  }

  function cropToCanvas(img, vx, vy, vw, vh, vpW, vpH) {
    const sx = Math.round(vx * (img.width / vpW));
    const sy = Math.round(vy * (img.height / vpH));
    const sw = Math.round(vw * (img.width / vpW));
    const sh = Math.round(vh * (img.height / vpH));
    const c = document.createElement("canvas");
    c.width = Math.max(1, sw);
    c.height = Math.max(1, sh);
    const ctx = c.getContext("2d", { alpha: false });
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return c;
  }

  function concatUint8(parts) {
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }
  const ascii = (s) => new TextEncoder().encode(s);

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function buildSingleImagePdf(jpegBytes, imgW, imgH) {
    const ptPerPx = 72 / 96;
    const pageW = Math.max(1, Math.round(imgW * ptPerPx));
    const pageH = Math.max(1, Math.round(imgH * ptPerPx));
    const content = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
    const objects = [
      ascii("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
      ascii("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"),
      ascii(
        `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
      ),
      concatUint8([
        ascii(
          `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
        ),
        jpegBytes,
        ascii("\nendstream\nendobj\n")
      ]),
      ascii(
        `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`
      )
    ];
    const header = ascii("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");
    const bodyParts = [header];
    const offsets = [0];
    let cursor = header.length;
    for (const obj of objects) {
      offsets.push(cursor);
      bodyParts.push(obj);
      cursor += obj.length;
    }
    const xrefStart = cursor;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    const trailer =
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
      `startxref\n${xrefStart}\n%%EOF`;
    return concatUint8([...bodyParts, ascii(xref), ascii(trailer)]);
  }

  async function downloadCanvasAsPdf(canvas, fileNameBase) {
    const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.95);
    const b64 = jpegDataUrl.split(",")[1];
    if (!b64) throw new Error("PDF 이미지 인코딩 실패");
    const jpegBytes = base64ToBytes(b64);
    const pdfBytes = buildSingleImagePdf(jpegBytes, canvas.width, canvas.height);
    let binary = "";
    for (let i = 0; i < pdfBytes.length; i++) {
      binary += String.fromCharCode(pdfBytes[i]);
    }
    const pdfBase64 = btoa(binary);
    const response = await chrome.runtime.sendMessage({
      type: "SAVE_PDF",
      fileName: `${sanitizeFileName(fileNameBase)}.pdf`,
      dataUrl: `data:application/pdf;base64,${pdfBase64}`
    });
    if (!response?.ok) throw new Error(response?.error || "PDF 저장 실패");
  }

  /* ── Main ── */

  async function run(mode) {
    if (isRunning) throw new Error("이미 캡처가 진행 중입니다.");
    isRunning = true;

    try {
      purgeExtensionToasts();
      const metrics = getDocMetrics();
      const vpWInch = metrics.viewportWidth / PX_PER_INCH;
      const vpHInch = metrics.viewportHeight / PX_PER_INCH;

      let paperWidth = vpWInch;
      let paperHeight = vpHInch;
      let preferCSSPageSize = false;

      const toastHide = `[${TOAST_MARK}] { display: none !important; }`;

      if (mode === "full") {
        injectPrintStyle(`@media print {
          ${toastHide}
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            min-height: 0 !important;
            height: auto !important;
            max-height: none !important;
          }
        }`);
      } else if (mode === "region") {
        const vp = await selectRegion();
        if (!vp) throw new Error("영역 선택이 취소되었습니다.");

        showToast("영역 캡처 중…");
        notifyToolbarBadge("···");

        const dataUrl = await captureVisibleTab();
        const img = await dataUrlToImage(dataUrl);
        const cropped = cropToCanvas(
          img,
          vp.vx, vp.vy, vp.width, vp.height,
          metrics.viewportWidth, metrics.viewportHeight
        );

        showToast("PDF 저장 중…");
        await downloadCanvasAsPdf(cropped, document.title || "untitled");

        showToast("저장 완료");
        await sleep(1200);
        hideToast();
        return { ok: true };
      } else if (mode === "element") {
        const picked = await selectElement();
        if (!picked) throw new Error("요소 선택이 취소되었습니다.");

        markElementPath(picked);

        const elR = picked.getBoundingClientRect();
        const elW = elR.width;
        const hPx = Math.ceil(
          Math.max(
            elR.height,
            picked.scrollHeight || 0,
            picked.offsetHeight || 0
          )
        );
        const wMm = (elW / PX_PER_INCH) * 25.4;
        const hMm = (hPx / PX_PER_INCH) * 25.4;

        paperWidth = elW / PX_PER_INCH;
        paperHeight = hPx / PX_PER_INCH;
        preferCSSPageSize = true;

        injectPrintStyle(
          `@media print {
            @page { size: ${wMm.toFixed(3)}mm ${hMm.toFixed(3)}mm; margin: 0; }
            ${toastHide}
            html, body, [${PATH_ATTR}] {
              margin: 0 !important;
              padding: 0 !important;
              border: none !important;
              max-width: none !important;
              max-height: none !important;
              min-height: 0 !important;
              height: auto !important;
              float: none !important;
              display: block !important;
            }
            [${TARGET_ATTR}] {
              margin: 0 !important;
              width: ${elW}px !important;
              min-height: 0 !important;
              height: auto !important;
              max-height: none !important;
              overflow: visible !important;
              box-sizing: border-box !important;
            }
            [${PATH_ATTR}] > *:not([${PATH_ATTR}]):not([${TARGET_ATTR}]) {
              display: none !important;
            }
          }`
        );
      } else {
        injectPrintStyle(`@media print { ${toastHide} }`);
      }

      showToast("PDF 생성 중…");
      notifyToolbarBadge("···");

      const response = await chrome.runtime.sendMessage({
        type: "NATIVE_PDF",
        fileName: sanitizeFileName(document.title) + ".pdf",
        paperWidth,
        paperHeight,
        preferCSSPageSize
      });

      notifyToolbarBadge("");

      if (!response?.ok) {
        throw new Error(response?.error || "PDF 생성 실패");
      }

      showToast("저장 완료");
      await sleep(1200);
      hideToast();
      return { ok: true };
    } catch (error) {
      showToast(`저장 실패: ${error?.message || "알 수 없는 오류"}`, true);
      await sleep(2200);
      hideToast();
      throw error;
    } finally {
      removePrintStyle();
      cleanupElementMarkers();
      isRunning = false;
    }
  }

  /* ── Message listener ── */

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "START_CAPTURE") return false;
    if (!isExtensionUiRoot()) return false;

    const { mode } = message;

    if (mode === "region" || mode === "element") {
      sendResponse({ ok: true });
      void run(mode).catch(() => {});
      return false;
    }

    run(mode)
      .then((result) => sendResponse(result))
      .catch((err) =>
        sendResponse({ ok: false, error: err?.message || "알 수 없는 오류" })
      );
    return true;
  });
})();
