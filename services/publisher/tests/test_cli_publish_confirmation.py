from pathlib import Path

from typer.testing import CliRunner

from reviewflow_publisher.cli import app
from reviewflow_publisher.digests import manifest_digest
from reviewflow_publisher.models import PublishManifest


def make_two_target_manifest(media_path: Path) -> PublishManifest:
    manifest = PublishManifest.model_validate({
        "id": "manifest-cli-confirmation",
        "contentId": "content-cli-confirmation",
        "createdAt": "2026-01-01T00:00:00Z",
        "variants": [
            {
                "id": "variant-xiaohongshu",
                "contentId": "content-cli-confirmation",
                "platform": "xiaohongshu",
                "accountId": "xhs-account",
                "title": "逐任务确认测试",
                "body": "测试正文",
                "mediaPaths": [str(media_path.resolve())],
            },
            {
                "id": "variant-douyin",
                "contentId": "content-cli-confirmation",
                "platform": "douyin",
                "accountId": "douyin-account",
                "title": "逐任务确认测试",
                "body": "测试正文",
                "mediaPaths": [str(media_path.resolve())],
            },
        ],
    })
    manifest.digest = manifest_digest(manifest)
    return manifest


def test_cli_publish_rejection_aborts_before_any_task_is_created(tmp_path: Path) -> None:
    media = tmp_path / "clip.mp4"
    media.write_bytes(b"cli confirmation fixture")
    manifest = make_two_target_manifest(media)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(manifest.model_dump_json(indent=2), encoding="utf-8")
    data_dir = tmp_path / "data"

    result = CliRunner().invoke(
        app,
        [
            "publish",
            "execute",
            str(manifest_path),
            "--confirm",
            manifest.digest,
            "--idempotency-key",
            "cli-confirmation-rejection",
        ],
        input="y\nn\n",
        env={
            "REVIEWFLOW_DATA_DIR": str(data_dir),
            "REVIEWFLOW_LIVE_PUBLISH": "0",
        },
    )

    assert result.exit_code == 1
    assert "Confirm task 1/2: xiaohongshu / xhs-account" in result.output
    assert "Confirm task 2/2: douyin / douyin-account" in result.output
    assert "Aborted" in result.output
    assert not (data_dir / "reviewflow.sqlite3").exists()


def test_cli_publish_executes_only_after_every_task_is_confirmed(tmp_path: Path) -> None:
    media = tmp_path / "clip.mp4"
    media.write_bytes(b"cli confirmation fixture")
    manifest = make_two_target_manifest(media)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(manifest.model_dump_json(indent=2), encoding="utf-8")

    result = CliRunner().invoke(
        app,
        [
            "publish",
            "execute",
            str(manifest_path),
            "--confirm",
            manifest.digest,
            "--idempotency-key",
            "cli-confirmation-accepted",
        ],
        input="y\ny\n",
        env={
            "REVIEWFLOW_DATA_DIR": str(tmp_path / "data"),
            "REVIEWFLOW_LIVE_PUBLISH": "0",
        },
    )

    assert result.exit_code == 0, result.output
    assert "Confirm task 1/2: xiaohongshu / xhs-account" in result.output
    assert "Confirm task 2/2: douyin / douyin-account" in result.output
    assert '"status": "awaiting_confirmation"' in result.output
    assert '"dryRun": true' in result.output
