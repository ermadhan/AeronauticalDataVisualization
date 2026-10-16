/**
 * AeroOps - Aeronautical Data Visualization & Tactical Avionics
 * Frontend Application Controller
 */

// Application State
const state = {
  activeView: 'map-view',
  activeFilters: new Set(['large_airport', 'medium_airport', 'navaids']),
  selectedAirport: null,
  map: null,
  airportLayerGroup: null,
  navaidLayerGroup: null,
  analyticsLoaded: false,
  charts: {},
  registryData: []
};

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initMap();
  initSearch();
  initQuickJumps();
  loadGlobalStats();
  initRegistrySearch();

  // Load initial view
  fetchViewportData();
});

// ============================================================================
// Navigation & View Switching
// ============================================================================

function initNavigation() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetView = tab.getAttribute('data-view');
      switchView(targetView);
    });
  });

  // Drawer close button
  document.getElementById('drawer-close-btn').addEventListener('click', closeDrawer);
}

function switchView(viewId) {
  state.activeView = viewId;

  // Update tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === viewId);
  });

  // Update view containers
  document.querySelectorAll('.view-container').forEach(container => {
    container.classList.toggle('active', container.id === viewId);
  });

  if (viewId === 'map-view') {
    setTimeout(() => {
      if (state.map) state.map.invalidateSize();
    }, 100);
  } else if (viewId === 'analytics-view') {
    if (!state.analyticsLoaded) {
      loadAnalyticsData();
    }
  } else if (viewId === 'table-view') {
    if (state.registryData.length === 0) {
      loadRegistryData();
    }
  }
}

// ============================================================================
// Global Statistics
// ============================================================================

async function loadGlobalStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('stat-airports').textContent = data.totals.airports.toLocaleString();
    document.getElementById('stat-runways').textContent = data.totals.runways.toLocaleString();
    document.getElementById('stat-navaids').textContent = data.totals.navaids.toLocaleString();
    document.getElementById('stat-frequencies').textContent = data.totals.frequencies.toLocaleString();
    document.getElementById('stat-countries').textContent = data.totals.countries.toLocaleString();
  } catch (err) {
    console.warn('Could not load global stats:', err);
  }
}

// ============================================================================
// Leaflet Map & Tactical Radar
// ============================================================================

let currentBaseLayer = null;
let vectorGeoJsonLayer = null;
let graticuleLayer = null;

function initMap() {
  // Center on Europe/Atlantic view by default
  state.map = L.map('map', {
    center: [38.5, -30.0],
    zoom: 4,
    minZoom: 2,
    maxZoom: 18,
    zoomControl: false
  });

  // Dedicated Panes: Enforces base layer is ALWAYS in the background (z-index 100)
  const basePane = state.map.createPane('baseBackgroundPane');
  basePane.style.zIndex = '100';

  // Graticules layer (z-index 150, pointer-events none so it never blocks clicks)
  const graticulePane = state.map.createPane('graticulesPane');
  graticulePane.style.zIndex = '150';
  graticulePane.style.pointerEvents = 'none';

  // Aviation Overlay layer (z-index 450, always on top of basemap)
  const aviationPane = state.map.createPane('aviationPane');
  aviationPane.style.zIndex = '450';

  // Add zoom control at bottom-right
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);

  // Initialize with 100% Offline Tactical Vector Layer
  setBasemapStyle('vector');

  state.airportLayerGroup = L.layerGroup().addTo(state.map);
  state.navaidLayerGroup = L.layerGroup().addTo(state.map);

  // Setup Basemap Switcher Buttons
  const styleButtons = document.querySelectorAll('.map-style-btn');
  styleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const style = btn.getAttribute('data-style');
      setBasemapStyle(style);
    });
  });

  // Debounced map movement handler
  let moveTimeout = null;
  state.map.on('moveend zoomend', () => {
    clearTimeout(moveTimeout);
    moveTimeout = setTimeout(() => {
      fetchViewportData();
    }, 280);
  });

  // Filter chips click handling
  const chips = document.querySelectorAll('.filter-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const type = chip.getAttribute('data-type');
      if (state.activeFilters.has(type)) {
        state.activeFilters.delete(type);
        chip.classList.remove('active');
      } else {
        state.activeFilters.add(type);
        chip.classList.add('active');
      }
      fetchViewportData();
    });
  });
}

function setBasemapStyle(style) {
  if (currentBaseLayer) {
    state.map.removeLayer(currentBaseLayer);
    currentBaseLayer = null;
  }
  if (vectorGeoJsonLayer) {
    state.map.removeLayer(vectorGeoJsonLayer);
  }
  if (graticuleLayer) {
    state.map.removeLayer(graticuleLayer);
  }

  // Update UI buttons
  document.querySelectorAll('.map-style-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-style') === style);
  });

  if (style === 'vector') {
    // 100% Offline Tactical Vector Layer (No Network, No API Key)
    if (!vectorGeoJsonLayer) {
      loadOfflineVectorLayer();
    } else {
      if (graticuleLayer) graticuleLayer.addTo(state.map);
      vectorGeoJsonLayer.addTo(state.map);
    }
  } else if (style === 'osm') {
    // OpenStreetMap Public Community Tiles (Free Open Data, No API Key)
    currentBaseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      pane: 'baseBackgroundPane',
      attribution: '&copy; OpenStreetMap contributors &copy; OurAirports',
      maxZoom: 19
    }).addTo(state.map);
  }
}

async function loadOfflineVectorLayer() {
  try {
    const res = await fetch('/vendor/world.geojson');
    if (!res.ok) throw new Error('world.geojson fetch failed');
    const geojsonData = await res.json();

    // Aeronautical Graticules (Equator, Tropics, Meridians) - rendered in dedicated graticulesPane
    graticuleLayer = L.layerGroup();
    for (let lat = -60; lat <= 60; lat += 30) {
      graticuleLayer.addLayer(L.polyline([[lat, -180], [lat, 180]], {
        pane: 'graticulesPane',
        color: lat === 0 ? 'rgba(0, 242, 254, 0.3)' : 'rgba(255, 255, 255, 0.06)',
        weight: lat === 0 ? 1.5 : 0.8,
        dashArray: '3, 6'
      }));
    }
    for (let lon = -180; lon <= 180; lon += 30) {
      graticuleLayer.addLayer(L.polyline([[-85, lon], [85, lon]], {
        pane: 'graticulesPane',
        color: lon === 0 ? 'rgba(0, 242, 254, 0.3)' : 'rgba(255, 255, 255, 0.06)',
        weight: lon === 0 ? 1.5 : 0.8,
        dashArray: '3, 6'
      }));
    }
    graticuleLayer.addTo(state.map);

    // Vector Landmasses - permanently anchored in baseBackgroundPane (z-index 100)
    vectorGeoJsonLayer = L.geoJSON(geojsonData, {
      pane: 'baseBackgroundPane',
      style: {
        fillColor: '#0c162c',
        fillOpacity: 0.95,
        color: 'rgba(56, 189, 248, 0.35)',
        weight: 1.2
      },
      onEachFeature: (feature, layer) => {
        layer.on({
          mouseover: (e) => {
            const l = e.target;
            l.setStyle({
              fillColor: '#1a294d',
              color: '#00f2fe',
              weight: 1.8
            });
          },
          mouseout: (e) => {
            vectorGeoJsonLayer.resetStyle(e.target);
          }
        });
      }
    }).addTo(state.map);

  } catch (err) {
    console.warn('Could not load offline vector geojson, falling back to OpenStreetMap:', err);
    setBasemapStyle('osm');
  }
}

function initQuickJumps() {
  const jumpButtons = document.querySelectorAll('.jump-btn');
  jumpButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const lat = parseFloat(btn.getAttribute('data-lat'));
      const lon = parseFloat(btn.getAttribute('data-lon'));
      const ident = btn.getAttribute('data-ident');

      state.map.flyTo([lat, lon], 11, { duration: 1.5 });
      setTimeout(() => {
        inspectAirport(ident);
      }, 1600);
    });
  });
}

// ============================================================================
// Viewport Geospatial Data Fetching
// ============================================================================

async function fetchViewportData() {
  if (!state.map) return;

  const bounds = state.map.getBounds();
  const minLat = bounds.getSouth();
  const maxLat = bounds.getNorth();
  const minLon = bounds.getWest();
  const maxLon = bounds.getEast();
  const zoom = state.map.getZoom();

  const statusEl = document.getElementById('map-status-text');
  statusEl.textContent = 'SCANNING VIEWPORT AIRSPACE...';

  // Determine airport types to fetch
  const airportTypes = [];
  if (state.activeFilters.has('large_airport')) airportTypes.push('large_airport');
  if (state.activeFilters.has('medium_airport')) airportTypes.push('medium_airport');
  if (state.activeFilters.has('small_airport')) airportTypes.push('small_airport');
  if (state.activeFilters.has('heliport')) airportTypes.push('heliport');

  let airportCount = 0;
  let navaidCount = 0;

  // 1. Fetch Airports
  if (airportTypes.length > 0) {
    try {
      const limit = zoom > 9 ? 1200 : (zoom > 6 ? 600 : 300);
      const url = `/api/airports?minLat=${minLat}&maxLat=${maxLat}&minLon=${minLon}&maxLon=${maxLon}&types=${airportTypes.join(',')}&limit=${limit}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        renderAirportMarkers(data.airports);
        airportCount = data.count;
      }
    } catch (err) {
      console.warn('Error fetching airports:', err);
    }
  } else {
    state.airportLayerGroup.clearLayers();
  }

  // 2. Fetch Navaids
  if (state.activeFilters.has('navaids') && zoom >= 6) {
    try {
      const limit = zoom > 9 ? 300 : 150;
      const url = `/api/navaids?minLat=${minLat}&maxLat=${maxLat}&minLon=${minLon}&maxLon=${maxLon}&limit=${limit}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        renderNavaidMarkers(data.navaids);
        navaidCount = data.count;
      }
    } catch (err) {
      console.warn('Error fetching navaids:', err);
    }
  } else {
    state.navaidLayerGroup.clearLayers();
  }

  statusEl.textContent = `RADAR LOCK: ${airportCount} AERODROMES | ${navaidCount} NAVAIDS (ZOOM ${zoom})`;
}

// ============================================================================
// Marker Rendering
// ============================================================================

function renderAirportMarkers(airports) {
  state.airportLayerGroup.clearLayers();

  airports.forEach(apt => {
    if (!apt.latitude_deg || !apt.longitude_deg) return;

    let markerColor = '#38bdf8'; // medium
    let radius = 6;
    let strokeColor = '#0284c7';

    if (apt.type === 'large_airport') {
      markerColor = '#00f2fe';
      radius = 8;
      strokeColor = '#ffffff';
    } else if (apt.type === 'heliport') {
      markerColor = '#f59e0b';
      radius = 5;
      strokeColor = '#b45309';
    } else if (apt.type === 'small_airport') {
      markerColor = '#94a3b8';
      radius = 4;
      strokeColor = '#475569';
    }

    const marker = L.circleMarker([apt.latitude_deg, apt.longitude_deg], {
      pane: 'aviationPane',
      radius: radius,
      fillColor: markerColor,
      color: strokeColor,
      weight: 1.5,
      opacity: 0.9,
      fillOpacity: 0.85
    });

    // Tactical Tooltip
    const iataBadge = apt.iata_code ? `<span style="color:#00f2fe;font-weight:700;">[${apt.iata_code}]</span> ` : '';
    const tooltipHtml = `
      <div style="font-family:'Inter',sans-serif;font-size:12px;padding:2px 4px;">
        <div style="font-family:'JetBrains Mono',monospace;font-weight:700;color:#38bdf8;margin-bottom:2px;">
          ${apt.ident} ${iataBadge}
        </div>
        <div style="font-weight:600;color:#f8fafc;margin-bottom:2px;">${apt.name}</div>
        <div style="font-size:11px;color:#94a3b8;">${apt.municipality || ''} ${apt.iso_country} | Elev: ${apt.elevation_ft || 0} ft</div>
      </div>
    `;
    marker.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -6] });

    marker.on('click', () => {
      inspectAirport(apt.ident);
    });

    state.airportLayerGroup.addLayer(marker);
  });
}

function renderNavaidMarkers(navaids) {
  state.navaidLayerGroup.clearLayers();

  navaids.forEach(nav => {
    if (!nav.latitude_deg || !nav.longitude_deg) return;

    // Violet diamond marker
    const marker = L.circleMarker([nav.latitude_deg, nav.longitude_deg], {
      pane: 'aviationPane',
      radius: 4,
      fillColor: '#a855f7',
      color: '#d8b4fe',
      weight: 1.5,
      opacity: 0.8,
      fillOpacity: 0.8
    });

    const tooltipHtml = `
      <div style="font-family:'Inter',sans-serif;font-size:11px;padding:2px 4px;">
        <div style="font-family:'JetBrains Mono',monospace;font-weight:700;color:#c084fc;">
          ${nav.ident} (${nav.type})
        </div>
        <div style="color:#f8fafc;font-weight:600;">${nav.name}</div>
        <div style="color:#94a3b8;font-size:10px;">Freq: ${nav.frequency_khz ? (nav.frequency_khz / 1000).toFixed(2) + ' MHz' : '--'}</div>
      </div>
    `;
    marker.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -4] });

    state.navaidLayerGroup.addLayer(marker);
  });
}

// ============================================================================
// Cockpit Drawer & Deep-Dive Inspection
// ============================================================================

async function inspectAirport(ident) {
  try {
    const res = await fetch(`/api/airport/${encodeURIComponent(ident)}`);
    if (!res.ok) {
      console.warn(`Airport ${ident} not found.`);
      return;
    }
    const data = await res.json();
    populateDrawer(data);
    openDrawer();
  } catch (err) {
    console.error('Error fetching airport details:', err);
  }
}

function populateDrawer(data) {
  const apt = data.airport;
  const runways = data.runways || [];
  const freqs = data.frequencies || [];
  const comments = data.comments || [];
  const navaids = data.nearby_navaids || [];

  state.selectedAirport = apt;

  // Header badges & titles
  document.getElementById('drawer-ident').textContent = apt.ident || '----';
  document.getElementById('drawer-iata').textContent = apt.iata_code || apt.icao_code || '---';
  
  const typeBadge = document.getElementById('drawer-type');
  const typeClean = (apt.type || 'airport').replace('_', ' ');
  typeBadge.textContent = typeClean;
  typeBadge.className = 'badge-type ' + (apt.type ? apt.type.split('_')[0] : '');

  document.getElementById('drawer-name').textContent = apt.name || 'Aerodrome';
  const regionText = apt.region_name ? `${apt.region_name}, ` : '';
  const countryText = apt.country_name || apt.iso_country || '';
  const muniText = apt.municipality ? `${apt.municipality}, ` : '';
  document.getElementById('drawer-location').textContent = `${muniText}${regionText}${countryText}`;

  // Telemetry Grid
  document.getElementById('card-elevation').textContent = (apt.elevation_ft !== null && apt.elevation_ft !== '') ? `${Number(apt.elevation_ft).toLocaleString()} ft` : 'Unknown';
  document.getElementById('card-service').textContent = apt.scheduled_service === 'yes' ? 'Commercial Active' : 'General / Private';
  document.getElementById('card-lat').textContent = apt.latitude_deg ? Number(apt.latitude_deg).toFixed(4) + '°' : '--';
  document.getElementById('card-lon').textContent = apt.longitude_deg ? Number(apt.longitude_deg).toFixed(4) + '°' : '--';

  // 1. Runway Orientation Compass & List
  document.getElementById('runway-count-badge').textContent = `${runways.length} RUNWAY${runways.length === 1 ? '' : 'S'}`;
  renderRunwayCompass(runways);
  renderRunwayList(runways);

  // 2. Radio Communication Rack
  renderRadioStack(freqs);

  // 3. Nearby Navaids
  renderNearbyNavaids(navaids);

  // 4. Pilot Comments
  renderComments(comments);
}

function openDrawer() {
  document.getElementById('cockpit-drawer').classList.add('open');
}

function closeDrawer() {
  document.getElementById('cockpit-drawer').classList.remove('open');
}

// ============================================================================
// Runway Compass SVG Renderer
// ============================================================================

function renderRunwayCompass(runways) {
  const svg = document.getElementById('runway-compass');
  const cx = 110;
  const cy = 110;
  const r = 90;

  // Compass Rose background ring
  let html = `
    <!-- Compass Background Ring -->
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(10, 18, 32, 0.7)" stroke="rgba(56, 189, 248, 0.25)" stroke-width="2" />
    <circle cx="${cx}" cy="${cy}" r="${r - 16}" fill="none" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1" stroke-dasharray="2,3" />
    <circle cx="${cx}" cy="${cy}" r="4" fill="#38bdf8" />
    
    <!-- Cardinal Directions -->
    <text x="${cx}" y="32" fill="#38bdf8" font-family="'JetBrains Mono',monospace" font-size="11" font-weight="700" text-anchor="middle">N</text>
    <text x="${cx + r - 8}" y="${cy + 4}" fill="#94a3b8" font-family="'JetBrains Mono',monospace" font-size="10" font-weight="600" text-anchor="middle">E</text>
    <text x="${cx}" y="${cy + r - 4}" fill="#94a3b8" font-family="'JetBrains Mono',monospace" font-size="10" font-weight="600" text-anchor="middle">S</text>
    <text x="32" y="${cy + 4}" fill="#94a3b8" font-family="'JetBrains Mono',monospace" font-size="10" font-weight="600" text-anchor="middle">W</text>
  `;

  // Draw 30-degree tick marks
  for (let deg = 0; deg < 360; deg += 30) {
    const rad = (deg - 90) * Math.PI / 180;
    const x1 = cx + (r - 6) * Math.cos(rad);
    const y1 = cy + (r - 6) * Math.sin(rad);
    const x2 = cx + r * Math.cos(rad);
    const y2 = cy + r * Math.sin(rad);
    html += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(56, 189, 248, 0.4)" stroke-width="1.5" />`;
  }

  // Draw Runways
  if (runways.length === 0) {
    html += `<text x="${cx}" y="${cy + 25}" fill="#64748b" font-size="10" text-anchor="middle">No Runway Data</text>`;
  } else {
    runways.forEach((rwy, idx) => {
      // Determine runway heading angle (le_heading_degT or parsed from le_ident e.g. "07L" -> 70°)
      let heading = null;
      if (rwy.le_heading_degT && !isNaN(rwy.le_heading_degT)) {
        heading = parseFloat(rwy.le_heading_degT);
      } else if (rwy.le_ident) {
        const numMatch = rwy.le_ident.match(/\d+/);
        if (numMatch) {
          heading = parseInt(numMatch[0], 10) * 10;
        }
      }

      if (heading === null) {
        heading = (idx * 45) % 360; // fallback spacing
      }

      const rad = (heading - 90) * Math.PI / 180;
      const rwyLen = 65; // half length inside circle
      const rwyWidth = 10;

      // Runway centerline endpoints
      const xA = cx + rwyLen * Math.cos(rad);
      const yA = cy + rwyLen * Math.sin(rad);
      const xB = cx - rwyLen * Math.cos(rad);
      const yB = cy - rwyLen * Math.sin(rad);

      // Distinct runway colors
      const colors = ['#00f2fe', '#f59e0b', '#10b981', '#a855f7'];
      const rwyColor = colors[idx % colors.length];

      // Draw thick runway strip
      html += `
        <line x1="${xA}" y1="${yA}" x2="${xB}" y2="${yB}" stroke="#1e293b" stroke-width="${rwyWidth + 4}" stroke-linecap="square" />
        <line x1="${xA}" y1="${yA}" x2="${xB}" y2="${yB}" stroke="${rwyColor}" stroke-width="${rwyWidth}" stroke-linecap="square" opacity="0.9" />
        <line x1="${xA}" y1="${yA}" x2="${xB}" y2="${yB}" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="3,3" />
      `;

      // Labels on each threshold
      const labelDist = rwyLen + 14;
      const lxA = cx + labelDist * Math.cos(rad);
      const lyA = cy + labelDist * Math.sin(rad) + 3;
      const lxB = cx - labelDist * Math.cos(rad);
      const lyB = cy - labelDist * Math.sin(rad) + 3;

      const identA = rwy.le_ident || '';
      const identB = rwy.he_ident || '';

      if (identA) {
        html += `<text x="${lxA}" y="${lyA}" fill="${rwyColor}" font-family="'JetBrains Mono',monospace" font-size="9" font-weight="700" text-anchor="middle">${identA}</text>`;
      }
      if (identB) {
        html += `<text x="${lxB}" y="${lyB}" fill="${rwyColor}" font-family="'JetBrains Mono',monospace" font-size="9" font-weight="700" text-anchor="middle">${identB}</text>`;
      }
    });
  }

  svg.innerHTML = html;
}

function renderRunwayList(runways) {
  const container = document.getElementById('runway-list');
  if (runways.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:10px;">No registered runway strips.</div>';
    return;
  }

  container.innerHTML = runways.map(rwy => {
    const identA = rwy.le_ident || '??';
    const identB = rwy.he_ident || '??';
    const len = rwy.length_ft ? `${Number(rwy.length_ft).toLocaleString()} ft` : 'Unspecified';
    const width = rwy.width_ft ? `x ${rwy.width_ft} ft` : '';
    const surface = rwy.surface || 'Paved';
    const lighted = rwy.lighted === '1' ? '<span style="color:#10b981;">● Lit</span>' : '<span style="color:#64748b;">○ Unlit</span>';

    return `
      <div class="runway-card">
        <div>
          <span class="rwy-ident">${identA} / ${identB}</span>
          <span class="rwy-surface">${surface}</span>
        </div>
        <div class="rwy-specs">
          <div>${len} ${width}</div>
          <div style="font-size:0.7rem;margin-top:2px;">${lighted}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================================
// Radio Stack Renderer
// ============================================================================

function renderRadioStack(freqs) {
  const container = document.getElementById('radio-stack');
  if (freqs.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:10px;">No published radio frequencies.</div>';
    return;
  }

  container.innerHTML = freqs.map(f => {
    const freqMhz = f.frequency_mhz ? Number(f.frequency_mhz).toFixed(3) : '---';
    return `
      <div class="radio-row">
        <div>
          <span class="radio-type">${f.type || 'COMM'}</span>
          <span class="radio-desc">${f.description || ''}</span>
        </div>
        <div class="radio-freq" title="Click to copy frequency" onclick="copyFrequency('${freqMhz}')">
          ${freqMhz}
        </div>
      </div>
    `;
  }).join('');
}

window.copyFrequency = (freq) => {
  navigator.clipboard.writeText(freq);
  const statusEl = document.getElementById('map-status-text');
  statusEl.textContent = `VHF FREQUENCY ${freq} MHz COPIED TO CLIPBOARD`;
};

// ============================================================================
// Navaids & Comments Renderer
// ============================================================================

function renderNearbyNavaids(navaids) {
  const container = document.getElementById('nearby-navaids-list');
  if (navaids.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:10px;">No navaids within 50 NM.</div>';
    return;
  }

  container.innerHTML = navaids.map(n => {
    const freqKhz = n.frequency_khz ? `${(n.frequency_khz / 1000).toFixed(2)} MHz` : '--';
    const dist = n.distance_nm !== null ? `${n.distance_nm} NM` : '';
    return `
      <div class="navaid-item">
        <div>
          <span class="navaid-ident">${n.ident}</span>
          <span style="font-size:0.75rem;font-weight:600;margin-left:6px;color:#e2e8f0;">${n.name} (${n.type})</span>
          <div style="font-size:0.7rem;color:var(--text-muted);font-family:var(--font-mono);">${freqKhz}</div>
        </div>
        <div class="navaid-dist">${dist}</div>
      </div>
    `;
  }).join('');
}

function renderComments(comments) {
  const container = document.getElementById('comments-list');
  if (comments.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:10px;">No operational debriefs posted.</div>';
    return;
  }

  container.innerHTML = comments.slice(0, 5).map(c => {
    const author = c.memberNickname || 'Aviator';
    const date = (c.date || '').split(' ')[0] || '';
    return `
      <div class="comment-card">
        <div class="comment-header">
          <span style="font-weight:600;color:var(--accent-cyan);">${author}</span>
          <span>${date}</span>
        </div>
        <div style="font-weight:600;font-size:0.78rem;color:#f1f5f9;margin-bottom:3px;">${c.subject || 'Note'}</div>
        <div class="comment-body">${c.body || ''}</div>
      </div>
    `;
  }).join('');
}

// ============================================================================
// Global Autocomplete Search
// ============================================================================

function initSearch() {
  const searchInput = document.getElementById('global-search');
  const dropdown = document.getElementById('search-results');
  let searchTimeout = null;

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const query = searchInput.value.trim();

    if (query.length < 2) {
      dropdown.style.display = 'none';
      return;
    }

    searchTimeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) return;
        const data = await res.json();
        renderSearchResults(data.results);
      } catch (err) {
        console.warn('Search query error:', err);
      }
    }, 200);
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

function renderSearchResults(results) {
  const dropdown = document.getElementById('search-results');
  if (!results || results.length === 0) {
    dropdown.innerHTML = '<div style="padding:12px;font-size:0.8rem;color:var(--text-muted);text-align:center;">No matching aerodromes found.</div>';
    dropdown.style.display = 'block';
    return;
  }

  dropdown.innerHTML = results.map(item => {
    const iataBadge = item.iata_code ? `(${item.iata_code})` : '';
    const typeLabel = (item.type || 'airport').replace('_', ' ');
    return `
      <div class="search-result-item" onclick="selectSearchResult('${item.ident}', ${item.latitude_deg}, ${item.longitude_deg})">
        <div class="result-ident">${item.ident} ${iataBadge}</div>
        <div class="result-info">
          <div class="result-name">${item.name}</div>
          <div class="result-sub">${item.municipality || ''} ${item.iso_country || ''}</div>
        </div>
        <div class="result-badge">${typeLabel}</div>
      </div>
    `;
  }).join('');

  dropdown.style.display = 'block';
}

window.selectSearchResult = (ident, lat, lon) => {
  document.getElementById('search-results').style.display = 'none';
  document.getElementById('global-search').value = ident;

  switchView('map-view');

  if (lat && lon) {
    state.map.flyTo([lat, lon], 12, { duration: 1.4 });
    setTimeout(() => {
      inspectAirport(ident);
    }, 1500);
  } else {
    inspectAirport(ident);
  }
};

// ============================================================================
// Global Analytics Dashboard (Chart.js)
// ============================================================================

async function loadAnalyticsData() {
  try {
    const res = await fetch('/api/analytics');
    if (!res.ok) return;
    const data = await res.json();

    // Chart.js global dark theme settings: enforce high-contrast bright text across all charts
    Chart.defaults.color = '#f1f5f9';
    Chart.defaults.font.family = "'Inter', sans-serif";
    if (Chart.defaults.plugins && Chart.defaults.plugins.legend && Chart.defaults.plugins.legend.labels) {
      Chart.defaults.plugins.legend.labels.color = '#f8fafc';
    }

    renderRunwayLengthChart(data.runway_lengths);
    renderSurfaceChart(data.runway_surfaces);
    renderCountriesChart(data.continents);
    renderContinentsChart(data.continents);

    state.analyticsLoaded = true;
  } catch (err) {
    console.error('Failed to load analytics:', err);
  }
}

function renderRunwayLengthChart(data) {
  const ctx = document.getElementById('chart-runways').getContext('2d');
  if (state.charts.runways) state.charts.runways.destroy();

  state.charts.runways = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.bracket),
      datasets: [{
        label: 'Runway Count',
        data: data.map(d => d.count),
        backgroundColor: 'rgba(0, 242, 254, 0.65)',
        borderColor: '#00f2fe',
        borderWidth: 1.5,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(8, 14, 26, 0.96)',
          titleColor: '#00f2fe',
          bodyColor: '#f8fafc',
          borderColor: 'rgba(56, 189, 248, 0.4)',
          borderWidth: 1,
          padding: 10
        }
      },
      scales: {
        x: {
          ticks: { color: '#e2e8f0', font: { size: 11, weight: '500' } },
          grid: { color: 'rgba(255, 255, 255, 0.08)' }
        },
        y: {
          ticks: { color: '#e2e8f0', font: { size: 11, weight: '500' } },
          grid: { color: 'rgba(255, 255, 255, 0.08)' }
        }
      }
    }
  });
}

function renderSurfaceChart(data) {
  const ctx = document.getElementById('chart-surfaces').getContext('2d');
  if (state.charts.surfaces) state.charts.surfaces.destroy();

  const total = data.reduce((acc, d) => acc + d.count, 0) || 1;

  // Format labels with percentages directly for crisp rendering
  const labels = data.map(d => {
    const pct = ((d.count / total) * 100).toFixed(1);
    return `${d.material} (${pct}%)`;
  });

  state.charts.surfaces = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data.map(d => d.count),
        backgroundColor: [
          '#38bdf8', '#10b981', '#f59e0b', '#a855f7', '#f43f5e', '#64748b'
        ],
        borderColor: '#080d1a',
        borderWidth: 2,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      layout: {
        padding: 6
      },
      plugins: {
        legend: {
          position: 'right',
          labels: {
            boxWidth: 14,
            padding: 10,
            color: '#f8fafc', // High contrast white text
            font: { family: "'Inter', sans-serif", size: 11, weight: '600' }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(8, 14, 26, 0.96)',
          titleColor: '#38bdf8',
          bodyColor: '#f8fafc',
          borderColor: 'rgba(56, 189, 248, 0.4)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function(context) {
              const val = context.raw || 0;
              const pct = ((val / total) * 100).toFixed(1);
              return ` ${val.toLocaleString()} runways (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

async function renderCountriesChart() {
  const res = await fetch('/api/stats');
  if (!res.ok) return;
  const stats = await res.json();
  const top10 = stats.top_countries || [];

  const ctx = document.getElementById('chart-countries').getContext('2d');
  if (state.charts.countries) state.charts.countries.destroy();

  state.charts.countries = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top10.map(d => d.name || d.iso_country),
      datasets: [{
        label: 'Airports & Facilities',
        data: top10.map(d => d.count),
        backgroundColor: 'rgba(56, 189, 248, 0.7)',
        borderColor: '#38bdf8',
        borderWidth: 1.5,
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(8, 14, 26, 0.96)',
          titleColor: '#38bdf8',
          bodyColor: '#f8fafc',
          borderColor: 'rgba(56, 189, 248, 0.4)',
          borderWidth: 1,
          padding: 10
        }
      },
      scales: {
        x: {
          ticks: { color: '#e2e8f0', font: { size: 11, weight: '500' } },
          grid: { color: 'rgba(255, 255, 255, 0.08)' }
        },
        y: {
          ticks: { color: '#f8fafc', font: { size: 12, weight: '600' } },
          grid: { display: false }
        }
      }
    }
  });
}

function renderContinentsChart(continents) {
  const ctx = document.getElementById('chart-continents').getContext('2d');
  if (state.charts.continents) state.charts.continents.destroy();

  const total = continents.reduce((acc, c) => acc + c.count, 0) || 1;

  // Format labels with percentages directly for crisp rendering
  const labels = continents.map(c => {
    const pct = ((c.count / total) * 100).toFixed(1);
    return `${c.continent_name} (${pct}%)`;
  });

  state.charts.continents = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: continents.map(c => c.count),
        backgroundColor: [
          '#00f2fe', // North America (Cyan)
          '#10b981', // Asia (Emerald)
          '#38bdf8', // Europe (Sky)
          '#f59e0b', // South America (Amber)
          '#a855f7', // Oceania (Violet)
          '#f43f5e', // Africa (Rose)
          '#94a3b8'  // Antarctica (Slate)
        ],
        borderColor: '#080d1a',
        borderWidth: 2,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      layout: {
        padding: 6
      },
      plugins: {
        legend: {
          position: 'right',
          labels: {
            boxWidth: 14,
            padding: 10,
            color: '#f8fafc', // High contrast white text
            font: {
              family: "'Inter', sans-serif",
              size: 11,
              weight: '600'
            }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(8, 14, 26, 0.96)',
          titleColor: '#00f2fe',
          bodyColor: '#f8fafc',
          borderColor: 'rgba(56, 189, 248, 0.4)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function(context) {
              const val = context.raw || 0;
              const pct = ((val / total) * 100).toFixed(1);
              return ` ${val.toLocaleString()} facilities (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

// ============================================================================
// Aerodrome Registry Table
// ============================================================================

async function loadRegistryData(query = '') {
  try {
    let url = '/api/airports?types=large_airport,medium_airport&limit=100';
    if (query) {
      url = `/api/search?q=${encodeURIComponent(query)}`;
    }
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    const list = data.airports || data.results || [];
    state.registryData = list;
    renderRegistryTable(list);
  } catch (err) {
    console.warn('Failed to load registry:', err);
  }
}

function renderRegistryTable(items) {
  const tbody = document.getElementById('registry-tbody');
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--text-muted);">No aerodromes found.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(apt => {
    const lat = apt.latitude_deg ? Number(apt.latitude_deg).toFixed(3) : '--';
    const lon = apt.longitude_deg ? Number(apt.longitude_deg).toFixed(3) : '--';
    const elev = apt.elevation_ft !== null ? `${apt.elevation_ft} ft` : '--';
    const typeClean = (apt.type || 'airport').replace('_', ' ');

    return `
      <tr>
        <td class="ident-code">${apt.ident}</td>
        <td><span style="font-family:var(--font-mono);font-weight:600;color:var(--accent-cyan);">${apt.iata_code || '--'}</span></td>
        <td style="font-weight:600;color:#f8fafc;">${apt.name}</td>
        <td><span class="badge-type ${apt.type ? apt.type.split('_')[0] : ''}">${typeClean}</span></td>
        <td>${apt.iso_country || '--'}</td>
        <td>${apt.municipality || '--'}</td>
        <td style="font-family:var(--font-mono);">${elev}</td>
        <td style="font-family:var(--font-mono);font-size:0.75rem;">${lat}, ${lon}</td>
        <td>
          <button class="jump-btn" onclick="selectSearchResult('${apt.ident}', ${apt.latitude_deg}, ${apt.longitude_deg})">
            Fly To & Inspect
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function initRegistrySearch() {
  const input = document.getElementById('registry-search');
  let timeout = null;
  input.addEventListener('input', () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      loadRegistryData(input.value.trim());
    }, 250);
  });
}
