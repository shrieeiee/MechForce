# MechForce: Heavy Metal Combat

A modern, crossplay remake of **MechForce** (v3.79, 1989), the Amiga shareware mech combat game by Ralph H. Reed.
Turn-based hex tactics with console-style 3D graphics, full controller support, and one shared rules engine on every platform.

| Platform | Build | Controls |
|---|---|---|
| Windows | `MechForce-…-Windows-Setup.exe` / `…-Portable.exe` | Xbox/PS pads, keyboard + mouse |
| Steam Deck / Linux | `MechForce-…-Linux-SteamDeck.AppImage` | Deck controls, touchscreen |
| Android | `MechForce-Android.apk` | Touch, Bluetooth/USB controllers |
| Browser | **[play now](https://shrieeiee.github.io/MechForce/)**, or served by any host, or `MechForce-Browser.html` | Gamepad API, keyboard + mouse, touch |

Downloads are on the [Releases](../../releases) page. Every push builds all four in GitHub Actions.

## What came from the original disk

`tools/extract_adf.py` reads the original ADF; `tools/convert_data.py` decodes it:

- **146 mech designs** (Light, Medium, Heavy, Assault, including the original's oddballs like the 215-ton BlueBird): 11-zone armour, internal structure, 8×12 critical slot tables, weapon records with Motorola FFP floats, heat sinks, jump jets.
- **17 weapon types** in the original order, using each mech's own stored heat/damage/range values: Autocannon/2–20, Machine Gun, LRM 5–20 and SRM 2–6 racks, Small/Medium/Large Laser, Flamer, Plasma Cannon.
- **All mission orders** with both sides' briefings, word for word: Search & Destroy, Crossing, Hold Position (500 seconds), Find the DataPack, Recover the Memory Cell, Escort the Pepsi, Destroy the Spy, Scouting Run.
- **The six digitised sounds** (Laser, Cannon, MachineGun, Rocket, Flamer, Crunch), selectable in Settings → Weapon sounds → Original Amiga.

## Four legs, three legs and tracks

Besides two-legged mechs, MechForce plays BattleTech's other chassis by the board game's rules (Total Warfare; Interstellar Operations for tripods and QuadVees):

- **Four-legged** (Goliath, Tarantula, Scorpion, Thunder Fox, Barghest, Sirocco): no arms (no punching, weapons fire forwards), -2 to piloting rolls while all legs work, lateral shift (side-step without turning, +1 MP), -1 MP for the first lost leg and 1 MP with two gone. Arm hit-location results strike the front legs.
- **Tripods** (Triskelion, Poseidon, Ares): a third, centre leg (leg hits re-rolled 1-2 right / 3-4 centre / 5-6 left), -1 to piloting rolls, two-seat 4-ton cockpit and 10% heavier structure.
- **BattleMech tracks** (Brahma, or any custom design): roll at walking speed as a tracked vehicle — no heavy woods or water, one level at a time at double cost — and ignore gyro and leg-actuator damage when keeping balance. 10% of tonnage, a slot in each leg.
- **QuadVees** (Arion, Cyllaros, Boreas, Harpagos): Clan four-legged mechs that convert into tanks for 2 MP (+1 per damaged leg actuator, track or conversion gear). In vehicle mode they cruise/flank with no movement heat, can't fall and can drive through water, but can't jump, kick or side-step; each lost leg or track costs a quarter of their speed.

The quad, tripod, QuadVee and tracked designs are adapted from [MegaMek Data](https://github.com/MegaMek/mm-data) by `tools/convert_mtf.py`, with later and Clan weapons mapped to the original game's 17 types. The Mech Lab can build every chassis.

## Mech Lab

Design custom mechs (title screen → Mech Lab, or the ★ Custom tab in the Mech Bay): biped, four-legged or tripod chassis, optional tracks or QuadVee conversion, tonnage 20–100, engine speed, jump jets, heat sinks, armour and up to 16 of the 17 weapon types, with a live tonnage budget, critical-slot map and 3D model. Designs are stored on the device and travel with your lance; the host rebuilds and validates every custom mech (`src/core/custom.js`), so tampered designs are rejected.

## Rules in brief

Initiative each round; sides alternate activating one mech at a time. Walk / run / jump with facing and terrain costs (woods, rough, water, elevation). 2d6 to-hit with range, movement, cover, heat and damage modifiers. Hit locations by attack direction (front, sides, rear armour), damage transfer, critical hits from the real crit tables (ammo explosions, engine, gyro, actuators, cockpit, sensors, heat sinks, jump jets), heat with shutdown and ammo cook-off, falls, pilot injuries and consciousness rolls, punches, kicks and **death from above** (jump next to an enemy and land on it: 3× punch damage, your legs take a kick's worth, a miss means a crash). **Exploding mechs**: a destroyed engine can breach (10+) and blast everything within 2 hexes for engine rating ÷ 10 (max 40, half at 2 hexes); a mech destroyed by its own ammo damages its neighbours. Blasts can knock mechs down, start fires and chain. Each round is 50 seconds, as in the original's "500 seconds".

## Fog of war

Turn on **Fog of war** in the battle setup and each side only sees enemy mechs one of its own mechs can see (line of sight, or standing next to it). Unseen enemies move in secret; a faded "?" marker shows where each was last spotted, until you can see that spot is empty. Firing gives a mech away to the side it shot at for the rest of the round, wrecks stay visible, and everything is revealed when the battle ends. The computer plays by the same rules. Online, the host only sends each player what their side can see; on a hotseat device the view switches with each player's turn.

## Map editor, defences and buildings

**Map Editor** (main menu) builds your own battlefields: paint clear ground, woods, rough and water, raise and lower hills (levels 0–5), and place **gun emplacements** (one weapon), **bunkers** (two weapons, hardened), **buildings** and **walls**. Choose which side each emplacement fights for and what it mounts (AC/10, AC/20, LRM 20, twin SRM 6, twin large lasers, plasma cannon, machine guns). Mirror mode paints both halves at once — *Rotate* gives a perfectly fair West-vs-East map. Maps are saved on the device and picked under **Map** in the battle setup; the host sends the map to everyone, so they work online too.

Emplacements and bunkers are run by the computer for their side: at the end of every round each one fires at the best enemy it can see (gunnery 4, ammo runs out). Every structure blocks movement and sight, can be shot (immobile, -4 to hit) and collapses into rubble. Random battlefields can be fortified with **Defences: Light/Heavy** in the setup.

## Fire, smoke, water and climate

Following BattleTech's Tactical Operations rules: flamers, plasma weapons, stray lasers and exploding mechs can set woods and buildings on fire. Fires spread downwind each round (the wind sometimes shifts), burn heavy woods down to light woods and then to rough ground, and give off smoke that blocks sight like woods. Standing in fire adds +5 heat. Water cools a mech but stepping in needs a piloting roll; on volcanic worlds the lakes are magma (+5/+10 heat, leg damage, no cooling). Deserts add 1 heat a turn, volcanic worlds 2, and arctic cold removes 1.

## Up to four players

Every mission supports 2–4 forces, each a player (local hotseat or online) or the computer. Objective missions are played as two teams (2v2, 2v1 or 3v1 — move forces between teams in the lobby); Search & Destroy can be a free-for-all or two teams. Teammates deploy together, can't damage each other and win together.

## Crossplay

All platforms run the same engine and talk the same JSON protocol, so any mix can play together.

- **Online, from anywhere (including the web version):** choose **Host Online**. You get a five-letter code and an invite link (`https://shrieeiee.github.io/MechForce/?join=CODE`). Friends choose **Join Game** and enter the code, or open the link. The host's device runs the game and players connect to it directly over WebRTC; the free PeerJS cloud only introduces them. Keep the host open while playing. If a strict network (some mobile carriers, corporate Wi-Fi) blocks direct connections, add a TURN relay under Settings → Online play (`turn:user:password@host:3478`). A self-hosted PeerJS server can also be set there; everyone must use the same one.
- **Home network:** on Windows or Steam Deck choose **Host LAN Server**. Other desktop apps find it automatically (UDP beacon on port 7374). Android scans your Wi-Fi subnet. Any phone, tablet or PC browser can open the `http://<host-ip>:7373` address shown in the lobby.
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

Four-legged, tripod, QuadVee and tracked designs are adapted from MegaMek Data © The MegaMek Team, licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/); `src/core/extradata.js` is shared under the same licence. BattleTech, BattleMech and 'Mech are trademarks of The Topps Company, Inc. This is an unofficial, non-commercial fan project.
