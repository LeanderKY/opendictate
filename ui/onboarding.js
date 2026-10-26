"use strict";
// Einrichtung beim ersten Start. Jeder Schritt ist überspringbar; nichts hier ist Pflicht.

const OB_STEPS = 5;
let obStep = 0;
let obTimer = null;
let obTrySeq = 0;

const gb = bytes => (bytes / 1e9).toFixed(1).replace(".", ",") + " GB";

function obState(dd, kind, text, ...extra) {
  dd.replaceChildren(el("span", { className: "dot " + kind }), el("span", { textContent: text }), ...extra);
}

function obButton(label, onclick, cls = "ghost") {
  const b = el("button", { className: cls + " small-btn", textContent: label });
  b.onclick = onclick;
  return b;
}

async function obRefreshSetup() {
  const s = await api("setup").catch(() => null);
  if (!s) return;

  $("#ob-gpu").textContent = s.gpu
    ? `${s.gpu} · ${Math.round(s.vram / 1024)} GB`
    : "Keine NVIDIA-Grafikkarte gefunden. Läuft auf dem Prozessor, etwas langsamer.";

  const w = $("#ob-whisper");
  if (s.status === "loading") obState(w, "processing", s.message + " Beim ersten Mal wird das Modell heruntergeladen.");
  else if (s.model_info) obState(w, "ready", s.model_info);
  else obState(w, "error", s.message || "Fehler");

  const o = $("#ob-ollama"), l = $("#ob-llm");
  const model = S.llm.model;
  if (!S.llm.enabled) {
    obState(o, "", "nicht nötig");
    obState(l, "", "aus", obButton("Einschalten", () => { S.llm.enabled = true; saveSettings(); obRefreshSetup(); }));
    $("#ob-llm-skip").hidden = true;
    return;
  }
  $("#ob-llm-skip").hidden = false;

  if (!s.ollama.installed) {
    obState(o, "error", "Nicht installiert. ",
      el("a", { href: "https://ollama.com/download", target: "_blank", rel: "noopener", textContent: "Ollama herunterladen" }),
      el("span", { className: "muted", textContent: ", installieren, dann hier weiter." }));
    obState(l, "", `${model} wartet auf Ollama`);
    return;
  }
  if (!s.ollama.running) {
    obState(o, "processing", "Installiert, läuft aber nicht. ", obButton("Ollama starten", async e => {
      e.target.disabled = true;
      e.target.textContent = "Starte …";
      await api("ollama/start", {});
      obRefreshSetup();
    }));
    obState(l, "", `${model} wartet auf Ollama`);
    return;
  }
  obState(o, "ready", "Läuft");

  const p = s.pull && s.pull.model === model ? s.pull : null;
  if (s.ollama.models.includes(model)) {
    obState(l, "ready", model + " · bereit");
    ollamaModels = s.ollama.models;
  } else if (p && !p.done) {
    const pct = p.total ? Math.round((p.completed / p.total) * 100) : 0;
    const bar = el("div", { className: "meter thin" }, el("span", { style: `width:${pct}%` }));
    obState(l, "processing", p.total ? `${model} · ${gb(p.completed)} von ${gb(p.total)}` : `${model} · ${p.status}`, bar);
  } else {
    const known = { "qwen3:8b": "5,2 GB", "qwen3:4b": "2,5 GB", "gemma3:4b": "3,3 GB", "gemma3:1b": "0,8 GB", "gemma3:12b": "8,1 GB" };
    const size = known[model] ? ` (${known[model]})` : "";
    const err = p && p.error ? el("div", { className: "bad small", textContent: "Fehler: " + p.error }) : "";
    obState(l, "", `${model} noch nicht geladen. `,
      obButton("Laden" + size, async () => { await api("ollama/pull", { model }); obRefreshSetup(); }, "primary"), err);
  }
}

async function obMeter() {
  const p = await api("poll?since=999999999").catch(() => null);
  if (!p) return;
  const lv = Math.min(1, p.level * 12);
  $("#ob-meter").style.width = Math.round(lv * 100) + "%";
  if (lv > 0.08) $("#ob-mic-hint").textContent = "Passt, das Mikrofon hört dich.";
}

function obShow(step) {
  obStep = Math.max(0, Math.min(OB_STEPS - 1, step));
  clearInterval(obTimer);
  $$(".ob-step").forEach(s => (s.hidden = Number(s.dataset.step) !== obStep));
  $("#ob-bar").style.width = ((obStep + 1) / OB_STEPS) * 100 + "%";
  $("#ob-step-label").textContent = `Schritt ${obStep + 1} von ${OB_STEPS}`;
  $("#ob-back").hidden = obStep === 0;
  $("#ob-next").textContent = obStep === 0 ? "Los geht's" : obStep === OB_STEPS - 1 ? "Fertig" : "Weiter";
  $("#ob-skip").textContent = obStep === 0 ? "Einrichtung überspringen" : "Überspringen";

  if (obStep === 1) {
    obRefreshSetup();
    obTimer = setInterval(obRefreshSetup, 1000);
  }
  if (obStep === 2) {
    const sel = $("#ob-mic");
    sel.replaceChildren(...$$("#mic option").map(o => o.cloneNode(true)));
    sel.value = $("#mic").value;
    $("#ob-mic-hint").textContent = "Bewegt sich nichts? Wähl oben ein anderes Mikrofon oder prüf, ob es stummgeschaltet ist.";
    obTimer = setInterval(obMeter, 80);
  }
  if (obStep === 3) $("#ob-hotkey").textContent = hotkeyLabel(S.hotkey);
  if (obStep === 4) {
    $("#ob-try-lead").replaceChildren("Klick ins Feld, halte ", el("kbd", { textContent: hotkeyLabel(S.hotkey) }),
      " und sag zum Beispiel: „Ich treffe mich morgen, nein, übermorgen mit Anna.“ Dann loslassen.");
    obTrySeq = lastSeq;
    $("#ob-result").hidden = true;
    setTimeout(() => $("#ob-try").focus(), 50);
    obTimer = setInterval(() => {
      const h = history.filter(x => x.seq > obTrySeq).at(-1);
      if (!h) return;
      $("#ob-raw").textContent = h.raw;
      $("#ob-text").textContent = h.text;
      $("#ob-time").textContent = `Fertig nach ${fmtSec(h.t_asr + h.t_llm)}, nachdem du losgelassen hast.`
        + (h.raw === h.text ? "" : " Die Bereinigung hat aufgeräumt.");
      $("#ob-result").hidden = false;
    }, 200);
  }
}

function obFinish() {
  clearInterval(obTimer);
  $("#onboarding").hidden = true;
  if (!S.onboarded) {
    S.onboarded = true;
    saveSettings();
  }
  location.hash = "#home";
}

function startOnboarding() {
  $("#onboarding").hidden = false;
  obShow(0);
}

$("#ob-next").onclick = () => (obStep === OB_STEPS - 1 ? obFinish() : obShow(obStep + 1));
$("#ob-back").onclick = () => obShow(obStep - 1);
$("#ob-skip").onclick = () => (obStep === 0 ? obFinish() : obShow(obStep + 1));
$("#ob-no-llm").onclick = () => { S.llm.enabled = false; saveSettings(); obRefreshSetup(); };
$("#ob-mic").addEventListener("change", e => {
  S.mic = e.target.value;
  $("#mic").value = S.mic;
  saveSettings();
});
bindHotkeyCapture($("#ob-hotkey"));
