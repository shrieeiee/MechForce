import { MECHS as DISK_MECHS } from './mechdata.js';
import { EXTRA_MECHS } from './extradata.js';

export const VERSION = '1.11.0';
export const PROTOCOL = 6;

// Weapon types, in the original program's order.
// kind: b=ballistic, m=missile, e=energy. n = missiles per volley. snd = sound family
export const WEAPONS = [
  { name: 'Autocannon/2', short: 'AC/2', kind: 'b', n: 1, snd: 'cannon', fx: 'ac' },
  { name: 'Autocannon/5', short: 'AC/5', kind: 'b', n: 1, snd: 'cannon', fx: 'ac' },
  { name: 'Autocannon/10', short: 'AC/10', kind: 'b', n: 1, snd: 'cannon', fx: 'ac' },
  { name: 'Autocannon/20', short: 'AC/20', kind: 'b', n: 1, snd: 'cannon', fx: 'ac' },
  { name: 'Machine Gun', short: 'MG', kind: 'b', n: 1, snd: 'mg', fx: 'mg' },
  { name: 'LRM 5 Rack', short: 'LRM5', kind: 'm', n: 5, lrm: true, snd: 'rocket', fx: 'lrm' },
  { name: 'LRM 10 Rack', short: 'LRM10', kind: 'm', n: 10, lrm: true, snd: 'rocket', fx: 'lrm' },
  { name: 'LRM 15 Rack', short: 'LRM15', kind: 'm', n: 15, lrm: true, snd: 'rocket', fx: 'lrm' },
  { name: 'LRM 20 Rack', short: 'LRM20', kind: 'm', n: 20, lrm: true, snd: 'rocket', fx: 'lrm' },
  { name: 'SRM 2 Rack', short: 'SRM2', kind: 'm', n: 2, snd: 'rocket', fx: 'srm' },
  { name: 'SRM 4 Rack', short: 'SRM4', kind: 'm', n: 4, snd: 'rocket', fx: 'srm' },
  { name: 'SRM 6 Rack', short: 'SRM6', kind: 'm', n: 6, snd: 'rocket', fx: 'srm' },
  { name: 'Small Laser', short: 'S.LAS', kind: 'e', n: 1, snd: 'laser', fx: 'laserS' },
  { name: 'Medium Laser', short: 'M.LAS', kind: 'e', n: 1, snd: 'laser', fx: 'laserM' },
  { name: 'Large Laser', short: 'L.LAS', kind: 'e', n: 1, snd: 'laser', fx: 'laserL' },
  { name: 'Flamer', short: 'FLAMER', kind: 'e', n: 1, snd: 'flamer', fx: 'flamer' },
  { name: 'Plasma Cannon', short: 'PLASMA', kind: 'e', n: 1, snd: 'plasma', fx: 'plasma' },
];

// Structural locations. 0-7 are the original eight; tripods add a centre leg (8).
// On a four-legged mech, locations 4/5 are the FRONT legs and 6/7 the rear legs (as in
// BattleTech, where a quad's "arm" hit-location results strike its front legs).
export const LOC = { H: 0, LT: 1, CT: 2, RT: 3, LA: 4, RA: 5, LL: 6, RL: 7, CL: 8 };
export const LOC_NAMES = ['Head', 'Left Torso', 'Center Torso', 'Right Torso', 'Left Arm', 'Right Arm', 'Left Leg', 'Right Leg', 'Center Leg'];
export const LOC_SHORT = ['HD', 'LT', 'CT', 'RT', 'LA', 'RA', 'LL', 'RL', 'CL'];
const QUAD_NAMES = ['Head', 'Left Torso', 'Center Torso', 'Right Torso', 'Front Left Leg', 'Front Right Leg', 'Rear Left Leg', 'Rear Right Leg'];
const QUAD_SHORT = ['HD', 'LT', 'CT', 'RT', 'FLL', 'FRL', 'RLL', 'RRL'];
// Armour zones: the original 11, plus 11 = centre leg on tripods
export const ZONE_NAMES = ['Head', 'Left Torso', 'Center Torso', 'Right Torso', 'Left Back Torso', 'Center Back Torso',
  'Right Back Torso', 'Left Arm', 'Right Arm', 'Left Leg', 'Right Leg', 'Center Leg'];
export const ZONE_LOC = [0, 1, 2, 3, 1, 2, 3, 4, 5, 6, 7, 8];
export const FRONT_ZONE = [0, 1, 2, 3, 7, 8, 9, 10, 11];
export const REAR_ZONE = [-1, 4, 5, 6, -1, -1, -1, -1, -1];
// Where damage goes when a location is gone (a centre leg transfers to the centre torso)
export const TRANSFER = [-1, 2, -1, 2, 1, 3, 1, 3, 2];

// ---- chassis: 'biped' (default), 'quad' (four legs, no arms) or 'tripod' (two arms, three legs)
export const BODIES = ['biped', 'quad', 'tripod'];
export const BODY_NAMES = { biped: 'Biped', quad: 'Four-legged', tripod: 'Tripod' };
export const bodyOf = (m) => (m && m.body) || 'biped';
export function legLocs(body) { return body === 'quad' ? [4, 5, 6, 7] : body === 'tripod' ? [6, 7, 8] : [6, 7]; }
export function armLocs(body) { return body === 'quad' ? [] : [4, 5]; }
export function nLocs(body) { return body === 'tripod' ? 9 : 8; }
export function nZones(body) { return body === 'tripod' ? 12 : 11; }
export function locName(body, loc) { return body === 'quad' ? QUAD_NAMES[loc] : LOC_NAMES[loc]; }
export function locShort(body, loc) { return body === 'quad' ? QUAD_SHORT[loc] : LOC_SHORT[loc]; }
// Leg actuators per location: [hip, upper leg, lower leg, foot]
export const LEG_ACT = { 4: [53, 54, 55, 56], 5: [57, 58, 59, 60], 6: [37, 38, 39, 40], 7: [41, 42, 43, 44], 8: [61, 62, 63, 64] };
export const ARM_ACT = { 4: [29, 30, 31, 32], 5: [33, 34, 35, 36] };
// Motive systems: undefined, 'tracks' (BattleMech tracks, any chassis) or 'quadvee'
// (Clan QuadVee: a four-legged mech that converts into a tracked vehicle)
export const MOTIVE_NAMES = { tracks: 'Tracks', quadvee: 'QuadVee' };
export const CODE_TRACKS = 65, CODE_CONVERSION = 66, CODE_EQUIP = 67;

// Critical item codes from the original crit tables
export function critName(code, body) {
  if (code < 0) return 'Empty';
  if (body === 'quad' && code >= 37 && code <= 44) return 'Rear ' + critName(code);
  if (code <= 16) return WEAPONS[code].name;
  if (code <= 28) return 'Ammo ' + WEAPONS[code - 17].short;
  const names = {
    29: 'L. Shoulder', 30: 'L. Upper Arm Actuator', 31: 'L. Lower Arm Actuator', 32: 'L. Hand Actuator',
    33: 'R. Shoulder', 34: 'R. Upper Arm Actuator', 35: 'R. Lower Arm Actuator', 36: 'R. Hand Actuator',
    37: 'Left Hip', 38: 'L. Upper Leg Actuator', 39: 'L. Lower Leg Actuator', 40: 'L. Foot Actuator',
    41: 'Right Hip', 42: 'R. Upper Leg Actuator', 43: 'R. Lower Leg Actuator', 44: 'R. Foot Actuator',
    45: 'Life Support', 46: 'Sensors', 47: 'Cockpit', 48: 'Engine', 49: 'Gyro', 50: 'Jump Jet', 51: 'Heat Sink', 52: 'Jump Jet',
    53: 'FL Hip', 54: 'FL Upper Leg Actuator', 55: 'FL Lower Leg Actuator', 56: 'FL Foot Actuator',
    57: 'FR Hip', 58: 'FR Upper Leg Actuator', 59: 'FR Lower Leg Actuator', 60: 'FR Foot Actuator',
    61: 'C. Hip', 62: 'C. Upper Leg Actuator', 63: 'C. Lower Leg Actuator', 64: 'C. Foot Actuator',
    65: 'Tracks', 66: 'Conversion Gear', 67: 'Equipment',
  };
  return names[code] || 'Structure';
}

export const CLASS_NAMES = ['Light', 'Medium', 'Heavy', 'Assault'];

export const TERRAIN = [
  { name: 'Clear', cost: 1, woods: 0 },
  { name: 'Light Woods', cost: 2, woods: 1 },
  { name: 'Heavy Woods', cost: 3, woods: 2 },
  { name: 'Rough', cost: 2, woods: 0 },
  { name: 'Water', cost: 2, woods: 0, depth: 1 },
  { name: 'Deep Water', cost: 4, woods: 0, depth: 2 },
];

// ---- structures (BattleTech gun emplacements, bunkers, buildings, walls). cf = construction
// factor (hit points); hard = hardened (takes half damage); h = height in levels for line of sight.
export const STRUCTS = {
  turret: { name: 'Gun emplacement', cf: 40, h: 1, slots: 1, hard: false, burns: false },
  bunker: { name: 'Bunker', cf: 90, h: 1, slots: 2, hard: true, burns: false },
  building: { name: 'Building', cf: 60, h: 2, slots: 0, hard: false, burns: true },
  wall: { name: 'Wall', cf: 30, h: 1, slots: 0, hard: true, burns: false },
};
export const STRUCT_KINDS = Object.keys(STRUCTS);
// Weapon fits for emplacements and bunkers (weapon type indexes, see WEAPONS)
export const LOADOUTS = {
  ac10: { name: 'AC/10', w: [2] },
  ac20: { name: 'AC/20', w: [3] },
  lrm: { name: 'LRM 20', w: [8] },
  srm: { name: 'Twin SRM 6', w: [11, 11] },
  laser: { name: 'Twin large lasers', w: [14, 14] },
  ppc: { name: 'Plasma cannon', w: [16] },
  mg: { name: 'Machine guns', w: [4, 4] },
};
export const LOADOUT_IDS = Object.keys(LOADOUTS);
export const STRUCT_GUNNERY = 4; // automated emplacement crews
export const TEAM_ZONE_NAMES = ['West', 'East', 'North', 'South'];

// ---- climate: heat added (or removed) at the end of every activation, after TacOps'
// extreme-temperature rule (one heat per 10°C beyond the comfortable range)
export const CLIMATE = {
  temperate: { heat: 0, text: 'Mild climate: no effect on heat.' },
  desert: { heat: 1, text: 'Desert heat: +1 heat every turn.' },
  snow: { heat: -1, text: 'Arctic cold: 1 extra heat removed every turn.' },
  lunar: { heat: 0, text: 'Airless moon: no effect on heat.' },
  volcanic: { heat: 2, text: 'Volcanic heat: +2 heat every turn, and the lakes are magma.' },
};

export const THEMES = [
  { id: 'temperate', name: 'Temperate' },
  { id: 'desert', name: 'Desert' },
  { id: 'snow', name: 'Arctic' },
  { id: 'lunar', name: 'Lunar' },
  { id: 'volcanic', name: 'Volcanic' },
];

export const MAP_SIZES = [
  { id: 'S', name: 'Small', w: 16, h: 12 },
  { id: 'M', name: 'Medium', w: 22, h: 16 },
  { id: 'L', name: 'Large', w: 28, h: 20 },
];

export const SIDE_COLORS = ['#3fa9ff', '#ff5a3c', '#5ee06a', '#ffcc33'];
export const SIDE_NAMES = ['Blue Force', 'Red Force', 'Green Force', 'Gold Force'];

export const PILOT_NAMES = ['Hawk', 'Viper', 'Tex', 'Ghost', 'Mako', 'Rook', 'Jinx', 'Bishop', 'Kestrel', 'Nova', 'Ronin',
  'Sable', 'Duke', 'Flint', 'Echo', 'Moss', 'Rivet', 'Banjo', 'Torch', 'Pike', 'Wren', 'Quill', 'Brick', 'Zero'];

// Missions. Side 0 starts in the west, side 1 in the east. Briefings are the original text from the Orders drawer.
export const MISSIONS = [
  {
    id: 'generic', name: 'Search & Destroy', sides: [2, 4], rounds: 30,
    goal: ['Destroy all enemy mechs.', 'Destroy all enemy mechs.'],
    brief: ['Enemy forces have been reported in the area. You are ordered to assemble a unit and investigate the reports. Any enemy mechs found in the area are to be neutralized.',
      'Enemy forces have been reported in the area. You are ordered to assemble a unit and investigate the reports. Any enemy mechs found in the area are to be neutralized.'],
  },
  {
    id: 'crossing', name: 'Crossing', sides: [2, 4], rounds: 14, exitEdge: ['E', null],
    goal: ['Get at least half your mechs off the EAST edge.', 'Stop the enemy crossing. Destroy them.'],
    brief: ['Your unit has been re-assigned to another position. You are ordered to move your mechs to the East and report for further orders. Your mechs are needed for a planned assault. If you should encounter enemy forces you should avoid combat and minimize damage and losses. It is more important to have your unit at full strength for the major assault than to risk losses in a minor skirmish.',
      'Enemy forces are gathering for a major offensive. Intelligence reports a unit enroute heading West. You are ordered to assemble a force and intercept and destroy them. You should arrive in the area in time to set up in an advantageous position.'],
  },
  {
    id: 'hold', name: 'Hold Position', sides: [2, 4], rounds: 10, holdSide: 0,
    goal: ['Survive 500 seconds (10 rounds).', 'Destroy every defending mech before time runs out.'],
    brief: ['Intelligence reports an enemy force trying to flank our position. You are ordered to assemble a team and pick a position to defend. You must hold that position for at least 500 seconds or the enemy forces will catch our vulnerable flank and cause grave damage to our forces. It will take at least 500 seconds to prepare for their assault.',
      'We are making a massed assault on the enemy forces. One unit has taken up a position to block our assault. You are ordered to charge their position and destroy all of the mechs.'],
  },
  {
    id: 'datapack', name: 'Find the DataPack', sides: [2, 4], rounds: 18, item: 'Datapack', itemZone: 'east', carriers: [0], homeExit: true,
    goal: ['Dig the datapack out of the wreck and carry it off the WEST edge.', 'Crush all enemy forces in the area.'],
    brief: ['A surveillance flyer has gone down in enemy territory. You are ordered to assemble a team to search for the flyer. A datapack in the flyer contains vital intelligence data. You are ordered to recover the datapack and return with it. You may have to dig the datapack out of the wreckage.',
      'Intelligence reports that an enemy flyer has gone down in our territory. You are ordered to assemble a team and investigate the report. All enemy forces in the area are to be crushed.'],
  },
  {
    id: 'memcell', name: 'Recover the Memory Cell', sides: [2, 4], rounds: 18, item: 'Memory Cell', itemZone: 'center', carriers: [0, 1], homeExit: true,
    goal: ['Grab the memory cell and carry it off your home (WEST) edge.', 'Grab the memory cell and carry it off your home (EAST) edge.'],
    brief: ['We have just received word of an ancient memory cell discovered near here. This cell may contain priceless LosTech information. You are ordered to assemble a team to recover this memory cell. The enemy may also have heard of the discovery. They must not be allowed to recover the memory cell. If it looks like they may recover the memory cell you are ordered to destroy it, at any cost.',
      'A spy has just reported the discovery of an ancient memory cell that may contain LosTech information. You are ordered to assemble a team and proceed to the reported location of the memory cell at top speed. The memory cell must be recovered. If enemy forces are encountered you must prevent them from getting the memory cell, even if you have to destroy it.'],
  },
  {
    id: 'pepsi', name: 'Escort the Pepsi', sides: [2, 4], rounds: 16, item: 'Last Pepsi', itemZone: 'carried', carriers: [0, 1], exitEdge: ['E', 'W'], itemExit: true,
    goal: ['Carry the last Pepsi off the EAST edge to the bride.', 'Capture the Pepsi and take it off the WEST edge, or wipe out the escort.'],
    brief: ['A royal wedding has been announced. As part of the engagement the Duke has found a rare treasure. The last known bottle of Pepsi. You are ordered to assemble a force of mechs and escort this treasure to the Duke\'s new bride. This marriage is vital to the Duke. His wedding gift MUST reach his bride.',
      'Our enemy, the Duke, has formed an alliance by marriage. As part of the wedding contract the Duke is sending a rare treasure, the last bottle of Pepsi, to his bride. The Pepsi will be heavily guarded. You are ordered to take your mechs and intercept the convoy carrying the Pepsi. It must not reach its destination. Capture the Pepsi if possible, but it must not reach its destination. If it can not be captured it must be destroyed.'],
  },
  {
    id: 'spy', name: 'Destroy the Spy', sides: [2, 4], rounds: 16, item: 'Spy', itemZone: 'eastish', carriers: [1], spy: true, exitEdge: [null, 'E'], itemExit: true,
    goal: ['Find the spy and kill him: reach his hex or destroy whoever carries him.', 'Pick up the spy and get him off the EAST edge.'],
    brief: ['An enemy spy has been reported. You are ordered to put together a team and find the spy and kill him. The enemy is trying to recover their spy and the vital data he has acquired. The spy must not live to reach enemy lines.',
      'One of our spies has gotten vital information about the enemy\'s planned invasion. You are ordered to put together a team, pick up the spy and return him to our lines before the enemy neutralizes him.'],
  },
  {
    id: 'scout', name: 'Scouting Run', sides: [2, 4], rounds: 18, scout: true,
    goal: ['Scout deep into the EAST third, then bring a scout back off the WEST edge.', 'Destroy the scouts before they get home.'],
    brief: ['You are ordered to assemble a scouting team to scout the enemy territory before our major offensive. It is vital that you obtain information on enemy strength in the area and return with the data. Your team must scout at least half way through the area or as far as necessary to identify ALL enemy mechs. At least one mech must return with the intelligence data on the enemy mechs.',
      'Intelligence reports that the enemy is preparing for a major offensive. We expect them to scout our position prior to the assault. Your unit is ordered to intercept this scouting team and destroy them. The enemy mechs must not be allowed to return with intelligence data on our position. ALL enemy mechs must be captured or destroyed.'],
  },
];

// The disk's Goliath is BattleTech's four-legged assault mech. The original game had no
// quad rules, so it stored the front legs as arms; give it its proper chassis.
function asQuad(m) {
  const legI = m.i[6];
  const cr = m.cr.map((r) => r.slice());
  for (const [loc, codes] of [[4, LEG_ACT[4]], [5, LEG_ACT[5]]]) {
    const old = ARM_ACT[loc];
    cr[loc] = cr[loc].map((c) => (old.includes(c) ? codes[old.indexOf(c)] : c));
  }
  return { ...m, body: 'quad', i: [m.i[0], m.i[1], m.i[2], m.i[3], legI, legI, m.i[6], m.i[7]], cr };
}
export const MECHS = [...DISK_MECHS.map((m) => (m.n === 'Goliath' ? asQuad(m) : m)), ...EXTRA_MECHS];

export function mechByName(n) { return MECHS.find((m) => m.n === n); }
export function mechBV(m) {
  // rough "battle value" used for AI picks and auto-balancing
  const arm = m.a.reduce((s, v) => s + v, 0) + m.i.reduce((s, v) => s + v, 0);
  const fire = m.wp.reduce((s, w) => s + w[2] * WEAPONS[w[0]].n * (WEAPONS[w[0]].lrm ? 0.6 : 0.8) * Math.min(1, w[3] / 9 + 0.3), 0);
  return Math.round(arm * 1.2 + fire * 6 + (m.w + m.j) * m.t * 0.3);
}
