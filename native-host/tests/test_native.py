from __future__ import annotations

import io
import sys

from overleaf_local_compile.native import native_allowed_origins, read_message, write_message


def test_native_message_round_trip() -> None:
    stream = io.BytesIO()
    write_message(stream, {"id": 1, "type": "hello"})
    stream.seek(0)

    assert read_message(stream) == {"id": 1, "type": "hello"}


def test_native_allowed_origins_reads_chrome_extension_argv(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "overleaf-local-compile",
            "chrome-extension://abcdefghijklmnop/",
            "--ignored",
        ],
    )

    assert native_allowed_origins() == {"chrome-extension://abcdefghijklmnop"}
