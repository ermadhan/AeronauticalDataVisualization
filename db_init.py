"""
Aeronautical Data Ingestion & SQLite Indexing Script
Reads CSV data using relative path '../ourairports-data'
and generates an optimized, indexed SQLite database for high-speed queries.
"""
import os
import sys
import time
import sqlite3
import pandas as pd

def build_database(data_dir=None, db_path="aeronautical_data.db"):
    if data_dir is None:
        data_dir = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "ourairports-data"))
    
    print(f"[*] Reading data from relative path: {data_dir}")
    if not os.path.exists(data_dir):
        print(f"[!] Error: Data directory '{data_dir}' not found!")
        sys.exit(1)

    t0 = time.time()
    if os.path.exists(db_path):
        os.remove(db_path)

    conn = sqlite3.connect(db_path)

    files = {
        "airports": "airports.csv",
        "runways": "runways.csv",
        "airport_frequencies": "airport-frequencies.csv",
        "navaids": "navaids.csv",
        "countries": "countries.csv",
        "regions": "regions.csv",
        "airport_comments": "airport-comments.csv"
    }

    total_rows = 0
    for table, filename in files.items():
        csv_path = os.path.join(data_dir, filename)
        if os.path.exists(csv_path):
            print(f" -> Loading {filename} into '{table}'...")
            df = pd.read_csv(csv_path, low_memory=False, keep_default_na=False)
            # Normalize column names: strip whitespace and quotation marks
            df.columns = [c.strip().strip('"').strip("'") for c in df.columns]
            df.to_sql(table, conn, if_exists="replace", index=False)
            count = len(df)
            total_rows += count
            print(f"    Loaded {count:,} rows.")
        else:
            print(f" [!] Warning: {filename} not found in {data_dir}")

    print("[*] Creating high-performance indexes...")
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_airports_ident ON airports(ident);",
        "CREATE INDEX IF NOT EXISTS idx_airports_iata ON airports(iata_code);",
        "CREATE INDEX IF NOT EXISTS idx_airports_icao ON airports(icao_code);",
        "CREATE INDEX IF NOT EXISTS idx_airports_type ON airports(type);",
        "CREATE INDEX IF NOT EXISTS idx_airports_country ON airports(iso_country);",
        "CREATE INDEX IF NOT EXISTS idx_airports_lat ON airports(latitude_deg);",
        "CREATE INDEX IF NOT EXISTS idx_airports_lon ON airports(longitude_deg);",
        "CREATE INDEX IF NOT EXISTS idx_runways_ident ON runways(airport_ident);",
        "CREATE INDEX IF NOT EXISTS idx_runways_ref ON runways(airport_ref);",
        "CREATE INDEX IF NOT EXISTS idx_freq_ident ON airport_frequencies(airport_ident);",
        "CREATE INDEX IF NOT EXISTS idx_freq_ref ON airport_frequencies(airport_ref);",
        "CREATE INDEX IF NOT EXISTS idx_navaids_ident ON navaids(ident);",
        "CREATE INDEX IF NOT EXISTS idx_navaids_airport ON navaids(associated_airport);",
        "CREATE INDEX IF NOT EXISTS idx_navaids_coords ON navaids(latitude_deg, longitude_deg);",
        "CREATE INDEX IF NOT EXISTS idx_countries_code ON countries(code);",
        "CREATE INDEX IF NOT EXISTS idx_regions_code ON regions(code);",
        "CREATE INDEX IF NOT EXISTS idx_comments_ident ON airport_comments(airportIdent);"
    ]

    for idx_sql in indexes:
        conn.execute(idx_sql)

    conn.commit()
    conn.close()

    elapsed = round(time.time() - t0, 2)
    db_size_mb = round(os.path.getsize(db_path) / (1024 * 1024), 2)
    print(f"\n[+] Database built successfully in {elapsed}s! Total rows: {total_rows:,}. Size: {db_size_mb} MB.")
    return db_path

if __name__ == "__main__":
    build_database()
