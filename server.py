"""
Aeronautical Data Visualization - Backend API & Static Web Server
Built with Python 3 Standard Library (ThreadingHTTPServer + sqlite3)
Supports relative data paths, high-performance geospatial queries, and static asset delivery.
"""
import os
import sys
import json
import math
import sqlite3
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "aeronautical_data.db")
DATA_DIR = os.getenv("AERO_DATA_DIR", os.path.normpath(os.path.join(BASE_DIR, "..", "ourairports-data")))
PORT = 8080

def get_db_connection():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def haversine_distance_nm(lat1, lon1, lat2, lon2):
    """Calculate distance in Nautical Miles between two coordinates."""
    try:
        phi1 = math.radians(float(lat1))
        phi2 = math.radians(float(lat2))
        delta_phi = math.radians(float(lat2) - float(lat1))
        delta_lambda = math.radians(float(lon2) - float(lon1))
        a = (math.sin(delta_phi / 2.0) ** 2 +
             math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2))
        c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
        distance_km = 6371.0 * c
        return round(distance_km * 0.539957, 1)  # 1 km = 0.539957 NM
    except Exception:
        return None

class AeroDataHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        # Enable CORS for local development
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path.startswith("/api/"):
            try:
                self.handle_api(path, query)
            except Exception as e:
                self.send_json({"error": str(e)}, status=500)
        else:
            # Fall back to static files in the directory
            if path == "/" or path == "":
                self.path = "/index.html"
            super().do_GET()

    def handle_api(self, path, query):
        conn = get_db_connection()
        cursor = conn.cursor()

        # 1. Global Overview Statistics
        if path == "/api/stats":
            cursor.execute("SELECT count(*) FROM airports")
            total_airports = cursor.fetchone()[0]

            cursor.execute("SELECT count(*) FROM runways")
            total_runways = cursor.fetchone()[0]

            cursor.execute("SELECT count(*) FROM airport_frequencies")
            total_freqs = cursor.fetchone()[0]

            cursor.execute("SELECT count(*) FROM navaids")
            total_navaids = cursor.fetchone()[0]

            cursor.execute("SELECT count(*) FROM countries")
            total_countries = cursor.fetchone()[0]

            cursor.execute("""
                SELECT type, count(*) as count 
                FROM airports 
                GROUP BY type 
                ORDER BY count DESC
            """)
            airport_types = [dict(row) for row in cursor.fetchall()]

            cursor.execute("""
                SELECT c.name, a.iso_country, count(*) as count 
                FROM airports a
                LEFT JOIN countries c ON a.iso_country = c.code
                GROUP BY a.iso_country 
                ORDER BY count DESC 
                LIMIT 10
            """)
            top_countries = [dict(row) for row in cursor.fetchall()]

            self.send_json({
                "totals": {
                    "airports": total_airports,
                    "runways": total_runways,
                    "frequencies": total_freqs,
                    "navaids": total_navaids,
                    "countries": total_countries
                },
                "airport_types": airport_types,
                "top_countries": top_countries
            })

        # 2. Viewport-Bounded Airports Query (Geospatial)
        elif path == "/api/airports":
            min_lat = query.get("minLat", [None])[0]
            max_lat = query.get("maxLat", [None])[0]
            min_lon = query.get("minLon", [None])[0]
            max_lon = query.get("maxLon", [None])[0]
            types = query.get("types", [None])[0]
            limit = int(query.get("limit", [500])[0])
            limit = min(limit, 2000)

            conditions = ["latitude_deg IS NOT NULL", "longitude_deg IS NOT NULL"]
            params = []

            if min_lat and max_lat and min_lon and max_lon:
                conditions.append("latitude_deg BETWEEN ? AND ?")
                params.extend([float(min_lat), float(max_lat)])
                conditions.append("longitude_deg BETWEEN ? AND ?")
                params.extend([float(min_lon), float(max_lon)])

            if types:
                type_list = [t.strip() for t in types.split(",") if t.strip()]
                if type_list:
                    placeholders = ",".join(["?"] * len(type_list))
                    conditions.append(f"type IN ({placeholders})")
                    params.extend(type_list)

            where_clause = " AND ".join(conditions)
            sql = f"""
                SELECT id, ident, type, name, latitude_deg, longitude_deg, 
                       elevation_ft, iso_country, municipality, iata_code, icao_code
                FROM airports
                WHERE {where_clause}
                ORDER BY CASE 
                    WHEN type = 'large_airport' THEN 1
                    WHEN type = 'medium_airport' THEN 2
                    WHEN type = 'small_airport' THEN 3
                    ELSE 4
                END, elevation_ft DESC
                LIMIT ?
            """
            params.append(limit)
            cursor.execute(sql, params)
            rows = [dict(r) for r in cursor.fetchall()]
            self.send_json({"count": len(rows), "airports": rows})

        # 3. Quick Autocomplete Search (Name, ICAO, IATA, Municipality)
        elif path == "/api/search":
            q = query.get("q", [""])[0].strip()
            if not q or len(q) < 2:
                self.send_json({"results": []})
                return

            term = f"%{q}%"
            exact = q.upper()
            sql = """
                SELECT id, ident, type, name, latitude_deg, longitude_deg, 
                       elevation_ft, iso_country, municipality, iata_code, icao_code
                FROM airports
                WHERE ident = ? OR iata_code = ? OR icao_code = ?
                   OR ident LIKE ? OR name LIKE ? OR municipality LIKE ?
                ORDER BY 
                   CASE 
                     WHEN ident = ? OR iata_code = ? OR icao_code = ? THEN 1
                     WHEN type = 'large_airport' THEN 2
                     WHEN type = 'medium_airport' THEN 3
                     ELSE 4
                   END
                LIMIT 15
            """
            cursor.execute(sql, [exact, exact, exact, term, term, term, exact, exact, exact])
            rows = [dict(r) for r in cursor.fetchall()]
            self.send_json({"results": rows})

        # 4. Detailed Airport View by Ident (e.g. /api/airport/KLAX)
        elif path.startswith("/api/airport/"):
            ident = path.replace("/api/airport/", "").strip().upper()
            cursor.execute("""
                SELECT a.*, c.name as country_name, r.name as region_name
                FROM airports a
                LEFT JOIN countries c ON a.iso_country = c.code
                LEFT JOIN regions r ON a.iso_region = r.code
                WHERE UPPER(a.ident) = ? OR UPPER(a.iata_code) = ? OR UPPER(a.icao_code) = ?
                LIMIT 1
            """, [ident, ident, ident])
            airport_row = cursor.fetchone()

            if not airport_row:
                self.send_json({"error": f"Airport with ident '{ident}' not found."}, status=404)
                return

            airport = dict(airport_row)
            airport_ref = airport["id"]
            airport_ident = airport["ident"]

            # Runways
            cursor.execute("""
                SELECT * FROM runways 
                WHERE airport_ident = ? OR airport_ref = ?
                ORDER BY length_ft DESC
            """, [airport_ident, airport_ref])
            runways = [dict(r) for r in cursor.fetchall()]

            # Radio Frequencies
            cursor.execute("""
                SELECT * FROM airport_frequencies
                WHERE airport_ident = ? OR airport_ref = ?
                ORDER BY frequency_mhz ASC
            """, [airport_ident, airport_ref])
            frequencies = [dict(r) for r in cursor.fetchall()]

            # Comments
            cursor.execute("""
                SELECT * FROM airport_comments
                WHERE airportIdent = ? OR airportRef = ?
                ORDER BY date DESC
            """, [airport_ident, airport_ref])
            comments = [dict(r) for r in cursor.fetchall()]

            # Nearby Navaids (within 1.2 degrees bounding box, then filtered by NM distance)
            nearby_navaids = []
            if airport.get("latitude_deg") and airport.get("longitude_deg"):
                lat = float(airport["latitude_deg"])
                lon = float(airport["longitude_deg"])
                cursor.execute("""
                    SELECT * FROM navaids
                    WHERE latitude_deg BETWEEN ? AND ?
                      AND longitude_deg BETWEEN ? AND ?
                    LIMIT 40
                """, [lat - 1.2, lat + 1.2, lon - 1.2, lon + 1.2])
                raw_navaids = [dict(r) for r in cursor.fetchall()]
                for nav in raw_navaids:
                    dist = haversine_distance_nm(lat, lon, nav["latitude_deg"], nav["longitude_deg"])
                    nav["distance_nm"] = dist
                    nearby_navaids.append(nav)
                nearby_navaids.sort(key=lambda x: x["distance_nm"] if x["distance_nm"] is not None else 9999)
                nearby_navaids = nearby_navaids[:10]

            self.send_json({
                "airport": airport,
                "runways": runways,
                "frequencies": frequencies,
                "comments": comments,
                "nearby_navaids": nearby_navaids
            })

        # 5. Navaids Viewport Query
        elif path == "/api/navaids":
            min_lat = query.get("minLat", [None])[0]
            max_lat = query.get("maxLat", [None])[0]
            min_lon = query.get("minLon", [None])[0]
            max_lon = query.get("maxLon", [None])[0]
            types = query.get("types", [None])[0]
            limit = int(query.get("limit", [200])[0])
            limit = min(limit, 1000)

            conditions = ["latitude_deg IS NOT NULL", "longitude_deg IS NOT NULL"]
            params = []

            if min_lat and max_lat and min_lon and max_lon:
                conditions.append("latitude_deg BETWEEN ? AND ?")
                params.extend([float(min_lat), float(max_lat)])
                conditions.append("longitude_deg BETWEEN ? AND ?")
                params.extend([float(min_lon), float(max_lon)])

            if types:
                type_list = [t.strip() for t in types.split(",") if t.strip()]
                if type_list:
                    placeholders = ",".join(["?"] * len(type_list))
                    conditions.append(f"type IN ({placeholders})")
                    params.extend(type_list)

            where_clause = " AND ".join(conditions)
            sql = f"""
                SELECT id, filename, ident, name, type, frequency_khz, 
                       latitude_deg, longitude_deg, elevation_ft, iso_country, 
                       dme_frequency_khz, usageType, power, associated_airport
                FROM navaids
                WHERE {where_clause}
                LIMIT ?
            """
            params.append(limit)
            cursor.execute(sql, params)
            rows = [dict(r) for r in cursor.fetchall()]
            self.send_json({"count": len(rows), "navaids": rows})

        # 6. Global Analytics Charts Aggregation
        elif path == "/api/analytics":
            # Runway length brackets
            cursor.execute("""
                SELECT 
                    CASE 
                        WHEN length_ft < 3000 THEN '< 3,000 ft (Light Aircraft)'
                        WHEN length_ft BETWEEN 3000 AND 5999 THEN '3,000 - 5,999 ft (Regional)'
                        WHEN length_ft BETWEEN 6000 AND 8999 THEN '6,000 - 8,999 ft (Jet/Narrowbody)'
                        WHEN length_ft BETWEEN 9000 AND 11999 THEN '9,000 - 11,999 ft (Widebody/Long-haul)'
                        ELSE '12,000+ ft (Heavy/Intercontinental)'
                    END as bracket,
                    count(*) as count
                FROM runways
                WHERE length_ft IS NOT NULL AND length_ft > 0
                GROUP BY bracket
                ORDER BY min(length_ft)
            """)
            runway_lengths = [dict(r) for r in cursor.fetchall()]

            # Runway Surfaces
            cursor.execute("""
                SELECT 
                    CASE 
                        WHEN surface LIKE '%ASP%' THEN 'Asphalt'
                        WHEN surface LIKE '%CON%' THEN 'Concrete'
                        WHEN surface LIKE '%TURF%' OR surface LIKE '%GRS%' OR surface LIKE '%GRASS%' THEN 'Turf / Grass'
                        WHEN surface LIKE '%GRV%' OR surface LIKE '%GRAVEL%' THEN 'Gravel / Dirt'
                        WHEN surface LIKE '%WATER%' THEN 'Water'
                        ELSE 'Other / Composite'
                    END as material,
                    count(*) as count
                FROM runways
                WHERE surface IS NOT NULL AND surface != ''
                GROUP BY material
                ORDER BY count DESC
                LIMIT 6
            """)
            runway_surfaces = [dict(r) for r in cursor.fetchall()]

            # Navaid types
            cursor.execute("""
                SELECT type, count(*) as count 
                FROM navaids 
                GROUP BY type 
                ORDER BY count DESC
            """)
            navaid_types = [dict(r) for r in cursor.fetchall()]

            # Continents distribution
            cursor.execute("""
                SELECT 
                    CASE 
                        WHEN continent = 'NA' OR continent IS NULL OR continent = '' THEN 'North America'
                        WHEN continent = 'EU' THEN 'Europe'
                        WHEN continent = 'AS' THEN 'Asia'
                        WHEN continent = 'SA' THEN 'South America'
                        WHEN continent = 'AF' THEN 'Africa'
                        WHEN continent = 'OC' THEN 'Oceania'
                        WHEN continent = 'AN' THEN 'Antarctica'
                        ELSE 'Other'
                    END as continent_name,
                    count(*) as count
                FROM airports
                GROUP BY continent_name
                ORDER BY count DESC
            """)
            continents = [dict(r) for r in cursor.fetchall()]

            self.send_json({
                "runway_lengths": runway_lengths,
                "runway_surfaces": runway_surfaces,
                "navaid_types": navaid_types,
                "continents": continents
            })

        else:
            self.send_json({"error": "Endpoint not found"}, status=404)

def run_server(port=PORT):
    # Ensure database is present
    if not os.path.exists(DB_PATH):
        print("[!] Database not found. Triggering automated ingestion...")
        from db_init import build_database
        build_database(DATA_DIR, DB_PATH)

    server = ThreadingHTTPServer(("0.0.0.0", port), AeroDataHandler)
    print(f"\n=======================================================")
    print(f"[*] AeroOps Aviation Visualization Server LIVE")
    print(f"[*] Local URL:  http://localhost:{port}")
    print(f"[*] Relative Data Path: {DATA_DIR}")
    print(f"[*] Database:   {DB_PATH}")
    print(f"=======================================================\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Server shutdown.")
        server.server_close()

if __name__ == "__main__":
    p = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    run_server(p)
