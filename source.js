/* source.js — kjører på FastlegeKI (fastlegen.com).
 * Legger en flytende «Overfør tekst»-knapp som hovrer nederst til venstre inni
 * kildefeltet (#responseBox). Ved klikk:
 *   1) leser notatteksten fra kildefeltet,
 *   2) deler den i 4 deler på de konfigurerte overskriftene,
 *   3) lagrer delene i chrome.storage,
 *   4) ber en evt. åpen PasientSky-fane om å lime inn automatisk. */
(function () {
  "use strict";
  const F = window.FLK;
  if (!F || window.top !== window.self) return; // kun toppvinduet

  let btn = null;
  let sourceSelector = "#responseBox";

  F.getSettings().then((s) => { sourceSelector = s.sourceField || "#responseBox"; });

  function findSourceField(selector) {
    let el = null;
    try { el = document.querySelector(selector); } catch (e) {}
    if (el) return el;
    return document.getElementById("responseBox"); // fallback
  }

  function readValue(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
    if (el.isContentEditable) return el.innerText || "";
    return el.textContent || "";
  }

  async function transfer() {
    const settings = await F.getSettings();
    const field = findSourceField(settings.sourceField);
    if (!field) {
      F.toast("Fant ikke kildefeltet (" + settings.sourceField + ").", "error");
      return;
    }
    const text = readValue(field).trim();
    if (!text) {
      F.toast("Kildefeltet er tomt – ingen tekst å overføre.", "error");
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
  }

  // Plasser knappen så den hovrer nederst til venstre inni kildefeltet.
  function positionBtn() {
    if (!btn) return;
    const field = findSourceField(sourceSelector);
    if (!field) { btn.style.display = "none"; return; }
    const r = field.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { btn.style.display = "none"; return; }
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
