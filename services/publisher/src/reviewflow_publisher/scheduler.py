from __future__ import annotations

import asyncio
from datetime import timedelta

from .adapters import AdapterRegistry
from .models import MetricFetchRequest, MetricImportRequest
from .security import redact
from .storage import StaleMetricClaim, Store


MAX_METRIC_ATTEMPTS = 3


class MetricScheduler:
    def __init__(self, store: Store, adapters: AdapterRegistry | None = None):
        self.store = store
        self.adapters = adapters or AdapterRegistry()

    async def collect_due(self) -> int:
        processed = 0
        for claim in self.store.claim_due_metric_tasks():
            task = claim.task
            processed += 1
            try:
                request = MetricFetchRequest(
                    platform=task.platform,
                    publicationId=task.publicationId,
                    externalRef=task.externalRef,
                )
                result = await asyncio.to_thread(
                    self.adapters.get(task.platform).fetch_metrics,
                    request,
                )
                if result.status == "manual_required" or result.metrics is None:
                    self.store.update_metric_task(
                        task.id,
                        "manual_required",
                        claim_token=claim.token,
                    )
                    continue
                self.store.record_collected_metrics(task.id, claim.token, MetricImportRequest(
                    publicationId=task.publicationId,
                    source="adapter",
                    metrics=result.metrics,
                    raw=result.raw,
                ))
            except StaleMetricClaim:
                continue
            except Exception as error:
                next_attempt = task.attempts + 1
                terminal = next_attempt >= MAX_METRIC_ATTEMPTS
                try:
                    self.store.update_metric_task(
                        task.id,
                        "manual_required" if terminal else "pending",
                        last_error=redact(error),
                        retry_after=None if terminal else timedelta(hours=2 ** (next_attempt - 1)),
                        claim_token=claim.token,
                    )
                except StaleMetricClaim:
                    continue
        return processed

    async def run_forever(self) -> None:
        while True:
            await self.collect_due()
            await asyncio.sleep(60)
