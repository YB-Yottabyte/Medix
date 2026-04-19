"""Normalize Qdrant version.info files by removing trailing newlines/whitespace.

This helps when a local Qdrant collection fails to load because stored
`version.info` files contain values like `0.6.0\\n` instead of `0.6.0`.

Run from the project root:
    python scripts/fix_qdrant_version_files.py
"""

from __future__ import annotations

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
QDRANT_COLLECTIONS_DIR = PROJECT_ROOT / "qdrant_storage" / "collections"


def normalize_version_files() -> list[tuple[Path, str, str]]:
    """Strip trailing whitespace from every Qdrant version.info file."""
    updates: list[tuple[Path, str, str]] = []

    if not QDRANT_COLLECTIONS_DIR.exists():
        return updates

    for path in sorted(QDRANT_COLLECTIONS_DIR.rglob("version.info")):
        original = path.read_text(encoding="utf-8")
        normalized = original.strip()
        if original != normalized:
            path.write_text(normalized, encoding="utf-8", newline="")
            updates.append((path, original, normalized))

    return updates


def main() -> None:
    updates = normalize_version_files()

    if not updates:
        print("No Qdrant version.info files needed changes.")
        return

    print(f"Normalized {len(updates)} Qdrant version.info file(s):")
    for path, original, normalized in updates:
        rel_path = path.relative_to(PROJECT_ROOT)
        print(f"- {rel_path}: {original!r} -> {normalized!r}")


if __name__ == "__main__":
    main()
