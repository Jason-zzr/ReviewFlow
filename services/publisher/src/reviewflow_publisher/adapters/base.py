from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from shutil import which
import sys

from ..models import AdapterCapability, Platform, PlatformVariant


class ExecutionCondition(str, Enum):
    success = "success"
    account_auth_required = "account_auth_required"
    challenge = "challenge"
    selector_drift = "selector_drift"
    runtime_error = "runtime_error"


@dataclass(frozen=True)
class ExecutionResult:
    return_code: int
    stdout: str
    stderr: str
    condition: ExecutionCondition = ExecutionCondition.success


class PublisherAdapter(ABC):
    platform: Platform

    @abstractmethod
    def capability(self) -> AdapterCapability: ...

    @abstractmethod
    def validate(self, variant: PlatformVariant) -> list[str]: ...

    @abstractmethod
    def preview(self, variant: PlatformVariant) -> list[str]: ...

    @abstractmethod
    async def publish(self, variant: PlatformVariant) -> ExecutionResult: ...

    def runtime_executable(self) -> str | None:
        configured = os.getenv("REVIEWFLOW_SAU_EXECUTABLE")
        sibling = Path(sys.executable).with_name("reviewflow-sau.exe") if getattr(sys, "frozen", False) else None
        candidate = configured or (str(sibling) if sibling and sibling.is_file() else None) or which("reviewflow-sau")
        if not candidate:
            return None
        try:
            resolved = Path(candidate).expanduser().resolve(strict=True)
        except (OSError, RuntimeError):
            return None
        return str(resolved) if resolved.is_file() else None

    def runtime_available(self) -> bool:
        return self.runtime_executable() is not None
