#!/usr/bin/env python3
"""Build Life Clock runtime tables from official UN WPP 2024 bulk CSV files.

Downloads the complete single-age life tables (Medium variant) directly from
UN DESA, extracts period remaining life expectancy E(x) for the selected year,
writes one compact JSON file per country/area, writes a source/checksum
manifest, and regenerates the TRMNL country selector.

Source indicator definition:
  Life expectancy E(x) - complete = average years remaining for persons
  surviving to exact age x (Tx/lx).

The generated runtime includes the 237 UN WPP countries/areas (LocTypeID 4),
male and female tables, exact ages 0..100.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import math
import re
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path

YEAR = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
AGES = 101
EXPECTED_COUNTRIES = 237
BASE = (
    "https://population.un.org/wpp/assets/Excel%20Files/"
    "1_Indicator%20(Standard)/CSV_FILES/"
)
FILES = {
    "male": "WPP2024_Life_Table_Complete_Medium_Male_2024-2100.csv.gz",
    "female": "WPP2024_Life_Table_Complete_Medium_Female_2024-2100.csv.gz",
}
ROOT = Path(__file__).resolve().parent.parent
COUNTRY_DIR = ROOT / "data" / "countries"
MANIFEST = ROOT / "data" / "manifest.json"
SETTINGS = ROOT / "src" / "settings.yml"

META = {
    "schema": 2,
    "prototype": False,
    "release_ready": True,
    "coverage": "237 WPP countries/areas",
    "revision": "WPP 2024",
    "variant": "Medium",
    "source_label": "UN DESA World Population Prospects 2024",
    "source_note": (
        f"WPP 2024 Medium projection; complete life tables, single-year ages; "
        f"period remaining life expectancy E(x), {YEAR}."
    ),
    "year": YEAR,
}


def download(url: str, path: Path) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "TRMNL-Life-Clock/1.0"})
    sha = hashlib.sha256()
    with urllib.request.urlopen(req, timeout=120) as response, path.open("wb") as out:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            sha.update(chunk)
            out.write(chunk)
    return sha.hexdigest()


def parse(path: Path, sex: str, countries: dict[str, dict]) -> None:
    with gzip.open(path, "rt", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        required = {
            "Time", "LocTypeID", "ISO3_code", "ISO2_code",
            "Location", "AgeGrpStart", "ex"
        }
        missing = required.difference(reader.fieldnames or [])
        if missing:
            raise RuntimeError(f"{path.name}: missing columns {sorted(missing)}")

        for row in reader:
            if row["Time"] != str(YEAR) or row["LocTypeID"] != "4":
                continue
            code = row["ISO3_code"].strip()
            if not code:
                continue
            age = int(float(row["AgeGrpStart"]))
            if not 0 <= age < AGES:
                continue
            value = round(float(row["ex"]), 3)
            rec = countries.setdefault(
                code,
                {
                    "code": code,
                    "iso2": row["ISO2_code"].strip(),
                    "name": row["Location"].strip(),
                    "year": YEAR,
                    "male": [None] * AGES,
                    "female": [None] * AGES,
                },
            )
            rec[sex][age] = value


def validate(countries: dict[str, dict]) -> None:
    if len(countries) != EXPECTED_COUNTRIES:
        raise RuntimeError(
            f"Expected {EXPECTED_COUNTRIES} countries/areas, got {len(countries)}"
        )
    for code, rec in sorted(countries.items()):
        if len(code) != 3 or not rec["name"]:
            raise RuntimeError(f"Invalid country metadata: {code!r} {rec['name']!r}")
        for sex in ("male", "female"):
            values = rec[sex]
            if len(values) != AGES or any(v is None for v in values):
                missing = [i for i, v in enumerate(values) if v is None]
                raise RuntimeError(f"{code}/{sex}: incomplete ages {missing[:10]}")
            if any(not isinstance(v, (int, float)) or not math.isfinite(v) or v <= 0 or v > 150 for v in values):
                raise RuntimeError(f"{code}/{sex}: invalid E(x) values")

    # Schema/sanity sentinels: wide enough not to fail on harmless source revisions.
    che = countries["CHE"]
    if not (82.0 <= che["male"][0] <= 83.0 and 85.5 <= che["female"][0] <= 87.0):
        raise RuntimeError(
            "CHE age-0 sentinel outside expected WPP 2024 range; check source/schema"
        )


def yaml_label(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def update_settings(countries: dict[str, dict]) -> None:
    text = SETTINGS.read_text(encoding="utf-8")
    start = text.find("- keyname: country_code")
    if start < 0:
        raise RuntimeError("country_code custom field not found in settings.yml")
    options = text.find("  options:\n", start)
    if options < 0:
        raise RuntimeError("country_code options block not found in settings.yml")
    block_start = options + len("  options:\n")
    next_field = text.find("- keyname:", block_start)
    if next_field < 0:
        raise RuntimeError("could not find end of country_code options block")

    lines = []
    for rec in sorted(countries.values(), key=lambda r: (r["name"].casefold(), r["code"])):
        lines.append(f"  - {yaml_label(rec['name'])}: {rec['code']}\n")
    SETTINGS.write_text(
        text[:block_start] + "".join(lines) + text[next_field:],
        encoding="utf-8",
    )


def write_outputs(countries: dict[str, dict], hashes: dict[str, str]) -> None:
    if COUNTRY_DIR.exists():
        shutil.rmtree(COUNTRY_DIR)
    COUNTRY_DIR.mkdir(parents=True)

    for code, rec in sorted(countries.items()):
        payload = {
            "meta": META,
            "country": {
                "code": code,
                "iso2": rec["iso2"],
                "name": rec["name"],
                "year": YEAR,
                "male": rec["male"],
                "female": rec["female"],
            },
        }
        (COUNTRY_DIR / f"{code}.json").write_text(
            json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    manifest = {
        "schema": 1,
        "revision": "WPP 2024",
        "variant": "Medium",
        "year": YEAR,
        "indicator": "Life expectancy E(x) - complete",
        "indicator_id": 76,
        "ages": "0-100 single-year",
        "country_count": len(countries),
        "license": "CC BY 3.0 IGO",
        "sources": {
            sex: {
                "url": BASE + FILES[sex],
                "sha256": hashes[sex],
            }
            for sex in ("male", "female")
        },
    }
    MANIFEST.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    update_settings(countries)


def main() -> None:
    countries: dict[str, dict] = {}
    hashes: dict[str, str] = {}
    with tempfile.TemporaryDirectory(prefix="life-clock-wpp-") as td:
        tmp = Path(td)
        for sex, filename in FILES.items():
            url = BASE + filename
            target = tmp / filename
            print(f"Downloading {url}", file=sys.stderr)
            hashes[sex] = download(url, target)
            print(f"Parsing {filename}", file=sys.stderr)
            parse(target, sex, countries)

    validate(countries)
    write_outputs(countries, hashes)
    print(
        f"PASS: generated {len(countries)} countries/areas × 2 sexes × "
        f"{AGES} ages for WPP {YEAR}",
        file=sys.stderr,
    )
    print(
        "Source SHA256: "
        + ", ".join(f"{sex}={hashes[sex]}" for sex in ("male", "female")),
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
