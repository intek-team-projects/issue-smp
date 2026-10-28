// 질문은 데모 API 로 보낸다. 키·토큰은 이 화면에 없다(서버가 가진다).
const API = "https://issue.intekplus.dev/demo/api/ask";
const MAX_HISTORY = 8; // 서버가 받는 대화 길이(최근 8개 메시지)

// 첫 화면 추천 질문 — 데모 데이터로 정답이 확인된 질문(사내 종단 시험 문항)에서 골랐다
const SUGGESTIONS = [
  { cat: "유사 사례", color: "#0a6cff", q: "검사 범위 넓혔더니 생산량이 떨어져요, 예전에 어떻게 해결했어?" },
  { cat: "유사 사례", color: "#0a6cff", q: "MES 응답이 늦으면 검사 결과가 안 올라가는데 과거 사례랑 해결방안 알려줘" },
  { cat: "집계", color: "#12a37f", q: "고객사별 Critical 이슈 건수 상위 5개랑 공통 원인 알려줘" },
  { cat: "집계", color: "#12a37f", q: "2026년 월별 Critical 발생 건수 추이" },
  { cat: "품질·재발", color: "#e07a10", q: "검증 결과가 재발로 나온 이슈들의 주요 근본원인은?" },
  { cat: "품질·재발", color: "#e07a10", q: "종결된 이슈 중 목표 완료일보다 늦게 끝난 비율은?" },
];

const $ = (id) => document.getElementById(id);
const thread = $("thread"), q = $("q"), send = $("send"), welcome = $("welcome"), resetBtn = $("reset");
let history = [];
let busy = false;

const ICON_ARROW = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M5 15V5a2 2 0 0 1 2-2h8" stroke="currentColor" stroke-width="2" fill="none"/></svg>';

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 답변 끝의 '이어서 볼 만한 질문' 목록을 떼어 버튼으로 보여 준다
function splitFollowups(md) {
  const lines = md.split("\n");
  const idx = lines.findIndex((l) => /(이어서|추천|다음으로|더 볼 만한|함께 볼 만한).{0,12}질문/.test(l));
  if (idx < 0) return { body: md, followups: [] };
  const followups = [];
  for (const l of lines.slice(idx + 1)) {
    const m = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+?)\s*$/);
    if (m) followups.push(m[1].replace(/\*\*/g, "").replace(/^["'「“]|["'」”]$/g, "").trim());
    else if (l.trim() && followups.length) break;
  }
  if (!followups.length) return { body: md, followups: [] };
  return { body: lines.slice(0, idx).join("\n").trimEnd(), followups: followups.slice(0, 3) };
}

// 마크다운 → 정화된 HTML(공개 화면이라 반드시 정화), 표는 가로 스크롤 틀로 감싼다
function render(md) {
  // **굵게** 바로 뒤에 한글 조사가 붙으면(예: **설계오류(23건)**와) 마크다운 규칙상 굵게로 인식되지 않아 별표가 보인다
  // — 먼저 <strong> 으로 바꿔 둔다(마크다운 안의 HTML 은 그대로 통과하고, 아래에서 정화된다)
  md = md.replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, "<strong>$1</strong>");
  const holder = document.createElement("div");
  holder.innerHTML = DOMPurify.sanitize(marked.parse(md));
  holder.querySelectorAll("table").forEach((t) => {
    const w = document.createElement("div");
    w.className = "table-wrap";
    t.replaceWith(w);
    w.appendChild(t);
  });
  holder.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
  return holder.innerHTML;
}

function startConversation() {
  welcome.hidden = true;
  resetBtn.hidden = false;
}

function addUser(text) {
  const row = document.createElement("div");
  row.className = "turn-user";
  row.innerHTML = `<div class="bubble">${esc(text)}</div>`;
  thread.appendChild(row);
}

function addBot() {
  const row = document.createElement("div");
  row.className = "turn-bot";
  row.innerHTML = `<span class="avatar" aria-hidden="true"></span><div class="bot-body">
    <div class="loading"><img src="assets/spinner.svg" alt="" width="26" height="26"><span>이슈관리대장을 조회하고 있어요</span></div></div>`;
  thread.appendChild(row);
  row.scrollIntoView({ behavior: "smooth", block: "end" });
  return row.querySelector(".bot-body");
}

function showAnswer(body, answer, seconds) {
  const { body: md, followups } = splitFollowups(answer);
  body.innerHTML = `<div class="answer">${render(md)}</div>
    <div class="bot-meta">
      <button type="button" class="ghost-btn copy">${ICON_COPY}<span>복사</span></button>
      <span>· ${seconds}초</span>
    </div>`;
  body.querySelector(".copy").onclick = async (e) => {
    try {
      await navigator.clipboard.writeText(md);
      e.currentTarget.querySelector("span").textContent = "복사됨";
    } catch { /* 클립보드 권한이 없으면 조용히 넘어간다 */ }
  };
  if (followups.length) {
    const box = document.createElement("div");
    box.className = "followups";
    box.innerHTML = '<span class="label">이어서 물어보기</span>';
    followups.forEach((f) => {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "chip";
      c.innerHTML = `<span>${esc(f)}</span>${ICON_ARROW}`;
      c.onclick = () => ask(f);
      box.appendChild(c);
    });
    body.appendChild(box);
  }
}

function showError(body, msg, retryText) {
  body.innerHTML = `<div class="error"><span>${esc(msg)}</span>
    <button type="button" class="ghost-btn">다시 시도</button></div>`;
  body.querySelector("button").onclick = () => { body.closest(".turn-bot").previousElementSibling.remove(); body.closest(".turn-bot").remove(); ask(retryText); };
}

async function ask(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  updateSend();
  startConversation();
  addUser(text);
  const body = addBot();
  const label = body.querySelector(".loading span");
  const t0 = Date.now();
  const steps = ["이슈관리대장을 조회하고 있어요", "비슷한 사례와 원인을 정리하고 있어요", "근거를 확인하며 답변을 쓰고 있어요"];
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    label.textContent = `${steps[Math.min(steps.length - 1, Math.floor(s / 8))]} · ${s}초`;
  }, 1000);
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: text, history: history.slice(-MAX_HISTORY) }),
    });
    const d = await r.json().catch(() => ({ error: "응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요." }));
    if (!r.ok || d.error) throw new Error(d.error || `오류가 발생했습니다(${r.status}).`);
    showAnswer(body, d.answer, d.seconds);
    history.push({ role: "user", content: text }, { role: "assistant", content: d.answer });
  } catch (e) {
    const msg = e instanceof TypeError ? "서버에 연결하지 못했습니다. 네트워크를 확인해 주세요." : e.message;
    showError(body, msg, text);
  } finally {
    clearInterval(timer);
    busy = false;
    updateSend();
    q.focus();
  }
}

// 첫 화면 추천 질문 카드
SUGGESTIONS.forEach((s) => {
  const c = document.createElement("button");
  c.type = "button";
  c.className = "card";
  c.setAttribute("role", "listitem");
  c.innerHTML = `<span class="cat"><i style="background:${s.color}"></i>${esc(s.cat)}</span><span class="txt">${esc(s.q)}</span>`;
  c.onclick = () => ask(s.q);
  $("suggest").appendChild(c);
});

// 입력창: 내용만큼 늘어나고, Enter 보내기 · Shift+Enter 줄바꿈(한글 조합 중 Enter 는 무시)
function autosize() { q.style.height = "auto"; q.style.height = Math.min(q.scrollHeight, 200) + "px"; }
function updateSend() { send.disabled = busy || !q.value.trim(); }
q.addEventListener("input", () => { autosize(); updateSend(); });
q.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("f").requestSubmit(); }
});
$("f").onsubmit = (e) => {
  e.preventDefault();
  const text = q.value;
  if (!text.trim() || busy) return;
  q.value = "";
  autosize();
  ask(text);
};
resetBtn.onclick = () => {
  if (busy) return;
  history = [];
  thread.innerHTML = "";
  welcome.hidden = false;
  resetBtn.hidden = true;
  q.focus();
};
q.focus();
