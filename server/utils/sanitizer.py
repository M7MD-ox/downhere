"""Filename Sanitizer & Content-Disposition Header Utility.

Implements RFC 5987 / RFC 6266 encoding, Arabic typography preservation,
emoji handling, and OS-forbidden character replacement.
"""

from __future__ import annotations

from pathlib import Path
import re
import unicodedata
import urllib.parse

# Characters forbidden in Windows/POSIX filenames
FORBIDDEN_CHARS_PATTERN = re.compile(r'[\\/*?:"<>|\x00-\x1f\r\n\t]')
WHITESPACE_COLLAPSE_PATTERN = re.compile(r"\s+")
TRAILING_DOTS_SPACES_PATTERN = re.compile(r"[. ]+$")

# Windows reserved device names (reserved regardless of extension)
WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
}


def sanitize_filename(
    name: str,
    ext: str = "",
    default_name: str = "media",
    max_length: int = 180,
) -> str:
    """Sanitize raw media title into a filesystem-safe filename while preserving

    Arabic characters and emojis where feasible.
    """
    if not name or not name.strip():
        name = default_name

    # Normalize Unicode (NFC for Arabic and general text)
    cleaned = unicodedata.normalize("NFC", name.strip())

    # Replace forbidden OS characters with underscore
    cleaned = FORBIDDEN_CHARS_PATTERN.sub("_", cleaned)

    # Collapse consecutive whitespace
    cleaned = WHITESPACE_COLLAPSE_PATTERN.sub(" ", cleaned).strip()

    # Strip trailing periods/spaces forbidden on Windows
    cleaned = TRAILING_DOTS_SPACES_PATTERN.sub("", cleaned)

    if not cleaned:
        cleaned = default_name

    # Handle extension
    if ext:
        clean_ext = ext.lstrip(".").strip().lower()
        if clean_ext:
            # If the name already ends with the extension, don't duplicate
            if not cleaned.lower().endswith(f".{clean_ext}"):
                cleaned = f"{cleaned}.{clean_ext}"

    # Truncate to safe filesystem length while preserving extension
    if len(cleaned.encode("utf-8")) > max_length:
        if ext and cleaned.lower().endswith(f".{ext.lstrip('.').lower()}"):
            suffix = f".{ext.lstrip('.').lower()}"
            base = cleaned[: -len(suffix)]
            # Slice characters until bytes fit
            while base and len((base + suffix).encode("utf-8")) > max_length:
                base = base[:-1]
            cleaned = base + suffix
        else:
            while cleaned and len(cleaned.encode("utf-8")) > max_length:
                cleaned = cleaned[:-1]

    # Check for Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
    # If the file stem matches a reserved name, prefix with an underscore
    stem = Path(cleaned).stem
    suffix = Path(cleaned).suffix
    if stem.upper() in WINDOWS_RESERVED_NAMES:
        cleaned = f"_{stem}{suffix}"

    return cleaned or default_name


def to_ascii_fallback(filename: str, default_name: str = "download") -> str:
    """Convert filename to an ASCII-safe fallback string for legacy clients."""
    # Split extension if present
    ext = ""
    base = filename
    if "." in filename:
        parts = filename.rsplit(".", 1)
        base = parts[0]
        ext = f".{parts[1]}"

    # Transliterate / strip non-ASCII from base
    ascii_chars = []
    for char in base:
        if char.isascii() and (char.isalnum() or char in "-_ "):
            ascii_chars.append(char)
        else:
            ascii_chars.append("_")

    result = "".join(ascii_chars)
    result = re.sub(r"_+", "_", result).strip("_ ")
    if not result:
        result = default_name

    # Check if ASCII base stem matches Windows reserved name
    if result.upper() in WINDOWS_RESERVED_NAMES:
        result = f"_{result}"

    return f"{result}{ext}"



def build_content_disposition(
    filename: str,
    disposition_type: str = "attachment",
) -> str:
    """Build an RFC 5987 / RFC 6266 compliant Content-Disposition header.

    Format: attachment; filename="<ascii>"; filename*=UTF-8''<url_encoded>
    """
    safe_name = sanitize_filename(filename)
    ascii_name = to_ascii_fallback(safe_name)

    # URL encode for RFC 5987 (spaces become %20, Arabic and emojis encoded)
    encoded_utf8 = urllib.parse.quote(safe_name, safe=".-_")

    return f'{disposition_type}; filename="{ascii_name}"; filename*=UTF-8\'\'{encoded_utf8}'
