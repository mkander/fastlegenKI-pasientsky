# FastlegeKI → PasientSky overføring

Chrome-utvidelse som overfører notattekst fra **FastlegeKI** til journalfeltene i
**PasientSky**. Teksten deles automatisk i 4 deler ut fra overskrifter du selv
konfigurerer, og hver del legges i sitt felt i PasientSky.

I tillegg kan utvidelsen **generere KI-forslag til svar på e-konsultasjoner**
direkte i PasientSky-dialogen, med Claude API (se egen seksjon under).

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
   Claude Opus 4.8. Nøkkelen lagres kun lokalt i nettleseren.
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
| `dialog.js` | PasientSky: «Generer svar»-knapp i dialog + dialogkobling |
| `background.js` | Service worker: Claude API-kall + innebygd prompt |
| `options.html` / `options.js` | Innstillinger |
| `popup.html` / `popup.js` | Hurtigknapper fra verktøylinjen |
| `ui.css` | Stiler for knapp, panel og toast |

## Tilpasning av domener

Utvidelsen matcher `*.fastlegen.com` og `*.pasientsky.no`. Kjører du FastlegeKI
eller PasientSky på andre domener (f.eks. via Helsenett), legg dem til under
`host_permissions` og `content_scripts.matches` i `manifest.json`.
