import { DurableObject } from "cloudflare:workers";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

const SIDE_NAMES = [
  "Coalition",
  "Iran",
  "Regional States",
  "Nonstate Forces"
];

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: JSON_HEADERS
    }
  );
}

function randomCode() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code = "";

  for (let i = 0; i < 6; i++) {
    code +=
      chars[
        Math.floor(
          Math.random() *
          chars.length
        )
      ];
  }

  return code;
}

function gameStub(env, code) {
  return env.GAMES.get(
    env.GAMES.idFromName(code)
  );
}

function directoryStub(env) {
  return env.DIRECTORY.get(
    env.DIRECTORY.idFromName("main-directory")
  );
}

async function updateDirectory(env, game) {
  try {
    await directoryStub(env).fetch(
      "https://directory/update",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(game)
      }
    );
  } catch {}
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      url.pathname === "/api/create" &&
      request.method === "POST"
    ) {
      const body =
        await request.json().catch(() => ({}));

      const code = randomCode();

      await gameStub(env, code).fetch(
        "https://room/init",
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            code,
            createdBy:
              String(body.playerId || "")
          })
        }
      );

      return json({ code });
    }

    if (url.pathname === "/api/directory") {
      const playerId =
        url.searchParams.get("playerId") || "";

      return directoryStub(env).fetch(
        "https://directory/list" +
        "?playerId=" +
        encodeURIComponent(playerId)
      );
    }

    const stateMatch =
      url.pathname.match(
        /^\/api\/game\/([A-Z0-9]{6})$/
      );

    if (
      stateMatch &&
      request.method === "GET"
    ) {
      return gameStub(
        env,
        stateMatch[1]
      ).fetch("https://room/state");
    }

    const wsMatch =
      url.pathname.match(
        /^\/ws\/([A-Z0-9]{6})$/
      );

    if (
      wsMatch &&
      request.headers.get("Upgrade") === "websocket"
    ) {
      return gameStub(
        env,
        wsMatch[1]
      ).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};


export class GameDirectory
  extends DurableObject {

  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
  }

  async getGames() {
    return (
      await this.ctx.storage.get("games")
    ) || {};
  }

  async fetch(request) {
    const url =
      new URL(request.url);

    if (
      url.pathname === "/update" &&
      request.method === "POST"
    ) {
      const game =
        await request.json();

      const games =
        await this.getGames();

      games[game.code] = {
        ...(games[game.code] || {}),
        ...game,
        updatedAt: Date.now()
      };

      await this.ctx.storage.put(
        "games",
        games
      );

      return json({ ok: true });
    }

    if (url.pathname === "/list") {
      const playerId =
        url.searchParams.get("playerId") || "";

      const gamesObject =
        await this.getGames();

      const allGames =
        Object.values(gamesObject)
          .filter(game => game?.code)
          .sort(
            (a, b) =>
              (b.updatedAt || 0) -
              (a.updatedAt || 0)
          );

      return json({
        joinable:
          allGames.filter(
            game =>
              game.phase === "lobby"
          ),

        mine:
          allGames.filter(
            game =>
              game.phase !== "finished" &&
              (game.players || []).some(
                player =>
                  player.id === playerId
              )
          ),

        finished:
          allGames.filter(
            game =>
              game.phase === "finished" &&
              (game.players || []).some(
                player =>
                  player.id === playerId
              )
          )
      });
    }

    return new Response(
      "Not found",
      { status: 404 }
    );
  }
}


export class GameRoom
  extends DurableObject {

  constructor(ctx, env) {
    super(ctx, env);

    this.ctx = ctx;
    this.env = env;
  }

  async getState() {
    let state =
      await this.ctx.storage.get("state");

    if (!state) {
      state =
        initialState("------");

      await this.ctx.storage.put(
        "state",
        state
      );
    }

    return state;
  }

  async save(state) {
    state.updatedAt =
      Date.now();

    await this.ctx.storage.put(
      "state",
      state
    );

    await updateDirectory(
      this.env,
      {
        code: state.code,
        phase: state.phase,
        players: state.players,
        turn: state.turn,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt
      }
    );
  }

  broadcast(state) {
    const message =
      JSON.stringify({
        type: "state",
        state
      });

    for (
      const socket of
      this.ctx.getWebSockets()
    ) {
      try {
        socket.send(message);
      } catch {}
    }
  }

  async fetch(request) {
    const url =
      new URL(request.url);

    if (
      url.pathname === "/init" &&
      request.method === "POST"
    ) {
      const body =
        await request.json();

      let state =
        await this.ctx.storage.get("state");

      if (!state) {
        state =
          initialState(body.code);

        state.createdBy =
          body.createdBy || "";

        await this.save(state);
      }

      return json({ ok: true });
    }

    if (url.pathname === "/state") {
      return json(
        await this.getState()
      );
    }

    if (
      request.headers.get("Upgrade") ===
      "websocket"
    ) {
      const pair =
        new WebSocketPair();

      const client =
        pair[0];

      const server =
        pair[1];

      this.ctx.acceptWebSocket(server);

      const state =
        await this.getState();

      server.send(
        JSON.stringify({
          type: "state",
          state
        })
      );

      return new Response(
        null,
        {
          status: 101,
          webSocket: client
        }
      );
    }

    return new Response(
      "Not found",
      { status: 404 }
    );
  }

  async webSocketMessage(ws, message) {
    let msg;

    try {
      msg =
        JSON.parse(message);
    } catch {
      return;
    }

    const state =
      await this.getState();


    /* JOIN */

    if (msg.type === "join") {
      const playerId =
        String(msg.playerId || "");

      const name =
        String(msg.name || "")
          .trim()
          .slice(0, 24);

      const seat =
        Number(msg.seat);

      if (
        !playerId ||
        !name ||
        seat < 0 ||
        seat > 3
      ) {
        return;
      }

      const occupied =
        state.players.find(
          player =>
            player.seat === seat &&
            player.id !== playerId
        );

      if (occupied) {
        ws.send(
          JSON.stringify({
            type: "error",
            message:
              "That side is already taken."
          })
        );

        return;
      }

      let player =
        state.players.find(
          player =>
            player.id === playerId
        );

      if (!player) {
        player = {
          id: playerId,
          name,
          seat
        };

        state.players.push(player);

        state.log.unshift(
          `${name} joined as ${SIDE_NAMES[seat]}.`
        );
      } else {
        player.name = name;
        player.seat = seat;

        state.log.unshift(
          `${name} selected ${SIDE_NAMES[seat]}.`
        );
      }

      await this.save(state);
      this.broadcast(state);

      return;
    }


    /* LEAVE LOBBY */

    if (
      msg.type === "leaveLobby" &&
      state.phase === "lobby"
    ) {
      const leaving =
        state.players.find(
          player =>
            player.id === msg.playerId
        );

      state.players =
        state.players.filter(
          player =>
            player.id !== msg.playerId
        );

      if (leaving) {
        state.log.unshift(
          `${leaving.name} left the lobby.`
        );
      }

      await this.save(state);
      this.broadcast(state);

      return;
    }


    const player =
      state.players.find(
        player =>
          player.id === msg.playerId
      );


    /* START */

    if (msg.type === "start") {
      if (
        state.phase !== "lobby" ||
        !player
      ) {
        return;
      }

      const occupiedSeats =
        getOccupiedSeats(state);

      state.phase = "playing";
      state.turn = 1;
      state.activeSeat =
        occupiedSeats[0];

      state.log.unshift(
        `Turn 1 begins. ${
          SIDE_NAMES[state.activeSeat]
        } acts first.`
      );

      await this.save(state);
      this.broadcast(state);

      return;
    }


    /* FINISH */

    if (msg.type === "finish") {
      if (
        !player ||
        state.phase !== "playing"
      ) {
        return;
      }

      state.phase = "finished";
      state.finishedAt = Date.now();

      state.log.unshift(
        `${player.name} ended the game.`
      );

      await this.save(state);
      this.broadcast(state);

      return;
    }


    if (
      !player ||
      state.phase !== "playing"
    ) {
      return;
    }

    if (
      player.seat !==
      state.activeSeat
    ) {
      return;
    }


    /* MOVE */

    if (msg.type === "move") {
      const unit =
        state.units.find(
          unit =>
            unit.id === msg.unitId
        );

      const destination =
        state.hexes.find(
          hex =>
            hex.q === Number(msg.q) &&
            hex.r === Number(msg.r)
        );

      if (
        !unit ||
        !destination ||
        unit.owner !== player.seat
      ) {
        return;
      }

      if (
        unit.movedTurn === state.turn ||
        unit.attackedTurn === state.turn
      ) {
        return;
      }

      const distance =
        hexDistance(
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

      /*
        STACKING IS LEGAL.

        There is intentionally NO
        occupied-hex rejection here.
      */

      unit.q =
        destination.q;

      unit.r =
        destination.r;

      unit.movedTurn =
        state.turn;

      state.log.unshift(
        `${player.name} moved ${unit.label}.`
      );

      await this.save(state);
      this.broadcast(state);

      return;
    }


    /* ATTACK */

    if (msg.type === "attack") {
      const attacker =
        state.units.find(
          unit =>
            unit.id === msg.attackerId
        );

      const defender =
        state.units.find(
          unit =>
            unit.id === msg.defenderId
        );

      if (
        !attacker ||
        !defender
      ) {
        return;
      }

      if (
        attacker.owner !== player.seat ||
        defender.owner === player.seat
      ) {
        return;
      }

      if (
        attacker.attackedTurn === state.turn
      ) {
        return;
      }

      if (
        attacker.domain !== defender.domain
      ) {
        return;
      }

      if (
        hexDistance(
          attacker,
          defender
        ) !== 1
      ) {
        return;
      }

      const roll =
        1 +
        Math.floor(
          Math.random() * 6
        );

      const result =
        attacker.attack +
        roll -
        defender.defense;

      attacker.attackedTurn =
        state.turn;

      if (result >= 4) {
        defender.steps--;

        state.log.unshift(
          `${attacker.label} attacks ${defender.label}: defender loses 1 step.`
        );

        if (
          defender.steps <= 0
        ) {
          state.units =
            state.units.filter(
              unit =>
                unit.id !== defender.id
            );
        }
      } else if (
        result <= 0
      ) {
        attacker.steps--;

        state.log.unshift(
          `${attacker.label} attacks ${defender.label}: attacker loses 1 step.`
        );

        if (
          attacker.steps <= 0
        ) {
          state.units =
            state.units.filter(
              unit =>
                unit.id !== attacker.id
            );
        }
      } else {
        state.log.unshift(
          `${attacker.label} attacks ${defender.label}: no losses.`
        );
      }

      await this.save(state);
      this.broadcast(state);

      return;
    }


    /* END TURN */

    if (msg.type === "endTurn") {
      const occupiedSeats =
        getOccupiedSeats(state);

      if (
        occupiedSeats.length === 1
      ) {
        state.turn++;
      } else {
        let index =
          occupiedSeats.indexOf(
            state.activeSeat
          );

        index =
          (index + 1) %
          occupiedSeats.length;

        if (index === 0) {
          state.turn++;
        }

        state.activeSeat =
          occupiedSeats[index];
      }

      state.log.unshift(
        `Turn ${state.turn}: ${
          SIDE_NAMES[state.activeSeat]
        }.`
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
        player =>
          player.seat
      )
    )
  ].sort(
    (a, b) =>
      a - b
  );
}


/*
  AXIAL HEX DISTANCE
*/

function hexDistance(a, b) {
  const as =
    -a.q - a.r;

  const bs =
    -b.q - b.r;

  return Math.max(
    Math.abs(a.q - b.q),
    Math.abs(a.r - b.r),
    Math.abs(as - bs)
  );
}


/*
  POINTY-TOP HEX GRID

  Crucially, positions use true
  hex spacing:

  horizontal = sqrt(3) * radius
  vertical   = 1.5 * radius

  This prevents overlapping cells.
*/

function createHexes() {
  const hexes = [];

  const cols = 13;
  const rows = 13;

  const centerLat =
    31.3;

  const centerLng =
    52.2;

  const latStep =
    1.42;

  const lngStep =
    1.62;

  for (
    let q = 0;
    q < cols;
    q++
  ) {
    for (
      let r = 0;
      r < rows;
      r++
    ) {
      const lng =
        42.5 +
        q * lngStep;

      const lat =
        39.3 -
        r * latStep -
        q * latStep * 0.5;

      if (
        lat < 22 ||
        lat > 40.5
      ) {
        continue;
      }

      hexes.push({
        q,
        r,
        lat,
        lng,
        domain:
          isSea(lat, lng)
            ? "sea"
            : "land"
      });
    }
  }

  return hexes;
}


function isSea(lat, lng) {
  const gulf =
    lat >= 24 &&
    lat <= 30.3 &&
    lng >= 48 &&
    lng <= 57 &&
    lat <
      37.6 -
      0.17 * lng;

  const oman =
    lat >= 22 &&
    lat <= 26.8 &&
    lng > 56 &&
    lng <= 62;

  return gulf || oman;
}


function initialState(code) {
  return {
    code,

    phase: "lobby",

    createdAt:
      Date.now(),

    updatedAt:
      Date.now(),

    finishedAt:
      null,

    turn: 0,

    activeSeat: 0,

    players: [],

    tracks: {
      escalation: 1,
      coalitionSupport: 4,
      regionalStability: 4
    },

    hexes:
      createHexes(),

    units: [
      {
        id: "c-land-1",
        owner: 0,

        label:
          "Coalition I Corps",

        designation:
          "I CORPS",

        type:
          "infantry",

        q: 2,
        r: 4,

        attack: 4,
        defense: 3,
        move: 2,
        steps: 3,

        domain:
          "land",

        movedTurn: 0,
        attackedTurn: 0
      },

      {
        id: "c-land-2",
        owner: 0,

        label:
          "Coalition Expeditionary Force",

        designation:
          "EXP FORCE",

        type:
          "armor",

        q: 2,
        r: 5,

        attack: 3,
        defense: 3,
        move: 2,
        steps: 3,

        domain:
          "land",

        movedTurn: 0,
        attackedTurn: 0
      },

      {
        id: "c-navy-1",
        owner: 0,

        label:
          "Coalition Carrier Group",

        designation:
          "CVBG",

        type:
          "naval",

        q: 8,
        r: 8,

        attack: 4,
        defense: 4,
        move: 3,
        steps: 3,

        domain:
          "naval",

        movedTurn: 0,
        attackedTurn: 0
      },

      {
        id: "iran-1",
        owner: 1,

        label:
          "Iranian Western Army",

        designation:
          "WEST ARMY",

        type:
          "infantry",

        q: 6,
        r: 3,

        attack: 3,
        defense: 4,
        move: 1,
        steps: 3,

        domain:
          "land",

        movedTurn: 0,
        attackedTurn: 0
      },

      {
        id: "iran-2",
        owner: 1,

        label:
          "Iranian Central Army",

        designation:
          "CENT ARMY",

        type:
          "infantry",

        q: 8,
        r: 4,

        attack: 3,
        defense: 4,
        move: 1,
        steps: 3,

        domain:
          "land",

        movedTurn: 0,
        attackedTurn: 0
      },

      {
        id: "iran-navy",
        owner: 1,

        label:
          "Iranian Gulf Fleet",

        designation:
          "GULF FLT",

        type:
          "naval",

        q: 8,
        r: 8,

        attack: 3,
        defense: 3,
        move: 2,
        steps: 2,

        domain:
          "naval",

        movedTurn: 0,
        attackedTurn: 0
      },

      {
        id: "regional-1",
        owner: 2,

        label:
          "Regional Coalition",

        designation:
          "REGIONAL",

        type:
          "infantry",

        q: 4,
        r: 7,

        attack: 2,
        defense: 3,
        move: 1,
        steps: 2,

        domain:
          "land",

        movedTurn: 0,
        attackedTurn: 0
      },

      {
        id: "irregular-1",
        owner: 3,

        label:
          "Irregular Formation",

        designation:
          "IRREG",

        type:
          "irregular",

        q: 5,
        r: 5,

        attack: 2,
        defense: 2,
        move: 2,
        steps: 2,

        domain:
          "land",

        movedTurn: 0,
        attackedTurn: 0
      }
    ],

    log: [
      "Game created. Choose a side."
    ]
  };
}
