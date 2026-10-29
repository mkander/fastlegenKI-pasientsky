/* dialog.js — kjører på PasientSky (pasientsky.no), i ALLE frames.
 *
 * KI-verktøylinje for meldinger til pasient. Fire koblingstyper (popup),
 * hver med egen kobling i chrome.storage.sync:
 *
 *   PasientSky-dialog (svar): klikk på pasientens melding, deretter
 *   svarfeltet. Linjen viser stikkordfelt + «Generer svar» + hurtigknapper.
 *   Genereringen henter pasientmeldingen (evt. fra en annen frame via
 *   chrome.storage-handshake) og fyller svarfeltet.
 *
 *   PasientSky ny melding (utgående): klikk på emnefeltet, deretter
 *   tekstfeltet. Linjen viser i tillegg «Prøvesvar»-knapp for å lime inn
 *   prøvesvar/røntgensvar som KI-en lager melding av. Genereringen fyller
 *   både emne og tekst.
 *
 *   eKontakt (Helsenorge, utgående): emnefelt + tekstfelt, som ny melding.
 *   Alt+E (åpne ny eKontakt) ligger i ekontakt.js.
 *
 *   Helsenorge-svar: som PasientSky-dialog, men egen kobling.
 *
 *   Reseptfornyelse (Helsenorge): klikk i legemiddellisten, deretter
 *   Beskjed-feltet. Som svar, men KI-en får bare listen, merket som
 *   forespørsel om reseptfornyelse.
 *
 * Plassering: PasientSky-vinduer er iframer som ofte er for små til linjen.
 * Ligger feltene i en iframe rett under toppvinduet, rapporterer den framen
 * feltets posisjon til toppvinduet (postMessage), og toppvinduet tegner
 * linjen over iframen. Knappene sender kommandoer tilbake; selve genereringen
 * og utfyllingen skjer i framen som eier feltene. Ellers (felt i toppvinduet,
 * eller dypere nøstet) tegnes linjen i framen selv som før.
 *
 * I begge visninger legges et kort journalnotat på utklippstavlen.
 * Hurtigknapper (sync-nøkler "qb.*") er enten faste maler (settes inn
 * umiddelbart) eller KI-stikkord (sendes til Claude). */
(function () {
  "use strict";
  const F = window.FLK;
  if (!F) return;
  const isTop = window.top === window.self;
  let isDirectChild = false;
  try { isDirectChild = !isTop && window.parent === window.top; } catch (e) {}

  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

  /* ---------------- koblingstyper ----------------
   * mode avgjør KI-linjens oppførsel: "svar" (pasientmelding + svarfelt) eller
   * "utgaaende" (emne + tekst). Steg: message = pasientens melding (ikke
   * redigerbar), ellers skrivefelt. texts[i] vises før steg i; siste tekst
   * når koblingen er ferdig. */
  const KINDS = {
    dialog: {
      mapKey: "dialogMap", learnKey: "dialogLearn", mode: "svar", label: "dialogen",
      steps: ["message", "reply"],
      texts: [
        "Klikk på pasientens melding i dialogen.",
        "Pasientmelding koblet. Klikk nå i svarfeltet (der du skriver svar).",
        "Svarfelt koblet! «Generer svar» vises ved svarfeltet. ✔"
      ]
    },
    outgoing: {
      mapKey: "outgoingMap", learnKey: "outgoingLearn", mode: "utgaaende", label: "ny melding",
      steps: ["subject", "body"],
      texts: [
        "Klikk i EMNEFELTET i «ny melding»-visningen.",
        "Emnefelt koblet. Klikk nå i tekstfeltet for meldingen.",
        "Ny melding koblet! KI-linjen vises ved tekstfeltet. ✔"
      ]
    },
    hnOut: {
      mapKey: "hnOutMap", learnKey: "hnOutLearn", mode: "utgaaende", label: "eKontakt",
      steps: ["subject", "body"],
      texts: [
        "Klikk i EMNEFELTET i eKontakt-vinduet (Helsenorge).",
        "Emnefelt koblet. Klikk nå i tekstfeltet for meldingen.",
        "eKontakt koblet! KI-linjen vises ved tekstfeltet. ✔"
      ]
    },
    hnRx: {
      mapKey: "hnRxMap", learnKey: "hnRxLearn", mode: "svar", label: "reseptfornyelse",
      steps: ["message", "reply"],
      listMessage: true, // klikk i legemiddellisten → hele listen (ikke navn/dato over)
      prefix: "Forespørsel om reseptfornyelse via Helsenorge. Pasienten ber om fornyelse av:\n",
      texts: [
        "Klikk på legemiddellisten i reseptfornyelsen (Helsenorge).",
        "Legemiddelliste koblet. Klikk nå i Beskjed-feltet.",
        "Reseptfornyelse koblet! «Generer svar» vises ved Beskjed-feltet. ✔"
      ]
    },
    hnReply: {
      mapKey: "hnReplyMap", learnKey: "hnReplyLearn", mode: "svar", label: "Helsenorge-svar",
      steps: ["message", "reply"],
      texts: [
        "Klikk på pasientens Helsenorge-melding.",
        "Pasientmelding koblet. Klikk nå i svarfeltet (der du skriver svar).",
        "Helsenorge-svar koblet! «Generer svar» vises ved svarfeltet. ✔"
      ]
    }
  };
  const KIND_NAMES = Object.keys(KINDS);
  const FIELD_NAMES = { subject: "emnefeltet", body: "tekstfeltet", reply: "svarfeltet" };
  const IDLE = { active: false, step: 0 };

  /* ---------------- cache av lagret tilstand ---------------- */
  const learn = {}; // local, per type
  const maps = {};  // sync, per type
  for (const n of KIND_NAMES) { learn[n] = IDLE; maps[n] = {}; }
  let quickButtons = [];                          // sync qb.* (sortert)
  let qbVersion = 0;

  F.get(KIND_NAMES.map((n) => KINDS[n].learnKey).concat(KIND_NAMES.map((n) => KINDS[n].mapKey))).then((r) => {
    for (const n of KIND_NAMES) {
      learn[n] = r[KINDS[n].learnKey] || learn[n];
      maps[n] = r[KINDS[n].mapKey] || {};
    }
  });

  function loadQuickButtons() {
    F.getPrefixed("qb.").then((all) => {
      quickButtons = Object.keys(all)
        .map((k) => Object.assign({ id: k }, all[k]))
        .filter((b) => b && b.label)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      qbVersion++;
    });
  }
  loadQuickButtons();

  /* ---------------- lær-modus (alle frames) ---------------- */

  // Klikk på en melding treffer ofte et lite tekst-element; klatre opp til en
  // container med nok tekst til å være selve meldingen.
  function messageContainerFrom(el) {
    let n = el;
    for (let i = 0; i < 6 && n && n.nodeType === 1 && n !== document.body; i++) {
      const t = (n.innerText || "").trim();
      if (t.length >= 20) return n;
      n = n.parentElement;
    }
    return el;
  }

  function captureEntry(el) {
    return { key: F.frameKey(), selector: F.cssPath(el), attrs: F.captureAttrs(el) };
  }

  function activeLearn() {
    for (const n of KIND_NAMES) if (learn[n] && learn[n].active) return n;
    return null;
  }

  document.addEventListener(
    "click",
    function (e) {
      const name = activeLearn(); // fra cache: må avgjøres synkront for preventDefault
      if (!name) return;
      const kind = KINDS[name];
      const step = learn[name].step || 0;
      const part = kind.steps[step];
      if (!part) return;
      e.preventDefault();
      e.stopPropagation();
      const target = part !== "message" ? F.editableFrom(e.target)
        : (kind.listMessage && e.target.closest && e.target.closest("ul, ol")) || messageContainerFrom(e.target);
      if (!target) {
        F.toast("Det var ikke et skrivefelt – klikk i " + FIELD_NAMES[part] + ".", "error");
        return;
      }
      const next = step + 1;
      const done = next >= kind.steps.length;
      learn[name] = done ? IDLE : { active: true, step: next }; // ikke registrer dobbeltklikk to ganger
      saveStep(name, part, captureEntry(target), done, next);
    },
    true // capture-fase, foran PasientSky sin egen logikk
  );

  async function saveStep(name, part, entry, done, next) {
    const kind = KINDS[name];
    const map = (await F.get(kind.mapKey))[kind.mapKey] || {};
    map[part] = entry;
    await F.set({ [kind.mapKey]: map, [kind.learnKey]: done ? IDLE : { active: true, step: next } });
    F.toast(kind.texts[next], "ok");
  }

  async function toggleLearn(name) {
    const kind = KINDS[name];
    const st = (await F.get(kind.learnKey))[kind.learnKey];
    if (st && st.active) {
      await F.set({ [kind.learnKey]: IDLE });
      F.toast("Kobling av " + kind.label + " avbrutt.", "");
      return;
    }
    const upd = { [kind.mapKey]: {} };
    for (const n of KIND_NAMES) upd[KINDS[n].learnKey] = n === name ? { active: true, step: 0 } : IDLE;
    await F.set(upd);
    F.toast(kind.texts[0], "ok");
  }

  /* ---------------- gjenfinning ---------------- */

  // Meldingselementet er ikke redigerbart, så F.findElement passer ikke.
  function findMessageEl(entry) {
    if (!entry) return null;
    const a = entry.attrs || {};
    if (a.id) {
      const el = document.getElementById(a.id);
      if (el) return el;
    }
    if (entry.selector) {
      try {
        const el = document.querySelector(entry.selector);
        if (el) return el;
      } catch (e) {}
    }
    if (a.classes && a.classes.length) {
      try {
        const list = document.querySelectorAll(a.tag + "." + a.classes.join("."));
        if (list.length >= 1) return list[list.length - 1]; // nyeste melding ved flere treff
      } catch (e) {}
    }
    return null;
  }

  function readMessageText(el) {
    return ((el.innerText || el.textContent || "") + "").trim();
  }

  function ownedEl(entry) {
    if (!entry || entry.key !== F.frameKey()) return null;
    return F.findElement(entry);
  }

  /* ---------------- henting på tvers av frames ---------------- */
  let pendingExtract = null;

  function extractHere(map) {
    const el = findMessageEl(map.message);
    if (!el) return { error: "Fant ikke pasientmeldingen – koble på nytt." };
    const text = readMessageText(el);
    if (!text) return { error: "Pasientmeldingen ser tom ut – koble på nytt." };
    return { text };
  }

  async function getPatientMessage(name) {
    const map = maps[name];
    if (!map.message) throw new Error("Pasientmeldingen er ikke koblet.");
    if (map.message.key === F.frameKey()) {
      const r = extractHere(map);
      if (r.error) throw new Error(r.error);
      return r.text;
    }
    // Meldingen ligger i en annen frame: be den hente teksten via storage.
    const req = Date.now();
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingExtract = null;
        reject(new Error("Fikk ikke hentet pasientmeldingen. Koble " + KINDS[name].label + " på nytt."));
      }, 4000);
      pendingExtract = {
        req,
        resolve: (t) => { clearTimeout(timer); pendingExtract = null; resolve(t); },
        reject: (e) => { clearTimeout(timer); pendingExtract = null; reject(e); }
      };
    });
    await F.set({ dialogExtract: { req, kind: name } });
    return promise;
  }

  async function handleExtractChange(v) {
    if (!v || !v.req) return;
    if (v.text != null || v.error) {
      if (pendingExtract && pendingExtract.req === v.req) {
        if (v.error) pendingExtract.reject(new Error(v.error));
        else pendingExtract.resolve(v.text);
      }
      return;
    }
    // Ny forespørsel: er meldingselementet i denne framen?
    const name = KINDS[v.kind] ? v.kind : "dialog";
    const mapKey = KINDS[name].mapKey;
    const map = maps[name].message ? maps[name] : ((await F.get(mapKey))[mapKey] || {});
    if (!map.message || map.message.key !== F.frameKey()) return;
    const r = extractHere(map);
    await F.set({ dialogExtract: { req: v.req, text: r.text, error: r.error } });
  }

  /* ---------------- generering og utfylling (framen som eier feltene) ---------------- */
  let generating = false;

  function sendToBackground(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          const err = chrome.runtime && chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(resp);
        });
      } catch (e) {
        reject(new Error("Får ikke kontakt med utvidelsen i denne rammen."));
      }
    });
  }

  // Fjern fødselsnummer o.l. før tekst sendes ut av maskinen.
  function scrubMateriale(t) {
    return String(t)
      .replace(/\b\d{6}\s?\d{5}\b/g, "[fnr fjernet]")
      .replace(/\b\d{11}\b/g, "[fnr fjernet]");
  }

  // Fyll feltene for en koblingstype: emne + tekst (utgående) eller svarfelt.
  function fillFields(kindName, emne, tekst) {
    const kind = KINDS[kindName];
    const map = maps[kindName];
    if (kind.mode === "utgaaende") {
      const subjEl = ownedEl(map.subject);
      const bodyEl = ownedEl(map.body);
      if (!bodyEl) throw new Error("Fant ikke tekstfeltet – koble " + kind.label + " på nytt.");
      if (subjEl && emne) F.fillField(subjEl, emne);
      F.fillField(bodyEl, tekst);
    } else {
      const replyEl = ownedEl(map.reply);
      if (!replyEl) throw new Error("Fant ikke svarfeltet – koble " + kind.label + " på nytt.");
      F.fillField(replyEl, tekst);
    }
  }

  // Resultat: { ok, journal } eller { ok: false, error }. Ingen UI her –
  // linjen kan ligge i en annen frame.
  async function runGenerate(kindName, opts) {
    if (!kindName || !KINDS[kindName]) return { ok: false, error: "Fant ikke meldingsfeltene." };
    if (generating) return { ok: false, error: "En generering pågår allerede." };
    generating = true;
    try {
      let payload;
      if (KINDS[kindName].mode === "utgaaende") {
        payload = {
          action: "flkGenerate",
          mode: "utgaaende",
          stikkord: opts.stikkord || "",
          materiale: opts.materiale ? scrubMateriale(opts.materiale) : ""
        };
      } else {
        const melding = (KINDS[kindName].prefix || "") + await getPatientMessage(kindName);
        payload = { action: "flkGenerate", mode: "svar", stikkord: opts.stikkord || "", melding };
      }
      const resp = await sendToBackground(payload);
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Ukjent feil ved generering.");
      fillFields(kindName, resp.emne, resp.svar);
      return { ok: true, journal: resp.journalnotat || "" };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    } finally {
      generating = false;
    }
  }

  function runMal(kindName, b) {
    if (!kindName || !KINDS[kindName]) return { ok: false, error: "Fant ikke meldingsfeltene." };
    if (generating) return { ok: false, error: "En generering pågår allerede." };
    try {
      fillFields(kindName, b.emne, b.tekst || "");
      return { ok: true, journal: b.notat || "", mal: true };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }

  /* ---------------- KI-linjen (UI) ----------------
   * backend.generate(opts) / backend.mal(b) returnerer Promise<resultat>,
   * enten lokalt (runGenerate/runMal) eller via toppvinduet → eierframen.
   * show(mode, getRect): getRect gir feltets posisjon i DENNE framens
   * koordinater (null = skjul). */
  const ICONS = window.FLK_ICONS || {
    iconFor: () => "", groupIcon: () => "", compare: (a, b) => String(a).localeCompare(String(b))
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  async function tryCopy(text) {
    if (!text) return true;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {}
    try {
      const prev = document.activeElement;
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (prev && prev.focus) { try { prev.focus(); } catch (e) {} }
      return ok;
    } catch (e) {
      return false;
    }
  }

  function createBarUI(backend) {
    let bar = null;
    let panel = null;          // prøvesvar-panel
    let mode = null;           // "svar" | "utgaaende"
    let renderedKey = "";      // modus + qb-versjon linjen sist ble bygget for
    let getRect = null;
    let busy = false;
    let lastJournal = "";
    let copyPending = false;   // notatet kunne ikke kopieres automatisk

    // KI-linjen ligger ofte over et PasientSky-vindu som lukker seg når det
    // mister fokus eller får et klikk utenfor seg. Derfor: knapper tar ikke
    // fokus (fokus blir i vinduet/tekstfeltet), museklikk slipper ikke videre
    // til PasientSky, og early.js stopper «window-blur» når fokus går hit
    // (stikkord-/prøvesvarfeltet må ha fokus for å kunne skrives i).
    const early = window.__flkEarly || null;
    if (early) {
      early.ours = (n) => !!(n && ((bar && bar.contains(n)) || (panel && panel.contains(n))));
      // Klikket stoppes i early.js før det når knappen; kjør handlingen her.
      early.onClick = (e) => {
        for (let n = e.target; n && n !== document; n = n.parentNode) {
          if (n.__flkClick) {
            if (!n.__flkMore && bar) for (const m of bar.querySelectorAll(".flk-ai-menu")) m.style.display = "none";
            if (!n.disabled) n.__flkClick(e);
            return;
          }
        }
      };
    }
    // Knappehandling: kalles av early.onClick i toppvinduet, ellers av vanlig klikk.
    function onClick(node, fn) {
      node.__flkClick = fn;
      node.addEventListener("click", fn);
    }
    function shield(root) {
      root.addEventListener("pointerdown", () => { if (early) early.guardUntil = Date.now() + 1000; }, true);
      root.addEventListener("mousedown", (e) => {
        if (early) early.guardUntil = Date.now() + 1000;
        const t = e.target;
        if (!(t && t.closest && t.closest("input, textarea"))) e.preventDefault();
      }, true);
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick", "touchstart"]) {
        root.addEventListener(type, (e) => e.stopPropagation()); // boble-fase: våre egne knapper har allerede fått klikket
      }
    }

    function qbForView(view) {
      return quickButtons.filter((b) => b.view === view || b.view === "begge");
    }

    function render() {
      if (!bar) {
        bar = el("div", "flk-ai-bar");
        bar.id = "flk-ai-bar";
        bar.style.display = "none";
        document.body.appendChild(bar);
        shield(bar);
        // lukk ⋯-menyen ved klikk utenfor
        document.addEventListener("click", () => {
          for (const m of bar.querySelectorAll(".flk-ai-menu")) m.style.display = "none";
        });
      }
      const prevStikkord = bar.querySelector("#flk-ai-stikkord");
      const keepVal = prevStikkord ? prevStikkord.value : "";
      bar.textContent = "";

      const input = el("input", "flk-ai-input");
      input.id = "flk-ai-stikkord";
      input.type = "text";
      input.placeholder = mode === "utgaaende"
        ? "Stikkord (feks «prøvesvar, alt fint»)"
        : "Stikkord (feks «resept sendt, kort»)";
      input.title = "Stikkord og føring til KI-en – kan stå tomt";
      input.value = keepVal;
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); onGenerate(); }
        e.stopPropagation(); // ikke la PasientSky-snarveier (eller hotstrings) fange feltet
      });
      bar.appendChild(input);

      const gen = el("button", "flk-ai-btn flk-ai-primary", mode === "utgaaende" ? "✨ Generer melding" : "✨ Generer svar");
      gen.type = "button";
      gen.id = "flk-ai-generate";
      onClick(gen, () => onGenerate());
      bar.appendChild(gen);

      // hurtigknapper for denne visningen
      // Hurtigknapper: uten undermeny direkte på linjen (i valgt rekkefølge),
      // deretter én nedtrekksknapp per undermeny (alfabetisk), med valgene
      // sortert alfabetisk. Undermenyer vises bare i visninger der de har innhold.
      const btns = qbForView(mode);
      const groups = new Map();
      for (const b of btns) {
        const g = (b.group || "").trim();
        if (!g) { bar.appendChild(makeQbButton(b)); continue; }
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(b);
      }
      for (const name of Array.from(groups.keys()).sort(ICONS.compare)) {
        const items = groups.get(name).slice().sort((a, b) => ICONS.compare(a.label, b.label));
        bar.appendChild(makeGroup(name, items));
      }

      if (mode === "utgaaende") {
        const pr = el("button", "flk-ai-btn", "🧪 Prøvesvar");
        pr.type = "button";
        pr.title = "Lim inn prøvesvar/røntgensvar og få melding + journalnotat";
        onClick(pr, (e) => { e.stopPropagation(); togglePanel(); });
        bar.appendChild(pr);
      }

      const copyBtn = el("button", "flk-ai-btn", "📋 Kopier notat");
      copyBtn.type = "button";
      copyBtn.id = "flk-ai-copy";
      copyBtn.style.display = lastJournal && copyPending ? "" : "none";
      copyBtn.title = "Kopier journalnotatet til utklippstavlen";
      onClick(copyBtn, onCopyJournal);
      bar.appendChild(copyBtn);
    }

    // Undermeny: åpnes ved hover (med liten forsinkelse ved utgang, så musa
    // rekker å gå fra knappen ned i menyen) og ved klikk (berøring/tastatur).
    function makeGroup(name, items) {
      const wrap = el("span", "flk-ai-group");
      const icon = ICONS.groupIcon(name);
      const toggle = el("button", "flk-ai-btn flk-ai-grouptoggle", (icon ? icon + " " : "") + name + " ▾");
      toggle.type = "button";
      toggle.title = name + " (" + items.length + ")";
      const menu = el("div", "flk-ai-menu");
      menu.style.display = "none";
      for (const b of items) {
        const item = makeQbButton(b);
        item.classList.add("flk-ai-menuitem");
        menu.appendChild(item);
      }
      let closeTimer = null;
      let hoverOpenedAt = 0;
      const open = () => {
        clearTimeout(closeTimer);
        if (busy) return;
        for (const m of bar.querySelectorAll(".flk-ai-menu")) if (m !== menu) m.style.display = "none";
        menu.style.display = "";
        // Åpne mot siden med mest plass, og begrens høyden til det som er
        // ledig (scrollbar meny), så den aldri havner utenfor skjermen.
        menu.classList.remove("flk-ai-menu-up");
        menu.style.maxHeight = "";
        menu.scrollTop = 0;
        const t = toggle.getBoundingClientRect();
        const below = window.innerHeight - t.bottom - 12; // 4px avstand + marg
        const above = t.top - 12;
        const natural = menu.scrollHeight;
        const up = natural > below && above > below;
        if (up) menu.classList.add("flk-ai-menu-up");
        const room = Math.max(120, up ? above : below);
        if (natural > room) menu.style.maxHeight = room + "px";
      };
      const close = () => { clearTimeout(closeTimer); menu.style.display = "none"; };
      wrap.addEventListener("mouseenter", () => {
        if (menu.style.display === "none") hoverOpenedAt = Date.now();
        open();
      });
      wrap.addEventListener("mouseleave", () => { clearTimeout(closeTimer); closeTimer = setTimeout(close, 300); });
      toggle.__flkMore = true;
      onClick(toggle, (e) => {
        e.stopPropagation();
        // Musa åpnet menyen ved hover like før klikket: la den stå åpen
        // (ellers ville et vanlig klikk lukke menyen igjen med en gang).
        if (menu.style.display === "none" || Date.now() - hoverOpenedAt < 800) open(); else close();
      });
      wrap.appendChild(toggle);
      wrap.appendChild(menu);
      return wrap;
    }

    function makeQbButton(b) {
      const icon = ICONS.iconFor(b);
      const btn = el("button", "flk-ai-btn flk-ai-qb", (icon ? icon + " " : "") + b.label + (b.type === "ki" ? " ✨" : ""));
      btn.type = "button";
      btn.title = b.type === "ki" ? "KI-stikkord: " + (b.tekst || "") : "Fast mal settes inn umiddelbart";
      onClick(btn, (e) => {
        e.stopPropagation();
        for (const m of bar.querySelectorAll(".flk-ai-menu")) m.style.display = "none";
        if (b.type === "ki") onGenerate({ stikkord: b.tekst || b.label, btnEl: btn });
        else onMal(b);
      });
      return btn;
    }

    /* ---- prøvesvar-panel ---- */
    function togglePanel() {
      if (panel && panel.style.display !== "none") { panel.style.display = "none"; return; }
      if (!panel) {
        panel = el("div", "flk-ai-panel");
        const title = el("div", "flk-ai-panel-title", "Lim inn prøvesvar / røntgensvar");
        const hint = el("div", "flk-ai-panel-hint",
          "Fødselsnummer fjernes automatisk før sending. Unngå å ta med pasientens navn.");
        const ta = el("textarea", "flk-ai-textarea");
        ta.placeholder = "Lim inn her (Ctrl+V) …";
        ta.addEventListener("keydown", (e) => e.stopPropagation());
        const row = el("div", "flk-ai-panel-row");
        const go = el("button", "flk-ai-btn flk-ai-primary", "✨ Generer melding");
        go.type = "button";
        onClick(go, () => {
          const mat = ta.value.trim();
          if (!mat) { F.toast("Lim inn prøvesvaret først.", "error"); return; }
          panel.style.display = "none";
          onGenerate({ materiale: mat });
        });
        const cancel = el("button", "flk-ai-btn", "Avbryt");
        cancel.type = "button";
        onClick(cancel, () => { panel.style.display = "none"; });
        row.appendChild(go);
        row.appendChild(cancel);
        panel.appendChild(title);
        panel.appendChild(hint);
        panel.appendChild(ta);
        panel.appendChild(row);
        panel.addEventListener("click", (e) => e.stopPropagation());
        document.body.appendChild(panel);
        shield(panel);
      }
      panel.style.display = "";
      positionPanel();
      const ta = panel.querySelector("textarea");
      ta.value = "";
      ta.focus();
    }

    function positionPanel() {
      if (!panel || panel.style.display === "none" || !bar) return;
      const r = bar.getBoundingClientRect();
      let top = r.top - (panel.offsetHeight || 220) - 8;
      if (top < 4) top = r.bottom + 8;
      panel.style.left = Math.max(4, Math.min(Math.round(r.left), window.innerWidth - (panel.offsetWidth || 420) - 4)) + "px";
      panel.style.top = Math.round(top) + "px";
    }

    /* ---- posisjonering ---- */
    function reposition() {
      if (!bar || !mode || !getRect) return;
      const r = getRect();
      if (!r || (r.width === 0 && r.height === 0) || r.bottom < 0 || r.top > window.innerHeight) {
        bar.style.display = "none";
        if (panel) panel.style.display = "none";
        return;
      }
      if (bar.style.display === "none") bar.style.display = "";
      const bh = bar.offsetHeight || 40;
      const bw = bar.offsetWidth || 600;
      let top = r.top - bh - 6;
      if (top < 4) top = r.bottom + 6;                        // ikke plass over feltet → under
      if (top + bh > window.innerHeight - 4) top = Math.max(4, window.innerHeight - bh - 4);
      const left = Math.max(4, Math.min(Math.round(r.left), window.innerWidth - bw - 4));
      bar.style.left = left + "px";
      bar.style.top = Math.round(top) + "px";
      positionPanel();
    }

    function show(newMode, rectFn) {
      getRect = rectFn;
      if (!busy) {
        mode = newMode;
        const key = newMode + "|" + qbVersion;
        if (key !== renderedKey) { render(); renderedKey = key; }
      }
      reposition();
    }

    function clearStikkord() {
      const inp = bar && bar.querySelector("#flk-ai-stikkord");
      if (inp) inp.value = "";
    }

    function hide() {
      if (busy) return; // behold linjen til genereringen er ferdig
      if (mode) clearStikkord(); // vinduet er lukket – ikke ta med stikkord til neste
      mode = null;
      getRect = null;
      if (bar) bar.style.display = "none";
      if (panel) panel.style.display = "none";
    }

    /* ---- handlinger ---- */
    function setBusy(b, btnEl) {
      busy = b;
      if (!bar) return;
      for (const x of bar.querySelectorAll("button")) x.disabled = b;
      const gen = bar.querySelector("#flk-ai-generate");
      if (gen) gen.textContent = b && !btnEl
        ? "Genererer…"
        : (mode === "utgaaende" ? "✨ Generer melding" : "✨ Generer svar");
      if (btnEl && b) btnEl.textContent = "…";
    }

    async function deliverJournal(notat) {
      lastJournal = notat || "";
      const copied = await tryCopy(lastJournal);
      copyPending = !copied;
      const copyBtn = bar && bar.querySelector("#flk-ai-copy");
      if (copyBtn) copyBtn.style.display = copied ? "none" : "";
      return copied;
    }

    async function onGenerate(opts) {
      opts = opts || {};
      if (busy || !mode) return;
      setBusy(true, opts.btnEl);
      try {
        const stikkord = opts.stikkord != null
          ? opts.stikkord
          : (bar.querySelector("#flk-ai-stikkord") || {}).value || "";
        const res = await backend.generate({ stikkord, materiale: opts.materiale || "" });
        if (!res || !res.ok) throw new Error((res && res.error) || "Ukjent feil ved generering.");
        clearStikkord(); // nytt stikkord for neste melding
        const copied = await deliverJournal(res.journal);
        F.toast(copied
          ? "Tekst lagt inn. Journalnotatet ligger på utklippstavlen. ✔"
          : "Tekst lagt inn. Trykk «Kopier notat» for journalnotatet.", "ok");
      } catch (e) {
        F.toast("Generering feilet: " + (e && e.message ? e.message : e), "error");
      } finally {
        setBusy(false, opts.btnEl);
        renderedKey = ""; // tegn linjen på nytt (rydder knappetekster)
        if (mode) { render(); renderedKey = mode + "|" + qbVersion; reposition(); }
      }
    }

    async function onMal(b) {
      if (busy || !mode) return;
      try {
        const res = await backend.mal({ label: b.label, emne: b.emne || "", tekst: b.tekst || "", notat: b.notat || "" });
        if (!res || !res.ok) throw new Error((res && res.error) || "Ukjent feil.");
        const copied = await deliverJournal(res.journal);
        F.toast(copied
          ? (res.journal ? "Mal lagt inn. Journalnotatet ligger på utklippstavlen. ✔" : "Mal lagt inn. ✔")
          : "Mal lagt inn. Trykk «Kopier notat» for journalnotatet.", "ok");
      } catch (e) {
        F.toast("Feil: " + (e && e.message ? e.message : e), "error");
      }
    }

    async function onCopyJournal() {
      const ok = await tryCopy(lastJournal);
      if (ok) {
        copyPending = false;
        const copyBtn = bar.querySelector("#flk-ai-copy");
        if (copyBtn) copyBtn.style.display = "none";
        F.toast("Journalnotat kopiert. ✔", "ok");
      } else {
        F.toast("Kopiering feilet – marker og kopier manuelt.", "error");
      }
    }

    return { show, hide, reposition, isBusy: () => busy, rerender: () => { renderedKey = ""; } };
  }

  /* ---------------- gjenkjenning av visning ---------------- */
  // Hvilken koblingstype passer visningen i denne framen? Utgående har forrang
  // (der finnes både emne- og tekstfelt). Treffer flere svar-koblinger samme
  // svarfelt, velges den der pasientmeldingen faktisk finnes.
  function detect() {
    for (const name of ["hnOut", "outgoing"]) {
      const m = maps[name];
      const subjEl = ownedEl(m.subject);
      const bodyEl = subjEl ? ownedEl(m.body) : null;
      if (subjEl && bodyEl) return { kind: name, anchor: bodyEl };
    }
    let best = null;
    for (const name of ["hnRx", "hnReply", "dialog"]) {
      const m = maps[name];
      const replyEl = ownedEl(m.reply);
      if (!replyEl) continue;
      const score = !m.message ? 0
        : m.message.key !== F.frameKey() ? 1
        : findMessageEl(m.message) ? 2 : 0;
      if (!best || score > best.score) best = { kind: name, anchor: replyEl, score };
    }
    return best;
  }

  /* ---------------- toppvinduet: linje for felt i en iframe ---------------- */
  // remote: { iframe, win, token, mode, rect, seen } — siste rapport fra en
  // direkte under-iframe som har feltene.
  let remote = null;
  const remoteReqs = new Map();

  function iframeFor(win) {
    for (const f of document.querySelectorAll("iframe")) {
      try { if (f.contentWindow === win) return f; } catch (e) {}
    }
    return null;
  }

  function remoteRect() {
    if (!remote) return null;
    const f = remote.iframe.getBoundingClientRect();
    if (f.width === 0 || f.height === 0) return null;
    const r = remote.rect;
    if (r.top + r.height < 0 || r.top > f.height || r.left + r.width < 0 || r.left > f.width) return null;
    const x = f.left + remote.iframe.clientLeft + r.left;
    const y = f.top + remote.iframe.clientTop + r.top;
    return { left: x, top: y, right: x + r.width, bottom: y + r.height, width: r.width, height: r.height };
  }

  function remoteCall(cmd, opts) {
    return new Promise((resolve) => {
      if (!remote) { resolve({ ok: false, error: "Mistet kontakten med meldingsvinduet." }); return; }
      const req = rid();
      const timer = setTimeout(() => {
        remoteReqs.delete(req);
        resolve({ ok: false, error: "Fikk ikke svar fra meldingsvinduet." });
      }, 120000);
      remoteReqs.set(req, (r) => { clearTimeout(timer); resolve(r); });
      try {
        remote.win.postMessage({ __flk: "cmd", token: remote.token, req, cmd, opts }, "*");
      } catch (e) {
        clearTimeout(timer);
        remoteReqs.delete(req);
        resolve({ ok: false, error: "Får ikke kontakt med meldingsvinduet." });
      }
    });
  }

  /* ---------------- under-iframe: rapporter til toppvinduet ---------------- */
  const myToken = rid();
  let ackAt = 0;         // sist toppvinduet bekreftet at det tegner linjen
  let reportSince = 0;   // når vi begynte å rapportere denne visningen
  let reported = false;

  function report(found) {
    if (!isDirectChild) return;
    if (!found && !reported) return;
    const msg = { __flk: "bar", token: myToken, mode: null };
    if (found) {
      const r = found.anchor.getBoundingClientRect();
      msg.mode = KINDS[found.kind].mode;
      msg.rect = { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    reported = !!found;
    try { window.parent.postMessage(msg, "*"); } catch (e) {}
  }
  const remoteOk = () => isDirectChild && Date.now() - ackAt < 3000;

  window.addEventListener("message", async (e) => {
    const d = e.data;
    if (!d || typeof d !== "object" || typeof d.__flk !== "string") return;

    // --- i under-iframen: svar og kommandoer fra toppvinduet ---
    if (isDirectChild && e.source === window.parent && d.token === myToken) {
      if (d.__flk === "ack") { ackAt = Date.now(); return; }
      if (d.__flk === "cmd") {
        let res;
        if (d.cmd === "generate") res = await runGenerate(ownerKind, d.opts || {});
        else if (d.cmd === "mal") res = runMal(ownerKind, (d.opts && d.opts.b) || {});
        else res = { ok: false, error: "Ukjent kommando." };
        try { window.parent.postMessage(Object.assign({ __flk: "res", token: myToken, req: d.req }, res), "*"); } catch (err) {}
      }
      return;
    }

    // --- i toppvinduet: rapporter og svar fra under-iframer ---
    if (!isTop) return;
    if (d.__flk === "res") {
      const cb = remoteReqs.get(d.req);
      if (cb) { remoteReqs.delete(d.req); cb(d); }
      return;
    }
    if (d.__flk !== "bar") return;
    const iframe = iframeFor(e.source);
    if (!iframe) return;
    try { e.source.postMessage({ __flk: "ack", token: d.token }, "*"); } catch (err) {}
    if (!d.mode) {
      if (remote && remote.token === d.token) remote = null;
      topTick();
      return;
    }
    // Hold på nåværende vindu så lenge det er aktivt (unngå flimring mellom to)
    if (remote && remote.token !== d.token && Date.now() - remote.seen < 2000 && remote.iframe.isConnected) return;
    remote = { iframe, win: e.source, token: d.token, mode: d.mode, rect: d.rect, seen: Date.now() };
    if (window.__flkEarly) window.__flkEarly.frameId = iframe.id || null;
    topTick();
  });

  /* ---------------- tick ---------------- */
  let ownerKind = null;   // koblingstypen feltene i denne framen tilhører
  let ownerAnchor = null;
  let source = "local";   // toppvinduet: "local" (egne felt) eller "remote"
  const ui = createBarUI({
    generate: (opts) => source === "remote" ? remoteCall("generate", opts) : runGenerate(ownerKind, opts),
    mal: (b) => source === "remote" ? remoteCall("mal", { b }) : Promise.resolve(runMal(ownerKind, b))
  });

  function localRect() {
    return ownerAnchor && ownerAnchor.isConnected ? ownerAnchor.getBoundingClientRect() : null;
  }

  function tick() {
    const found = detect();
    if (!found) {
      if (!generating) { ownerKind = null; ownerAnchor = null; }
      report(null);
      reportSince = 0;
      if (isTop) topTick(); else ui.hide();
      return;
    }
    if (!generating) ownerKind = found.kind; // ikke bytt type midt i en generering
    ownerAnchor = found.anchor;
    const mode = KINDS[found.kind].mode;

    if (isDirectChild) {
      report(found);
      if (!reportSince) reportSince = Date.now();
      if (remoteOk()) { ui.hide(); return; }
      if (Date.now() - reportSince < 1500) return; // venter på svar fra toppvinduet
    }
    if (isTop) source = "local";
    ui.show(mode, localRect);
  }

  // Toppvinduet uten egne felt: tegn linjen for en under-iframe.
  function topTick() {
    if (!isTop || ownerKind) return;
    if (remote && (!remote.iframe.isConnected || Date.now() - remote.seen > 2500)) remote = null;
    if (!remote) { ui.hide(); return; }
    source = "remote";
    ui.show(remote.mode, remoteRect);
  }

  /* ---------------- storage-endringer ---------------- */
  F.onChanged((changes, _area) => {
    for (const n of KIND_NAMES) {
      const k = KINDS[n];
      if (changes[k.learnKey]) learn[n] = changes[k.learnKey].newValue || IDLE;
      if (changes[k.mapKey]) maps[n] = changes[k.mapKey].newValue || {};
    }
    if (changes.dialogExtract) handleExtractChange(changes.dialogExtract.newValue);
    for (const k of Object.keys(changes)) {
      if (k.indexOf("qb.") === 0) { loadQuickButtons(); ui.rerender(); break; }
    }
  });

  /* ---------------- popup-meldinger ---------------- */
  const LEARN_ACTIONS = {
    startDialogLearn: "dialog",
    startOutgoingLearn: "outgoing",
    startHnOutLearn: "hnOut",
    startHnReplyLearn: "hnReply",
    startHnRxLearn: "hnRx"
  };
  try {
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
        // kun toppvinduet svarer, ellers toggles tilstanden én gang per frame
        if (!msg || !isTop) return false;
        const name = LEARN_ACTIONS[msg.action];
        if (name) { toggleLearn(name); sendResponse({ ok: true }); }
        return false;
      });
    }
  } catch (e) {}

  /* ---------------- oppstart ---------------- */
  setInterval(tick, 500);              // SPA-robusthet: vinduer åpnes/lukkes dynamisk
  if (isTop) setInterval(topTick, 250); // følg vinduer som flyttes/dras
  let scrollQueued = false;
  function onScroll() {
    ui.reposition();
    if (isDirectChild && reported && !scrollQueued) {
      scrollQueued = true;
      setTimeout(() => { scrollQueued = false; tick(); }, 60);
    }
  }
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
})();
