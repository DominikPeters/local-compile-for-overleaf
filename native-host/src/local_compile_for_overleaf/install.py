from __future__ import annotations

from dataclasses import dataclass, field
import json
import os
import re
import shlex
import shutil
import sys
import sysconfig
from pathlib import Path
from typing import Any

from .server import find_executable

HOST_NAME = "de.dominik_peters.local_compile_for_overleaf"
PRODUCT_NAME = "Local Compile for Overleaf"
DESCRIPTION = "Unofficial local compile helper for Overleaf projects"
PYTHON_MODULE = "local_compile_for_overleaf"
CLI_NAME = "local-compile-for-overleaf"
FIREFOX_EXTENSION_ID = "local-compile-for-overleaf@dominik-peters.de"

# Fill these once the store listings exist. Until then, dev installs can pass
# --extension-id or rely on best-effort detection from browser profile data.
PUBLISHED_CHROME_EXTENSION_IDS: tuple[str, ...] = ()
PUBLISHED_EDGE_EXTENSION_IDS: tuple[str, ...] = ()


@dataclass(frozen=True)
class BrowserTarget:
    key: str
    display_name: str
    family: str
    profile_root: Path | None
    manifest_dir: Path | None
    windows_registry_key: str | None = None
    default_extension_ids: tuple[str, ...] = ()


@dataclass
class ManifestInstall:
    browser: str
    path: Path
    extension_ids: list[str]
    status: str
    detected: bool = False


@dataclass
class InstallReport:
    host_name: str = HOST_NAME
    launcher: Path | None = None
    installed: list[ManifestInstall] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    latexmk_path: str | None = None


def install_manifests(
    *,
    browsers: list[str] | None = None,
    extension_ids: list[str] | None = None,
    only_detected: bool = False,
    host_path: str | None = None,
) -> InstallReport:
    selected = set(browsers or [])
    report = InstallReport()
    launcher = ensure_launcher(host_path)
    report.launcher = launcher

    for target in browser_targets():
        if selected and target.key not in selected and target.family not in selected:
            continue
        detected_ids = detect_extension_ids(target)
        if target.family == "firefox":
            ids = [] if only_detected else [FIREFOX_EXTENSION_ID]
        else:
            ids = list(dict.fromkeys([*(extension_ids or []), *detected_ids]))
            if not ids and not only_detected:
                if target.profile_root and not target.profile_root.exists():
                    report.skipped.append(f"{target.display_name}: browser profile not found")
                    continue
                ids = list(target.default_extension_ids)
        if not ids:
            report.skipped.append(
                f"{target.display_name}: extension not detected and no published ID configured"
            )
            continue

        if target.family == "firefox":
            path = write_firefox_manifest(target, launcher, ids)
        else:
            path = write_chromium_manifest(target, launcher, ids)
        report.installed.append(
            ManifestInstall(
                browser=target.display_name,
                path=path,
                extension_ids=ids,
                status="installed",
                detected=bool(detected_ids),
            )
        )

    report.latexmk_path = find_executable("latexmk")
    if not report.latexmk_path:
        report.warnings.append("latexmk was not found on PATH or in common TeX locations")
    return report


def install_chrome_host(extension_id: str, host_path: str | None = None) -> Path:
    report = install_manifests(
        browsers=["chrome"],
        extension_ids=[extension_id],
        host_path=host_path,
    )
    if not report.installed:
        raise SystemExit("No Chrome Native Messaging manifest was installed")
    path = report.installed[0].path
    print(path)
    return path


def ensure_launcher(host_path: str | None = None) -> Path:
    if sys.platform == "win32":
        launcher = resolve_windows_launcher(host_path)
        if launcher is None:
            raise SystemExit(
                "Could not find local-compile-for-overleaf.exe. "
                "Install with pip so the console script is created, or pass --host-path."
            )
        return launcher
    return write_posix_launcher(host_path)


def resolve_windows_launcher(host_path: str | None = None) -> Path | None:
    if host_path:
        return Path(host_path).resolve()
    executable = shutil.which(CLI_NAME)
    if executable:
        return Path(executable).resolve()
    scripts_dir = Path(sysconfig.get_path("scripts"))
    for name in [f"{CLI_NAME}.exe", f"{CLI_NAME}.cmd", CLI_NAME]:
        candidate = scripts_dir / name
        if candidate.exists():
            return candidate.resolve()
    return None


def write_posix_launcher(host_path: str | None = None) -> Path:
    directory = app_support_dir()
    directory.mkdir(parents=True, exist_ok=True)
    wrapper = directory / f"{HOST_NAME}.sh"
    if host_path:
        command = shlex.quote(str(Path(host_path).resolve()))
    else:
        command = f"{shlex.quote(sys.executable)} -m {PYTHON_MODULE}"
    wrapper.write_text(
        "\n".join(
            [
                "#!/bin/sh",
                "LOG_DIR=\"$HOME/Library/Logs/local-compile-for-overleaf\"",
                "mkdir -p \"$LOG_DIR\"",
                "PATH=\"/Library/TeX/texbin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH\"",
                "export PATH",
                "{",
                "  printf '%s wrapper starting target=%s pwd=%s PATH=%s\\n' \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" "
                + f"{shlex.quote(command)} \"$PWD\" \"$PATH\"",
                "} >> \"$LOG_DIR/host-launch.log\" 2>&1",
                f"exec {command} \"$@\" 2>> \"$LOG_DIR/host-launch.log\"",
                "status=$?",
                "{",
                "  printf '%s wrapper exec failed status=%s target=%s\\n' \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" \"$status\" "
                + f"{shlex.quote(command)}",
                "} >> \"$LOG_DIR/host-launch.log\" 2>&1",
                "exit \"$status\"",
                "",
            ]
        ),
        encoding="utf-8",
    )
    wrapper.chmod(0o755)
    return wrapper


def write_chromium_manifest(
    target: BrowserTarget,
    launcher: Path,
    extension_ids: list[str],
) -> Path:
    manifest = {
        "name": HOST_NAME,
        "description": DESCRIPTION,
        "path": str(launcher),
        "type": "stdio",
        "allowed_origins": [
            f"chrome-extension://{extension_id}/" for extension_id in extension_ids
        ],
    }
    if sys.platform == "win32":
        path = windows_manifest_dir(target) / f"{HOST_NAME}.json"
        write_json(path, manifest)
        if target.windows_registry_key:
            write_windows_registry_key(target.windows_registry_key, path)
        return path
    if target.manifest_dir is None:
        raise ValueError(f"{target.display_name} has no manifest directory")
    path = target.manifest_dir / f"{HOST_NAME}.json"
    write_json(path, manifest)
    return path


def write_firefox_manifest(
    target: BrowserTarget,
    launcher: Path,
    extension_ids: list[str],
) -> Path:
    manifest = {
        "name": HOST_NAME,
        "description": DESCRIPTION,
        "path": str(launcher),
        "type": "stdio",
        "allowed_extensions": extension_ids,
    }
    if sys.platform == "win32":
        path = windows_manifest_dir(target) / f"{HOST_NAME}.json"
        write_json(path, manifest)
        if target.windows_registry_key:
            write_windows_registry_key(target.windows_registry_key, path)
        return path
    if target.manifest_dir is None:
        raise ValueError(f"{target.display_name} has no manifest directory")
    path = target.manifest_dir / f"{HOST_NAME}.json"
    write_json(path, manifest)
    return path


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def write_windows_registry_key(registry_key: str, manifest_path: Path) -> None:
    import winreg

    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, registry_key) as key:
        winreg.SetValueEx(key, None, 0, winreg.REG_SZ, str(manifest_path))


def browser_targets() -> list[BrowserTarget]:
    home = Path.home()
    if sys.platform == "darwin":
        app = home / "Library/Application Support"
        return [
            chromium_target("chrome", "Google Chrome", app / "Google/Chrome", chrome_extension_ids()),
            chromium_target("chromium", "Chromium", app / "Chromium", chrome_extension_ids()),
            chromium_target(
                "chrome-for-testing",
                "Chrome for Testing",
                app / "Google/ChromeForTesting",
                chrome_extension_ids(),
            ),
            chromium_target("edge", "Microsoft Edge", app / "Microsoft Edge", edge_extension_ids()),
            chromium_target(
                "brave",
                "Brave",
                app / "BraveSoftware/Brave-Browser",
                chrome_extension_ids(),
            ),
            firefox_target(app / "Mozilla/NativeMessagingHosts"),
        ]
    if sys.platform == "win32":
        local = Path(os.environ.get("LOCALAPPDATA", str(home / "AppData/Local")))
        roaming = Path(os.environ.get("APPDATA", str(home / "AppData/Roaming")))
        return [
            chromium_target(
                "chrome",
                "Google Chrome",
                local / "Google/Chrome/User Data",
                chrome_extension_ids(),
                r"Software\Google\Chrome\NativeMessagingHosts" + "\\" + HOST_NAME,
            ),
            chromium_target(
                "chromium",
                "Chromium",
                local / "Chromium/User Data",
                chrome_extension_ids(),
                r"Software\Chromium\NativeMessagingHosts" + "\\" + HOST_NAME,
            ),
            chromium_target(
                "edge",
                "Microsoft Edge",
                local / "Microsoft/Edge/User Data",
                edge_extension_ids(),
                r"Software\Microsoft\Edge\NativeMessagingHosts" + "\\" + HOST_NAME,
            ),
            chromium_target(
                "brave",
                "Brave",
                local / "BraveSoftware/Brave-Browser/User Data",
                chrome_extension_ids(),
                r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts" + "\\" + HOST_NAME,
            ),
            firefox_target(
                roaming / "Mozilla/NativeMessagingHosts",
                r"Software\Mozilla\NativeMessagingHosts" + "\\" + HOST_NAME,
            ),
        ]
    config = Path(os.environ.get("XDG_CONFIG_HOME", str(home / ".config")))
    return [
        chromium_target("chrome", "Google Chrome", config / "google-chrome", chrome_extension_ids()),
        chromium_target(
            "chrome-for-testing",
            "Chrome for Testing",
            config / "google-chrome-for-testing",
            chrome_extension_ids(),
        ),
        chromium_target("chromium", "Chromium", config / "chromium", chrome_extension_ids()),
        chromium_target("edge", "Microsoft Edge", config / "microsoft-edge", edge_extension_ids()),
        chromium_target("brave", "Brave", config / "BraveSoftware/Brave-Browser", chrome_extension_ids()),
        firefox_target(home / ".mozilla/native-messaging-hosts"),
    ]


def chromium_target(
    key: str,
    display_name: str,
    profile_root: Path,
    default_extension_ids: tuple[str, ...],
    windows_registry_key: str | None = None,
) -> BrowserTarget:
    return BrowserTarget(
        key=key,
        display_name=display_name,
        family="chromium",
        profile_root=profile_root,
        manifest_dir=profile_root / "NativeMessagingHosts",
        windows_registry_key=windows_registry_key,
        default_extension_ids=default_extension_ids,
    )


def firefox_target(
    manifest_dir: Path,
    windows_registry_key: str | None = None,
) -> BrowserTarget:
    return BrowserTarget(
        key="firefox",
        display_name="Firefox",
        family="firefox",
        profile_root=None,
        manifest_dir=manifest_dir,
        windows_registry_key=windows_registry_key,
        default_extension_ids=(FIREFOX_EXTENSION_ID,),
    )


def windows_manifest_dir(target: BrowserTarget) -> Path:
    base = Path(
        os.environ.get(
            "LOCALAPPDATA",
            str(Path.home() / "AppData/Local"),
        )
    )
    return base / PRODUCT_NAME / "NativeMessagingHosts" / target.key


def app_support_dir() -> Path:
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library/Application Support/local-compile-for-overleaf"
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", str(home / "AppData/Local"))) / PRODUCT_NAME
    return Path(os.environ.get("XDG_DATA_HOME", str(home / ".local/share"))) / "local-compile-for-overleaf"


def detect_extension_ids(target: BrowserTarget) -> list[str]:
    if target.family != "chromium" or target.profile_root is None:
        return []
    ids: list[str] = []
    for preferences in preference_files(target.profile_root):
        ids.extend(extension_ids_from_preferences(preferences))
    return list(dict.fromkeys(ids))


def preference_files(profile_root: Path) -> list[Path]:
    if not profile_root.exists():
        return []
    return sorted(
        path
        for path in profile_root.glob("*/Preferences")
        if path.is_file()
    )


def extension_ids_from_preferences(path: Path) -> list[str]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    settings = data.get("extensions", {}).get("settings", {})
    if not isinstance(settings, dict):
        return []
    ids: list[str] = []
    for extension_id, record in settings.items():
        if is_local_compile_extension_record(record):
            ids.append(str(extension_id))
    return ids


def is_local_compile_extension_record(record: Any) -> bool:
    if not isinstance(record, dict):
        return False
    manifest = record.get("manifest")
    if isinstance(manifest, dict):
        name = str(manifest.get("name", ""))
        description = str(manifest.get("description", ""))
        if name == PRODUCT_NAME or "compile Overleaf projects locally" in description:
            return True
    path = str(record.get("path", ""))
    return bool(re.search(r"(extension/dist|local-compile-for-overleaf)", path))


def env_extension_ids(name: str) -> tuple[str, ...]:
    configured = os.environ.get(name, "")
    values = [
        value.strip()
        for value in re.split(r"[,:\s]+", configured)
        if value.strip()
    ]
    return tuple(dict.fromkeys(values))


def chrome_extension_ids() -> tuple[str, ...]:
    return tuple(
        dict.fromkeys([*PUBLISHED_CHROME_EXTENSION_IDS, *env_extension_ids("LCFO_CHROME_EXTENSION_IDS")])
    )


def edge_extension_ids() -> tuple[str, ...]:
    return tuple(
        dict.fromkeys([*PUBLISHED_EDGE_EXTENSION_IDS, *env_extension_ids("LCFO_EDGE_EXTENSION_IDS")])
    )


def format_report(report: InstallReport) -> str:
    lines = [f"{PRODUCT_NAME} native host installer", ""]
    lines.append(f"Native host: {report.host_name}")
    if report.launcher:
        lines.append(f"Launcher: {report.launcher}")
    lines.append("")

    if report.installed:
        lines.append("Installed manifests:")
        for item in report.installed:
            source = "detected" if item.detected else "configured"
            lines.append(f"  {item.browser}: {item.path}")
            lines.append(f"    extensions ({source}): {', '.join(item.extension_ids)}")
    else:
        lines.append("Installed manifests: none")

    if report.skipped:
        lines.append("")
        lines.append("Skipped:")
        lines.extend(f"  {item}" for item in report.skipped)

    lines.append("")
    if report.latexmk_path:
        lines.append(f"TeX: latexmk found at {report.latexmk_path}")
    else:
        lines.append("TeX: latexmk not found")

    if report.warnings:
        lines.append("")
        lines.append("Warnings:")
        lines.extend(f"  {item}" for item in report.warnings)

    lines.append("")
    lines.append("Return to the browser and click Retry.")
    return "\n".join(lines)
