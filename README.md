# AeroOps - Aeronautical Data Visualization & Tactical Avionics

A high-performance geospatial visualization application and tactical avionics telemetry dashboard built for **86,258 world airports**, **48,345 runways**, **11,008 navaids**, and **30,387 radio frequencies**.

---

## Architecture & Features

### 1. Relative Data Path Ingestion
- Reads raw CSV files directly from the relative directory: `../ourairports-data`. Data is sourced from https://github.com/davidmegginson/ourairports-data
- Builds an optimized, indexed SQLite database (`aeronautical_data.db`, ~31 MB) with B-tree indices on `ident`, `iata_code`, `icao_code`, `type`, `iso_country`, coordinates, and runway references.
- Average lookup time: **< 2 milliseconds** per query.

### 2. Tactical Avionics UI & Cockpit Experience
- **Interactive Global Radar Map**: 100% keyless and offline-capable basemap with dynamic viewport bounding-box querying and airport type filters (Major Hubs, Regional, General Aviation, Heliports, Navaids). No API keys or commercial accounts required.
- **Cockpit Drawer Inspector**:
  - **Dynamic Runway Compass Rose**: SVG vector radial compass rendering physical runway centerline strips, magnetic headings, reciprocal threshold designators (e.g., `24L / 06R`), and lighting status.
  - **Avionics Radio Stack**: Authentic VHF radio display for Tower (TWR), Ground (GND), ATIS, Clearance (CLR), and Approach (APP) frequencies with one-click clipboard copying.
  - **Nearby Navigational Aids**: Distance (in Nautical Miles) and bearing to closest VOR, DME, and NDB stations.
  - **Pilot Operational Debriefs**: Real community notes and field comments.
- **Flight Ops Analytics Dashboard**:
  - Runway Length Classification Distribution
  - Runway Surface Material Breakdown (Asphalt vs. Concrete vs. Turf vs. Gravel)
  - Top 10 Nations by Aviation Infrastructure
  - Continental Aerodrome Distribution
- **Aerodrome Registry Table**:
  - Instant searchable table with one-click "Fly To & Inspect" camera navigation.

---

## Quick Start

### 1. Launch Server
Double-click `run.bat` or run:
```bash
python server.py 8080
```

### 2. Open in Browser
Open your browser and navigate to:
```
http://localhost:8080/
```
*(or specify a custom port: `python server.py 8081`)*
