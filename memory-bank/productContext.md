# Product Context

*This file describes why this project exists, the problems it solves, how it should work, and the user experience goals.*

## Problem Statement

- Gitpod Classic users need a way to connect their local VS Code Desktop application to their remote Gitpod workspaces.
- Standard SSH connections might be blocked by firewalls or require complex setup (key management, host configuration).
- Users need a streamlined way to authenticate with Gitpod and manage their workspace connections directly within VS Code.

## Target Audience

- Developers using Gitpod Classic who prefer using their local VS Code Desktop installation over the web-based IDE (Gitpod Theia or VS Code in Browser).
- Users in environments where direct SSH access (port 22) might be restricted.

## How it Works

1.  **Authentication:** The extension integrates with VS Code's Authentication API, allowing users to sign into their Gitpod account.
2.  **Workspace Discovery:** It uses the Gitpod Public API to fetch a list of the user's workspaces.
3.  **UI Integration:** Presents workspaces in a dedicated Activity Bar view and provides commands for actions like connecting, stopping, and deleting.
4.  **Connection Initiation:** When a user chooses to connect:
    *   The extension determines the connection method (Local SSH Proxy or SSH Gateway).
    *   **Local Proxy:** It ensures the local SSH client is configured with a `ProxyCommand` pointing to a helper script (`proxy.js`). This script communicates via IPC with the extension to get authentication details (including a temporary SSH key from the Supervisor API) and likely establishes a WebSocket tunnel.
    *   **SSH Gateway:** It fetches necessary details (host keys, owner token) and checks for user-provided SSH keys registered with Gitpod. If no key exists, it prompts the user with the temporary owner token to use as a password.
    *   It verifies host keys and adds them to `known_hosts`.
5.  **Hand-off to Remote-SSH:** The extension constructs a `vscode-remote://ssh-remote+...` URI and uses the `vscode.openFolder` command to delegate the actual SSH connection and remote session management to the built-in `ms-vscode-remote.remote-ssh` extension.
6.  **Remote Setup:** Ensures a companion extension (`gitpod.gitpod-remote-ssh`) is installed in the remote environment.

## User Experience Goals

- **Seamless Integration:** Feel like a natural part of VS Code's remote development workflow.
- **Simplified Connection:** Abstract away the complexities of SSH configuration and authentication where possible.
- **Reliability:** Provide robust connection methods that work in various network environments.
- **Clear Feedback:** Inform the user about connection status, errors, and necessary actions (e.g., installing Remote-SSH, handling passwords).
- **Convenient Management:** Allow users to manage their workspaces (view status, connect, stop) without leaving VS Code.
