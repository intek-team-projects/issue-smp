// 질문은 데모 API 로 보낸다. 키·토큰은 이 화면에 없다(서버가 가진다).
const BASE = "https://issue.intekplus.dev/demo/api";
const MAX_HISTORY = 8; // 서버가 받는 대화 길이(최근 8개 메시지)
const STORE = "issue-rag-thread-v1"; // 이 브라우저에만 남는 대화(새로고침 대비)

// 첫 화면 추천 질문 — 데모 데이터로 정답이 확인된 질문(사내 종단 시험 문항)에서 골랐다
const SUGGESTIONS = [
  { cat: "유사 사례", color: "#0a6cff", q: "검사 범위 넓혔더니 생산량이 떨어져요, 예전에 어떻게 해결했어?" },
  { cat: "유사 사례", color: "#0a6cff", q: "MES 응답이 늦으면 검사 결과가 안 올라가는데 과거 사례랑 해결방안 알려줘" },
  { cat: "집계", color: "#12a37f", q: "고객사별 Critical 이슈 건수 상위 5개랑 공통 원인 알려줘" },
  { cat: "집계", color: "#12a37f", q: "2026년 월별 Critical 발생 건수 추이" },
  { cat: "품질·재발", color: "#e07a10", q: "검증 결과가 재발로 나온 이슈들의 주요 근본원인은?" },
  { cat: "품질·재발", color: "#e07a10", q: "종결된 이슈 중 목표 완료일보다 늦게 끝난 비율은?" },
];
const TOOL_NAMES = { issue_search_similar: "유사 사례 검색", issue_aggregate: "집계", issue_list: "목록 조회", issue_get: "상세 조회" };

const $ = (id) => document.getElementById(id);
const thread = $("thread"), q = $("q"), send = $("send"), welcome = $("welcome"), resetBtn = $("reset");
let turns = [];          // [{q, a, seconds, tools}] — 화면 복원·대화 기록의 원본
let busy = false;
let controller = null;   // 진행 중 요청 중지용

const ICON = {
  arrow: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M5 15V5a2 2 0 0 1 2-2h8" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M5 12l5 5 9-10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M7 11v9H4v-9h3zm0 0l4-8a2.5 2.5 0 0 1 2.5 2.5V9h5.2a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.5 20H7" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M17 13V4h3v9h-3zm0 0l-4 8a2.5 2.5 0 0 1-2.5-2.5V15H5.3a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.5 4H17" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>',
};

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 저장은 편의 기능이다 — 사생활 보호 모드 등에서 막혀도 화면은 그대로 동작해야 한다
function save() { try { localStorage.setItem(STORE, JSON.stringify(turns.slice(-30))); } catch { /* 무시 */ } }
function load() { try { return JSON.parse(localStorage.getItem(STORE) || "[]"); } catch { return []; } }

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

// 답변 속 이슈 ID(ISS-0901)를 누르면 그 이슈 상세를 묻는 버튼으로 바꾼다(코드·버튼 안은 건드리지 않는다)
function linkifyIds(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (/ISS-\d{3,5}/.test(n.nodeValue) && !n.parentElement.closest("code, pre, button"))
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((n) => {
    const frag = document.createDocumentFragment();
    let last = 0;
    n.nodeValue.replace(/ISS-\d{3,5}/g, (id, at) => {
      frag.append(n.nodeValue.slice(last, at));
      const b = document.createElement("button");
      b.type = "button"; b.className = "iss"; b.textContent = id; b.title = `${id} 상세 보기`;
      b.onclick = () => ask(`${id} 자세히 알려줘`);
      frag.append(b);
      last = at + id.length;
    });
    frag.append(n.nodeValue.slice(last));
    n.replaceWith(frag);
  });
}

// 마크다운 → 정화된 HTML(공개 화면이라 반드시 정화), 표는 가로 스크롤 틀로 감싼다
function render(md) {
  // **굵게** 바로 뒤에 한글 조사가 붙으면(예: **설계오류(23건)**와) 마크다운 규칙상 굵게로 인식되지 않아 별표가 보인다
  // — 먼저 <strong> 으로 바꿔 둔다(마크다운 안의 HTML 은 그대로 통과하고, 아래에서 정화된다)
  md = md.replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, "<strong>$1</strong>");
  const holder = document.createElement("div");
  holder.className = "answer";
  holder.innerHTML = DOMPurify.sanitize(marked.parse(md));
  holder.querySelectorAll("table").forEach((t) => {
    const w = document.createElement("div");
    w.className = "table-wrap";
    t.replaceWith(w);
    w.appendChild(t);
  });
  holder.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
  linkifyIds(holder);
  return holder;
}

function toolSummary(tools) {
  if (!tools || !tools.length) return "";
  const c = {};
  tools.forEach((t) => { const n = TOOL_NAMES[t] || "조회"; c[n] = (c[n] || 0) + 1; });
  return Object.entries(c).map(([n, k]) => `${n} ${k}회`).join(" · ");
}

function showConversation(on) { welcome.hidden = on; resetBtn.hidden = !on; }

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
    <div class="loading"><img src="assets/spinner.svg" alt="" width="26" height="26"><span>이슈관리대장을 조회하고 있어요</span></div>
    <div class="skeleton" aria-hidden="true"><i></i><i></i><i></i></div></div>`;
  thread.appendChild(row);
  row.scrollIntoView({ behavior: "smooth", block: "end" });
  return row.querySelector(".bot-body");
}

function showAnswer(body, turn, scroll = true) {
  const { body: md, followups } = splitFollowups(turn.a);
  body.innerHTML = "";
  body.appendChild(render(md));
  const meta = document.createElement("div");
  meta.className = "bot-meta";
  const used = toolSummary(turn.tools);
  meta.innerHTML = `
    <button type="button" class="ghost-btn copy" title="복사">${ICON.copy}<span>복사</span></button>
    <button type="button" class="ghost-btn rate" data-r="up" title="도움이 됐어요" aria-label="도움이 됐어요">${ICON.up}</button>
    <button type="button" class="ghost-btn rate" data-r="down" title="아쉬워요" aria-label="아쉬워요">${ICON.down}</button>
    <span class="meta-text">${used ? esc(used) + " · " : ""}${turn.seconds}초</span>`;
  body.appendChild(meta);
  meta.querySelector(".copy").onclick = async (e) => {
    const btn = e.currentTarget;
    try {
      await navigator.clipboard.writeText(md);
      btn.innerHTML = `${ICON.check}<span>복사됨</span>`;
      setTimeout(() => { btn.innerHTML = `${ICON.copy}<span>복사</span>`; }, 1600);
    } catch { /* 클립보드 권한이 없으면 조용히 넘어간다 */ }
  };
  meta.querySelectorAll(".rate").forEach((b) => { b.onclick = () => rate(body, turn, b.dataset.r); });
  if (turn.rating) meta.querySelector(`.rate[data-r="${turn.rating}"]`).classList.add("on");
  if (followups.length) {
    const box = document.createElement("div");
    box.className = "followups";
    box.innerHTML = '<span class="label">이어서 물어보기</span>';
    followups.forEach((f) => {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "chip";
      c.innerHTML = `<span>${esc(f)}</span>${ICON.arrow}`;
      c.onclick = () => ask(f);
      box.appendChild(c);
    });
    body.appendChild(box);
  }
  // 긴 답변은 맨 아래가 아니라 답변 첫머리부터 읽게 한다
  if (scroll) body.closest(".turn-bot").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function postFeedback(turn, rating, comment = "") {
  try {
    await fetch(`${BASE}/feedback`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: turn.q, answer: turn.a.slice(0, 300), rating, comment }),
    });
  } catch { /* 평가 전송 실패는 사용자 흐름을 막지 않는다 */ }
}

function rate(body, turn, r) {
  const meta = body.querySelector(".bot-meta");
  meta.querySelectorAll(".rate").forEach((b) => b.classList.toggle("on", b.dataset.r === r));
  turn.rating = r;
  save();
  body.querySelector(".fb-form")?.remove();
  if (r === "up") { postFeedback(turn, "up"); toast("의견 감사합니다"); return; }
  const form = document.createElement("form");
  form.className = "fb-form";
  form.innerHTML = `<input type="text" maxlength="500" placeholder="어떤 점이 아쉬웠나요? (선택)" aria-label="아쉬운 점">
    <button type="submit" class="ghost-btn">보내기</button>`;
  meta.after(form);
  const input = form.querySelector("input");
  input.focus();
  form.onsubmit = (e) => { e.preventDefault(); postFeedback(turn, "down", input.value); form.remove(); toast("의견 감사합니다"); };
}

let toastTimer;
function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

function showError(body, msg, retryText) {
  body.innerHTML = `<div class="error"><span>${esc(msg)}</span>
    <button type="button" class="ghost-btn">다시 시도</button></div>`;
  body.querySelector("button").onclick = () => {
    const row = body.closest(".turn-bot");
    row.previousElementSibling.remove();
    row.remove();
    ask(retryText);
  };
}

function setBusy(b) {
  busy = b;
  send.innerHTML = b ? ICON.stop : ICON.send;
  send.setAttribute("aria-label", b ? "중지" : "보내기");
  send.classList.toggle("stop", b);
  updateSend();
}

function history() {
  return turns.flatMap((t) => [{ role: "user", content: t.q }, { role: "assistant", content: t.a }]).slice(-MAX_HISTORY);
}

async function ask(text) {
  text = text.trim();
  if (!text || busy) return;
  setBusy(true);
  showConversation(true);
  addUser(text);
  const body = addBot();
  const label = body.querySelector(".loading span");
  const t0 = Date.now();
  const steps = ["이슈관리대장을 조회하고 있어요", "비슷한 사례와 원인을 정리하고 있어요", "근거를 확인하며 답변을 쓰고 있어요"];
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    label.textContent = `${steps[Math.min(steps.length - 1, Math.floor(s / 8))]} · ${s}초`;
  }, 1000);
  controller = new AbortController();
  try {
    const r = await fetch(`${BASE}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: text, history: history() }),
      signal: controller.signal,
    });
    const d = await r.json().catch(() => ({ error: "응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요." }));
    if (!r.ok || d.error) throw new Error(d.error || `오류가 발생했습니다(${r.status}).`);
    const turn = { q: text, a: d.answer, seconds: d.seconds, tools: d.tools || [] };
    turns.push(turn);
    save();
    showAnswer(body, turn);
  } catch (e) {
    if (e.name === "AbortError") {
      body.innerHTML = '<div class="stopped">답변을 중지했습니다.</div>';
    } else {
      const msg = e instanceof TypeError ? "서버에 연결하지 못했습니다. 네트워크를 확인해 주세요." : e.message;
      showError(body, msg, text);
    }
  } finally {
    clearInterval(timer);
    controller = null;
    setBusy(false);
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
function updateSend() { send.disabled = !busy && !q.value.trim(); }
q.addEventListener("input", () => { autosize(); updateSend(); });
q.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("f").requestSubmit(); }
});
$("f").onsubmit = (e) => {
  e.preventDefault();
  if (busy) { controller?.abort(); return; }   // 진행 중이면 보내기 버튼이 중지 버튼이다
  const text = q.value;
  if (!text.trim()) return;
  q.value = "";
  autosize();
  ask(text);
};
// 단축키: '/' 입력창으로 · Esc 답변 중지
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== q && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); }
  if (e.key === "Escape" && busy) controller?.abort();
});
resetBtn.onclick = () => {
  if (busy) controller?.abort();
  turns = [];
  save();
  thread.innerHTML = "";
  showConversation(false);
  q.focus();
};

// 새로고침해도 이전 대화를 이어서 보여 준다
turns = load();
if (turns.length) {
  showConversation(true);
  turns.forEach((t) => { addUser(t.q); showAnswer(addBot(), t, false); });
  thread.lastElementChild?.scrollIntoView({ block: "end" });
}
q.focus();
