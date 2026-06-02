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


def test_browser_targets_macos_manifest_locations(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(install.sys, "platform", "darwin")
    monkeypatch.setattr(install.Path, "home", lambda: tmp_path)

    targets = targets_by_key(install.browser_targets())
    app = tmp_path / "Library/Application Support"

    assert targets["chrome"].manifest_dir == app / "Google/Chrome/NativeMessagingHosts"
    assert (
        targets["chrome-for-testing"].manifest_dir
        == app / "Google/ChromeForTesting/NativeMessagingHosts"
    )
    assert targets["chromium"].manifest_dir == app / "Chromium/NativeMessagingHosts"
    assert targets["edge"].manifest_dir == app / "Microsoft Edge/NativeMessagingHosts"
    assert (
        targets["brave"].manifest_dir
        == app / "BraveSoftware/Brave-Browser/NativeMessagingHosts"
    )
    assert targets["firefox"].manifest_dir == app / "Mozilla/NativeMessagingHosts"


def test_browser_targets_linux_manifest_locations(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(install.sys, "platform", "linux")
    monkeypatch.setattr(install.Path, "home", lambda: tmp_path)
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)

    targets = targets_by_key(install.browser_targets())
    config = tmp_path / ".config"

    assert targets["chrome"].manifest_dir == config / "google-chrome/NativeMessagingHosts"
    assert (
        targets["chrome-for-testing"].manifest_dir
        == config / "google-chrome-for-testing/NativeMessagingHosts"
    )
    assert targets["chromium"].manifest_dir == config / "chromium/NativeMessagingHosts"
    assert targets["edge"].manifest_dir == config / "microsoft-edge/NativeMessagingHosts"
    assert (
        targets["brave"].manifest_dir
        == config / "BraveSoftware/Brave-Browser/NativeMessagingHosts"
    )
    assert targets["firefox"].manifest_dir == tmp_path / ".mozilla/native-messaging-hosts"


def test_browser_targets_windows_registry_locations(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(install.sys, "platform", "win32")
    monkeypatch.setattr(install.Path, "home", lambda: tmp_path)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "LocalAppData"))
    monkeypatch.setenv("APPDATA", str(tmp_path / "RoamingAppData"))

    targets = targets_by_key(install.browser_targets())

    assert (
        targets["chrome"].windows_registry_key
        == rf"Software\Google\Chrome\NativeMessagingHosts\{install.HOST_NAME}"
    )
    assert (
        targets["chromium"].windows_registry_key
        == rf"Software\Chromium\NativeMessagingHosts\{install.HOST_NAME}"
    )
    assert (
        targets["edge"].windows_registry_key
        == rf"Software\Microsoft\Edge\NativeMessagingHosts\{install.HOST_NAME}"
    )
    assert (
        targets["brave"].windows_registry_key
        == rf"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\{install.HOST_NAME}"
    )
    assert (
        targets["firefox"].windows_registry_key
        == rf"Software\Mozilla\NativeMessagingHosts\{install.HOST_NAME}"
    )


def test_write_firefox_manifest_registers_windows_manifest(
    tmp_path: Path,
    monkeypatch,
) -> None:
    registry_calls: list[tuple[str, Path]] = []
    launcher = tmp_path / "local-compile-for-overleaf.exe"
    monkeypatch.setattr(install.sys, "platform", "win32")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setattr(
        install,
        "write_windows_registry_key",
        lambda key, path: registry_calls.append((key, path)),
    )
    target = install.firefox_target(
        tmp_path / "ignored",
        rf"Software\Mozilla\NativeMessagingHosts\{install.HOST_NAME}",
    )

    path = install.write_firefox_manifest(
        target,
        launcher,
        [install.FIREFOX_EXTENSION_ID],
    )

    assert path == (
        tmp_path
        / install.PRODUCT_NAME
        / "NativeMessagingHosts"
        / "firefox"
        / f"{install.HOST_NAME}.json"
    )
    assert registry_calls == [(target.windows_registry_key, path)]
    manifest = json.loads(path.read_text(encoding="utf-8"))
    assert manifest["path"] == str(launcher)
    assert manifest["allowed_extensions"] == [install.FIREFOX_EXTENSION_ID]


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


def targets_by_key(targets: list[install.BrowserTarget]) -> dict[str, install.BrowserTarget]:
    return {target.key: target for target in targets}
