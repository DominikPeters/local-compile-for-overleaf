from __future__ import annotations

from pathlib import Path

import pytest

from overleaf_local_compile.server import (
    DRAFT_PREFIX,
    LocalCompileServer,
    decode_process_output,
    ensure_output_synctex,
    inject_draft_mode,
    normalize_synctex_file,
    parse_synctex_edit_output,
    parse_synctex_view_output,
    safe_join,
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
    assert output["url"].startswith("/ollc/test-token/project/project/build/build/output/")
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


def test_decode_process_output_tolerates_non_utf8_bytes() -> None:
    assert decode_process_output(b"before \xb9 after") == "before \ufffd after"


def test_inject_draft_mode_returns_original_content(tmp_path: Path) -> None:
    root = tmp_path / "main.tex"
    root.write_bytes(b"\\documentclass{article}")

    original = inject_draft_mode(root)

    assert original == b"\\documentclass{article}"
    assert root.read_bytes() == DRAFT_PREFIX + b"\\documentclass{article}"


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
