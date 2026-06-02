from __future__ import annotations

import base64
import binascii
import shutil
import struct
import threading
import zlib
from pathlib import Path
from typing import Any

import pytest

from overleaf_local_compile.server import LocalCompileServer, find_executable

pytestmark = pytest.mark.tex


def test_pdflatex_project_compiles_with_binary_image_resource(tmp_path: Path) -> None:
    require_tex_program("pdflatex")
    require_tex_file("graphicx.sty")
    server = make_server(tmp_path)
    write_project(
        server,
        [
            tex_file(
                "main.tex",
                r"""
\documentclass{article}
\usepackage{graphicx}
\begin{document}
Image resource:
\includegraphics[width=1cm]{figures/pixel.png}
\end{document}
""",
            ),
            {
                "path": "figures/pixel.png",
                "encoding": "base64",
                "content": tiny_png_base64(),
            },
        ],
    )

    response = compile_success(server, {"compiler": "pdflatex"})

    assert_output(response, "output.pdf")
    assert (server.work_dir("project") / "figures/pixel.png").read_bytes().startswith(
        b"\x89PNG"
    )


@pytest.mark.parametrize(
    ("compiler", "program"),
    [
        ("pdflatex", "pdflatex"),
        ("xelatex", "xelatex"),
        ("lualatex", "lualatex"),
        ("latex", "latex"),
    ],
)
def test_supported_compilers_produce_pdf(
    tmp_path: Path, compiler: str, program: str
) -> None:
    require_tex_program(program)
    server = make_server(tmp_path)
    write_project(
        server,
        [
            tex_file(
                "main.tex",
                r"""
\documentclass{article}
\begin{document}
Compiler smoke test.
\end{document}
""",
            )
        ],
    )

    response = compile_success(server, {"compiler": compiler})

    assert_output(response, "output.pdf")
    assert_output(response, "output.log")


def test_bibliography_flow_runs_bibtex_and_publishes_outputs(tmp_path: Path) -> None:
    require_tex_program("bibtex")
    server = make_server(tmp_path)
    write_project(
        server,
        [
            tex_file(
                "main.tex",
                r"""
\documentclass{article}
\begin{document}
A citation~\cite{knuth1984}.
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
""",
            ),
            tex_file(
                "refs.bib",
                r"""
@book{knuth1984,
  author = {Donald E. Knuth},
  title = {The TeXbook},
  year = {1984},
  publisher = {Addison-Wesley}
}
""",
            ),
        ],
    )

    response = compile_success(server, {"compiler": "pdflatex"})

    assert_output(response, "output.pdf")
    assert_output(response, "output.bbl")
    assert_output(response, "output.blg")


def test_index_flow_runs_makeindex_and_publishes_outputs(tmp_path: Path) -> None:
    require_tex_program("makeindex")
    server = make_server(tmp_path)
    write_project(
        server,
        [
            tex_file(
                "main.tex",
                r"""
\documentclass{article}
\usepackage{makeidx}
\makeindex
\begin{document}
Alpha\index{alpha} and beta\index{beta}.
\printindex
\end{document}
""",
            )
        ],
    )

    response = compile_success(server, {"compiler": "pdflatex"})

    assert_output(response, "output.pdf")
    assert_output(response, "output.idx")
    assert_output(response, "output.ind")
    assert_output(response, "output.ilg")


def test_glossaries_flow_runs_makeindex_via_latexmkrc(tmp_path: Path) -> None:
    require_tex_file("glossaries.sty")
    require_tex_program("makeindex")
    server = make_server(tmp_path)
    write_project(
        server,
        [
            tex_file(
                "main.tex",
                r"""
\documentclass{article}
\usepackage[nonumberlist]{glossaries}
\makeglossaries
\newglossaryentry{sample}{name={sample},description={a sample entry}}
\begin{document}
Using a \gls{sample}.
\printglossaries
\end{document}
""",
            ),
            tex_file(
                ".latexmkrc",
                r"""
add_cus_dep('glo', 'gls', 0, 'makeglo2gls');
sub makeglo2gls {
  my ($base) = @_;
  return system "makeindex -s \"$base.ist\" -t \"$base.glg\" -o \"$base.gls\" \"$base.glo\"";
}
""",
            ),
        ],
    )

    response = compile_success(server, {"compiler": "pdflatex"})

    assert_output(response, "output.pdf")
    assert_output(response, "output.glo")
    assert_output(response, "output.gls")
    assert_output(response, "output.glg")


def test_tikz_externalization_publishes_externalized_outputs(tmp_path: Path) -> None:
    require_tex_file("tikz.sty")
    server = make_server(tmp_path)
    write_project(
        server,
        [
            tex_file(
                "main.tex",
                r"""
\documentclass{article}
\usepackage{tikz}
\usetikzlibrary{external}
\tikzexternalize[prefix=tikz-cache/]
\begin{document}
\begin{tikzpicture}
  \draw[blue, thick] (0,0) -- (1,1);
\end{tikzpicture}
\end{document}
""",
            ),
            tex_file("tikz-cache/.keep", ""),
        ],
    )

    response = compile_success(
        server,
        {"compiler": "pdflatex", "enableShellEscape": True},
    )

    assert_output(response, "output.pdf")
    assert any(
        file["path"].startswith("tikz-cache/") and file["path"].endswith(".pdf")
        for file in response["outputFiles"]
    )


def test_pstool_flow_publishes_generated_pdf_when_available(tmp_path: Path) -> None:
    require_tex_file("pstool.sty")
    require_tex_program("latex")
    require_tex_program("dvips")
    require_tex_program("ps2pdf")
    server = make_server(tmp_path)
    write_project(
        server,
        [
            tex_file(
                "main.tex",
                r"""
\documentclass{article}
\usepackage{pstool}
\begin{document}
\pstool[width=1cm]{figure.eps}{}
\end{document}
""",
            ),
            tex_file(
                "figure.eps",
                r"""
%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 20 20
newpath 0 0 moveto 20 20 lineto stroke
showpage
""",
            ),
        ],
    )

    response = compile_success(
        server,
        {"compiler": "pdflatex", "enableShellEscape": True},
    )

    assert_output(response, "output.pdf")
    assert any(
        file["path"].endswith(".pdf") and file["path"] != "output.pdf"
        for file in response["outputFiles"]
    )


def test_generated_output_pdf_wins_over_same_named_source_file(tmp_path: Path) -> None:
    server = make_server(tmp_path)
    write_project(
        server,
        [
            tex_file(
                "main.tex",
                r"""
\documentclass{article}
\begin{document}
The generated output PDF should be served, not the source output.pdf.
\end{document}
""",
            ),
            {
                "path": "output.pdf",
                "encoding": "base64",
                "content": base64.b64encode(b"not a generated pdf").decode("ascii"),
            },
        ],
    )

    response = compile_success(server, {"compiler": "pdflatex"})

    output = assert_output(response, "output.pdf")
    assert output["size"] != len(b"not a generated pdf")
    assert (server.build_dir("project", output["build"]) / "output.pdf").read_bytes().startswith(
        b"%PDF"
    )


def make_server(tmp_path: Path) -> LocalCompileServer:
    require_tex_program("latexmk")
    server = LocalCompileServer.__new__(LocalCompileServer)
    server.token = "session-token"
    server.cache_root = tmp_path
    server.process_lock = threading.Lock()
    server.compile_processes = {}
    server.output_token_lock = threading.Lock()
    server.output_tokens = {}
    server.build_tokens = {}
    return server


def write_project(server: LocalCompileServer, files: list[dict[str, Any]]) -> None:
    server.write_snapshot(
        "project",
        {
            "projectId": "project",
            "version": 1,
            "full": True,
            "files": files,
            "deletedFiles": [],
        },
    )


def tex_file(path: str, content: str) -> dict[str, str]:
    return {
        "path": path,
        "encoding": "utf8",
        "content": content.strip() + "\n",
    }


def compile_success(server: LocalCompileServer, options: dict[str, Any]) -> dict[str, Any]:
    response = server.compile(
        "project",
        {
            "rootResourcePath": "main.tex",
            **options,
        },
    )
    if response["status"] != "success":
        pytest.fail(compile_failure_message(server, response))
    return response


def compile_failure_message(server: LocalCompileServer, response: dict[str, Any]) -> str:
    logs = [
        file
        for file in response.get("outputFiles", [])
        if file.get("path") == "output.log"
    ]
    if not logs:
        return f"compile failed without output.log: {response}"
    log_file = server.build_dir("project", logs[0]["build"]) / "output.log"
    return log_file.read_text(encoding="utf-8", errors="replace")[-6000:]


def assert_output(response: dict[str, Any], path: str) -> dict[str, Any]:
    for file in response["outputFiles"]:
        if file["path"] == path:
            return file
    paths = [file["path"] for file in response["outputFiles"]]
    raise AssertionError(f"missing output {path}; got {paths}")


def require_tex_program(name: str) -> None:
    if find_executable(name) is None and shutil.which(name) is None:
        pytest.skip(f"{name} is not installed")


def require_tex_file(name: str) -> None:
    kpsewhich = shutil.which("kpsewhich")
    if kpsewhich is None:
        pytest.skip("kpsewhich is not installed")
    result = shutil.which("kpsewhich")
    if result is None:
        pytest.skip("kpsewhich is not installed")
    import subprocess

    completed = subprocess.run(
        [kpsewhich, name],
        capture_output=True,
        check=False,
        text=True,
    )
    if completed.returncode != 0 or not completed.stdout.strip():
        pytest.skip(f"{name} is not installed")


def tiny_png_base64() -> str:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\xff"))
        + chunk(b"IEND", b"")
    )
    return base64.b64encode(png).decode("ascii")
