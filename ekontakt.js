/* ekontakt.js — kjører på PasientSky (pasientsky.no), i ALLE frames.
 *
 * Alt+E åpner ny eKontakt (Helsenorge) ved å sende samme handling som
 * PasientSky-modulene selv bruker, til toppvinduets handlingskanal:
 *   postMessage { actionType: "clientAction",
 *                 action: "norwegianehr.newHelseNorgeEContact", frameId }
 *
 * eKontakt åpnes uten pasient. Har PasientSky en aktiv pasient, viser skjemaet
 * knappen «Bruk aktiv pasient» – den trykkes automatisk når eKontakt er åpnet
 * med Alt+E. Det er PasientSky selv som bestemmer hvem som er aktiv pasient;
 * utvidelsen gjetter aldri. Uten aktiv pasient vises ingen knapp, og du
 * velger pasient i skjemaet.
 *
 * Koordinering (kun innen samme fane, via postMessage):
 *   toppvinduet → alle under-iframer: { __flk: "ekAuto" } rett etter Alt+E
 *   ny iframe → toppvinduet: { __flk: "ekAutoQuery" } når den lastes, i
 *     tilfelle eKontakt-vinduet er en iframe som lages etter Alt+E
 *   iframen som trykket knappen → toppvinduet: { __flk: "ekAutoDone" } */
(function () {
  "use strict";
  const F = window.FLK;
  if (!F) return;
  const isTop = window.top === window.self;

  const AUTO_WINDOW_MS = 10000; // hvor lenge etter Alt+E vi ser etter knappen
  const ACTIVE_BTN = /^bruk aktiv pasient$/i;

  /* ---------------- Alt+E (alle frames) ---------------- */
  // På window i capture-fasen, så vi kommer foran PasientSky sin egen
  // hurtigtast-håndtering (Alt+E = Epikrise elektronisk i PasientSky).
  window.addEventListener(
    "keydown",
    function (e) {
      // AltGr er Ctrl+Alt på Windows (AltGr+E = €) og skal ikke fanges.
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== "KeyE") return;
      e.preventDefault(); // også Chromes egen Alt+E-meny og Option+E (´) på Mac
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (isTop) openEkontakt();
      else { try { window.top.postMessage({ __flk: "ekOpen" }, "*"); } catch (err) {} }
    },
    true
  );

  /* ---------------- «Bruk aktiv pasient» (under-iframer) ---------------- */
  let polling = false;

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findActivePatientButton() {
    for (const el of document.querySelectorAll('button, a, [role="button"]')) {
      const t = ((el.textContent || "") + "").replace(/\s+/g, " ").trim();
      if (ACTIVE_BTN.test(t) && isVisible(el) && !el.disabled) return el;
    }
    return null;
  }

  // Se etter knappen en stund (skjemaet rendres gjerne litt etter at vinduet
  // åpnes), trykk den én gang og meld fra til toppvinduet.
  function pollForActivePatient(ms) {
    if (polling || isTop) return;
    polling = true;
    const until = Date.now() + ms;
    const timer = setInterval(() => {
      const btn = findActivePatientButton();
      if (btn) {
        clearInterval(timer);
        polling = false;
        btn.click();
        try { window.top.postMessage({ __flk: "ekAutoDone" }, "*"); } catch (e) {}
      } else if (Date.now() > until) {
        clearInterval(timer);
        polling = false;
      }
    }, 150);
  }

  if (!isTop) {
    window.addEventListener("message", (e) => {
      const d = e.data;
      if (!d || typeof d !== "object" || d.__flk !== "ekAuto" || e.source !== window.top) return;
      pollForActivePatient(typeof d.ms === "number" ? Math.min(d.ms, AUTO_WINDOW_MS) : AUTO_WINDOW_MS);
    });
    // eKontakt-vinduet kan være en iframe som lages etter Alt+E: spør toppvinduet.
    try { window.top.postMessage({ __flk: "ekAutoQuery" }, "*"); } catch (e) {}
    return;
  }

  /* ---------------- toppvinduet ---------------- */
  let autoUntil = 0; // Alt+E nylig: se etter «Bruk aktiv pasient» fram til da

  function broadcastAuto(target) {
    const ms = autoUntil - Date.now();
    if (ms <= 0) return;
    const msg = { __flk: "ekAuto", ms };
    if (target) { try { target.postMessage(msg, "*"); } catch (e) {} return; }
    for (let i = 0; i < window.frames.length; i++) {
      try { window.frames[i].postMessage(msg, "*"); } catch (e) {}
    }
  }

  window.addEventListener(
    "message",
    (e) => {
      const d = e.data;
      if (!d || typeof d !== "object" || typeof d.__flk !== "string") return;
      if (d.__flk === "ekOpen") openEkontakt();
      else if (d.__flk === "ekAutoQuery") broadcastAuto(e.source);
      else if (d.__flk === "ekAutoDone" && autoUntil) {
        autoUntil = 0;
        F.toast("Aktiv pasient lagt inn i eKontakt – sjekk at det er riktig pasient. ✔", "ok");
      }
    },
    true
  );

  // Handlingen må oppgi en frameId; lån en modul-iframe (som PasientSky selv).
  function pickFrameId() {
    const ids = Array.from(document.querySelectorAll("iframe[id]")).map((f) => f.id);
    return ids.find((id) => /^modulePane/.test(id)) || ids.find((id) => /^spareaction/.test(id)) || ids[0] || null;
  }

  function openEkontakt() {
    const frameId = pickFrameId();
    if (!frameId) {
      F.toast("Fant ikke PasientSky-modulene – er PasientSky ferdig lastet?", "error");
      return;
    }
    autoUntil = Date.now() + AUTO_WINDOW_MS;
    window.postMessage({
      id: crypto.randomUUID(),
      actionType: "clientAction",
      action: "norwegianehr.newHelseNorgeEContact",
      parameters: {},
      parentId: null,
      frameId
    }, "*");
    broadcastAuto(); // eksisterende (gjenbrukte) vinduer
    F.toast("Åpner eKontakt …", "");
  }
})();
