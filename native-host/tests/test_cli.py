from __future__ import annotations

from local_compile_for_overleaf import cli
from local_compile_for_overleaf.install import FIREFOX_EXTENSION_ID, InstallReport


def test_chrome_origin_argument_starts_native_host(monkeypatch) -> None:
    called = False

    def fake_run_native_host() -> None:
        nonlocal called
        called = True

    monkeypatch.setattr(cli, "run_native_host", fake_run_native_host)

    assert cli.main(["chrome-extension://ejalmpfkcbnhjdgmcddpapmchodhhcoa/"]) == 0
    assert called


def test_firefox_origin_argument_starts_native_host(monkeypatch) -> None:
    called = False

    def fake_run_native_host() -> None:
        nonlocal called
        called = True

    monkeypatch.setattr(cli, "run_native_host", fake_run_native_host)

    assert cli.main(["moz-extension://1234/"]) == 0
    assert called


def test_firefox_manifest_argv_starts_native_host(monkeypatch) -> None:
    called = False

    def fake_run_native_host() -> None:
        nonlocal called
        called = True

    monkeypatch.setattr(cli, "run_native_host", fake_run_native_host)

    assert (
        cli.main(
            ["/path/to/de.dominik_peters.local_compile_for_overleaf.json", FIREFOX_EXTENSION_ID]
        )
        == 0
    )
    assert called


def test_no_args_runs_manifest_installer(monkeypatch, capsys) -> None:
    called = False

    def fake_install_manifests() -> InstallReport:
        nonlocal called
        called = True
        return InstallReport()

    monkeypatch.setattr(cli, "install_manifests", fake_install_manifests)
    monkeypatch.setattr(cli, "format_report", lambda _report: "installed")

    assert cli.main([]) == 0
    assert called
    assert capsys.readouterr().out == "installed\n"
