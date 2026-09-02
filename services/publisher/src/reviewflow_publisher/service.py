from __future__ import annotations

import os
from datetime import datetime

from .adapters import AdapterRegistry
from .adapters.base import ExecutionCondition
from .digests import assert_confirmed, manifest_digest
from .models import (
    MetricScheduleRequest,
    PublicationStatus,
    PublicationConfirmation,
    PublicationConfirmRequest,
    PublishExecuteRequest,
    PublishJob,
    PublishManifest,
    PublishPreview,
)
from .storage import IdempotencyConflict, Store
from .security import redact


class PublishService:
    def __init__(self, store: Store, adapters: AdapterRegistry | None = None):
        self.store = store
        self.adapters = adapters or AdapterRegistry()

    @property
    def live_enabled(self) -> bool:
        return os.getenv("REVIEWFLOW_LIVE_PUBLISH", "0") == "1"

    def preview(self, manifest: PublishManifest) -> PublishPreview:
        warnings: list[str] = []
        commands: list[list[str]] = []
        seen_platforms = set()
        for variant in manifest.variants:
            adapter = self.adapters.get(variant.platform)
            if variant.platform in seen_platforms:
                warnings.append(f"{variant.platform.value}: 同一发布清单不能重复同一平台")
            seen_platforms.add(variant.platform)
            warnings.extend(f"{variant.platform.value}: {warning}" for warning in adapter.validate(variant))
            commands.append(adapter.preview(variant))
        if not manifest.variants:
            warnings.append("发布清单至少需要一个平台版本")
        return PublishPreview(
            manifestDigest=manifest_digest(manifest),
            valid=not warnings,
            warnings=warnings,
            commands=commands,
            livePublishingEnabled=self.live_enabled,
        )

    async def execute(self, request: PublishExecuteRequest) -> PublishJob:
        digest = assert_confirmed(request.manifest, request.confirmationDigest)
        existing = self.store.get_job_by_idempotency(request.idempotencyKey)
        if existing:
            if existing.manifestDigest != digest:
                raise IdempotencyConflict(
                    "Idempotency key is already bound to a different manifest"
                )
            return existing
        preview = self.preview(request.manifest)
        if not preview.valid:
            raise ValueError("Publish manifest failed validation")
        if not self.live_enabled:
            return self.store.create_job(
                request.manifest.id,
                digest,
                request.idempotencyKey,
                PublicationStatus.awaiting_confirmation,
                True,
                {"message": "Live publishing is disabled", "commands": preview.commands},
            )
        for variant in request.manifest.variants:
            if not self.adapters.get(variant.platform).runtime_available():
                raise RuntimeError("Pinned omnipost runtime is not installed; install the live extra")
        job, claimed = self.store.create_job_once(
            request.manifest.id,
            digest,
            request.idempotencyKey,
            PublicationStatus.submitted,
            False,
            {"commands": preview.commands},
        )
        if not claimed:
            return job
        job = self.store.update_job(
            job.id,
            PublicationStatus.processing,
            {"commands": preview.commands, "message": "Publisher process started"},
        )
        results = []
        for variant in request.manifest.variants:
            try:
                result = await self.adapters.get(variant.platform).publish(variant)
            except Exception as error:
                results.append({
                    "platform": variant.platform.value,
                    "variantId": variant.id,
                    "status": PublicationStatus.unknown.value,
                    "condition": ExecutionCondition.runtime_error.value,
                    "error": redact(error),
                })
                return self.store.update_job(
                    job.id,
                    PublicationStatus.unknown,
                    {
                        "results": results,
                        "message": "Uploader stopped unexpectedly; external publication status is unknown",
                        "error": redact(error),
                    },
                )
            results.append({
                "platform": variant.platform.value,
                "returnCode": result.return_code,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "condition": result.condition.value,
                "variantId": variant.id,
                "status": PublicationStatus.unknown.value
                if result.condition is ExecutionCondition.success and result.return_code == 0
                else PublicationStatus.failed.value,
            })
            if result.condition is not ExecutionCondition.success or result.return_code != 0:
                prior_submission_may_exist = any(
                    item["condition"] == ExecutionCondition.success.value for item in results[:-1]
                )
                return self.store.update_job(
                    job.id,
                    PublicationStatus.unknown if prior_submission_may_exist else PublicationStatus.failed,
                    {
                        "results": results,
                        "partialSubmissionPossible": prior_submission_may_exist,
                        "userActionRequired": result.condition
                        in {ExecutionCondition.account_auth_required, ExecutionCondition.challenge},
                    },
                )
        return self.store.update_job(
            job.id,
            PublicationStatus.unknown,
            {"results": results, "message": "Uploader exited successfully; verify the external publication"},
        )

    def confirm_publication(
        self,
        job_id: str,
        request: PublicationConfirmRequest,
    ) -> PublicationConfirmation:
        job = self.store.get_job(job_id)
        if job is None:
            raise KeyError(job_id)
        if job.dryRun:
            raise ValueError("Dry-run jobs cannot be confirmed as published")
        results = job.details.get("results")
        if not isinstance(results, list):
            raise ValueError("Publication attempts are unavailable for this job")
        matching = [item for item in results if item.get("platform") == request.platform.value]
        if len(matching) != 1:
            raise ValueError("Publication platform is missing or ambiguous")
        attempt = matching[0]
        if attempt.get("status") == PublicationStatus.failed.value:
            raise ValueError("A failed publication attempt cannot be confirmed")

        publication_id = f"{job.id}:{request.platform.value}"
        if attempt.get("operatorVerified"):
            prior_time = datetime.fromisoformat(str(attempt.get("publishedAt")))
            task = self.store.get_metric_task(request.platform, publication_id)
            if (
                attempt.get("externalRef") == request.externalRef
                and prior_time == request.publishedAt
                and task is not None
            ):
                return PublicationConfirmation(publicationId=publication_id, job=job, metricTask=task)
            raise ValueError("This platform publication was already confirmed with different evidence")
        attempt.update({
            "status": PublicationStatus.published.value,
            "externalRef": request.externalRef,
            "publishedAt": request.publishedAt.isoformat(),
            "operatorVerified": True,
        })
        statuses = {item.get("status") for item in results}
        aggregate_status = (
            PublicationStatus.published
            if statuses == {PublicationStatus.published.value}
            else PublicationStatus.unknown
        )
        details = {
            **job.details,
            "results": results,
            "message": "All platform publications were verified by the user"
            if aggregate_status is PublicationStatus.published
            else "Some platform publications still require verification",
        }
        updated_job = self.store.update_job(job.id, aggregate_status, details)
        task = self.store.schedule_metrics(MetricScheduleRequest(
            platform=request.platform,
            publicationId=publication_id,
            externalRef=request.externalRef,
            publishedAt=request.publishedAt,
        ))
        return PublicationConfirmation(
            publicationId=publication_id,
            job=updated_job,
            metricTask=task,
        )
