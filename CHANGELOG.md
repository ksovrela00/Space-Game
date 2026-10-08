# Changelog

All notable changes to Solar Trader are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/): a new feature bumps the minor
version (0.8.0), a fix or patch bumps the patch version (0.7.2).

Every pull request adds its lines to **Unreleased**. When a release is cut,
that section becomes the new version with its date, and its text becomes the
GitHub release notes.

## [Unreleased]

## [0.7.3] — 2026-10-08

### Added
- **Station halls.** Behind the docking slot a tunnel opens into a hall with
  its own 1 g gravity and air, and 6–10 landing pads — small ones and large
  ones for the Prometheus — on both sides of a central terminal. The port
  assigns a pad when you enter and holds it for you; its number and a marker
  are shown in the frame. Pads, their sizes and the rooms are generated per
  station, the same on the client and the server.
- The docking computer flies through the tunnel and lands on the assigned
  pad, and in port it lifts off and takes the ship out past the slot (C).
- **Walking on stations.** Leave the ship by the hatch stair or on the cargo
  platform down to the hall floor. Every pad has its own elevator lobby a
  short walk from the ship; an elevator takes you to the gallery on the
  terminal roof — a plaza with windows over both rows of pads, with port
  authority, hangar service, bar, medical bay and shops around it (10–20
  rooms per station). From the farthest pad to any room takes under half a
  minute.
- **Station elevator**: walk into the car, pick the stop at the panel with the
  mouse wheel, ↑/↓ or a digit (the pad number), press E. The panel lists all
  stops and marks your ship's pad; the doors close for the ride.
- Only the part of the station you can see is loaded and drawn: the lobby
  you are in, the gallery, or — from the hall — the lobbies and the gallery
  through their windows. From space no interiors are drawn at all.
- Station plan (M) with routes through the elevator and an on-screen marker
  to the next door or elevator; by default it selects the pad of your own
  ship.
- **Port storage and ship retrieval**, Star Citizen style: a bought ship goes
  to port storage; the hangar service console (E) calls a stored ship to a
  pad and lays a route to it, while from the pilot seat "Call and board" does
  the same and seats you in it.
- Realistic CC0 photogrammetry materials from Poly Haven for the hall and the
  terminal: hangar concrete, terrazzo, rubber tiles, herringbone parquet,
  wooden panels, concrete panels, plaster, leather and tread plate
  (`npm run stationtex`).
- Server schema 13: station pads and rooms (rooms already carry a future shop
  kind and a tenant), a ship's pad, pose on the hall floor and storage flag;
  new calls `station.request`, `station.layout` and `ship.retrieve`.

### Changed
- The port terminal no longer pops up when you dock: open it with I from the
  pilot seat; I or Esc closes it, Y stands up, C departs.
- Leaving port: hold Space for three seconds to lift off the pad and fly out
  through the tunnel yourself, or press C for the docking computer.
- The start screen button no longer launches the ship: the game starts in the
  seat of the ship standing on its pad.
- In port the hatch stair and the cargo platform reach down to the hall floor.
- A pilot walking on the floor of the station where their ship is docked
  counts as being in port: market, shipyard and the hangar console work.

### Fixed
- Upside-down entries into the slot no longer bump along the tunnel: the
  approach rolls the ship to the station's top, not to the nearest of two.
- Teleporting, towing and tests no longer leave a ship "inside" a station
  hall it has left; a ship far outside the station is let go at once.
- Docking again on your own pad was refused ("pad busy", HTTP 409) when a
  rover rode in your hold, and on login the ship could be moved off its pad:
  the rover counted as another ship holding the pad.
- Ships that were in port before station halls existed now show up in the
  hangar service as stored and can be called to a pad; "Board" from the seat
  calls them first instead of switching to a ship with no place in the hall.
- A pilot saved somewhere the station no longer has (inside a wall or the
  old terminal) is placed by the elevator in their ship's pad lobby.

## [0.7.2] — 2026-10-08

### Added
- The game version is shown in the ship terminal and on the start screen.
- Backspace clears the target — any target, a star system too.
- The target card (HUD and cockpit screen) shows a targeted star system:
  distance in light years, route, warp time and direction.
- "Target lost" message when a targeted pilot or NPC disappears.

### Changed
- **One target for everything.** A planet, moon, station, city, marker,
  pilot, NPC or another star system — picking a new target replaces the
  old one, and there can be no target at all.
- One jump key: J (and B, which is now the same key) jumps to whatever is
  targeted — warp to a star system, quantum drive to anything else.
- Galaxy map: selecting a system only shows it and the route; Tab, Enter or
  the card button makes it the target. Tab on the map toggles: on the
  current target it clears it.
- Map cards: "Clear target" replaces the dead "Target set" button.

### Fixed
- A star system picked on the galaxy map could never be un-targeted, and J
  kept warping there whatever was selected afterwards.
- B and J led to different places while a star system was selected.
- When a targeted pilot left, the target silently jumped to whatever came
  next in the list (and the guns followed it).

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

[Unreleased]: https://github.com/ksovrela00/Space-Game/compare/v0.7.2...HEAD
[0.7.2]: https://github.com/ksovrela00/Space-Game/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/ksovrela00/Space-Game/releases/tag/v0.7.1
