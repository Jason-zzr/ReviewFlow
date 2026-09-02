from __future__ import annotations

import ctypes
from ctypes import wintypes
import os
import threading
import time


def process_exists(process_id: int) -> bool:
    if process_id <= 0:
        return False
    if os.name == "nt":
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        kernel32.GetExitCodeProcess.restype = wintypes.BOOL
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL
        process_handle = kernel32.OpenProcess(0x00101000, False, process_id)
        if process_handle:
            exit_code = wintypes.DWORD()
            inspected = kernel32.GetExitCodeProcess(process_handle, ctypes.byref(exit_code))
            kernel32.CloseHandle(process_handle)
            return bool(inspected) and exit_code.value == 259
        return ctypes.get_last_error() == 5
    try:
        os.kill(process_id, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def monitor_parent(parent_process_id: int, *, interval_seconds: float = 1.0) -> None:
    if parent_process_id <= 0:
        raise ValueError("Parent process ID must be positive")
    while process_exists(parent_process_id):
        time.sleep(interval_seconds)
    os._exit(0)


def start_parent_watchdog() -> threading.Thread | None:
    configured_parent = os.getenv("REVIEWFLOW_PARENT_PID")
    if configured_parent is None:
        return None
    try:
        parent_process_id = int(configured_parent)
    except ValueError as error:
        raise ValueError("REVIEWFLOW_PARENT_PID must be a positive integer") from error
    if parent_process_id <= 0:
        raise ValueError("REVIEWFLOW_PARENT_PID must be a positive integer")
    thread = threading.Thread(
        target=monitor_parent,
        args=(parent_process_id,),
        name="reviewflow-parent-watchdog",
        daemon=True,
    )
    thread.start()
    return thread
