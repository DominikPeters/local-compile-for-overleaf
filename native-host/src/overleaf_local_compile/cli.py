from __future__ import annotations

import argparse
import sys

from .install import install_chrome_host
from .native import run_native_host


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or is_native_messaging_invocation(argv):
        run_native_host()
        return 0

    parser = argparse.ArgumentParser(prog="overleaf-local-compile")
    subparsers = parser.add_subparsers(dest="command")

    install = subparsers.add_parser("install-chrome-host")
    install.add_argument("--extension-id", required=True)
    install.add_argument("--host-path")

    args = parser.parse_args(argv)
    if args.command == "install-chrome-host":
        install_chrome_host(args.extension_id, args.host_path)
        return 0

    run_native_host()
    return 0


def is_native_messaging_invocation(argv: list[str]) -> bool:
    return bool(argv and argv[0].startswith("chrome-extension://"))
