# Crisis in Gordistan

A deliberately minimal, browser-based hex-and-counter strategy game for 2–4 friends.

## What this prototype includes

- Cloudflare Worker + Durable Object authoritative game state
- WebSocket multiplayer
- 6-character room codes
- 2–4 asymmetric player seats
- Hex map
- Stack-free counters
- Movement
- Adjacent combat
- Step losses
- Turn rotation
- Simple political/escalation tracks
- Mobile-friendly UI

The scenario is fictionalized on purpose. It models strategic pressures and conventional game mechanics without encoding real military bases, real invasion corridors, targeting data, unit locations, or current operational vulnerabilities.

## Run

```bash
npm install
npm run dev
```

Deploy:

```bash
npm run deploy
```

## Core rules

Each player chooses one seat:

1. Coalition
2. Iran
3. Regional States
4. Nonstate / Political

On your turn:

1. Select one of your counters.
2. Click an empty hex within its movement allowance to move.
3. Or click an adjacent enemy counter to attack.
4. End your turn when finished.

Combat is intentionally abstract:

`attacker attack + d6 - defender defense`

- score 4+ → defender loses one step
- score 0 or less → attacker loses one step
- otherwise → no step loss

## Good next additions

### 1. Action points
Give each seat 3–5 AP each turn, with movement/attacks/political actions costing AP.

### 2. Zones of control
Enemy land counters could stop movement in adjacent hexes.

### 3. Supply
Trace a short path to a friendly supply source. Unsupplied units lose movement/combat effectiveness.

### 4. Air/naval layer
Do not put air units directly on the land map. Make them theater-wide assets allocated to missions:
- air superiority
- reconnaissance
- interdiction
- strategic lift
- maritime security

### 5. Political layer
Make neighboring states abstract political tracks instead of military staging locations. Example statuses:
- closed
- neutral
- quiet support
- open support

### 6. Escalation
Actions can raise an escalation track. High escalation can unlock stronger actions but increase political costs and alternate victory conditions.

### 7. Victory
Use multiple victory dimensions instead of "capture the capital":
- territorial leverage
- military cohesion
- coalition unity
- domestic political support
- escalation control

### 8. Fog of war
The server should store full state while each player receives only what their side can observe.

## Suggested design direction

The game will feel more like a serious political-military board game if the interesting decisions are about:

- where to concentrate limited forces
- how much escalation to accept
- when to spend political capital
- maintaining supply
- coalition management
- deterrence versus offensive action

rather than trying to reproduce real-world operational plans.
