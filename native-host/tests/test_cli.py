from __future__ import annotations

from local_compile_for_overleaf import cli


def test_chrome_origin_argument_starts_native_host(monkeypatch) -> None:
    called = False

    def fake_run_native_host() -> None:
        nonlocal called
        called = True

    monkeypatch.setattr(cli, "run_native_host", fake_run_native_host)

    assert cli.main(["chrome-extension://ejalmpfkcbnhjdgmcddpapmchodhhcoa/"]) == 0
    assert called

