# FastlegeKI → PasientSky overføring

Chrome-utvidelse som overfører notattekst fra **FastlegeKI** til journalfeltene i
**PasientSky**. Teksten deles automatisk i 4 deler ut fra overskrifter du selv
konfigurerer, og hver del legges i sitt felt i PasientSky.

I tillegg kan utvidelsen **generere KI-forslag til meldinger** (svar på
e-konsultasjoner og utgående meldinger) direkte i PasientSky med Claude API,
og **utvide hotstrings til tekst** på valgfrie domener (se egne seksjoner).

Alle innstillinger — API-nøkkel, hotstrings, hurtigknapper, koblinger —
lagres i `chrome.storage.sync` og følger Chrome-profilen din automatisk
mellom maskiner. Kun runtime-tilstand (overført tekst, lær-modus, triggere)
er lokal per maskin. Innstillingene kan også eksporteres/importeres som JSON.

## Hvordan det virker

1. **Kilde (FastlegeKI):** En flytende knapp **«Overfør tekst»** som hovrer
   nederst til venstre inni notatfeltet (`#responseBox`). Ved klikk leses
   notatteksten, deles på de konfigurerte overskriftene, og delene lagres.
2. **Mål (PasientSky):** Et lite panel nede til venstre med **«Koble felt»**.
   Når teksten er overført fra FastlegeKI, fylles de koblede feltene automatisk.
   Panelet skjuler seg når alle 4 felt er koblet, og kommer fram igjen når du
   starter feltkobling på nytt (panel-knappen eller utvidelsens popup-knapp).

Fordi PasientSky er bygd opp av mange iframes, kan ikke faste selektorer for
feltene leses ut på forhånd. Derfor brukes en **lær-felt-modus**: du klikker selv
én gang på hvert av de 4 feltene, og utvidelsen husker dem (robust selektor +
kjennetegn + hvilken frame de ligger i). Innholdsskriptet kjører i alle frames,
så felter inne i iframes treffes også.

## Installasjon (utviklermodus)

1. Åpne `chrome://extensions`
2. Slå på **Utviklermodus** (øverst til høyre)
3. Klikk **Last inn upakket** og velg denne mappen
4. (Valgfritt) Åpne **Innstillinger** for å sette de virkelige overskriftene

## Førstegangsoppsett

1. **Innstillinger** (høyreklikk på utvidelsen → Alternativer, eller via popup):
   Skriv inn de 4 faktiske overskriftene i notatet, i samme rekkefølge som
   feltene i PasientSky. Standard er `OVERSKRIFT1`–`OVERSKRIFT4`.
2. **Koble felt:** Åpne journalen i PasientSky, trykk **«Koble felt»** i panelet
   nede til venstre, og klikk på felt 1, deretter felt 2, 3 og 4. Koblingen
   lagres og brukes til den nullstilles eller læres på nytt.

## Daglig bruk

1. I FastlegeKI: trykk **«Overfør tekst»** (knappen inni notatfeltet).
2. Bytt til PasientSky-fanen – feltene fylles automatisk.

## KI-generert svar på e-konsultasjon (Claude)

Når en dialog med en pasient er åpen i PasientSky, kan utvidelsen hente
pasientens melding, generere et forslag til svar i Magnus sin egen stil, skrive
det rett inn i svarfeltet, og legge et helt kort journalnotat på
utklippstavlen (klart til å limes inn i journalen).

### Oppsett (én gang)

1. **API-nøkkel:** Åpne Innstillinger og lim inn en Anthropic API-nøkkel
   (opprettes på `console.anthropic.com`). Velg modell — standard er
   Claude Opus 5.5. Nøkkelen synkroniseres med Chrome-profilen din
   (se seksjonen om synkronisering).
2. **Koble dialogen:** Åpne en e-konsultasjon i PasientSky, trykk på
   utvidelsesikonet og velg **«Koble dialog for KI-svar»**. Klikk først på
   pasientens melding, deretter i svarfeltet. Koblingen lagres (robust
   selektor + frame, som for journalfeltene) og gjenbrukes i alle dialoger.

### Daglig bruk

1. Åpne dialogen. En liten linje med stikkordfelt og **«✨ Generer svar»**
   vises over svarfeltet.
2. Skriv eventuelt stikkord/føring (f.eks. `resept sendt, kort` eller
   `sykmeld 1 uke, kjent ryggplage`) — feltet kan stå tomt.
3. Trykk **Generer svar** (eller Enter i stikkordfeltet). Svaret skrives inn i
   svarfeltet og journalnotatet legges på utklippstavlen. Hvis automatisk
   kopiering ikke er mulig, vises en egen **«Kopier notat»**-knapp.
4. Les gjennom, juster ved behov, og send. Forslaget er nettopp det — et
   forslag; det medisinske ansvaret ligger hos legen.

Selve prompten (rolle, skrivestil, norsk medisinsk kontekst, røde flagg osv.)
ligger innebygd i `background.js`.

### Utgående meldinger (ny melding med emnefelt)

1. Koble én gang: popup → **«Koble ny melding for KI»**, klikk i emnefeltet og
   deretter i tekstfeltet.
2. I «ny melding»-visningen viser KI-linjen i tillegg **hurtigknapper** og en
   **«🧪 Prøvesvar»**-knapp. Generering fyller både emne og tekst, og
   journalnotatet legges på utklippstavlen.
3. **Prøvesvar**: lim inn prøvesvar/røntgensvar i panelet — fødselsnummer
   fjernes automatisk før sending — og KI-en lager emne, melding med
   forklaring/plan og journalnotat.

### eKontakt via Helsenorge

Meldinger kan også sendes som eKontakt via Helsenorge. Den har egne felt, og
kobles derfor for seg (popupen):

1. **Ny melding:** åpne en eKontakt, popup → **«Koble eKontakt – ny melding
   (Helsenorge)»**, klikk i emnefeltet og deretter i tekstfeltet.
2. **Svar:** popup → **«Koble eKontakt – svar (Helsenorge)»**. Klikk på
   pasientens melding, deretter i svarfeltet.
3. **Pasientfelt (for Alt+E):** popup → **«Koble pasientfelt øverst»**, klikk
   på feltet øverst i PasientSky der navn og fødselsnummer på aktiv pasient står.

**Alt+E** åpner ny eKontakt fra hvor som helst i PasientSky, også mens du
skriver i et felt. Utvidelsen sender samme handling som PasientSky selv bruker
(ingen menyklikk), så det virker uavhengig av hvor menyen ligger.

- **Aktiv pasient bekreftet** → eKontakt åpnes for den pasienten.
- **Ellers** → eKontakt åpnes uten pasient, og du velger pasient i dialogen.

PasientSky har ingen aktiv pasient-ID utvidelsen kan lese direkte. Den følger
derfor med når en modul (timebok, innboks, labsvar …) aktiverer en pasient, og
sikrer det mot pasientfeltet øverst: utvidelsen husker et fingeravtrykk (hash,
kun i minnet – teksten lagres aldri) av feltet slik det så ut etter byttet.
Ved Alt+E brukes pasienten bare hvis feltet fortsatt ser likt ut. Er pasienten
byttet på en måte utvidelsen ikke så (f.eks. søk øverst), eller er siden
nettopp lastet på nytt, åpnes eKontakt uten pasient. Utvidelsen gjetter aldri.

Alt+E overstyrer Chromes egen Alt+E-meny og PasientSkys egen Alt+E (Epikrise,
elektronisk) inne i PasientSky. AltGr+E (€) påvirkes ikke. På Mac: Option+E.

KI-linjen, hurtigknappene og prøvesvar-panelet virker som for PasientSky:
utgående eKontakt fyller emne og tekst, svar fyller svarfeltet. Hurtigknappene
deles — «Svar»-visning brukes ved svar, «Utgående» ved ny melding.

**Plassering av KI-linjen:** PasientSky-vinduer (som eKontakt) er iframer som
ofte er for små til linjen. Ligger feltene i et slikt vindu, tegnes linjen i
hovedvinduet rett over feltet, alltid på én linje, mens utfyllingen skjer i
vinduet. Ellers tegnes den ved feltet som før.

PasientSky lukker slike vinduer når de mister fokus. Knappene i linjen tar
derfor ikke fokus (markøren blir stående i tekstfeltet), og når du klikker i
stikkord- eller prøvesvarfeltet, stopper utvidelsen PasientSky sin
«vinduet mistet fokus»-beskjed (`early.js`, lastes før PasientSky sin kode).

### Hurtigknapper

Konfigurerbare i innstillingene, med visning (svar/utgående/begge) og type:
**Mal** (emne/tekst/journalnotat ferdig skrevet, settes inn umiddelbart) eller
**KI-stikkord** (fast stikkord sendes til Claude). De tre første per visning
vises som knapper, resten i ⋯-menyen.

## Hotstrings (tekstutvidelse)

Skriv en kode (f.eks. `mvh`) i et tekstfelt og trykk mellomrom/enter/tab —
koden byttes ut med teksten du har definert i innstillingene. Plassholdere:
`{dato}` (dagens dato) og `{kursor}` (markørposisjon; skilletegnet slukes).
Backspace rett etter en utvidelse gjenoppretter koden. Aldri aktiv i
passordfelt.

Aktive domener styres i innstillingene (standard: pasientsky.no og
fastlegen.com). Nye domener krever en engangs-tillatelse per maskin — Chrome
spør når du legger til domenet, og på andre maskiner vises en
«Gi tilgang»-knapp i innstillingene.

## Synkronisering mellom maskiner – feilsøking

Synkroniseringen bruker `chrome.storage.sync`, som er adskilt **per
utvidelses-ID**. Manifestet inneholder derfor en fast `key`, slik at
utvidelsen får samme ID uansett hvilken mappe den lastes fra. Sjekkliste hvis
innstillinger ikke dukker opp på den andre maskinen:

1. **Samme utvidelses-ID:** `chrome://extensions` skal vise identisk ID på
   begge maskinene (versjon 1.2.2+ med `key` i manifestet gir alltid samme ID).
2. **Samme versjon av utvidelsen** på begge maskinene (trykk ↻ etter å ha
   hentet ny kode).
3. **Chrome-synkronisering på:** Innstillinger → Synkronisering → «Utvidelser»
   må være med (standard ved «Synkroniser alt»).
4. Gi det litt tid — Chrome synkroniserer vanligvis innen sekunder, men kan
   bruke noen minutter.

**Merk ved oppgradering til 1.2.2:** fast `key` betyr ny utvidelses-ID, og
lagringen under den gamle ID-en blir liggende igjen. Innstillingene fremstår
derfor som nullstilt én gang. Gjør slik på maskinen med riktig oppsett:
eksporter innstillingene (JSON) **før** du oppdaterer, oppdater og trykk ↻,
og importer filen etterpå. Den andre maskinen trenger bare oppdatering —
innstillingene kommer via sync.

## Innstillinger

- **Overskrifter (Felt 1–4):** Teksten deles på disse. Kolon, markdown (`**`, `#`)
  og store/små bokstaver ignoreres ved sammenligning. Tomme deler skrives ikke
  (eksisterende innhold i feltet overskrives ikke med tom tekst).
- **Ta med overskriftslinjen:** Avgjør om selve overskriften limes inn sammen med
  innholdet.
- **Kildefelt:** CSS-selektor for feltet i FastlegeKI (standard `#responseBox`).

## Filer

| Fil | Rolle |
|-----|-------|
| `manifest.json` | MV3-manifest, matcher og content scripts |
| `util.js` | Felles hjelpere (deling, selektorer, fylling, toast) |
| `source.js` | FastlegeKI: «Overfør tekst»-knapp |
| `destination.js` | PasientSky: lær-felt-modus + innliming (alle frames) |
| `dialog.js` | PasientSky: KI-linje for svar og utgående melding (PasientSky og eKontakt/Helsenorge), hurtigknapper, prøvesvar-panel; linjen tegnes i hovedvinduet for felt i iframe-vinduer |
| `early.js` | PasientSky (toppvindu, lastes først): hindrer at eKontakt-vinduet lukkes når du klikker i KI-linjen |
| `ekontakt.js` | PasientSky: Alt+E åpner ny eKontakt via PasientSkys handlingskanal, med aktiv pasient når den er bekreftet |
| `hotstrings.js` | Tekstutvidelse, registreres dynamisk på domenene i domenelisten |
| `background.js` | Service worker: Claude API-kall, innebygd prompt, migrering, hotstring-registrering |
| `options.html` / `options.js` | Innstillinger |
| `popup.html` / `popup.js` | Hurtigknapper fra verktøylinjen |
| `ui.css` | Stiler for knapp, panel og toast |

## Tilpasning av domener

Utvidelsen matcher `*.fastlegen.com` og `*.pasientsky.no`. Kjører du FastlegeKI
eller PasientSky på andre domener (f.eks. via Helsenett), legg dem til under
`host_permissions` og `content_scripts.matches` i `manifest.json`.
