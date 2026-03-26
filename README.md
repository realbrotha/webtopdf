# Web To PDF

Chrome 확장 프로그램: 현재 보이는 영역, 사용자가 지정한 영역, 또는 선택한 요소를 PDF로 저장합니다.

Chrome extension: save the visible viewport, a selected region, or a selected element as PDF.

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
| `tabs` | 활성 탭을 찾고(`tabs.query`), 캡처 스크립트와 메시지를 주고받으며(`sendMessage`), 화면 캡처 시 창 정보가 필요할 때(`captureVisibleTab`) 사용합니다. |
| `scripting` | 팝업에서 `content/capture.js`를 페이지에 주입(`executeScript`)해 캡처 UI·스티칭 로직을 실행합니다. |
| `downloads` | 생성한 PDF를 `data:` URL로 사용자가 저장할 수 있게 다운로드 API로 저장 대화상자를 띄웁니다. |
| `host_permissions` (`<all_urls>`) | 임의의 웹사이트 탭에서 위 스크립트 주입·캡처가 동작하도록 호스트 범위를 허용합니다. |
| 콘텐츠 스크립트 `all_frames: true` | iframe이 있는 페이지에서도 동일한 방식으로 캡처할 수 있게 모든 프레임에 스크립트를 로드합니다. |

**데이터 수집**: 이 확장은 서버로 페이지 내용을 보내지 않으며, 캡처·PDF 생성은 사용자 기기 내에서 처리됩니다.

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
| `tabs` | Used to find the active tab (`tabs.query`), exchange messages with the capture script (`sendMessage`), and call `captureVisibleTab` with the correct window context. |
| `scripting` | Injects `content/capture.js` into the page (`executeScript`) so capture and stitching can run in the page context. |
| `downloads` | Saves the generated PDF via the downloads API (`saveAs` dialog) from a `data:` URL. |
| `host_permissions` (`<all_urls>`) | Required so the extension can inject and run the capture script on arbitrary websites the user chooses. |
| Content scripts with `all_frames: true` | Loads the capture script in all frames so capturing works on pages that use iframes. |

**Data collection**: This extension does not send page content to a remote server; capture and PDF generation run locally on your device.

### Copyright and license

Copyright (c) 2026 **realbrotha**.  
Licensed under the [MIT License](LICENSE). **Anyone** may use, copy, modify, and distribute this software, subject to retaining the license text and copyright notice.

---

Repository: [https://github.com/realbrotha/webtopdf](https://github.com/realbrotha/webtopdf)
