# Project Brief

*This file is the foundation document that shapes all other Memory Bank files. It defines the core requirements and goals of the project and serves as the source of truth for the project scope.*

## Core Requirements

- [ ] Requirement 1
- [ ] Requirement 2
- [ ] ...

## Project Goals

- A VS Code Extension for users of Gitpod Classic
- The extension prioritizes establishing a local SSH connection and then proxies SSH traffic over a websocket to Gitpod's ws-proxy component via HTTPS (TCP/443), and the supervisor process in the target workspace. If the websocket connection cannot be established, or the configuration prefers, SSH traffic is instead done over the SSH gateway component via TCP/22.

## Scope

### In Scope

- Feature A
- Feature B

### Out of Scope

- Feature X
- Feature Y
