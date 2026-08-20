import { DurableObject } from "cloudflare:workers";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return code;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/create" && request.method === "POST") {
      const code = randomCode();
      const id = env.GAMES.idFromName(code);
      const room = env.GAMES.get(id);

      await room.fetch("https://room/init", {
        method: "POST",
        body: JSON.stringify({ code })
      });

      return json({ code });
    }

    const stateMatch = url.pathname.match(
      /^\/api\/game\/([A-Z0-9]{6})$/
    );

    if (stateMatch && request.method === "GET") {
      const id = env.GAMES.idFromName(stateMatch[1]);
      return env.GAMES.get(id).fetch("https://room/state");
    }

    const wsMatch = url.pathname.match(
      /^\/ws\/([A-Z0-9]{6})$/
    );

    if (
      wsMatch &&
      request.headers.get("Upgrade") === "websocket"
    ) {
      const id = env.GAMES.idFromName(wsMatch[1]);
      return env.GAMES.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
  }

  async getState() {
    let state = await this.ctx.storage.get("state");

    if (!state) {
      state = initialState("------");
      await this.ctx.storage.put("state", state);
    }

    return state;
  }

  async save(state) {
    await this.ctx.storage.put("state", state);
  }

  broadcast(state) {
    const message = JSON.stringify({
      type: "state",
      state
    });

    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {}
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (
      url.pathname === "/init" &&
      request.method === "POST"
    ) {
      const { code } = await request.json();

      const existing = await this.ctx.storage.get("state");

      if (!existing) {
        await this.save(initialState(code));
      }

      return json({ ok: true });
    }

    if (url.pathname === "/state") {
      return json(await this.getState());
    }

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();

      const client = pair[0];
      const server = pair[1];

      this.ctx.acceptWebSocket(server);

      const state = await this.getState();

      server.send(
        JSON.stringify({
          type: "state",
          state
        })
      );

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    return new Response("Not found", {
      status: 404
    });
  }

  async webSocketMessage(ws, message) {
    let msg;

    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    const state = await this.getState();

    /*
      JOIN / CHANGE SEAT
    */

    if (msg.type === "join") {
      const name = String(msg.name || "")
        .trim()
        .slice(0, 24);

      const seat = Number(msg.seat);

      if (!name || seat < 0 || seat > 3) {
        return;
      }

      const occupied = state.players.find(
        player =>
          player.seat === seat &&
          player.id !== msg.playerId
      );

      if (occupied) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "That side is already taken."
          })
        );

        return;
      }

      let player = state.players.find(
        player => player.id === msg.playerId
      );

      if (!player) {
        player = {
          id: msg.playerId,
          name,
          seat
        };

        state.players.push(player);
      } else {
        player.name = name;
        player.seat = seat;
      }

      state.log.unshift(
        `${name} joined as ${seatName(seat)}.`
      );

      await this.save(state);
      this.broadcast(state);

      return;
    }

    const player = state.players.find(
      player => player.id === msg.playerId
    );

    if (!player) return;

    /*
      START GAME
    */

    if (msg.type === "start") {
      if (state.phase !== "lobby") return;

      if (state.players.length < 2) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "At least two players are required."
          })
        );

        return;
      }

      const occupiedSeats = getOccupiedSeats(state);

      state.phase = "starting";
      this.broadcast(state);

      await new Promise(resolve =>
        setTimeout(resolve, 700)
      );

      state.phase = "playing";
      state.turn = 1;
      state.activeSeat = occupiedSeats[0];

      state.log.unshift(
        `Turn 1 begins. ${seatName(
          state.activeSeat
        )} acts first.`
      );

      await this.save(state);
      this.broadcast(state);

      return;
    }

    if (state.phase !== "playing") {
      return;
    }

    if (player.seat !== state.activeSeat) {
      return;
    }

    /*
      MOVE

      Each unit may make ONE movement action per turn.
      Distance may be anywhere from 1 to Movement rating.

      Once a unit attacks, it may no longer move.
    */

    if (msg.type === "move") {
      const unit = state.units.find(
        unit => unit.id === msg.unitId
      );

      const destination = state.hexes.find(
        hex =>
          hex.q === Number(msg.q) &&
          hex.r === Number(msg.r)
      );

      if (!unit || !destination) return;

      if (unit.owner !== player.seat) return;

      if (unit.movedTurn === state.turn) {
        return;
      }

      if (unit.attackedTurn === state.turn) {
        return;
      }

      const distance = hexDistance(
        unit,
        destination
      );

      if (
        distance < 1 ||
        distance > unit.move
      ) {
        return;
      }

      if (
        unit.domain === "naval" &&
        destination.domain !== "sea"
      ) {
        return;
      }

      if (
        unit.domain === "land" &&
        destination.domain === "sea"
      ) {
        return;
      }

      const occupied = state.units.find(
        other =>
          other.id !== unit.id &&
          other.q === destination.q &&
          other.r === destination.r
      );

      if (occupied) {
        return;
      }

      unit.q = destination.q;
      unit.r = destination.r;
      unit.movedTurn = state.turn;

      state.log.unshift(
        `${player.name} moved ${unit.label}.`
      );

      await this.save(state);
      this.broadcast(state);

      return;
    }

    /*
      ATTACK

      One attack per unit per turn.
      Attack must be against an adjacent enemy.
    */

    if (msg.type === "attack") {
      const attacker = state.units.find(
        unit => unit.id === msg.attackerId
      );

      const defender = state.units.find(
        unit => unit.id === msg.defenderId
      );

      if (!attacker || !defender) {
        return;
      }

      if (attacker.owner !== player.seat) {
        return;
      }

      if (defender.owner === player.seat) {
        return;
      }

      if (
        attacker.attackedTurn === state.turn
      ) {
        return;
      }

      if (
        hexDistance(attacker, defender) !== 1
      ) {
        return;
      }

      if (
        attacker.domain !== defender.domain
      ) {
        return;
      }

      const roll =
        1 + Math.floor(Math.random() * 6);

      const result =
        attacker.attack +
        roll -
        defender.defense;

      attacker.attackedTurn = state.turn;

      if (result >= 4) {
        defender.steps -= 1;

        state.log.unshift(
          `${attacker.label} attacks ${defender.label}: ` +
          `roll ${roll}, defender loses 1 step.`
        );

        if (defender.steps <= 0) {
          state.units = state.units.filter(
            unit => unit.id !== defender.id
          );

          state.log.unshift(
            `${defender.label} destroyed.`
          );
        }
      } else if (result <= 0) {
        attacker.steps -= 1;

        state.log.unshift(
          `${attacker.label} attacks ${defender.label}: ` +
          `roll ${roll}, attacker loses 1 step.`
        );

        if (attacker.steps <= 0) {
          state.units = state.units.filter(
            unit => unit.id !== attacker.id
          );

          state.log.unshift(
            `${attacker.label} destroyed.`
          );
        }
      } else {
        state.log.unshift(
          `${attacker.label} attacks ${defender.label}: ` +
          `roll ${roll}, no losses.`
        );
      }

      await this.save(state);
      this.broadcast(state);

      return;
    }

    /*
      END TURN
    */

    if (msg.type === "endTurn") {
      const occupiedSeats =
        getOccupiedSeats(state);

      let index =
        occupiedSeats.indexOf(
          state.activeSeat
        );

      index =
        (index + 1) %
        occupiedSeats.length;

      if (index === 0) {
        state.turn += 1;
      }

      state.activeSeat =
        occupiedSeats[index];

      state.log.unshift(
        `Turn ${state.turn}: ${seatName(
          state.activeSeat
        )}.`
      );

      await this.save(state);
      this.broadcast(state);
    }
  }
}

function getOccupiedSeats(state) {
  return [
    ...new Set(
      state.players.map(
        player => player.seat
      )
    )
  ].sort((a, b) => a - b);
}

function seatName(seat) {
  return [
    "Coalition",
    "Iran",
    "Regional States",
    "Nonstate Forces"
  ][seat] || `Seat ${seat + 1}`;
}

function hexDistance(a, b) {
  const aq = a.q;
  const ar = a.r;
  const as = -aq - ar;

  const bq = b.q;
  const br = b.r;
  const bs = -bq - br;

  return Math.max(
    Math.abs(aq - bq),
    Math.abs(ar - br),
    Math.abs(as - bs)
  );
}

/*
  Geographic board.

  Real geography is provided by the
  OpenStreetMap background on the client.

  Hex coordinates are an abstraction placed
  over the region.
*/

function createHexes() {
  const hexes = [];

  const columns = 14;
  const rows = 9;

  for (let q = 0; q < columns; q++) {
    for (let r = 0; r < rows; r++) {
      const lat =
        38.7 -
        r * 1.85 -
        (q % 2 ? 0.925 : 0);

      const lng =
        43.3 +
        q * 1.67;

      const domain =
        isSea(lat, lng)
          ? "sea"
          : "land";

      hexes.push({
        q,
        r,
        lat,
        lng,
        domain
      });
    }
  }

  return hexes;
}

/*
  Deliberately broad sea-zone classification.
  This exists only to stop land counters from
  driving across the Persian Gulf.
*/

function isSea(lat, lng) {
  const persianGulf =
    lat >= 24 &&
    lat <= 29.8 &&
    lng >= 49 &&
    lng <= 56.5 &&
    lat <
      36.2 -
        lng * 0.14;

  const gulfOfOman =
    lat >= 22 &&
    lat <= 26.8 &&
    lng > 56 &&
    lng <= 63.5;

  return persianGulf || gulfOfOman;
}

function initialState(code) {
  return {
    code,

    phase: "lobby",

    turn: 0,

    activeSeat: 0,

    players: [],

    tracks: {
      escalation: 1,
      coalitionSupport: 4,
      regionalStability: 4
    },

    hexes: createHexes(),

    /*
      Fictionalized force formations.

      Locations represent broad strategic
      positions rather than current real-world
      unit deployments.
    */

    units: [
      {
        id: "c-land-1",
        owner: 0,
        label: "Coalition I Corps",
        q: 2,
        r: 3,
        attack: 4,
        defense: 3,
        move: 2,
        steps: 3,
        domain: "land",
        movedTurn: 0,
        attackedTurn: 0
      },

      {
        id: "c-land-2",
        owner: 0,
        label: "Coalition Expeditionary Force",
        q: 3,
        r: 5,
        attack: 3,
        defense: 3,
        move: 2,
        steps: 3,
        domain: "land",
        movedTurn: 0,
        attackedTurn: 0
      },

      {
        id: "c-navy-1",
        owner: 0,
        label: "Coalition Carrier Group",
        q: 7,
        r: 7,
        attack: 4,
        defense: 4,
        move: 3,
        steps: 3,
        domain: "naval",
        movedTurn: 0,
        attackedTurn: 0
      },

      {
        id: "iran-1",
        owner: 1,
        label: "Iranian Western Army",
        q: 6,
        r: 3,
        attack: 3,
        defense: 4,
        move: 1,
        steps: 3,
        domain: "land",
        movedTurn: 0,
        attackedTurn: 0
      },

      {
        id: "iran-2",
        owner: 1,
        label: "Iranian Central Army",
        q: 8,
        r: 4,
        attack: 3,
        defense: 4,
        move: 1,
        steps: 3,
        domain: "land",
        movedTurn: 0,
        attackedTurn: 0
      },

      {
        id: "iran-navy",
        owner: 1,
        label: "Iranian Gulf Fleet",
        q: 8,
        r: 7,
        attack: 3,
        defense: 3,
        move: 2,
        steps: 2,
        domain: "naval",
        movedTurn: 0,
        attackedTurn: 0
      },

      {
        id: "regional-1",
        owner: 2,
        label: "Regional Coalition",
        q: 4,
        r: 6,
        attack: 2,
        defense: 3,
        move: 1,
        steps: 2,
        domain: "land",
        movedTurn: 0,
        attackedTurn: 0
      },

      {
        id: "irregular-1",
        owner: 3,
        label: "Irregular Formation",
        q: 5,
        r: 4,
        attack: 2,
        defense: 2,
        move: 2,
        steps: 2,
        domain: "land",
        movedTurn: 0,
        attackedTurn: 0
      }
    ],

    /*
      Strategic locations only.
    */

    locations: [
      {
        name: "Tehran",
        lat: 35.6892,
        lng: 51.389
      },
      {
        name: "Isfahan",
        lat: 32.6546,
        lng: 51.668
      },
      {
        name: "Shiraz",
        lat: 29.5918,
        lng: 52.5837
      },
      {
        name: "Bandar Abbas",
        lat: 27.1832,
        lng: 56.2666
      },
      {
        name: "Baghdad",
        lat: 33.3152,
        lng: 44.3661
      },
      {
        name: "Kuwait City",
        lat: 29.3759,
        lng: 47.9774
      },
      {
        name: "Doha",
        lat: 25.2854,
        lng: 51.531
      },
      {
        name: "Manama",
        lat: 26.2235,
        lng: 50.5876
      },
      {
        name: "Abu Dhabi",
        lat: 24.4539,
        lng: 54.3773
      },
      {
        name: "Muscat",
        lat: 23.588,
        lng: 58.3829
      }
    ],

    log: [
      "Game created. Players may now choose sides."
    ]
  };
}
