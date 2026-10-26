/* ekontakt.js — kjører på PasientSky (pasientsky.no), i ALLE frames.
 *
 * Alt+E åpner ny eKontakt (Helsenorge) ved å sende samme handling som
 * PasientSky-modulene selv bruker, til toppvinduets handlingskanal
 * (postMessage { actionType: "clientAction", action, parameters, frameId }):
 *
 *   - aktiv pasient bekreftet:  norwegianehr.newHelseNorgeDialog
 *                               { patientId, dialogType: "E_CONTACT" }
 *   - ellers:                   norwegianehr.newHelseNorgeEContact
 *                               (eKontakt uten pasient – velg i dialogen)
 *
 * Aktiv pasient finnes ikke noe sted vi kan lese direkte. Toppvinduet følger
 * derfor med på hp.setActivePatient / hp.clearActivePatient fra modulene, og
 * sikrer det mot pasientfeltet øverst (navn + fødselsnummer): når en pasient
 * aktiveres, huskes et fingeravtrykk (hash, kun i minnet) av feltet slik det
 * ser ut etter byttet. Ved Alt+E brukes pasient-ID-en bare hvis feltet fortsatt
 * har samme fingeravtrykk – er pasienten byttet på en måte vi ikke så (f.eks.
 * søk øverst), åpnes eKontakt uten pasient. Utvidelsen gjetter aldri.
 *
 * Pasientfeltet kobles én gang fra popupen (sync-nøkkel "patientField"). */
(function () {
  "use strict";
  const F = window.FLK;
  if (!F) return;
  const isTop = window.top === window.self;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const FNR = /\d{6}\s?\d{5}/;

  /* ---------------- Alt+E (alle frames) ---------------- */
  // På window i capture-fase, så vi kommer foran PasientSky sin egen
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

  /* ---------------- kobling av pasientfeltet (alle frames) ---------------- */
  let pfLearn = false;
  F.get("patientFieldLearn").then((r) => { pfLearn = !!(r.patientFieldLearn && r.patientFieldLearn.active); });

  // Klikket treffer gjerne navnet; klatre opp til elementet som også har
  // fødselsnummeret, så fingeravtrykket skiller pasienter sikkert.
  function patientContainerFrom(el) {
    let n = el;
    for (let i = 0; i < 6 && n && n.nodeType === 1 && n !== document.body; i++) {
      if (FNR.test(n.textContent || "")) return { el: n, fnr: true };
      n = n.parentElement;
    }
    return { el: el, fnr: false };
  }

  window.addEventListener(
    "click",
    function (e) {
      if (!pfLearn) return;
      e.preventDefault();
      e.stopPropagation();
      if (!isTop) {
        F.toast("Pasientfeltet må ligge i hovedvinduet – klikk på navnet/fødselsnummeret øverst i PasientSky.", "error");
        return;
      }
      const hit = patientContainerFrom(e.target);
      pfLearn = false;
      F.set({
        patientField: { selector: F.cssPath(hit.el), attrs: F.captureAttrs(hit.el) },
        patientFieldLearn: { active: false }
      });
      F.toast(hit.fnr
        ? "Pasientfelt koblet (navn + fødselsnummer). Alt+E åpner nå eKontakt for aktiv pasient. ✔"
        : "Pasientfelt koblet, men uten fødselsnummer. Koble gjerne på nytt og klikk der både navn og fødselsnummer står.", hit.fnr ? "ok" : "error");
    },
    true
  );

  async function togglePfLearn() {
    const { patientFieldLearn: st } = await F.get("patientFieldLearn");
    if (st && st.active) {
      await F.set({ patientFieldLearn: { active: false } });
      F.toast("Kobling av pasientfelt avbrutt.", "");
    } else {
      await F.set({ patientFieldLearn: { active: true } });
      F.toast("Klikk på pasientfeltet øverst (der navn og fødselsnummer på aktiv pasient står).", "ok");
    }
  }

  F.onChanged((changes) => {
    if (changes.patientFieldLearn) pfLearn = !!(changes.patientFieldLearn.newValue && changes.patientFieldLearn.newValue.active);
    if (changes.patientField && isTop) patientField = changes.patientField.newValue || null;
  });

  try {
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
        if (!msg || !isTop) return false;
        if (msg.action === "startPatientFieldLearn") { togglePfLearn(); sendResponse({ ok: true }); }
        return false;
      });
    }
  } catch (e) {}

  if (!isTop) return;

  /* ---------------- toppvinduet: aktiv pasient ---------------- */
  let patientField = null;
  F.get("patientField").then((r) => { patientField = r.patientField || null; });

  function findPatientField() {
    const pf = patientField;
    if (!pf) return null;
    const uniq = (sel) => {
      try {
        const list = document.querySelectorAll(sel);
        return list.length === 1 ? list[0] : null;
      } catch (e) { return null; }
    };
    if (pf.attrs && pf.attrs.id) {
      const el = uniq("#" + CSS.escape(pf.attrs.id));
      if (el) return el;
    }
    if (pf.selector) {
      const el = uniq(pf.selector);
      if (el) return el;
    }
    const a = pf.attrs || {};
    if (a.classes && a.classes.length) {
      const el = uniq(a.tag + "." + a.classes.map((c) => CSS.escape(c)).join("."));
      if (el) return el;
    }
    return null;
  }

  // cyrb53: rask 53-bits hash. Teksten lagres aldri, kun dette tallet i minnet.
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  // Fingeravtrykk av pasientfeltet nå, eller null (ikke koblet / ingen pasient).
  function readFp() {
    const el = findPatientField();
    if (!el) return null;
    const t = ((el.textContent || "") + "").replace(/\s+/g, " ").trim();
    return t ? hash(t) : null;
  }

  let fpNow = null;       // siste avleste fingeravtrykk
  let bound = null;       // { id, fp }: pasient-ID knyttet til feltets utseende
  let pending = null;     // { id, since }: venter på at feltet viser byttet

  function onPatientFieldChange() {
    if (pending && fpNow != null) {
      bound = { id: pending.id, fp: fpNow };
      pending = null;
    }
  }

  setInterval(() => {
    const fp = readFp();
    if (fp !== fpNow) { fpNow = fp; onPatientFieldChange(); }
    if (pending && Date.now() - pending.since > 4000) {
      // Feltet endret seg ikke. Greit hvis det er samme pasient som allerede er
      // knyttet og feltet er uendret; ellers vet vi ikke sikkert hvem som er aktiv.
      if (!(bound && bound.id === pending.id && bound.fp === fpNow)) bound = null;
      pending = null;
    }
  }, 200);

  function onSetActivePatient(id) {
    if (pending && pending.id === id) return; // PasientSky sender gjerne flere like
    const fp = readFp();
    if (fp !== fpNow && fp != null) {
      // Feltet er allerede oppdatert (PasientSky håndterte beskjeden før oss).
      fpNow = fp;
      bound = { id, fp };
      pending = null;
      return;
    }
    if (bound && bound.id === id && bound.fp === fp) return; // samme pasient på nytt
    pending = { id, since: Date.now() };
  }

  function onClearActivePatient() {
    bound = null;
    pending = null;
  }

  window.addEventListener(
    "message",
    (e) => {
      const d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.__flk === "ekOpen") { openEkontakt(); return; }
      if (typeof d.action !== "string" || !/\.pasientsky\.no$/.test(e.origin.replace(/:\d+$/, ""))) return;
      if (d.action === "hp.setActivePatient") {
        const id = d.parameters && d.parameters.patientId;
        if (typeof id === "string" && UUID.test(id)) onSetActivePatient(id);
      } else if (d.action === "hp.clearActivePatient" || d.action === "hp.clearActiveContextObject") {
        onClearActivePatient();
      }
    },
    true
  );

  /* ---------------- åpne eKontakt ---------------- */
  // Handlingene må oppgi en frameId; lån en modul-iframe (som i PasientSky selv).
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
    const fp = readFp();
    const confirmed = !!(bound && fp != null && fp === bound.fp && !pending);
    const msg = confirmed
      ? { action: "norwegianehr.newHelseNorgeDialog", parameters: { patientId: bound.id, dialogType: "E_CONTACT" } }
      : { action: "norwegianehr.newHelseNorgeEContact", parameters: {} };
    window.postMessage({
      id: crypto.randomUUID(),
      actionType: "clientAction",
      action: msg.action,
      parameters: msg.parameters,
      parentId: null,
      frameId
    }, "*");
    if (confirmed) F.toast("Åpner eKontakt for aktiv pasient.", "ok");
    else if (!patientField) F.toast("Åpner eKontakt – velg pasient. Koble pasientfeltet i popupen for å få aktiv pasient automatisk.", "");
    else F.toast("Åpner eKontakt – velg pasient (aktiv pasient ikke bekreftet).", "");
  }
})();
