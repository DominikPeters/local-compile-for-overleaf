from __future__ import annotations

import json
import signal
import subprocess
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from local_compile_for_overleaf import server as server_module
from local_compile_for_overleaf.server import (
    DRAFT_PREFIX,
    LocalCompileServer,
    build_latexmk_command,
    decode_process_output,
    ensure_output_synctex,
    inject_draft_mode,
    is_allowed_output_origin,
    normalize_synctex_file,
    output_tex_wrapper_path,
    parse_synctex_edit_output,
    parse_synctex_view_output,
    prune_old_builds,
    prune_old_projects,
    restore_temporary_files,
    safe_join,
    should_publish_output_file,
    terminate_process_tree,
    uses_output_tex_compat_package,
)


def test_safe_join_rejects_parent_traversal(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        safe_join(tmp_path, "../secret.tex")


def test_safe_join_accepts_nested_project_file(tmp_path: Path) -> None:
    assert safe_join(tmp_path, "chapters/intro.tex") == tmp_path / "chapters" / "intro.tex"


def test_output_file_uses_tokenized_viewer_path(tmp_path: Path) -> None:
    server = LocalCompileServer.__new__(LocalCompileServer)
    server.token = "test-token"
    server.cache_root = tmp_path
    build_dir = server.build_dir("project", "build")
    build_dir.mkdir(parents=True)
    pdf = build_dir / "output.pdf"
    pdf.write_bytes(b"%PDF-1.7\n")

    output = server.output_file("project", "build", "output.pdf", pdf)

    assert output["path"] == "output.pdf"
    assert not output["url"].startswith("/lcfo/test-token/")
    token = output["url"].split("/")[2]
    assert server.output_token_matches(token, "project", "build")
    assert output["size"] == len(b"%PDF-1.7\n")
    assert output["ranges"] == []


def test_write_snapshot_preserves_surrogateescaped_text(tmp_path: Path) -> None:
    server = LocalCompileServer.__new__(LocalCompileServer)
    server.cache_root = tmp_path

    server.write_snapshot(
        "project",
        {
            "files": [
                {
                    "path": "main.tex",
                    "encoding": "utf8",
                    "content": b"before \xb9 after".decode(
                        "utf-8", errors="surrogateescape"
                    ),
                }
            ]
        },
    )

    assert (server.source_dir("project") / "main.tex").read_bytes() == b"before \xb9 after"


def test_write_snapshot_materializes_binary_resources_from_base64(tmp_path: Path) -> None:
    server = LocalCompileServer.__new__(LocalCompileServer)
    server.cache_root = tmp_path

    server.write_snapshot(
        "project",
        {
            "full": True,
            "files": [
                {"path": "figures/plot.png", "encoding": "base64", "content": "iVBORw=="},
            ],
            "deletedFiles": [],
        },
    )

    assert (server.source_dir("project") / "figures/plot.png").read_bytes() == b"\x89PNG"
    assert (server.work_dir("project") / "figures/plot.png").read_bytes() == b"\x89PNG"


def test_write_snapshot_rejects_invalid_base64(tmp_path: Path) -> None:
    server = LocalCompileServer.__new__(LocalCompileServer)
    server.cache_root = tmp_path

    with pytest.raises(ValueError, match="Failed to materialize"):
        server.write_snapshot(
            "project",
            {
                "files": [
                    {"path": "bad.bin", "encoding": "base64", "content": "not base64!"}
                ],
            },
        )


def test_write_snapshot_caps_file_count_and_decoded_file_size(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    server = LocalCompileServer.__new__(LocalCompileServer)
    server.cache_root = tmp_path
    monkeypatch.setattr(server_module, "MAX_SNAPSHOT_FILES", 1)
    monkeypatch.setattr(server_module, "MAX_SNAPSHOT_FILE_BYTES", 3)

    with pytest.raises(ValueError, match="more than 1 files"):
        server.write_snapshot(
            "project",
            {
                "files": [
                    {"path": "a.tex", "encoding": "utf8", "content": "a"},
                    {"path": "b.tex", "encoding": "utf8", "content": "b"},
                ],
            },
        )

    with pytest.raises(ValueError, match="exceeds 3 decoded bytes"):
        server.write_snapshot(
            "project",
            {
                "files": [
                    {"path": "large.tex", "encoding": "utf8", "content": "abcd"},
                ],
            },
        )


def test_write_snapshot_patches_existing_source_tree(tmp_path: Path) -> None:
    server = LocalCompileServer.__new__(LocalCompileServer)
    server.cache_root = tmp_path
    source_dir = server.source_dir("project")
    source_dir.mkdir(parents=True)
    unchanged = source_dir / "unchanged.tex"
    stale = source_dir / "stale.tex"
    unchanged.write_text("same", encoding="utf-8")
    stale.write_text("delete me", encoding="utf-8")
    original_mtime = unchanged.stat().st_mtime_ns

    server.write_snapshot(
        "project",
        {
            "full": True,
            "files": [
                {"path": "unchanged.tex", "encoding": "utf8", "content": "same"},
                {"path": "nested/changed.tex", "encoding": "utf8", "content": "new"},
            ]
        },
    )

    assert unchanged.read_text(encoding="utf-8") == "same"
    assert unchanged.stat().st_mtime_ns == original_mtime
    assert not stale.exists()
    assert (source_dir / "nested/changed.tex").read_text(encoding="utf-8") == "new"


def test_write_snapshot_tracks_relative_paths_when_cache_root_is_symlinked(
    tmp_path: Path,
) -> None:
    real_cache = tmp_path / "real-cache"
    symlinked_cache = tmp_path / "symlinked-cache"
    real_cache.mkdir()
    symlinked_cache.symlink_to(real_cache, target_is_directory=True)
    server = LocalCompileServer.__new__(LocalCompileServer)
    server.cache_root = symlinked_cache

    server.write_snapshot(
        "project",
        {
            "full": True,
            "files": [
                {"path": "main.tex", "encoding": "utf8", "content": "source"},
            ],
            "deletedFiles": [],
        },
    )

    manifest = json.loads(
        (server.project_dir("project") / "source-manifest.json").read_text(
            encoding="utf-8"
        )
    )
    assert manifest == ["main.tex"]


def test_decode_process_output_tolerates_non_utf8_bytes() -> None:
    assert decode_process_output(b"before \xb9 after") == "before \ufffd after"


def test_inject_draft_mode_returns_original_content(tmp_path: Path) -> None:
    root = tmp_path / "main.tex"
    root.write_bytes(b"\\documentclass{article}")

    original = inject_draft_mode(root)

    assert original == b"\\documentclass{article}"
    assert root.read_bytes() == DRAFT_PREFIX + b"\\documentclass{article}"


def test_output_tex_wrapper_is_only_used_for_tikz_or_pstool_roots(tmp_path: Path) -> None:
    root = tmp_path / "main.tex"
    root.write_text("\\documentclass{article}", encoding="utf-8")

    assert output_tex_wrapper_path(tmp_path, root, set()) is None

    root.write_text("\\documentclass{article}\n\\tikzexternalize", encoding="utf-8")
    assert output_tex_wrapper_path(tmp_path, root, set()) == tmp_path / "output.tex"

    root.write_text("\\documentclass{article}\n\\usepackage{pstool}", encoding="utf-8")
    assert output_tex_wrapper_path(tmp_path, root, set()) == tmp_path / "output.tex"


def test_output_tex_wrapper_respects_project_output_tex_resource(tmp_path: Path) -> None:
    root = tmp_path / "main.tex"
    root.write_text("\\tikzexternalize", encoding="utf-8")

    assert output_tex_wrapper_path(tmp_path, root, {"output.tex"}) is None


def test_uses_output_tex_compat_package_reads_only_root_prefix(tmp_path: Path) -> None:
    root = tmp_path / "main.tex"
    root.write_text("a" * 70000 + "\\tikzexternalize", encoding="utf-8")

    assert not uses_output_tex_compat_package(root)


def test_restore_temporary_files_restores_or_deletes_files(tmp_path: Path) -> None:
    existing = tmp_path / "existing.tex"
    generated = tmp_path / "generated.tex"
    existing.write_bytes(b"old")
    generated.write_bytes(b"temporary")

    restore_temporary_files({existing: b"restored", generated: None})

    assert existing.read_bytes() == b"restored"
    assert not generated.exists()


def test_build_latexmk_command_maps_supported_compilers(tmp_path: Path) -> None:
    root = tmp_path / "main.tex"
    expected = {
        "pdflatex": "-pdf",
        "xelatex": "-xelatex",
        "lualatex": "-lualatex",
        "latex": "-pdfdvi",
    }

    for compiler, flag in expected.items():
        command = build_latexmk_command(
            "/usr/bin/latexmk",
            tmp_path,
            root,
            {"compiler": compiler},
        )
        assert command[0] == "/usr/bin/latexmk"
        assert flag in command
        assert command[-1] == str(root)


def test_build_latexmk_command_rejects_unknown_compiler(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Unsupported compiler"):
        build_latexmk_command(
            "latexmk",
            tmp_path,
            tmp_path / "main.tex",
            {"compiler": "context"},
        )


def test_build_latexmk_command_maps_shell_escape_for_externalization(tmp_path: Path) -> None:
    command = build_latexmk_command(
        "latexmk",
        tmp_path,
        tmp_path / "main.tex",
        {"compiler": "pdflatex", "enableShellEscape": True},
    )

    assert "-shell-escape" in command


def test_build_latexmk_command_appends_validated_overleaf_flags(tmp_path: Path) -> None:
    command = build_latexmk_command(
        "latexmk",
        tmp_path,
        tmp_path / "main.tex",
        {"compiler": "pdflatex", "flags": ["-shell-escape", "-recorder"]},
    )

    assert command[-4:] == [
        "-shell-escape",
        "-recorder",
        "-pdf",
        str(tmp_path / "main.tex"),
    ]


@pytest.mark.parametrize("flags", [["other.tex"], ["-ok", ""], ["-ok", "\x00"], "-pdf"])
def test_build_latexmk_command_rejects_unsafe_overleaf_flags(
    tmp_path: Path,
    flags: object,
) -> None:
    with pytest.raises(ValueError, match="latexmk flags|Unsafe latexmk flag"):
        build_latexmk_command(
            "latexmk",
            tmp_path,
            tmp_path / "main.tex",
            {"compiler": "pdflatex", "flags": flags},
        )


def test_clear_output_removes_builds_but_keeps_source(tmp_path: Path) -> None:
    server = LocalCompileServer.__new__(LocalCompileServer)
    server.cache_root = tmp_path
    server.write_snapshot(
        "project",
        {
            "full": True,
            "files": [
                {"path": "main.tex", "encoding": "utf8", "content": "source"},
            ],
            "deletedFiles": [],
        },
    )
    server.build_dir("project", "build").mkdir(parents=True)
    (server.build_dir("project", "build") / "main.aux").write_text("aux", encoding="utf-8")
    (server.work_dir("project") / "main.aux").write_text("aux", encoding="utf-8")

    server.clear_output("project")

    assert (server.source_dir("project") / "main.tex").exists()
    assert (server.work_dir("project") / "main.tex").exists()
    assert not (server.work_dir("project") / "main.aux").exists()
    assert not (server.project_dir("project") / "builds").exists()


def test_generated_final_output_is_published_even_if_source_has_same_name() -> None:
    assert should_publish_output_file(Path("output.pdf"), {"output.pdf"})
    assert should_publish_output_file(Path("output.log"), {"output.log"})


def test_bibliography_index_glossary_and_tikz_outputs_are_published() -> None:
    source_manifest = {"main.tex", "figures/source.pdf"}

    for name in [
        "output.bbl",
        "output.blg",
        "output.idx",
        "output.ind",
        "output.glo",
        "output.gls",
        "output.ist",
        "output.fls",
        "output.fdb_latexmk",
        "tikz-cache/figure0.pdf",
    ]:
        assert should_publish_output_file(Path(name), source_manifest)

    assert not should_publish_output_file(Path("figures/source.pdf"), source_manifest)


def test_write_snapshot_incrementally_updates_work_without_deleting_aux(tmp_path: Path) -> None:
    server = LocalCompileServer.__new__(LocalCompileServer)
    server.cache_root = tmp_path
    server.write_snapshot(
        "project",
        {
            "full": True,
            "files": [
                {"path": "main.tex", "encoding": "utf8", "content": "old"},
                {"path": "old.tex", "encoding": "utf8", "content": "delete"},
            ],
            "deletedFiles": [],
        },
    )
    (server.work_dir("project") / "main.aux").write_text("aux", encoding="utf-8")

    server.write_snapshot(
        "project",
        {
            "full": False,
            "files": [
                {"path": "main.tex", "encoding": "utf8", "content": "new"},
            ],
            "deletedFiles": ["old.tex"],
        },
    )

    assert (server.source_dir("project") / "main.tex").read_text(encoding="utf-8") == "new"
    assert (server.work_dir("project") / "main.tex").read_text(encoding="utf-8") == "new"
    assert not (server.source_dir("project") / "old.tex").exists()
    assert not (server.work_dir("project") / "old.tex").exists()
    assert (server.work_dir("project") / "main.aux").read_text(encoding="utf-8") == "aux"


def test_run_compile_process_rejects_overlapping_compiles(tmp_path: Path) -> None:
    server = LocalCompileServer.__new__(LocalCompileServer)
    server.process_lock = threading.Lock()
    server.compile_processes = {"project": object()}

    with pytest.raises(RuntimeError, match="already running"):
        server.run_compile_process("project", ["latexmk"], tmp_path, timeout=1)


def test_terminate_process_tree_escalates_to_sigkill(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    class FakeProcess:
        pid = 12345

        def poll(self) -> None:
            return None

        def wait(self, timeout: float) -> None:
            raise subprocess.TimeoutExpired("fake", timeout)

    monkeypatch.setattr(server_module.os, "name", "posix")
    monkeypatch.setattr(server_module.os, "killpg", lambda _pid, sig: calls.append(sig))

    terminate_process_tree(FakeProcess())  # type: ignore[arg-type]

    assert calls == [signal.SIGTERM, signal.SIGKILL]


def test_prune_old_builds_removes_only_oldest_builds(tmp_path: Path) -> None:
    builds_dir = tmp_path / "builds"
    builds_dir.mkdir()
    for index in range(4):
        build = builds_dir / f"build-{index}"
        build.mkdir()
        (build / "output.log").write_text(str(index), encoding="utf-8")
        timestamp = 1_700_000_000 + index
        server_module.os.utime(build, (timestamp, timestamp))

    removed = prune_old_builds(tmp_path, keep=2)

    assert removed == {"build-0", "build-1"}
    assert sorted(path.name for path in builds_dir.iterdir()) == ["build-2", "build-3"]


def test_prune_old_projects_keeps_active_projects(tmp_path: Path) -> None:
    for index in range(4):
        project = tmp_path / f"project-{index}"
        project.mkdir()
        timestamp = 1_700_000_000 + index
        server_module.os.utime(project, (timestamp, timestamp))

    removed = prune_old_projects(tmp_path, active_project_ids={"project-0"}, keep=2)

    assert removed == {"project-1"}
    assert sorted(path.name for path in tmp_path.iterdir()) == [
        "project-0",
        "project-2",
        "project-3",
    ]


def test_ensure_output_synctex_copies_root_sidecar(tmp_path: Path) -> None:
    (tmp_path / "main.synctex.gz").write_bytes(b"synctex")

    ensure_output_synctex(tmp_path, "main.tex")

    assert (tmp_path / "output.synctex.gz").read_bytes() == b"synctex"


def test_parse_synctex_view_output_uses_one_based_page_and_dimensions() -> None:
    output = """This is SyncTeX command line utility
SyncTeX result begin
Output:/tmp/output.pdf
Page:2
h:133.768356
v:663.928223
W:343.711060
H:9.962640
SyncTeX result end
"""

    assert parse_synctex_view_output(output) == [
        {
            "page": 2,
            "h": 133.768356,
            "v": 663.928223,
            "width": 343.71106,
            "height": 9.96264,
        }
    ]


def test_parse_synctex_view_output_does_not_fabricate_defaults() -> None:
    assert parse_synctex_view_output("This computer is on strike!") == []


def test_parse_synctex_edit_output_normalizes_absolute_source_path(tmp_path: Path) -> None:
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    output = f"""This is SyncTeX command line utility
SyncTeX result begin
Output:{tmp_path}/build/output.pdf
Input:{source_dir}/chapters/intro.tex
Line:17
Column:-1
Offset:0
SyncTeX result end
"""

    assert parse_synctex_edit_output(output, source_dir) == [
        {"file": "chapters/intro.tex", "line": 17, "column": -1}
    ]


def test_normalize_synctex_file_removes_relative_dot_prefix(tmp_path: Path) -> None:
    assert normalize_synctex_file("./main.tex", tmp_path) == "main.tex"


def test_localhost_server_enforces_auth_rejects_methods_and_caps_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(server_module, "MAX_JSON_BODY_BYTES", 2)
    try:
        server = LocalCompileServer(
            allowed_origins={"chrome-extension://allowed-extension"}
        )
    except PermissionError as error:
        pytest.skip(f"local socket binding blocked by sandbox: {error}")
    server.start()
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.port}/v1/projects/project/snapshot",
            headers={"Origin": "chrome-extension://evil-extension"},
            method="OPTIONS",
        )
        with pytest.raises(urllib.error.HTTPError) as disallowed_origin:
            urllib.request.urlopen(request)
        assert disallowed_origin.value.code == 403

        request = urllib.request.Request(
            f"http://127.0.0.1:{server.port}/v1/projects/project/snapshot",
            headers={"Origin": "chrome-extension://allowed-extension"},
            method="OPTIONS",
        )
        with urllib.request.urlopen(request) as preflight:
            assert preflight.status == 204
            assert (
                preflight.headers["Access-Control-Allow-Origin"]
                == "chrome-extension://allowed-extension"
            )

        with pytest.raises(urllib.error.HTTPError) as unauthorized:
            urllib.request.urlopen(
                f"http://127.0.0.1:{server.port}/v1/projects/project/snapshot",
                data=b"{}",
            )
        assert unauthorized.value.code == 401

        request = urllib.request.Request(
            f"http://127.0.0.1:{server.port}/v1/projects/project/snapshot",
            data=b"{}",
            method="PUT",
        )
        with pytest.raises(urllib.error.HTTPError) as method_not_allowed:
            urllib.request.urlopen(request)
        assert method_not_allowed.value.code == 405

        request = urllib.request.Request(
            f"http://127.0.0.1:{server.port}/v1/projects/project/snapshot",
            data=b'{"too":"large"}',
            headers={"Authorization": f"Bearer {server.token}"},
            method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as too_large:
            urllib.request.urlopen(request)
        assert too_large.value.code == 413

        request = urllib.request.Request(
            f"http://127.0.0.1:{server.port}/v1/projects/project/unknown",
            data=b"{}",
            headers={"Authorization": f"Bearer {server.token}"},
            method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as not_found:
            urllib.request.urlopen(request)
        assert not_found.value.code == 404
    finally:
        server.stop()


def test_cors_allows_configured_extension_api_origin() -> None:
    server = LocalCompileServer.__new__(LocalCompileServer)
    server.allowed_api_origins = {"chrome-extension://abcdefghijklmnop"}

    assert (
        server.allowed_cors_origin("chrome-extension://abcdefghijklmnop/")
        == "chrome-extension://abcdefghijklmnop"
    )
    assert server.allowed_cors_origin("chrome-extension://ponmlkjihgfedcba") is None


def test_output_cors_allows_overleaf_and_local_viewer_origins() -> None:
    assert is_allowed_output_origin("https://www.overleaf.com")
    assert is_allowed_output_origin("https://foo.overleaf.com")
    assert is_allowed_output_origin("moz-extension://12345678-1234-1234-1234-123456789abc")
    assert is_allowed_output_origin("http://127.0.0.1:3000")
    assert is_allowed_output_origin("http://localhost:3000")
    assert not is_allowed_output_origin("https://evil.example")
