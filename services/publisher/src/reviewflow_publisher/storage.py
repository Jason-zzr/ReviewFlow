from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator
from uuid import uuid4

from .models import (
    MetricCollectionTask,
    MetricImportRequest,
    MetricScheduleRequest,
    MetricSnapshot,
    Platform,
    PublicationStatus,
    PublishJob,
)

SCHEMA_VERSION = 3


class IdempotencyConflict(ValueError):
    pass


class Store:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.migrate()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def migrate(self) -> None:
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("BEGIN IMMEDIATE")
            current = self._read_schema_version(connection)
            if current > SCHEMA_VERSION:
                raise RuntimeError(
                    "Database uses a newer schema version "
                    f"({current}); this application supports up to {SCHEMA_VERSION}"
                )

            migrations = {
                1: self._migrate_to_v1,
                2: self._migrate_to_v2,
                3: self._migrate_to_v3,
            }
            while current < SCHEMA_VERSION:
                target = current + 1
                migrations[target](connection)
                connection.execute("UPDATE schema_meta SET version = ?", (target,))
                current = target

            self._validate_current_schema(connection)

    @staticmethod
    def _read_schema_version(connection: sqlite3.Connection) -> int:
        schema_meta_exists = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_meta'"
        ).fetchone()
        if schema_meta_exists is None:
            existing_tables = {
                row["name"]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            if existing_tables:
                raise RuntimeError("Database has an unversioned schema and cannot be migrated safely")
            connection.execute("CREATE TABLE schema_meta (version INTEGER NOT NULL)")
            connection.execute("INSERT INTO schema_meta(version) VALUES (0)")
            return 0

        rows = connection.execute("SELECT version FROM schema_meta").fetchall()
        if len(rows) != 1 or type(rows[0]["version"]) is not int or rows[0]["version"] < 0:
            raise RuntimeError("Database schema metadata is invalid")
        return rows[0]["version"]

    @staticmethod
    def _migrate_to_v1(connection: sqlite3.Connection) -> None:
        connection.execute(
            """CREATE TABLE publish_jobs (
                id TEXT PRIMARY KEY,
                manifest_id TEXT NOT NULL,
                idempotency_key TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL,
                dry_run INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                details_json TEXT NOT NULL
            )"""
        )
        connection.execute(
            """CREATE TABLE metric_snapshots (
                id TEXT PRIMARY KEY,
                publication_id TEXT NOT NULL,
                captured_at TEXT NOT NULL,
                source TEXT NOT NULL,
                metrics_json TEXT NOT NULL,
                raw_json TEXT
            )"""
        )

    @staticmethod
    def _migrate_to_v2(connection: sqlite3.Connection) -> None:
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(publish_jobs)").fetchall()
        }
        if not columns:
            raise RuntimeError("Publisher schema v1 is missing publish_jobs")
        if "manifest_digest" not in columns:
            connection.execute(
                "ALTER TABLE publish_jobs ADD COLUMN manifest_digest TEXT NOT NULL DEFAULT ''"
            )

    @staticmethod
    def _migrate_to_v3(connection: sqlite3.Connection) -> None:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS metric_collection_queue (
                id TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                publication_id TEXT NOT NULL,
                external_ref TEXT NOT NULL,
                published_at TEXT NOT NULL,
                due_at TEXT NOT NULL,
                next_attempt_at TEXT NOT NULL,
                status TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                UNIQUE(platform, publication_id)
            )"""
        )

    @staticmethod
    def _validate_current_schema(connection: sqlite3.Connection) -> None:
        required_columns = {
            "publish_jobs": {
                "id", "manifest_id", "manifest_digest", "idempotency_key", "status",
                "dry_run", "created_at", "updated_at", "details_json",
            },
            "metric_snapshots": {
                "id", "publication_id", "captured_at", "source", "metrics_json", "raw_json",
            },
            "metric_collection_queue": {
                "id", "platform", "publication_id", "external_ref", "published_at", "due_at",
                "next_attempt_at", "status", "attempts", "last_error",
            },
        }
        for table, expected in required_columns.items():
            actual = {
                row["name"]
                for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
            }
            missing = expected - actual
            if missing:
                raise RuntimeError(
                    f"Publisher schema v{SCHEMA_VERSION} table {table} is missing columns: "
                    + ", ".join(sorted(missing))
                )

    def get_job_by_idempotency(self, key: str) -> PublishJob | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM publish_jobs WHERE idempotency_key = ?", (key,)
            ).fetchone()
        return self._row_to_job(row) if row else None

    def get_job(self, job_id: str) -> PublishJob | None:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM publish_jobs WHERE id = ?", (job_id,)).fetchone()
        return self._row_to_job(row) if row else None

    def create_job(
        self,
        manifest_id: str,
        manifest_digest: str,
        idempotency_key: str,
        status: PublicationStatus,
        dry_run: bool,
        details: dict,
    ) -> PublishJob:
        now = datetime.now(timezone.utc)
        job = PublishJob(
            id=str(uuid4()),
            manifestId=manifest_id,
            manifestDigest=manifest_digest,
            idempotencyKey=idempotency_key,
            status=status,
            dryRun=dry_run,
            createdAt=now,
            updatedAt=now,
            details=details,
        )
        try:
            with self.connect() as connection:
                connection.execute(
                    """INSERT INTO publish_jobs
                    (id, manifest_id, manifest_digest, idempotency_key, status, dry_run, created_at, updated_at, details_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        job.id,
                        job.manifestId,
                        job.manifestDigest,
                        job.idempotencyKey,
                        job.status.value,
                        int(job.dryRun),
                        job.createdAt.isoformat(),
                        job.updatedAt.isoformat(),
                        json.dumps(job.details, ensure_ascii=False),
                    ),
                )
        except sqlite3.IntegrityError as error:
            existing = self.get_job_by_idempotency(idempotency_key)
            if existing is None:
                raise
            if existing.manifestDigest != manifest_digest:
                raise IdempotencyConflict(
                    "Idempotency key is already bound to a different manifest"
                ) from error
            return existing
        return job

    def update_job(self, job_id: str, status: PublicationStatus, details: dict) -> PublishJob:
        now = datetime.now(timezone.utc)
        with self.connect() as connection:
            connection.execute(
                "UPDATE publish_jobs SET status=?, updated_at=?, details_json=? WHERE id=?",
                (status.value, now.isoformat(), json.dumps(details, ensure_ascii=False), job_id),
            )
        job = self.get_job(job_id)
        if job is None:
            raise KeyError(job_id)
        return job

    def import_metrics(self, request: MetricImportRequest) -> MetricSnapshot:
        snapshot = MetricSnapshot(
            id=str(uuid4()),
            publicationId=request.publicationId,
            capturedAt=datetime.now(timezone.utc),
            source=request.source,
            metrics=request.metrics,
            raw=request.raw,
        )
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO metric_snapshots
                (id, publication_id, captured_at, source, metrics_json, raw_json)
                VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    snapshot.id,
                    snapshot.publicationId,
                    snapshot.capturedAt.isoformat(),
                    snapshot.source,
                    snapshot.metrics.model_dump_json(),
                    json.dumps(snapshot.raw, ensure_ascii=False) if snapshot.raw is not None else None,
                ),
            )
        return snapshot

    def latest_metrics(self, publication_id: str) -> MetricSnapshot | None:
        with self.connect() as connection:
            row = connection.execute(
                """SELECT * FROM metric_snapshots WHERE publication_id=?
                ORDER BY captured_at DESC LIMIT 1""",
                (publication_id,),
            ).fetchone()
        if row is None:
            return None
        return MetricSnapshot(
            id=row["id"],
            publicationId=row["publication_id"],
            capturedAt=datetime.fromisoformat(row["captured_at"]),
            source=row["source"],
            metrics=json.loads(row["metrics_json"]),
            raw=json.loads(row["raw_json"]) if row["raw_json"] else None,
        )

    def get_metric_task(self, platform: Platform, publication_id: str) -> MetricCollectionTask | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM metric_collection_queue WHERE platform=? AND publication_id=?",
                (platform.value, publication_id),
            ).fetchone()
        return self._row_to_metric_task(row) if row else None

    def schedule_metrics(self, request: MetricScheduleRequest) -> MetricCollectionTask:
        published_at = request.publishedAt.astimezone(timezone.utc)
        due_at = published_at + timedelta(hours=72)
        existing = self.get_metric_task(request.platform, request.publicationId)
        if (
            existing
            and existing.externalRef == request.externalRef
            and existing.publishedAt.astimezone(timezone.utc) == published_at
        ):
            return existing
        task = MetricCollectionTask(
            id=str(uuid4()),
            platform=request.platform,
            publicationId=request.publicationId,
            externalRef=request.externalRef,
            publishedAt=published_at,
            dueAt=due_at,
            nextAttemptAt=due_at,
            status="pending",
            attempts=0,
        )
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO metric_collection_queue
                (id, platform, publication_id, external_ref, published_at, due_at,
                 next_attempt_at, status, attempts, last_error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(platform, publication_id) DO UPDATE SET
                  external_ref=excluded.external_ref,
                  published_at=excluded.published_at,
                  due_at=excluded.due_at,
                  next_attempt_at=excluded.next_attempt_at,
                  status='pending', attempts=0, last_error=NULL""",
                (
                    task.id,
                    task.platform.value,
                    task.publicationId,
                    task.externalRef,
                    task.publishedAt.isoformat(),
                    task.dueAt.isoformat(),
                    task.nextAttemptAt.isoformat(),
                    task.status,
                    task.attempts,
                    task.lastError,
                ),
            )
            row = connection.execute(
                "SELECT * FROM metric_collection_queue WHERE platform=? AND publication_id=?",
                (task.platform.value, task.publicationId),
            ).fetchone()
        if row is None:
            raise RuntimeError("Metric collection task was not persisted")
        return self._row_to_metric_task(row)

    def due_metric_tasks(self, now: datetime | None = None) -> list[MetricCollectionTask]:
        instant = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat()
        with self.connect() as connection:
            rows = connection.execute(
                """SELECT * FROM metric_collection_queue
                WHERE status='pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 20""",
                (instant,),
            ).fetchall()
        return [self._row_to_metric_task(row) for row in rows]

    def update_metric_task(
        self,
        task_id: str,
        status: str,
        *,
        last_error: str | None = None,
        retry_after: timedelta | None = None,
    ) -> MetricCollectionTask:
        next_attempt = datetime.now(timezone.utc) + (retry_after or timedelta(0))
        with self.connect() as connection:
            connection.execute(
                """UPDATE metric_collection_queue
                SET status=?, attempts=attempts+1, last_error=?, next_attempt_at=? WHERE id=?""",
                (status, last_error, next_attempt.isoformat(), task_id),
            )
            row = connection.execute(
                "SELECT * FROM metric_collection_queue WHERE id=?", (task_id,)
            ).fetchone()
        if row is None:
            raise KeyError(task_id)
        return self._row_to_metric_task(row)

    @staticmethod
    def _row_to_job(row: sqlite3.Row) -> PublishJob:
        return PublishJob(
            id=row["id"],
            manifestId=row["manifest_id"],
            manifestDigest=row["manifest_digest"],
            idempotencyKey=row["idempotency_key"],
            status=PublicationStatus(row["status"]),
            dryRun=bool(row["dry_run"]),
            createdAt=datetime.fromisoformat(row["created_at"]),
            updatedAt=datetime.fromisoformat(row["updated_at"]),
            details=json.loads(row["details_json"]),
        )

    @staticmethod
    def _row_to_metric_task(row: sqlite3.Row) -> MetricCollectionTask:
        return MetricCollectionTask(
            id=row["id"],
            platform=Platform(row["platform"]),
            publicationId=row["publication_id"],
            externalRef=row["external_ref"],
            publishedAt=datetime.fromisoformat(row["published_at"]),
            dueAt=datetime.fromisoformat(row["due_at"]),
            nextAttemptAt=datetime.fromisoformat(row["next_attempt_at"]),
            status=row["status"],
            attempts=row["attempts"],
            lastError=row["last_error"],
        )
