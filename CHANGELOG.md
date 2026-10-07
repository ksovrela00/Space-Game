# Changelog

All notable changes to Solar Trader are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/): a new feature bumps the minor
version (0.8.0), a fix or patch bumps the patch version (0.7.2).

Every pull request adds its lines to **Unreleased**. When a release is cut,
that section becomes the new version with its date, and its text becomes the
GitHub release notes.

## [Unreleased]

## [0.7.1] — 2026-10-08

First tagged release and the baseline for versioned development. It contains
everything built to date: Newtonian flight across a seven-system galaxy with
quantum and warp drives, docking and the docking computer, landing on airless
and atmospheric worlds (cities, landing pads, forests, oceans), the pilot on
foot inside the ship with airlocks and boarding ramps, the cargo-bay platform
and the rover, the second ship (Prometheus), shields and weapons, NPC traffic,
multiplayer through the PHP + MySQL server and the WebSocket hub, English and
Russian, and touch controls for phones.

### Added
- **Ship terminal (I)** — one window for your own affairs: ship (condition,
  fuel and range, performance, modules by group), hold (what you carry and
  what you paid), contracts (destination, cargo, penalty, deadline) and
  finances (the full ledger with time and balance after each entry). Opens in
  flight, landed and on foot; the world keeps running and the header shows
  your speed.
- **Port in the terminal** — station sections next to your own:
  - *Port* — pre-launch checks with buttons: fuel with reserve mark and range,
    refuel, hull repair, hold.
  - *Market* — goods list with price vs galactic average (▼/▲), plus a trade
    panel: buy or sell, quantity stepper and presets, total on the button, and
    the limiting factor in words (stock, hold space or credits).
  - *Outfitting* — slots by group and offers compared with the fitted module
    (old → new, better in green, worse in red), price with trade-in.
  - *Shipyard* — your ships in the dock, ships for sale and a rover for the
    hangar.
- Two-click confirmation for buying a ship or a rover and for selling a module.
- Keyboard: 1–9 for sections, Q/E to cycle them, ↑/↓ to pick goods or slots;
  I toggles between the port and your own sections.
- Touch "MENU" button, in the seat and on foot: the pilot menu was unreachable
  on phones before.
- **3D system and galaxy maps** — real lit planets, orbits that fade behind
  each body, ecliptic grid, object list, cards with actions (target, quantum
  jump, warp), double-click to fly to an object, touch gestures.
- Galaxy route planning: a system out of range is reached through neighbours,
  and the next hop is set automatically on arrival.

### Changed
- The station screen and the pilot menu are merged into the ship terminal:
  fixed window size, header and tabs no longer scroll away, Launch is always
  at the bottom.
- Refuel and repair moved to the first port section; "Outfitting" (modules)
  and "Shipyard" (ships) are named as in other space sims.
- Map controls: W/A/S/D pan the map, arrows pick objects; opening the galaxy
  no longer sets a warp target by itself.
- Enter no longer launches from a station (it is the key players press to
  confirm a purchase); Space still does.
- Help (H) and the map (M) also work in port.
- Body text no longer uses wide letter spacing.
- Rendering and CPU optimizations (tile keys, culling, audio, number
  formatting).

### Fixed
- The pilot menu stayed open over the crash screen and captured the keys.
- Every ledger entry showed the same time.
- Hull percentage was wrong for ships whose maximum hull is not 100
  (a healthy Prometheus showed 600 %).
- Pilot menu lists (hold, contracts, ledger) were cut off with no way to
  scroll.
- Speed showed "-0.00 km/s"; ship height was translated as "altitude".
- The station screen jumped in size between sections.
- Market: half the buttons were disabled without any explanation.
- The I key did nothing in port, on the ground or on foot.

[Unreleased]: https://github.com/ksovrela00/Space-Game/compare/v0.7.1...HEAD
[0.7.1]: https://github.com/ksovrela00/Space-Game/releases/tag/v0.7.1
