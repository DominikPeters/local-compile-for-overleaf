from __future__ import annotations

import json
from pathlib import Path
import sys
import uuid

import pytest
from local_compile_for_overleaf import install


WINDOWS_ONLY = pytest.mark.skipif(
    sys.platform != "win32", reason="requires the Windows registry"
)


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


def test_install_manifests_uses_published_chrome_id_by_default(
    tmp_path: Path,
    monkeypatch,
) -> None:
    launcher = tmp_path / "launcher.sh"
    launcher.write_text("#!/bin/sh\n", encoding="utf-8")
    target = install.BrowserTarget(
        key="chrome",
        display_name="Google Chrome",
        family="chromium",
        profile_root=tmp_path / "chrome",
        manifest_dir=tmp_path / "chrome" / "NativeMessagingHosts",
        default_extension_ids=install.chrome_extension_ids(),
    )
    target.profile_root.mkdir()
    monkeypatch.setattr(install, "browser_targets", lambda: [target])
    monkeypatch.setattr(install, "ensure_launcher", lambda _host_path=None: launcher)
    monkeypatch.setattr(install, "find_executable", lambda _name: None)

    report = install.install_manifests(browsers=["chrome"])

    assert report.installed[0].extension_ids == ["nmdbichdffibgheeggobljjipcangmdf"]
    manifest = json.loads(report.installed[0].path.read_text(encoding="utf-8"))
    assert manifest["allowed_origins"] == [
        "chrome-extension://nmdbichdffibgheeggobljjipcangmdf/"
    ]


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


def test_resolve_windows_launcher_finds_console_script_in_scripts_dir(
    tmp_path: Path,
    monkeypatch,
) -> None:
    scripts_dir = tmp_path / "Scripts"
    scripts_dir.mkdir()
    launcher = scripts_dir / f"{install.CLI_NAME}.exe"
    launcher.write_text("", encoding="utf-8")
    monkeypatch.setattr(install.shutil, "which", lambda _name: None)
    monkeypatch.setattr(install.sysconfig, "get_path", lambda _name: str(scripts_dir))

    assert install.resolve_windows_launcher() == launcher.resolve()


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


@WINDOWS_ONLY
def test_install_manifests_writes_real_windows_registry_key(
    tmp_path: Path,
    monkeypatch,
) -> None:
    import winreg

    registry_parent = rf"Software\{install.PRODUCT_NAME} Tests\{uuid.uuid4().hex}"
    registry_key = rf"{registry_parent}\{install.HOST_NAME}"
    launcher = tmp_path / "local-compile-for-overleaf.exe"
    launcher.write_text("", encoding="utf-8")
    target = install.BrowserTarget(
        key="chrome-test",
        display_name="Chrome Test",
        family="chromium",
        profile_root=tmp_path / "profile",
        manifest_dir=None,
        windows_registry_key=registry_key,
    )
    monkeypatch.setattr(install.sys, "platform", "win32")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "LocalAppData"))
    monkeypatch.setattr(install, "browser_targets", lambda: [target])
    monkeypatch.setattr(install, "ensure_launcher", lambda _host_path=None: launcher)
    monkeypatch.setattr(install, "find_executable", lambda _name: None)

    try:
        report = install.install_manifests(
            browsers=["chrome-test"],
            extension_ids=["abcdefghijklmnopabcdefghijklmnop"],
        )

        assert len(report.installed) == 1
        manifest_path = report.installed[0].path
        assert manifest_path == (
            tmp_path
            / "LocalAppData"
            / install.PRODUCT_NAME
            / "NativeMessagingHosts"
            / "chrome-test"
            / f"{install.HOST_NAME}.json"
        )
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert manifest["path"] == str(launcher)
        assert manifest["allowed_origins"] == [
            "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"
        ]
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, registry_key) as key:
            value, value_type = winreg.QueryValueEx(key, None)
        assert value_type == winreg.REG_SZ
        assert value == str(manifest_path)
    finally:
        delete_windows_registry_key(registry_key)
        delete_windows_registry_key(registry_parent)


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


def delete_windows_registry_key(path: str) -> None:
    if sys.platform != "win32":
        return
    import winreg

    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, path)
    except FileNotFoundError:
        pass
