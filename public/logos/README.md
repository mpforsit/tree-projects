# Lean — Logo-Paket

## Farben
- Primärblau: #2563eb (App-Icon-Variante: #3b82f6)
- Anthrazit:  #0f172a
- Schrift der Wortmarke: Inter Medium (500), als Pfade eingebettet — keine Font-Abhängigkeit

## Struktur
svg/      Master-Dateien (verlustfrei skalierbar, für Druck & Web)
png/      Export-Größen für Web, Präsentationen, Social Media
favicon/  Komplettes Favicon-/App-Icon-Set inkl. site.webmanifest

## Verwendung
- lean-logo-horizontal*   Standard-Lockup (Website-Header, Dokumente)
- lean-logo-stacked*      Quadratische Kontexte (Social-Profile, Titelfolien)
- lean-mark*              Bildmarke allein (Avatare, kleine Flächen)
- lean-wordmark*          Nur Schriftzug
- *-white                 Für dunkle Hintergründe
- *-mono                  Einfarbig Anthrazit (Fax, Stempel, 1-Farb-Druck)
- lean-app-icon*          Gefüllte Kachel (App Stores, PWA)
- lean-og-image-*         Social-Media-Vorschaubild (Open Graph, 1200×630)

## HTML-Einbindung (in <head>)
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0f172a">
<meta property="og:image" content="/lean-og-image-1200x630.png">

## Schutzzone
Mindestabstand um das Logo: Höhe des Sockelbalkens der Bildmarke.
Minimalgröße Bildmarke: 24 px Höhe (darunter Favicon-Varianten verwenden).
