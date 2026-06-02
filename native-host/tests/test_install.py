from __future__ import annotations

import json
from pathlib import Path

from local_compile_for_overleaf import install


def test_install_manifests_writes_chromium_and_firefox_manifests(
    tmp_path: Path,
    monkeypatch,
) -> None:
    launcher = tmp_path / "launcher.sh"
    launcher.write_text("#!/bin/sh\n", encoding="utf-8")
    targets = [
        install.BrowserTarget(
            key="chrome",
            display_name="Google Chrome",
            family="chromium",
            profile_root=tmp_path / "chrome",
            manifest_dir=tmp_path / "chrome" / "NativeMessagingHosts",
        ),
        install.BrowserTarget(
            key="firefox",
            display_name="Firefox",
            family="firefox",
            profile_root=None,
            manifest_dir=tmp_path / "firefox",
        ),
    ]
    monkeypatch.setattr(install, "browser_targets", lambda: targets)
    monkeypatch.setattr(install, "ensure_launcher", lambda _host_path=None: launcher)
    monkeypatch.setattr(install, "find_executable", lambda _name: "/texbin/latexmk")

    report = install.install_manifests(extension_ids=["abcdefghijklmnop"])

    assert [item.browser for item in report.installed] == ["Google Chrome", "Firefox"]
    chrome_manifest = json.loads(report.installed[0].path.read_text(encoding="utf-8"))
    assert chrome_manifest == {
        "name": install.HOST_NAME,
        "description": install.DESCRIPTION,
        "path": str(launcher),
        "type": "stdio",
        "allowed_origins": ["chrome-extension://abcdefghijklmnop/"],
    }
    firefox_manifest = json.loads(report.installed[1].path.read_text(encoding="utf-8"))
    assert firefox_manifest["allowed_extensions"] == [install.FIREFOX_EXTENSION_ID]


def test_install_manifests_uses_firefox_default_id_without_chrome_id(
    tmp_path: Path,
    monkeypatch,
) -> None:
    launcher = tmp_path / "launcher.sh"
    target = install.BrowserTarget(
        key="firefox",
        display_name="Firefox",
        family="firefox",
        profile_root=None,
        manifest_dir=tmp_path / "firefox",
    )
    monkeypatch.setattr(install, "browser_targets", lambda: [target])
    monkeypatch.setattr(install, "ensure_launcher", lambda _host_path=None: launcher)
    monkeypatch.setattr(install, "find_executable", lambda _name: None)

    report = install.install_manifests()

    assert report.installed[0].extension_ids == [install.FIREFOX_EXTENSION_ID]
    assert "latexmk was not found" in report.warnings[0]


def test_detect_extension_ids_reads_chromium_preferences(tmp_path: Path) -> None:
    preferences = tmp_path / "Default" / "Preferences"
    preferences.parent.mkdir(parents=True)
    preferences.write_text(
        json.dumps(
            {
                "extensions": {
                    "settings": {
                        "aaaaaaaaaaaaaaaa": {
                            "manifest": {
                                "name": install.PRODUCT_NAME,
                            },
                        },
                        "bbbbbbbbbbbbbbbb": {
                            "manifest": {
                                "name": "Other Extension",
                            },
                        },
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    target = install.BrowserTarget(
        key="chrome",
        display_name="Google Chrome",
        family="chromium",
        profile_root=tmp_path,
        manifest_dir=tmp_path / "NativeMessagingHosts",
    )

    assert install.detect_extension_ids(target) == ["aaaaaaaaaaaaaaaa"]


def test_format_report_mentions_retry(tmp_path: Path) -> None:
    report = install.InstallReport(
        launcher=tmp_path / "launcher.sh",
        installed=[
            install.ManifestInstall(
                browser="Google Chrome",
                path=tmp_path / "manifest.json",
                extension_ids=["abcdefghijklmnop"],
                status="installed",
            )
        ],
        latexmk_path="/texbin/latexmk",
    )

    text = install.format_report(report)

    assert "Google Chrome" in text
    assert "abcdefghijklmnop" in text
    assert "Return to the browser and click Retry." in text
