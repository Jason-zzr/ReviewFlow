from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from .security import sanitize_raw_snapshot


def require_timezone_aware(value: datetime | None, field_name: str) -> datetime | None:
    if value is not None and (value.tzinfo is None or value.utcoffset() is None):
        raise ValueError(f"{field_name} must include a timezone offset")
    return value


class Platform(str, Enum):
    xiaohongshu = "xiaohongshu"
    douyin = "douyin"
    bilibili = "bilibili"


class ContentKind(str, Enum):
    video = "video"
    image_text = "image_text"


class PublicationStatus(str, Enum):
    draft = "draft"
    awaiting_confirmation = "awaiting_confirmation"
    submitted = "submitted"
    processing = "processing"
    published = "published"
    failed = "failed"
    unknown = "unknown"


class PlatformVariant(BaseModel):
    id: str
    contentId: str
    platform: Platform
    accountId: str
    title: str
    body: str
    tags: list[str] = Field(default_factory=list)
    mediaPaths: list[str] = Field(default_factory=list)
    scheduledAt: datetime | None = None
    bilibiliTid: int | None = None

    @field_validator("title", "accountId")
    @classmethod
    def must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be blank")
        return value

    @field_validator("scheduledAt")
    @classmethod
    def schedule_must_include_timezone(cls, value: datetime | None) -> datetime | None:
        return require_timezone_aware(value, "scheduledAt")


class PublishManifest(BaseModel):
    id: str
    contentId: str
    variants: list[PlatformVariant]
    createdAt: datetime
    digest: str | None = None

    @field_validator("createdAt")
    @classmethod
    def created_at_must_include_timezone(cls, value: datetime) -> datetime:
        return require_timezone_aware(value, "createdAt")  # type: ignore[return-value]


class PublishPreviewRequest(BaseModel):
    manifest: PublishManifest


class PublishExecuteRequest(BaseModel):
    manifest: PublishManifest
    confirmationDigest: str
    idempotencyKey: str = Field(min_length=8, max_length=160)


class AdapterCapability(BaseModel):
    platform: Platform
    supportsVideo: bool
    supportsImageText: bool
    supportsNativeSchedule: bool
    supportsAutomaticMetrics: bool = False
    liveRuntimeAvailable: bool


class PublishPreview(BaseModel):
    manifestDigest: str
    valid: bool
    warnings: list[str]
    commands: list[list[str]]
    livePublishingEnabled: bool


class PublishJob(BaseModel):
    id: str
    manifestId: str
    manifestDigest: str
    idempotencyKey: str
    status: PublicationStatus
    dryRun: bool
    createdAt: datetime
    updatedAt: datetime
    details: dict[str, Any] = Field(default_factory=dict)


class NormalizedMetrics(BaseModel):
    views: int | None = Field(default=None, ge=0)
    likes: int | None = Field(default=None, ge=0)
    saves: int | None = Field(default=None, ge=0)
    comments: int | None = Field(default=None, ge=0)
    shares: int | None = Field(default=None, ge=0)
    followersGained: int | None = Field(default=None, ge=0)


class MetricImportRequest(BaseModel):
    publicationId: str
    source: Literal["manual", "csv", "adapter"]
    metrics: NormalizedMetrics
    raw: dict[str, Any] | None = None

    @field_validator("raw", mode="before")
    @classmethod
    def sanitize_raw(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        return sanitize_raw_snapshot(value)


class MetricSnapshot(BaseModel):
    id: str
    publicationId: str
    capturedAt: datetime
    source: Literal["manual", "csv", "adapter"]
    metrics: NormalizedMetrics
    raw: dict[str, Any] | None = None

    @field_validator("raw", mode="before")
    @classmethod
    def sanitize_raw(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        return sanitize_raw_snapshot(value)


class MetricFetchRequest(BaseModel):
    platform: Platform
    publicationId: str
    externalRef: str


class MetricFetchResult(BaseModel):
    status: Literal["collected", "manual_required"]
    platform: Platform
    publicationId: str
    metrics: NormalizedMetrics | None = None
    raw: dict[str, Any] | None = None
    message: str

    @field_validator("raw", mode="before")
    @classmethod
    def sanitize_raw(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        return sanitize_raw_snapshot(value)


class MetricScheduleRequest(BaseModel):
    platform: Platform
    publicationId: str = Field(min_length=1, max_length=160)
    externalRef: str = Field(min_length=1, max_length=2_000)
    publishedAt: datetime

    @field_validator("publishedAt")
    @classmethod
    def published_at_must_include_timezone(cls, value: datetime) -> datetime:
        return require_timezone_aware(value, "publishedAt")  # type: ignore[return-value]


class MetricCollectionTask(BaseModel):
    id: str
    platform: Platform
    publicationId: str
    externalRef: str
    publishedAt: datetime
    dueAt: datetime
    nextAttemptAt: datetime
    status: Literal["pending", "collected", "manual_required"]
    attempts: int
    lastError: str | None = None


class PublicationConfirmRequest(BaseModel):
    platform: Platform
    externalRef: str = Field(min_length=1, max_length=2_000)
    publishedAt: datetime

    @field_validator("publishedAt")
    @classmethod
    def published_at_must_include_timezone(cls, value: datetime) -> datetime:
        return require_timezone_aware(value, "publishedAt")  # type: ignore[return-value]


class PublicationConfirmation(BaseModel):
    publicationId: str
    job: PublishJob
    metricTask: MetricCollectionTask


class AccountCheckRequest(BaseModel):
    platform: Platform
    accountId: str = Field(min_length=1, max_length=120)


class AccountCheckResult(BaseModel):
    platform: Platform
    accountId: str
    runtimeAvailable: bool
    authenticated: bool | None = None
    message: str
