from __future__ import annotations

import asyncio
import json
import os
import subprocess
from pathlib import Path

import typer

from .adapters import AdapterRegistry
from .digests import manifest_digest
from .models import Platform, PublishExecuteRequest, PublishManifest
from .growth import build_retro, predict_views, score_assessments
from .service import PublishService
from .storage import Store

app = typer.Typer(help="ReviewFlow local workflow CLI", no_args_is_help=True)
account_app = typer.Typer(help="Account login and status commands")
publish_app = typer.Typer(help="Preview and execute immutable publish manifests")
retro_app = typer.Typer(help="T+3 retrospective helpers")
content_app = typer.Typer(help="Score content and build interval predictions")
app.add_typer(account_app, name="account")
app.add_typer(publish_app, name="publish")
app.add_typer(retro_app, name="retro")
app.add_typer(content_app, name="content")


@content_app.command("score")
def content_score(input_file: Path) -> None:
    payload = json.loads(input_file.read_text(encoding="utf-8"))
    typer.echo(json.dumps(score_assessments(payload["assessments"]), ensure_ascii=False, indent=2))


@content_app.command("predict")
def content_predict(history_file: Path, score: float | None = None) -> None:
    history = json.loads(history_file.read_text(encoding="utf-8"))
    typer.echo(json.dumps(predict_views(history, score), ensure_ascii=False, indent=2))


@account_app.command("check")
def account_check(platform: Platform, account: str) -> None:
    adapter = AdapterRegistry().get(platform)
    executable = adapter.runtime_executable()
    if executable is None:
        raise typer.BadParameter("Pinned omnipost runtime is not installed")
    command = adapter.account_command("check", account)
    command[0] = executable
    result = subprocess.run(command, check=False)
    raise typer.Exit(code=result.returncode)


@account_app.command("login")
def account_login(
    platform: Platform,
    account: str,
    headed: bool = typer.Option(True, "--headed/--headless", help="Show the platform login browser"),
) -> None:
    if os.getenv("REVIEWFLOW_LIVE_PUBLISH", "0") != "1":
        raise typer.BadParameter("Login is disabled until REVIEWFLOW_LIVE_PUBLISH=1 is explicitly set")
    adapter = AdapterRegistry().get(platform)
    executable = adapter.runtime_executable()
    if executable is None:
        raise typer.BadParameter("Pinned omnipost runtime is not installed")
    command = adapter.account_command("login", account, headed=headed)
    command[0] = executable
    result = subprocess.run(command, check=False)
    raise typer.Exit(code=result.returncode)


def load_manifest(path: Path) -> PublishManifest:
    return PublishManifest.model_validate_json(path.read_text(encoding="utf-8"))


def publish_summary(manifest: PublishManifest) -> dict:
    return {
        "manifestId": manifest.id,
        "contentId": manifest.contentId,
        "digest": manifest_digest(manifest),
        "targets": [
            {
                "platform": variant.platform.value,
                "account": variant.accountId,
                "title": variant.title,
                "media": [Path(path).name for path in variant.mediaPaths],
                "scheduledAt": variant.scheduledAt.isoformat() if variant.scheduledAt else None,
                **({"bilibiliTid": variant.bilibiliTid} if variant.bilibiliTid else {}),
            }
            for variant in manifest.variants
        ],
    }


@publish_app.command("preview")
def publish_preview(manifest: Path) -> None:
    value = load_manifest(manifest)
    data_dir = Path(os.getenv("REVIEWFLOW_DATA_DIR", str(Path.home() / ".reviewflow")))
    preview = PublishService(Store(data_dir / "reviewflow.sqlite3")).preview(value)
    payload = {
        "digest": preview.manifestDigest,
        **preview.model_dump(mode="json"),
        "summary": publish_summary(value),
    }
    typer.echo(json.dumps(payload, ensure_ascii=False, indent=2))


@publish_app.command("execute")
def publish_execute(
    manifest: Path,
    confirm: str = typer.Option(..., help="Exact digest from preview"),
    idempotency_key: str = typer.Option(..., min=8, max=160, help="Stable key for safe retries"),
) -> None:
    value = load_manifest(manifest)
    expected = manifest_digest(value)
    if value.digest != expected or confirm != expected:
        raise typer.BadParameter("Manifest or confirmation digest does not match the preview")
    typer.echo("Immutable publish summary:")
    typer.echo(json.dumps(publish_summary(value), ensure_ascii=False, indent=2))
    if not typer.confirm("Publish this exact manifest to the listed accounts?"):
        raise typer.Abort()
    data_dir = Path(os.getenv("REVIEWFLOW_DATA_DIR", str(Path.home() / ".reviewflow")))
    request = PublishExecuteRequest(
        manifest=value,
        confirmationDigest=confirm,
        idempotencyKey=idempotency_key,
    )
    job = asyncio.run(PublishService(Store(data_dir / "reviewflow.sqlite3")).execute(request))
    typer.echo(job.model_dump_json(indent=2))


@retro_app.command("run")
def retro_run(
    prediction: Path = typer.Option(..., exists=True, dir_okay=False),
    snapshot: Path = typer.Option(..., exists=True, dir_okay=False),
    published_at: str = typer.Option(..., help="UTC ISO-8601 publication timestamp"),
) -> None:
    prediction_payload = json.loads(prediction.read_text(encoding="utf-8"))
    snapshot_payload = json.loads(snapshot.read_text(encoding="utf-8"))
    typer.echo(json.dumps(
        build_retro(prediction_payload, snapshot_payload, published_at),
        ensure_ascii=False,
        indent=2,
    ))
