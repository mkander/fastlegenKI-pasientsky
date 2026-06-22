/* util.js — felles hjelpefunksjoner for kilde (FastlegeKI) og mål (PasientSky).
 * Kjøres FØR source.js / destination.js i samme isolerte content-script-verden,
 * og eksponerer alt under window.FLK. */
(function () {
  "use strict";
  if (window.FLK) return; // unngå dobbel-injeksjon (PasientSky har mange frames)

  const DEFAULTS = {
    headings: ["OVERSKRIFT1", "OVERSKRIFT2", "OVERSKRIFT3", "OVERSKRIFT4"],
    includeHeading: false,
    sourceField: "#responseBox"
  };

  /* ---------- storage (promise-wrappere) ---------- */
  function get(keys) {
    return new Promise((res) => chrome.storage.local.get(keys, res));
  }
  function set(obj) {
    return new Promise((res) => chrome.storage.local.set(obj, res));
  }
  async function getSettings() {
    const { settings } = await get("settings");
    return Object.assign({}, DEFAULTS, settings || {});
  }
  async function getFieldMap() {
    const { fieldMap } = await get("fieldMap");
    return Array.isArray(fieldMap) ? fieldMap : [];
  }
  async function getTransfer() {
    const { transfer } = await get("transfer");
    return transfer || null;
  }

  /* ---------- tekstdeling på overskrifter ---------- */

  // Normaliser en linje for sammenligning med en overskrift:
  // fjern markdown-pynt (#, *, _, -), mellomrom og avsluttende kolon, og gjør liten.
  function normHeading(s) {
    return String(s || "")
      .replace(/^[\s#*_>\-]+/, "")
      .replace(/[\s:*_]+$/, "")
      .trim()
      .toLowerCase();
  }

  // Deler tekst i N deler (én pr. overskrift). Returnerer array med samme
  // lengde og rekkefølge som `headings` — del i ligger på indeks i.
  // Innhold som matcher overskrift k legges i resultat[k], uavhengig av
  // rekkefølgen overskriftene faktisk står i teksten.
  function splitByHeadings(text, headings, includeHeading) {
    const heads = (headings || [])
      .map((h, i) => ({ i, raw: h, norm: normHeading(h) }))
      .filter((h) => h.norm.length > 0);

    const result = new Array((headings || []).length).fill("");
    if (!text || heads.length === 0) return result;

    const lines = String(text).split(/\r?\n/);
    let current = -1; // indeks i `headings` for aktiv seksjon
    const buf = {};

    for (const line of lines) {
      const n = normHeading(line);
      const match = n ? heads.find((h) => h.norm === n) : null;
      if (match) {
        current = match.i;
        if (!buf[current]) buf[current] = [];
        if (includeHeading) buf[current].push(line.trim());
        continue;
      }
      if (current >= 0) {
        if (!buf[current]) buf[current] = [];
        buf[current].push(line);
      }
    }

    for (const k of Object.keys(buf)) {
      result[k] = buf[k].join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
    }
    return result;
  }

  /* ---------- felt-gjenkjenning (mål) ---------- */
  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      return ["text", "search", "email", "url", "tel", "number", ""].includes(t);
    }
    if (el.isContentEditable) return true;
    return false;
  }

  // Klikk treffer ofte et barn inne i et contenteditable-felt — klatre oppover.
  function editableFrom(el) {
    let n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      if (isEditable(n)) return n;
      n = n.parentElement;
    }
    return null;
  }

  /* ---------- robuste selektorer ---------- */
  function cssEsc(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, "\\$&");
  }
  // Heuristikk: er id-en sannsynligvis autogenerert/ustabil?
  function looksRandom(id) {
    if (!id) return true;
    if (id.length > 50) return true;
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(id)) return true; // uuid
    if (/:r[0-9a-z]+:/i.test(id)) return true;                        // React useId
    if (/\d{5,}/.test(id)) return true;                               // lange tallrekker
    if (/^[a-z]+-[a-z0-9]{6,}$/i.test(id) && /\d/.test(id)) return true;
    return false;
  }

  function cssPath(el) {
    if (el.id && !looksRandom(el.id)) {
      const sel = "#" + cssEsc(el.id);
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e) {}
    }
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      if (n.id && !looksRandom(n.id)) {
        parts.unshift("#" + cssEsc(n.id));
        break;
      }
      let part = n.tagName.toLowerCase();
      const parent = n.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === n.tagName);
        if (sibs.length > 1) part += ":nth-of-type(" + (sibs.indexOf(n) + 1) + ")";
      }
      parts.unshift(part);
      n = parent;
    }
    return parts.join(" > ");
  }

  // Tilleggs-kjennetegn vi kan bruke for å gjenfinne feltet hvis selektoren svikter.
  function captureAttrs(el) {
    const a = {
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      name: el.getAttribute("name") || "",
      placeholder: el.getAttribute("placeholder") || "",
      ariaLabel: el.getAttribute("aria-label") || "",
      contentEditable: el.isContentEditable
    };
    // labelledby / nærliggende <label>
    const lblId = el.getAttribute("aria-labelledby");
    if (lblId) {
      const lbl = document.getElementById(lblId);
      if (lbl) a.labelText = (lbl.textContent || "").trim();
    }
    if (!a.labelText && el.id) {
      const lbl = document.querySelector('label[for="' + cssEsc(el.id) + '"]');
      if (lbl) a.labelText = (lbl.textContent || "").trim();
    }
    // data-* som ofte er stabile i test-/komponentrammeverk
    a.data = {};
    for (const attr of el.attributes) {
      if (/^data-(testid|test|cy|qa|field|name|key)$/i.test(attr.name)) {
        a.data[attr.name] = attr.value;
      }
    }
    return a;
  }

  // Forsøk å gjenfinne et felt fra et lagret oppslag (selektor + kjennetegn).
  function findElement(entry) {
    const attrs = entry.attrs || {};
    const tryList = [];

    if (entry.selector) tryList.push(entry.selector);
    for (const k of Object.keys(attrs.data || {})) {
      tryList.push("[" + k + '="' + cssEscAttr(attrs.data[k]) + '"]');
    }
    if (attrs.name) tryList.push('[name="' + cssEscAttr(attrs.name) + '"]');
    if (attrs.id && !looksRandom(attrs.id)) tryList.push("#" + cssEsc(attrs.id));
    if (attrs.ariaLabel) tryList.push('[aria-label="' + cssEscAttr(attrs.ariaLabel) + '"]');
    if (attrs.placeholder) tryList.push('[placeholder="' + cssEscAttr(attrs.placeholder) + '"]');

    for (const sel of tryList) {
      try {
        const found = Array.from(document.querySelectorAll(sel)).filter(isEditable);
        if (found.length) return found[0];
      } catch (e) {}
    }
    // siste utvei: koblet <label>-tekst
    if (attrs.labelText) {
      const labels = Array.from(document.querySelectorAll("label"));
      for (const lbl of labels) {
        if ((lbl.textContent || "").trim() === attrs.labelText) {
          const id = lbl.getAttribute("for");
          let el = id ? document.getElementById(id) : lbl.querySelector("input,textarea,[contenteditable]");
          if (el && isEditable(el)) return el;
        }
      }
    }
    return null;
  }
  function cssEscAttr(s) {
    return String(s).replace(/(["\\])/g, "\\$1");
  }

  /* ---------- fylling (React/rammeverk-vennlig) ---------- */
  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fillField(el, value) {
    el.focus();
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      setNativeValue(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
      return;
    }
    if (el.isContentEditable) {
      fillContentEditable(el, value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    }
  }

  // Fyll et contenteditable-felt linje for linje med ekte avsnittsskift.
  // Dette etterligner skriving og emitter beforeinput/input-hendelser som rike
  // editorer (ProseMirror, Slate, Draft, Quill, ren contenteditable) forstår,
  // slik at alle avsnitt bevares – ikke bare det siste.
  function fillContentEditable(el, value) {
    el.focus();
    // marker og fjern eksisterende innhold
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}

    let cleared = false;
    try { cleared = document.execCommand("delete", false, null); } catch (e) {}
    if (!cleared) { try { el.textContent = ""; } catch (e) {} }

    const lines = String(value).split("\n");
    let usedExec = true;
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        let ok = false;
        try { ok = document.execCommand("insertParagraph", false, null); } catch (e) {}
        if (!ok) { usedExec = false; break; }
      }
      if (lines[i]) {
        let ok = false;
        try { ok = document.execCommand("insertText", false, lines[i]); } catch (e) {}
        if (!ok) { usedExec = false; break; }
      }
    }

    // Siste utvei hvis execCommand ikke støttes i denne editoren:
    // bygg avsnitt som <div>-blokker og dispatch input.
    if (!usedExec) {
      el.textContent = "";
      const frag = document.createDocumentFragment();
      lines.forEach((line) => {
        const div = document.createElement("div");
        div.textContent = line || "";
        if (!line) div.appendChild(document.createElement("br"));
        frag.appendChild(div);
      });
      el.appendChild(frag);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  /* ---------- toast ---------- */
  let toastTimer = null;
  function toast(msg, kind) {
    let t = document.getElementById("flk-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "flk-toast";
      (document.body || document.documentElement).appendChild(t);
    }
    t.textContent = msg;
    t.className = "flk-toast flk-show" + (kind ? " flk-" + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = "flk-toast"; }, 4200);
  }

  function frameKey() {
    return location.origin + location.pathname;
  }

  window.FLK = {
    DEFAULTS, get, set, getSettings, getFieldMap, getTransfer,
    splitByHeadings, normHeading,
    isEditable, editableFrom, cssPath, captureAttrs, findElement,
    setNativeValue, fillField, fillContentEditable, toast, frameKey
  };
})();
