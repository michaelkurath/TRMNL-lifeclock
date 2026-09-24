#!/usr/bin/env python3
"""Validate Life Clock's generated WPP runtime dataset and selector."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "countries"
MANIFEST = ROOT / "data" / "manifest.json"
SETTINGS = ROOT / "src" / "settings.yml"
EXPECTED = 237
AGES = 101


def fail(message: str) -> None:
    raise SystemExit(f"FAIL: {message}")


manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
if manifest.get("country_count") != EXPECTED:
    fail(f"manifest country_count={manifest.get('country_count')}, expected {EXPECTED}")
if manifest.get("year") != 2026 or manifest.get("revision") != "WPP 2024":
    fail("unexpected WPP revision/year in manifest")
if manifest.get("indicator_id") != 76:
    fail("unexpected WPP indicator id")

for sex in ("male", "female"):
    source = manifest.get("sources", {}).get(sex, {})
    digest = source.get("sha256", "")
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        fail(f"invalid {sex} source SHA-256")
    if not source.get("url", "").startswith("https://population.un.org/wpp/"):
        fail(f"unexpected {sex} source URL")

paths = sorted(DATA.glob("*.json"))
if len(paths) != EXPECTED:
    fail(f"found {len(paths)} runtime files, expected {EXPECTED}")

codes = set()
max_size = (0, "")
for path in paths:
    code = path.stem
    if not re.fullmatch(r"[A-Z]{3}", code):
        fail(f"invalid filename/code {code}")
    if code in codes:
        fail(f"duplicate code {code}")
    codes.add(code)

    size = path.stat().st_size
    if size > max_size[0]:
        max_size = (size, path.name)
    if size >= 100_000:
        fail(f"{path.name} is too large for safe external polling: {size} bytes")

    payload = json.loads(path.read_text(encoding="utf-8"))
    meta = payload.get("meta", {})
    country = payload.get("country", {})
    if meta.get("prototype") is not False or meta.get("release_ready") is not True:
        fail(f"{code}: release metadata is not production-ready")
    if meta.get("year") != 2026 or country.get("year") != 2026:
        fail(f"{code}: wrong data year")
    if country.get("code") != code or not country.get("name"):
        fail(f"{code}: invalid country metadata")

    for sex in ("male", "female"):
        values = country.get(sex)
        if not isinstance(values, list) or len(values) != AGES:
            fail(f"{code}/{sex}: expected {AGES} values")
        if any(
            not isinstance(value, (int, float))
            or not math.isfinite(value)
            or value <= 0
            or value > 150
            for value in values
        ):
            fail(f"{code}/{sex}: invalid E(x) value")

# Broad sentinels catch wrong-year/wrong-column/schema mistakes without pinning
# the repo to a fragile exact decimal.
che = json.loads((DATA / "CHE.json").read_text(encoding="utf-8"))["country"]
if not (82.0 <= che["male"][0] <= 83.0):
    fail("CHE male age-0 sentinel outside expected WPP 2024 range")
if not (85.5 <= che["female"][0] <= 87.0):
    fail("CHE female age-0 sentinel outside expected WPP 2024 range")

settings = SETTINGS.read_text(encoding="utf-8")
start = settings.find("- keyname: country_code")
if start < 0:
    fail("country_code field missing from settings.yml")
end = settings.find("- keyname:", start + 1)
if end < 0:
    fail("could not locate end of country_code field")
section = settings[start:end]
selector_codes = set(re.findall(r"^\s*-\s+.+:\s+([A-Z]{3})\s*$", section, re.MULTILINE))
if len(selector_codes) != EXPECTED:
    fail(f"country selector has {len(selector_codes)} entries, expected {EXPECTED}")
if selector_codes != codes:
    missing = sorted(codes - selector_codes)
    extra = sorted(selector_codes - codes)
    fail(f"selector/data mismatch: missing={missing[:5]} extra={extra[:5]}")

print(
    f"PASS: {len(paths)} countries/areas × 2 sexes × {AGES} ages; "
    f"selector matches; largest payload {max_size[1]}={max_size[0]} bytes"
)
