from __future__ import annotations

import json
import os
import shlex
import shutil
import sys
from pathlib import Path

HOST_NAME = "com.overleaf_local_compile.host"


def install_chrome_host(extension_id: str, host_path: str | None = None) -> Path:
    executable = host_path or shutil.which("overleaf-local-compile")
    if not executable:
        raise SystemExit("Could not find overleaf-local-compile on PATH")

    destination = chrome_native_messaging_dir() / f"{HOST_NAME}.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    wrapper = write_host_wrapper(destination.parent, Path(executable).resolve())

    manifest = {
        "name": HOST_NAME,
        "description": "Overleaf Local Compile native host",
        "path": str(wrapper),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{extension_id}/"],
    }

    destination.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(destination)
    return destination


def write_host_wrapper(directory: Path, executable: Path) -> Path:
    wrapper = directory / f"{HOST_NAME}.sh"
    quoted_executable = shlex.quote(str(executable))
    wrapper.write_text(
        "\n".join(
            [
                "#!/bin/sh",
                "LOG_DIR=\"$HOME/Library/Logs/overleaf-local-compile\"",
                "mkdir -p \"$LOG_DIR\"",
                "PATH=\"/Library/TeX/texbin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH\"",
                "export PATH",
                "{",
                "  printf '%s wrapper starting target=%s pwd=%s PATH=%s\\n' \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" "
                + f"{shlex.quote(str(executable))} \"$PWD\" \"$PATH\"",
                "} >> \"$LOG_DIR/host-launch.log\" 2>&1",
                f"exec {quoted_executable} \"$@\" 2>> \"$LOG_DIR/host-launch.log\"",
                "status=$?",
                "{",
                "  printf '%s wrapper exec failed status=%s target=%s\\n' \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" \"$status\" "
                + f"{shlex.quote(str(executable))}",
                "} >> \"$LOG_DIR/host-launch.log\" 2>&1",
                "exit \"$status\"",
                "",
            ]
        ),
        encoding="utf-8",
    )
    wrapper.chmod(0o755)
    return wrapper


def chrome_native_messaging_dir() -> Path:
    if sys.platform != "darwin":
        raise SystemExit("V1 installer supports macOS only")
    return Path.home() / "Library/Application Support/Google/Chrome/NativeMessagingHosts"
