from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

import httpx

from .models import MetricFetchRequest, MetricFetchResult, NormalizedMetrics, Platform

BILIBILI_VIEW_API = "https://api.bilibili.com/x/web-interface/view"


def normalize_bvid(value: str) -> str:
    match = re.search(r"(BV[0-9A-Za-z]{10})", value or "")
    return match.group(1) if match else value.strip()


def fetch_metrics(
    request: MetricFetchRequest,
    get: Callable[..., Any] | None = None,
) -> MetricFetchResult:
    if request.platform is not Platform.bilibili:
        return MetricFetchResult(
            status="manual_required",
            platform=request.platform,
            publicationId=request.publicationId,
            message="该平台当前需要手动补录或 CSV 导入，自动采集适配器未启用。",
        )
    bvid = normalize_bvid(request.externalRef)
    if not re.fullmatch(r"BV[0-9A-Za-z]{10}", bvid):
        raise ValueError("B 站外部引用必须包含有效 BV 号")
    if get is None:
        def default_get(url: str, **kwargs: Any) -> httpx.Response:
            return httpx.get(url, timeout=20, follow_redirects=True, **kwargs)
        get = default_get
    response = get(
        BILIBILI_VIEW_API,
        params={"bvid": bvid},
        headers={"User-Agent": "ReviewFlow/0.1", "Referer": "https://www.bilibili.com"},
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("code") != 0:
        raise RuntimeError(f"Bilibili metrics API failed: {payload.get('message', 'unknown error')}")
    data = payload.get("data") or {}
    stat = data.get("stat") or {}
    metrics = NormalizedMetrics(
        views=stat.get("view"),
        likes=stat.get("like"),
        saves=stat.get("favorite"),
        comments=stat.get("reply"),
        shares=stat.get("share"),
        followersGained=None,
    )
    return MetricFetchResult(
        status="collected",
        platform=request.platform,
        publicationId=request.publicationId,
        metrics=metrics,
        raw={"bvid": data.get("bvid") or bvid, "aid": data.get("aid"), "title": data.get("title")},
        message="已通过 B 站公开接口采集表现数据。",
    )

