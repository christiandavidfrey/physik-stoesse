# Stösse im Experiment

Mini-Website (GitHub Pages) zur Physik-Aufgabe über elastische und inelastische Stösse.

## Eigene Messdaten eintragen

Alle Tabellen und Diagramme werden automatisch aus **`data/messungen.csv`** erzeugt. Nur diese Datei ersetzen:

| Spalte | Bedeutung | Einheit |
|---|---|---|
| versuch | Nummer des Versuchs | – |
| typ | `elastisch`, `inelastisch` oder `vollkommen inelastisch` | – |
| m1, m2 | Massen der Körper | kg |
| v1, v2 | Geschwindigkeiten vor dem Stoss | m/s |
| v1_nach, v2_nach | Geschwindigkeiten nach dem Stoss | m/s |

Dezimalpunkt verwenden (0.25, nicht 0,25). Impuls, Energieverlust und Stosszahl e werden berechnet.
Danach in `index.html` die Zeile `const IS_DEMO = true;` auf `false` setzen, damit der Beispiel-Hinweis verschwindet.

## Lokal ansehen

```
python3 -m http.server
```
und http://localhost:8000 öffnen.
