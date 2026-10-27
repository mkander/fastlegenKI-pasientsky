/* source.js — kjører på FastlegeKI (fastlegen.com).
 * Legger en flytende «Overfør tekst»-knapp som hovrer nederst til venstre inni
 * kildefeltet (#responseBox), eller nede til venstre i vinduet hvis feltet
 * ikke finnes. Ved klikk:
 *   1) henter notatet: trykker FastlegeKI sin «Kopier»-knapp (#copyBtn) og
 *      bruker teksten den kopierer (fanget av copyhook.js). Reserve: les
 *      utklippstavlen, deretter teksten i kildefeltet som før,
 *   2) deler den i 4 deler på de konfigurerte overskriftene,
 *   3) lagrer delene i chrome.storage,
 *   4) ber en evt. åpen PasientSky-fane om å lime inn automatisk. */
(function () {
  "use strict";
  const F = window.FLK;
  if (!F) { console.error("[FLK] util.js (window.FLK) lastet ikke – kilde-script avbrutt"); return; }
  if (window.top !== window.self) return; // kun toppvinduet
  console.log("[FLK] kilde-script lastet på", location.href);

  let btn = null;
  let sourceSelector = "#responseBox";
  let copyButtonSelector = "#copyBtn";

  F.getSettings().then((s) => {
    sourceSelector = s.sourceField || "#responseBox";
    copyButtonSelector = s.copyButton || "#copyBtn";
  });

  function findSourceField(selector) {
    let el = null;
    try { el = document.querySelector(selector); } catch (e) {}
    if (el) return el;
    return document.getElementById("responseBox"); // fallback
  }

  function findCopyButton(selector) {
    let el = null;
    try { el = document.querySelector(selector || "#copyBtn"); } catch (e) {}
    return el || document.getElementById("copyBtn");
  }

  // Trykk FastlegeKI sin «Kopier»-knapp og vent på teksten den kopierer
  // (copyhook.js sender den som «flk-copied»). Faller tilbake til å lese
  // utklippstavlen. Gir "" hvis ingenting kom.
  function textViaCopyButton(copyBtn) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (t) => {
        if (done) return;
        done = true;
        document.removeEventListener("flk-copied", onCopied);
        clearTimeout(timer);
        resolve(typeof t === "string" ? t : "");
      };
      const onCopied = (e) => { if (typeof e.detail === "string" && e.detail.trim()) finish(e.detail); };
      document.addEventListener("flk-copied", onCopied);
      const timer = setTimeout(async () => {
        // ingen tekst fanget: prøv å lese utklippstavlen direkte
        try { finish(await navigator.clipboard.readText()); } catch (e) { finish(""); }
      }, 1500);
      try { copyBtn.click(); } catch (e) { finish(""); }
    });
  }

  function readValue(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
    // innerText bevarer linjeskift (<br>, blokker), som overskrifts-delingen trenger
    return el.innerText || el.textContent || "";
  }

  async function transfer() {
    console.log("[FLK] Overfør tekst trykket");
    try {
      const settings = await F.getSettings();
      let text = "";
      const copyBtn = findCopyButton(settings.copyButton);
      if (copyBtn) text = (await textViaCopyButton(copyBtn)).trim();
      if (!text) {
        // reserve: les kildefeltet direkte (slik det var før «Kopier»-knappen)
        const field = findSourceField(settings.sourceField);
        if (field) text = readValue(field).trim();
        else if (!copyBtn) {
          F.toast("Fant verken «Kopier»-knappen eller kildefeltet i FastlegeKI.", "error");
          return;
        }
      }
      if (!text) {
        F.toast("Fant ingen notattekst å overføre.", "error");
        return;
      }

      const parts = F.splitByHeadings(text, settings.headings, settings.includeHeading);
      const nonEmpty = parts.filter((p) => p && p.trim()).length;
      if (nonEmpty === 0) {
        F.toast("Fant ingen av overskriftene i teksten. Sjekk overskriftene i innstillingene.", "error");
        return;
      }

      await F.set({
        transfer: { parts, ts: Date.now() },
        fillTrigger: Date.now() // ber PasientSky-fanen lime inn automatisk
      });

      F.toast("Tekst delt i " + nonEmpty + " del(er) og sendt. Bytt til PasientSky-fanen.", "ok");
    } catch (e) {
      console.error("[FLK] Feil i transfer()", e);
      try { F.toast("Feil ved overføring: " + (e && e.message ? e.message : e), "error"); } catch (_) {}
    }
  }

  // Plasser knappen så den hovrer nederst til venstre inni kildefeltet.
  function positionBtn() {
    if (!btn) return;
    const field = findSourceField(sourceSelector);
    const r = field ? field.getBoundingClientRect() : null;
    if (!r || (r.width === 0 && r.height === 0)) {
      // Feltet finnes ikke (lenger): vis knappen nede til venstre hvis
      // «Kopier»-knappen finnes, ellers skjul den.
      btn.classList.remove("flk-fab-inbox");
      btn.style.left = "";
      btn.style.top = "";
      btn.style.display = findCopyButton(copyButtonSelector) ? "" : "none";
      return;
    }
    btn.classList.add("flk-fab-inbox");
    btn.style.display = "";
    const bh = btn.offsetHeight || 34;
    btn.style.left = Math.round(r.left + 10) + "px";
    btn.style.top = Math.round(r.bottom - bh - 10) + "px";
  }

  function mount() {
    if (!btn && document.body) {
      btn = document.createElement("button");
      btn.id = "flk-transfer-btn";
      btn.type = "button";
      btn.className = "flk-fab flk-fab-inbox";
      btn.innerHTML = '<span class="flk-fab-icon">⇅</span><span>Overfør tekst</span>';
      btn.title = "Del notatet på overskrifter og send til PasientSky";
      btn.addEventListener("click", transfer);
      document.body.appendChild(btn);
    }
    positionBtn();
  }

  // svar på popup-meldinger
  try {
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
        if (msg && msg.action === "transfer") { transfer(); sendResponse({ ok: true }); }
        return false;
      });
    }
  } catch (e) {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
  // Hold knappen riktig plassert ved scroll, resize og SPA-re-render
  window.addEventListener("scroll", positionBtn, true);
  window.addEventListener("resize", positionBtn);
  setInterval(mount, 1000);
})();
