/* options.js — innstillingsside.
 * Konfigurasjon lagres i chrome.storage.sync (deles mellom maskiner);
 * lær-tilstand o.l. ligger i chrome.storage.local. */
(function () {
  "use strict";
  const DEFAULTS = {
    headings: ["OVERSKRIFT1", "OVERSKRIFT2", "OVERSKRIFT3", "OVERSKRIFT4"],
    includeHeading: false,
    sourceField: "#responseBox"
  };
  const DEFAULT_MODEL = "claude-opus-5-5";
  const $ = (id) => document.getElementById(id);

  function sGet(keys) { return new Promise((r) => chrome.storage.sync.get(keys, (v) => { void chrome.runtime.lastError; r(v || {}); })); }
  function sSet(obj) { return new Promise((r) => chrome.storage.sync.set(obj, () => { void chrome.runtime.lastError; r(); })); }
  function sRemove(keys) { return new Promise((r) => chrome.storage.sync.remove(keys, () => { void chrome.runtime.lastError; r(); })); }
  function lSet(obj) { return new Promise((r) => chrome.storage.local.set(obj, () => { void chrome.runtime.lastError; r(); })); }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ==================== hurtigknapper ==================== */

  function qbRow(data) {
    data = data || {};
    const card = el("div", "card qb-card");
    const grid = el("div", "grid");

    const mk = (labelText, inputEl, full) => {
      const wrap = el("div", full ? "full" : "");
      const lab = el("label", "", labelText);
      wrap.appendChild(lab);
      wrap.appendChild(inputEl);
      return wrap;
    };

    const label = el("input"); label.type = "text"; label.placeholder = "Knappetekst"; label.value = data.label || "";
    label.className = "qb-label";

    const view = document.createElement("select");
    view.className = "qb-view";
    for (const [v, t] of [["svar", "Svar"], ["utgaaende", "Utgående"], ["begge", "Begge"]]) {
      const o = document.createElement("option"); o.value = v; o.textContent = t; view.appendChild(o);
    }
    view.value = data.view || "svar";

    const type = document.createElement("select");
    type.className = "qb-type";
    for (const [v, t] of [["mal", "Mal (settes inn direkte)"], ["ki", "KI-stikkord"]]) {
      const o = document.createElement("option"); o.value = v; o.textContent = t; type.appendChild(o);
    }
    type.value = data.type || "mal";

    const del = el("button", "danger small", "Slett");
    del.type = "button";
    del.addEventListener("click", () => card.remove());

    grid.appendChild(mk("Etikett", label));
    grid.appendChild(mk("Visning", view));
    grid.appendChild(mk("Type", type));
    const delWrap = el("div"); delWrap.appendChild(del); grid.appendChild(delWrap);

    const emne = el("input"); emne.type = "text"; emne.className = "qb-emne";
    emne.placeholder = "Emne (brukes i utgående melding, kun for mal)";
    emne.value = data.emne || "";
    grid.appendChild(mk("Emne", emne, true));

    const tekst = document.createElement("textarea");
    tekst.className = "qb-tekst";
    tekst.value = data.tekst || "";
    grid.appendChild(mk("Tekst (mal) / stikkord til KI-en", tekst, true));

    const notat = document.createElement("textarea");
    notat.className = "qb-notat";
    notat.placeholder = "Journalnotat som legges på utklippstavlen (kun for mal – KI lager sitt eget)";
    notat.value = data.notat || "";
    grid.appendChild(mk("Journalnotat", notat, true));

    function refreshVisibility() {
      const isMal = type.value === "mal";
      emne.parentElement.style.display = isMal && view.value !== "svar" ? "" : "none";
      notat.parentElement.style.display = isMal ? "" : "none";
      tekst.placeholder = isMal
        ? "Hele meldingsteksten, inkl. Hei! og signatur"
        : "Stikkord til KI-en, feks «alle prøver normale, kort»";
    }
    type.addEventListener("change", refreshVisibility);
    view.addEventListener("change", refreshVisibility);
    refreshVisibility();

    card.appendChild(grid);
    return card;
  }

  async function renderQb() {
    const all = await sGet(null);
    const list = $("qbList");
    list.textContent = "";
    Object.keys(all)
      .filter((k) => k.indexOf("qb.") === 0)
      .map((k) => all[k])
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .forEach((b) => list.appendChild(qbRow(b)));
  }

  function collectQb() {
    const out = {};
    let i = 0;
    for (const card of document.querySelectorAll(".qb-card")) {
      const label = card.querySelector(".qb-label").value.trim();
      if (!label) continue;
      i++;
      out["qb." + i] = {
        label,
        view: card.querySelector(".qb-view").value,
        type: card.querySelector(".qb-type").value,
        emne: card.querySelector(".qb-emne").value.trim(),
        tekst: card.querySelector(".qb-tekst").value,
        notat: card.querySelector(".qb-notat").value,
        order: i
      };
    }
    return out;
  }

  /* ==================== hotstrings ==================== */

  function hsRow(code, text) {
    const row = el("div", "hs-grid hs-row");
    const codeIn = el("input"); codeIn.type = "text"; codeIn.className = "hs-code";
    codeIn.placeholder = "kode (feks mvh)"; codeIn.value = code || "";
    const textIn = document.createElement("textarea");
    textIn.className = "hs-text";
    textIn.placeholder = "Tekst som settes inn. {dato} og {kursor} kan brukes.";
    textIn.value = text || "";
    const del = el("button", "danger small", "Slett");
    del.type = "button";
    del.addEventListener("click", () => row.remove());
    row.appendChild(codeIn);
    row.appendChild(textIn);
    row.appendChild(del);
    return row;
  }

  async function renderHs() {
    const all = await sGet(null);
    const list = $("hsList");
    list.textContent = "";
    Object.keys(all)
      .filter((k) => k.indexOf("hs.") === 0)
      .sort()
      .forEach((k) => list.appendChild(hsRow(k.slice(3), all[k])));
  }

  function collectHs() {
    const out = {};
    for (const row of document.querySelectorAll(".hs-row")) {
      const code = row.querySelector(".hs-code").value.trim().toLowerCase();
      const text = row.querySelector(".hs-text").value;
      if (!code || /\s/.test(code) || !text) continue; // koder er ett ord
      out["hs." + code] = text;
    }
    return out;
  }

  /* ==================== domener ==================== */

  function cleanDomain(d) {
    return String(d || "")
      .trim().toLowerCase()
      .replace(/^[a-z]+:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/^\*\.?/, "");
  }
  function patternsFor(d) { return ["*://" + d + "/*", "*://*." + d + "/*"]; }
  function hasPerm(pats) {
    return new Promise((r) => {
      try { chrome.permissions.contains({ origins: pats }, (ok) => { void chrome.runtime.lastError; r(!!ok); }); }
      catch (e) { r(false); }
    });
  }
  function refreshHotstrings() {
    try { chrome.runtime.sendMessage({ action: "flkRefreshHotstrings" }, () => void chrome.runtime.lastError); } catch (e) {}
  }

  async function renderDomains() {
    const { hsDomains } = await sGet("hsDomains");
    const domains = Array.isArray(hsDomains) ? hsDomains : [];
    const list = $("domList");
    list.textContent = "";
    for (const d of domains) {
      const row = el("div", "dom-row");
      row.appendChild(el("span", "dom-name", d));
      const ok = await hasPerm(patternsFor(d));
      if (!ok) {
        row.appendChild(el("span", "dom-warn", "mangler tillatelse på denne maskinen"));
        const grant = el("button", "secondary small", "Gi tilgang");
        grant.type = "button";
        grant.addEventListener("click", () => {
          chrome.permissions.request({ origins: patternsFor(d) }, (granted) => {
            void chrome.runtime.lastError;
            if (granted) refreshHotstrings();
            renderDomains();
          });
        });
        row.appendChild(grant);
      }
      const del = el("button", "danger small", "Fjern");
      del.type = "button";
      del.addEventListener("click", async () => {
        const cur = (await sGet("hsDomains")).hsDomains || [];
        await sSet({ hsDomains: cur.filter((x) => x !== d) });
        renderDomains();
      });
      row.appendChild(del);
      list.appendChild(row);
    }
  }

  $("domAdd").addEventListener("click", () => {
    const d = cleanDomain($("domNew").value);
    if (!d || d.indexOf(".") === -1) { alert("Skriv et gyldig domene, feks helsenorge.no"); return; }
    // permissions.request må skje i selve klikk-handleren (user gesture)
    chrome.permissions.request({ origins: patternsFor(d) }, async (granted) => {
      void chrome.runtime.lastError;
      if (!granted) { alert("Tillatelsen ble avvist – domenet ble ikke lagt til."); return; }
      const cur = (await sGet("hsDomains")).hsDomains || [];
      if (cur.indexOf(d) === -1) {
        cur.push(d);
        await sSet({ hsDomains: cur });
      }
      $("domNew").value = "";
      refreshHotstrings();
      renderDomains();
    });
  });

  /* ==================== koblingsstatus ==================== */

  async function renderMap() {
    const { fieldMap } = await sGet("fieldMap");
    const map = Array.isArray(fieldMap) ? fieldMap : [];
    if (!map.some((m) => m && m.selector)) {
      $("mapStatus").textContent = "Journalfelter: ingen koblet ennå.";
      return;
    }
    const lines = [];
    for (let i = 0; i < 4; i++) {
      const e = map[i];
      if (e && e.selector) {
        const hint = e.attrs && (e.attrs.ariaLabel || e.attrs.placeholder || e.attrs.labelText || e.attrs.name);
        lines.push("Felt " + (i + 1) + ": " + (hint ? hint + "  " : "") + "[" + e.selector + "]");
      } else {
        lines.push("Felt " + (i + 1) + ": (ikke koblet)");
      }
    }
    $("mapStatus").textContent = lines.join("\n");
  }

  async function renderDialog() {
    const { dialogMap, outgoingMap } = await sGet(["dialogMap", "outgoingMap"]);
    const dm = dialogMap || {};
    const om = outgoingMap || {};
    const line = (label, e) => {
      if (!e || !e.selector) return label + ": (ikke koblet)";
      const hint = e.attrs && (e.attrs.ariaLabel || e.attrs.placeholder || e.attrs.labelText || e.attrs.name);
      return label + ": " + (hint ? hint + "  " : "") + "[" + e.selector + "]";
    };
    $("dialogStatus").textContent =
      line("Dialog – pasientmelding", dm.message) + "\n" +
      line("Dialog – svarfelt", dm.reply) + "\n" +
      line("Ny melding – emnefelt", om.subject) + "\n" +
      line("Ny melding – tekstfelt", om.body);
  }

  /* ==================== last inn / lagre ==================== */

  async function load() {
    const { settings, ai } = await sGet(["settings", "ai"]);
    const s = Object.assign({}, DEFAULTS, settings || {});
    $("h1").value = s.headings[0] || "";
    $("h2").value = s.headings[1] || "";
    $("h3").value = s.headings[2] || "";
    $("h4").value = s.headings[3] || "";
    $("includeHeading").checked = !!s.includeHeading;
    $("sourceField").value = s.sourceField || "#responseBox";
    const a = ai || {};
    $("apiKey").value = a.apiKey || "";
    $("aiModel").value = a.model || DEFAULT_MODEL;
    renderQb();
    renderHs();
    renderDomains();
    renderMap();
    renderDialog();
  }

  async function save() {
    const settings = {
      headings: [$("h1").value, $("h2").value, $("h3").value, $("h4").value].map((x) => x.trim()),
      includeHeading: $("includeHeading").checked,
      sourceField: $("sourceField").value.trim() || "#responseBox"
    };
    const ai = {
      apiKey: $("apiKey").value.trim(),
      model: $("aiModel").value || DEFAULT_MODEL
    };

    const qb = collectQb();
    const hs = collectHs();

    // fjern qb./hs.-nøkler som ikke lenger finnes i skjemaet
    const all = await sGet(null);
    const stale = Object.keys(all).filter(
      (k) => (k.indexOf("qb.") === 0 && !(k in qb)) || (k.indexOf("hs.") === 0 && !(k in hs))
    );
    if (stale.length) await sRemove(stale);

    await sSet(Object.assign({ settings, ai }, qb, hs));

    const st = $("status");
    st.textContent = "Lagret ✔";
    setTimeout(() => (st.textContent = ""), 2000);
    renderQb();
    renderHs();
  }

  /* ==================== eksport / import ==================== */

  const EXPORT_KEYS = ["settings", "ai", "fieldMap", "dialogMap", "outgoingMap", "hsDomains"];
  function exportable(k) {
    return EXPORT_KEYS.indexOf(k) !== -1 || k.indexOf("hs.") === 0 || k.indexOf("qb.") === 0;
  }

  $("exportBtn").addEventListener("click", async () => {
    const all = await sGet(null);
    const out = {};
    for (const k of Object.keys(all)) if (exportable(k)) out[k] = all[k];
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fastlegeki-innstillinger.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const out = {};
      for (const k of Object.keys(data)) if (exportable(k)) out[k] = data[k];
      if (!Object.keys(out).length) throw new Error("Fant ingen gjenkjente innstillinger i filen.");
      // fjern eksisterende hs./qb. før import, så filen blir fasit
      const all = await sGet(null);
      const stale = Object.keys(all).filter((k) => k.indexOf("hs.") === 0 || k.indexOf("qb.") === 0);
      if (stale.length) await sRemove(stale);
      await sSet(out);
      refreshHotstrings();
      alert("Innstillinger importert. Nye hotstring-domener kan trenge «Gi tilgang» på denne maskinen.");
      load();
    } catch (err) {
      alert("Import feilet: " + (err && err.message ? err.message : err));
    }
  });

  /* ==================== knapper ==================== */

  $("qbAdd").addEventListener("click", () => $("qbList").appendChild(qbRow()));
  $("hsAdd").addEventListener("click", () => $("hsList").appendChild(hsRow()));
  $("save").addEventListener("click", save);
  $("restoreDefaults").addEventListener("click", () => {
    $("h1").value = DEFAULTS.headings[0];
    $("h2").value = DEFAULTS.headings[1];
    $("h3").value = DEFAULTS.headings[2];
    $("h4").value = DEFAULTS.headings[3];
  });
  $("resetMap").addEventListener("click", async () => {
    await sSet({ fieldMap: [] });
    await lSet({ learnState: { active: false, index: 0 } });
    renderMap();
  });
  $("resetDialog").addEventListener("click", async () => {
    await sSet({ dialogMap: {} });
    await lSet({ dialogLearn: { active: false, step: 0 } });
    renderDialog();
  });
  $("resetOutgoing").addEventListener("click", async () => {
    await sSet({ outgoingMap: {} });
    await lSet({ outgoingLearn: { active: false, step: 0 } });
    renderDialog();
  });

  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "sync") return;
    if (c.fieldMap) renderMap();
    if (c.dialogMap || c.outgoingMap) renderDialog();
    if (c.hsDomains) renderDomains();
  });

  load();
})();
