from __future__ import annotations

import json
import os
from pathlib import Path
import struct
import sys
import time
import traceback
from typing import Any, BinaryIO

from . import __version__
from .server import LocalCompileServer


def run_native_host(
    stdin: BinaryIO | None = None,
    stdout: BinaryIO | None = None,
) -> None:
    log_event(
        "native host starting",
        {
            "version": __version__,
            "executable": sys.executable,
            "argv": sys.argv,
            "cwd": os.getcwd(),
            "path": os.getenv("PATH", ""),
            "home": str(Path.home()),
        },
    )
    stdin = stdin or sys.stdin.buffer
    stdout = stdout or sys.stdout.buffer
    server: LocalCompileServer | None = None

    while True:
        message = read_message(stdin)
        if message is None:
            log_event("native host stdin closed")
            if server:
                server.stop()
            return

        message_id = message.get("id")
        try:
            message_type = message.get("type")
            log_event("native host message", {"id": message_id, "type": message_type})
            if message_type == "hello":
                if server is None:
                    server = LocalCompileServer()
                    server.start()
                    log_event(
                        "local server started",
                        {
                            "port": server.port,
                            "cacheRoot": str(server.cache_root),
                            "capabilities": server.capabilities(),
                        },
                    )
                response = {
                    "id": message_id,
                    "ok": True,
                    "version": __version__,
                    "port": server.port,
                    "token": server.token,
                    "capabilities": server.capabilities(),
                }
            elif message_type == "shutdown":
                if server and server.active_compile_count() == 0:
                    server.stop()
                    server = None
                    response = {"id": message_id, "ok": True, "stopped": True}
                elif server:
                    response = {"id": message_id, "ok": True, "stopped": False}
                else:
                    response = {"id": message_id, "ok": True, "stopped": False}
            else:
                response = {
                    "id": message_id,
                    "ok": False,
                    "error": f"Unknown native message type: {message_type}",
                }
        except Exception as error:  # noqa: BLE001 - native host must serialize failures.
            log_event(
                "native host error",
                {
                    "id": message_id,
                    "error": str(error),
                    "traceback": traceback.format_exc(),
                },
            )
            response = {"id": message_id, "ok": False, "error": str(error)}

        write_message(stdout, response)


def read_message(stream: BinaryIO) -> dict[str, Any] | None:
    raw_length = stream.read(4)
    if raw_length == b"":
        return None
    if len(raw_length) != 4:
        raise EOFError("Incomplete Native Messaging length header")
    (length,) = struct.unpack("<I", raw_length)
    raw_message = stream.read(length)
    if len(raw_message) != length:
        raise EOFError("Incomplete Native Messaging payload")
    return json.loads(raw_message.decode("utf-8"))


def write_message(stream: BinaryIO, message: dict[str, Any]) -> None:
    encoded = json.dumps(message, separators=(",", ":")).encode("utf-8")
    stream.write(struct.pack("<I", len(encoded)))
    stream.write(encoded)
    stream.flush()


def log_event(message: str, fields: dict[str, Any] | None = None) -> None:
    try:
        log_dir = Path.home() / "Library/Logs/overleaf-local-compile"
        log_dir.mkdir(parents=True, exist_ok=True)
        record = {
            "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "message": message,
            **(fields or {}),
        }
        with (log_dir / "host.log").open("a", encoding="utf-8") as log:
            log.write(json.dumps(record, default=str, sort_keys=True) + "\n")
    except Exception:
        pass
