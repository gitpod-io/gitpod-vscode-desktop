# How to release

1. Edit version in [package.json](https://github.com/gitpod-io/gitpod-vscode-desktop/blob/master/package.json)
    - Update version of the extension - this is usually the minor version. **Until the marketplace supports semantic versioning, the minor version should always be an even number. Odd numbers are reserved for the pre-release version of the extension.**
    - Turn off experimental settings:
      - `gitpod.remote.useLocalApp: true`
      - `gitpod.remote.syncExtensions: false`
    - (If necessary) Update vscode engine version

2. If the minor version was increased, run the Nightly action to ensure a new pre-release version with the increased version number is released

3. Run the Release action.
