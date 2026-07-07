/* dialog.js — kjører på PasientSky (pasientsky.no), i ALLE frames.
 *
 * KI-generert svar på e-konsultasjon:
 *   1. «Koble dialog»-modus (startes fra utvidelsens popup): klikk først på
 *      pasientens melding, deretter på svarfeltet. Begge lagres med robust
 *      selektor + kjennetegn + frame, på samme måte som journalfeltene.
 *   2. Når svarfeltet finnes i en frame, vises en liten linje over feltet med
 *      stikkord-input og «Generer svar»-knapp.
 *   3. Ved klikk hentes pasientmeldingen (evt. fra en annen frame via
 *      chrome.storage-handshake), background.js kaller Claude API, svaret
 *      skrives inn i svarfeltet og journalnotatet legges på utklippstavlen. */
(function () {
  "use strict";
  const F = window.FLK;
  if (!F) return;
  const isTop = window.top === window.self;

  /* ---------------- cache av lagret tilstand ---------------- */
  let learnCache = { active: false, step: 0 };
  let mapCache = {};
  F.get(["dialogLearn", "dialogMap"]).then((r) => {
    learnCache = r.dialogLearn || learnCache;
    mapCache = r.dialogMap || {};
  });

  async function getLearn() {
    const { dialogLearn } = await F.get("dialogLearn");
    return dialogLearn || { active: false, step: 0 };
  }
  async function getMap() {
    const { dialogMap } = await F.get("dialogMap");
    return dialogMap || {};
  }

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

  document.addEventListener(
    "click",
    async function (e) {
      if (!learnCache.active) return; // rask sjekk uten storage-lesning
      const st = await getLearn();
      if (!st.active) return;

      e.preventDefault();
      e.stopPropagation();

      const map = await getMap();
      if (st.step === 0) {
        const el = messageContainerFrom(e.target);
        map.message = { key: F.frameKey(), selector: F.cssPath(el), attrs: F.captureAttrs(el) };
        await F.set({ dialogMap: map, dialogLearn: { active: true, step: 1 } });
        F.toast("Pasientmelding koblet. Klikk nå i svarfeltet (der du skriver svar).", "ok");
      } else {
        const el = F.editableFrom(e.target);
        if (!el) {
          F.toast("Det var ikke et skrivefelt – klikk i selve svarfeltet.", "error");
          return;
        }
        map.reply = { key: F.frameKey(), selector: F.cssPath(el), attrs: F.captureAttrs(el) };
        await F.set({ dialogMap: map, dialogLearn: { active: false, step: 0 } });
        F.toast("Svarfelt koblet! «Generer svar» vises ved svarfeltet. ✔", "ok");
      }
    },
    true // capture-fase, foran PasientSky sin egen logikk
  );

  async function toggleLearn() {
    const st = await getLearn();
    if (st.active) {
      await F.set({ dialogLearn: { active: false, step: 0 } });
      F.toast("Dialogkobling avbrutt.", "");
    } else {
      await F.set({ dialogMap: {}, dialogLearn: { active: true, step: 0 } });
      F.toast("Klikk på pasientens melding i dialogen.", "ok");
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
    // Svar på en forespørsel vi selv venter på
    if (v.text != null || v.error) {
      if (pendingExtract && pendingExtract.req === v.req) {
        if (v.error) pendingExtract.reject(new Error(v.error));
        else pendingExtract.resolve(v.text);
      }
      return;
    }
    // Ny forespørsel: er meldingselementet i denne framen?
    const map = mapCache && mapCache.message ? mapCache : await getMap();
    if (!map.message || map.message.key !== F.frameKey()) return;
    const r = extractHere(map);
    await F.set({ dialogExtract: { req: v.req, text: r.text, error: r.error } });
  }

  /* ---------------- verktøylinje ved svarfeltet ---------------- */
  let bar = null;
  let generating = false;
  let lastJournal = "";

  function mountBar() {
    if (bar || !document.body) return;
    bar = document.createElement("div");
    bar.id = "flk-ai-bar";
    bar.className = "flk-ai-bar";
    bar.style.display = "none";
    bar.innerHTML =
      '<input id="flk-ai-stikkord" class="flk-ai-input" type="text" ' +
      'placeholder="Stikkord (feks «resept sendt, kort»)" title="Stikkord og føring til KI-en – kan stå tomt" />' +
      '<button id="flk-ai-generate" type="button" class="flk-ai-btn flk-ai-primary">✨ Generer svar</button>' +
      '<button id="flk-ai-copy" type="button" class="flk-ai-btn" style="display:none" ' +
      'title="Kopier journalnotatet til utklippstavlen">📋 Kopier notat</button>';
    document.body.appendChild(bar);
    bar.querySelector("#flk-ai-generate").addEventListener("click", onGenerate);
    bar.querySelector("#flk-ai-copy").addEventListener("click", onCopyJournal);
    const input = bar.querySelector("#flk-ai-stikkord");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); onGenerate(); }
      e.stopPropagation(); // ikke la PasientSky-snarveier fange tastetrykk
    });
  }

  function positionBar() {
    if (!bar || bar.style.display === "none") return;
    const el = F.findElement(mapCache.reply);
    if (!el) { bar.style.display = "none"; return; }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { bar.style.display = "none"; return; }
    const bh = bar.offsetHeight || 40;
    let top = r.top - bh - 6;
    if (top < 4) top = r.bottom + 6; // ikke plass over feltet → legg under
    bar.style.left = Math.max(4, Math.round(r.left)) + "px";
    bar.style.top = Math.round(top) + "px";
  }

  function tick() {
    const owns = mapCache && mapCache.reply && mapCache.reply.key === F.frameKey();
    if (!owns) { if (bar) bar.style.display = "none"; return; }
    mountBar();
    const el = F.findElement(mapCache.reply);
    if (!el) { bar.style.display = "none"; return; }
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

  async function onGenerate() {
    if (generating) return;
    const map = mapCache;
    if (!map || !map.message || !map.reply) {
      F.toast("Dialogen er ikke koblet. Bruk «Koble dialog» i utvidelsens popup.", "error");
      return;
    }
    const btn = bar.querySelector("#flk-ai-generate");
    const copyBtn = bar.querySelector("#flk-ai-copy");
    generating = true;
    btn.disabled = true;
    btn.textContent = "Genererer…";
    copyBtn.style.display = "none";
    try {
      const melding = await getPatientMessage(map);
      const stikkord = bar.querySelector("#flk-ai-stikkord").value;
      const resp = await sendToBackground({ action: "flkGenerate", stikkord, melding });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Ukjent feil ved generering.");

      const el = F.findElement(map.reply);
      if (!el) throw new Error("Fant ikke svarfeltet – koble dialogen på nytt.");
      F.fillField(el, resp.svar);

      lastJournal = resp.journalnotat || "";
      const copied = await tryCopy(lastJournal);
      if (copied) {
        F.toast("Svar lagt inn. Journalnotatet ligger på utklippstavlen. ✔", "ok");
      } else {
        copyBtn.style.display = "";
        F.toast("Svar lagt inn. Trykk «Kopier notat» for journalnotatet.", "ok");
      }
    } catch (e) {
      F.toast("Generering feilet: " + (e && e.message ? e.message : e), "error");
    } finally {
      generating = false;
      btn.disabled = false;
      btn.textContent = "✨ Generer svar";
      positionBar();
    }
  }

  async function onCopyJournal() {
    const ok = await tryCopy(lastJournal);
    if (ok) {
      bar.querySelector("#flk-ai-copy").style.display = "none";
      F.toast("Journalnotat kopiert. ✔", "ok");
    } else {
      F.toast("Kopiering feilet – marker og kopier manuelt.", "error");
    }
  }

  /* ---------------- storage-endringer ---------------- */
  F.onChanged((changes, area) => {
    if (area !== "local") return;
    if (changes.dialogLearn) learnCache = changes.dialogLearn.newValue || { active: false, step: 0 };
    if (changes.dialogMap) mapCache = changes.dialogMap.newValue || {};
    if (changes.dialogExtract) handleExtractChange(changes.dialogExtract.newValue);
  });

  /* ---------------- popup-meldinger ---------------- */
  try {
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
        // kun toppvinduet svarer, ellers toggles tilstanden én gang per frame
        if (msg && msg.action === "startDialogLearn" && isTop) {
          toggleLearn();
          sendResponse({ ok: true });
        }
        return false;
      });
    }
  } catch (e) {}

  /* ---------------- oppstart ---------------- */
  setInterval(tick, 900); // SPA-robusthet: dialoger åpnes/lukkes dynamisk
  window.addEventListener("scroll", positionBar, true);
  window.addEventListener("resize", positionBar);
})();
