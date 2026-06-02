# Third-Party Notices

This project is licensed under the GNU Affero General Public License version 3.

## Overleaf Editor Core

The directory `extension/src/vendor/overleaf-editor-core` contains a vendored runtime-only snapshot of Overleaf's `overleaf-editor-core` library from the Overleaf Community Edition source tree:

- Upstream project: https://github.com/overleaf/overleaf
- Upstream path: `libraries/overleaf-editor-core`
- Upstream license: GNU Affero General Public License version 3

The snapshot is included so browser extension builds are reproducible without requiring a separate local checkout of Overleaf Community Edition. Upstream tests, package metadata, and TypeScript-only helper files are not included because the extension only bundles the runtime JavaScript library.
