from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
import re
import secrets
import signal
import shutil
import subprocess
import threading
import time
import traceback
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlparse

DRAFT_PREFIX = (
    b"\\PassOptionsToPackage{draft}{graphicx}"
    b"\\PassOptionsToPackage{draft}{graphics}"
)
COMPILER_FLAGS = {
    "latex": "-pdfdvi",
    "lualatex": "-lualatex",
    "pdflatex": "-pdf",
    "xelatex": "-xelatex",
}
MAX_JSON_BODY_BYTES = int(os.getenv("LCFO_MAX_JSON_BODY_BYTES", str(128 * 1024 * 1024)))
MAX_SNAPSHOT_FILES = int(os.getenv("LCFO_MAX_SNAPSHOT_FILES", "20000"))
MAX_SNAPSHOT_FILE_BYTES = int(
    os.getenv("LCFO_MAX_SNAPSHOT_FILE_BYTES", str(64 * 1024 * 1024))
)
MAX_LATEXMK_FLAGS = int(os.getenv("LCFO_MAX_LATEXMK_FLAGS", "32"))
MAX_LATEXMK_FLAG_BYTES = int(os.getenv("LCFO_MAX_LATEXMK_FLAG_BYTES", "512"))
MAX_PROJECTS = int(os.getenv("LCFO_MAX_PROJECTS", "50"))
OUTPUT_TOKEN_TTL_SECONDS = int(os.getenv("LCFO_OUTPUT_TOKEN_TTL_SECONDS", str(60 * 60)))
STOP_GRACE_SECONDS = float(os.getenv("LCFO_STOP_GRACE_SECONDS", "2"))
GENERATED_FINAL_OUTPUTS = {
    "output.pdf",
    "output.log",
    "output.synctex.gz",
    "output.stdout",
    "output.stderr",
}


class LocalCompileServer:
    def __init__(self, allowed_origins: set[str] | None = None) -> None:
        self.token = secrets.token_urlsafe(32)
        self.cache_root = cache_root()
        self.allowed_api_origins = {
            normalize_origin(origin) for origin in (allowed_origins or set())
        }
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), self._handler_class())
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.process_lock = threading.Lock()
        self.compile_processes: dict[str, subprocess.Popen[bytes]] = {}
        self.output_token_lock = threading.Lock()
        self.output_tokens: dict[str, tuple[str, str, float]] = {}
        self.build_tokens: dict[tuple[str, str], str] = {}

    def start(self) -> None:
        self.cache_root.mkdir(parents=True, exist_ok=True)
        self.thread.start()

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()

    def capabilities(self) -> dict[str, bool]:
        return {
            "latexmk": find_executable("latexmk") is not None,
            "synctex": find_executable("synctex") is not None,
        }

    def _handler_class(self) -> type[BaseHTTPRequestHandler]:
        outer = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "OverleafLocalCompile/0.1"

            def do_OPTIONS(self) -> None:  # noqa: N802
                if not self._origin_allowed_for_route():
                    self._json({"error": "Origin not allowed"}, HTTPStatus.FORBIDDEN)
                    return
                self.send_response(HTTPStatus.NO_CONTENT)
                self._cors()
                self.end_headers()

            def do_PUT(self) -> None:  # noqa: N802
                self._method_not_allowed()

            def do_PATCH(self) -> None:  # noqa: N802
                self._method_not_allowed()

            def do_POST(self) -> None:  # noqa: N802
                try:
                    if not self._authorized_api():
                        self._json({"error": "Unauthorized"}, HTTPStatus.UNAUTHORIZED)
                        return
                    body = self._read_json()
                    route = self.path.split("?", 1)[0]
                    snapshot_match = re.fullmatch(r"/v1/projects/([^/]+)/snapshot", route)
                    compile_match = re.fullmatch(r"/v1/projects/([^/]+)/compile", route)
                    stop_match = re.fullmatch(r"/v1/projects/([^/]+)/compile/stop", route)
                    if snapshot_match:
                        project_id = unquote(snapshot_match.group(1))
                        outer.write_snapshot(project_id, body["snapshot"])
                        self._json({"ok": True})
                    elif compile_match:
                        project_id = unquote(compile_match.group(1))
                        self._json(outer.compile(project_id, body))
                    elif stop_match:
                        project_id = unquote(stop_match.group(1))
                        self._json(outer.stop_compile(project_id))
                    else:
                        self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
                except HTTPError as error:
                    self._json({"error": error.message}, error.status)
                except Exception as error:  # noqa: BLE001
                    outer.log_server_error("POST", self.path, error)
                    self._json({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)

            def do_DELETE(self) -> None:  # noqa: N802
                try:
                    if not self._authorized_api():
                        self._json({"error": "Unauthorized"}, HTTPStatus.UNAUTHORIZED)
                        return
                    route = self.path.split("?", 1)[0]
                    output_match = re.fullmatch(r"/v1/projects/([^/]+)/output", route)
                    if output_match:
                        project_id = unquote(output_match.group(1))
                        outer.clear_output(project_id)
                        self._json({"ok": True})
                    else:
                        self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
                except HTTPError as error:
                    self._json({"error": error.message}, error.status)
                except Exception as error:  # noqa: BLE001
                    outer.log_server_error("DELETE", self.path, error)
                    self._json({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)

            def do_GET(self) -> None:  # noqa: N802
                try:
                    parsed = urlparse(self.path)
                    route = parsed.path
                    output = self._match_output_route(route)
                    if output:
                        token, project_id, build_id, file_name = output
                        if not outer.output_token_matches(token, project_id, build_id):
                            self._json({"error": "Unauthorized"}, HTTPStatus.UNAUTHORIZED)
                            return
                        outer.serve_output_file(self, project_id, build_id, file_name)
                        return

                    if not self._authorized_api():
                        self._json({"error": "Unauthorized"}, HTTPStatus.UNAUTHORIZED)
                        return
                    sync = re.fullmatch(
                        r"/v1/projects/([^/]+)/builds/([^/]+)/sync/(code|pdf)", route
                    )
                    if sync:
                        project_id = unquote(sync.group(1))
                        build_id = unquote(sync.group(2))
                        direction = sync.group(3)
                        self._json(
                            outer.synctex(project_id, build_id, direction, parse_qs(parsed.query))
                        )
                    else:
                        self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
                except HTTPError as error:
                    self._json({"error": error.message}, error.status)
                except Exception as error:  # noqa: BLE001
                    outer.log_server_error("GET", self.path, error)
                    self._json({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)

            def log_message(self, fmt: str, *args: Any) -> None:
                return

            def _match_output_route(self, route: str) -> tuple[str, str, str, str] | None:
                match = re.fullmatch(
                    r"/lcfo/([^/]+)/project/([^/]+)/build/([^/]+)/output/(.+)", route
                )
                if not match:
                    return None
                return tuple(unquote(match.group(i)) for i in range(1, 5))  # type: ignore[return-value]

            def _authorized_api(self) -> bool:
                return secrets.compare_digest(
                    self.headers.get("Authorization", ""),
                    f"Bearer {outer.token}",
                )

            def _read_json(self) -> dict[str, Any]:
                length = int(self.headers.get("Content-Length", "0"))
                if length > MAX_JSON_BODY_BYTES:
                    raise HTTPError(
                        HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                        f"JSON request body exceeds {MAX_JSON_BODY_BYTES} bytes",
                    )
                raw = self.rfile.read(length)
                try:
                    text = raw.decode("utf-8")
                except UnicodeDecodeError:
                    text = raw.decode("utf-8", errors="surrogateescape")
                return json.loads(text or "{}")

            def _json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
                encoded = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self._cors()
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def _cors(self) -> None:
                origin = self.headers.get("Origin")
                allowed_origin = outer.allowed_cors_origin(
                    origin,
                    output_route=self._match_output_route(urlparse(self.path).path) is not None,
                )
                if allowed_origin:
                    self.send_header("Access-Control-Allow-Origin", allowed_origin)
                self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Authorization,Content-Type,Range")
                self.send_header("Access-Control-Expose-Headers", "Accept-Ranges,Content-Length,Content-Range")

            def _method_not_allowed(self) -> None:
                self._json({"error": "Method not allowed"}, HTTPStatus.METHOD_NOT_ALLOWED)

            def _origin_allowed_for_route(self) -> bool:
                origin = self.headers.get("Origin")
                if not origin:
                    return True
                return (
                    outer.allowed_cors_origin(
                        origin,
                        output_route=self._match_output_route(urlparse(self.path).path)
                        is not None,
                    )
                    is not None
                )

        return Handler

    def write_snapshot(self, project_id: str, snapshot: dict[str, Any]) -> None:
        source_dir = self.source_dir(project_id)
        work_dir = self.work_dir(project_id)
        source_dir.mkdir(parents=True, exist_ok=True)
        work_dir.mkdir(parents=True, exist_ok=True)
        previous_manifest = read_source_manifest(self.project_dir(project_id))
        written_paths: set[str] = set()
        files = snapshot.get("files", [])
        if not isinstance(files, list):
            raise ValueError("Snapshot files must be a list")
        if len(files) > MAX_SNAPSHOT_FILES:
            raise ValueError(f"Snapshot contains more than {MAX_SNAPSHOT_FILES} files")
        for file in files:
            try:
                path = str(file["path"])
                source_target = safe_join(source_dir, path)
                work_target = safe_join(work_dir, path)
                written_paths.add(PurePosixPath(path).as_posix())
                content = snapshot_file_content(file)
                write_if_changed(source_target, content)
                write_if_changed(work_target, content)
            except Exception as error:
                raise ValueError(
                    f"Failed to materialize snapshot file {file.get('path')!r} "
                    f"encoding={file.get('encoding')!r}: {error}"
                ) from error

        deleted_paths = set(snapshot.get("deletedFiles", []))
        if snapshot.get("full"):
            live_paths = written_paths
            current_source_paths = {
                path.relative_to(source_dir).as_posix()
                for path in source_dir.rglob("*")
                if path.is_file()
            }
            deleted_paths.update((previous_manifest | current_source_paths) - live_paths)
        else:
            live_paths = (previous_manifest - deleted_paths) | written_paths

        remove_snapshot_files(source_dir, deleted_paths)
        remove_snapshot_files(work_dir, deleted_paths)
        write_source_manifest(self.project_dir(project_id), live_paths)

    def log_server_error(self, method: str, path: str, error: Exception) -> None:
        log_event(
            "local server request error",
            {
                "method": method,
                "path": path,
                "error": str(error),
                "traceback": traceback.format_exc(),
            },
        )

    def clear_output(self, project_id: str) -> None:
        shutil.rmtree(self.project_dir(project_id) / "builds", ignore_errors=True)
        shutil.rmtree(self.work_dir(project_id), ignore_errors=True)
        sync_work_from_source(self.source_dir(project_id), self.work_dir(project_id), read_source_manifest(self.project_dir(project_id)))

    def compile(self, project_id: str, options: dict[str, Any]) -> dict[str, Any]:
        build_id = f"{int(time.time() * 1000):x}-{secrets.token_hex(8)}"
        work_dir = self.work_dir(project_id)
        source_manifest = read_source_manifest(self.project_dir(project_id))
        sync_work_from_source(self.source_dir(project_id), work_dir, source_manifest)
        build_dir = self.build_dir(project_id, build_id)
        build_dir.mkdir(parents=True, exist_ok=True)

        root = str(PurePosixPath(str(options.get("rootResourcePath") or "main.tex")))
        root_path = safe_join(work_dir, root)
        latexmk_path = find_executable("latexmk")
        compiler = str(options.get("compiler") or "pdflatex")
        command = build_latexmk_command(latexmk_path or "latexmk", work_dir, root_path, options)
        diagnostics = {
            "projectId": project_id,
            "buildId": build_id,
            "sourceDir": str(self.source_dir(project_id)),
            "workDir": str(work_dir),
            "buildDir": str(build_dir),
            "rootResourcePath": root,
            "command": command,
            "latexmkPath": latexmk_path,
            "compiler": compiler,
            "draft": bool(options.get("draft")),
            "stopOnFirstError": bool(options.get("stopOnFirstError")),
            "check": options.get("check"),
            "incrementalCompilesEnabled": options.get("incrementalCompilesEnabled"),
            "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        if latexmk_path is None:
            write_diagnostics_log(build_dir, diagnostics, "latexmk was not found.")
            self.prune_cache(project_id)
            return self.compile_response(project_id, build_id, "failure")

        restore_files: dict[Path, bytes | None] = {}
        try:
            if options.get("draft"):
                restore_files[root_path] = inject_draft_mode(root_path)
            wrapper_path = output_tex_wrapper_path(work_dir, root_path, source_manifest)
            if wrapper_path is not None:
                restore_files[wrapper_path] = (
                    wrapper_path.read_bytes() if wrapper_path.exists() else None
                )
                wrapper_path.write_bytes(root_path.read_bytes())
            remove_previous_final_outputs(work_dir)
            completed = self.run_compile_process(project_id, command, work_dir, timeout=600)
            diagnostics.update(
                {
                    "returnCode": completed.returncode,
                    "stdout": decode_process_output(completed.stdout),
                    "stderr": decode_process_output(completed.stderr),
                    "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
            )
        except subprocess.TimeoutExpired as error:
            diagnostics.update(
                {
                    "returnCode": None,
                    "stdout": decode_process_output(error.stdout),
                    "stderr": decode_process_output(error.stderr),
                    "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
            )
            write_diagnostics_log(build_dir, diagnostics, "latexmk timed out after 600 seconds.")
            self.prune_cache(project_id)
            return self.compile_response(project_id, build_id, "timedout")
        except CompileTerminated:
            diagnostics.update(
                {
                    "returnCode": None,
                    "stdout": "",
                    "stderr": "Compile terminated by user.",
                    "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
            )
            write_diagnostics_log(build_dir, diagnostics, "Compile terminated by user.")
            self.prune_cache(project_id)
            return self.compile_response(project_id, build_id, "terminated")
        finally:
            restore_temporary_files(restore_files)

        publish_build_outputs(work_dir, build_dir, source_manifest)
        status = "success" if (build_dir / "output.pdf").exists() else "failure"
        if status == "success":
            ensure_output_synctex(build_dir, root)
        ensure_output_log(build_dir, root, diagnostics, status)
        self.prune_cache(project_id)
        return self.compile_response(project_id, build_id, status)

    def run_compile_process(
        self, project_id: str, command: list[str], cwd: Path, timeout: int
    ) -> subprocess.CompletedProcess[bytes]:
        with self.process_lock:
            if project_id in self.compile_processes:
                raise RuntimeError("Compile is already running for this project")
            process = subprocess.Popen(
                command,
                cwd=cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                start_new_session=os.name == "posix",
            )
            self.compile_processes[project_id] = process

        try:
            stdout, stderr = process.communicate(timeout=timeout)
            return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
        except subprocess.TimeoutExpired as error:
            terminate_process_tree(process)
            stdout, stderr = process.communicate()
            error.stdout = stdout
            error.stderr = stderr
            raise error
        finally:
            with self.process_lock:
                self.compile_processes.pop(project_id, None)

    def stop_compile(self, project_id: str) -> dict[str, Any]:
        with self.process_lock:
            process = self.compile_processes.get(project_id)
        if process is None:
            return {"ok": True, "stopped": False}
        terminate_process_tree(process)
        return {"ok": True, "stopped": True}

    def compile_response(self, project_id: str, build_id: str, status: str) -> dict[str, Any]:
        build_dir = self.build_dir(project_id, build_id)
        self.output_token(project_id, build_id)
        files = []
        for path in sorted(p for p in build_dir.rglob("*") if p.is_file()):
            rel = path.relative_to(build_dir).as_posix()
            files.append(self.output_file(project_id, build_id, rel, path))
        return {
            "status": status,
            "outputFiles": files,
            "outputFilesArchive": None,
            "clsiCacheShard": "local",
            "stats": {},
            "timings": {},
        }

    def output_file(self, project_id: str, build_id: str, rel: str, path: Path) -> dict[str, Any]:
        url = f"/lcfo/{quote(self.output_token(project_id, build_id))}/project/{quote(project_id)}/build/{quote(build_id)}/output/{quote(rel)}"
        result: dict[str, Any] = {
            "path": rel,
            "url": url,
            "type": output_type(rel),
            "build": build_id,
            "downloadURL": url,
        }
        if rel == "output.pdf":
            content = path.read_bytes()
            result.update(
                {
                    "contentId": hashlib.sha1(content).hexdigest(),
                    "size": len(content),
                    "ranges": [],
                }
            )
        return result

    def serve_output_file(
        self, handler: BaseHTTPRequestHandler, project_id: str, build_id: str, file_name: str
    ) -> None:
        path = safe_join(self.build_dir(project_id, build_id), file_name)
        if not path.is_file():
            handler.send_response(HTTPStatus.NOT_FOUND)
            handler.end_headers()
            return
        content = path.read_bytes()
        start, end = parse_range(handler.headers.get("Range"), len(content))
        if start is not None and end is not None:
            body = content[start : end + 1]
            handler.send_response(HTTPStatus.PARTIAL_CONTENT)
            handler.send_header("Content-Range", f"bytes {start}-{end}/{len(content)}")
        else:
            body = content
            handler.send_response(HTTPStatus.OK)
        self.send_output_cors_headers(handler)
        handler.send_header("Accept-Ranges", "bytes")
        handler.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)

    def allowed_cors_origin(self, origin: str | None, output_route: bool = False) -> str | None:
        if not origin:
            return None
        normalized = normalize_origin(origin)
        if normalized in self.allowed_api_origins:
            return normalized
        if output_route and is_allowed_output_origin(normalized):
            return normalized
        return None

    def send_output_cors_headers(self, handler: BaseHTTPRequestHandler) -> None:
        allowed_origin = self.allowed_cors_origin(
            handler.headers.get("Origin"),
            output_route=True,
        )
        if allowed_origin:
            handler.send_header("Access-Control-Allow-Origin", allowed_origin)
        handler.send_header(
            "Access-Control-Expose-Headers",
            "Accept-Ranges,Content-Length,Content-Range",
        )

    def output_token(self, project_id: str, build_id: str) -> str:
        if not hasattr(self, "output_token_lock"):
            self.output_token_lock = threading.Lock()
            self.output_tokens = {}
            self.build_tokens = {}
        key = (project_id, build_id)
        now = time.time()
        with self.output_token_lock:
            token = self.build_tokens.get(key)
            if token:
                existing = self.output_tokens.get(token)
                if existing and existing[2] > now:
                    return token
            token = secrets.token_urlsafe(16)
            expires_at = now + OUTPUT_TOKEN_TTL_SECONDS
            self.build_tokens[key] = token
            self.output_tokens[token] = (project_id, build_id, expires_at)
            return token

    def output_token_matches(self, token: str, project_id: str, build_id: str) -> bool:
        if not hasattr(self, "output_token_lock"):
            return secrets.compare_digest(token, getattr(self, "token", ""))
        now = time.time()
        with self.output_token_lock:
            self.expire_output_tokens_locked(now)
            record = self.output_tokens.get(token)
            if not record:
                return False
            expected_project_id, expected_build_id, expires_at = record
            return (
                expires_at > now
                and secrets.compare_digest(expected_project_id, project_id)
                and secrets.compare_digest(expected_build_id, build_id)
            )

    def expire_output_tokens_locked(self, now: float | None = None) -> None:
        now = time.time() if now is None else now
        expired = [
            token
            for token, (_, _, expires_at) in self.output_tokens.items()
            if expires_at <= now
        ]
        for token in expired:
            project_id, build_id, _ = self.output_tokens.pop(token)
            self.build_tokens.pop((project_id, build_id), None)

    def prune_cache(self, project_id: str) -> None:
        pruned_builds = prune_old_builds(self.project_dir(project_id))
        self.drop_output_tokens(project_id, pruned_builds)
        prune_old_projects(self.cache_root, self.active_project_ids(), keep=MAX_PROJECTS)

    def drop_output_tokens(self, project_id: str, build_ids: set[str]) -> None:
        if not build_ids or not hasattr(self, "output_token_lock"):
            return
        with self.output_token_lock:
            for build_id in build_ids:
                token = self.build_tokens.pop((project_id, build_id), None)
                if token:
                    self.output_tokens.pop(token, None)

    def active_project_ids(self) -> set[str]:
        with self.process_lock:
            return set(self.compile_processes)

    def active_compile_count(self) -> int:
        with self.process_lock:
            return len(self.compile_processes)

    def synctex(
        self, project_id: str, build_id: str, direction: str, query: dict[str, list[str]]
    ) -> dict[str, Any]:
        synctex_path = find_executable("synctex")
        if synctex_path is None:
            return {"pdf": []} if direction == "code" else {"code": []}
        pdf = self.build_dir(project_id, build_id) / "output.pdf"
        if not pdf.exists():
            return {"pdf": []} if direction == "code" else {"code": []}
        if direction == "code":
            return self.synctex_code(project_id, pdf, query, synctex_path)
        return self.synctex_pdf(project_id, pdf, query, synctex_path)

    def synctex_code(
        self, project_id: str, pdf: Path, query: dict[str, list[str]], synctex_path: str
    ) -> dict[str, Any]:
        file_name = first(query, "file", "main.tex")
        line = first(query, "line", "1")
        column = first(query, "column", "1")
        source = safe_join(self.work_dir(project_id), file_name)
        completed = subprocess.run(
            [synctex_path, "view", "-i", f"{line}:{column}:{source}", "-o", str(pdf)],
            capture_output=True,
            check=False,
        )
        stdout = decode_process_output(completed.stdout)
        stderr = decode_process_output(completed.stderr)
        records = parse_synctex_view_output(stdout)
        self.log_synctex_result("code", completed.returncode, stdout, stderr, records)
        return {"pdf": records}

    def synctex_pdf(
        self, project_id: str, pdf: Path, query: dict[str, list[str]], synctex_path: str
    ) -> dict[str, Any]:
        page = first(query, "page", "1")
        h = first(query, "h", "0")
        v = first(query, "v", "0")
        completed = subprocess.run(
            [synctex_path, "edit", "-o", f"{page}:{h}:{v}:{pdf}"],
            capture_output=True,
            check=False,
        )
        stdout = decode_process_output(completed.stdout)
        stderr = decode_process_output(completed.stderr)
        records = parse_synctex_edit_output(stdout, self.work_dir(project_id))
        self.log_synctex_result("pdf", completed.returncode, stdout, stderr, records)
        return {"code": records}

    def log_synctex_result(
        self,
        direction: str,
        return_code: int,
        stdout: str,
        stderr: str,
        records: list[dict[str, Any]],
    ) -> None:
        if records and return_code == 0:
            return
        log_event(
            "synctex returned no usable records",
            {
                "direction": direction,
                "returnCode": return_code,
                "records": records,
                "stdout": stdout[-4000:],
                "stderr": stderr[-4000:],
            },
        )

    def project_dir(self, project_id: str) -> Path:
        return self.cache_root / safe_segment(project_id)

    def source_dir(self, project_id: str) -> Path:
        return self.project_dir(project_id) / "source"

    def work_dir(self, project_id: str) -> Path:
        return self.project_dir(project_id) / "work"

    def build_dir(self, project_id: str, build_id: str) -> Path:
        return self.project_dir(project_id) / "builds" / safe_segment(build_id)


class CompileTerminated(Exception):
    pass


class HTTPError(Exception):
    def __init__(self, status: HTTPStatus, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def cache_root() -> Path:
    if os.name == "posix" and Path.home().joinpath("Library").exists():
        return Path.home() / "Library/Caches/local-compile-for-overleaf"
    return Path(os.getenv("XDG_CACHE_HOME", Path.home() / ".cache")) / "local-compile-for-overleaf"


def source_manifest_path(project_dir: Path) -> Path:
    return project_dir / "source-manifest.json"


def read_source_manifest(project_dir: Path) -> set[str]:
    path = source_manifest_path(project_dir)
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return {str(item) for item in data}
    except Exception:
        return set()
    return set()


def write_source_manifest(project_dir: Path, paths: set[str]) -> None:
    project_dir.mkdir(parents=True, exist_ok=True)
    source_manifest_path(project_dir).write_text(
        json.dumps(sorted(paths), separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def write_if_changed(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.read_bytes() != content:
        path.write_bytes(content)


def snapshot_file_content(file: dict[str, Any]) -> bytes:
    encoding = file["encoding"]
    if encoding == "base64":
        content = base64.b64decode(str(file["content"]), validate=True)
    elif encoding == "utf8":
        content = str(file["content"]).encode("utf-8", errors="surrogateescape")
    else:
        raise ValueError(f"Unsupported file encoding: {encoding}")
    if len(content) > MAX_SNAPSHOT_FILE_BYTES:
        raise ValueError(
            f"Snapshot file exceeds {MAX_SNAPSHOT_FILE_BYTES} decoded bytes"
        )
    return content


def remove_snapshot_files(base_dir: Path, paths: set[str]) -> None:
    for rel in sorted(paths, reverse=True):
        try:
            path = safe_join(base_dir, rel)
        except ValueError:
            continue
        if path.is_file():
            path.unlink()
    remove_empty_dirs(base_dir)


def remove_empty_dirs(base_dir: Path) -> None:
    if not base_dir.exists():
        return
    for path in sorted((p for p in base_dir.rglob("*") if p.is_dir()), reverse=True):
        try:
            path.rmdir()
        except OSError:
            pass


def sync_work_from_source(source_dir: Path, work_dir: Path, manifest: set[str]) -> None:
    work_dir.mkdir(parents=True, exist_ok=True)
    for rel in manifest:
        source = safe_join(source_dir, rel)
        target = safe_join(work_dir, rel)
        if source.is_file():
            write_if_changed(target, source.read_bytes())
        elif target.exists():
            target.unlink()


def build_latexmk_command(
    latexmk_path: str,
    work_dir: Path,
    root_path: Path,
    options: dict[str, Any],
) -> list[str]:
    compiler = str(options.get("compiler") or "pdflatex")
    compiler_flag = COMPILER_FLAGS.get(compiler)
    if compiler_flag is None:
        raise ValueError(f"Unsupported compiler: {compiler}")

    command = [
        latexmk_path,
        "-cd",
        "-jobname=output",
        f"-auxdir={str(work_dir)}",
        f"-outdir={str(work_dir)}",
        "-synctex=1",
        "-interaction=batchmode",
        "-time",
        "-halt-on-error" if options.get("stopOnFirstError") else "-f",
        "-file-line-error",
    ]
    if options.get("enableShellEscape") or options.get("shellEscape"):
        command.append("-shell-escape")
    command.extend(validated_latexmk_flags(options.get("flags")))
    command.extend([compiler_flag, str(root_path)])
    return command


def validated_latexmk_flags(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("latexmk flags must be a list")
    if len(value) > MAX_LATEXMK_FLAGS:
        raise ValueError(f"latexmk flags exceed {MAX_LATEXMK_FLAGS} entries")
    flags: list[str] = []
    for flag in value:
        if not isinstance(flag, str):
            raise ValueError("latexmk flags must be strings")
        if not flag or "\x00" in flag or flag[:1] != "-":
            raise ValueError(f"Unsafe latexmk flag: {flag!r}")
        if len(flag.encode("utf-8")) > MAX_LATEXMK_FLAG_BYTES:
            raise ValueError(
                f"latexmk flag exceeds {MAX_LATEXMK_FLAG_BYTES} bytes"
            )
        flags.append(flag)
    return flags


def publish_build_outputs(work_dir: Path, build_dir: Path, source_manifest: set[str]) -> None:
    build_dir.mkdir(parents=True, exist_ok=True)
    for source in work_dir.rglob("*"):
        if not source.is_file():
            continue
        rel = source.relative_to(work_dir)
        if should_publish_output_file(rel, source_manifest):
            target = build_dir / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)


def remove_previous_final_outputs(work_dir: Path) -> None:
    for name in GENERATED_FINAL_OUTPUTS:
        path = work_dir / name
        if path.exists():
            path.unlink()


def should_publish_output_file(path: Path, source_manifest: set[str]) -> bool:
    if path.parts and path.parts[0] == ".lcfo":
        return False
    if path.as_posix() in GENERATED_FINAL_OUTPUTS:
        return True
    if path.as_posix() in source_manifest:
        return False
    suffixes = "".join(path.suffixes).lower()
    return bool(suffixes) and not suffixes.endswith(".tex")


def terminate_process_tree(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=STOP_GRACE_SECONDS)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
    except ProcessLookupError:
        return


def log_event(message: str, fields: dict[str, Any] | None = None) -> None:
    try:
        log_dir = Path.home() / "Library/Logs/local-compile-for-overleaf"
        log_dir.mkdir(parents=True, exist_ok=True)
        record = {
            "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "message": message,
            **(fields or {}),
        }
        with (log_dir / "host.log").open("a", encoding="utf-8") as log:
            log.write(json.dumps(record, default=str, sort_keys=True) + "\n")
    except Exception:
        pass


def find_executable(name: str) -> str | None:
    configured = os.getenv(f"LCFO_{name.upper()}_PATH")
    candidates = [
        configured,
        shutil.which(name),
        f"/Library/TeX/texbin/{name}",
        f"/usr/local/texlive/bin/universal-darwin/{name}",
        f"/opt/homebrew/bin/{name}",
        f"/usr/local/bin/{name}",
    ]
    for candidate in candidates:
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def decode_process_output(value: bytes | str | None) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return value.decode("utf-8", errors="replace")


def inject_draft_mode(root_path: Path) -> bytes:
    content = root_path.read_bytes()
    root_path.write_bytes(DRAFT_PREFIX + content)
    return content


def output_tex_wrapper_path(
    work_dir: Path, root_path: Path, source_manifest: set[str]
) -> Path | None:
    if "output.tex" in source_manifest:
        return None
    if not uses_output_tex_compat_package(root_path):
        return None
    return work_dir / "output.tex"


def uses_output_tex_compat_package(root_path: Path) -> bool:
    try:
        with root_path.open("r", encoding="utf-8", errors="replace") as root:
            content = root.read(65536)
    except OSError:
        return False
    return "\\tikzexternalize" in content or "{pstool}" in content


def restore_temporary_files(files: dict[Path, bytes | None]) -> None:
    for path, content in files.items():
        if content is None:
            path.unlink(missing_ok=True)
        else:
            path.write_bytes(content)


def safe_segment(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", value):
        return hashlib.sha1(value.encode("utf-8")).hexdigest()
    return value


def normalize_origin(origin: str) -> str:
    return origin.rstrip("/")


def is_allowed_output_origin(origin: str) -> bool:
    parsed = urlparse(origin)
    if parsed.scheme in {"chrome-extension", "moz-extension"}:
        return bool(parsed.netloc)
    host = parsed.hostname or ""
    if parsed.scheme == "https" and (
        host == "www.overleaf.com" or host.endswith(".overleaf.com")
    ):
        return True
    if parsed.scheme == "http" and host in {"127.0.0.1", "localhost"}:
        return True
    return False


def safe_join(base: Path, posix_path: str) -> Path:
    pure = PurePosixPath(posix_path)
    if pure.is_absolute() or ".." in pure.parts:
        raise ValueError(f"Unsafe path: {posix_path}")
    target = (base / Path(*pure.parts)).resolve()
    base_resolved = base.resolve()
    if target != base_resolved and base_resolved not in target.parents:
        raise ValueError(f"Unsafe path: {posix_path}")
    return target


def prune_old_builds(project_dir: Path, keep: int = 5) -> set[str]:
    builds_dir = project_dir / "builds"
    if not builds_dir.exists():
        return set()
    builds = sorted((p for p in builds_dir.iterdir() if p.is_dir()), key=lambda p: p.stat().st_mtime, reverse=True)
    removed: set[str] = set()
    for old in builds[keep:]:
        removed.add(old.name)
        shutil.rmtree(old, ignore_errors=True)
    return removed


def prune_old_projects(cache_root: Path, active_project_ids: set[str], keep: int = 50) -> set[str]:
    if keep <= 0 or not cache_root.exists():
        return set()
    projects = [
        path
        for path in cache_root.iterdir()
        if path.is_dir() and path.name not in active_project_ids
    ]
    projects.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    removed: set[str] = set()
    for old in projects[keep:]:
        removed.add(old.name)
        shutil.rmtree(old, ignore_errors=True)
    return removed


def output_type(path: str) -> str:
    ext = Path(path).suffix.lower()
    if ext == ".pdf":
        return "pdf"
    if ext in {".log", ".blg"}:
        return "log"
    return "output"


def parse_range(header: str | None, size: int) -> tuple[int | None, int | None]:
    if not header:
        return None, None
    match = re.fullmatch(r"bytes=(\d+)-(\d*)", header.strip())
    if not match:
        return None, None
    start = int(match.group(1))
    end = int(match.group(2)) if match.group(2) else size - 1
    if start >= size:
        return None, None
    return start, min(end, size - 1)


def ensure_output_log(
    build_dir: Path, root_resource_path: str, diagnostics: dict[str, Any], status: str
) -> None:
    diagnostics_text = format_diagnostics(diagnostics, status)
    output_log = build_dir / "output.log"
    if output_log.exists():
        output_log.write_text(
            output_log.read_text(encoding="utf-8", errors="replace")
            + "\n\n"
            + diagnostics_text,
            encoding="utf-8",
        )
        return

    root_stem = PurePosixPath(root_resource_path).stem
    candidates = [
        build_dir / f"{root_stem}.log",
        *sorted(build_dir.glob("*.log")),
    ]
    for candidate in candidates:
        if candidate.exists() and candidate != output_log:
            output_log.write_text(
                candidate.read_text(encoding="utf-8", errors="replace")
                + "\n\n"
                + diagnostics_text,
                encoding="utf-8",
            )
            return

    output_log.write_text(diagnostics_text, encoding="utf-8")


def ensure_output_synctex(build_dir: Path, root_resource_path: str) -> None:
    output_synctex = build_dir / "output.synctex.gz"
    if output_synctex.exists():
        return

    root_stem = PurePosixPath(root_resource_path).stem
    candidates = [
        build_dir / f"{root_stem}.synctex.gz",
        *sorted(build_dir.glob("*.synctex.gz")),
    ]
    for candidate in candidates:
        if candidate.exists() and candidate != output_synctex:
            shutil.copy2(candidate, output_synctex)
            return


def write_diagnostics_log(build_dir: Path, diagnostics: dict[str, Any], message: str) -> None:
    (build_dir / "output.log").write_text(
        f"{message}\n\n{format_diagnostics(diagnostics, 'failure')}",
        encoding="utf-8",
    )


def format_diagnostics(diagnostics: dict[str, Any], status: str) -> str:
    command = " ".join(diagnostics.get("command", []))
    parts = [
        "===== Local Compile for Overleaf diagnostics =====",
        f"status: {status}",
        f"projectId: {diagnostics.get('projectId')}",
        f"buildId: {diagnostics.get('buildId')}",
        f"sourceDir: {diagnostics.get('sourceDir')}",
        f"buildDir: {diagnostics.get('buildDir')}",
        f"rootResourcePath: {diagnostics.get('rootResourcePath')}",
        f"latexmkPath: {diagnostics.get('latexmkPath')}",
        f"command: {command}",
        f"returnCode: {diagnostics.get('returnCode')}",
        f"startedAt: {diagnostics.get('startedAt')}",
        f"finishedAt: {diagnostics.get('finishedAt')}",
        "",
        "----- latexmk stdout -----",
        diagnostics.get("stdout") or "",
        "",
        "----- latexmk stderr -----",
        diagnostics.get("stderr") or "",
        "",
    ]
    return "\n".join(parts)


def first(query: dict[str, list[str]], key: str, default: str) -> str:
    return query.get(key, [default])[0]


def parse_synctex_view_output(output: str) -> list[dict[str, Any]]:
    return parse_synctex_records(
        output,
        {
            "Page": ("page", int),
            "h": ("h", float),
            "v": ("v", float),
            "W": ("width", float),
            "H": ("height", float),
        },
    )


def parse_synctex_edit_output(output: str, source_dir: Path) -> list[dict[str, Any]]:
    records = []
    for record in parse_synctex_records(
        output,
        {
            "Input": ("file", str),
            "Line": ("line", int),
            "Column": ("column", int),
        },
    ):
        if "file" in record:
            record["file"] = normalize_synctex_file(str(record["file"]), source_dir)
        records.append(record)
    return records


def parse_synctex_records(
    output: str, labels: dict[str, tuple[str, Any]]
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for line in output.splitlines():
        label, value = split_synctex_line(line)
        if label == "Output":
            current = {}
            records.append(current)
            continue
        if current is None or label not in labels:
            continue
        prop, converter = labels[label]
        try:
            current[prop] = converter(value)
        except ValueError:
            pass
    return records


def split_synctex_line(line: str) -> tuple[str, str]:
    if ":" not in line:
        return "", line
    label, value = line.split(":", 1)
    return label.strip(), value.strip()


def normalize_synctex_file(file_name: str, source_dir: Path) -> str:
    path = Path(file_name)
    if path.is_absolute():
        try:
            return path.resolve().relative_to(source_dir.resolve()).as_posix()
        except ValueError:
            return path.name
    return PurePosixPath(file_name).as_posix().removeprefix("./")
