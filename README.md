# MechForce: Heavy Metal Combat

A modern, crossplay remake of **MechForce** (v3.79, 1989), the Amiga shareware mech combat game by Ralph H. Reed.
Turn-based hex tactics with console-style 3D graphics, full controller support, and one shared rules engine on every platform.

| Platform | Build | Controls |
|---|---|---|
| Windows | `MechForce-…-Windows-Setup.exe` / `…-Portable.exe` | Xbox/PS pads, keyboard + mouse |
| Steam Deck / Linux | `MechForce-…-Linux-SteamDeck.AppImage` | Deck controls, touchscreen |
| Android | `MechForce-Android.apk` | Touch, Bluetooth/USB controllers |
| Browser | served by any host, or `MechForce-Browser.html` | Gamepad API, keyboard + mouse, touch |

Downloads are on the [Releases](../../releases) page. Every push builds all four in GitHub Actions.

## What came from the original disk

`tools/extract_adf.py` reads the original ADF; `tools/convert_data.py` decodes it:

- **146 mech designs** (Light, Medium, Heavy, Assault, including the original's oddballs like the 215-ton BlueBird): 11-zone armour, internal structure, 8×12 critical slot tables, weapon records with Motorola FFP floats, heat sinks, jump jets.
- **17 weapon types** in the original order, using each mech's own stored heat/damage/range values: Autocannon/2–20, Machine Gun, LRM 5–20 and SRM 2–6 racks, Small/Medium/Large Laser, Flamer, Plasma Cannon.
- **All mission orders** with both sides' briefings, word for word: Search & Destroy, Crossing, Hold Position (500 seconds), Find the DataPack, Recover the Memory Cell, Escort the Pepsi, Destroy the Spy, Scouting Run.
- **The six digitised sounds** (Laser, Cannon, MachineGun, Rocket, Flamer, Crunch), selectable in Settings → Weapon sounds → Original Amiga.

## Mech Lab

Design custom mechs (title screen → Mech Lab, or the ★ Custom tab in the Mech Bay): tonnage 20–100, engine speed, jump jets, heat sinks, armour and up to 16 of the 17 weapon types, with a live tonnage budget, critical-slot map and 3D model. Designs are stored on the device and travel with your lance; the host rebuilds and validates every custom mech (`src/core/custom.js`), so tampered designs are rejected.

## Rules in brief

Initiative each round; sides alternate activating one mech at a time. Walk / run / jump with facing and terrain costs (woods, rough, water, elevation). 2d6 to-hit with range, movement, cover, heat and damage modifiers. Hit locations by attack direction (front, sides, rear armour), damage transfer, critical hits from the real crit tables (ammo explosions, engine, gyro, actuators, cockpit, sensors, heat sinks, jump jets), heat with shutdown and ammo cook-off, falls, pilot injuries and consciousness rolls, punches and kicks. Each round is 50 seconds, as in the original's "500 seconds".

## Up to four players

Every mission supports 2–4 forces, each a player (local hotseat or online) or the computer. Objective missions are played as two teams (2v2, 2v1 or 3v1 — move forces between teams in the lobby); Search & Destroy can be a free-for-all or two teams. Teammates deploy together, can't damage each other and win together.

## Crossplay

All platforms run the same engine and talk the same JSON protocol over WebSocket, so any mix can play together.

- **Home network:** on Windows or Steam Deck choose **Host LAN Game**. Other desktop apps find it automatically (UDP beacon on port 7374). Android scans your Wi-Fi subnet. Any phone, tablet or PC browser can open the `http://<host-ip>:7373` address shown in the lobby.
- **Internet / always-on server:** `node dist/server.cjs --port 7373` on any machine (Raspberry Pi, VPS, NAS). Players use **Join Game** with its address and **Create new room**, then share the 4-letter room code. Put it behind a TLS proxy (e.g. Caddy) to give browsers a `wss://` address.
- Players who drop out reconnect into the same seat automatically.
- Allow MechForce through the Windows firewall when it asks (TCP 7373, UDP 7374).

## Controls

| | Controller | Keyboard / mouse | Touch |
|---|---|---|---|
| Cursor | Left stick / d-pad | WASD / arrows / hover | Tap hex |
| Confirm | A / ✕ | Enter / click | Tap again |
| Back | B / ○ | Esc / right-click | Android Back |
| Walk-Run-Jump / Melee | Y / △ | R | Prompt button |
| Stay & turn / Fire | X / □ | F | Prompt button |
| Next mech / target | LB RB / L1 R1 | Tab / Shift+Tab | Prompt button |
| End turn | View / Share | T | Prompt button |
| Camera | Right stick, triggers zoom | Q/E, wheel, middle-drag | Drag, pinch, twist |
| Menu | Menu / Options | P | ☰ |

Button prompts switch automatically between Xbox/Deck, PlayStation, keyboard and touch.

## Steam Deck

1. Copy the `.AppImage` to the Deck in Desktop Mode, right-click → Properties → Permissions → *Is executable*.
2. Steam → *Add a Non-Steam Game* → pick the AppImage. Launch it from Game Mode; the Deck controls arrive as an Xbox pad and the game starts fullscreen.
3. Hosting works from the Deck too.

## Android

Allow *Install unknown apps* for your browser or file manager and open the APK. Every build is signed with the same key in `android/mechforce.keystore`, so updates install over the top. Use your own key before publishing to a store.

## Develop

```bash
npm install
npm test          # AI-vs-AI simulations of every mission
npm run build     # dist/web, dist/server.cjs, dist/artifact
npm run server    # LAN server + web client on :7373
npm start         # desktop app (Electron)
npm run android:sync && (cd android && ./gradlew assembleRelease)
```

`src/core` is the platform-independent game (rules, AI, lobby/room). `src/client` is the 3D client. `server/` is the host. `electron/` and `android/` are thin shells.

## Credits

Original MechForce © 1987–89 Ralph H. Reed, distributed as shareware. This remake is a fan project and reads the game data from the original disk.
