# Network Tab — Console Redesign

Date: 2026-11-03

## Intent

The Network tab works but looks heavy: seven equal cards in a three-column grid. Replace that grid with one compact telemetry panel ("Console") that keeps every value while giving the page a clear status-first hierarchy and a distinctly different look.

## Goals

- One console panel instead of seven cards.
- Online/offline, latency, and public IP readable at a glance.
- All current values stay: adapter, local IPv4, IPv6, MAC address, DNS servers, public IP.
- Reuse the existing refresh action, disclosure text, status line, palette, and typography.
- Fit the fixed 980×560 window without page scrolling.

## Non-goals

- No new network data, history, polling, IPC, settings, or dependencies.
- No changes to `main.cjs`, `preload.cjs`, `lib/network-service.cjs`, or the shared logic.
- No new pages or navigation changes.
- UI copy stays English.

## Chosen Approach

Variant C "Console" from the visual comparison:

- Section heading: "Network overview" with the existing round refresh button.
- Keep the disclosure line about local details and the ipify.org lookup.
- One rounded panel:
  - Header: status dot with `Online`/`Offline`, monospace latency, and the refresh affordance stays in the section heading only.
  - Rows: Adapter, Local IPv4, IPv6, MAC address, DNS servers, Public IP. Label left, monospace value right, thin separators.
  - Footer: existing status line ("Updated HH:MM · Local network details only") and error text.
- Offline/error states keep the existing red styling and "Unavailable" values.

## Alternatives Considered

- **A — Status First:** large hero status with a two-column detail grid. Clear, but visually close to today's card rhythm.
- **B — Bento:** four grouped cards. More rhythm than today, but still card-heavy and less simple.
- **C — Console:** chosen for the strongest hierarchy, smallest visual footprint, and the most distinct change.

## Decisions Made

- Keep the existing element IDs used by the E2E test (`network-connection`, `network-ip`, `network-adapter`, `network-mac`, `network-dns`, `network-public-ip`, `network-ipv6`, `network-latency`, `network-status`) so behavior and tests stay stable.
- Public IP appears only once, in its row; the header shows latency only. This avoids duplicating the address shown in the mockup.
- The refresh button lives in the section heading only, not also in the panel header.
- Remove the per-card icon set and the two explanatory detail lines; the disclosure line remains.
- Keep the existing loading and error behavior in `loadNetworkOverview()`; only update the elements it writes to.

## Builder Notes

- Replace `.network-grid` / `.network-card*` styles with `.network-console*` styles in `index.html`.
- Keep the panel within the existing content width and height budget; verify at 360px minimum width.
- Keep `aria-live` on the panel body or status line.
- Add/extend E2E coverage for the console layout and rendering before implementation.
