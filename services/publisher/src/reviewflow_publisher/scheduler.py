from __future__ import annotations

import asyncio
from datetime import timedelta

from .metrics import fetch_metrics
from .models import MetricFetchRequest, MetricImportRequest
from .security import redact
from .storage import Store


MAX_METRIC_ATTEMPTS = 3


class MetricScheduler:
    def __init__(self, store: Store):
        self.store = store

    async def collect_due(self) -> int:
        processed = 0
        for task in self.store.claim_due_metric_tasks():
            processed += 1
            try:
                result = await asyncio.to_thread(fetch_metrics, MetricFetchRequest(
                    platform=task.platform,
                    publicationId=task.publicationId,
                    externalRef=task.externalRef,
                ))
                if result.status == "manual_required" or result.metrics is None:
                    self.store.update_metric_task(task.id, "manual_required")
                    continue
                self.store.import_metrics(MetricImportRequest(
                    publicationId=task.publicationId,
                    source="adapter",
                    metrics=result.metrics,
                    raw=result.raw,
                ))
                self.store.update_metric_task(task.id, "collected")
            except Exception as error:
                next_attempt = task.attempts + 1
                terminal = next_attempt >= MAX_METRIC_ATTEMPTS
                self.store.update_metric_task(
                    task.id,
                    "manual_required" if terminal else "pending",
                    last_error=redact(error),
                    retry_after=None if terminal else timedelta(hours=2 ** (next_attempt - 1)),
                )
        return processed

    async def run_forever(self) -> None:
        while True:
            await self.collect_due()
            await asyncio.sleep(60)
