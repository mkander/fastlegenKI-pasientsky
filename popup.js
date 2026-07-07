/* popup.js — sender kommandoer til innholdsskriptet i aktiv fane */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);

  function activeTab() {
    return new Promise((res) => chrome.tabs.query({ active: true, currentWindow: true }, (t) => res(t[0])));
  }
  function send(action) {
    activeTab().then((tab) => {
      if (tab) chrome.tabs.sendMessage(tab.id, { action }, () => void chrome.runtime.lastError);
      window.close();
    });
  }

  activeTab().then((tab) => {
    const url = (tab && tab.url) || "";
    const ctx = $("ctx");
    if (/:\/\/[^/]*fastlegen\.com/.test(url)) ctx.textContent = "Aktiv fane: FastlegeKI (kilde).";
    else if (/:\/\/[^/]*pasientsky\.no/.test(url)) ctx.textContent = "Aktiv fane: PasientSky (mål).";
    else ctx.textContent = "Åpne FastlegeKI eller PasientSky i denne fanen.";
  });

  $("transfer").addEventListener("click", () => send("transfer"));
  $("learn").addEventListener("click", () => send("startLearn"));
  $("paste").addEventListener("click", () => send("fill"));
  $("learnDialog").addEventListener("click", () => send("startDialogLearn"));
  $("opts").addEventListener("click", (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
})();
