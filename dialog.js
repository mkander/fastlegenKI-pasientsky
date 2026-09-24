/* dialog.js — kjører på PasientSky (pasientsky.no), i ALLE frames.
 *
 * KI-verktøylinje for meldinger til pasient, i to visninger:
 *
 *   SVAR («Koble dialog» i popup): klikk på pasientens melding, deretter
 *   svarfeltet. Linjen viser stikkordfelt + «Generer svar» + hurtigknapper.
 *   Genereringen henter pasientmeldingen (evt. fra en annen frame via
 *   chrome.storage-handshake) og fyller svarfeltet.
 *
 *   UTGÅENDE («Koble ny melding» i popup): klikk på emnefeltet, deretter
 *   tekstfeltet. Linjen viser i tillegg «Prøvesvar»-knapp for å lime inn
 *   prøvesvar/røntgensvar som KI-en lager melding av. Genereringen fyller
 *   både emne og tekst.
 *
 * I begge visninger legges et kort journalnotat på utklippstavlen.
 * Hurtigknapper (sync-nøkler "qb.*") er enten faste maler (settes inn
 * umiddelbart) eller KI-stikkord (sendes til Claude). Koblingene ligger i
 * chrome.storage.sync og deles mellom maskinene dine. */
(function () {
  "use strict";
  const F = window.FLK;
  if (!F) return;
  const isTop = window.top === window.self;

  /* ---------------- cache av lagret tilstand ---------------- */
  let dialogLearn = { active: false, step: 0 };   // local
  let outgoingLearn = { active: false, step: 0 }; // local
  let dialogMap = {};                             // sync {message, reply}
  let outgoingMap = {};                           // sync {subject, body}
  let quickButtons = [];                          // sync qb.* (sortert)
  let qbVersion = 0;

  F.get(["dialogLearn", "outgoingLearn", "dialogMap", "outgoingMap"]).then((r) => {
    dialogLearn = r.dialogLearn || dialogLearn;
    outgoingLearn = r.outgoingLearn || outgoingLearn;
    dialogMap = r.dialogMap || {};
    outgoingMap = r.outgoingMap || {};
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

  function captureEntry(el) {
    return { key: F.frameKey(), selector: F.cssPath(el), attrs: F.captureAttrs(el) };
  }

  document.addEventListener(
    "click",
    async function (e) {
      if (!dialogLearn.active && !outgoingLearn.active) return; // rask sjekk
      const { dialogLearn: dl, outgoingLearn: ol } = await F.get(["dialogLearn", "outgoingLearn"]);

      if (dl && dl.active) {
        e.preventDefault();
        e.stopPropagation();
        const map = (await F.get("dialogMap")).dialogMap || {};
        if (dl.step === 0) {
          map.message = captureEntry(messageContainerFrom(e.target));
          await F.set({ dialogMap: map, dialogLearn: { active: true, step: 1 } });
          F.toast("Pasientmelding koblet. Klikk nå i svarfeltet (der du skriver svar).", "ok");
        } else {
          const el = F.editableFrom(e.target);
          if (!el) { F.toast("Det var ikke et skrivefelt – klikk i selve svarfeltet.", "error"); return; }
          map.reply = captureEntry(el);
          await F.set({ dialogMap: map, dialogLearn: { active: false, step: 0 } });
          F.toast("Svarfelt koblet! «Generer svar» vises ved svarfeltet. ✔", "ok");
        }
        return;
      }

      if (ol && ol.active) {
        e.preventDefault();
        e.stopPropagation();
        const el = F.editableFrom(e.target);
        if (!el) {
          F.toast(ol.step === 0
            ? "Det var ikke et skrivefelt – klikk i emnefeltet."
            : "Det var ikke et skrivefelt – klikk i tekstfeltet.", "error");
          return;
        }
        const map = (await F.get("outgoingMap")).outgoingMap || {};
        if (ol.step === 0) {
          map.subject = captureEntry(el);
          await F.set({ outgoingMap: map, outgoingLearn: { active: true, step: 1 } });
          F.toast("Emnefelt koblet. Klikk nå i tekstfeltet for meldingen.", "ok");
        } else {
          map.body = captureEntry(el);
          await F.set({ outgoingMap: map, outgoingLearn: { active: false, step: 0 } });
          F.toast("Ny melding koblet! KI-linjen vises ved tekstfeltet. ✔", "ok");
        }
      }
    },
    true // capture-fase, foran PasientSky sin egen logikk
  );

  async function toggleDialogLearn() {
    const { dialogLearn: st } = await F.get("dialogLearn");
    if (st && st.active) {
      await F.set({ dialogLearn: { active: false, step: 0 } });
      F.toast("Dialogkobling avbrutt.", "");
    } else {
      await F.set({
        dialogMap: {},
        dialogLearn: { active: true, step: 0 },
        outgoingLearn: { active: false, step: 0 }
      });
      F.toast("Klikk på pasientens melding i dialogen.", "ok");
    }
  }

  async function toggleOutgoingLearn() {
    const { outgoingLearn: st } = await F.get("outgoingLearn");
    if (st && st.active) {
      await F.set({ outgoingLearn: { active: false, step: 0 } });
      F.toast("Kobling av ny melding avbrutt.", "");
    } else {
      await F.set({
        outgoingMap: {},
        outgoingLearn: { active: true, step: 0 },
        dialogLearn: { active: false, step: 0 }
      });
      F.toast("Klikk i EMNEFELTET i «ny melding»-visningen.", "ok");
    }
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

  function readMessageText(el) {
    return ((el.innerText || el.textContent || "") + "").trim();
  }

  function ownedEl(entry) {
    if (!entry || entry.key !== F.frameKey()) return null;
    return F.findElement(entry);
  }

  /* ---------------- henting på tvers av frames ---------------- */
  let pendingExtract = null;

  function extractHere(map) {
    const el = findMessageEl(map.message);
    if (!el) return { error: "Fant ikke pasientmeldingen – koble dialogen på nytt." };
    const text = readMessageText(el);
    if (!text) return { error: "Pasientmeldingen ser tom ut – koble dialogen på nytt." };
    return { text };
  }

  async function getPatientMessage(map) {
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
        reject(new Error("Fikk ikke hentet pasientmeldingen. Koble dialogen på nytt."));
      }, 4000);
      pendingExtract = {
        req,
        resolve: (t) => { clearTimeout(timer); pendingExtract = null; resolve(t); },
        reject: (e) => { clearTimeout(timer); pendingExtract = null; reject(e); }
      };
    });
    await F.set({ dialogExtract: { req } });
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
    const map = dialogMap && dialogMap.message ? dialogMap : ((await F.get("dialogMap")).dialogMap || {});
    if (!map.message || map.message.key !== F.frameKey()) return;
    const r = extractHere(map);
    await F.set({ dialogExtract: { req: v.req, text: r.text, error: r.error } });
  }

  /* ---------------- verktøylinje ---------------- */
  let bar = null;
  let panel = null; // prøvesvar-panel
  let barMode = null;         // "svar" | "utgaaende" | null
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

  function tick() {
    // Utgående visning har forrang: der finnes både emne- og tekstfelt.
    let mode = null;
    let anchor = null;
    const subjEl = ownedEl(outgoingMap.subject);
    const bodyEl = subjEl ? ownedEl(outgoingMap.body) : null;
    if (subjEl && bodyEl) {
      mode = "utgaaende";
      anchor = bodyEl;
    } else {
      const replyEl = ownedEl(dialogMap.reply);
      if (replyEl) { mode = "svar"; anchor = replyEl; }
    }

    if (!mode) {
      barMode = null;
      anchorEl = null;
      if (bar) bar.style.display = "none";
      if (panel) panel.style.display = "none";
      return;
    }

    anchorEl = anchor;
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

  async function onGenerate(opts) {
    opts = opts || {};
    if (generating || !barMode) return;
    const mode = barMode;
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
        const melding = await getPatientMessage(dialogMap);
        payload = { action: "flkGenerate", mode: "svar", stikkord, melding };
      }

      const resp = await sendToBackground(payload);
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Ukjent feil ved generering.");

      if (mode === "utgaaende") {
        const subjEl = ownedEl(outgoingMap.subject);
        const bodyEl = ownedEl(outgoingMap.body);
        if (!bodyEl) throw new Error("Fant ikke tekstfeltet – koble ny melding på nytt.");
        if (subjEl && resp.emne) F.fillField(subjEl, resp.emne);
        F.fillField(bodyEl, resp.svar);
      } else {
        const replyEl = ownedEl(dialogMap.reply);
        if (!replyEl) throw new Error("Fant ikke svarfeltet – koble dialogen på nytt.");
        F.fillField(replyEl, resp.svar);
      }

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
    if (generating || !barMode) return;
    try {
      if (barMode === "utgaaende") {
        const subjEl = ownedEl(outgoingMap.subject);
        const bodyEl = ownedEl(outgoingMap.body);
        if (!bodyEl) throw new Error("Fant ikke tekstfeltet – koble ny melding på nytt.");
        if (subjEl && b.emne) F.fillField(subjEl, b.emne);
        F.fillField(bodyEl, b.tekst || "");
      } else {
        const replyEl = ownedEl(dialogMap.reply);
        if (!replyEl) throw new Error("Fant ikke svarfeltet – koble dialogen på nytt.");
        F.fillField(replyEl, b.tekst || "");
      }
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
    if (changes.dialogLearn) dialogLearn = changes.dialogLearn.newValue || { active: false, step: 0 };
    if (changes.outgoingLearn) outgoingLearn = changes.outgoingLearn.newValue || { active: false, step: 0 };
    if (changes.dialogMap) dialogMap = changes.dialogMap.newValue || {};
    if (changes.outgoingMap) outgoingMap = changes.outgoingMap.newValue || {};
    if (changes.dialogExtract) handleExtractChange(changes.dialogExtract.newValue);
    for (const k of Object.keys(changes)) {
      if (k.indexOf("qb.") === 0) { loadQuickButtons(); break; }
    }
  });

  /* ---------------- popup-meldinger ---------------- */
  try {
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
        // kun toppvinduet svarer, ellers toggles tilstanden én gang per frame
        if (!msg || !isTop) return false;
        if (msg.action === "startDialogLearn") { toggleDialogLearn(); sendResponse({ ok: true }); }
        else if (msg.action === "startOutgoingLearn") { toggleOutgoingLearn(); sendResponse({ ok: true }); }
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
