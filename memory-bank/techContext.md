# Tech Context

*This file details the technologies used, development setup, technical constraints, dependencies, and tool usage patterns.*

## Technologies Used

- **Language:** TypeScript
- **Runtime:** Node.js (for the extension host process and helper scripts like `proxy.js`)
- **Frameworks/Libraries:**
    - VS Code API (`vscode`)
    - `ssh2`, `ssh-config`, `@microsoft/dev-tunnels-ssh*`: For SSH connection handling, configuration parsing, and potentially tunneling.
    - `nice-grpc`, `@connectrpc/connect`, `@connectrpc/connect-node`: For gRPC/ConnectRPC based IPC communication between the extension and the `proxy.js` script.
    - `@gitpod/public-api`, `@gitpod/supervisor-api-grpcweb`: Gitpod API clients.
    - `node-fetch-commonjs`: Polyfill for `fetch` API used by gRPC-web clients in Node.js.
    - `ws`: WebSocket client, likely used for the proxied connection tunnel.
    - `@vscode/proxy-agent`: For handling network proxies.
    - `configcat-node`: For feature flagging.
    - `@segment/analytics-node`: For telemetry.
    - `protobufjs`, `ts-proto`, `@bufbuild/buf`: For Protocol Buffer definition and code generation (used for IPC).
- **Build Tools:**
    - `webpack`: For bundling the extension and proxy script.
    - `tsc`: TypeScript compiler.
    - `eslint`: Linter.
    - `mocha`: Testing framework.
    - `@vscode/vsce`: VS Code Extension packager.

## Development Setup

1.  **Prerequisites:** Node.js, Yarn (implied by `yarn.lock`).
2.  **Install Dependencies:** Run `yarn install`.
3.  **Compile:**
    *   Extension: `yarn compile-ext` (or `yarn watch-ext` for continuous compilation).
    *   Proxy Script: `yarn compile-proxy` (or `yarn watch-proxy`).
4.  **Run/Debug:** Use VS Code's built-in "Run and Debug" panel (likely configured in `.vscode/launch.json`, although this file wasn't listed).
5.  **Lint:** `yarn lint`.
6.  **Test:** `yarn test`.
7.  **Protocol Buffers:** If modifying `.proto` files, run `yarn proto-gen` (requires `buf` CLI).
8.  **Packaging:** `yarn package`.

## Technical Constraints

- **VS Code Version:** Requires VS Code `^1.82.0` or higher (`engines.vscode` in `package.json`).
- **Platform:** Primarily targets desktop environments (Windows, macOS, Linux) where VS Code Desktop runs. Includes platform-specific launcher scripts (`proxylauncher.bat`, `proxylauncher.sh`).
- **SSH Client:** The Local SSH Proxy method relies on the user having a functional native SSH client installed and configured (`~/.ssh/config`).
- **Network:** Connection success depends on network accessibility to Gitpod APIs, the SSH Gateway, or WebSocket endpoints. The local proxy method aims to mitigate direct SSH port blocking.
- **Companion Extension:** Requires `gitpod.gitpod-remote-ssh` to be installable in the remote environment.

## Dependencies

- **VS Code APIs:** Core dependency for all UI, authentication, configuration, and remote development integration.
- **Gitpod Public API:** Used for fetching workspace lists, workspace status, user SSH keys, and owner tokens. Accessed via generated gRPC clients.
- **Gitpod Supervisor API:** Used via the local proxy's IPC call (`ExtensionServiceServer`) to generate temporary SSH key pairs within the workspace (`createSSHKeyPair`). Accessed via generated gRPC-web clients.
- **`ms-vscode-remote.remote-ssh` Extension:** Essential dependency for handling the final SSH connection and remote session. The extension prepares the parameters and hands off the connection URI to it.
- **`gitpod.gitpod-remote-ssh` Extension:** Companion extension required on the remote side. Functionality unknown from this codebase alone, but likely handles post-connection setup or remote-specific features.
- **Local SSH Client & Configuration:** External dependency for the Local SSH Proxy method.

## Tool Usage Patterns

- **Build:** `webpack` bundles the main extension (`out/extension.js`) and the proxy script (`out/local-ssh/proxy.js`).
- **Compilation:** `tsc` compiles TypeScript source files.
- **Linting:** `eslint` enforces code style.
- **Testing:** `mocha` runs unit/integration tests.
- **Packaging:** `vsce package` creates the `.vsix` file for distribution.
- **Protocol Buffers:** `buf lint` and `buf generate` are used to manage and generate code from `.proto` definitions for the IPC layer.
- **Scripts:** Node.js scripts in `scripts/` handle release preparation (`prepare-release-build.js`, `prepare-nightly-build.js`).
