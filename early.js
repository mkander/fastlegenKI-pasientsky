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
 * dialog.js fyller inn window.__flkEarly (samme isolerte verden):
 *   ours(el)    → er elementet en del av KI-linjen/panelet?
 *   guardUntil  → tidspunkt (ms) et klikk i KI-linjen nettopp skjedde
 *   frameId     → iframe-ID-en til vinduet linjen hører til (eller null) */
(function () {
  "use strict";
  if (window.top !== window.self) return;
  const st = window.__flkEarly = { ours: null, guardUntil: 0, frameId: null };

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
