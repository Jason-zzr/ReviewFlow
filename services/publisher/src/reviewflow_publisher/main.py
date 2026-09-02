from __future__ import annotations

import os

import uvicorn

from .parent_watchdog import start_parent_watchdog


def run() -> None:
    start_parent_watchdog()
    uvicorn.run(
        "reviewflow_publisher.api:app",
        host="127.0.0.1",
        port=int(os.getenv("REVIEWFLOW_SIDECAR_PORT", "43117")),
        log_level="info",
    )


if __name__ == "__main__":
    run()
