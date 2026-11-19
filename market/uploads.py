"""Saving photos sent as data: URLs. Files are checked by their actual bytes, not their name."""
from __future__ import annotations

import base64
import binascii
import re
import secrets
from pathlib import Path

from flask import current_app

from .validation import ValidationError

MAX_IMAGE_BYTES = 6 * 1024 * 1024
DATA_URL = re.compile(r"^data:image/[\w+.-]+;base64,([A-Za-z0-9+/=\s]+)$")


def _sniff(data: bytes) -> str | None:
    """Return a file extension for real JPEG/PNG/WebP/GIF images, else None."""
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    return None


def decode_image(data_url) -> tuple[bytes, str]:
    m = DATA_URL.match(str(data_url or ""))
    if not m:
        raise ValidationError("Please use a JPG, PNG or WebP photo")
    try:
        raw = base64.b64decode(m.group(1), validate=False)
    except (binascii.Error, ValueError):
        raise ValidationError("That photo couldn't be read") from None
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValidationError("That photo is too large")
    ext = _sniff(raw)
    if not ext:
        raise ValidationError("Please use a JPG, PNG or WebP photo")
    return raw, ext


def save_image(data_url, folder: str, stem: str = "") -> str:
    """Store an image under UPLOAD_FOLDER/<folder>/ and return its public /uploads/... URL."""
    raw, ext = decode_image(data_url)
    safe_stem = re.sub(r"[^a-zA-Z0-9-]+", "-", stem).strip("-")[:40]
    name = f"{safe_stem + '-' if safe_stem else ''}{secrets.token_hex(6)}.{ext}"
    target = Path(current_app.config["UPLOAD_FOLDER"]) / folder
    target.mkdir(parents=True, exist_ok=True)
    (target / name).write_bytes(raw)
    return f"/uploads/{folder}/{name}"
