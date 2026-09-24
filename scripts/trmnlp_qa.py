"""Render Life Clock through the real TRMNLP preview server for OG and TRMNL X.

This deliberately uses explicit TRMNL device screen classes. Merely passing
--width/--height to "trmnlp build --png" changes the screenshot canvas but does
not switch Framework responsive classes to the target device.
"""
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
OUT = Path("qa-artifacts")
OUT.mkdir(exist_ok=True)

proc = subprocess.Popen(
    ["trmnlp", "serve", "--bind", "127.0.0.1"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
)

try:
    for _ in range(90):
        try:
            with urlopen("http://127.0.0.1:4567/data", timeout=2):
                break
        except Exception:
            if proc.poll() is not None:
                raise RuntimeError("TRMNLP preview server exited before becoming ready")
            time.sleep(1)
    else:
        raise RuntimeError("TRMNLP preview server did not become ready")

    rendered = 0
    for device, (width, height, depth, classes) in DEVICES.items():
        for view in VIEWS:
            params = urlencode({
                "screen_classes": classes,
                "width": width,
                "height": height,
                "color_depth": depth,
            })
            base = f"http://127.0.0.1:4567/render/{view}"

            with urlopen(base + ".html?" + params, timeout=30) as response:
                html = response.read().decode("utf-8")
            if "Liquid error" in html or "Liquid syntax error" in html:
                raise AssertionError(f"Liquid render error in {device}/{view}")

            with urlopen(base + ".png?" + params, timeout=120) as response:
                png = response.read()
            if png[:8] != b"\x89PNG\r\n\x1a\n":
                raise AssertionError(f"Not a PNG: {device}/{view}")
            actual = struct.unpack(">II", png[16:24])
            if actual != (width, height):
                raise AssertionError(
                    f"Wrong dimensions for {device}/{view}: {actual}, expected {(width, height)}"
                )
            (OUT / f"{device}-{view}.png").write_bytes(png)
            rendered += 1

    print(f"PASS: {rendered} genuine TRMNLP PNG renders across OG and TRMNL X")
finally:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
    if proc.returncode not in (0, -15, None):
        output = proc.stdout.read() if proc.stdout else ""
        print(output)
