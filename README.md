# Local Compile for Overleaf

Unofficial Chrome extension plus Native Messaging host for compiling an Overleaf project with a local TeX installation.

## License

Local Compile for Overleaf is licensed under the GNU Affero General Public License version 3. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.

## Development

Extension:

```sh
npm install
npm run -w extension build
```

Native host:

```sh
python3 -m pip install --user --upgrade ./native-host
python3 -m local_compile_for_overleaf
```

For the Chrome Web Store extension, the host installer already knows the published extension ID:

```sh
python3 -m pip install --user --upgrade local-compile-for-overleaf
python3 -m local_compile_for_overleaf
```

Published Chrome extension ID: `nmdbichdffibgheeggobljjipcangmdf`.

For an unpacked development Chrome install, pass the unpacked extension ID:

```sh
python3 -m local_compile_for_overleaf install --browser chrome --extension-id <unpacked-extension-id>
```

## Debugging

After rebuilding the extension, reload it in `chrome://extensions` and refresh the Overleaf tab.

Useful inspection points:

- Overleaf page console: filter for `[LCFO]` to see shim/content-script activity.
- Extension service worker console: open the extension details page in `chrome://extensions`, click the service worker link, and filter for `[LCFO]`.
- Native host log: `~/Library/Logs/local-compile-for-overleaf/host.log` records host startup, Native Messaging `hello`, loopback server startup, and serialized exceptions.
- Overleaf raw logs: local compiles always publish an `output.log`. It includes the exact `latexmk` command, source/build directories, return code, stdout, and stderr.
- Local cache: source and build directories are under `~/Library/Caches/local-compile-for-overleaf`.

If you change native-host code after installing with pip, reinstall it:

```sh
python3 -m pip install --user --upgrade ./native-host
python3 -m local_compile_for_overleaf
```
