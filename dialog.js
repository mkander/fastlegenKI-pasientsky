/* dialog.js — kjører på PasientSky (pasientsky.no), i ALLE frames.
 *
 * KI-verktøylinje for meldinger til pasient. Fire koblingstyper (popup),
 * hver med egen kobling i chrome.storage.sync:
 *
 *   PasientSky-dialog (svar): klikk på pasientens melding, deretter
 *   svarfeltet. Linjen viser stikkordfelt + «Generer svar» + hurtigknapper.
 *   Genereringen henter pasientmeldingen (evt. fra en annen frame via
 *   chrome.storage-handshake) og fyller svarfeltet.
 *
 *   PasientSky ny melding (utgående): klikk på emnefeltet, deretter
 *   tekstfeltet. Linjen viser i tillegg «Prøvesvar»-knapp for å lime inn
 *   prøvesvar/røntgensvar som KI-en lager melding av. Genereringen fyller
 *   både emne og tekst.
 *
 *   eKontakt (Helsenorge, utgående): klikk på knappen som åpner ny
 *   eKontakt, deretter emnefeltet og tekstfeltet. Alt+E trykker på knappen.
 *
 *   Helsenorge-svar: som PasientSky-dialog, men egen kobling.
 *
 * Helsenorge-typene oppfører seg som sine PasientSky-motstykker og deler
 * hurtigknapper med dem. I begge visninger legges et kort journalnotat på
 * utklippstavlen. Hurtigknapper (sync-nøkler "qb.*") er enten faste maler
 * (settes inn umiddelbart) eller KI-stikkord (sendes til Claude). */
(function () {
  "use strict";
  const F = window.FLK;
  if (!F) return;
  const isTop = window.top === window.self;

  /* ---------------- koblingstyper ----------------
   * mode avgjør KI-linjens oppførsel: "svar" (pasientmelding + svarfelt) eller
   * "utgaaende" (emne + tekst). Steg: message = pasientens melding (ikke
   * redigerbar), button = knapp (klikket slippes gjennom), ellers skrivefelt.
   * texts[i] vises før steg i; siste tekst når koblingen er ferdig. */
  const KINDS = {
    dialog: {
      mapKey: "dialogMap", learnKey: "dialogLearn", mode: "svar", label: "dialogen",
      steps: ["message", "reply"],
      texts: [
        "Klikk på pasientens melding i dialogen.",
        "Pasientmelding koblet. Klikk nå i svarfeltet (der du skriver svar).",
        "Svarfelt koblet! «Generer svar» vises ved svarfeltet. ✔"
      ]
    },
    outgoing: {
      mapKey: "outgoingMap", learnKey: "outgoingLearn", mode: "utgaaende", label: "ny melding",
      steps: ["subject", "body"],
      texts: [
        "Klikk i EMNEFELTET i «ny melding»-visningen.",
        "Emnefelt koblet. Klikk nå i tekstfeltet for meldingen.",
        "Ny melding koblet! KI-linjen vises ved tekstfeltet. ✔"
      ]
    },
    hnOut: {
      mapKey: "hnOutMap", learnKey: "hnOutLearn", mode: "utgaaende", label: "eKontakt",
      steps: ["button", "subject", "body"],
      texts: [
        "Klikk på knappen som åpner ny eKontakt (Helsenorge).",
        "eKontakt-knapp koblet (Alt+E). Klikk nå i EMNEFELTET i eKontakt.",
        "Emnefelt koblet. Klikk nå i tekstfeltet for meldingen.",
        "eKontakt koblet! Alt+E og KI-linjen er klare. ✔"
      ]
    },
    hnReply: {
      mapKey: "hnReplyMap", learnKey: "hnReplyLearn", mode: "svar", label: "Helsenorge-svar",
      steps: ["message", "reply"],
      texts: [
        "Klikk på pasientens Helsenorge-melding.",
        "Pasientmelding koblet. Klikk nå i svarfeltet (der du skriver svar).",
        "Helsenorge-svar koblet! «Generer svar» vises ved svarfeltet. ✔"
      ]
    }
  };
  const KIND_NAMES = Object.keys(KINDS);
  const FIELD_NAMES = { subject: "emnefeltet", body: "tekstfeltet", reply: "svarfeltet" };
  const IDLE = { active: false, step: 0 };

  /* ---------------- cache av lagret tilstand ---------------- */
  const learn = {}; // local, per type
  const maps = {};  // sync, per type
  for (const n of KIND_NAMES) { learn[n] = IDLE; maps[n] = {}; }
  let quickButtons = [];                          // sync qb.* (sortert)
  let qbVersion = 0;

  F.get(KIND_NAMES.map((n) => KINDS[n].learnKey).concat(KIND_NAMES.map((n) => KINDS[n].mapKey))).then((r) => {
    for (const n of KIND_NAMES) {
      learn[n] = r[KINDS[n].learnKey] || learn[n];
      maps[n] = r[KINDS[n].mapKey] || {};
    }
  });

  function loadQuickButtons() {
    F.getPrefixed("qb.").then((all) => {
      quickButtons = Object.keys(all)
        .map((k) => Object.assign({ id: k }, all[k]))
        .filter((b) => b && b.label)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      qbVersion++;
    });
  }
  loadQuickButtons();

  /* ---------------- lær-modus (alle frames) ---------------- */

  // Klikk på en melding treffer ofte et lite tekst-element; klatre opp til en
  // container med nok tekst til å være selve meldingen.
  function messageContainerFrom(el) {
    let n = el;
    for (let i = 0; i < 6 && n && n.nodeType === 1 && n !== document.body; i++) {
      const t = (n.innerText || "").trim();
      if (t.length >= 20) return n;
      n = n.parentElement;
    }
    return el;
  }

  const CLICKABLE = 'button,a,[role="button"],[role="menuitem"],[role="tab"],input[type="button"],input[type="submit"]';

  // Klikk treffer ofte ikon/tekst inne i knappen — bruk selve knappen.
  function clickableFrom(el) {
    return (el && el.closest && el.closest(CLICKABLE)) || el;
  }

  function shortText(el) {
    const t = ((el.innerText || el.textContent || "") + "").replace(/\s+/g, " ").trim();
    return t.length <= 80 ? t : "";
  }

  function captureEntry(el, part) {
    const attrs = F.captureAttrs(el);
    if (part === "button") attrs.text = shortText(el);
    return { key: F.frameKey(), selector: F.cssPath(el), attrs };
  }

  function activeLearn() {
    for (const n of KIND_NAMES) if (learn[n] && learn[n].active) return n;
    return null;
  }

  document.addEventListener(
    "click",
    function (e) {
      const name = activeLearn(); // fra cache: må avgjøres synkront for preventDefault
      if (!name) return;
      const kind = KINDS[name];
      const step = learn[name].step || 0;
      const part = kind.steps[step];
      if (!part) return;

      let target;
      if (part === "button") {
        target = clickableFrom(e.target); // la klikket gå videre, så eKontakt åpnes
      } else {
        e.preventDefault();
        e.stopPropagation();
        target = part === "message" ? messageContainerFrom(e.target) : F.editableFrom(e.target);
        if (!target) {
          F.toast("Det var ikke et skrivefelt – klikk i " + FIELD_NAMES[part] + ".", "error");
          return;
        }
      }
      const next = step + 1;
      const done = next >= kind.steps.length;
      learn[name] = done ? IDLE : { active: true, step: next }; // ikke registrer dobbeltklikk to ganger
      saveStep(name, part, captureEntry(target, part), done, next);
    },
    true // capture-fase, foran PasientSky sin egen logikk
  );

  async function saveStep(name, part, entry, done, next) {
    const kind = KINDS[name];
    const map = (await F.get(kind.mapKey))[kind.mapKey] || {};
    map[part] = entry;
    await F.set({ [kind.mapKey]: map, [kind.learnKey]: done ? IDLE : { active: true, step: next } });
    F.toast(kind.texts[next], "ok");
  }

  async function toggleLearn(name) {
    const kind = KINDS[name];
    const st = (await F.get(kind.learnKey))[kind.learnKey];
    if (st && st.active) {
      await F.set({ [kind.learnKey]: IDLE });
      F.toast("Kobling av " + kind.label + " avbrutt.", "");
      return;
    }
    const upd = { [kind.mapKey]: {} };
    for (const n of KIND_NAMES) upd[KINDS[n].learnKey] = n === name ? { active: true, step: 0 } : IDLE;
    await F.set(upd);
    F.toast(kind.texts[0], "ok");
  }

  /* ---------------- gjenfinning ---------------- */

  // Meldingselementet er ikke redigerbart, så F.findElement passer ikke.
  function findMessageEl(entry) {
    if (!entry) return null;
    const a = entry.attrs || {};
    if (a.id) {
      const el = document.getElementById(a.id);
      if (el) return el;
    }
    if (entry.selector) {
      try {
        const el = document.querySelector(entry.selector);
        if (el) return el;
      } catch (e) {}
    }
    if (a.classes && a.classes.length) {
      try {
        const list = document.querySelectorAll(a.tag + "." + a.classes.join("."));
        if (list.length >= 1) return list[list.length - 1]; // nyeste melding ved flere treff
      } catch (e) {}
    }
    return null;
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Knappen er heller ikke redigerbar. Kun entydige, synlige treff godtas;
  // knappeteksten (f.eks. «eKontakt») er ofte det mest stabile kjennetegnet.
  function findButtonEl(entry) {
    if (!entry) return null;
    const a = entry.attrs || {};
    const esc = (s) => String(s).replace(/(["\\])/g, "\\$1");
    const uniq = (list) => {
      const vis = Array.from(list).filter(isVisible);
      return vis.length === 1 ? vis[0] : null;
    };
    const sels = [];
    if (a.id) sels.push("#" + CSS.escape(a.id));
    for (const k of Object.keys(a.data || {})) sels.push("[" + k + '="' + esc(a.data[k]) + '"]');
    if (a.ariaLabel) sels.push('[aria-label="' + esc(a.ariaLabel) + '"]');
    for (const sel of sels) {
      try { const el = uniq(document.querySelectorAll(sel)); if (el) return el; } catch (e) {}
    }
    if (a.text) {
      const el = uniq(Array.from(document.querySelectorAll(CLICKABLE)).filter((n) => shortText(n) === a.text));
      if (el) return el;
    }
    if (entry.selector) {
      try { const el = uniq(document.querySelectorAll(entry.selector)); if (el) return el; } catch (e) {}
    }
    return null;
  }

  function readMessageText(el) {
    return ((el.innerText || el.textContent || "") + "").trim();
  }

  function ownedEl(entry) {
    if (!entry || entry.key !== F.frameKey()) return null;
    return F.findElement(entry);
  }

  /* ---------------- Alt+E: åpne ny eKontakt ----------------
   * Tasten fanges i den framen som har fokus. Ligger knappen i en annen frame,
   * sendes en forespørsel via storage ("hnClick"); framen som finner knappen
   * klikker og kvitterer. Uten kvittering vises en feilmelding. */
  let pendingClick = null;

  document.addEventListener(
    "keydown",
    function (e) {
      // AltGr er Ctrl+Alt på Windows (AltGr+E = €) og skal ikke fanges.
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== "KeyE") return;
      e.preventDefault(); // også Chromes egen Alt+E-meny og Option+E (´) på Mac
      e.stopPropagation();
      if (!e.repeat) openEkontakt();
    },
    true
  );

  function openEkontakt() {
    const entry = maps.hnOut.button;
    if (!entry) {
      F.toast("eKontakt-knappen er ikke koblet. Bruk popup → «Koble eKontakt – ny melding».", "error");
      return;
    }
    if (entry.key === F.frameKey()) {
      const btn = findButtonEl(entry);
      if (btn) { btn.click(); return; }
    }
    if (pendingClick) clearTimeout(pendingClick.timer);
    const req = Date.now() + "-" + Math.random().toString(36).slice(2);
    pendingClick = {
      req,
      timer: setTimeout(() => {
        pendingClick = null;
        F.toast("Fant ikke eKontakt-knappen – er en pasient åpen? Koble eKontakt på nytt om den har flyttet seg.", "error");
      }, 1500)
    };
    F.set({ hnClick: { req } });
  }

  function handleClickRequest(v) {
    if (!v || !v.req) return;
    if (v.ok) {
      if (pendingClick && pendingClick.req === v.req) { clearTimeout(pendingClick.timer); pendingClick = null; }
      return;
    }
    if (pendingClick && pendingClick.req === v.req) return; // egen forespørsel – knappen var ikke her
    const entry = maps.hnOut.button;
    if (!entry || entry.key !== F.frameKey()) return;
    const btn = findButtonEl(entry);
    if (!btn) return; // en annen frame med samme adresse kan ha den
    btn.click();
    F.set({ hnClick: { req: v.req, ok: true } });
  }

  /* ---------------- henting på tvers av frames ---------------- */
  let pendingExtract = null;

  function extractHere(map) {
    const el = findMessageEl(map.message);
    if (!el) return { error: "Fant ikke pasientmeldingen – koble på nytt." };
    const text = readMessageText(el);
    if (!text) return { error: "Pasientmeldingen ser tom ut – koble på nytt." };
    return { text };
  }

  async function getPatientMessage(name) {
    const map = maps[name];
    if (!map.message) throw new Error("Pasientmeldingen er ikke koblet.");
    if (map.message.key === F.frameKey()) {
      const r = extractHere(map);
      if (r.error) throw new Error(r.error);
      return r.text;
    }
    // Meldingen ligger i en annen frame: be den hente teksten via storage.
    const req = Date.now();
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingExtract = null;
        reject(new Error("Fikk ikke hentet pasientmeldingen. Koble " + KINDS[name].label + " på nytt."));
      }, 4000);
      pendingExtract = {
        req,
        resolve: (t) => { clearTimeout(timer); pendingExtract = null; resolve(t); },
        reject: (e) => { clearTimeout(timer); pendingExtract = null; reject(e); }
      };
    });
    await F.set({ dialogExtract: { req, kind: name } });
    return promise;
  }

  async function handleExtractChange(v) {
    if (!v || !v.req) return;
    if (v.text != null || v.error) {
      if (pendingExtract && pendingExtract.req === v.req) {
        if (v.error) pendingExtract.reject(new Error(v.error));
        else pendingExtract.resolve(v.text);
      }
      return;
    }
    // Ny forespørsel: er meldingselementet i denne framen?
    const name = KINDS[v.kind] ? v.kind : "dialog";
    const mapKey = KINDS[name].mapKey;
    const map = maps[name].message ? maps[name] : ((await F.get(mapKey))[mapKey] || {});
    if (!map.message || map.message.key !== F.frameKey()) return;
    const r = extractHere(map);
    await F.set({ dialogExtract: { req: v.req, text: r.text, error: r.error } });
  }

  /* ---------------- verktøylinje ---------------- */
  let bar = null;
  let panel = null; // prøvesvar-panel
  let barMode = null;         // "svar" | "utgaaende" | null
  let barKind = null;         // koblingstype (nøkkel i KINDS) linjen gjelder
  let renderedKey = "";       // modus + qb-versjon linjen sist ble bygget for
  let anchorEl = null;
  let generating = false;
  let lastJournal = "";

  const VISIBLE_QB = 3; // antall hurtigknapper som vises direkte

  function qbForView(view) {
    return quickButtons.filter((b) => b.view === view || b.view === "begge");
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderBar(mode) {
    if (!bar) {
      bar = el("div", "flk-ai-bar");
      bar.id = "flk-ai-bar";
      bar.style.display = "none";
      document.body.appendChild(bar);
    }
    const prevStikkord = bar.querySelector("#flk-ai-stikkord");
    const keepVal = prevStikkord ? prevStikkord.value : "";
    bar.textContent = "";

    const input = el("input", "flk-ai-input");
    input.id = "flk-ai-stikkord";
    input.type = "text";
    input.placeholder = mode === "utgaaende"
      ? "Stikkord (feks «prøvesvar, alt fint»)"
      : "Stikkord (feks «resept sendt, kort»)";
    input.title = "Stikkord og føring til KI-en – kan stå tomt";
    input.value = keepVal;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); onGenerate(); }
      e.stopPropagation(); // ikke la PasientSky-snarveier (eller hotstrings) fange feltet
    });
    bar.appendChild(input);

    const gen = el("button", "flk-ai-btn flk-ai-primary", mode === "utgaaende" ? "✨ Generer melding" : "✨ Generer svar");
    gen.type = "button";
    gen.id = "flk-ai-generate";
    gen.addEventListener("click", () => onGenerate());
    bar.appendChild(gen);

    // hurtigknapper for denne visningen
    const btns = qbForView(mode);
    const visible = btns.slice(0, VISIBLE_QB);
    const overflow = btns.slice(VISIBLE_QB);
    for (const b of visible) bar.appendChild(makeQbButton(b));
    if (overflow.length) {
      const more = el("button", "flk-ai-btn", "⋯");
      more.type = "button";
      more.title = "Flere hurtigknapper";
      const menu = el("div", "flk-ai-menu");
      menu.style.display = "none";
      for (const b of overflow) {
        const item = makeQbButton(b);
        item.classList.add("flk-ai-menuitem");
        menu.appendChild(item);
      }
      more.addEventListener("click", (e) => {
        e.stopPropagation();
        menu.style.display = menu.style.display === "none" ? "" : "none";
      });
      bar.appendChild(more);
      bar.appendChild(menu);
    }

    if (mode === "utgaaende") {
      const pr = el("button", "flk-ai-btn", "🧪 Prøvesvar");
      pr.type = "button";
      pr.title = "Lim inn prøvesvar/røntgensvar og få melding + journalnotat";
      pr.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });
      bar.appendChild(pr);
    }

    const copyBtn = el("button", "flk-ai-btn", "📋 Kopier notat");
    copyBtn.type = "button";
    copyBtn.id = "flk-ai-copy";
    copyBtn.style.display = "none";
    copyBtn.title = "Kopier journalnotatet til utklippstavlen";
    copyBtn.addEventListener("click", onCopyJournal);
    bar.appendChild(copyBtn);
  }

  function makeQbButton(b) {
    const btn = el("button", "flk-ai-btn flk-ai-qb", (b.type === "ki" ? "✨ " : "") + b.label);
    btn.type = "button";
    btn.title = b.type === "ki" ? "KI-stikkord: " + (b.tekst || "") : "Fast mal settes inn umiddelbart";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (b.type === "ki") onGenerate({ stikkord: b.tekst || b.label, btnEl: btn });
      else applyMal(b);
    });
    return btn;
  }

  /* ---------------- prøvesvar-panel ---------------- */
  function togglePanel() {
    if (panel && panel.style.display !== "none") { panel.style.display = "none"; return; }
    if (!panel) {
      panel = el("div", "flk-ai-panel");
      const title = el("div", "flk-ai-panel-title", "Lim inn prøvesvar / røntgensvar");
      const hint = el("div", "flk-ai-panel-hint",
        "Fødselsnummer fjernes automatisk før sending. Unngå å ta med pasientens navn.");
      const ta = el("textarea", "flk-ai-textarea");
      ta.placeholder = "Lim inn her (Ctrl+V) …";
      ta.addEventListener("keydown", (e) => e.stopPropagation());
      const row = el("div", "flk-ai-panel-row");
      const go = el("button", "flk-ai-btn flk-ai-primary", "✨ Generer melding");
      go.type = "button";
      go.addEventListener("click", () => {
        const mat = ta.value.trim();
        if (!mat) { F.toast("Lim inn prøvesvaret først.", "error"); return; }
        panel.style.display = "none";
        onGenerate({ materiale: mat });
      });
      const cancel = el("button", "flk-ai-btn", "Avbryt");
      cancel.type = "button";
      cancel.addEventListener("click", () => { panel.style.display = "none"; });
      row.appendChild(go);
      row.appendChild(cancel);
      panel.appendChild(title);
      panel.appendChild(hint);
      panel.appendChild(ta);
      panel.appendChild(row);
      panel.addEventListener("click", (e) => e.stopPropagation());
      document.body.appendChild(panel);
    }
    panel.style.display = "";
    positionPanel();
    const ta = panel.querySelector("textarea");
    ta.value = "";
    ta.focus();
  }

  function positionPanel() {
    if (!panel || panel.style.display === "none" || !bar) return;
    const r = bar.getBoundingClientRect();
    let top = r.top - (panel.offsetHeight || 220) - 8;
    if (top < 4) top = r.bottom + 8;
    panel.style.left = Math.max(4, Math.round(r.left)) + "px";
    panel.style.top = Math.round(top) + "px";
  }

  // Fjern fødselsnummer o.l. før tekst sendes ut av maskinen.
  function scrubMateriale(t) {
    return String(t)
      .replace(/\b\d{6}\s?\d{5}\b/g, "[fnr fjernet]")
      .replace(/\b\d{11}\b/g, "[fnr fjernet]");
  }

  /* ---------------- posisjonering ---------------- */
  function positionBar() {
    if (!bar || bar.style.display === "none" || !anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { bar.style.display = "none"; return; }
    const bh = bar.offsetHeight || 40;
    let top = r.top - bh - 6;
    if (top < 4) top = r.bottom + 6; // ikke plass over feltet → legg under
    bar.style.left = Math.max(4, Math.round(r.left)) + "px";
    bar.style.top = Math.round(top) + "px";
    positionPanel();
  }

  // Hvilken koblingstype passer visningen i denne framen? Utgående har forrang
  // (der finnes både emne- og tekstfelt). Treffer flere svar-koblinger samme
  // svarfelt, velges den der pasientmeldingen faktisk finnes.
  function detect() {
    for (const name of ["hnOut", "outgoing"]) {
      const m = maps[name];
      const subjEl = ownedEl(m.subject);
      const bodyEl = subjEl ? ownedEl(m.body) : null;
      if (subjEl && bodyEl) return { kind: name, anchor: bodyEl };
    }
    let best = null;
    for (const name of ["hnReply", "dialog"]) {
      const m = maps[name];
      const replyEl = ownedEl(m.reply);
      if (!replyEl) continue;
      const score = !m.message ? 0
        : m.message.key !== F.frameKey() ? 1
        : findMessageEl(m.message) ? 2 : 0;
      if (!best || score > best.score) best = { kind: name, anchor: replyEl, score };
    }
    return best;
  }

  function tick() {
    const found = detect();

    if (!found) {
      barMode = null;
      barKind = null;
      anchorEl = null;
      if (bar) bar.style.display = "none";
      if (panel) panel.style.display = "none";
      return;
    }

    const mode = KINDS[found.kind].mode;
    if (!generating) barKind = found.kind; // ikke bytt type midt i en generering
    anchorEl = found.anchor;
    const key = mode + "|" + qbVersion;
    if (key !== renderedKey) {
      renderBar(mode);
      renderedKey = key;
      barMode = mode;
    }
    if (bar.style.display === "none") bar.style.display = "";
    positionBar();
  }

  /* ---------------- generering ---------------- */
  function sendToBackground(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          const err = chrome.runtime && chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(resp);
        });
      } catch (e) {
        reject(new Error("Får ikke kontakt med utvidelsen i denne rammen."));
      }
    });
  }

  async function tryCopy(text) {
    if (!text) return true;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  async function deliverJournal(notat) {
    lastJournal = notat || "";
    const copyBtn = bar && bar.querySelector("#flk-ai-copy");
    const copied = await tryCopy(lastJournal);
    if (copyBtn) copyBtn.style.display = copied ? "none" : "";
    return copied;
  }

  function setBusy(busy, btnEl) {
    generating = busy;
    if (!bar) return;
    for (const b of bar.querySelectorAll("button")) b.disabled = busy;
    const gen = bar.querySelector("#flk-ai-generate");
    if (gen) gen.textContent = busy && !btnEl
      ? "Genererer…"
      : (barMode === "utgaaende" ? "✨ Generer melding" : "✨ Generer svar");
    if (btnEl) btnEl.textContent = busy ? "…" : btnEl.textContent;
  }


  // Fyll feltene for aktiv koblingstype: emne + tekst (utgående) eller svarfelt.
  function fillFields(kindName, emne, tekst) {
    const kind = KINDS[kindName];
    const map = maps[kindName];
    if (kind.mode === "utgaaende") {
      const subjEl = ownedEl(map.subject);
      const bodyEl = ownedEl(map.body);
      if (!bodyEl) throw new Error("Fant ikke tekstfeltet – koble " + kind.label + " på nytt.");
      if (subjEl && emne) F.fillField(subjEl, emne);
      F.fillField(bodyEl, tekst);
    } else {
      const replyEl = ownedEl(map.reply);
      if (!replyEl) throw new Error("Fant ikke svarfeltet – koble " + kind.label + " på nytt.");
      F.fillField(replyEl, tekst);
    }
  }

  async function onGenerate(opts) {
    opts = opts || {};
    if (generating || !barMode || !barKind) return;
    const mode = barMode;
    const kindName = barKind;
    setBusy(true, opts.btnEl);
    try {
      const stikkord = opts.stikkord != null
        ? opts.stikkord
        : (bar.querySelector("#flk-ai-stikkord") || {}).value || "";

      let payload;
      if (mode === "utgaaende") {
        payload = {
          action: "flkGenerate",
          mode: "utgaaende",
          stikkord,
          materiale: opts.materiale ? scrubMateriale(opts.materiale) : ""
        };
      } else {
        const melding = await getPatientMessage(kindName);
        payload = { action: "flkGenerate", mode: "svar", stikkord, melding };
      }

      const resp = await sendToBackground(payload);
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Ukjent feil ved generering.");

      fillFields(kindName, resp.emne, resp.svar);

      const copied = await deliverJournal(resp.journalnotat);
      F.toast(copied
        ? "Tekst lagt inn. Journalnotatet ligger på utklippstavlen. ✔"
        : "Tekst lagt inn. Trykk «Kopier notat» for journalnotatet.", "ok");
    } catch (e) {
      F.toast("Generering feilet: " + (e && e.message ? e.message : e), "error");
    } finally {
      setBusy(false, opts.btnEl);
      renderedKey = ""; // tegn linjen på nytt (rydder knappetekster)
      tick();
    }
  }

  async function applyMal(b) {
    if (generating || !barMode || !barKind) return;
    try {
      fillFields(barKind, b.emne, b.tekst || "");
      const copied = await deliverJournal(b.notat || "");
      F.toast(copied
        ? (b.notat ? "Mal lagt inn. Journalnotatet ligger på utklippstavlen. ✔" : "Mal lagt inn. ✔")
        : "Mal lagt inn. Trykk «Kopier notat» for journalnotatet.", "ok");
    } catch (e) {
      F.toast("Feil: " + (e && e.message ? e.message : e), "error");
    }
  }

  async function onCopyJournal() {
    const ok = await tryCopy(lastJournal);
    if (ok) {
      const copyBtn = bar.querySelector("#flk-ai-copy");
      if (copyBtn) copyBtn.style.display = "none";
      F.toast("Journalnotat kopiert. ✔", "ok");
    } else {
      F.toast("Kopiering feilet – marker og kopier manuelt.", "error");
    }
  }


  /* ---------------- storage-endringer ---------------- */
  F.onChanged((changes, _area) => {
    for (const n of KIND_NAMES) {
      const k = KINDS[n];
      if (changes[k.learnKey]) learn[n] = changes[k.learnKey].newValue || IDLE;
      if (changes[k.mapKey]) maps[n] = changes[k.mapKey].newValue || {};
    }
    if (changes.dialogExtract) handleExtractChange(changes.dialogExtract.newValue);
    if (changes.hnClick) handleClickRequest(changes.hnClick.newValue);
    for (const k of Object.keys(changes)) {
      if (k.indexOf("qb.") === 0) { loadQuickButtons(); break; }
    }
  });

  /* ---------------- popup-meldinger ---------------- */
  const LEARN_ACTIONS = {
    startDialogLearn: "dialog",
    startOutgoingLearn: "outgoing",
    startHnOutLearn: "hnOut",
    startHnReplyLearn: "hnReply"
  };
  try {
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
        // kun toppvinduet svarer, ellers toggles tilstanden én gang per frame
        if (!msg || !isTop) return false;
        const name = LEARN_ACTIONS[msg.action];
        if (name) { toggleLearn(name); sendResponse({ ok: true }); }
        return false;
      });
    }
  } catch (e) {}

  /* ---------------- oppstart ---------------- */
  // lukk ⋯-menyen ved klikk utenfor (én global lytter, uansett re-rendering)
  document.addEventListener("click", () => {
    if (!bar) return;
    for (const m of bar.querySelectorAll(".flk-ai-menu")) m.style.display = "none";
  });
  setInterval(tick, 900); // SPA-robusthet: dialoger åpnes/lukkes dynamisk
  window.addEventListener("scroll", positionBar, true);
  window.addEventListener("resize", positionBar);
})();
