# Agent Documentation

This directory contains agent-related documentation and rules for the Orbit Desktop App project.

## Structure
- `agent.md` - Main agent documentation
- `rules.md` - Rules and guidelines for agents working on this project
- `changelog-skill.md` - Automatic changelog workflow for "Write to the changelog"
- `../lib/` - Shared logic and injectable services covered by tests
- `../tests/` - unit, integration, and Playwright Electron tests
- `../.github/workflows/ci.yml` - Test-gated build and release pipeline

## Project Overview
Orbit Desktop App is an Electron-based dashboard application with:
- Frameless window with custom titlebar
- Shortcut buttons for opening URLs and local apps (YouTube, GitHub, Cloudflare, Vercel, and the Links tab)
- Sentry integration for error tracking
- IPC bridge between renderer and main process

## Common Tasks
- Building the Windows portable EXE with `npm run build:win`
- Modifying `main.cjs` for main process logic
- Modifying `index.html` for renderer UI
- Modifying `preload.cjs` for IPC bridging
- When making fixes, bump the version in `package.json` and rebuild the EXE