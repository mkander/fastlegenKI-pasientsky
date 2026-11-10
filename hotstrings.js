/* hotstrings.js — tekstutvidelse (PhraseExpress-stil), selvstendig content
 * script som registreres dynamisk av background.js på domenene i domenelisten
 * (chrome.storage.sync: "hsDomains"). Ingen avhengighet til util.js.
 *
 * Virkemåte: skriv en kode (f.eks. "mvh") i et tekstfelt og trykk
 * mellomrom/enter/tab — koden byttes ut med teksten definert i innstillingene
 * (sync-nøkler "hs.<kode>"). Plassholdere: {dato} (dagens dato, dd.mm.åååå) og
 * {kursor} (hvor markøren skal stå; skilletegnet slukes da). Backspace rett
 * etter en utvidelse gjenoppretter koden. Aldri aktiv i passordfelt.
 *
 * Verdien kan også være et objekt { text, trigger, hotkey }:
 *  - trigger "instant": utvides straks siste tegn i koden skrives (uten
 *    mellomrom/enter/tab). Ellers (standard) etter skilletegn.
 *  - hotkey: tastekombinasjon (f.eks. "Numpad1", "Ctrl+Shift+M", "F8") som
 *    setter inn teksten ved markøren i et tekstfelt. Fysisk tast (e.code),
 *    så numpad skilles fra tallraden og virker også med NumLock av. */
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
  let table = {};   // kode (små bokstaver) -> { text, instant }
  let hotkeys = {}; // normalisert tastekombinasjon -> tekst

  // Lagret verdi er enten ren tekst (gammelt format) eller et objekt.
  function normEntry(v) {
    if (typeof v === "string") return { text: v, instant: false, hotkey: "" };
    if (v && typeof v === "object" && typeof v.text === "string") {
      return {
        text: v.text,
        instant: v.trigger === "instant",
        hotkey: typeof v.hotkey === "string" ? v.hotkey : ""
      };
    }
    return null;
  }

  function loadTable() {
    try {
      chrome.storage.sync.get(null, (all) => {
        void (chrome.runtime && chrome.runtime.lastError);
        const t = {};
        const h = {};
        for (const k of Object.keys(all || {})) {
          if (k.indexOf("hs.") !== 0) continue;
          const e = normEntry(all[k]);
          if (!e || !e.text) continue;
          const code = k.slice(3).toLowerCase();
          if (code) t[code] = { text: e.text, instant: e.instant };
          if (e.hotkey) h[e.hotkey] = e.text;
        }
        table = t;
        hotkeys = h;
      });
    } catch (e) {}
  }
  loadTable();

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      if (Object.keys(changes).some((k) => k.indexOf("hs.") === 0)) loadTable();
    });
  } catch (e) {}

  /* ---------------- hurtigtaster ---------------- */
  const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$|^(CapsLock|NumLock|ScrollLock|Fn|FnLock|AltGraph)$/;

  // Samme normalisering som i options.js: "Ctrl+Alt+Shift+Meta+<tast>",
  // der tasten er e.code med "Key"/"Digit" fjernet (KeyM -> M, Digit1 -> 1).
  function hotkeyFromEvent(e) {
    const code = e.code || "";
    if (!code || MODIFIER_CODES.test(code)) return "";
    const name = code.replace(/^Key(?=[A-Z]$)/, "").replace(/^Digit(?=\d$)/, "");
    const mods = [];
    if (e.ctrlKey) mods.push("Ctrl");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    if (e.metaKey) mods.push("Meta");
    return mods.concat(name).join("+");
  }

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

  // Ordet (ikke-blanke tegn) rett før markøren. allowEmpty: returner ""
  // når markøren står først i feltet eller etter et blankt tegn (brukes for
  // umiddelbare koder, der siste tegn ennå ikke er skrevet).
  function wordBeforeCaretInput(el, allowEmpty) {
    const pos = el.selectionStart;
    if (pos == null || pos !== el.selectionEnd) return null;
    const m = el.value.slice(0, pos).match(/(\S+)$/);
    if (m) return { word: m[1] };
    return allowEmpty ? { word: "" } : null;
  }

  function wordBeforeCaretCE(allowEmpty) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
    const node = sel.anchorNode;
    if (!node) return null;
    if (node.nodeType !== 3) return allowEmpty ? { word: "" } : null; // tomt felt/ny linje
    const m = node.textContent.slice(0, sel.anchorOffset).match(/(\S+)$/);
    if (m) return { word: m[1] };
    return allowEmpty ? { word: "" } : null;
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

  // Rike editorer (Draft.js i PasientSky-journalen, m.fl.) har en egen
  // markeringsmodell som bare oppdateres når «selectionchange» kommer — og
  // den kommer asynkront. Uten dette setter editoren inn teksten der den
  // tror markøren står, og koden vi markerte blir stående igjen. Et
  // synkront selectionchange får editoren til å lese inn markeringen først.
  function syncSelection() {
    try { document.dispatchEvent(new Event("selectionchange")); } catch (e) {}
  }

  /* ---------------- utvidelse ---------------- */
  // Bytter ut wordLen tegn før markøren (og ev. markert tekst) med teksten.
  function expandInput(el, wordLen, exp) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start == null || end == null) return false;
    const before = el.value.slice(0, start - wordLen);
    const after = el.value.slice(end);
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
    if (wordLen > 0) syncSelection();
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
  let lastExp = null; // { el, kind, code, text, delim } (delim: skilletegn etter teksten, 0/1)

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
        // forventer [utvidelse][skilletegn] (eller bare [utvidelse] — umiddelbar
        // kode, eller siden slukte skilletegnet) før markøren
        let n = le.text.length + le.delim;
        if (val.slice(pos - n, pos - le.delim) !== le.text) {
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
        for (let i = 0; i < le.text.length + le.delim; i++) sel.modify("extend", "backward", "character");
        syncSelection();
        let ok = false;
        try { ok = document.execCommand("insertText", false, le.code); } catch (e2) {}
        if (ok) { e.preventDefault(); e.stopPropagation(); }
        else { try { sel.collapseToEnd(); } catch (e2) {} }
      }
    } catch (err) {}
  }

  /* ---------------- hovedlytter ---------------- */
  function expandAt(t, wordLen, exp) {
    return t.kind === "input"
      ? expandInput(t.el, wordLen, exp)
      : expandCE(t.el, wordLen, exp);
  }

  function stop(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  // Hurtigtast: sett inn teksten ved markøren (erstatter ev. markering).
  function tryHotkey(e) {
    const hk = hotkeyFromEvent(e);
    if (!hk || !Object.prototype.hasOwnProperty.call(hotkeys, hk)) return false;
    const t = resolveTarget(e);
    if (!t) return false; // utenfor tekstfelt: la tasten gå videre til siden
    if (e.repeat) { stop(e); return true; } // holdt nede: ikke sett inn flere ganger
    if (expandAt(t, 0, prepare(hotkeys[hk]))) stop(e);
    return true;
  }

  // Umiddelbar kode: tasten som fullfører koden slukes, og ordet byttes ut.
  function tryInstant(e) {
    if (e.key.length !== 1 || /\s/.test(e.key)) return false;
    const altGr = !!(e.getModifierState && e.getModifierState("AltGraph"));
    if ((e.ctrlKey || e.altKey || e.metaKey) && !altGr) return false;
    const t = resolveTarget(e);
    if (!t) return false;
    const info = t.kind === "input" ? wordBeforeCaretInput(t.el, true) : wordBeforeCaretCE(true);
    if (!info) return false;
    const typed = info.word + e.key;
    const code = typed.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(table, code)) return false;
    const entry = table[code];
    if (!entry.instant) return false;

    const exp = prepare(entry.text);
    if (!expandAt(t, info.word.length, exp)) return false;
    stop(e);
    if (exp.caretBack < 0) lastExp = { el: t.el, kind: t.kind, code: typed, text: exp.text, delim: 0 };
    return true;
  }

  // Vanlig kode: utvides når mellomrom/enter/tab trykkes etter koden.
  function tryDelimited(e) {
    const t = resolveTarget(e);
    if (!t) return;
    const info = t.kind === "input" ? wordBeforeCaretInput(t.el) : wordBeforeCaretCE();
    if (!info) return;
    const code = info.word.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(table, code)) return;
    const entry = table[code];
    if (entry.instant) return; // umiddelbare koder utvides bare mens de skrives

    const exp = prepare(entry.text);
    if (!expandAt(t, info.word.length, exp)) return;

    if (exp.caretBack >= 0) {
      // {kursor}: sluk skilletegnet, ellers havner det midt i teksten
      stop(e);
    } else {
      lastExp = { el: t.el, kind: t.kind, code: info.word, text: exp.text, delim: 1 };
    }
  }

  document.addEventListener(
    "keydown",
    function (e) {
      if (e.isComposing) return;
      if (tryHotkey(e)) { lastExp = null; return; }
      if (e.key === "Backspace") { tryUndo(e); return; }
      lastExp = null;
      if (tryInstant(e)) return;
      const isDelim = e.key === " " || e.key === "Enter" || e.key === "Tab";
      if (!isDelim || e.ctrlKey || e.metaKey || e.altKey) return;
      tryDelimited(e);
    },
    true // capture: foran sidens egne handlere (f.eks. send-på-enter)
  );

  document.addEventListener("mousedown", () => { lastExp = null; }, true);
})();
