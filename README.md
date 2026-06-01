# Overleaf Local Compile

Chrome extension plus Native Messaging host for compiling an Overleaf project with a local TeX installation.

## Development

Extension:

```sh
npm install
npm run -w extension build
```

Native host:

```sh
pipx install -e ./native-host
overleaf-local-compile install-chrome-host --extension-id <extension-id>
```

The extension is currently intended to be loaded unpacked from `extension/dist`.

For this local Chrome install, the command is:

```sh
overleaf-local-compile install-chrome-host --extension-id ejalmpfkcbnhjdgmcddpapmchodhhcoa
```

## Debugging

After rebuilding the extension, reload it in `chrome://extensions` and refresh the Overleaf tab.

Useful inspection points:

- Overleaf page console: filter for `[OLLC]` to see shim/content-script activity.
- Extension service worker console: open the extension details page in `chrome://extensions`, click the service worker link, and filter for `[OLLC]`.
- Native host log: `~/Library/Logs/overleaf-local-compile/host.log` records host startup, Native Messaging `hello`, loopback server startup, and serialized exceptions.
- Overleaf raw logs: local compiles always publish an `output.log`. It includes the exact `latexmk` command, source/build directories, return code, stdout, and stderr.
- Local cache: source and build directories are under `~/Library/Caches/overleaf-local-compile`.

If you change native-host code after installing with `pipx`, reinstall it:

```sh
pipx install --force -e ./native-host
overleaf-local-compile install-chrome-host --extension-id ejalmpfkcbnhjdgmcddpapmchodhhcoa
```
