/* icons.js — automatisk ikon og sortering for hurtigknapper.
 * Brukes av KI-linjen (dialog.js, PasientSky) og innstillingssiden, så
 * forhåndsvisningen der er den samme som i linjen.
 *
 * Ikonet velges lokalt ut fra ord i etiketten (deretter teksten): ingen
 * API-kall, øyeblikkelig og alltid samme resultat. Første regel som treffer
 * vinner, så mer spesifikke regler står først. En knapp kan overstyre med
 * eget ikon (feltet «icon»). */
(function (root) {
  "use strict";

  const RULES = [
    [/avsl[åa]|ikke p[åa] melding|egner seg ikke|ikke egnet/, "🚫"],
    [/sykm|sykem|egenmeld/, "🛌"],
    [/henvis/, "📨"],
    [/r[øo]ntgen|\brtg\b|\bmr\b|\bct\b|ultralyd|\bul\b|bildediagn/, "🩻"],
    [/vaksin/, "💉"],
    [/d-?vit|vitamin ?d|divisun/, "☀️"],
    [/\bjern|\bhb\b|ferritin|hemoglobin|anemi/, "🩸"],
    [/kolesterol|lipid|\bldl\b|statin/, "🫀"],
    [/blodtrykk|\bbt\b|hypertensjon/, "🩺"],
    [/attest|erkl[æa]ring/, "📄"],
    [/resept|medisin|legemiddel|fornye|\brp\b/, "💊"],
    [/svangerskap|gravid/, "🤰"],
    [/angst|depresj|s[øo]vn|psyk/, "🧠"],
    [/\bhud\b|utslett|eksem|f[øo]flekk/, "🩹"],
    [/infeksjon|forkj[øo]l|hoste|feber|antibiotik|urinveis/, "🤒"],
    [/normal|alt( er)? (fint|bra|ok)|\bfine\b|uten anmerkning|\bua\b/, "✅"],
    [/pr[øo]ve|blodpr|\blab|analyse/, "🧪"],
    [/\btime\b|timen|kontroll|bestill|konsultasjon/, "📅"],
    [/\bring|telefon/, "📞"]
  ];

  function norm(s) {
    return String(s || "").toLowerCase();
  }

  function match(text) {
    const t = norm(text);
    if (!t) return "";
    for (const [re, icon] of RULES) if (re.test(t)) return icon;
    return "";
  }

  // Ikon for en hurtigknapp: eget ikon > etikett > tekst/stikkord > standard.
  function iconFor(b) {
    if (!b) return "✉️";
    if (b.icon && String(b.icon).trim()) return String(b.icon).trim();
    return match(b.label) || match(b.tekst) || match(b.emne) || "✉️";
  }

  // Ikon for en undermeny ut fra navnet.
  function groupIcon(name) {
    return match(name) || "📁";
  }

  // Norsk alfabetisk sortering (æ, ø, å til slutt), uavhengig av store/små bokstaver.
  const collator = (typeof Intl !== "undefined" && Intl.Collator)
    ? new Intl.Collator("nb", { sensitivity: "base", numeric: true })
    : null;
  function compare(a, b) {
    return collator ? collator.compare(a, b) : String(a).localeCompare(String(b));
  }

  root.FLK_ICONS = { iconFor, groupIcon, compare, match };
})(typeof window !== "undefined" ? window : this);
