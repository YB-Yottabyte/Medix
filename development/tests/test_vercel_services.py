"""Deployment boundary regression checks without cloud resources or inference."""

import json
import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def test_browser_routes_keep_nextjs_authentication_uploads_and_media_proxy():
    config = json.loads((ROOT / "vercel.json").read_text())
    for path in (
        "/",
        "/chat/fixture",
        "/api/auth/session",
        "/api/chat",
        "/api/files/upload",
        "/api/medix/artifacts/fixture/clip.mp4",
        "/api/tts",
    ):
        route = next(rule for rule in config["rewrites"] if re.fullmatch(rule["source"], path))
        assert route["destination"]["service"] == "frontend"
    assert not any(rule["destination"]["service"] == "app" for rule in config["rewrites"])
    assert config["services"]["frontend"]["bindings"] == [
        {"type": "service", "service": "app", "format": "url", "env": "MEDIX_API_URL"}
    ]
    app = config["services"]["app"]
    assert (ROOT / app["root"] / app["entrypoint"]).is_file()


def run_container(tmp_path, profile, **overrides):
    """Capture the real shell entrypoint's argv/env with a harmless fake uv."""
    fake = tmp_path / "uv"
    fake.write_text(
        "#!/bin/sh\n"
        'printf "%s\\n" "$@"\n'
        'printf "HF_HOME=%s\\n" "$HF_HOME"\n'
        'printf "VIDEO=%s\\n" "$MEDIX_VIDEO_CACHE"\n'
        'printf "MANIFEST=%s\\n" "$MEDIX_SUPPORTED_VIDEO_COLLECTION"\n'
    )
    fake.chmod(0o755)
    env = {"PATH": str(tmp_path) + os.pathsep + os.defpath, **overrides}
    return subprocess.run(  # noqa: S603 - fixed repository entrypoint and fixture arguments
        ["/bin/sh", str(ROOT / "backend/start-container.sh"), profile],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.mark.parametrize(
    "profile,port,root",
    [("render", "10000", "/var/data/medix"), ("vercel", "80", "/tmp/medix")],  # noqa: S108 - assert the container runtime contract
)
def test_container_profiles_keep_render_persistence_and_vercel_writable_cache(
    tmp_path, profile, port, root
):
    result = run_container(tmp_path, profile)
    assert result.returncode == 0, result.stderr
    lines = result.stdout.splitlines()
    assert lines[lines.index("--port") + 1] == port
    assert f"HF_HOME={root}/huggingface" in lines
    assert f"VIDEO={root}/videos" in lines
    assert f"MANIFEST={root}/supported_video_collection.json" in lines
    assert "backend.app:app" in lines


def test_explicit_runtime_paths_and_platform_port_are_preserved(tmp_path):
    result = run_container(
        tmp_path,
        "vercel",
        PORT="4321",
        MEDIX_RUNTIME_ROOT=str(tmp_path / "runtime"),
        MEDIX_VIDEO_CACHE="/custom/videos",
    )
    assert result.returncode == 0
    lines = result.stdout.splitlines()
    assert lines[lines.index("--port") + 1] == "4321"
    assert "VIDEO=/custom/videos" in lines
    assert f"MANIFEST={tmp_path}/runtime/supported_video_collection.json" in lines


def test_unknown_container_profile_fails_before_server_start(tmp_path):
    result = run_container(tmp_path, "unknown")
    assert result.returncode == 2
    assert not result.stdout


def test_vercel_runtime_context_selects_the_writable_profile_without_arguments(tmp_path):
    result = run_container(tmp_path, "", VERCEL="1")
    assert result.returncode == 0
    lines = result.stdout.splitlines()
    assert lines[lines.index("--port") + 1] == "80"
    assert "VIDEO=/tmp/medix/videos" in lines


def test_explicit_profile_is_available_when_system_variables_are_not_exposed(tmp_path):
    result = run_container(tmp_path, "", MEDIX_CONTAINER_PROFILE="vercel")
    assert result.returncode == 0
    lines = result.stdout.splitlines()
    assert lines[lines.index("--port") + 1] == "80"
