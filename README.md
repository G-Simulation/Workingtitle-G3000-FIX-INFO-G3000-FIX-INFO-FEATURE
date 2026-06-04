# G3000 FIX INFO FEATURE — Real Garmin G5000 "FIX INFO" for WT G3000

Add the real Garmin G5000 "FIX INFO" feature to the Working Title G3000 in MSFS — define user waypoints by radial/distance from any reference, including runway thresholds.

## What it does

Brings the FIX INFO workflow from the real Garmin G5000 to the WT G3000 mod. Create a user waypoint defined by a magnetic radial + distance from any reference point (airport, VOR, intersection, runway threshold) and the plugin renders it on the navigation map with bearing lines and a distance circle — exactly like real-world Garmin pilots use to brief approaches, sector entries, holdings, or initial-approach fixes.

## Features

- **Custom user-waypoint dialog with FIX mode toggle** — auto-generates `FIX###` idents
- **Runway-threshold reference** — type `EDDS07` as REF and the plugin resolves it to the actual runway threshold (not pavement-center) using `OneWayRunway.latitude/longitude` from the MSFS SDK
- **Auto-fill bearings** — selecting a runway as reference automatically fills RAD1 with the runway's real magnetic heading (true course minus point magvar) and RAD2 with the opposing heading (+180°)
- **Multi-bearing fixes** — define a fix with a second radial for sector boundaries
- **"FIX INFO" button in the Waypoint Options slideout** (MSFS 2024 only) — tap any flight-plan leg and create a FIX with that waypoint pre-filled as REF1
- **Map overlay** — dashed circle around the reference at the fix distance, dashed bearing lines for each radial, idents at intersection points
- **Persistent across sessions** — fixes survive flight reloads via the WT FacilityRepository
- **Multi-fix groups** — multiple fixes on the same reference share their bearing lines (auto-detected from existing fixes)

## Compatibility

- **MSFS 2024** — full feature set including the FIX INFO context button in flight-plan waypoint options
- **MSFS 2020** — Threshold reference, auto-fill bearings, multi-bearing fixes, map overlay (context-menu button not available due to WT G3000 v1 plugin API limitations)
- Requires the Working Title G3000 mod (built into the HondaJet HA-420 and other G3000-equipped aircraft)

## Installation

1. Download the appropriate version for your sim
2. Unzip into your Community folder:
   - **MSFS 2024:** `...\Packages\Community2024\`
   - **MSFS 2020:** `...\Packages\Community\`
3. Restart MSFS

## Usage

### Create a runway-relative fix

1. On the GTC, open **User Waypoint** (or tap **FIX INFO** in the waypoint options menu — MSFS 2024)
2. Toggle **FIX mode** (top right of the dialog)
3. Tap **REF** and type e.g. `EDDS07`, `EDDH23L`, `KJFK04R`
4. RAD1, RAD2, and DIS are pre-filled with the runway heading and reciprocal — adjust as needed
5. **Create** — the fix appears on the map as a labeled marker with a distance circle and bearing lines

### Standard ident reference

- Type any airport, VOR, NDB, or intersection ident (e.g. `EDDS`, `FRA`, `BIBOS`) in the REF field

## Credits

Built by gsimulations. Big thanks to a real-world G5000 pilot for the workflow specs and label verification.

## Known limitations

- **MSFS 2020:** no context-menu button (use the standard User Waypoint dialog instead)
- RAD2 is recovered from the comment field on restore (format: `RAD1°/RAD2°/DIS NM`) — manually edited comments may lose RAD2 across sessions

## License

Free to use.
