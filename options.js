/* options.js — innstillingsside */
(function () {
  "use strict";
  const DEFAULTS = {
    headings: ["OVERSKRIFT1", "OVERSKRIFT2", "OVERSKRIFT3", "OVERSKRIFT4"],
    includeHeading: false,
    sourceField: "#responseBox"
  };
  const DEFAULT_MODEL = "claude-opus-4-8";
  const $ = (id) => document.getElementById(id);

  function get(keys) { return new Promise((r) => chrome.storage.local.get(keys, r)); }
  function set(obj) { return new Promise((r) => chrome.storage.local.set(obj, r)); }

  async function load() {
    const { settings, ai } = await get(["settings", "ai"]);
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
    renderMap();
    renderDialog();
  }

  async function renderMap() {
    const { fieldMap } = await get("fieldMap");
    const map = Array.isArray(fieldMap) ? fieldMap : [];
    if (!map.some((m) => m && m.selector)) {
      $("mapStatus").textContent = "Ingen felt koblet ennå.";
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
    const { dialogMap } = await get("dialogMap");
    const m = dialogMap || {};
    const line = (label, e) => {
      if (!e || !e.selector) return label + ": (ikke koblet)";
      const hint = e.attrs && (e.attrs.ariaLabel || e.attrs.placeholder || e.attrs.labelText || e.attrs.name);
      return label + ": " + (hint ? hint + "  " : "") + "[" + e.selector + "]";
    };
    $("dialogStatus").textContent = line("Pasientmelding", m.message) + "\n" + line("Svarfelt", m.reply);
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
    await set({ settings, ai });
    const st = $("status");
    st.textContent = "Lagret ✔";
    setTimeout(() => (st.textContent = ""), 2000);
  }

  $("save").addEventListener("click", save);
  $("restoreDefaults").addEventListener("click", () => {
    $("h1").value = DEFAULTS.headings[0];
    $("h2").value = DEFAULTS.headings[1];
    $("h3").value = DEFAULTS.headings[2];
    $("h4").value = DEFAULTS.headings[3];
  });
  $("resetMap").addEventListener("click", async () => {
    await set({ fieldMap: [], learnState: { active: false, index: 0 } });
    renderMap();
  });
  $("resetDialog").addEventListener("click", async () => {
    await set({ dialogMap: {}, dialogLearn: { active: false, step: 0 } });
    renderDialog();
  });

  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "local") return;
    if (c.fieldMap) renderMap();
    if (c.dialogMap) renderDialog();
  });

  load();
})();
