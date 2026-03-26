# Web To PDF

Chrome 확장 프로그램: 현재 보이는 페이지, 선택한 요소는 **텍스트·이미지가 유지되는 네이티브 PDF**로 저장하고, 드래그로 고른 **영역은 화면 스크린샷을 잘라 이미지 PDF** 한 장으로 저장합니다.

Chrome extension: **native PDF** (with selectable text and proper images) for the **visible page** and **element** modes; **raster/image PDF** (screenshot crop) for **drag-to-select region** capture, matching a snipping-tool style workflow.

---

## 한국어

### 개발 방식

이 저장소의 코드는 **Cursor**를 이용한 **바이브 코딩**(대화·반복 중심으로 빠르게 구현하는 방식)으로 작성되었습니다.

### 설치(개발)

1. Chrome에서 `chrome://extensions` → **개발자 모드** 켜기  
2. **압축해제된 확장 프로그램을 로드합니다** → 이 프로젝트 루트 폴더 선택

### 권한 및 사용 이유

| 권한 | 사용 이유 |
|------|-----------|
| `activeTab` | 사용자가 확장 아이콘·팝업으로 동작을 시작할 때, 현재 탭과 안전하게 연동하기 위해 사용합니다. |
| `tabs` | 활성 탭을 찾고(`tabs.query`), 콘텐츠 스크립트와 메시지를 주고받으며(`sendMessage`), **영역 캡처** 시 뷰포트 스크린샷을 찍을 때 창 정보가 필요한 `captureVisibleTab`에 사용합니다. |
| `scripting` | 팝업에서 `content/capture.js`를 페이지에 주입(`executeScript`)해 영역 선택 UI·Element 선택·캡처 로직을 실행합니다. |
| `downloads` | 생성한 PDF를 `data:` URL로 사용자가 저장할 수 있게 다운로드 API로 저장 대화상자를 띄웁니다. |
| `debugger` | **현재 페이지·Element PDF**를 Chrome의 인쇄 엔진과 동일하게 **텍스트·벡터·이미지가 살아 있는 PDF**로 만들기 위해 사용합니다. 백그라운드에서 Chrome DevTools Protocol의 **`Page.printToPDF`** 를 호출하려면 `chrome.debugger` 권한이 필요합니다. 인쇄가 잠시 동안만 연결된 뒤 **곧바로 해제**되며, 다른 사이트로 데이터를 보내지 않습니다. 실행 중 탭 상단에 *「확장 프로그램이 이 브라우저를 디버깅하고 있습니다」* 배너가 잠깐 보일 수 있습니다. |
| (호스트) | **`host_permissions` / 선언형 콘텐츠 스크립트 없음.** 사용자가 팝업에서 동작을 시작할 때만 `scripting`으로 `capture.js`를 해당 활성 탭(필요 시 iframe)에 주입합니다. |

**모드별 PDF 종류**

- **현재 페이지 / Element**: 네이티브 PDF (`debugger` + `printToPDF`). PDF 뷰어에서 텍스트 선택·복사가 가능한 경우가 많습니다.
- **영역 캡처**: `captureVisibleTab` + Canvas 크롭 후 **한 장짜리 이미지(JPEG) PDF**. Windows 캡처 도구처럼 보이는 그대로를 담습니다(텍스트 레이어 없음).

**데이터 수집**: 이 확장은 서버로 페이지 내용을 보내지 않으며, 캡처·PDF 생성은 사용자 기기 내에서 처리됩니다.

**개인정보처리방침**: [PRIVACY.md](PRIVACY.md) (Chrome 웹스토어 제출 시 공개 URL로는 저장소의 해당 파일 링크를 사용할 수 있습니다.)

### 저작권 및 라이선스

Copyright (c) 2026 **realbrotha**.  
본 소프트웨어는 [MIT 라이선스](LICENSE) 하에 배포됩니다. **누구나** 자유롭게 사용·복제·수정·배포할 수 있으며, 라이선스 전문과 저작권 고지를 유지하는 조건입니다.

---

## English

### How this was built

The code in this repository was developed through **vibe coding** with **Cursor** (an iterative, conversational style of building software quickly).

### Install (development)

1. Open `chrome://extensions` and enable **Developer mode**  
2. Click **Load unpacked** and select this project’s root folder

### Permissions and why they are used

| Permission | Why it is needed |
|------------|------------------|
| `activeTab` | Lets the extension work with the tab the user is actively using when they open the popup or trigger the action. |
| `tabs` | Used to find the active tab (`tabs.query`), message the content script (`sendMessage`), and supply the correct window when calling **`captureVisibleTab`** for **region** (screenshot) capture. |
| `scripting` | Injects `content/capture.js` (`executeScript`) for region selection UI, element picking, and capture helpers. |
| `downloads` | Saves generated PDFs via the downloads API (`saveAs` dialog) from `data:` URLs. |
| `debugger` | Required for **native PDF** output on **visible page** and **element** modes. The service worker attaches the Chrome DevTools Protocol briefly and calls **`Page.printToPDF`**, which uses the same print pipeline as Chrome—so text stays selectable and images/vector graphics are preserved where the page allows. The debugger session is **attached only for that print**, then **detached**; no page data is sent to external servers. You may see Chrome’s short-lived banner: *“An extension is debugging this browser”*. |
| (hosts) | **No `host_permissions` or declarative content scripts.** The capture script runs only after the user starts an action from the popup, via `executeScript` on the active tab (and frames when needed). |

**PDF output by mode**

- **Visible page / Element**: Native PDF via `debugger` + `printToPDF`. Text is often selectable in PDF viewers.
- **Region (drag)**: **Raster/image PDF**—viewport screenshot from `captureVisibleTab`, cropped on a canvas, embedded as a single JPEG page (snipping-tool style; no text layer).

**Data collection**: This extension does not send page content to a remote server; capture and PDF generation run locally on your device.

**Privacy policy**: [PRIVACY.md](PRIVACY.md) (for Chrome Web Store, you may use the public URL to this file in the repository.)

### Copyright and license

Copyright (c) 2026 **realbrotha**.  
Licensed under the [MIT License](LICENSE). **Anyone** may use, copy, modify, and distribute this software, subject to retaining the license text and copyright notice.

---

Repository: [https://github.com/realbrotha/webtopdf](https://github.com/realbrotha/webtopdf)
