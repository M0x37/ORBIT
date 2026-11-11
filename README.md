Orbit Desktop
============

Orbit ist ein einzelnes, randloses Electron-Dashboard-Fenster fur Windows. Es soll als zentrale, schnell erreichbare Oberflache fur Wetter, Uhr, Aufgaben, GitHub-Benachrichtigungen, Sentry-Fehler, Netzwerkstatus, Kurzbefehle und Audio-Steuerung dienen. Die App wird als portierbare Windows-EXE gebaut und hat keine Abhangigkeiten von Bundlern, TypeScript oder Frameworks.

Wozu die App da ist
-------------------

- Wetter (aktuell plus 24-Stunden-Vorhersage) in der Seitenleiste und als erweiterte Ansicht
- Uhr in der Seitenleiste
- To-Do-Liste in der Cloud (Supabase): Aufgaben anlegen, als erledigt markieren, loschen
- GitHub-Posteingang: ungelesene Benachrichtigungen anzeigen und auf Githorn offnen
- Sentry: Fehlerubersicht pro Organisation und Projekt, Token lokal verschlusselt gespeichert
- Netzwerk-Ubersicht: Internet-Erreichbarkeit, Antwortzeit, lokale Schnittstellen und offentliche IP
- Kurzbefehle: Links und lokale Apps mit einem Klick offnen
- Audio-Konsole: Standardausgabe zwischen gespeichertem Headset und Monitor umschalten, stummschalten, Mikrofon stummschalten, Lautstatke regeln, Gerätepaar speichern
- Tray-Symbol: Schließen blendet das Fenster nur aus (nicht beenden), "Quit Orbit" beendet die App
- Globale Hotkeys: Alt+A blendet das Fenster ein und aus, Alt+Shift+O schaltet die Audioausgabe um
- Einzelinstanz: nur ein Orbit-Fenster gleichzeitig

Voraussetzungen
---------------

- Windows
- Node.js (fur Entwicklung und Build)
- Ein GitHub-Personal-Access-Token mit mindestens dem Scope notifications (read-only) fur den Posteingang
- Ein Sentry-API-Token plus Organisation und Projekt fur die Sentry-Anbindung

Ersteinrichtung
---------------

1. Repository klonen oder herunterladen.
2. Abhangigkeiten installieren:

   npm install

3. Eine `.env`-Datei im Repository-Root erstellen. Als Vorlage dient `.env.example`:

   SENTRY_ORG=deine-organisation
   SENTRY_PROJECT=dein-projekt
   SENTRY_AUTH_TOKEN=dein-sentry-token
   GITHUB_TOKEN=dein-github-token

   Die `.env` steht in `.gitignore` und wird niemals ins Git aufgenommen. Echte Tokens gehören nicht in die Versionskontrolle.

4. App im Entwicklungsmodus starten (liest `.env` aus dem Repository-Root):

   npm start

5. Portables Windows-Paket bauen:

   npm run build:win

   Das Ergebnis landet unter `dist/Orbit-Portable-<version>.exe`. Verpackte Builds suchen `.env` neben der EXE.

Persönliche Kurzbefehle anpassen
---------------------------------

`main.cjs` enthält nur generische Standard-URLs. Deine persönlichen Ziele (eigene Domains, Cloudflare-Konto, Supabase-Projekt, Fritzbox usw.) trägst du in die lokale Datei `lib/shortcuts-local.cjs` ein. Diese Datei steht in `.gitignore` und wird nie gepusht.

Beispiel für `lib/shortcuts-local.cjs`:

    module.exports = {
      chrome: { kind: "url", target: "https://dash.deinedomain.dev/" },
      cloudflareDashboard: { kind: "url", target: "https://dash.cloudflare.com/deine-konto-id/home" },
      artcraft: { kind: "url", target: "https://deine-domain.com/" },
      supabase: { kind: "url", target: "https://supabase.com/dashboard/project/deine-projekt-ref" },
      fritzbox: { kind: "url", target: "http://192.168.178.1/#overview" },
      artcraftLauncher: { kind: "app", target: "C:\\Pfad\\zu\\ArtCraft Launcher.lnk" }
    };

Alles, was in dieser Datei fehlt, fällt auf die generischen Standardwerte in `main.cjs` zurück. So bleibt dein lokaler Code persönlich, während im Git und beim Push nur Platzhalter stehen.

Bedienung
---------

- Alt+A: Orbit-Fenster ein- und ausblenden
- Alt+Shift+O: Audioausgabe zwischen gespeichertem Headset und Monitor umschalten
- Fenster schließen: wird ins System-Tray ausgeblendet
- Tray-Menü: "Show Orbit"/"Hide Orbit" sowie "Quit Orbit" zum kompletten Beenden
- Sidebar: Seiten wechseln über die Menüpunkte Overview, Inbox, To-Do, Links, Network sowie Schnelle Aktionen
- Wetter und Uhr laufen automatisch in der Sidebar und werden regelmässig aktualisiert

Seiten
------

Overview
  Zeigt Kurzbefehle (YouTube, GitHub, Cloudflare, Vercel, Chrome-Dashboard, Cloudflare-Dashboard, ArtCraft, Supabase, Fritzbox, ArtCraft Launcher) sowie die Audio-Konsole und den Sentry-Bereich.

Inbox
  Listet ungelesene GitHub-Benachrichtigungen. Ein Klick offnet den Eintrag auf github.com. Ohne `GITHUB_TOKEN` wird ein Einrichtungshinweis angezeigt.

To-Do
  Cloud-Aufgabenliste uber Supabase. Aufgaben lassen sich anlegen, als erledigt markieren und loschen.

Links
  Verknüpfungsseite (siehe Kurzbefehle oben).

Network
  Zeigt Internet-Erreichbarkeit, Antwortzeit, lokale Schnittstelle, lokale IPv4/IPv6-Adresse, MAC-Adresse, DNS-Server und die offentliche IP (Abfrage uber api.ipify.org, wird in der UI offengelegt).

Schnelle Aktionen / Audio-Konsole
  Ausgabe umschalten (Hotkey Alt+Shift+O), Ausgabe stummschalten, Mikrofon stummschalten, Lautstatke regeln, Kopfhörer-/Monitor-Gerätepaar speichern.

Sentry (konfigurieren)
-----------------------

In der App unter Sentry konnen Organisation, Projekt und API-Token eingegeben werden. Das Token wird mit Electron `safeStorage` lokal verschlusselt in `userData/sentry-config.json` gespeichert und nie in der Oberflache angezeigt.

Alternativ verbindet sich Orbit automatisch über die `.env`-Variablen `SENTRY_ORG`, `SENTRY_PROJECT` und `SENTRY_AUTH_TOKEN`. Die `.env`-Konfiguration hat Vorrang und deaktiviert die In-App-Konfiguration.

Befehle
-------

- `npm start` — App im Entwicklungsmodus starten
- `npm run build:win` — portables Windows-Paket bauen (nur Windows)
- `npm run check` — Syntaxprufung von main, preload und lib/
- `npm test` — Unit- und Integrationstests (kein Netzwerk)
- `npm run test:e2e` — Playwright-E2E-Tests (Windows, startet die echte App gegen lokale Stubs)
- `npm run test:all` — check + test + test:e2e

Sicherheit und Architektur
--------------------------

- Der Renderer ist sandboxed (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`). Native Funktionen kommen ausschlie?lich über `preload.cjs` und `ipcMain` zustande.
- Das GitHub-Token ist read-only und wird nie von der App gespeichert. Offnen von Benachrichtigungen ist auf `https://github.com` beschränkt.
- Das Sentry-Token wird lokal verschlusselt gespeichert und nie in der Oberflache angezeigt.
- Offentliche IP-Abfrage nutzt `https://api.ipify.org`.
- Test-Hooks über Umgebungsvariablen (z. B. `ORBIT_TEST_USER_DATA`, `ORBIT_E2E=1`, `ORBIT_NO_ENV=1`, `ORBIT_WEATHER_BASE_URL`, `ORBIT_GITHUB_BASE_URL`, `ORBIT_PUBLIC_IP_URL`) sind productionsicher und nur für lokale Stubs gedacht. Niemals gegen echte Supabase-, Sentry-, Open-Meteo-, GitHub- oder ipify-Dienste testen.
- Autostart ist absichtlich nicht implementiert.

Vor der Veröffentlichung der History online
-------------------------------------------

- Die echten Tokens in `.env` sind nicht in der Git-History, weil `.env` in `.gitignore` steht und nie committed wurde. Dennoch sollten die Tokens rotiert werden, falls sie jemals außerhalb dieses Rechners gelangt sind.
- Persönliche Kurzbefehle stehen jetzt in `lib/shortcuts-local.cjs` (in `.gitignore`, wird nie gepusht). `main.cjs` enthält nur generische Platzhalter. Vor dem Push prüfen, dass diese Datei nicht versehentlich erzwungen wird (`git add -f`).
- `main.cjs` enthält weiterhin die Supabase-Projekt-URL und den Publishable Key für die To-Do-Funktion. Laut Projektdokumentation ist der Publishable Key sicher zum Ausliefern; die Projekt-Referenz ist dennoch persönliche Infrastruktur und kann bei Bedarf ebenfalls ausgelagert werden.
- `package.json` listet den Autor "Max".

Version und Changelog
---------------------

Bei Fehlern wird die Version in `package.json` hochgezahlt und ein Changelog-Eintrag nach Keep-a-Changelog in `CHANGELOG.md` hinzugefügt. Releases sind Tags der Form `v<version>`, die mit `package.json` übereinstimmen müssen.
