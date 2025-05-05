# Project Brief

*This file is the foundation document that shapes all other Memory Bank files. It defines the core requirements and goals of the project and serves as the source of truth for the project scope.*

## Core Requirements

- Provide VS Code integration for connecting to Gitpod Classic workspaces.
- Manage authentication with the Gitpod service using VS Code's Authentication API.
- Facilitate SSH connections to workspaces using either a local proxy mechanism or a direct SSH gateway.
- Integrate seamlessly with VS Code's Remote Development features, specifically Remote - SSH (`ms-vscode-remote.remote-ssh`).
- Provide UI elements (Activity Bar view, commands, status bar indicators) for managing Gitpod workspaces (listing, connecting, stopping, etc.).
- Handle URI schemes for initiating connections.
- Configure local SSH settings (`~/.ssh/config`) to support the local proxy connection method.
- Ensure a companion extension (`gitpod.gitpod-remote-ssh`) is installed in the remote workspace.

## Project Goals

- **Primary Goal:** Enable VS Code Desktop users to connect to and work within Gitpod Classic workspaces reliably and efficiently.
- **Connection Strategy:** Implement two primary SSH connection methods:
    1.  **Local SSH Proxy (Preferred/Experimental):** Configure the local SSH client (`~/.ssh/config`) to use a proxy script (`proxy.js` via `proxylauncher.sh/bat`). This script communicates via IPC with the main extension (`ExtensionServiceServer`) to obtain authentication details (including a temporary SSH key generated via the Supervisor API) and likely establishes a WebSocket tunnel for the SSH connection.
    2.  **SSH Gateway (Fallback):** Connect directly to Gitpod's SSH gateway using standard SSH keys registered in the user's Gitpod account (verified via API) or a temporary `ownerToken` obtained via API as a password if no suitable key is found.
- **Integration:** Leverage VS Code's native Remote - SSH extension (`ms-vscode-remote.remote-ssh`) for the final connection step, providing it with the necessary configuration (SSH destination, host platform settings).
- **Authentication:** Use VS Code's built-in Authentication API to manage Gitpod credentials securely.
- **User Experience:** Provide clear feedback during connection attempts, handle errors gracefully, and offer relevant commands and views for workspace management.

## Scope

### In Scope

- Authentication with Gitpod (via VS Code Auth Provider).
- Listing, starting, stopping, and deleting Gitpod Classic workspaces via API calls.
- Implementing both Local SSH Proxy and SSH Gateway connection methods.
- Configuring the user's local SSH client settings (`~/.ssh/config`) for the Local Proxy method.
- Integrating with `ms-vscode-remote.remote-ssh` to initiate connections.
- Providing UI elements (Activity Bar, Commands, Status Bar).
- Handling `vscode://gitpod.gitpod-desktop/...` URIs.
- Basic telemetry and logging.
- Ensuring the `gitpod.gitpod-remote-ssh` companion extension is installed remotely.
- Managing SSH host keys in `known_hosts`.

### Out of Scope

- Managing the VS Code Server binary installation/update within the Gitpod workspace (assumed handled by Gitpod infrastructure).
- Direct integration with Gitpod Flex (extension detects and disables itself in Flex environments).
- Features beyond connecting to and managing Classic workspaces (e.g., creating new workspaces from VS Code).
- Deep file synchronization or complex remote environment management beyond SSH connection.
