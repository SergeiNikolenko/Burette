"""Bounded xyzrender endpoint for the hosted Burette demo."""

from __future__ import annotations

import base64
import binascii
import json
import tempfile
import time
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, Callable


MAX_JSON_BYTES = 4_200_000
MAX_INPUT_BYTES = 3_000_000
MAX_SVG_BYTES = 5_000_000
PRESETS = {
    "default",
    "flat",
    "paton",
    "pmol",
    "skeletal",
    "bubble",
    "tube",
    "btube",
    "mtube",
    "wire",
    "graph",
}
EXTENSIONS = {
    "xyz": "xyz",
    "extxyz": "xyz",
    "mol": "mol",
    "sdf": "sdf",
    "sd": "sdf",
    "mol2": "mol2",
    "pdb": "pdb",
    "ent": "pdb",
    "smi": "smi",
    "smiles": "smi",
    "cube": "cube",
    "cub": "cub",
}


class RequestError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


Renderer = Callable[[str, str, str], None]


def _default_renderer(source_path: str, output_path: str, preset: str) -> None:
    from xyzrender import render

    render(source_path, config=preset, output=output_path)


def _decode_input(payload: dict[str, Any]) -> tuple[bytes, str]:
    encoded = payload.get("inputDataBase64")
    if not isinstance(encoded, str) or not encoded.strip():
        raise RequestError("inputDataBase64 is required")
    extension_value = payload.get("inputExtension")
    extension = str(extension_value or "").strip().lower().lstrip(".")
    normalized_extension = EXTENSIONS.get(extension)
    if normalized_extension is None:
        raise RequestError("Unsupported xyzrender input extension")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise RequestError("inputDataBase64 is invalid") from error
    if not data:
        raise RequestError("xyzrender input is empty")
    if len(data) > MAX_INPUT_BYTES:
        raise RequestError("xyzrender input exceeds the hosted size limit", 413)
    return data, normalized_extension


def render_request(
    payload: dict[str, Any],
    renderer: Renderer | None = None,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise RequestError("JSON object expected")
    data, extension = _decode_input(payload)
    preset_value = payload.get("preset", "default")
    preset = str(preset_value or "default").strip().lower()
    if preset not in PRESETS:
        raise RequestError("Unsupported xyzrender preset")

    started_at = time.perf_counter()
    render_svg = renderer or _default_renderer
    with tempfile.TemporaryDirectory(prefix="burette-xyzrender-") as temporary_directory:
        directory = Path(temporary_directory)
        source_path = directory / f"input.{extension}"
        output_path = directory / "output.svg"
        source_path.write_bytes(data)
        render_svg(str(source_path), str(output_path), preset)
        if not output_path.is_file():
            raise RuntimeError("xyzrender produced no SVG file")
        if output_path.stat().st_size > MAX_SVG_BYTES:
            raise RequestError("xyzrender output exceeds the hosted size limit", 413)
        svg = output_path.read_text(encoding="utf-8")
    if "<svg" not in svg:
        raise RuntimeError("xyzrender produced an invalid SVG file")
    return {
        "svg": svg,
        "preset": preset,
        "configArgument": preset,
        "elapsedMs": round((time.perf_counter() - started_at) * 1000),
        "log": "Rendered by the hosted xyzrender service.",
    }


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        try:
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
            except ValueError as error:
                raise RequestError("Content-Length is invalid") from error
            if content_length <= 0:
                raise RequestError("JSON request body is required")
            if content_length > MAX_JSON_BYTES:
                raise RequestError("Request body exceeds the hosted size limit", 413)
            try:
                payload = json.loads(self.rfile.read(content_length))
            except (json.JSONDecodeError, UnicodeDecodeError) as error:
                raise RequestError("Request body is not valid JSON") from error
            self._send_json(200, render_request(payload))
        except RequestError as error:
            self._send_json(error.status, {"error": str(error)})
        except ImportError:
            self._send_json(503, {"error": "xyzrender is unavailable on this deployment"})
        except Exception:
            self._send_json(422, {"error": "xyzrender could not render this structure"})

    def do_GET(self) -> None:
        self._send_json(405, {"error": "POST required"})
