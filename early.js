/* early.js — kjører på PasientSky (pasientsky.no), kun toppvinduet, ved
 * document_start: FØR PasientSky sin egen kode, så lytteren under kommer
 * først i køen.
 *
 * PasientSky lukker små vinduer (som eKontakt) når de mister fokus: iframen
 * sender { command: "window-blur", frameId } til toppvinduet. Når du klikker i
 * KI-linjen (som dialog.js tegner i toppvinduet over vinduet), flyttes fokus
 * dit – og vinduet ville lukket seg. Her stoppes den beskjeden når fokuset
 * gikk til KI-linjen, så PasientSky aldri ser den.
 *
 * I tillegg har vinduet en «klikk utenfor meg»-sjekk som lytter på klikk i
 * hele toppvinduet i capture-fasen (logger «click was not inside me»), altså
 * på vei NED til knappen. Derfor fanges muse-/pekerhendelser på KI-linjen
 * her, på window i capture-fasen (før PasientSky), stoppes, og knappens
 * handling kjøres direkte via onClick. Klikk andre steder går uendret videre.
 *
 * dialog.js fyller inn window.__flkEarly (samme isolerte verden):
 *   ours(el)    → er elementet en del av KI-linjen/panelet?
 *   onClick(e)  → kjør handlingen til knappen som ble klikket
 *   guardUntil  → tidspunkt (ms) et klikk i KI-linjen nettopp skjedde
 *   frameId     → iframe-ID-en til vinduet linjen hører til (eller null) */
(function () {
  "use strict";
  if (window.top !== window.self) return;
  const st = window.__flkEarly = { ours: null, onClick: null, guardUntil: 0, frameId: null };

  const TYPES = ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick",
    "auxclick", "contextmenu", "touchstart", "touchend", "focusin"];
  for (const type of TYPES) {
    window.addEventListener(
      type,
      (e) => {
        if (!st.ours || !st.ours(e.target)) return;
        e.stopImmediatePropagation(); // PasientSky (og alt annet) ser aldri klikket
        if (type === "pointerdown" || type === "mousedown") {
          st.guardUntil = Date.now() + 1000;
          // knapper tar ikke fokus → fokus/markør blir i vinduet; tekstfelt må få fokus
          const t = e.target;
          if (type === "mousedown" && !(t.closest && t.closest("input, textarea"))) e.preventDefault();
        }
        if (type === "click" && st.onClick) st.onClick(e);
      },
      true
    );
  }

  window.addEventListener(
    "message",
    (e) => {
      const d = e.data;
      if (!d || typeof d !== "object" || d.command !== "window-blur") return;
      if (st.frameId && d.frameId && d.frameId !== st.frameId) return; // et annet vindu
      const toBar = Date.now() < st.guardUntil || (st.ours && st.ours(document.activeElement));
      if (toBar) e.stopImmediatePropagation();
    },
    true
  );
})();
