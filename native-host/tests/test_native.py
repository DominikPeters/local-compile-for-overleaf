from __future__ import annotations

import io

from overleaf_local_compile.native import read_message, write_message


def test_native_message_round_trip() -> None:
    stream = io.BytesIO()
    write_message(stream, {"id": 1, "type": "hello"})
    stream.seek(0)

    assert read_message(stream) == {"id": 1, "type": "hello"}
