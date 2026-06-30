# Local Compile for Overleaf Native Host

This package provides the Native Messaging host for Local Compile for Overleaf. It starts a loopback HTTP server used by the browser extension and invokes local TeX tooling such as `latexmk`.

Install:

```sh
python3 -m pip install --user --upgrade local-compile-for-overleaf
python3 -m local_compile_for_overleaf
```

On Windows:

```powershell
py -3 -m pip install --user --upgrade local-compile-for-overleaf
py -3 -m local_compile_for_overleaf
```

The project is unofficial and is not affiliated with Overleaf.
