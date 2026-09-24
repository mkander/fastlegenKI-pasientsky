/* hotstrings.js — tekstutvidelse (PhraseExpress-stil), selvstendig content
 * script som registreres dynamisk av background.js på domenene i domenelisten
 * (chrome.storage.sync: "hsDomains"). Ingen avhengighet til util.js.
 *
 * Virkemåte: skriv en kode (f.eks. "mvh") i et tekstfelt og trykk
 * mellomrom/enter/tab — koden byttes ut med teksten definert i innstillingene
 * (sync-nøkler "hs.<kode>"). Plassholdere: {dato} (dagens dato, dd.mm.åååå) og
 * {kursor} (hvor markøren skal stå; skilletegnet slukes da). Backspace rett
 * etter en utvidelse gjenoppretter koden. Aldri aktiv i passordfelt. */
(function () {
  "use strict";
  if (window.__flkHotstrings) return; // unngå dobbel-injeksjon
  window.__flkHotstrings = true;

  function storageOk() {
    try { return !!(chrome && chrome.storage && chrome.storage.sync); }
    catch (e) { return false; }
  }
  if (!storageOk()) return;

  /* ---------------- tabell over hotstrings ---------------- */
  let table = {}; // kode (små bokstaver) -> tekst

  function loadTable() {
    try {
      chrome.storage.sync.get(null, (all) => {
        void (chrome.runtime && chrome.runtime.lastError);
        table = {};
        for (const k of Object.keys(all || {})) {
          if (k.indexOf("hs.") === 0 && typeof all[k] === "string") {
            table[k.slice(3).toLowerCase()] = all[k];
          }
        }
      });
    } catch (e) {}
  }
  loadTable();

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      for (const k of Object.keys(changes)) {
        if (k.indexOf("hs.") !== 0) continue;
        const code = k.slice(3).toLowerCase();
        if (changes[k].newValue == null) delete table[code];
        else table[code] = changes[k].newValue;
      }
    });
  } catch (e) {}

  /* ---------------- plassholdere ---------------- */
  function todayNo() {
    const d = new Date();
    const p = (n) => (n < 10 ? "0" + n : "" + n);
    return p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + d.getFullYear();
  }

  // Returnerer { text, caretBack }: caretBack = antall tegn markøren skal
  // flyttes bakover etter innsetting ({kursor}-plassholder), -1 hvis ingen.
  function prepare(raw) {
    let t = String(raw).replace(/\{dato\}/gi, todayNo());
    let caretBack = -1;
    const idx = t.toLowerCase().indexOf("{kursor}");
    if (idx !== -1) {
      caretBack = t.length - "{kursor}".length - idx;
      t = t.slice(0, idx) + t.slice(idx + "{kursor}".length);
    }
    return { text: t, caretBack };
  }

  /* ---------------- felt-hjelpere ---------------- */
  function resolveTarget(e) {
    const el = e.target;
    if (!el || el.nodeType !== 1) return null;
    if (el.tagName === "INPUT") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (["text", "search", "email", "url", "tel", ""].indexOf(t) === -1) return null; // aldri password m.fl.
      return { el, kind: "input" };
    }
    if (el.tagName === "TEXTAREA") return { el, kind: "input" };
    if (el.isContentEditable) return { el, kind: "ce" };
    return null;
  }

  function wordBeforeCaretInput(el) {
    const pos = el.selectionStart;
    if (pos == null || pos !== el.selectionEnd) return null;
    const m = el.value.slice(0, pos).match(/(\S+)$/);
    return m ? { word: m[1] } : null;
  }

  function wordBeforeCaretCE() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3) return null; // må stå i en tekstnode
    const m = node.textContent.slice(0, sel.anchorOffset).match(/(\S+)$/);
    return m ? { word: m[1] } : null;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  // Simulert innliming — rike editorer (Draft.js m.fl.) håndterer paste selv.
  function pasteInto(el, text) {
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      let ev;
      try {
        ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
      } catch (e) { ev = null; }
      if (!ev) return false;
      if (!ev.clipboardData) {
        try { Object.defineProperty(ev, "clipboardData", { value: dt }); } catch (e) {}
      }
      el.dispatchEvent(ev);
      return ev.defaultPrevented === true;
    } catch (e) { return false; }
  }

  /* ---------------- utvidelse ---------------- */
  function expandInput(el, wordLen, exp) {
    const pos = el.selectionStart;
    const before = el.value.slice(0, pos - wordLen);
    const after = el.value.slice(pos);
    setNativeValue(el, before + exp.text + after);
    let caret = before.length + exp.text.length;
    if (exp.caretBack > 0) caret -= exp.caretBack;
    try { el.setSelectionRange(caret, caret); } catch (e) {}
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  function expandCE(el, wordLen, exp) {
    const sel = window.getSelection();
    if (!sel) return false;
    try {
      for (let i = 0; i < wordLen; i++) sel.modify("extend", "backward", "character");
    } catch (e) { return false; }
    let ok = pasteInto(el, exp.text);
    if (!ok) {
      try { ok = document.execCommand("insertText", false, exp.text); } catch (e) {}
    }
    if (!ok) {
      try {
        const r = sel.getRangeAt(0);
        r.deleteContents();
        r.insertNode(document.createTextNode(exp.text));
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        ok = true;
      } catch (e) {}
    }
    if (!ok) {
      try { sel.collapseToEnd(); } catch (e) {} // rydd opp markeringen
      return false;
    }
    if (exp.caretBack > 0) {
      try {
        for (let i = 0; i < exp.caretBack; i++) sel.modify("move", "backward", "character");
      } catch (e) {}
    }
    return true;
  }

  /* ---------------- backspace-angring ---------------- */
  // Husker siste utvidelse; backspace umiddelbart etter gjenoppretter koden.
  let lastExp = null; // { el, kind, code, text }

  function tryUndo(e) {
    const le = lastExp;
    lastExp = null;
    if (!le) return;
    try {
      if (le.kind === "input") {
        const el = le.el;
        if (document.activeElement !== el) return;
        const pos = el.selectionStart;
        if (pos == null || pos !== el.selectionEnd) return;
        const val = el.value;
        // forventer [utvidelse][skilletegn] eller bare [utvidelse] før markøren
        let n = le.text.length + 1;
        if (val.slice(pos - n, pos - 1) !== le.text) {
          n = le.text.length;
          if (val.slice(pos - n, pos) !== le.text) return;
        }
        const before = val.slice(0, pos - n);
        setNativeValue(el, before + le.code + val.slice(pos));
        const caret = before.length + le.code.length;
        try { el.setSelectionRange(caret, caret); } catch (e2) {}
        el.dispatchEvent(new Event("input", { bubbles: true }));
        e.preventDefault();
        e.stopPropagation();
      } else {
        const sel = window.getSelection();
        if (!sel || !sel.isCollapsed || !le.el.contains(sel.anchorNode)) return;
        for (let i = 0; i < le.text.length + 1; i++) sel.modify("extend", "backward", "character");
        let ok = false;
        try { ok = document.execCommand("insertText", false, le.code); } catch (e2) {}
        if (ok) { e.preventDefault(); e.stopPropagation(); }
        else { try { sel.collapseToEnd(); } catch (e2) {} }
      }
    } catch (err) {}
  }

  /* ---------------- hovedlytter ---------------- */
  document.addEventListener(
    "keydown",
    function (e) {
      if (e.isComposing) return;
      if (e.key === "Backspace") { tryUndo(e); return; }
      const isDelim = e.key === " " || e.key === "Enter" || e.key === "Tab";
      lastExp = null;
      if (!isDelim || e.ctrlKey || e.metaKey || e.altKey) return;

      const t = resolveTarget(e);
      if (!t) return;
      const info = t.kind === "input" ? wordBeforeCaretInput(t.el) : wordBeforeCaretCE();
      if (!info) return;
      const code = info.word.toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(table, code)) return;

      const exp = prepare(table[code]);
      const ok = t.kind === "input"
        ? expandInput(t.el, info.word.length, exp)
        : expandCE(t.el, info.word.length, exp);
      if (!ok) return;

      if (exp.caretBack >= 0) {
        // {kursor}: sluk skilletegnet, ellers havner det midt i teksten
        e.preventDefault();
        e.stopPropagation();
      } else {
        lastExp = { el: t.el, kind: t.kind, code: info.word, text: exp.text };
      }
    },
    true // capture: foran sidens egne handlere (f.eks. send-på-enter)
  );

  document.addEventListener("mousedown", () => { lastExp = null; }, true);
})();
