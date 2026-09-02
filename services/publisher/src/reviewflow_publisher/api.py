from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from .adapters import AdapterRegistry
from .models import (
    AccountCheckRequest,
    AccountCheckResult,
    AdapterCapability,
    MetricImportRequest,
    MetricCollectionTask,
    MetricFetchRequest,
    MetricFetchResult,
    MetricSnapshot,
    MetricScheduleRequest,
    PublicationConfirmation,
    PublicationConfirmRequest,
    PublishExecuteRequest,
    PublishJob,
    PublishPreview,
    PublishPreviewRequest,
)
from .security import ALLOWED_ORIGINS, require_session, validate_origin
from .metrics import fetch_metrics
from .service import PublishService
from .scheduler import MetricScheduler
from .storage import Store
from .storage import IdempotencyConflict


def default_data_path() -> Path:
    configured = os.getenv("REVIEWFLOW_DATA_DIR")
    if configured:
        return Path(configured)
    return Path.home() / ".reviewflow"


def create_app(store: Store | None = None) -> FastAPI:
    active_store = store or Store(default_data_path() / "reviewflow.sqlite3")
    scheduler = MetricScheduler(active_store)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        task = asyncio.create_task(scheduler.run_forever())
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="ReviewFlow publisher sidecar", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(ALLOWED_ORIGINS),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )
    adapters = AdapterRegistry()
    service = PublishService(active_store, adapters)

    def authorized(request: Request) -> None:
        validate_origin(request)
        require_session(request)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": "0.1.0"}

    @app.get("/v1/adapters", response_model=list[AdapterCapability], dependencies=[Depends(authorized)])
    def list_adapters() -> list[AdapterCapability]:
        return adapters.capabilities()

    @app.post("/v1/accounts/check", response_model=AccountCheckResult, dependencies=[Depends(authorized)])
    async def check_account(request: AccountCheckRequest) -> AccountCheckResult:
        adapter = adapters.get(request.platform)
        if not adapter.runtime_available():
            return AccountCheckResult(
                platform=request.platform,
                accountId=request.accountId,
                runtimeAvailable=False,
                message="Pinned omnipost runtime is not installed",
            )
        result = await adapter.check_account(request.accountId)
        return AccountCheckResult(
            platform=request.platform,
            accountId=request.accountId,
            runtimeAvailable=True,
            authenticated=result.return_code == 0,
            message=result.stdout or result.stderr or "Account check completed",
        )

    @app.post("/v1/publish/preview", response_model=PublishPreview, dependencies=[Depends(authorized)])
    def preview(request: PublishPreviewRequest) -> PublishPreview:
        return service.preview(request.manifest)

    @app.post("/v1/publish/execute", response_model=PublishJob, dependencies=[Depends(authorized)])
    async def execute(request: PublishExecuteRequest) -> PublishJob:
        try:
            return await service.execute(request)
        except IdempotencyConflict as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @app.get("/v1/publications/{job_id}", response_model=PublishJob, dependencies=[Depends(authorized)])
    def publication(job_id: str) -> PublishJob:
        job = active_store.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Publication job not found")
        return job

    @app.post(
        "/v1/publications/{job_id}/confirm",
        response_model=PublicationConfirmation,
        dependencies=[Depends(authorized)],
    )
    def confirm_publication(job_id: str, request: PublicationConfirmRequest) -> PublicationConfirmation:
        try:
            return service.confirm_publication(job_id, request)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Publication job not found") from error
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.post("/v1/metrics/import", response_model=MetricSnapshot, dependencies=[Depends(authorized)])
    def import_metrics(request: MetricImportRequest) -> MetricSnapshot:
        return active_store.import_metrics(request)

    @app.get("/v1/metrics/latest/{publication_id}", response_model=MetricSnapshot, dependencies=[Depends(authorized)])
    def latest_metrics(publication_id: str) -> MetricSnapshot:
        snapshot = active_store.latest_metrics(publication_id)
        if snapshot is None:
            raise HTTPException(status_code=404, detail="Metric snapshot not found")
        return snapshot

    @app.post("/v1/metrics/schedule", response_model=MetricCollectionTask, dependencies=[Depends(authorized)])
    def schedule_metrics(request: MetricScheduleRequest) -> MetricCollectionTask:
        return active_store.schedule_metrics(request)

    @app.post("/v1/metrics/fetch", response_model=MetricFetchResult, dependencies=[Depends(authorized)])
    def collect_metrics(request: MetricFetchRequest) -> MetricFetchResult:
        try:
            return fetch_metrics(request)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(status_code=502, detail="Platform metrics collection failed") from error

    return app


app = create_app()
