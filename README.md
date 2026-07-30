# 진로전담교사 모의 심층면접 타이머

4개 파일로 구성된 정적 웹사이트입니다.

- `index.html` — 페이지 구조
- `style.css` — 스타일
- `script.js` — 타이머·TTS·음성인식·키워드 채점 로직
- `questions.json` — 문항·모범답안·키워드 데이터 (268문항)

## GitHub Pages로 배포하는 방법

1. GitHub에서 새 저장소를 만듭니다 (예: `interview-practice`).
2. 이 4개 파일(`index.html`, `style.css`, `script.js`, `questions.json`)을 저장소 루트에 그대로 업로드합니다.
   - 저장소 페이지의 "Add file → Upload files"로 드래그 앤 드롭하면 됩니다.
3. 저장소 **Settings → Pages**로 이동합니다.
4. "Build and deployment" 항목에서 Source를 **Deploy from a branch**로, Branch를 **main / (root)**로 설정하고 저장합니다.
5. 1~2분 후 `https://<사용자명>.github.io/<저장소명>/` 주소로 접속하면 사이트가 열립니다.

## 참고 사항

- 이 사이트는 `fetch`로 `questions.json`을 불러오기 때문에 반드시 웹서버(GitHub Pages 등)를 통해 열어야 합니다. `index.html`을 로컬에서 더블클릭해서 열면(`file://` 방식) 브라우저 보안 정책상 fetch가 차단되어 문항이 로드되지 않을 수 있습니다.
- GitHub Pages는 `https`로 서비스되므로, 이전에 로컬 파일에서 겪었던 마이크 권한 팝업 반복 문제도 대부분 해결됩니다(최초 1회 허용 후 그 사이트 주소로는 계속 기억됩니다).
- 음성 인식(STT)은 Chrome 계열 브라우저에서 가장 안정적으로 동작합니다.
