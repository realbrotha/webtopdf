(() => {
  if (window.__scrollCaptureInjected) {
    return;
  }
  window.__scrollCaptureInjected = true;

  let isRunning = false;
  /** 마지막 성공한 captureVisibleTab 시각 — 쿼터 초과 방지 */
  let lastCaptureAt = 0;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
  let toastEl = null;

  /** Chrome tabs.captureVisibleTab 분당/연속 호출 제한 완화 (ms) */
  const MIN_CAPTURE_INTERVAL_MS = 600;
  const PAINT_WAIT_MS = 300;

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function sanitizeFileName(name) {
    const cleaned = (name || "untitled")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);
    return cleaned || "untitled";
  }

  const TOAST_MARK = "data-wtpdf-toast";

  /** iframe·중첩 프레임에는 토스트 없음 (광고 배너 영역에 겹쳐 보이는 현상 방지) */
  function isExtensionUiRoot() {
    try {
      if (window.top !== window) {
        return false;
      }
      if (window.frameElement != null) {
        return false;
      }
      return true;
    } catch (_e) {
      return false;
    }
  }

  function notifyToolbarBadge(label) {
    try {
      chrome.runtime.sendMessage({ type: "UI_BADGE", label: label || "" });
    } catch (_e) {
      /* ignore */
    }
  }

  function purgeExtensionToasts() {
    if (!isExtensionUiRoot()) {
      return;
    }
    try {
      document.querySelectorAll(`[${TOAST_MARK}]`).forEach((el) => el.remove());
    } catch (_e) {
      /* ignore */
    }
    toastEl = null;
    notifyToolbarBadge("");
  }

  function showToast(text, isError = false) {
    if (!isExtensionUiRoot()) {
      return;
    }
    if (!toastEl || !toastEl.isConnected) {
      purgeExtensionToasts();
      toastEl = document.createElement("div");
      toastEl.setAttribute(TOAST_MARK, "1");
      toastEl.style.position = "fixed";
      toastEl.style.left = "12px";
      toastEl.style.right = "auto";
      toastEl.style.top = "auto";
      toastEl.style.bottom = "12px";
      toastEl.style.zIndex = "2147483647";
      toastEl.style.padding = "8px 12px";
      toastEl.style.borderRadius = "8px";
      toastEl.style.fontSize = "12px";
      toastEl.style.fontFamily =
        '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
      toastEl.style.color = "#fff";
      toastEl.style.maxWidth = "min(360px, calc(100vw - 24px))";
      toastEl.style.boxShadow = "0 4px 16px rgba(0,0,0,0.25)";
      toastEl.style.pointerEvents = "none";
      (document.body || document.documentElement).appendChild(toastEl);
    }
    toastEl.style.background = isError ? "rgba(195,40,40,0.92)" : "rgba(0,0,0,0.78)";
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

  function getDocMetrics() {
    const root = document.documentElement;
    const body = document.body;
    const docWidth = Math.max(
      root.scrollWidth,
      body ? body.scrollWidth : 0,
      root.clientWidth
    );
    const docHeight = Math.max(
      root.scrollHeight,
      body ? body.scrollHeight : 0,
      root.clientHeight
    );
    return {
      docWidth,
      docHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  }

  /** 뷰포트(탭)와 겹치는 부분만 CSS 픽셀 crop */
  function clampRectToViewport(rect, vw, vh) {
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(vw, rect.right);
    const bottom = Math.min(vh, rect.bottom);
    return {
      x: left,
      y: top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    };
  }

  function intersectClientRects(a, b) {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    if (right <= left || bottom <= top) {
      return null;
    }
    return { left, top, right, bottom };
  }

  /**
   * 스크롤 컬럼만 크롭하면 옆 사이드바가 빠지므로,
   * 가로로 충분히 넓은 직계 조상(행 래퍼)까지 크롭을 확장한다.
   */
  function expandCropRectForRowWrapper(scrollEl) {
    const elRect = scrollEl.getBoundingClientRect();
    let uL = elRect.left;
    let uT = elRect.top;
    let uR = elRect.right;
    let uB = elRect.bottom;
    let p = scrollEl.parentElement;
    for (let d = 0; d < 15 && p && p !== document.body; d += 1) {
      if (!(p instanceof HTMLElement)) {
        p = p.parentElement;
        continue;
      }
      const pr = p.getBoundingClientRect();
      if (pr.width < elRect.width + 48) {
        p = p.parentElement;
        continue;
      }
      const overlapY =
        Math.min(elRect.bottom, pr.bottom) - Math.max(elRect.top, pr.top);
      if (overlapY < Math.min(elRect.height, pr.height) * 0.25) {
        p = p.parentElement;
        continue;
      }
      uL = Math.min(uL, pr.left);
      uT = Math.min(uT, pr.top);
      uR = Math.max(uR, pr.right);
      uB = Math.max(uB, pr.bottom);
      break;
    }
    return { left: uL, top: uT, right: uR, bottom: uB };
  }

  /**
   * overflow가 visible/hidden이어도 scrollTop이 실제로 움직이면 세로 스크롤 컨테이너로 본다.
   * (네이버 등: html/body는 visible인데 문서 스크롤은 documentElement.scrollTop)
   */
  function getEffectiveVerticalScrollRange(node) {
    if (!(node instanceof HTMLElement) || node === toastEl) {
      return 0;
    }
    const range = node.scrollHeight - node.clientHeight;
    if (range < 36) {
      return 0;
    }
    const oy = window.getComputedStyle(node).overflowY;
    if (oy === "auto" || oy === "scroll" || oy === "overlay") {
      return range;
    }
    const s0 = node.scrollTop;
    const delta = Math.min(80, Math.max(1, Math.floor(range / 6)));
    node.scrollTop = s0 + delta;
    const moved = node.scrollTop !== s0;
    node.scrollTop = s0;
    return moved ? range : 0;
  }

  /**
   * 선택 요소 + 그 하위 + 부모 체인(문서 루트까지)에서 세로 스크롤 여유가 가장 큰 노드.
   */
  function findScrollTargetForPickedElement(rootEl) {
    if (!(rootEl instanceof HTMLElement)) {
      return null;
    }
    const MIN_RANGE = 48;
    let best = null;
    let bestRange = 0;

    const tryNode = (node) => {
      const r = getEffectiveVerticalScrollRange(node);
      if (r > bestRange) {
        bestRange = r;
        best = node;
      }
    };

    tryNode(rootEl);
    for (const node of rootEl.querySelectorAll("*")) {
      tryNode(node);
    }
    for (let p = rootEl.parentElement; p; p = p.parentElement) {
      tryNode(p);
    }
    if (document.documentElement && document.documentElement !== rootEl) {
      tryNode(document.documentElement);
    }
    if (document.body && document.body !== rootEl) {
      tryNode(document.body);
    }

    return bestRange >= MIN_RANGE ? best : null;
  }


  async function waitForPaint() {
    await raf();
    await raf();
    await sleep(PAINT_WAIT_MS);
  }

  async function waitForCaptureSync() {
    await raf();
    await raf();
    await sleep(70);
  }

  function isQuotaOrCaptureLimitError(message) {
    if (!message) return false;
    const s = String(message).toUpperCase();
    return (
      s.includes("MAX_CAPTURE") ||
      s.includes("QUOTA") ||
      s.includes("EXCEEDS THE MAXIMUM") ||
      s.includes("ALLOWED PER") ||
      s.includes("RATE LIMIT")
    );
  }

  async function captureVisibleTab() {
    const now = Date.now();
    if (lastCaptureAt > 0) {
      const since = now - lastCaptureAt;
      if (since < MIN_CAPTURE_INTERVAL_MS) {
        await sleep(MIN_CAPTURE_INTERVAL_MS - since);
      }
    }

    let backoffMs = 800;
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await chrome.runtime.sendMessage({
        type: "CAPTURE_VISIBLE_TAB"
      });
      if (response?.ok && response.dataUrl) {
        lastCaptureAt = Date.now();
        return response.dataUrl;
      }

      const errMsg = response?.error || "뷰포트 캡처 실패";
      if (isQuotaOrCaptureLimitError(errMsg) && attempt < maxAttempts - 1) {
        showToast(
          `캡처 재시도 중 (쿼터 제한)… ${attempt + 1}/${maxAttempts}`
        );
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs + 400, 4000);
        continue;
      }
      throw new Error(errMsg);
    }

    throw new Error("뷰포트 캡처 실패");
  }

  function dataUrlToImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("이미지 로드 실패"));
      img.src = dataUrl;
    });
  }

  function drawCropStrip(img, cropCss, viewportCss) {
    const scaleX = img.width / viewportCss.width;
    const scaleY = img.height / viewportCss.height;

    const sx = Math.round(cropCss.x * scaleX);
    const sy = Math.round(cropCss.y * scaleY);
    const sw = Math.round(cropCss.width * scaleX);
    const sh = Math.round(cropCss.height * scaleY);

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, sw);
    canvas.height = Math.max(1, sh);
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas;
  }

  function intersectsRect(a, b) {
    return !(
      a.right <= b.left ||
      a.left >= b.right ||
      a.bottom <= b.top ||
      a.top >= b.bottom
    );
  }

  function collectFixedStickyCandidates(targetElement) {
    const all = document.querySelectorAll("*");
    const candidates = [];
    for (const el of all) {
      if (!(el instanceof HTMLElement)) continue;
      if (el === toastEl) continue;
      if (targetElement && (targetElement.contains(el) || el.contains(targetElement))) {
        continue;
      }
      const style = window.getComputedStyle(el);
      if (style.position !== "fixed" && style.position !== "sticky") continue;
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      candidates.push(el);
    }
    return candidates;
  }

  function hideOverlappingCandidates(candidates, viewportCropRect, hiddenMeta) {
    const hiddenNow = [];
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (!intersectsRect(rect, viewportCropRect)) continue;

      if (!hiddenMeta.has(el)) {
        hiddenMeta.set(el, {
          value: el.style.getPropertyValue("visibility"),
          priority: el.style.getPropertyPriority("visibility")
        });
      }
      el.style.setProperty("visibility", "hidden", "important");
      hiddenNow.push(el);
    }
    return hiddenNow;
  }

  function restoreElements(elements, hiddenMeta) {
    for (const el of elements) {
      const old = hiddenMeta.get(el);
      if (!old) continue;
      if (old.value) {
        el.style.setProperty("visibility", old.value, old.priority || "");
      } else {
        el.style.removeProperty("visibility");
      }
    }
  }

  async function selectRegion() {
    if (!isExtensionUiRoot()) {
      return null;
    }
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "2147483647";
      overlay.style.cursor = "crosshair";
      overlay.style.background = "rgba(0,0,0,0.2)";

      const box = document.createElement("div");
      box.style.position = "absolute";
      box.style.border = "2px solid #2d74ff";
      box.style.background = "rgba(45,116,255,0.16)";
      overlay.appendChild(box);

      const tip = document.createElement("div");
      tip.textContent = "드래그해서 영역 선택 (ESC 취소)";
      tip.style.position = "fixed";
      tip.style.top = "12px";
      tip.style.left = "12px";
      tip.style.right = "auto";
      tip.style.bottom = "auto";
      tip.style.zIndex = "2147483647";
      tip.style.padding = "8px 10px";
      tip.style.borderRadius = "8px";
      tip.style.background = "rgba(0,0,0,0.72)";
      tip.style.color = "#fff";
      tip.style.fontSize = "12px";
      tip.style.pointerEvents = "none";
      tip.style.maxWidth = "min(320px, calc(100vw - 24px))";
      overlay.appendChild(tip);

      let startX = 0;
      let startY = 0;
      let dragging = false;

      const cleanup = () => {
        window.removeEventListener("keydown", onKeydown, true);
        overlay.remove();
      };

      const onKeydown = (event) => {
        if (event.key === "Escape") {
          cleanup();
          resolve(null);
        }
      };

      overlay.addEventListener("mousedown", (event) => {
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        box.style.left = `${startX}px`;
        box.style.top = `${startY}px`;
        box.style.width = "0px";
        box.style.height = "0px";
      });

      overlay.addEventListener("mousemove", (event) => {
        if (!dragging) return;
        const x = Math.min(startX, event.clientX);
        const y = Math.min(startY, event.clientY);
        const w = Math.abs(event.clientX - startX);
        const h = Math.abs(event.clientY - startY);
        box.style.left = `${x}px`;
        box.style.top = `${y}px`;
        box.style.width = `${w}px`;
        box.style.height = `${h}px`;
      });

      overlay.addEventListener("mouseup", (event) => {
        if (!dragging) return;
        dragging = false;
        const x = Math.min(startX, event.clientX);
        const y = Math.min(startY, event.clientY);
        const w = Math.abs(event.clientX - startX);
        const h = Math.abs(event.clientY - startY);
        cleanup();
        if (w < 8 || h < 8) {
          resolve(null);
          return;
        }
        resolve({
          left: x + window.scrollX,
          top: y + window.scrollY,
          width: w,
          height: h
        });
      });

      window.addEventListener("keydown", onKeydown, true);
      document.documentElement.appendChild(overlay);
    });
  }

  async function selectElement() {
    if (!isExtensionUiRoot()) {
      return null;
    }
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "2147483647";
      overlay.style.cursor = "pointer";
      overlay.style.background = "rgba(0,0,0,0.1)";

      const box = document.createElement("div");
      box.style.position = "fixed";
      box.style.border = "2px solid #ff9f1a";
      box.style.background = "rgba(255,159,26,0.14)";
      box.style.pointerEvents = "none";
      box.style.display = "none";
      overlay.appendChild(box);

      const tip = document.createElement("div");
      tip.textContent = "요소 위에 마우스 올린 뒤 클릭 (ESC 취소)";
      tip.style.position = "fixed";
      tip.style.top = "12px";
      tip.style.left = "12px";
      tip.style.right = "auto";
      tip.style.bottom = "auto";
      tip.style.zIndex = "2147483647";
      tip.style.padding = "8px 10px";
      tip.style.borderRadius = "8px";
      tip.style.background = "rgba(0,0,0,0.72)";
      tip.style.color = "#fff";
      tip.style.fontSize = "12px";
      tip.style.pointerEvents = "none";
      tip.style.maxWidth = "min(320px, calc(100vw - 24px))";
      overlay.appendChild(tip);

      let currentRect = null;
      let currentElement = null;

      const cleanup = () => {
        window.removeEventListener("keydown", onKeydown, true);
        overlay.removeEventListener("mousemove", onMouseMove, true);
        overlay.removeEventListener("click", onClick, true);
        overlay.remove();
      };

      const onKeydown = (event) => {
        if (event.key === "Escape") {
          cleanup();
          resolve(null);
        }
      };

      const onMouseMove = (event) => {
        overlay.style.pointerEvents = "none";
        const targetEl = document.elementFromPoint(event.clientX, event.clientY);
        overlay.style.pointerEvents = "auto";

        if (!targetEl || targetEl === document.documentElement || targetEl === document.body) {
          box.style.display = "none";
          currentRect = null;
          currentElement = null;
          return;
        }

        const rect = targetEl.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) {
          box.style.display = "none";
          currentRect = null;
          currentElement = null;
          return;
        }

        currentElement = targetEl;
        currentRect = {
          left: rect.left + window.scrollX,
          top: rect.top + window.scrollY,
          width: rect.width,
          height: rect.height
        };

        box.style.display = "block";
        box.style.left = `${rect.left}px`;
        box.style.top = `${rect.top}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
      };

      const onClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const picked = currentRect;
        const pickedElement = currentElement;
        cleanup();
        if (!picked || !pickedElement) {
          resolve(null);
          return;
        }
        resolve({ rect: picked, element: pickedElement });
      };

      overlay.addEventListener("mousemove", onMouseMove, true);
      overlay.addEventListener("click", onClick, true);
      window.addEventListener("keydown", onKeydown, true);
      document.documentElement.appendChild(overlay);
    });
  }

  async function buildStripsForScrollContainer(el, options = {}) {
    const { fixedCandidates = [], clipElement = null } = options;
    const hiddenMeta = new Map();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const viewportCss = { width: vw, height: vh };
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    const step = Math.max(1, Math.floor(el.clientHeight * 0.88));

    const positions = [];
    const seen = new Set();
    for (let y = 0; y < maxScroll + step; y += step) {
      const clampedY = clamp(Math.floor(y), 0, maxScroll);
      if (!seen.has(clampedY)) {
        positions.push(clampedY);
        seen.add(clampedY);
      }
      if (clampedY >= maxScroll) {
        break;
      }
    }
    if (positions.length === 0) {
      positions.push(0);
    }

    const strips = [];
    for (const scrollTop of positions) {
      el.scrollTop = scrollTop;
      await waitForPaint();

      let raw = expandCropRectForRowWrapper(el);
      if (clipElement) {
        const clipR = clipElement.getBoundingClientRect();
        let inter = intersectClientRects(raw, clipR);
        if (!inter) {
          inter = intersectClientRects(el.getBoundingClientRect(), clipR);
        }
        if (inter) {
          raw = inter;
        }
      }
      const cropCss = clampRectToViewport(raw, vw, vh);
      if (cropCss.width < 4 || cropCss.height < 4) {
        continue;
      }

      const hiddenNow = hideOverlappingCandidates(
        fixedCandidates,
        {
          left: cropCss.x,
          top: cropCss.y,
          right: cropCss.x + cropCss.width,
          bottom: cropCss.y + cropCss.height
        },
        hiddenMeta
      );

      let img;
      try {
        if (hiddenNow.length > 0) {
          await waitForCaptureSync();
        }
        const dataUrl = await captureVisibleTab();
        img = await dataUrlToImage(dataUrl);
      } finally {
        restoreElements(hiddenNow, hiddenMeta);
      }

      const stripCanvas = drawCropStrip(img, cropCss, viewportCss);
      strips.push({
        canvas: stripCanvas,
        docTop: scrollTop,
        docBottom: scrollTop + el.clientHeight
      });
    }

    if (!strips.length) {
      throw new Error("캡처 결과가 비었습니다.");
    }
    return strips;
  }

  async function buildStripsForRect(targetRect, options = {}) {
    const { fixedCandidates = [] } = options;
    const hiddenMeta = new Map();
    const metrics = getDocMetrics();
    const maxScrollY = Math.max(0, metrics.docHeight - metrics.viewportHeight);
    const startY = clamp(
      Math.floor(targetRect.top),
      0,
      Math.max(0, metrics.docHeight - 1)
    );
    const endY = clamp(
      Math.ceil(targetRect.top + targetRect.height),
      0,
      metrics.docHeight
    );

    const positions = [];
    const seen = new Set();
    for (let y = startY; y < endY; y += metrics.viewportHeight) {
      const clampedY = clamp(y, 0, maxScrollY);
      if (!seen.has(clampedY)) {
        positions.push(clampedY);
        seen.add(clampedY);
      }
      if (clampedY >= maxScrollY || y + metrics.viewportHeight >= endY) break;
    }
    if (positions.length === 0) {
      positions.push(clamp(startY, 0, maxScrollY));
    }

    const strips = [];
    for (const y of positions) {
      window.scrollTo(0, y);
      await waitForPaint();

      const viewportRect = {
        left: window.scrollX,
        top: y,
        right: window.scrollX + metrics.viewportWidth,
        bottom: y + metrics.viewportHeight
      };
      const target = {
        left: targetRect.left,
        top: targetRect.top,
        right: targetRect.left + targetRect.width,
        bottom: targetRect.top + targetRect.height
      };

      const interLeft = Math.max(viewportRect.left, target.left);
      const interTop = Math.max(viewportRect.top, target.top);
      const interRight = Math.min(viewportRect.right, target.right);
      const interBottom = Math.min(viewportRect.bottom, target.bottom);

      if (interRight <= interLeft || interBottom <= interTop) {
        continue;
      }

      const cropCss = {
        x: interLeft - viewportRect.left,
        y: interTop - viewportRect.top,
        width: interRight - interLeft,
        height: interBottom - interTop
      };

      const hiddenNow = hideOverlappingCandidates(
        fixedCandidates,
        {
          left: cropCss.x,
          top: cropCss.y,
          right: cropCss.x + cropCss.width,
          bottom: cropCss.y + cropCss.height
        },
        hiddenMeta
      );

      let img;
      try {
        if (hiddenNow.length > 0) {
          await waitForCaptureSync();
        }
        const dataUrl = await captureVisibleTab();
        img = await dataUrlToImage(dataUrl);
      } finally {
        restoreElements(hiddenNow, hiddenMeta);
      }

      const stripCanvas = drawCropStrip(img, cropCss, {
        width: metrics.viewportWidth,
        height: metrics.viewportHeight
      });
      strips.push({
        canvas: stripCanvas,
        docTop: interTop,
        docBottom: interBottom
      });
    }

    return strips;
  }

  function mergeStrips(strips) {
    if (!strips.length) {
      throw new Error("캡처 결과가 비었습니다.");
    }
    const ordered = [...strips].sort((a, b) => a.docTop - b.docTop);
    const maxW = Math.max(...ordered.map((s) => s.canvas.width));
    const segments = [];
    let lastDocBottom = -1;

    for (const strip of ordered) {
      const docSpan = Math.max(0, strip.docBottom - strip.docTop);
      if (docSpan <= 0) continue;

      const overlapDoc = Math.max(0, lastDocBottom - strip.docTop);
      const ratio =
        strip.canvas.height > 0 ? strip.canvas.height / docSpan : 1;
      const skipPx = Math.min(
        strip.canvas.height,
        Math.max(0, Math.round(overlapDoc * ratio))
      );
      const drawHeight = strip.canvas.height - skipPx;
      if (drawHeight <= 0) {
        lastDocBottom = Math.max(lastDocBottom, strip.docBottom);
        continue;
      }

      segments.push({
        canvas: strip.canvas,
        sy: skipPx,
        sh: drawHeight
      });
      lastDocBottom = Math.max(lastDocBottom, strip.docBottom);
    }

    if (!segments.length) {
      throw new Error("캡처 결과가 비었습니다.");
    }

    const height = segments.reduce((sum, seg) => sum + seg.sh, 0);
    const merged = document.createElement("canvas");
    merged.width = maxW;
    merged.height = height;
    const ctx = merged.getContext("2d", { alpha: false });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, maxW, height);

    let y = 0;
    for (const seg of segments) {
      const x0 = Math.floor((maxW - seg.canvas.width) / 2);
      ctx.drawImage(
        seg.canvas,
        0,
        seg.sy,
        seg.canvas.width,
        seg.sh,
        x0,
        y,
        seg.canvas.width,
        seg.sh
      );
      y += seg.sh;
    }
    return merged;
  }

  function concatUint8(parts) {
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function ascii(str) {
    return new TextEncoder().encode(str);
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function buildSingleImagePdf(jpegBytes, imgWidthPx, imgHeightPx) {
    const ptPerPx = 72 / 96;
    const pageW = Math.max(1, Math.round(imgWidthPx * ptPerPx));
    const pageH = Math.max(1, Math.round(imgHeightPx * ptPerPx));
    const content = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;

    const objects = [
      ascii("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
      ascii("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"),
      ascii(
        `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
      ),
      concatUint8([
        ascii(
          `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgWidthPx} /Height ${imgHeightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
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
    for (let i = 1; i <= objects.length; i += 1) {
      xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    const trailer =
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
      `startxref\n${xrefStart}\n%%EOF`;

    return concatUint8([...bodyParts, ascii(xref), ascii(trailer)]);
  }

  async function downloadCanvasAsPdf(canvas, fileNameBase) {
    const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.95);
    const base64 = jpegDataUrl.split(",")[1];
    if (!base64) {
      throw new Error("PDF 이미지 인코딩 실패");
    }
    const jpegBytes = base64ToBytes(base64);
    const pdfBytes = buildSingleImagePdf(jpegBytes, canvas.width, canvas.height);
    let binary = "";
    for (let i = 0; i < pdfBytes.length; i += 1) {
      binary += String.fromCharCode(pdfBytes[i]);
    }
    const pdfBase64 = btoa(binary);
    const response = await chrome.runtime.sendMessage({
      type: "SAVE_PDF",
      fileName: `${sanitizeFileName(fileNameBase)}.pdf`,
      dataUrl: `data:application/pdf;base64,${pdfBase64}`
    });
    if (!response?.ok) {
      throw new Error(response?.error || "PDF 저장 실패");
    }
  }

  async function run(mode) {
    if (isRunning) {
      throw new Error("이미 캡처가 진행 중입니다.");
    }
    isRunning = true;

    const originalX = window.scrollX;
    const originalY = window.scrollY;
    let scrollContainerRestore = null;

    try {
      purgeExtensionToasts();
      const metrics = getDocMetrics();
      let rect;
      let fixedCandidates = [];
      let strips;

      if (mode === "region") {
        rect = await selectRegion();
        if (!rect) {
          throw new Error("영역 선택이 취소되었습니다.");
        }
      } else if (mode === "element") {
        const picked = await selectElement();
        if (!picked) {
          throw new Error("요소 선택이 취소되었습니다.");
        }
        const scrollEl = findScrollTargetForPickedElement(picked.element);
        const scrollRange = scrollEl
          ? scrollEl.scrollHeight - scrollEl.clientHeight
          : 0;
        if (scrollEl && scrollRange >= 48) {
          scrollContainerRestore = {
            el: scrollEl,
            scrollTop: scrollEl.scrollTop
          };
          fixedCandidates = collectFixedStickyCandidates(picked.element);
          showToast("캡처 중…");
          strips = await buildStripsForScrollContainer(scrollEl, {
            fixedCandidates,
            clipElement: picked.element
          });
        } else {
          rect = picked.rect;
          fixedCandidates = collectFixedStickyCandidates(picked.element);
        }
      } else if (mode === "full") {
        // 보이는 뷰포트 한 장만 (스크롤 스티치 없음 — 메모리·쿼터 부담 최소화)
        rect = {
          left: window.scrollX,
          top: window.scrollY,
          width: metrics.viewportWidth,
          height: metrics.viewportHeight
        };
        fixedCandidates = [];
      } else {
        rect = {
          left: 0,
          top: 0,
          width: metrics.viewportWidth,
          height: metrics.docHeight
        };
      }

      if (strips === undefined) {
        showToast("캡처 중…");
        strips = await buildStripsForRect(rect, { fixedCandidates });
      }
      const merged = mergeStrips(strips);
      showToast("PDF 저장 중...");
      await downloadCanvasAsPdf(merged, document.title || "untitled");
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
      purgeExtensionToasts();
      window.scrollTo(originalX, originalY);
      if (scrollContainerRestore) {
        scrollContainerRestore.el.scrollTop = scrollContainerRestore.scrollTop;
      }
      isRunning = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "START_CAPTURE") {
      return false;
    }

    const mode = message.mode;
    // 동일 출처 iframe마다 스크립트가 돌아가며 선택 UI·툴팁이 중복됨 → 최상위만
    if (
      (mode === "region" || mode === "element") &&
      !isExtensionUiRoot()
    ) {
      return false;
    }

    // 영역/요소: 팝업이 전달 성공 여부만 확인한 뒤 닫을 수 있도록 즉시 응답
    if (mode === "region" || mode === "element") {
      sendResponse({ ok: true });
      void run(mode).catch(() => {});
      return false;
    }

    run(mode)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "알 수 없는 오류"
        })
      );

    return true;
  });
})();
