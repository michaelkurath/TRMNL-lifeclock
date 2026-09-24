"""Production-path QA for Life Clock using real TRMNLP polling + Serverless.

For each scenario this script:
1. rewrites .trmnlp.yml with only actual custom-field inputs,
2. starts TRMNLP so it polls the selected country JSON from GitHub,
3. verifies the transformed /data payload,
4. renders all Liquid views as HTML for OG and TRMNL X,
5. saves a focused PNG matrix for visual stress cases.

No precomputed render variables are used.
"""
from __future__ import annotations

import json
from pathlib import Path
import struct
import subprocess
import time
from urllib.parse import urlencode
from urllib.request import urlopen

VIEWS = ("full", "half_horizontal", "half_vertical", "quadrant")
DEVICES = {
    "og": (800, 480, 1, "screen screen--og screen--md screen--density-1x screen--1bit"),
    "x": (1872, 1404, 4, "screen screen--v2 screen--lg screen--density-2x screen--4bit"),
}
SCENARIOS = {
    "baseline-che-male": {
        "birth_date": "1980-01-15",
        "sex": "male",
        "country_code": "CHE",
        "language": "en",
        "show_remaining": True,
        "show_horizon": False,
    },
    "long-country-ven-female": {
        "birth_date": "1992-07-12",
        "sex": "female",
        "country_code": "VEN",
        "language": "en",
        "show_remaining": True,
        "show_horizon": False,
    },
    "young-jpn-female": {
        "birth_date": "2006-09-24",
        "sex": "female",
        "country_code": "JPN",
        "language": "en",
        "show_remaining": True,
        "show_horizon": False,
    },
    "old-jpn-female-horizon": {
        "birth_date": "1928-02-29",
        "sex": "female",
        "country_code": "JPN",
        "language": "en",
        "show_remaining": True,
        "show_horizon": True,
    },
    "lower-life-lso-male": {
        "birth_date": "1975-01-01",
        "sex": "male",
        "country_code": "LSO",
        "language": "en",
        "show_remaining": True,
        "show_horizon": False,
    },
    "german-che-female-horizon": {
        "birth_date": "1960-12-31",
        "sex": "female",
        "country_code": "CHE",
        "language": "de",
        "show_remaining": False,
        "show_horizon": True,
    },
}

# Baseline gets every PNG; stress scenarios render the layouts most sensitive
# to text/vertical pressure. HTML is still rendered for every view/device.
PNG_VIEWS = {
    "baseline-che-male": set(VIEWS),
}
STRESS_PNG_VIEWS = {"full", "half_vertical"}

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / ".trmnlp.yml"
ORIGINAL = CONFIG.read_bytes()
OUT = ROOT / "qa-artifacts"
OUT.mkdir(exist_ok=True)
proc: subprocess.Popen | None = None


def stop() -> None:
    global proc
    if proc is None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
    proc = None


def write_config(fields: dict) -> None:
    CONFIG.write_text(
        json.dumps(
            {
                "watch": False,
                "time_zone": "Europe/Zurich",
                "custom_fields": fields,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def start(fields: dict) -> dict:
    global proc
    stop()
    write_config(fields)
    proc = subprocess.Popen(
        ["trmnlp", "serve", "--bind", "127.0.0.1"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
        text=True,
    )
    for _ in range(90):
        try:
            with urlopen("http://127.0.0.1:4567/data", timeout=3) as response:
                data = json.loads(response.read().decode("utf-8"))
            if data:
                return data
        except Exception:
            if proc.poll() is not None:
                raise RuntimeError("TRMNLP preview server exited before becoming ready")
            time.sleep(1)
    raise RuntimeError("TRMNLP preview server did not become ready")


def assert_payload(name: str, fields: dict, data: dict) -> None:
    assert data.get("state") == "ok", (name, data.get("detail"))
    assert data.get("country_code") == fields["country_code"], (name, data.get("country_code"))
    assert data.get("sex") == fields["sex"], (name, data.get("sex"))
    assert data.get("language") == fields.get("language", "en"), (name, data.get("language"))
    assert data.get("prototype") is False, name
    assert data.get("release_ready") is True, name
    assert data.get("data_year") == 2026, name
    assert 0 <= float(data["progress_percent"]) <= 100, name
    assert 0 < float(data["expected_age"]) < 150, name
    assert data.get("show_remaining") is bool(fields["show_remaining"])
    assert data.get("show_horizon") is bool(fields["show_horizon"])


def render_html(device: str, view: str, spec: tuple[int, int, int, str]) -> str:
    width, height, depth, classes = spec
    params = urlencode(
        {
            "screen_classes": classes,
            "width": width,
            "height": height,
            "color_depth": depth,
        }
    )
    with urlopen(
        f"http://127.0.0.1:4567/render/{view}.html?{params}", timeout=30
    ) as response:
        html = response.read().decode("utf-8")
    assert "Liquid error" not in html and "Liquid syntax error" not in html
    assert "Life Clock unavailable" not in html
    return html


def render_png(
    scenario: str, device: str, view: str, spec: tuple[int, int, int, str]
) -> None:
    width, height, depth, classes = spec
    params = urlencode(
        {
            "screen_classes": classes,
            "width": width,
            "height": height,
            "color_depth": depth,
        }
    )
    with urlopen(
        f"http://127.0.0.1:4567/render/{view}.png?{params}", timeout=120
    ) as response:
        png = response.read()
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">II", png[16:24]) == (width, height)
    (OUT / f"{scenario}-{device}-{view}.png").write_bytes(png)


try:
    semantic_renders = 0
    png_renders = 0
    results = {}

    for scenario, fields in SCENARIOS.items():
        data = start(fields)
        assert_payload(scenario, fields, data)
        results[scenario] = {
            "country": data["country_name"],
            "sex": data["sex"],
            "language": data["language"],
            "age": data["age"],
            "life_clock": data["life_clock"],
            "progress_percent": data["progress_percent"],
            "remaining_years": data["remaining_years"],
            "expected_age": data["expected_age"],
            "horizon_year": data["horizon_year"],
        }

        png_views = PNG_VIEWS.get(scenario, STRESS_PNG_VIEWS)
        for device, spec in DEVICES.items():
            for view in VIEWS:
                html = render_html(device, view, spec)
                semantic_renders += 1

                # Long-name stress: title/header must use truncation rather than
                # dump the full long UN location name into constrained layouts.
                if scenario == "long-country-ven-female":
                    assert "Venezuela (Bolivarian Republic of)" not in html

                # Horizon is intentionally only shown in full view and follows
                # the selected display language.
                horizon_label = (
                    "Statistischer Horizont"
                    if fields.get("language") == "de"
                    else "Statistical horizon"
                )
                if fields["show_horizon"] and view == "full":
                    assert horizon_label in html
                if view != "full":
                    assert "Statistical horizon" not in html
                    assert "Statistischer Horizont" not in html

                if not fields["show_remaining"]:
                    assert "Stat. years left" not in html

                if fields.get("language") == "de":
                    assert "Bevölkerungsstatistik" in html if view == "full" else True
                    assert "Switzerland" not in html

                if view in png_views:
                    render_png(scenario, device, view, spec)
                    png_renders += 1

    (OUT / "scenario-results.json").write_text(
        json.dumps(results, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(
        f"PASS: {len(SCENARIOS)} scenarios; {semantic_renders} HTML renders; "
        f"{png_renders} genuine TRMNLP PNG renders across OG and TRMNL X"
    )
finally:
    stop()
    CONFIG.write_bytes(ORIGINAL)
