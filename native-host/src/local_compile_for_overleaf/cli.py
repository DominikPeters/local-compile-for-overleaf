from __future__ import annotations

import argparse
import sys

from .install import FIREFOX_EXTENSION_ID, format_report, install_chrome_host, install_manifests
from .native import run_native_host


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if is_native_messaging_invocation(argv):
        run_native_host()
        return 0

    parser = argparse.ArgumentParser(prog="local-compile-for-overleaf")
    subparsers = parser.add_subparsers(dest="command")

    install = subparsers.add_parser("install")
    add_install_arguments(install)

    install = subparsers.add_parser("install-chrome-host")
    install.add_argument("--extension-id", required=True, action="append")
    install.add_argument("--host-path")

    doctor = subparsers.add_parser("doctor")
    add_install_arguments(doctor)

    args = parser.parse_args(argv)
    if args.command is None:
        report = install_manifests()
        print(format_report(report))
        return 0
    if args.command == "install":
        report = install_manifests(
            browsers=args.browser,
            extension_ids=args.extension_id,
            only_detected=args.only_detected,
            host_path=args.host_path,
        )
        print(format_report(report))
        return 0
    if args.command == "doctor":
        report = install_manifests(
            browsers=args.browser,
            extension_ids=args.extension_id,
            only_detected=args.only_detected,
            host_path=args.host_path,
        )
        print(format_report(report))
        return 0
    if args.command == "install-chrome-host":
        for extension_id in args.extension_id:
            install_chrome_host(extension_id, args.host_path)
        return 0

    parser.error(f"Unknown command: {args.command}")
    return 2


def add_install_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--browser",
        action="append",
        choices=["chrome", "chromium", "chrome-for-testing", "edge", "brave", "firefox"],
        help="Install only for this browser. Can be passed more than once.",
    )
    parser.add_argument(
        "--extension-id",
        action="append",
        help="Chrome-family extension ID to allow. For dev/unpacked installs.",
    )
    parser.add_argument(
        "--only-detected",
        action="store_true",
        help="Skip browser manifests unless the extension is detected in a profile.",
    )
    parser.add_argument("--host-path")


def is_native_messaging_invocation(argv: list[str]) -> bool:
    return bool(
        argv
        and (
            argv[0].startswith("chrome-extension://")
            or argv[0].startswith("moz-extension://")
            or (len(argv) >= 2 and argv[1] == FIREFOX_EXTENSION_ID)
        )
    )
