from __future__ import annotations

import json
import sys
from importlib.metadata import distribution, version


EXPECTED_OMNIPOST_COMMIT = "012caee407f2ee9cca8857579b23721c8b6e7f63"
EXPECTED_VERSIONS = {
    "loguru": "0.7.3",
    "greenlet": "3.5.5",
    "numpy": "2.2.6",
    "opencv-python": "4.13.0.92",
    "patchright": "1.58.2",
    "pyee": "13.0.1",
    "qrcode": "8.2",
    "requests": "2.32.3",
    "segno": "1.6.6",
    "social-auto-upload": "0.1.0",
}


def main() -> None:
    if sys.version_info[:2] != (3, 10):
        raise SystemExit(f"Publisher release builds require Python 3.10; found {sys.version.split()[0]}")
    mismatches = [
        f"{package}={version(package)} (expected {expected})"
        for package, expected in EXPECTED_VERSIONS.items()
        if version(package) != expected
    ]
    if mismatches:
        raise SystemExit("Publisher dependency mismatch: " + "; ".join(mismatches))

    direct_url_text = distribution("social-auto-upload").read_text("direct_url.json")
    direct_url = json.loads(direct_url_text or "{}")
    actual_commit = direct_url.get("vcs_info", {}).get("commit_id")
    if actual_commit != EXPECTED_OMNIPOST_COMMIT:
        raise SystemExit(
            f"omnipost commit mismatch: {actual_commit or 'missing'} "
            f"(expected {EXPECTED_OMNIPOST_COMMIT})"
        )
    print("Pinned publisher dependencies verified")


if __name__ == "__main__":
    main()
