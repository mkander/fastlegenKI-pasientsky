/* copyhook.js — kjører på FastlegeKI (fastlegen.com) i SIDENS egen
 * JavaScript-verden ("world": "MAIN"), ved document_start.
 *
 * FastlegeKI sin «Kopier»-knapp (#copyBtn) legger hele notatet korrekt på
 * utklippstavlen. Her fanges teksten som kopieres – via
 * navigator.clipboard.writeText / .write og vanlige copy-hendelser – og
 * sendes til utvidelsens kilde-script (source.js) som en DOM-hendelse
 * «flk-copied» med teksten som detail (streng). Selve kopieringen skjer
 * uendret. Ingenting lagres her. */
(function () {
  "use strict";
  if (window.__flkCopyHook) return;
  window.__flkCopyHook = true;

  function emit(text) {
    if (typeof text !== "string" || !text) return;
    try { document.dispatchEvent(new CustomEvent("flk-copied", { detail: text })); } catch (e) {}
  }

  const cb = navigator.clipboard;
  if (cb) {
    if (typeof cb.writeText === "function") {
      const origWriteText = cb.writeText.bind(cb);
      cb.writeText = function (text) {
        emit(String(text));
        return origWriteText(text);
      };
    }
    if (typeof cb.write === "function") {
      const origWrite = cb.write.bind(cb);
      cb.write = function (items) {
        try {
          for (const item of items || []) {
            if (item && item.types && item.types.indexOf("text/plain") !== -1) {
              Promise.resolve(item.getType("text/plain"))
                .then((blob) => (typeof blob === "string" ? blob : blob.text()))
                .then(emit)
                .catch(() => {});
              break;
            }
          }
        } catch (e) {}
        return origWrite(items);
      };
    }
  }

  // execCommand("copy") / Ctrl+C: les det som ble lagt i clipboardData, ellers
  // markeringen. Lytter sist (boble-fase på window), etter sidens egne handlere.
  window.addEventListener("copy", (e) => {
    let text = "";
    try { text = e.clipboardData ? e.clipboardData.getData("text/plain") : ""; } catch (err) {}
    if (!text) {
      const a = document.activeElement;
      if (a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT") && typeof a.selectionStart === "number") {
        text = (a.value || "").slice(a.selectionStart, a.selectionEnd);
      } else {
        try { text = String(window.getSelection() || ""); } catch (err) {}
      }
    }
    emit(text);
  });
})();
