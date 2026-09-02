from __future__ import annotations

import os
import threading
import subprocess
import sys

import pytest

from reviewflow_publisher import main as publisher_main
from reviewflow_publisher import parent_watchdog


def test_process_exists_recognizes_the_running_sidecar_process():
    assert parent_watchdog.process_exists(os.getpid()) is True


def test_process_exists_distinguishes_a_finished_child_from_a_running_process():
    process = subprocess.Popen([sys.executable, "-c", "pass"])
    process.wait(timeout=5)

    assert parent_watchdog.process_exists(process.pid) is False


def test_parent_watchdog_terminates_when_the_parent_disappears(monkeypatch):
    parent_states = iter([True, False])
    sleep_calls: list[float] = []

    monkeypatch.setattr(parent_watchdog, "process_exists", lambda _pid: next(parent_states))
    monkeypatch.setattr(parent_watchdog.time, "sleep", sleep_calls.append)
    monkeypatch.setattr(parent_watchdog.os, "_exit", lambda code: (_ for _ in ()).throw(SystemExit(code)))

    with pytest.raises(SystemExit) as exit_result:
        parent_watchdog.monitor_parent(1234, interval_seconds=0.25)

    assert exit_result.value.code == 0
    assert sleep_calls == [0.25]


def test_parent_watchdog_starts_only_when_electron_supplies_a_parent_pid(monkeypatch):
    exited = threading.Event()
    monkeypatch.setenv("REVIEWFLOW_PARENT_PID", "4321")
    monkeypatch.setattr(parent_watchdog, "process_exists", lambda _pid: False)
    monkeypatch.setattr(parent_watchdog.os, "_exit", lambda code: exited.set())

    thread = parent_watchdog.start_parent_watchdog()

    assert thread is not None
    assert thread.daemon is True
    assert exited.wait(timeout=1)


def test_sidecar_starts_the_parent_watchdog_before_serving(monkeypatch):
    events: list[str] = []
    monkeypatch.setattr(publisher_main, "start_parent_watchdog", lambda: events.append("watchdog"), raising=False)
    monkeypatch.setattr(publisher_main.uvicorn, "run", lambda *_args, **_kwargs: events.append("server"))

    publisher_main.run()

    assert events == ["watchdog", "server"]
