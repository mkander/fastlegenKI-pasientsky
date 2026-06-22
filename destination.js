/* destination.js — kjører på PasientSky (pasientsky.no), i ALLE frames.
 *
 * To moduser:
 *   - Lær-felt-modus: bruker klikker på de 4 journalfeltene i rekkefølge.
 *     Hvert felt lagres med en robust selektor + kjennetegn og hvilken frame
 *     det hører til.
 *   - Lim inn: fyller de 4 feltene med delene fra FastlegeKI. Hver frame fyller
 *     bare sine egne felt (matchet på origin+pathname).
 *
 * UI (panel nede til venstre) vises kun i toppvinduet. Selve klikk-fangsten og
 * fyllingen skjer i alle frames, slik at felter inne i iframes også treffes.
 * Koordinering går via chrome.storage (delt på tvers av frames). */
(function () {
  "use strict";
  const F = window.FLK;
  if (!F) return;
  const isTop = window.top === window.self;

  /* ---------------- lær-felt-modus (alle frames) ---------------- */
  // Cache av lærtilstanden så vi slipper en storage-lesning ved hvert klikk.
  let learnStateCache = { active: false, index: 0 };
  F.get("learnState").then((r) => { learnStateCache = r.learnState || learnStateCache; });

  async function getLearnState() {
    const { learnState } = await F.get("learnState");
    return learnState || { active: false, index: 0 };
  }

  document.addEventListener(
    "click",
    async function (e) {
      if (!learnStateCache.active) return; // rask sjekk; ingen storage-lesning
      const st = await getLearnState();
      if (!st.active) return;
      const el = F.editableFrom(e.target);
      if (!el) return;

      e.preventDefault();
      e.stopPropagation();

      const entry = {
        key: F.frameKey(),
        frameUrl: location.href,
        selector: F.cssPath(el),
        attrs: F.captureAttrs(el)
      };

      const map = await F.getFieldMap();
      map[st.index] = entry;

      const next = st.index + 1;
      const stillActive = next < 4;
      await F.set({
        fieldMap: map,
        learnState: { active: stillActive, index: stillActive ? next : 0 }
      });

      F.toast(
        stillActive
          ? "Felt " + (st.index + 1) + " koblet. Klikk på felt " + (next + 1) + "."
          : "Alle 4 felt er koblet! ✔",
        "ok"
      );
    },
    true // capture-fase: fanger klikket før PasientSky sin egen logikk
  );

  /* ---------------- lim inn (alle frames) ---------------- */
  async function doFill() {
    const transfer = await F.getTransfer();
    if (!transfer || !transfer.parts) {
      if (isTop) F.toast("Ingen tekst klar. Trykk «Overfør tekst» i FastlegeKI først.", "error");
      return;
    }
    const map = await F.getFieldMap();
    const myKey = F.frameKey();
    let filled = 0;
    let missing = 0;
    const used = new Set();

    map.forEach((entry, i) => {
      if (!entry || entry.key !== myKey) return; // tilhører en annen frame
      const part = transfer.parts[i];
      if (!part || !part.trim()) return; // ikke overskriv med tom tekst
      const el = F.findElement(entry);
      if (el && !used.has(el)) { used.add(el); F.fillField(el, part); filled++; }
      else missing++; // ikke funnet, eller allerede brukt (unngå dobbel-fylling)
    });

    if (isTop && filled === 0 && missing === 0) {
      // toppframen hadde ingen matchende felt – sannsynligvis ligger de i en iframe.
      // Iframene fyller selv; vi gir bare tilbakemelding hvis ingen felt er koblet.
      const anyMapped = map.some((m) => m && m.selector);
      if (!anyMapped) F.toast("Ingen felt er koblet ennå. Trykk «Koble felt» og klikk på de 4 feltene.", "error");
    }
    if (filled > 0) F.toast("Limte inn " + filled + " felt.", "ok");
  }

  /* ---------------- reager på storage-endringer ---------------- */
  F.onChanged((changes, area) => {
    if (area !== "local") return;
    if (changes.learnState) learnStateCache = changes.learnState.newValue || { active: false, index: 0 };
    if (changes.fillTrigger) doFill();
    if (isTop && (changes.learnState || changes.fieldMap || changes.transfer)) updatePanel();
  });

  /* ---------------- panel (kun toppvindu) ---------------- */
  let panel = null;

  async function updatePanel() {
    if (!isTop || !panel) return;
    const st = await getLearnState();
    const map = await F.getFieldMap();
    const transfer = await F.getTransfer();
    const mapped = map.filter((m) => m && m.selector).length;

    const learnBtn = panel.querySelector("#flk-learn");
    const statusEl = panel.querySelector("#flk-status");

    if (st.active) {
      learnBtn.textContent = "Avbryt kobling (felt " + (st.index + 1) + "/4)";
      learnBtn.classList.add("flk-active");
    } else {
      learnBtn.textContent = mapped >= 4 ? "Koble felt på nytt" : "Koble felt (" + mapped + "/4)";
      learnBtn.classList.remove("flk-active");
    }

    statusEl.textContent =
      (mapped >= 4 ? "Felter koblet. " : "Mangler kobling (" + mapped + "/4). ") +
      (transfer ? "Tekst klar." : "Ingen tekst.");

    // Skjul boksen når alle 4 felt er koblet og kobling ikke pågår.
    // Den vises igjen når feltkobling startes (panel-knapp eller utvidelsesknapp),
    // eller hvis koblingen ikke er fullført.
    const shouldShow = st.active || mapped < 4;
    panel.style.display = shouldShow ? "" : "none";
  }

  async function toggleLearn() {
    const st = await getLearnState();
    if (st.active) {
      await F.set({ learnState: { active: false, index: 0 } });
      F.toast("Feltkobling avbrutt.", "");
    } else {
      await F.set({ fieldMap: [], learnState: { active: true, index: 0 } });
      F.toast("Klikk på felt 1 i journalen.", "ok");
    }
  }

  function mountPanel() {
    if (!isTop || panel || !document.body) return;
    panel = document.createElement("div");
    panel.id = "flk-panel";
    panel.className = "flk-panel";
    panel.innerHTML =
      '<div class="flk-panel-title">FastlegeKI → PasientSky</div>' +
      '<div id="flk-status" class="flk-panel-status">…</div>' +
      '<button id="flk-learn" type="button" class="flk-btn">Koble felt</button>';
    document.body.appendChild(panel);
    panel.querySelector("#flk-learn").addEventListener("click", toggleLearn);
    updatePanel();
  }

  /* ---------------- popup-meldinger ---------------- */
  try {
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
        if (!msg) return false;
        if (msg.action === "startLearn") { toggleLearn(); sendResponse({ ok: true }); }
        else if (msg.action === "fill") { doFill(); sendResponse({ ok: true }); }
        return false;
      });
    }
  } catch (e) {}

  if (isTop) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mountPanel);
    } else {
      mountPanel();
    }
    setInterval(mountPanel, 2500); // SPA-robusthet
  }
})();
