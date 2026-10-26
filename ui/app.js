"use strict";

// ---------------------------------------------------------------- API
const TOKEN = (() => {
  const t = new URLSearchParams(location.search).get("t");
  try { if (t) sessionStorage.setItem("od-token", t); return t || sessionStorage.getItem("od-token"); }
  catch { return t; }
})();

async function api(path, body) {
  const res = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-Token": TOKEN || "", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};

let S = null;          // settings
let C = null;          // cleaning
let history = [];
let lastSeq = 0;
let live = { status: "loading" };
let ollamaModels = null;
let cpuShare = 0;

// ---------------------------------------------------------------- Speichern
let savedTimer;
function flashSaved() {
  const s = $("#saved");
  s.classList.add("on");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => s.classList.remove("on"), 1200);
}
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
const saveCleaning = debounce(async () => { await api("cleaning", C); flashSaved(); }, 500);
const saveSettings = debounce(async () => { await api("settings", S); flashSaved(); }, 300);

// ---------------------------------------------------------------- Navigation
function showPage() {
  const page = (location.hash || "#home").slice(1);
  $$(".page").forEach(p => p.classList.toggle("active", p.id === "page-" + page));
  $$(".side a").forEach(a => a.classList.toggle("active", a.dataset.page === page));
  if (!$(".page.active")) location.hash = "#home";
}
window.addEventListener("hashchange", showPage);

// ---------------------------------------------------------------- Hilfen
const KEY_LABELS = {
  "right ctrl": "Strg rechts", "left ctrl": "Strg links", "ctrl": "Strg",
  "right shift": "Umschalt rechts", "left shift": "Umschalt links", "shift": "Umschalt",
  "right alt": "Alt Gr", "left alt": "Alt", "alt": "Alt", "alt gr": "Alt Gr",
  "windows": "Win", "left windows": "Win", "right windows": "Win rechts",
  "space": "Leertaste", "caps lock": "Feststell", "tab": "Tab", "menu": "Menü",
};
const hotkeyLabel = hk => hk.split("+").map(k => KEY_LABELS[k.trim()] || k.trim().toUpperCase()).join(" + ");

const fmtTime = ts => new Date(ts * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const fmtDay = ts => {
  const d = new Date(ts * 1000), now = new Date();
  if (d.toDateString() === now.toDateString()) return "Heute";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Gestern";
  return d.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
};
const fmtSec = s => s.toFixed(1).replace(".", ",") + " s";
const appName = p => (p || "").replace(/\.exe$/, "") || "unbekannt";

function autoGrow(t) {
  t.style.height = "auto";
  t.style.height = t.scrollHeight + 2 + "px";
}

// ---------------------------------------------------------------- Status
const STATUS_TEXT = {
  loading: "Lädt …", ready: "Bereit", recording: "Aufnahme", processing: "Verarbeite …", error: "Problem",
};

function renderStatus() {
  const st = live.status;
  $("#side-dot").className = "dot " + st;
  $("#side-status").textContent = STATUS_TEXT[st] || st;
  if (S) $("#side-hotkey").textContent = hotkeyLabel(S.hotkey) + " halten";

  const title = $("#home-title"), sub = $("#home-sub");
  if (st === "loading") {
    title.textContent = "Lädt …";
    sub.textContent = live.message || "Spracherkennung wird geladen. Beim ersten Start dauert das ein paar Minuten.";
  } else if (st === "recording") {
    title.textContent = "Ich höre zu";
    sub.textContent = "Lass die Taste los, wenn du fertig bist.";
  } else if (st === "processing") {
    title.textContent = "Verarbeite …";
    sub.textContent = "";
  } else if (st === "error") {
    title.textContent = "Es gibt ein Problem";
    sub.textContent = live.message || "";
  } else {
    title.textContent = "Bereit";
    sub.replaceChildren("Klick in ein Textfeld, halte ", el("kbd", { textContent: hotkeyLabel(S.hotkey) }),
      " gedrückt, sprich und lass los.", live.message ? " (" + live.message + ")" : "");
  }

  $("#ck-whisper").textContent = live.model_info || "lädt …";
  const llm = $("#ck-llm");
  llm.classList.remove("bad");
  if (!S.llm.enabled) llm.textContent = "aus";
  else if (ollamaModels === null) { llm.textContent = "Ollama nicht erreichbar. Läuft Ollama?"; llm.classList.add("bad"); }
  else if (!ollamaModels.includes(S.llm.model)) { llm.textContent = `${S.llm.model} ist nicht installiert. ollama pull ${S.llm.model}`; llm.classList.add("bad"); }
  else if (cpuShare > 0.05) {
    llm.textContent = `${S.llm.model} läuft zu ${Math.round(cpuShare * 100)} % auf dem Prozessor, weil der Grafikspeicher voll ist. `
      + "Das macht es mehrfach langsamer. Schließ andere Programme, die die Grafikkarte nutzen, oder wähl ein kleineres Modell.";
    llm.classList.add("bad");
  }
  else llm.textContent = S.llm.model + " · Ollama";
  const mic = $("#ck-mic");
  mic.textContent = live.mic || "keins gefunden";
  mic.classList.toggle("bad", !live.mic);
}

function renderStats() {
  const today = new Date().toDateString();
  const items = history.filter(h => new Date(h.ts * 1000).toDateString() === today);
  $("#st-count").textContent = items.length;
  $("#st-words").textContent = items.reduce((n, h) => n + h.text.split(/\s+/).filter(Boolean).length, 0);
  const recent = history.slice(-20);
  $("#st-latency").textContent = recent.length
    ? fmtSec(recent.reduce((n, h) => n + h.t_asr + h.t_llm, 0) / recent.length) : "–";
}

// ---------------------------------------------------------------- Verlauf
function entryNode(h) {
  const n = $("#tpl-entry").content.firstElementChild.cloneNode(true);
  $(".e-time", n).textContent = fmtDay(h.ts) + ", " + fmtTime(h.ts);
  $(".e-app", n).textContent = appName(h.app);
  $(".e-info", n).textContent = h.info || "";
  $(".e-text", n).textContent = h.text;
  $(".e-raw", n).textContent = h.raw;
  if (h.raw === h.text) $(".e-raw-toggle", n).remove();
  $(".e-copy", n).onclick = async e => {
    await api("copy", { text: h.text });
    e.target.textContent = "Kopiert";
    setTimeout(() => (e.target.textContent = "Kopieren"), 1200);
  };
  const rawToggle = $(".e-raw-toggle", n);
  if (rawToggle) rawToggle.onclick = () => {
    n.classList.toggle("show-raw");
    rawToggle.textContent = n.classList.contains("show-raw") ? "Gesagt ausblenden" : "Gesagt anzeigen";
  };
  const teach = $(".teach", n), ta = $("textarea", teach);
  $(".e-teach", n).onclick = () => {
    teach.hidden = false;
    n.classList.add("show-raw");
    ta.value = h.text;
    autoGrow(ta);
    ta.focus();
  };
  ta.oninput = () => autoGrow(ta);
  $(".e-cancel", n).onclick = () => { teach.hidden = true; };
  $(".e-save", n).onclick = () => {
    if (!ta.value.trim()) return;
    C.examples.push({ raw: h.raw, out: ta.value.trim() });
    saveCleaning();
    renderExamples();
    teach.hidden = true;
    $(".e-teach", n).textContent = "Gelernt";
  };
  return n;
}

function renderHistory() {
  const list = $("#history-list");
  list.replaceChildren(...history.slice().reverse().map(entryNode));
  if (!history.length) list.append(el("div", { className: "empty", textContent: "Noch nichts diktiert." }));
  const recent = $("#home-recent");
  recent.replaceChildren(...history.slice(-3).reverse().map(entryNode));
  if (!history.length) recent.append(el("div", { className: "empty", textContent: "Hier erscheinen deine letzten Diktate." }));
  renderStats();
}

$("#history-clear").onclick = async () => {
  if (!confirm("Ganzen Verlauf löschen? Gespeicherte Beispiele bleiben erhalten.")) return;
  await api("history/clear", {});
  history = [];
  renderHistory();
};

// ---------------------------------------------------------------- Bereinigung
function renderCleaning() {
  $$("[data-key]").forEach(node => {
    const key = node.dataset.key;
    if (node.classList.contains("seg")) {
      $$("button", node).forEach(b => b.classList.toggle("on", b.dataset.val === C[key]));
    } else node.checked = !!C[key];
  });
  $("#rules").value = C.rules || "";
  $("#default-style").value = C.default_style || "";
  renderExamples();
  renderStyles();
}

$$(".seg[data-key]").forEach(seg => seg.addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  C[seg.dataset.key] = b.dataset.val;
  $$("button", seg).forEach(x => x.classList.toggle("on", x === b));
  saveCleaning();
}));
$$("input[data-key]").forEach(i => i.addEventListener("change", () => { C[i.dataset.key] = i.checked; saveCleaning(); }));
$("#rules").addEventListener("input", e => { C.rules = e.target.value; saveCleaning(); });
$("#default-style").addEventListener("input", e => { C.default_style = e.target.value; saveCleaning(); });

function renderExamples() {
  const box = $("#examples");
  box.replaceChildren(...C.examples.map((ex, i) => {
    const raw = el("textarea", { className: "raw", rows: 1, value: ex.raw, spellcheck: false, placeholder: "äh also …" });
    const out = el("textarea", { rows: 1, value: ex.out, placeholder: "So soll es dastehen." });
    raw.oninput = () => { ex.raw = raw.value; autoGrow(raw); saveCleaning(); };
    out.oninput = () => { ex.out = out.value; autoGrow(out); saveCleaning(); };
    const del = el("button", { className: "x", title: "Beispiel löschen", textContent: "×" });
    del.onclick = () => { C.examples.splice(i, 1); saveCleaning(); renderExamples(); };
    return el("div", { className: "ex-row" }, raw, out, del);
  }));
  if (!C.examples.length) box.append(el("div", { className: "empty", textContent: "Noch keine Beispiele." }));
  requestAnimationFrame(() => $$("#examples textarea").forEach(autoGrow));
}
$("#ex-add").onclick = () => {
  C.examples.push({ raw: "", out: "" });
  renderExamples();
  $$("#examples .ex-row").at(-1).querySelector("textarea").focus();
};

function renderStyles() {
  $("#styles").replaceChildren(...C.app_styles.map((st, i) => {
    const apps = el("input", { type: "text", value: st.apps, placeholder: "discord.exe, whatsapp.exe", spellcheck: false });
    const hint = el("input", { type: "text", value: st.hint, placeholder: "Wie soll der Text klingen?" });
    apps.oninput = () => { st.apps = apps.value; saveCleaning(); };
    hint.oninput = () => { st.hint = hint.value; saveCleaning(); };
    const del = el("button", { className: "x", title: "Stil löschen", textContent: "×" });
    del.onclick = () => { C.app_styles.splice(i, 1); saveCleaning(); renderStyles(); };
    return el("div", { className: "style-row" }, apps, hint, del);
  }));
}
$("#style-add").onclick = () => { C.app_styles.push({ apps: "", hint: "" }); renderStyles(); };

// Ausprobieren
let lastTry = null;
$("#try-run").onclick = async () => {
  const raw = $("#try-in").value.trim();
  if (!raw) return $("#try-in").focus();
  const btn = $("#try-run"), out = $("#try-out");
  btn.disabled = true;
  out.textContent = "…";
  out.classList.add("muted");
  try {
    const r = await api("test", { raw, cleaning: C });
    out.textContent = r.text;
    out.classList.remove("muted");
    out.contentEditable = "plaintext-only";
    $("#try-meta").textContent = (r.ms / 1000).toFixed(2).replace(".", ",") + " s" + (r.info ? " · " + r.info : "");
    lastTry = { raw };
    $("#try-save").disabled = false;
  } catch {
    out.textContent = "Fehler bei der Anfrage.";
  } finally {
    btn.disabled = false;
  }
};
$("#try-in").addEventListener("keydown", e => { if (e.key === "Enter" && e.ctrlKey) $("#try-run").click(); });
$("#try-save").onclick = () => {
  const out = $("#try-out").innerText.trim();
  if (!lastTry || !out) return;
  C.examples.push({ raw: lastTry.raw, out });
  $("#try-meta").textContent = "Als Beispiel gespeichert";
  lastTry = null;
  $("#try-save").disabled = true;
  saveCleaning();
  renderExamples();
};

// ---------------------------------------------------------------- Wörterbuch
function renderDictionary() {
  $("#dict-list").replaceChildren(...S.dictionary.map((w, i) => {
    const b = el("button", { title: "Entfernen", textContent: "×" });
    b.onclick = () => { S.dictionary.splice(i, 1); saveSettings(); renderDictionary(); };
    return el("span", { className: "chip" }, w, b);
  }));
  if (!S.dictionary.length) $("#dict-list").append(el("div", { className: "muted", textContent: "Noch keine Begriffe." }));
}
$("#dict-form").onsubmit = e => {
  e.preventDefault();
  const v = $("#dict-input").value.trim();
  if (v && !S.dictionary.includes(v)) { S.dictionary.push(v); saveSettings(); renderDictionary(); }
  $("#dict-input").value = "";
};

// ---------------------------------------------------------------- Einstellungen
const getPath = (o, p) => p.split(".").reduce((a, k) => a[k], o);
const setPath = (o, p, v) => { const ks = p.split("."); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

function renderSettings(state) {
  $$("[data-set]").forEach(n => {
    const v = getPath(S, n.dataset.set);
    if (n.type === "checkbox") n.checked = !!v; else n.value = v;
  });
  $("#hotkey").textContent = hotkeyLabel(S.hotkey);

  const mic = $("#mic");
  mic.replaceChildren(el("option", { value: "", textContent: "Windows-Standard" + (state.default_mic ? ` (${state.default_mic})` : "") }),
    ...state.mics.map(m => el("option", { value: m, textContent: m })));
  mic.value = state.mics.includes(S.mic) ? S.mic : "";
  renderLlmModels();
}

function renderLlmModels() {
  const sel = $("#llm-model");
  const models = ollamaModels ? [...ollamaModels] : [];
  if (!models.includes(S.llm.model)) models.unshift(S.llm.model);
  sel.replaceChildren(...models.map(m => el("option", { value: m, textContent: m + (ollamaModels && !ollamaModels.includes(m) ? " · nicht installiert" : "") })));
  sel.value = S.llm.model;
  $("#llm-desc").textContent = ollamaModels === null
    ? "Ollama ist nicht erreichbar"
    : "Lokal über Ollama. Mehr Modelle: ollama pull qwen3:8b";
}

$$("[data-set]").forEach(n => n.addEventListener("change", () => {
  setPath(S, n.dataset.set, n.type === "checkbox" ? n.checked : n.value);
  saveSettings();
}));
$("#mic").addEventListener("change", e => { S.mic = e.target.value; saveSettings(); });
$("#llm-model").addEventListener("change", e => { S.llm.model = e.target.value; saveSettings(); renderStatus(); });
$("#quit").onclick = async () => {
  if (!confirm("OpenDictate beenden? Diktieren geht dann nicht mehr, bis du es neu startest.")) return;
  await api("quit", {}).catch(() => {});
  document.body.replaceChildren(el("p", { className: "lead", style: "padding:40px", textContent: "OpenDictate wurde beendet. Du kannst dieses Fenster schließen." }));
};

// Hotkey aufnehmen: Tasten drücken, beim Loslassen übernehmen
const CODE_NAMES = {
  ControlRight: "right ctrl", ControlLeft: "left ctrl", ShiftRight: "right shift", ShiftLeft: "left shift",
  AltRight: "right alt", AltLeft: "left alt", MetaLeft: "windows", MetaRight: "right windows",
  Space: "space", CapsLock: "caps lock", Tab: "tab", ContextMenu: "menu",
};
const codeName = c => CODE_NAMES[c] || (/^F\d{1,2}$/.test(c) ? c.toLowerCase()
  : /^Key[A-Z]$/.test(c) ? c.slice(3).toLowerCase() : /^Digit\d$/.test(c) ? c.slice(5) : null);

function bindHotkeyCapture(hk) {
  let capture = null;
  hk.onclick = () => {
    if (capture) return;
    capture = { held: new Set(), combo: [] };
    hk.classList.add("capturing");
    hk.textContent = "Tasten drücken …";
    api("pause", { paused: true });
  };
  function endCapture(save) {
    if (!capture) return;
    if (save && capture.combo.length) {
      // AltGr meldet zusätzlich Strg links – das ignorieren wir
      let combo = capture.combo;
      if (combo.includes("right alt")) combo = combo.filter(k => k !== "left ctrl");
      S.hotkey = combo.join("+");
      saveSettings();
    }
    capture = null;
    hk.classList.remove("capturing");
    $$(".hotkey").forEach(b => (b.textContent = hotkeyLabel(S.hotkey)));
    renderStatus();
    api("pause", { paused: false });
  }
  hk.addEventListener("keydown", e => {
    if (!capture) return;
    e.preventDefault();
    if (e.code === "Escape") return endCapture(false);
    const n = codeName(e.code);
    if (!n || capture.held.has(n)) return;
    capture.held.add(n);
    capture.combo.push(n);
    hk.textContent = hotkeyLabel(capture.combo.join("+"));
  });
  hk.addEventListener("keyup", e => {
    if (!capture) return;
    e.preventDefault();
    capture.held.delete(codeName(e.code));
    if (!capture.held.size) endCapture(true);
  });
  hk.addEventListener("blur", () => endCapture(false));
}
bindHotkeyCapture($("#hotkey"));

// ---------------------------------------------------------------- Start
async function poll() {
  try {
    const p = await api("poll?since=" + lastSeq);
    live = p;
    if (p.history.length) {
      history.push(...p.history);
      lastSeq = p.history.at(-1).seq;
      renderHistory();
    }
    renderStatus();
  } catch {
    live = { status: "error", message: "Keine Verbindung zu OpenDictate. Läuft das Programm noch?" };
    if (S) renderStatus();
  }
  setTimeout(poll, live.status === "recording" || live.status === "processing" ? 150 : 500);
}

async function refreshOllama() {
  const r = await api("ollama").catch(() => ({ models: null }));
  ollamaModels = r.models;
  cpuShare = r.cpu_share || 0;
  renderLlmModels();
  renderStatus();
}

async function init() {
  showPage();
  const state = await api("state");
  S = state.settings;
  C = state.cleaning;
  ollamaModels = state.ollama_models;
  history = state.history;
  lastSeq = history.length ? history.at(-1).seq : 0;
  renderCleaning();
  renderDictionary();
  renderSettings(state);
  renderHistory();
  poll();
  refreshOllama();
  setInterval(refreshOllama, 15000);
  if (!S.onboarded) startOnboarding(state);
  $("#rerun-onboarding").onclick = () => startOnboarding(state);
}

init().catch(() => {
  $("#home-title").textContent = "Keine Verbindung";
  $("#home-sub").textContent = "Starte OpenDictate über start.bat. Das Fenster öffnet sich dann von selbst.";
});
