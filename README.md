# Stösse zweier Wagen

GitHub-Pages-Seite zu Praktikum 9 „Stoss“ (Physik 1): elastische, teilelastische und inelastische Stösse zweier Wagen, gemessen mit Ultraschallsensoren (LoggerPro, 200 Hz).

Seite: https://christiandavidfrey.github.io/physik-stoesse/

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Texte und Aufbau der Seite |
| `app.js` | Auswertung (Ableitungen, Kraftstoss, Federmodell) und Diagramme |
| `data/messungen.csv` | eine Zeile pro Messung, steuert Tabelle, Matrix und Übersichtsdiagramme |
| `data/rohdaten/Messung_<nr>.csv` | Rohdaten je Messung: `t_s, x1_m, x2_m` |
| `lib/` | Chart.js und KaTeX (lokal, keine externen Server nötig) |

## Aufbau der Seite

Oben wählt man eine Messung (Link direkt auf eine Messung: `#m7`). Alle Abschnitte folgen der Auswahl: Die Aufbau-Grafik spielt den Stoss aus den geglätteten Messwerten ab und zeigt das Federmodell als gestrichelten Umriss, darunter folgen Ableitung x → v → a und das Federmodell (k, optional Dämpfung c, Massen).

## Aufsätze

Beide Wagen tragen immer denselben Aufsatz: elastisch beide Feder, teilelastisch beide Schaumstoffkeil, inelastisch beide Klett.

## Massen nachtragen

Die Massen stehen nur an **einer** Stelle: in `data/messungen.csv`, Spalten `m1` und `m2` (in kg).

- `m1` = stossender Wagen (Wagen 1, Sensor 1)
- `m2` = gestossener Wagen (Wagen 2, Sensor 2)

Solange die Felder leer sind, zeigt die Seite „fehlt“. Sobald sie ausgefüllt sind, erscheinen automatisch Impuls p und p′, Energieänderung ΔE, mittlere Kraft, Kraftstoss ∫F dt im Vergleich mit Δp₁, das Impulsdiagramm, und das Federmodell übernimmt die echten Massen.

## Spalten von `data/messungen.csv`

| Spalte | Bedeutung |
|---|---|
| versuch | Nummer der Messung (auch `1.2`), muss zum Dateinamen in `data/rohdaten/` passen |
| typ | `elastisch`, `teilelastisch` oder `inelastisch` |
| aufbau | `leicht→schwer`, `schwer→leicht`, `gleich (einer ruht)` oder `gleich (gegeneinander)` |
| m1, m2 | Massen in kg (leer = fehlt noch) |
| v1, v2 | Geschwindigkeiten vor dem Stoss in m/s |
| v1_nach, v2_nach | Geschwindigkeiten nach dem Stoss in m/s |
| t_stoss | Zeitpunkt des Stossbeginns in s |
| bemerkung | freier Text |

Dezimalpunkt verwenden (0.25, nicht 0,25).

## Lokal ansehen

Die Seite lädt die CSV-Dateien nach, deshalb braucht es lokal einen kleinen Webserver:

```
python3 -m http.server
```

und dann http://localhost:8000 öffnen.
