# FastlegeKI → PasientSky overføring

Chrome-utvidelse som overfører notattekst fra **FastlegeKI** til journalfeltene i
**PasientSky**. Teksten deles automatisk i 4 deler ut fra overskrifter du selv
konfigurerer, og hver del legges i sitt felt i PasientSky.

## Hvordan det virker

1. **Kilde (FastlegeKI):** En flytende knapp **«Overfør tekst»** nede til venstre.
   Ved klikk leses notatfeltet (`#responseBox`), teksten deles på de konfigurerte
   overskriftene, og delene lagres.
2. **Mål (PasientSky):** Et lite panel nede til venstre med **«Koble felt»** og
   **«Lim inn tekst»**. Når teksten er overført fra FastlegeKI, fylles de koblede
   feltene automatisk (du kan også trykke «Lim inn tekst» manuelt).

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

1. I FastlegeKI: trykk **«Overfør tekst»**.
2. Bytt til PasientSky-fanen – feltene fylles automatisk (eller trykk
   **«Lim inn tekst»**).

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
| `options.html` / `options.js` | Innstillinger |
| `popup.html` / `popup.js` | Hurtigknapper fra verktøylinjen |
| `ui.css` | Stiler for knapp, panel og toast |

## Tilpasning av domener

Utvidelsen matcher `*.fastlegen.com` og `*.pasientsky.no`. Kjører du FastlegeKI
eller PasientSky på andre domener (f.eks. via Helsenett), legg dem til under
`host_permissions` og `content_scripts.matches` i `manifest.json`.
