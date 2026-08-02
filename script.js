
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

let remaining = TOTAL_SECONDS;
let timerId = null;
let running = false;
let warned30 = false;

const sourceFilterEl = document.getElementById("sourceFilter");
const countLabel = document.getElementById("countLabel");
const qnumEl = document.getElementById("qnum");
const qtextEl = document.getElementById("qtext");
const srcBadgeEl = document.getElementById("srcBadge");
const phaseEl = document.getElementById("phaseLabel");
const timeEl = document.getElementById("timeLabel");
const barEl = document.getElementById("bar");
const drawBtn = document.getElementById("drawBtn");
const prevBtn = document.getElementById("prevBtn");
const orderBtn = document.getElementById("orderBtn");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");
const cardBtn = document.getElementById("cardBtn");
const cardReadBtn = document.getElementById("cardReadBtn");
const cardBox = document.getElementById("cardBox");
const answerBtn = document.getElementById("answerBtn");
const answerReadBtn = document.getElementById("answerReadBtn");
const answerBox = document.getElementById("answerBox");
const stopBtn = document.getElementById("stopBtn");
const autoReadChk = document.getElementById("autoReadChk");
const nowReadingEl = document.getElementById("nowReading");
const kwLabelEl = document.getElementById("kwLabel");
const keywordHintsEl = document.getElementById("keywordHints");
const answerInputEl = document.getElementById("answerInput");
const checkBtn = document.getElementById("checkBtn");
const sttBtn = document.getElementById("sttBtn");
const clearBtn = document.getElementById("clearBtn");
const checkResultEl = document.getElementById("checkResult");

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
const hasCard = (it) => cardCoreOf(it).length > 0 || cardRespOf(it).length > 0;

function buildFilterOptions() {
  sourceFilterEl.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "전체";
  optAll.textContent = "전체 문항 (" + QUESTIONS.length + "문항)";
  sourceFilterEl.appendChild(optAll);
  allSources.forEach(src => {
    const cnt = QUESTIONS.filter(q => q.source === src).length;
    const opt = document.createElement("option");
    opt.value = src;
    opt.textContent = src + " (" + cnt + "문항)";
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
  const how = orderRandom ? "무작위 출제" : "순서대로 출제";
  countLabel.textContent = "선택된 범위: " + currentSource + " · 총 " + set.length + "문항 " + how;
}

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

/* ------------------------------ TTS ------------------------------ */
const ttsSupported = "speechSynthesis" in window;

let koVoice = null;
let ttsRate = 0.8;
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

let speakQueue = [];
let speakingNow = null;
let speakingLabel = "";

function speakSequence(chunks, label) {
  if (!ttsSupported || !chunks.length) return;
  window.speechSynthesis.cancel();
  speakQueue = chunks.slice();
  speakingLabel = label || "";
  stopBtn.disabled = false;
  nowReadingEl.textContent = speakingLabel ? "읽는 중: " + speakingLabel : "";
  const next = () => {
    if (!speakQueue.length) { finishSpeaking(); return; }
    speakingNow = speakQueue.shift();
    const u = makeUtter(speakingNow);
    u.onend = next;
    u.onerror = () => finishSpeaking();
    window.speechSynthesis.speak(u);
  };
  next();
}

function finishSpeaking() {
  speakQueue = [];
  speakingNow = null;
  stopBtn.disabled = true;
  nowReadingEl.textContent = "";
}

// 배속을 바꾸면 읽던 문장부터 새 속도로 이어서 다시 읽는다
function applyRate(rate) {
  ttsRate = rate;
  document.querySelectorAll(".speedBtn").forEach(b => {
    b.classList.toggle("active", parseFloat(b.dataset.rate) === rate);
  });
  const isSpeaking = ttsSupported && (window.speechSynthesis.speaking || window.speechSynthesis.pending);
  if (isSpeaking && speakingNow) {
    speakSequence([speakingNow].concat(speakQueue), speakingLabel);
  }
}

function stopSpeaking() {
  speakQueue = [];
  speakingNow = null;
  if (ttsSupported) window.speechSynthesis.cancel();
  stopBtn.disabled = true;
  nowReadingEl.textContent = "";
}

// ① 요약 카드 읽기: 문제 → 핵심정리 항목 → 대응방안 항목
function speakCard(item) {
  if (!ttsSupported || !item) return;
  const parts = splitForSpeech(item.q);
  const core = cardCoreOf(item);
  const resp = cardRespOf(item);
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

// ② 모범답안 읽기: 문제 → 구술형 전문
function speakAnswer(item) {
  if (!ttsSupported || !item) return;
  const parts = splitForSpeech(item.q);
  parts.push.apply(parts, splitForSpeech(answerFullOf(item)));
  speakSequence(parts, "모범답안");
}

if (!ttsSupported) {
  autoReadChk.checked = false;
  autoReadChk.disabled = true;
  document.querySelector(".ttsRow label").textContent = "이 브라우저는 음성 읽기(TTS)를 지원하지 않습니다.";
  cardReadBtn.title = answerReadBtn.title = "이 브라우저는 음성 읽기를 지원하지 않습니다.";
}

/* --------------------------- 렌더링 --------------------------- */
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

function bulletColumn(title, cls, items) {
  return '<div class="sumCol ' + cls + '">'
    + '<div class="sumHead ' + cls + '">' + title + '</div>'
    + '<ul class="sumList">' + items.map(b => "<li>" + esc(b) + "</li>").join("") + "</ul>"
    + "</div>";
}

// ① 요약 카드 — 짧은 항목 2단
function renderCard(item) {
  const core = cardCoreOf(item);
  const resp = cardRespOf(item);
  if (!core.length && !resp.length) {
    cardBox.innerHTML = '<div class="placeholder">이 문항에는 요약 카드 자료가 없습니다. 모범답안을 확인해주세요.</div>';
    return;
  }
  let html = '<div class="sumGrid">';
  if (core.length) html += bulletColumn("핵심정리", "core", core);
  if (resp.length) html += bulletColumn("대응방안", "resp", resp);
  html += "</div>";
  cardBox.innerHTML = html;
}

// ② 모범답안 — 구술형 문장
function renderAnswer(item) {
  const core = answerCoreOf(item);
  const resp = answerRespOf(item);
  let html = "";
  if (core) {
    html += '<div class="ansSec"><div class="ansHead core">■ 핵심정리</div>'
      + '<div class="ansBody">' + esc(core) + "</div></div>";
  }
  if (resp) {
    html += '<div class="ansSec"><div class="ansHead resp">■ 대응방안</div>'
      + '<div class="ansBody">' + esc(resp) + "</div></div>";
  }
  if (!html) {
    const full = answerFullOf(item);
    html = full
      ? '<div class="ansBody">' + esc(full) + "</div>"
      : '<div class="placeholder">이 문항에는 모범답안 자료가 없습니다.</div>';
  }
  answerBox.innerHTML = html;
}

function closeReveals() {
  cardBox.classList.remove("show");
  cardBox.innerHTML = "";
  cardBtn.textContent = "요약 카드 보기";
  answerBox.classList.remove("show");
  answerBox.innerHTML = "";
  answerBtn.textContent = "모범답안 보기";
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
  const pct = Math.max(0, (remaining / TOTAL_SECONDS) * 100);
  barEl.style.width = pct + "%";

  const stage = currentStage();
  timeEl.classList.remove("answer", "urgent");
  barEl.classList.remove("answer", "urgent");

  if (stage === "done") {
    phaseEl.textContent = "종료";
    phaseEl.className = "phase done";
  } else if (stage === "urgent") {
    timeEl.classList.add("urgent");
    barEl.classList.add("urgent");
    phaseEl.textContent = "답변 중 (종료 임박)";
    phaseEl.className = "phase urgent";
  } else if (stage === "answer") {
    timeEl.classList.add("answer");
    barEl.classList.add("answer");
    phaseEl.textContent = "답변 중";
    phaseEl.className = "phase answer";
  } else {
    phaseEl.textContent = "구상 중";
    phaseEl.className = "phase";
  }
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
    ? ("핵심 키워드 " + kws.length + "개 중 " + matchedSet.size + "개 포함 (" + pct + "%)")
    : "이 문항에는 등록된 키워드가 없습니다.";
}

/* --------------------------- 음성 인식 --------------------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recognizing = false;
let manuallyStopped = true;
let restartTimer = null;

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
      sttBtn.textContent = "마이크 권한을 허용해주세요";
    }
    // other errors (no-speech, network, aborted) are recovered from in onend below
  };
  r.onend = () => {
    if (recognizing && !manuallyStopped) {
      // Chrome ends the recognition session after ~60s even in continuous mode;
      // if the user never asked to stop, transparently restart so it feels continuous.
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        try { recognition.start(); } catch (e) {}
      }, 250);
    } else {
      recognizing = false;
      sttBtn.textContent = "음성으로 답변 인식 시작";
      checkKeywords();
    }
  };
  return r;
}

if (SR) {
  recognition = attachRecognitionHandlers(new SR());
} else {
  sttBtn.disabled = true;
  sttBtn.textContent = "음성 인식 미지원 브라우저";
}

function stopRecognition() {
  manuallyStopped = true;
  clearTimeout(restartTimer);
  if (SR && recognizing) {
    try { recognition.stop(); } catch (e) {}
  }
  recognizing = false;
  sttBtn.textContent = "음성으로 답변 인식 시작";
}

/* --------------------------- 문항 출제 --------------------------- */
function drawQuestion() {
  const set = currentQuestionSet();
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
  if (orderRandom || current === null) return;
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
  qnumEl.textContent = "문항 (" + drawnCount + " / " + set.length + ")";
  qtextEl.textContent = current.q;
  srcBadgeEl.style.display = "inline-block";
  srcBadgeEl.textContent = "출처: " + current.source;

  closeReveals();
  cardBtn.disabled = false;
  cardReadBtn.disabled = !ttsSupported;
  answerBtn.disabled = false;
  answerReadBtn.disabled = !ttsSupported;
  stopBtn.disabled = true;

  answerInputEl.value = "";
  answerInputEl.disabled = false;
  checkBtn.disabled = false;
  clearBtn.disabled = false;
  if (SR) sttBtn.disabled = false;
  checkResultEl.textContent = "";
  renderKeywordHints(null);
  resetTimerState();
  startBtn.disabled = false;
  resetBtn.disabled = false;
  updatePrevBtn();
}

function updatePrevBtn() {
  // 순서대로 모드에서, 문항을 한 번이라도 뽑은 뒤에만 활성화
  prevBtn.disabled = orderRandom || current === null;
}

function resetTimerState() {
  clearInterval(timerId);
  timerId = null;
  running = false;
  remaining = TOTAL_SECONDS;
  warned30 = false;
  updateDisplay();
  startBtn.disabled = current === null;
  startBtn.textContent = "시작";
  pauseBtn.disabled = true;
  pauseBtn.textContent = "일시정지";
}

function tick() {
  remaining -= 1;
  if (remaining === COLOR_SWITCH_AT) {
    beep(660, 180);
  }
  if (remaining === URGENT_AT && !warned30) {
    beep(880, 250);
    warned30 = true;
  }
  if (remaining <= 0) {
    clearInterval(timerId);
    timerId = null;
    running = false;
    beep(523, 200);
    setTimeout(() => beep(523, 200), 300);
    startBtn.disabled = true;
    pauseBtn.disabled = true;
  }
  updateDisplay();
}

/* --------------------------- 이벤트 --------------------------- */
sourceFilterEl.addEventListener("change", () => {
  stopSpeaking();
  stopRecognition();
  currentSource = sourceFilterEl.value;
  pool = [];
  seqIndex = 0;
  current = null;
  updateCountLabel();
  qnumEl.textContent = "문항을 뽑아주세요";
  qtextEl.textContent = "\"문항 뽑기\" 버튼을 눌러 시작하세요.";
  srcBadgeEl.style.display = "none";
  closeReveals();
  cardBtn.disabled = true;
  cardReadBtn.disabled = true;
  answerBtn.disabled = true;
  answerReadBtn.disabled = true;
  stopBtn.disabled = true;
  answerInputEl.value = "";
  answerInputEl.disabled = true;
  checkBtn.disabled = true;
  clearBtn.disabled = true;
  sttBtn.disabled = true;
  checkResultEl.textContent = "";
  keywordHintsEl.innerHTML = "";
  kwLabelEl.style.display = "none";
  resetTimerState();
  startBtn.disabled = true;
  resetBtn.disabled = true;
  updatePrevBtn();
});

drawBtn.addEventListener("click", drawQuestion);

orderBtn.addEventListener("click", () => {
  orderRandom = !orderRandom;
  orderBtn.textContent = orderRandom ? "출제: 무작위" : "출제: 순서대로";
  pool = []; // 무작위 모드로 전환 시 새로 섞음 (순서 모드는 seqIndex로 이어서 진행)
  updateCountLabel();
  updatePrevBtn();
});

prevBtn.addEventListener("click", prevQuestion);

document.querySelectorAll(".speedBtn").forEach(btn => {
  btn.addEventListener("click", () => applyRate(parseFloat(btn.dataset.rate)));
});
applyRate(ttsRate); // 기본값(0.8배) 활성 표시

startBtn.addEventListener("click", () => {
  if (!timerId && remaining > 0) {
    timerId = setInterval(tick, 1000);
    running = true;
    startBtn.disabled = true;
    pauseBtn.disabled = false;
  }
});

pauseBtn.addEventListener("click", () => {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
    running = false;
    startBtn.disabled = false;
    startBtn.textContent = "계속";
    pauseBtn.disabled = true;
  }
});

resetBtn.addEventListener("click", () => {
  resetTimerState();
});

// ① 요약 카드 토글
cardBtn.addEventListener("click", () => {
  if (current === null) return;
  const showing = !cardBox.classList.contains("show");
  if (showing) renderCard(current);
  cardBox.classList.toggle("show", showing);
  cardBtn.textContent = showing ? "요약 카드 숨기기" : "요약 카드 보기";
  if (showing && autoReadChk.checked) speakCard(current);
  if (!showing && speakingLabel === "요약 카드") stopSpeaking();
});

cardReadBtn.addEventListener("click", () => {
  if (current !== null) speakCard(current);
});

// ② 모범답안 토글
answerBtn.addEventListener("click", () => {
  if (current === null) return;
  const showing = !answerBox.classList.contains("show");
  if (showing) renderAnswer(current);
  answerBox.classList.toggle("show", showing);
  answerBtn.textContent = showing ? "모범답안 숨기기" : "모범답안 보기";
  if (showing && autoReadChk.checked) speakAnswer(current);
  if (!showing && speakingLabel === "모범답안") stopSpeaking();
});

answerReadBtn.addEventListener("click", () => {
  if (current !== null) speakAnswer(current);
});

stopBtn.addEventListener("click", () => {
  stopSpeaking();
});

checkBtn.addEventListener("click", () => {
  checkKeywords();
});

clearBtn.addEventListener("click", () => {
  answerInputEl.value = "";
  checkResultEl.textContent = "";
  renderKeywordHints(null);
});

sttBtn.addEventListener("click", () => {
  if (!SR) return;
  if (!recognizing) {
    manuallyStopped = false;
    try {
      recognition.start();
      recognizing = true;
      sttBtn.textContent = "인식 중지 (듣는 중...)";
    } catch (e) {}
  } else {
    stopRecognition();
  }
});

// 모바일(삼성 인터넷/크롬)은 첫 사용자 조작 전에는 소리 재생이 차단된다.
// 아무 버튼이나 처음 누를 때 오디오와 TTS 엔진을 한 번 깨워둔다.
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
document.addEventListener("click", unlockAudio, { once: false });
document.addEventListener("touchstart", unlockAudio, { once: false });

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
