# PLAN — G3000 FIX-Funktion (Insert FIX into Flight Plan)
<!--  -->


**Stand:** 2026-05-25 (Revision 2 — GTC-Types-Strategie + MFD-Map-Bundle ergänzt)
**Zielflugzeug:** FSReborn Phenom 300E (`D:\MSFS\Packages\StreamedPackages\fs24-fsreborn-aircraft-phenom300e`) — der G3000 dort ist die unmodifizierte WT G3000 v2 (Phenom-Paket selbst liegt in verschlüsselten `.fsarchive`-Dateien, kein direkter Eingriff möglich).
**Ansatz:** Eigenständiges **Community-Plugin** für WT Avionics Framework V2 — wirkt aircraft-übergreifend auf jedes Flugzeug mit WT G3000 v2 (Phenom 300E, TBM 930 Enhanced, Longitude Enhanced). Liefert **zwei** Plugin-Bundles: eines für die GTC (Eingabe + Insert-Logik) und eines für die MFD (Map-Darstellung).

---

## 1. Ziel

Die im echten Garmin G3000 verfügbare **FIX-Funktion** (Insert FIX into Active Flight Plan) im WT G3000 v2 nachbauen. Der User soll einen Fix an beliebiger Stelle in den aktiven Flightplan einfügen können, definiert per:

| Garmin-Modus | WT-Enum (existiert!)             | Eingabe                                            |
| ------------ | -------------------------------- | -------------------------------------------------- |
| RAD / DIS    | `GtcUserWaypointType.RadialDistance` | Place + Radial + Distance (klassisches PBD)        |
| RAD / RAD    | `GtcUserWaypointType.RadialRadial`   | Place1 + Radial1, Place2 + Radial2 (Intersection)  |
| LAT / LON    | `GtcUserWaypointType.LatLon`         | Direkte Koordinaten                                |
| P.POS        | `GtcUserWaypointType.PPos`           | Aktuelle Flugzeugposition                          |

Zusätzlich (User-Anforderung Rev. 2): Der eingefügte Fix muss **visuell auf der MFD-Map** dargestellt werden — als Kreis-Icon an seiner Position und (für RAD/DIS und RAD/RAD) mit Bearing-Linie(n) von der/den Referenz-Place(s) zum Fix. Standard-Flightplan-Waypoints werden zwar automatisch von der WT-Map gerendert, der Echo-Garmin zeigt aber zusätzlich die Definitions-Geometrie (Place + Radial) als gestrichelte Linie — das wollen wir nachbauen.

---

## 2. Erkenntnisse aus der Recherche

### 2.1 WT G3000 v2 hat fast alle Bausteine bereits — sie sind nur nicht verkettet

Aus `microsoft/msfs-avionics-mirror` (`src/workingtitle-instruments-g3000/`):

- **`GtcUserWaypointDialog.tsx`** + **`GtcUserWaypointDialogStore.ts`** — komplette UI/Logik um User-Waypoints in allen 4 Modi (RAD/DIS, RAD/RAD, LAT/LON, P.POS) zu definieren. Inklusive Magvar-Handling, Radial-Intersection-Berechnung, Auto-Comment-Generation.
- **`GtcUserWaypointInfoPage2.tsx`** — bestehende Page zur Anzeige/Bearbeitung gespeicherter User-Waypoints (zugängig über GTC → Waypoint Info → User).
- **`Fms`** (aus `@microsoft/msfs-garminsdk`, `src/garminsdk/flightplan/Fms.ts`) — bietet `insertWaypoint(...)` (in Flightplan einfügen) und Methoden für User-Facilities.
- **`FacilityRepository`** + **`UserFacility`**/`UserFacilityType` (aus `@microsoft/msfs-sdk`) — User-Facility-Datentyp und Persistierungs-Mechanismus.

### 2.2 Was im WT G3000 v2 fehlt (vs. echter Garmin G3000)

Heutiger Workflow im WT-Plugin (`GTC/Pages/FlightPlanPage/EnrouteOptionsSlideoutMenu.tsx`):

```tsx
<GtcTouchButton label={'Insert\nWaypoint'} onPressed={async () => {
  const newLeg = await GtcFlightPlanDialogs.insertEnrouteWaypoint(
    this.props.gtcService, this.props.fms, this.props.planIndex);
  ...
}} />
```

→ Nur **ein** Button "Insert Waypoint" der per **Identifier-Eingabe** (VOR/NDB/Intersection/Airport-Name) sucht. **Keine** Möglichkeit ad-hoc einen Fix per PBD / RAD-RAD / LAT-LON anzulegen und direkt einzufügen.

Im echten Garmin G3000 erscheint im Insert-Workflow ein zusätzlicher Modus mit Auswahl "User Waypoint / PBD / Radial-Radial / Lat-Lon".

### 2.3 Plugin-Architektur (Avionics Framework V2)

Aus `G3000GTCPlugin.ts`:

```typescript
export interface G3000GtcPlugin extends G3000Plugin<G3000GtcPluginBinder>, GtcInteractionHandler {
  registerGtcViews(gtcService: GtcService, context: Readonly<G3000GtcViewContext>): void;
  getKnobStateOverrides(gtcService: GtcService): Readonly<GtcKnobStatePluginOverrides> | null;
  getLabelBarHandlers(): Readonly<LabelBarPluginHandlers> | null;
}

export abstract class AbstractG3000GtcPlugin extends AvionicsPlugin<G3000GtcPluginBinder> implements G3000GtcPlugin {
  // No-op defaults
}
```

`G3000GtcPluginBinder` liefert u.a. `gtcService`, `flightPlanStore?`, `instrumentConfig`, `navIndicators`. **Wichtig:** `flightPlanStore` ist **optional** — nur GTCs mit MFD-Control-Mode haben ihn. Plugin muss diesen Fall behandeln.

Plugin-Registrierung über XML (Beispiel von Navigraph G3000-Mod):

```xml
<Plugins>
  <Plugin target="WTG3000v2_GTC">coui://html_ui/G3000FixMod/GtcPlugin.js</Plugin>
</Plugins>
```

### 2.4 Build-Setup (aus WT `package.json` + `rollup.config.mjs`)

Drei kritische externals als Globals (für gemeinsame Symbole) — **plus** zwei weitere für die instrument-spezifischen APIs:

| Package                                | Global         | Quelle                                                                 |
| -------------------------------------- | -------------- | ---------------------------------------------------------------------- |
| `@microsoft/msfs-sdk`                  | `msfssdk`      | npm — 2.3.3                                                            |
| `@microsoft/msfs-garminsdk`            | `garminsdk`    | npm — 2.3.4                                                            |
| `@microsoft/msfs-wtg3000-common`       | `wtg3000common`| npm — 2.2.8                                                            |
| `@microsoft/msfs-wtg3000-gtc`          | `wtg3000gtc`   | npm — 2.2.8 (Types-only, siehe 2.5)                                    |
| `@microsoft/msfs-wtg3000-mfd`          | `wtg3000mfd`   | npm — 2.2.8 (Types-only, siehe 2.5)                                    |

→ Plugin bündelt diese NICHT mit ein (es lädt die laufenden Library-Instanzen des G3000-Hosts, sonst funktioniert State-Sharing nicht).

### 2.5 GTC- und MFD-Types über npm (Korrektur vom 2026-05-25)

Initiale Annahme war: Plugin-API ist nicht auf npm, also Mirror-Klon + lokales `.tgz`. **Diese Annahme war falsch.** Verifikation gegen die npm-Registry (`https://registry.npmjs.org/@microsoft/msfs-wtg3000-gtc`):

| Paket                            | npm-Latest | Inhalt                           |
| -------------------------------- | ---------- | -------------------------------- |
| `@microsoft/msfs-wtg3000-common` | 2.2.8      | Geteilte Definitions             |
| `@microsoft/msfs-wtg3000-gtc`    | 2.2.8      | **Types-only** (single `index.d.ts` mit allen GTC-Plugin-APIs, ~14k Zeilen, kein Runtime-JS) |
| `@microsoft/msfs-wtg3000-mfd`    | 2.2.8      | **Types-only** (analog für MFD)  |
| `@microsoft/msfs-wtg3000-pfd`    | 2.2.8      | **Types-only** (PFD)             |

Verifiziert exportiert von `@microsoft/msfs-wtg3000-gtc`: `AbstractG3000GtcPlugin`, `G3000GtcPlugin`, `G3000GtcPluginBinder`, `G3000GtcViewContext`, `GtcService`, alle GTC-Pages/Dialogs.

Die NPM-Pakete enthalten kein Runtime-JS (kein `main`, kein `module`), nur Types. Der Runtime kommt im Sim als IIFE-Global (`wtg3000gtc`, `wtg3000mfd`). Genau das ist das saubere Plugin-Modell: Compile-Time gegen npm-Types, Runtime gegen Coherent-Host-Globals via Rollup-Externals.

**Konsequenz:** Kein Mirror-Klon nötig. Lokales `.tgz` nicht nötig. `package.json` referenziert `@microsoft/msfs-wtg3000-gtc@2.2.8` und `@microsoft/msfs-wtg3000-mfd@2.2.8` als reguläre `devDependencies`. Mirror-Repo bleibt nur als **Lese-Referenz** für die Implementierung relevant (z.B. um `GtcUserWaypointDialogStore`-Logik zu portieren — die Source wird via `gh api`/Web direkt gelesen, nicht geklont).

---

## 3. Architektur des Plugins

### 3.1 Strategie (Revision 4 — 2026-05-25, nach Phase-1-Recherche)

**Phase 1 — MVP (zwei parallele Bundles, Insert + Map-Rendering):**

*GTC-Bundle — Dialog-Chaining statt eigener Page:*

Recherche-Befund: Das WT G3000 v2 hat den vollständigen `GtcUserWaypointDialog` mit allen 4 Modi (RAD/DIS, RAD/RAD, LAT/LON, P.POS) bereits implementiert (`@microsoft/msfs-wtg3000-gtc` Index-Export). Er ist nur nicht in den Enroute-Insert-Pfad verkabelt — er wird heute ausschließlich über die User-Waypoint-Info-Seite getriggert. `GtcDialogs.openDialogChain()` ermöglicht Verkettung mehrerer Dialoge.

**Wir nutzen das.** Statt eine eigene 4-Modi-Page zu bauen, schreiben wir nur den Glue-Code:

- Eigene Helper-Funktion `insertEnrouteFix(gtcService, fms, planIndex)`, die analog zur existierenden `GtcFlightPlanDialogs.insertEnrouteWaypoint(...)` arbeitet, aber statt eines `GtcFindWaypointDialog` (Identifier-Suche) einen `GtcUserWaypointDialog` öffnet
- Ergebnis (UserFacility) wird an `Fms.insertWaypoint(segmentIndex, facility, legIndex?)` weitergegeben
- Override von `EnrouteOptionsSlideoutMenu` (per `registerGtcViews()` unter gleichem Key) mit zusätzlichem "Insert FIX"-Button neben dem bestehenden "Insert Waypoint"-Button
- Bei erfolgreichem Insert: `EventBus.publish('patrick_fix_inserted', FixDefinition)` mit Definitions-Geometrie (Mode, Place-ICAOs, Radials, Distance, resultierende Lat/Lon)

LOC-Schätzung: ~100–200 Zeilen Glue-Code statt ~800 für eine eigene Page.

*MFD-Bundle — Override der Standard-NavMap:*

Recherche-Befund: WT NavMap ist `MapSystem`-basiert (composable `MapLayer`s aus msfs-sdk), aber es gibt **keinen Plugin-Hook** zum Layer-Einschleusen. Die einzigen praktikablen Wege sind:
- (a) Override `NavigationMapPaneView` über `DisplayPaneViewFactory.registerView('navigationMap', ...)` mit eigener Implementierung
- (b) Eigene separate Pane (UX-Bruch — User müsste umschalten)

**Wir wählen (a) — Override.** Das ist riskanter wegen Wartung bei WT-Updates, aber UX-vollständig.

Konkret:
- Eigene `G3000FixNavMapPaneView` extends `DisplayPaneView`
- Baut intern eine MapSystem-NavMap via `MapSystemBuilder` + `G3000MapBuilder.navMap(...)` (replizieren der WT-Map-Konfiguration)
- Fügt unsere eigene `BearingLineLayer` als zusätzlichen Layer hinzu
- `BearingLineLayer extends MapSyncedCanvasLayer`, abonniert `patrick_fix_inserted`/`patrick_fix_removed` Events, hält interne Map `Map<ident, FixDefinition>`
- Rendert für jedes Fix (Canvas 2D):
  - Standard-Waypoint-Icon kommt automatisch via Flight-Plan-Layer (kein Extra-Render)
  - RAD/DIS: gestrichelte Linie Place→Fix (via `greatCircleSamples` für Großkreis-Krümmung)
  - RAD/RAD: zwei gestrichelte Linien (Place1→Fix, Place2→Fix)
  - LAT/LON, P.POS: keine Linie (keine Place-Referenz)

LOC-Schätzung: ~300–500 Zeilen (MapSystem-Boilerplate dominiert).

**WT-Update-Strategie:** Wenn WT die `NavigationMapPaneView`-Komposition ändert, müssen wir nachziehen. Mitigation: jede neue WT-Version (`@microsoft/msfs-wtg3000-common`) händisch durchgehen und Map-Konfiguration vergleichen. CI-Test (vitest) könnte einen Smoke-Test gegen die Index-Symbole machen (bricht wenn ein erwarteter Builder-Call entfernt wird).

### 3.6 Lessons Learned aus FlyByWire A32NX

Recherche im Repo `flybywiresim/aircraft` validiert unseren Ansatz (2026-05-25):

| Pattern                                                                  | FBW-Implementierung                                                     | Unser Status |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------- |
| Diskriminierte Union für Fix-Typen                                       | `PbdWaypoint \| PbxWaypoint \| LatLonWaypoint`                          | ✅ in `FixTypes.ts` |
| Metadata-Preservation: User-Input (mag) UND berechnetes Ergebnis (true)  | `pbdBearing: DegreesMagnetic` + `waypoint.location: Coordinates`        | ✅ in `FixDefinition` |
| Auto-ICAO mit Präfix + Counter                                           | `PBD01`, `PBX02`, ...                                                   | 📝 übernehmen: `PFIX01`, `PFIX02`, ... |
| EventBus zwischen FMS und Display als IPC                                | `FmsSymbolsPublisher` → topic `A32NX_EFIS_L_SYMBOLS`                    | ✅ in `PatrickFixEvents` |
| Geometrie via dediziertes Math-Package                                   | `msfs-geo` npm — alpha, nur Geo-Math, kein Mehrwert für uns             | ❌ nicht swappen, eigene `FixGeometry.ts` + SDK `FacilityUtils` reichen |
| `PathVector[]` für strukturierte Linien-Render-Inputs                    | Array von typed Line-Segmenten                                          | 📝 für `BearingLineLayer` adoptieren |
| Magvar-Strategie: User gibt magnetisch, Storage true, Display magnetisch | `MagVar.magneticToTrue(magBearing, MagVar.getForFix(origin) ?? 0)`      | ✅ matcht unser Konzept |

Nicht übertragbar: FBW's Airbus-ND-Renderer (closed-source), MCDU-spezifische Eingabe-Pages.

**Phase 2 — Integration ins EnrouteOptionsSlideoutMenu:**
- Override des `EnrouteOptionsSlideoutMenu` über `registerGtcViews()` unter gleichem Key (Plugin-API erlaubt das laut Doku)
- Eigenes Menu mit Original-Button "Insert Waypoint" + neuem Button "Insert FIX" der direkt unsere Page öffnet
- Risiko: Bei WT-Updates kann das Original-Menu sich ändern → Plugin-Code muss synchron gehalten werden

**Phase 3 (optional) — Persistente User-Fixes & PFD-Inset-Map:**
- Tatsächliche User-Waypoint-Verwaltung (nicht nur "Temporary") über bestehende `GtcWaypointInfoDirectoryPage`
- Map-Rendering auch im PFD-Inset spiegeln (drittes Bundle, falls gewünscht)

### 3.2 Projekt-Struktur

```
D:\G3000FIX\
├── PLAN.md                          (dieses Dokument)
├── package.json                     (TS+rollup dev deps, build-Scripts)
├── tsconfig.json
├── rollup.config.mjs                (zwei IIFE-Bundles: GTC + MFD)
├── src\
│   ├── gtc\
│   │   ├── index.ts                 (registerPlugin call — GTC entry)
│   │   ├── G3000FixGtcPlugin.tsx    (extends AbstractG3000GtcPlugin)
│   │   ├── pages\
│   │   │   ├── GtcFixInsertPage.tsx (eigene GTC-View)
│   │   │   └── GtcFixInsertPage.css
│   │   ├── store\
│   │   │   └── FixInsertStore.ts    (Logik adaptiert aus GtcUserWaypointDialogStore)
│   │   └── utils\
│   │       └── FacilityUtils.ts     (UserFacility erzeugen + in FacilityRepository ablegen)
│   ├── mfd\
│   │   ├── index.ts                 (registerPlugin call — MFD entry)
│   │   ├── G3000FixMfdPlugin.tsx    (extends AbstractG3000MfdPlugin — exakter Name nach Recherche)
│   │   └── map\
│   │       ├── FixDefinitionLayer.tsx (Map-Layer für Kreis + Bearing-Linien)
│   │       └── FixDefinitionLayer.css
│   └── shared\
│       └── FixDefinitionEvents.ts   (Event-Bus-Topic-Definitionen + Metadata-Typ
│                                     für die Definitions-Geometrie eines Fixes)
└── package\                         (Output-Ordner — wird nach Community kopiert)
    └── patrick-g3000-fix\
        ├── manifest.json
        ├── layout.json              (vom MSFS Build-Tool generiert ODER per Script)
        └── html_ui\
            ├── Plugins\
            │   └── patrick-g3000-fix.xml
            └── G3000FixMod\
                ├── G3000FixGtcPlugin.js     (gebautes IIFE-Bundle für GTC-Target)
                ├── G3000FixGtcPlugin.css
                ├── G3000FixMfdPlugin.js     (gebautes IIFE-Bundle für MFD-Target)
                └── G3000FixMfdPlugin.css
```

### 3.3 Plugin-XML (`patrick-g3000-fix.xml`)

```xml
<Plugins>
  <Plugin target="WTG3000v2_GTC">
    coui://html_ui/G3000FixMod/G3000FixGtcPlugin.js
  </Plugin>
  <Plugin target="WTG3000v2_MFD">
    coui://html_ui/G3000FixMod/G3000FixMfdPlugin.js
  </Plugin>
</Plugins>
```

(GTC für Eingabe + Insert; MFD für Map-Darstellung. PFD-Bundle erst in Phase 3 falls nötig.)

### 3.4 Plugin-Klassen-Skelette

```typescript
// src/gtc/G3000FixGtcPlugin.tsx
import { registerPlugin } from '@microsoft/msfs-sdk';
import { AbstractG3000GtcPlugin, G3000GtcViewContext, GtcService }
  from '@microsoft/msfs-wtg3000-gtc';     // ← Import aus dem GTC-Paket (lokales .tgz)
import { GtcFixInsertPage } from './pages/GtcFixInsertPage';

const FIX_INSERT_PAGE_KEY = 'PatrickFixInsertPage';

class G3000FixGtcPlugin extends AbstractG3000GtcPlugin {
  public registerGtcViews(gtcService: GtcService, context: Readonly<G3000GtcViewContext>): void {
    gtcService.registerView(FIX_INSERT_PAGE_KEY, () =>
      <GtcFixInsertPage gtcService={gtcService} binder={this.binder} context={context} />
    );
  }
  // Phase 2: ggf. getKnobStateOverrides() oder Override existing slideout view
}

registerPlugin(G3000FixGtcPlugin);
```

```typescript
// src/mfd/G3000FixMfdPlugin.tsx
import { registerPlugin } from '@microsoft/msfs-sdk';
import { AbstractG3000MfdPlugin /* o.ä. — Name nach Recherche verifizieren */ }
  from '@microsoft/msfs-wtg3000-mfd';     // ← Import aus dem MFD-Paket (lokales .tgz)
// import { FixDefinitionLayer } from './map/FixDefinitionLayer';

class G3000FixMfdPlugin extends AbstractG3000MfdPlugin {
  // TODO: Layer-Registrierung im NavMap. Konkrete API muss aus dem MFD-Source-Read
  //       hervorgehen (vermutlich registerMfdViews/registerMapLayers o.ä.).
}

registerPlugin(G3000FixMfdPlugin);
```

Exakte Methoden-Signaturen (`registerView`-Return, `G3000GtcViewContext`-Felder, MFD-Plugin-Interface, Map-Layer-Hook) müssen während der Implementierung am echten Source verifiziert werden — die README-Doku ist unvollständig.

### 3.5 Inter-Bundle-Kommunikation (GTC ⇄ MFD)

Der GTC und der MFD laufen im selben MSFS-Coherent-Host, **kommunizieren aber über den globalen `EventBus`** (aus `@microsoft/msfs-sdk`), nicht über geteilten Speicher. Das GTC-Plugin sendet beim erfolgreichen Insert ein Custom-Event mit der Definitions-Geometrie:

```typescript
// src/shared/FixDefinitionEvents.ts
export interface FixDefinition {
  facilityIcao: string;          // ICAO der angelegten UserFacility
  mode: 'RAD_DIS' | 'RAD_RAD' | 'LAT_LON' | 'PPOS';
  place1Icao?: string;
  radial1?: number;              // magnetisch, Grad
  distance1Nm?: number;          // nur bei RAD_DIS
  place2Icao?: string;
  radial2?: number;              // nur bei RAD_RAD
  lat?: number;
  lon?: number;
  insertedAt: number;            // Unix ms
}

export interface PatrickFixEvents {
  'patrick_fix_inserted': FixDefinition;
  'patrick_fix_removed': { facilityIcao: string };
}
```

Das MFD-Plugin hält eine lokale Map `Map<icao, FixDefinition>`, abonniert beide Topics und rendert daraus.

(Alternative: Definitions-Metadata an die UserFacility selbst hängen via `UserFacility.userAssociatedData`. Vor- und Nachteile in Phase 1 abwägen.)

---

## 4. Offene Fragen / Risiken vor Implementierung

| # | Punkt | Auflösung                                                                    |
|---|-------|------------------------------------------------------------------------------|
| 1 | Exakter Inhalt von `G3000GtcViewContext` (welche Refs werden mitgeliefert?) | Source-Read von `G3000GtcViewContext.ts` vor Phase-1-Code                    |
| 2 | Wie öffnet man eine Plugin-View ohne UI-Einsprung? | Test über `gtcService.changePageTo(KEY)` oder GTC-Knob-Override               |
| 3 | Wie kommt Plugin an `Fms`? (nicht direkt im Binder) | Vermutlich aus `flightPlanStore` oder über `context`-Object — verifizieren    |
| 4 | UserFacility-Persistierung: "Temporary" Flag vs. echt gespeichert | Phase 1: Temporary (löschen sich beim FP-Discard); Phase 3: echte User-WPs    |
| 5 | Override von `EnrouteOptionsSlideoutMenu` möglich? | Laut Doku ja (same key), praktischer Test in Phase 2                          |
| 6 | NPM-Verfügbarkeit von `wtg3000-gtc` / `wtg3000-mfd`? | **GEKLÄRT 2026-05-25 (Korrektur):** Sind auf npm als Types-only-Pakete @2.2.8 (siehe 2.5) |
| 7 | MFD-Plugin-Interface (`AbstractG3000MfdPlugin`)? Methoden-Signaturen für Map-Layer-Registrierung? | Source-Read von `html_ui/MFD/G3000MFDPlugin.ts` + Map-Komponenten im Mirror — **noch offen, vor MFD-Code-Start** |
| 8 | Welche Map-Hook-API existiert im MFD? (Custom Layer? Custom Icon? Override eines bestehenden NavMap-Components?) | Recherche im Mirror unter `html_ui/MFD/Map/` oder `Components/Map/` — **noch offen** |
| 9 | Wie ICAO für UserFacility setzen damit GTC-Eintrag und MFD-Render auf denselben Punkt zeigen? | Im echten Garmin haben User-WPs Custom-ICAOs (Präfix `U`). `Fms.insertWaypoint` braucht eine konkrete FacilityIcao — Inspect der vorhandenen UserFacility-Logik im Mirror |
| 10 | EventBus-Topics zwischen GTC und MFD: ist der Bus instrumentenübergreifend? | Ja (laut WT-Doku), aber praktischer Test nötig — Bestätigung durch Lade-Test mit Test-Event |

---

## 5. Konkrete nächste Schritte (nach deiner Freigabe)

**Schritt 5.0 — entfällt** (war Mirror-Klon, jetzt nicht mehr nötig nach Korrektur 2.5)

**Schritt 5.1 — Repo init:**
   - ✅ `package.json` mit devDeps geschrieben — **wird aktualisiert** um `@microsoft/msfs-wtg3000-gtc@2.2.8` und `@microsoft/msfs-wtg3000-mfd@2.2.8` (Types-only-NPM-Pakete)
   - ✅ `tsconfig.json` (JSX = FSComponent, target = ES2017, transformer-Plugin)
   - ✅ `rollup.config.mjs` — **wird zu Dual-Bundle umgebaut** (Array mit zwei IIFE-Builds, Pattern wie WT's eigener Build mit MFD/PFD/GTC)

**Schritt 5.2 — MFD-Plugin-API recherchieren (offene Frage #7, #8):**
   - Source-Read im NPM-Paket `@microsoft/msfs-wtg3000-mfd@2.2.8/index.d.ts` nach `AbstractG3000MfdPlugin` und Map-Komponenten-Hooks (NavMap, Inset-Map, custom Layer)
   - Befund in PLAN.md unter Abschnitt 2 ergänzen — vor dem Schreiben echter MFD-Render-Logik

**Schritt 5.3 — Skelett-Plugins schreiben (beide Bundles):**
   - GTC-Bundle: `src/gtc/index.ts` + minimaler `G3000FixGtcPlugin` der nur `console.log('Patrick FIX GTC Plugin loaded')` macht
   - MFD-Bundle: `src/mfd/index.ts` + minimaler `G3000FixMfdPlugin` der nur `console.log('Patrick FIX MFD Plugin loaded')` macht
   - Build via `npm run build` → beide IIFE-JS im `package/`-Tree

**Schritt 5.4 — Manifest + Layout + Plugin-XML + Deploy:**
   - `manifest.json` (community add-on Format)
   - `layout.json` (per Script aus dem `package/`-Tree generieren)
   - `patrick-g3000-fix.xml` (zwei `<Plugin>`-Tags, siehe 3.3)
   - Symlink oder Copy nach `D:\MSFS\Packages\Community\patrick-g3000-fix\`

**Schritt 5.5 — In-Sim verifizieren (Lade-Test):**
   - Phenom 300E starten, MSFS-Coherent-Debugger öffnen
   - Beide Console-Outputs prüfen (`Patrick FIX GTC Plugin loaded` + `Patrick FIX MFD Plugin loaded`)
   - Erfolg = grünes Licht für 5.6

**Schritt 5.6 — Phase 1 Implementierung (Insert-Logik + Map-Render):**
   - GTC: `GtcFixInsertPage` mit den 4 Modi, Logik aus `GtcUserWaypointDialogStore` adaptiert
   - GTC: Insert via `Fms.insertWaypoint(...)` + EventBus-Publish `patrick_fix_inserted`
   - MFD: Map-Layer `FixDefinitionLayer` abonniert Bus, rendert Kreis + Bearing-Linie(n)
   - Einstieg: zunächst per Knob-Override (UI-Integration via slideout-menu in Phase 2)

**Schritt 5.7 — Phase 2:**
   - Override `EnrouteOptionsSlideoutMenu` mit zusätzlichem "Insert FIX"-Button

---

## 5.B Dev-Loop / Test-Strategie

Eine vollständige Sandbox-Simulation der WT G3000 v2 außerhalb von MSFS ist nicht praktikabel (Kopplung an SimVars, FacilityLoader, FlightPlan-Engine, Navdata). Stattdessen drei sich ergänzende Layer:

**(A) Coherent GT Debugger gegen laufende MSFS-Instanz — Haupt-Dev-Loop ab 5.5**
- Externe Debugger-Exe connectet an die laufende Coherent-Instanz im Sim
- Chrome-DevTools-UI: JS-Console, Sources, Breakpoints, Live-CSS-Edit
- Bundle-Hot-Reload: `G3000FixGtcPlugin.js` im Community-Ordner überschreiben + `location.reload()` im Debugger → neue Version ohne Sim-Restart
- Limit: Bei Änderungen am Plugin-Konstruktor evtl. Cockpit-Neuload nötig (Slew + Aircraft reload)

**(B) Unit-Tests für reine Berechnungs-Logik — empfohlen ab erster RAD/DIS-Implementierung**
- Vitest oder Jest, in-Memory
- `FixInsertStore.computeFixPosition(...)` isoliert getestet mit bekannten Place+Radial+Distance → Lat/Lon Paaren
- Reproduziert Magvar-Logik aus `GtcUserWaypointDialogStore` 1:1
- Wichtig weil Vorzeichen-/Magvar-Fehler im Sim stumm falsch sein können (Fix landet 200 NM daneben)

**(C) Optional: Browser-Sandbox für UI-Iteration**
- Bundler-Alias für `@microsoft/msfs-sdk`, `wtg3000common`, `wtg3000gtc` auf Mock-Stubs
- `GtcFixInsertPage` rendert in normaler Browser-Tab gegen In-Memory-Fakes
- Geht **nicht** für: echte Map-Darstellung, EventBus-MFD-Integration, echte Magvar/Navdata
- Setup-Aufwand ca. ein halber Tag — **erst aufsetzen wenn UI-Komplexität es rechtfertigt** (Mitte Phase 1)

## 6. Was ich NICHT mache (Scope-Match)

- Keine Modifikation des Phenom-Pakets selbst (geht eh nicht — `.fsarchive`)
- Kein WASM-Code
- Keine Änderungen an ModelBehaviors / Hardware-Mappings
- Keine PFD/MFD-Erweiterungen in Phase 1
- Keine Aerostar-600-Änderungen (das ist nur die IDE-File die offen war, irrelevant)
- Kein eigener Avionics-Simulator-Build (siehe 5.B: zu hoher Aufwand, Coherent-Debugger reicht)

---

**STAND nach Revision 3 (Korrektur 2.5: NPM-Pakete vorhanden):**

- ✅ Schritt 5.0 entfällt (Mirror-Klon nicht nötig)
- ✅ Schritt 5.1 — Repo-Init komplett: `package.json` mit npm wtg3000-gtc/mfd@2.2.8, `tsconfig.json`, `rollup.config.mjs` als Dual-Bundle
- ✅ Schritt 5.3 — Beide Skelette geschrieben (`src/gtc/index.tsx`, `src/mfd/index.tsx`)
- ✅ Schritt 5.4 — manifest.json + layout-Generator + plugin.xml; Junction `Community2024 → package/`
- ✅ Schritt 5.5 — **Lade-Test bestanden (2026-05-25)**: beide UI-Marker (PatrickFIX GTC OK + PatrickFIX MFD OK) erscheinen im Sim. Plugin wird vom WT-Framework korrekt ausgeführt.
- ✅ Schritt 5.6a — **Phase 1a bestanden (2026-05-25)**: Marker zu Button gewandelt; Tap öffnet `GtcUserWaypointDialog`; resultierende UserFacility wird via `Fms.insertWaypoint` ins erste Enroute-Segment eingefügt; Fix erscheint im Flightplan + automatisch als Waypoint-Icon auf der Standard-NavMap. EventBus-Publish `patrick_fix_inserted` läuft (noch ungetestet weil kein MFD-Consumer).
- ⏳ Schritt 5.6b — Phase 1b: saubere UI-Integration (MfdHome-Override mit Insert-FIX-Button statt Hack-Badge)
- ⏳ Schritt 5.6c — Phase 1c: NavigationMapPaneView-Override + BearingLineLayer (gestrichelte Definitions-Linien Place→Fix)
