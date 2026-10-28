#!/usr/bin/env python3
"""Convert BattleTech four-legged, tripod, QuadVee and tracked BattleMech designs from
MegaMek Data (.mtf files, CC BY-NC-SA 4.0, https://github.com/MegaMek/mm-data) into
MechForce templates, written to src/core/extradata.js.

Usage: python3 tools/convert_mtf.py <mm-data>/data/mekfiles/meks

MechForce has the 17 weapon types of the 1989 original, so later and Clan weapons are
mapped to the nearest classic type (an ER Large Laser becomes a Large Laser, a Gauss
Rifle an AC/10, and so on) and use that type's standard stats. Equipment the game does
not model (Endo Steel, CASE, ECM, Artemis...) still takes up its critical slots."""
import json, os, re, sys

DESIGNS = [
    # four-legged
    ('3055U/Tarantula ZPH-1.mtf', 'Tarantula'),
    ('3039u/Scorpion SCP-1N.mtf', 'Scorpion'),
    ('3085u/Cutting Edge/Thunder Fox TFT-A9.mtf', 'Thunder Fox'),
    ('3060u/Barghest BGS-1T.mtf', 'Barghest'),
    ('3060u/Sirocco SRC-3C.mtf', 'Sirocco'),
    # QuadVees
    ('QuadVees/Arion.mtf', 'Arion'),
    ('QuadVees/Cyllaros.mtf', 'Cyllaros'),
    ('QuadVees/Boreas Prime.mtf', 'Boreas'),
    ('QuadVees/Harpagos.mtf', 'Harpagos'),
    # tripods
    ('XTRs/Republic III/Triskelion TRK-4V.mtf', 'Triskelion'),
    ('3145/Republic/Poseidon PSD-V2.mtf', 'Poseidon'),
    ('3145/Republic/Ares ARS-V1 Zeus.mtf', 'Ares'),
    # BattleMech with tracks
    ('3145/NTNU RS/NTNU/Brahma BRM-6T.mtf', 'Brahma'),
]

# MechForce weapon types (same order as WEAPONS in data.js) and standard stats from custom.js WSTAT
WSTAT = [
    (1, 2, 24, 4, 45, 1), (1, 5, 18, 3, 20, 4), (3, 10, 15, 0, 10, 7), (7, 20, 9, 0, 5, 10), (0, 2, 3, 0, 200, 1),
    (2, 1, 21, 6, 24, 1), (4, 1, 21, 6, 12, 2), (5, 1, 21, 6, 8, 3), (6, 1, 21, 6, 6, 5), (2, 2, 9, 0, 50, 1),
    (3, 2, 9, 0, 25, 1), (4, 2, 9, 0, 15, 2), (1, 3, 3, 0, 0, 1), (3, 5, 9, 0, 0, 1), (8, 8, 15, 0, 0, 2),
    (3, 2, 3, 0, 0, 1), (10, 10, 18, 3, 0, 3),
]  # heat, dmg, long range, min range, shots/ton, slots

SKIP = ('anti-missile', 'antimissile', 'ams', 'tag', 'narc', 'c3', 'ecm', 'probe', 'targeting', 'artemis', 'case',
        'tsemp', 'endo', 'ferro', 'stealth', 'masc', 'supercharger', 'apollo', 'lrt', 'srt', 'torpedo', 'harjel', 'spikes')


def weapon_type(name):
    """Map a weapon (or weapon critical-slot name) to a MechForce weapon type, or None."""
    n = re.sub(r'\s+', '', name.lower())
    n = re.sub(r'^(is|cl)(?=[a-z])', '', n)
    n = n.replace('(clan)', '').replace('(is)', '')
    if any(k in n for k in SKIP) and 'heavyppc' not in n:
        return None
    m = re.search(r'(?:lbx?|lb)(\d+)', n) or re.search(r'(?:ultra|rotary|u|r|light)?(?:ac|autocannon)/?(\d+)', n)
    if m and ('ac' in n or 'lb' in n or 'autocannon' in n):
        return {2: 0, 5: 1, 10: 2, 20: 3}.get(int(m.group(1)))
    if 'hag' in n or 'hyperassault' in n:
        return 2 if '20' in n else 3
    if 'gauss' in n:
        if 'apgauss' in n or 'anti-personnel' in n:
            return 4
        return 1 if 'light' in n else 3 if 'heavy' in n or 'improved' in n else 2
    if 'machinegun' in n or n in ('mg',) or 'machine' in n:
        return 4
    if 'flamer' in n:
        return 15
    if 'plasma' in n:
        return 16
    if 'ppc' in n:
        return 16
    if 'laser' in n:
        if 'large' in n:
            return 14
        if 'medium' in n:
            return 13
        if 'small' in n or 'micro' in n:
            return 12
        return 13
    m = re.search(r'(lrm|mml|mrm|rocketlauncher|atm|srm)(\d+)', n)
    if m:
        kind, k = m.group(1), int(m.group(2))
        if kind == 'srm':
            return {2: 9, 4: 10, 6: 11}.get(k, 11)
        if kind == 'atm':
            return {3: 10, 6: 11, 9: 6, 12: 7}.get(k, 11)
        if kind == 'mml':
            return 5 if k <= 5 else 6
        return 5 if k <= 5 else 6 if k <= 10 else 7 if k <= 15 else 8
    return None


SECTIONS = {
    'Head': 0, 'Left Torso': 1, 'Center Torso': 2, 'Right Torso': 3, 'Left Arm': 4, 'Right Arm': 5, 'Left Leg': 6,
    'Right Leg': 7, 'Center Leg': 8, 'Front Left Leg': 4, 'Front Right Leg': 5, 'Rear Left Leg': 6, 'Rear Right Leg': 7,
}
ARMOR = {'HD': 0, 'LT': 1, 'CT': 2, 'RT': 3, 'RTL': 4, 'RTC': 5, 'RTR': 6, 'LA': 7, 'RA': 8, 'LL': 9, 'RL': 10,
         'FLL': 7, 'FRL': 8, 'RLL': 9, 'RRL': 10, 'CL': 11}
LEG_ACT = {4: [53, 54, 55, 56], 5: [57, 58, 59, 60], 6: [37, 38, 39, 40], 7: [41, 42, 43, 44], 8: [61, 62, 63, 64]}
ARM_ACT = {4: [29, 30, 31, 32], 5: [33, 34, 35, 36]}
STRUCT = {  # tons: head, CT, side torso, arm, leg (BattleTech internal structure table, incl. superheavies)
    20: (3, 6, 5, 3, 4), 25: (3, 8, 6, 4, 6), 30: (3, 10, 7, 5, 7), 35: (3, 11, 8, 6, 8), 40: (3, 12, 10, 6, 10),
    45: (3, 14, 11, 7, 11), 50: (3, 16, 12, 8, 12), 55: (3, 18, 13, 9, 13), 60: (3, 20, 14, 10, 14),
    65: (3, 21, 15, 10, 15), 70: (3, 22, 15, 11, 15), 75: (3, 23, 16, 12, 16), 80: (3, 25, 17, 13, 17),
    85: (3, 27, 18, 14, 18), 90: (3, 29, 19, 15, 19), 95: (3, 30, 20, 16, 20), 100: (3, 31, 21, 17, 21),
    105: (4, 32, 22, 17, 22), 110: (4, 33, 23, 18, 23), 115: (4, 35, 24, 19, 24), 120: (4, 36, 25, 20, 25),
    125: (4, 38, 26, 21, 26), 130: (4, 39, 27, 21, 27), 135: (4, 41, 28, 22, 28), 140: (4, 42, 29, 23, 29),
}
SIMPLE = {'Life Support': 45, 'Sensors': 46, 'Cockpit': 47, 'Gyro': 49, 'Tracks': 65, 'Conversion Gear': 66}


def crit_code(line, loc):
    s = line.strip()
    if s in ('-Empty-', ''):
        return -1, None
    base = re.sub(r'\s*\((R|OS|ST)\)$', '', s)
    if base in SIMPLE:
        return SIMPLE[base], None
    if 'Engine' in base:
        return 48, None
    if 'Jump Jet' in base:
        return 50, None
    if 'Heat Sink' in base or 'HeatSink' in base:
        return 51, None
    acts = ['Shoulder', 'Upper Arm Actuator', 'Lower Arm Actuator', 'Hand Actuator']
    if base in acts:
        return ARM_ACT[loc][acts.index(base)], None
    legs = ['Hip', 'Upper Leg Actuator', 'Lower Leg Actuator', 'Foot Actuator']
    if base in legs:
        return LEG_ACT[loc][legs.index(base)], None
    if 'Ammo' in base:
        t = weapon_type(base.replace('Ammo', ''))
        return (17 + t, ('ammo', t)) if t is not None else (67, None)
    t = weapon_type(base)
    if t is not None:
        return t, ('w', t)
    return 67, None


def convert(path, name):
    lines = open(path, encoding='utf-8').read().splitlines()
    kv, sections, cur = {}, {}, None
    weapons = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith('Weapons:'):
            for k in range(int(ln.split(':')[1])):
                i += 1
                wname, wloc = lines[i].rsplit(',', 1)
                weapons.append((wname.strip(), wloc.strip()))
        elif ln.rstrip().endswith(':') and ln.rstrip()[:-1] in SECTIONS:
            cur = SECTIONS[ln.rstrip()[:-1]]
            sections[cur] = []
        elif cur is not None and ln.strip() and ':' not in ln:
            sections[cur].append(ln)
        elif ':' in ln:
            cur = None if not ln.strip() else cur
            k, v = ln.split(':', 1)
            kv.setdefault(k.strip(), v.strip())
        else:
            cur = None
        i += 1
    cfg = kv['Config']
    body = 'quad' if cfg.startswith('Quad') else 'tripod' if cfg.startswith('Tripod') else 'biped'
    mot = 'quadvee' if cfg.startswith('QuadVee') else None
    tons = int(kv['mass'])
    walk, jump = int(kv['walk mp']), int(kv.get('jump mp', '0'))
    hsn, hskind = re.match(r'(\d+)\s*(.*)', kv['heat sinks']).groups()
    hs = int(hsn) * (2 if re.search(r'Double|Laser', hskind) else 1)
    nloc = 9 if body == 'tripod' else 8
    # armour
    a = [0] * (12 if body == 'tripod' else 11)
    for k, z in ARMOR.items():
        if f'{k} armor' in kv and z < len(a):
            a[z] = int(kv[f'{k} armor'])
    st = STRUCT[tons]
    arm = st[4] if body == 'quad' else st[3]
    internal = [st[0], st[2], st[1], st[2], arm, arm, st[4], st[4]] + ([st[4]] if body == 'tripod' else [])
    # critical slots
    cr = []
    owners = []
    for loc in range(nloc):
        row, own = [], []
        for ln in (sections.get(loc, []) + ['-Empty-'] * 12)[:12]:
            c, o = crit_code(ln, loc)
            row.append(c)
            own.append(o)
        cr.append(row)
        owners.append(own)
    if any(c == 65 for row in cr for c in row) and not mot:
        mot = 'tracks'
    ammo_slots = {}
    for loc in range(nloc):
        for s, o in enumerate(owners[loc]):
            if o and o[0] == 'ammo':
                ammo_slots.setdefault(o[1], []).append((loc, s))
    # identical weapons in one location sit in one run of slots: split it evenly between them
    want = {}
    for wname, wloc in weapons:
        t, loc = weapon_type(wname), SECTIONS.get(wloc)
        if t is not None and loc is not None:
            want[(loc, t)] = want.get((loc, t), 0) + 1
    chunks = {}
    for (loc, t), k in want.items():
        slots = [s for s, o in enumerate(owners[loc]) if o == ('w', t)]
        per = max(1, len(slots) // k) if slots else 0
        chunks[(loc, t)] = [slots[q * per:(q + 1) * per] for q in range(k) if slots[q * per:(q + 1) * per]]
    wp, skipped = [], []
    for wname, wloc in weapons:
        t = weapon_type(wname)
        loc = SECTIONS.get(wloc)
        if t is None or loc is None:
            skipped.append(wname)
            continue
        if not chunks.get((loc, t)):
            skipped.append(wname + ' (no slot)')
            continue
        run = chunks[(loc, t)].pop(0)
        heat, dmg, rng, minr, per_ton, slots = WSTAT[t]
        wp.append([t, heat, dmg, rng, minr, len(run), 0, loc, run[0], -1, -1])
    # share each ammo type's shots between the weapons that use it
    for t, slots in ammo_slots.items():
        users = [w for w in wp if w[0] == t]
        if not users:
            continue
        shots = WSTAT[t][4] * len(slots)
        for k, w in enumerate(users):
            w[6] = shots // len(users) + (1 if k < shots % len(users) else 0)
            aloc, aslot = slots[min(k, len(slots) - 1)]
            w[9], w[10] = aloc, aslot
    for w in wp:  # weapons that need ammo but have none listed still get a load, as the original game did
        if WSTAT[w[0]][4] and w[6] <= 0:
            w[6] = WSTAT[w[0]][4]
    cls = 0 if tons <= 35 else 1 if tons <= 55 else 2 if tons <= 75 else 3
    out = {'n': name, 'c': cls, 't': tons, 'a': a, 'i': internal, 'hs': hs, 'w': walk, 'j': jump, 'wp': wp, 'cr': cr,
           'body': body, 'model': (kv.get('model') or '').strip(), 'era': int(kv.get('era', '0') or 0)}
    if mot:
        out['mot'] = mot
    return out, skipped


def main():
    root = sys.argv[1]
    out = []
    for rel, name in DESIGNS:
        tpl, skipped = convert(os.path.join(root, rel), name)
        print(f"{name:12} {tpl['body']:6} {tpl.get('mot') or '':8} {tpl['t']:3}t walk {tpl['w']} jump {tpl['j']} "
              f"weapons {len(tpl['wp'])}" + (f"  skipped: {', '.join(skipped)}" if skipped else ''))
        out.append(tpl)
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, '..', 'src', 'core', 'extradata.js'), 'w') as f:
        f.write('// Generated by tools/convert_mtf.py. Four-legged, tripod, QuadVee and tracked BattleMech designs\n'
                '// adapted from MegaMek Data (C) The MegaMek Team, licensed CC BY-NC-SA 4.0\n'
                '// (https://creativecommons.org/licenses/by-nc-sa/4.0/). Weapons are mapped to the original game\'s 17 types.\n'
                '// BattleMech and BattleTech are trademarks of The Topps Company, Inc.\n')
        f.write('export const EXTRA_MECHS = ' + json.dumps(out, separators=(',', ':')) + ';\n')


if __name__ == '__main__':
    main()
