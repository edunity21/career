
let QUESTIONS = [];
const TOTAL_SECONDS = 180;
const COLOR_SWITCH_AT = 120;
const URGENT_AT = 30;

let allSources = [];
let currentSource = "전체";
let pool = [];
let current = null;
let orderRandom = false; // false: 문항 번호 순서대로, true: 무작위
let seqIndex = 0;        // 순서 모드에서 다음에 출제할 문항 위치
let hasDrawn = false;

let remaining = TOTAL_SECONDS;
let timerId = null;
let warned30 = false;

const $ = (id) => document.getElementById(id);
const sourceFilterEl = $("sourceFilter");
const countLabel = $("countLabel");
const qnumEl = $("qnum");
const qtextEl = $("qtext");
const srcBadgeEl = $("srcBadge");
const phaseEl = $("phaseLabel");
const timeEl = $("timeLabel");
const barEl = $("bar");
const drawBtn = $("drawBtn");
const prevBtn = $("prevBtn");
const orderSeg = $("orderSeg");
const timerBtn = $("timerBtn");
const resetBtn = $("resetBtn");
const cardBtn = $("cardBtn");
const cardBtnText = $("cardBtnText");
const cardReadBtn = $("cardReadBtn");
const cardBox = $("cardBox");
const answerBtn = $("answerBtn");
const answerBtnText = $("answerBtnText");
const answerReadBtn = $("answerReadBtn");
const answerBox = $("answerBox");
const autoReadChk = $("autoReadChk");
const nowReadingEl = $("nowReading");
const kwLabelEl = $("kwLabel");
const keywordHintsEl = $("keywordHints");
const answerInputEl = $("answerInput");
const checkBtn = $("checkBtn");
const sttBtn = $("sttBtn");
const clearBtn = $("clearBtn");
const checkResultEl = $("checkResult");

/* ------------------------------------------------------------------
   데이터 접근 헬퍼
   요약 카드(cardCore/cardResp)와 모범답안(answerCore/answerResp)은
   서로 다른 원본에서 온 별개의 자료다. 예전 파일 형식(core/resp/a)도
   읽을 수 있도록 아래에서 흡수한다.
------------------------------------------------------------------ */
function asList(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === "string" && v.trim()) {
    return v.split("\n").map(s => s.replace(/^[·•\-\s]+/, "").trim()).filter(Boolean);
  }
  return [];
}
const cardCoreOf = (it) => asList(it && it.cardCore);
const cardRespOf = (it) => asList(it && it.cardResp);
const answerCoreOf = (it) => (it && (it.answerCore || it.core)) || "";
const answerRespOf = (it) => (it && (it.answerResp || it.resp)) || "";
function answerFullOf(it) {
  const parts = [answerCoreOf(it), answerRespOf(it)].filter(Boolean);
  return parts.length ? parts.join("\n\n") : ((it && it.a) || "");
}

/* --------------------------- 문항 목록 --------------------------- */
function buildFilterOptions() {
  sourceFilterEl.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "전체";
  optAll.textContent = "전체 문항 (" + QUESTIONS.length + ")";
  sourceFilterEl.appendChild(optAll);
  allSources.forEach(src => {
    const cnt = QUESTIONS.filter(q => q.source === src).length;
    const opt = document.createElement("option");
    opt.value = src;
    opt.textContent = src + " (" + cnt + ")";
    sourceFilterEl.appendChild(opt);
  });
}

function currentQuestionSet() {
  if (currentSource === "전체") return QUESTIONS;
  return QUESTIONS.filter(q => q.source === currentSource);
}

function refillPool() {
  const set = currentQuestionSet();
  const idxs = set.map((_, i) => i);
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  pool = idxs;
}

function updateCountLabel() {
  const set = currentQuestionSet();
  countLabel.textContent = currentSource + " · 총 " + set.length + "문항 "
    + (orderRandom ? "무작위 출제" : "순서대로 출제");
}

/* ------------------------------ 소리 ------------------------------ */
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  // 모바일은 사용자 조작 전까지 suspended 상태이므로 깨워준다
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function beep(freq, dur) {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur / 1000);
  } catch (e) {}
}

/* ------------------------------- TTS ------------------------------- */
const ttsSupported = "speechSynthesis" in window;
let koVoice = null;
let ttsRate = 1;
let speakQueue = [];
let speakingNow = null;
let speakingLabel = "";   // "" | "요약 카드" | "모범답안"

function loadVoices() {
  if (!ttsSupported) return;
  const vs = window.speechSynthesis.getVoices() || [];
  koVoice = vs.find(v => v.lang && v.lang.toLowerCase().startsWith("ko")) || null;
}
if (ttsSupported) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function makeUtter(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  if (koVoice) u.voice = koVoice;
  u.rate = ttsRate;
  u.pitch = 1;
  u.volume = 1;
  return u;
}

// 안드로이드에서 긴 문장이 중간에 끊기는 것을 막기 위해 문장 단위로 쪼갠다
function splitForSpeech(text) {
  const marked = String(text || "")
    .replace(/([.!?。])\s+/g, "$1\u0001")
    .replace(/\n+/g, "\u0001");
  const parts = marked.split("\u0001").map(s => s.trim()).filter(Boolean);
  return parts.length ? parts : [String(text || "")];
}

// 듣기 버튼은 재생 중이면 '중지'로 바뀌어, 누른 자리에서 바로 멈출 수 있다
function updateReadButtons() {
  const pairs = [[cardReadBtn, "요약 카드"], [answerReadBtn, "모범답안"]];
  pairs.forEach(([btn, label]) => {
    const on = speakingLabel === label;
    btn.textContent = on ? "■ 중지" : "▶ 듣기";
    btn.classList.toggle("playing", on);
  });
  nowReadingEl.textContent = speakingLabel ? "읽는 중 · " + speakingLabel : "";
}

function speakSequence(chunks, label) {
  if (!ttsSupported || !chunks.length) return;
  window.speechSynthesis.cancel();
  speakQueue = chunks.slice();
  speakingLabel = label || "";
  updateReadButtons();
  const next = () => {
    if (!speakQueue.length) { stopSpeaking(); return; }
    speakingNow = speakQueue.shift();
    const u = makeUtter(speakingNow);
    u.onend = next;
    u.onerror = () => stopSpeaking();
    window.speechSynthesis.speak(u);
  };
  next();
}

function stopSpeaking() {
  speakQueue = [];
  speakingNow = null;
  speakingLabel = "";
  if (ttsSupported) window.speechSynthesis.cancel();
  updateReadButtons();
}

// 배속을 바꾸면 읽던 문장부터 새 속도로 이어서 다시 읽는다
function applyRate(rate) {
  ttsRate = rate;
  document.querySelectorAll("#speedSeg .segBtn").forEach(b => {
    b.classList.toggle("active", parseFloat(b.dataset.rate) === rate);
  });
  if (speakingNow && speakingLabel) {
    speakSequence([speakingNow].concat(speakQueue), speakingLabel);
  }
}

// 요약 카드 읽기: 문제 → 핵심정리 항목 → 대응방안 항목
function speakCard(item) {
  if (!ttsSupported || !item) return;
  const parts = splitForSpeech(item.q);
  const core = cardCoreOf(item), resp = cardRespOf(item);
  if (core.length) {
    parts.push("핵심정리.");
    core.forEach(b => parts.push.apply(parts, splitForSpeech(b)));
  }
  if (resp.length) {
    parts.push("대응방안.");
    resp.forEach(b => parts.push.apply(parts, splitForSpeech(b)));
  }
  speakSequence(parts, "요약 카드");
}

// 모범답안 읽기: 문제 → 구술형 전문
function speakAnswer(item) {
  if (!ttsSupported || !item) return;
  const parts = splitForSpeech(item.q);
  parts.push.apply(parts, splitForSpeech(answerFullOf(item)));
  speakSequence(parts, "모범답안");
}

// 듣기 버튼: 같은 카드를 읽는 중이면 중지, 아니면 그 카드를 읽기 시작
function toggleRead(kind) {
  if (!current) return;
  const label = kind === "card" ? "요약 카드" : "모범답안";
  if (speakingLabel === label) { stopSpeaking(); return; }
  (kind === "card" ? speakCard : speakAnswer)(current);
}

if (!ttsSupported) {
  autoReadChk.checked = false;
  autoReadChk.disabled = true;
  nowReadingEl.textContent = "이 브라우저는 음성 읽기를 지원하지 않습니다";
}

/* --------------------------- 렌더링 --------------------------- */
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function bulletColumn(title, cls, items) {
  return '<div class="sumCol ' + cls + '">'
    + '<div class="sumHead ' + cls + '">' + title + "</div>"
    + '<ul class="sumList">' + items.map(b => "<li>" + esc(b) + "</li>").join("") + "</ul>"
    + "</div>";
}

function renderCard(item) {
  const core = cardCoreOf(item), resp = cardRespOf(item);
  if (!core.length && !resp.length) {
    cardBox.innerHTML = '<div class="placeholder">이 문항에는 요약 카드 자료가 없습니다. 모범답안을 확인해주세요.</div>';
    return;
  }
  let html = '<div class="sumGrid">';
  if (core.length) html += bulletColumn("핵심정리", "core", core);
  if (resp.length) html += bulletColumn("대응방안", "resp", resp);
  cardBox.innerHTML = html + "</div>";
}

function renderAnswer(item) {
  const core = answerCoreOf(item), resp = answerRespOf(item);
  let html = "";
  if (core) html += '<div class="ansSec"><div class="ansHead core">■ 핵심정리</div><div class="ansBody">' + esc(core) + "</div></div>";
  if (resp) html += '<div class="ansSec"><div class="ansHead resp">■ 대응방안</div><div class="ansBody">' + esc(resp) + "</div></div>";
  if (!html) {
    const full = answerFullOf(item);
    html = full ? '<div class="ansBody">' + esc(full) + "</div>"
                : '<div class="placeholder">이 문항에는 모범답안 자료가 없습니다.</div>';
  }
  answerBox.innerHTML = html;
}

function setReveal(kind, show) {
  const isCard = kind === "card";
  const box = isCard ? cardBox : answerBox;
  const btn = isCard ? cardBtn : answerBtn;
  const txt = isCard ? cardBtnText : answerBtnText;
  const name = isCard ? "요약 카드" : "모범답안";
  if (show && current) (isCard ? renderCard : renderAnswer)(current);
  box.classList.toggle("show", show);
  btn.querySelector(".chev").classList.toggle("open", show);
  txt.textContent = name + (show ? " 숨기기" : " 보기");
  btn.setAttribute("aria-expanded", show ? "true" : "false");
}

function toggleReveal(kind) {
  if (!current) return;
  const box = kind === "card" ? cardBox : answerBox;
  const show = !box.classList.contains("show");
  setReveal(kind, show);
  const name = kind === "card" ? "요약 카드" : "모범답안";
  if (show && autoReadChk.checked) {
    (kind === "card" ? speakCard : speakAnswer)(current);
  } else if (!show && speakingLabel === name) {
    stopSpeaking();
  }
}

function closeReveals() {
  setReveal("card", false);
  setReveal("answer", false);
  cardBox.innerHTML = "";
  answerBox.innerHTML = "";
}

/* --------------------------- 타이머 --------------------------- */
function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return m + ":" + s;
}

function currentStage() {
  if (remaining <= 0) return "done";
  if (remaining <= URGENT_AT) return "urgent";
  if (remaining <= COLOR_SWITCH_AT) return "answer";
  return "normal";
}

function updateDisplay() {
  timeEl.textContent = formatTime(Math.max(0, remaining));
  barEl.style.width = Math.max(0, (remaining / TOTAL_SECONDS) * 100) + "%";
  const stage = currentStage();
  timeEl.classList.remove("answer", "urgent");
  barEl.classList.remove("answer", "urgent");
  if (stage === "done") {
    phaseEl.textContent = "종료"; phaseEl.className = "phase done";
  } else if (stage === "urgent") {
    timeEl.classList.add("urgent"); barEl.classList.add("urgent");
    phaseEl.textContent = "답변 중 (종료 임박)"; phaseEl.className = "phase urgent";
  } else if (stage === "answer") {
    timeEl.classList.add("answer"); barEl.classList.add("answer");
    phaseEl.textContent = "답변 중"; phaseEl.className = "phase answer";
  } else {
    phaseEl.textContent = current ? "구상 중" : "대기 중"; phaseEl.className = "phase";
  }
}

// 시작 / 일시정지 / 계속을 버튼 하나로 처리한다
function updateTimerBtn() {
  if (!current || remaining <= 0) {
    timerBtn.disabled = true;
    timerBtn.textContent = remaining <= 0 ? "종료됨" : "시작";
  } else if (timerId) {
    timerBtn.disabled = false;
    timerBtn.textContent = "일시정지";
  } else {
    timerBtn.disabled = false;
    timerBtn.textContent = remaining === TOTAL_SECONDS ? "시작" : "계속";
  }
  resetBtn.disabled = !current;
}

function toggleTimer() {
  if (!current) return;
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  } else if (remaining > 0) {
    timerId = setInterval(tick, 1000);
  }
  updateTimerBtn();
}

function resetTimerState() {
  clearInterval(timerId);
  timerId = null;
  remaining = TOTAL_SECONDS;
  warned30 = false;
  updateDisplay();
  updateTimerBtn();
}

function tick() {
  remaining -= 1;
  if (remaining === COLOR_SWITCH_AT) beep(660, 180);
  if (remaining === URGENT_AT && !warned30) { beep(880, 250); warned30 = true; }
  if (remaining <= 0) {
    clearInterval(timerId);
    timerId = null;
    beep(523, 200);
    setTimeout(() => beep(523, 200), 300);
    updateTimerBtn();
  }
  updateDisplay();
}

/* ----------------------- 키워드 자가진단 ----------------------- */
function normalizeForMatch(s) {
  return (s || "").replace(/\s+/g, "").toLowerCase();
}

function renderKeywordHints(matchedSet) {
  keywordHintsEl.innerHTML = "";
  const kws = (current && current.keywords) ? current.keywords : [];
  kws.forEach(k => {
    const span = document.createElement("span");
    let cls = "kw-chip";
    if (matchedSet) cls += matchedSet.has(k) ? " matched" : " missing";
    span.className = cls;
    span.textContent = k;
    keywordHintsEl.appendChild(span);
  });
  kwLabelEl.style.display = kws.length ? "block" : "none";
}

function checkKeywords() {
  if (!current) return;
  const kws = current.keywords || [];
  const answerNorm = normalizeForMatch(answerInputEl.value);
  const matchedSet = new Set();
  kws.forEach(k => {
    if (answerNorm.length > 0 && answerNorm.includes(normalizeForMatch(k))) matchedSet.add(k);
  });
  renderKeywordHints(matchedSet);
  const pct = kws.length ? Math.round((matchedSet.size / kws.length) * 100) : 0;
  checkResultEl.textContent = kws.length
    ? (kws.length + "개 중 " + matchedSet.size + "개 (" + pct + "%)")
    : "등록된 키워드 없음";
}

/* --------------------------- 음성 인식 --------------------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recognizing = false;
let manuallyStopped = true;
let restartTimer = null;

function setSttUi(on, text) {
  sttBtn.classList.toggle("recording", on);
  sttBtn.innerHTML = '<span class="dot"></span>' + (text || (on ? "인식 중지" : "음성 인식"));
}

function attachRecognitionHandlers(r) {
  r.lang = "ko-KR";
  r.continuous = true;
  r.interimResults = true;
  r.onresult = (e) => {
    let finalText = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
    }
    if (finalText.trim()) {
      answerInputEl.value = (answerInputEl.value ? answerInputEl.value + " " : "") + finalText.trim();
    }
  };
  r.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      manuallyStopped = true;
      recognizing = false;
      setSttUi(false, "마이크 권한 필요");
    }
    // other errors (no-speech, network, aborted) are recovered from in onend below
  };
  r.onend = () => {
    if (recognizing && !manuallyStopped) {
      // Chrome ends the recognition session after ~60s even in continuous mode;
      // if the user never asked to stop, transparently restart so it feels continuous.
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => { try { recognition.start(); } catch (e) {} }, 250);
    } else {
      recognizing = false;
      setSttUi(false);
      checkKeywords();
    }
  };
  return r;
}

if (SR) {
  recognition = attachRecognitionHandlers(new SR());
} else {
  sttBtn.disabled = true;
  setSttUi(false, "음성 인식 미지원");
}

function stopRecognition() {
  manuallyStopped = true;
  clearTimeout(restartTimer);
  if (SR && recognizing) { try { recognition.stop(); } catch (e) {} }
  recognizing = false;
  setSttUi(false);
}

/* --------------------------- 문항 출제 --------------------------- */
function drawQuestion() {
  const set = currentQuestionSet();
  if (!set.length) return;
  let idx, drawnCount;
  if (orderRandom) {
    if (pool.length === 0) refillPool();
    idx = pool.pop();
    drawnCount = set.length - pool.length;
  } else {
    idx = seqIndex % set.length;
    seqIndex += 1;
    drawnCount = idx + 1;
  }
  showQuestion(set, idx, drawnCount);
}

function prevQuestion() {
  const set = currentQuestionSet();
  if (orderRandom || current === null || !set.length) return;
  // seqIndex는 '다음에 출제할 위치'이므로 2를 빼야 직전 문항이 된다
  seqIndex = (seqIndex - 2 + set.length) % set.length;
  const idx = seqIndex;
  seqIndex += 1;
  showQuestion(set, idx, idx + 1);
}

function showQuestion(set, idx, drawnCount) {
  stopSpeaking();
  stopRecognition();
  current = set[idx];
  hasDrawn = true;
  drawBtn.textContent = "다음 문항 ▶";
  qnumEl.textContent = drawnCount + " / " + set.length;
  qtextEl.textContent = current.q;
  srcBadgeEl.style.display = "inline-block";
  srcBadgeEl.textContent = current.source;

  closeReveals();
  cardBtn.disabled = false;
  answerBtn.disabled = false;
  cardReadBtn.disabled = !ttsSupported;
  answerReadBtn.disabled = !ttsSupported;

  answerInputEl.value = "";
  answerInputEl.disabled = false;
  checkBtn.disabled = false;
  clearBtn.disabled = false;
  if (SR) sttBtn.disabled = false;
  checkResultEl.textContent = "";
  renderKeywordHints(null);
  resetTimerState();
  updatePrevBtn();
}

function updatePrevBtn() {
  // 순서대로 모드에서, 문항을 한 번이라도 뽑은 뒤에만 활성화
  prevBtn.disabled = orderRandom || current === null;
  prevBtn.title = orderRandom ? "무작위 모드에서는 사용할 수 없습니다" : "이전 문항";
}

function resetToEmpty() {
  stopSpeaking();
  stopRecognition();
  pool = [];
  seqIndex = 0;
  current = null;
  hasDrawn = false;
  drawBtn.textContent = "문항 뽑기";
  updateCountLabel();
  qnumEl.textContent = "문항을 뽑아주세요";
  qtextEl.textContent = "\"문항 뽑기\" 버튼을 눌러 시작하세요.";
  srcBadgeEl.style.display = "none";
  closeReveals();
  cardBtn.disabled = true;
  answerBtn.disabled = true;
  cardReadBtn.disabled = true;
  answerReadBtn.disabled = true;
  answerInputEl.value = "";
  answerInputEl.disabled = true;
  checkBtn.disabled = true;
  clearBtn.disabled = true;
  sttBtn.disabled = true;
  checkResultEl.textContent = "";
  keywordHintsEl.innerHTML = "";
  kwLabelEl.style.display = "none";
  resetTimerState();
  updatePrevBtn();
}

/* --------------------------- 이벤트 --------------------------- */
sourceFilterEl.addEventListener("change", () => {
  currentSource = sourceFilterEl.value;
  resetToEmpty();
});

drawBtn.addEventListener("click", drawQuestion);
prevBtn.addEventListener("click", prevQuestion);

orderSeg.addEventListener("click", (e) => {
  const btn = e.target.closest(".segBtn");
  if (!btn) return;
  const wantRandom = btn.dataset.order === "rand";
  if (wantRandom === orderRandom) return;
  orderRandom = wantRandom;
  orderSeg.querySelectorAll(".segBtn").forEach(b => b.classList.toggle("active", b === btn));
  pool = []; // 무작위로 전환 시 새로 섞음 (순서 모드는 seqIndex로 이어서 진행)
  updateCountLabel();
  updatePrevBtn();
});

$("speedSeg").addEventListener("click", (e) => {
  const btn = e.target.closest(".segBtn");
  if (btn) applyRate(parseFloat(btn.dataset.rate));
});

timerBtn.addEventListener("click", toggleTimer);
resetBtn.addEventListener("click", resetTimerState);

cardBtn.addEventListener("click", () => toggleReveal("card"));
answerBtn.addEventListener("click", () => toggleReveal("answer"));
cardReadBtn.addEventListener("click", () => toggleRead("card"));
answerReadBtn.addEventListener("click", () => toggleRead("answer"));

checkBtn.addEventListener("click", checkKeywords);
clearBtn.addEventListener("click", () => {
  answerInputEl.value = "";
  checkResultEl.textContent = "";
  renderKeywordHints(null);
  answerInputEl.focus();
});

sttBtn.addEventListener("click", () => {
  if (!SR) return;
  if (!recognizing) {
    manuallyStopped = false;
    try {
      recognition.start();
      recognizing = true;
      setSttUi(true);
    } catch (e) {}
  } else {
    stopRecognition();
  }
});

/* --------------------------- 단축키 --------------------------- */
// e.code를 쓰면 한글 입력 상태에서도 동일하게 동작한다
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT")) {
    if (e.code === "Escape") t.blur();
    return;
  }
  switch (e.code) {
    case "Space":      e.preventDefault(); toggleTimer(); break;
    case "KeyN":
    case "ArrowRight": e.preventDefault(); if (!drawBtn.disabled) drawQuestion(); break;
    case "KeyP":
    case "ArrowLeft":  e.preventDefault(); if (!prevBtn.disabled) prevQuestion(); break;
    case "Digit1":     e.preventDefault(); toggleReveal("card"); break;
    case "Digit2":     e.preventDefault(); toggleReveal("answer"); break;
    case "KeyR":       e.preventDefault(); if (current) resetTimerState(); break;
    case "Escape":     stopSpeaking(); stopRecognition(); break;
  }
});

/* -------------------- 모바일 오디오 잠금 해제 -------------------- */
// 모바일(삼성 인터넷/크롬)은 첫 사용자 조작 전에는 소리 재생이 차단된다.
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  getAudioCtx();
  if (ttsSupported) {
    try {
      const warm = new SpeechSynthesisUtterance(" ");
      warm.volume = 0;
      window.speechSynthesis.speak(warm);
    } catch (e) {}
    loadVoices();
  }
}
document.addEventListener("click", unlockAudio);
document.addEventListener("touchstart", unlockAudio);

/* ---------------------------- 시작 ---------------------------- */
applyRate(ttsRate);
updateReadButtons();
updateDisplay();
updateTimerBtn();

fetch("./questions.json")
  .then((res) => {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  })
  .then((data) => {
    QUESTIONS = data;
    allSources = Array.from(new Set(QUESTIONS.map((q) => q.source)));
    buildFilterOptions();
    updateCountLabel();
    refillPool();
    drawBtn.disabled = false;
  })
  .catch((err) => {
    countLabel.textContent = "문항 데이터를 불러오지 못했습니다. questions.json 파일이 같은 폴더에 있는지 확인해주세요.";
    console.error(err);
  });
