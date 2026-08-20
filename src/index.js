import { DurableObject } from "cloudflare:workers";

const JSON_HEADERS = {
  "content-type":
    "application/json; charset=utf-8"
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
    env.DIRECTORY.idFromName(
      "main-directory"
    )
  );
}

async function updateDirectory(
  env,
  game
) {
  try {
    await directoryStub(env).fetch(
      "https://directory/update",
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json"
        },

        body:
          JSON.stringify(game)
      }
    );
  } catch (error) {
    console.log(
      "Directory update failed",
      error
    );
  }
}

export default {
  async fetch(request, env) {
    const url =
      new URL(request.url);

    /*
      CREATE GAME
    */

    if (
      url.pathname ===
        "/api/create" &&
      request.method ===
        "POST"
    ) {
      const body =
        await request
          .json()
          .catch(() => ({}));

      const code =
        randomCode();

      await gameStub(
        env,
        code
      ).fetch(
        "https://room/init",
        {
          method: "POST",

          headers: {
            "content-type":
              "application/json"
          },

          body:
            JSON.stringify({
              code,

              createdBy:
                String(
                  body.playerId ||
                    ""
                )
            })
        }
      );

      return json({
        code
      });
    }

    /*
      MAIN MENU DIRECTORY
    */

    if (
      url.pathname ===
      "/api/directory"
    ) {
      const playerId =
        url.searchParams.get(
          "playerId"
        ) || "";

      return directoryStub(
        env
      ).fetch(
        "https://directory/list" +
          "?playerId=" +
          encodeURIComponent(
            playerId
          )
      );
    }

    /*
      NORMAL STATE FETCH

      This is also used as a
      WebSocket fallback.
    */

    const stateMatch =
      url.pathname.match(
        /^\/api\/game\/([A-Z0-9]{6})$/
      );

    if (
      stateMatch &&
      request.method ===
        "GET"
    ) {
      return gameStub(
        env,
        stateMatch[1]
      ).fetch(
        "https://room/state"
      );
    }

    /*
      WEBSOCKET
    */

    const wsMatch =
      url.pathname.match(
        /^\/ws\/([A-Z0-9]{6})$/
      );

    if (
      wsMatch &&
      request.headers.get(
        "Upgrade"
      ) === "websocket"
    ) {
      return gameStub(
        env,
        wsMatch[1]
      ).fetch(request);
    }

    return env.ASSETS.fetch(
      request
    );
  }
};

/*
  GAME DIRECTORY

  Stores only enough data to show
  games on the main menu.
*/

export class GameDirectory
  extends DurableObject {

  constructor(ctx, env) {
    super(ctx, env);

    this.ctx = ctx;
  }

  async getGames() {
    return (
      (await this.ctx.storage.get(
        "games"
      )) || {}
    );
  }

  async fetch(request) {
    const url =
      new URL(request.url);

    if (
      url.pathname ===
        "/update" &&
      request.method ===
        "POST"
    ) {
      const game =
        await request.json();

      if (!game.code) {
        return json(
          {
            error:
              "Missing code"
          },
          400
        );
      }

      const games =
        await this.getGames();

      games[game.code] = {
        ...(games[
          game.code
        ] || {}),

        ...game,

        updatedAt:
          Date.now()
      };

      await this.ctx.storage.put(
        "games",
        games
      );

      return json({
        ok: true
      });
    }

    if (
      url.pathname ===
      "/list"
    ) {
      const playerId =
        url.searchParams.get(
          "playerId"
        ) || "";

      const gamesObject =
        await this.getGames();

      const allGames =
        Object.values(
          gamesObject
        )
          .filter(
            game =>
              game &&
              game.code
          )
          .sort(
            (a, b) =>
              (b.updatedAt || 0) -
              (a.updatedAt || 0)
          );

      /*
        Any waiting lobby is
        globally joinable.
      */

      const joinable =
        allGames.filter(
          game =>
            game.phase ===
            "lobby"
        );

      /*
        Games where this device's
        player ID already has a seat.
      */

      const mine =
        allGames.filter(
          game =>
            game.phase !==
              "finished" &&
            (
              game.players ||
              []
            ).some(
              player =>
                player.id ===
                playerId
            )
        );

      const finished =
        allGames.filter(
          game =>
            game.phase ===
              "finished" &&
            (
              game.players ||
              []
            ).some(
              player =>
                player.id ===
                playerId
            )
        );

      return json({
        joinable,
        mine,
        finished
      });
    }

    return new Response(
      "Not found",
      {
        status: 404
      }
    );
  }
}

/*
  INDIVIDUAL GAME ROOM
*/

export class GameRoom
  extends DurableObject {

  constructor(ctx, env) {
    super(ctx, env);

    this.ctx = ctx;
    this.env = env;
  }

  async getState() {
    let state =
      await this.ctx.storage.get(
        "state"
      );

    if (!state) {
      state =
        initialState(
          "------"
        );

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
        code:
          state.code,

        phase:
          state.phase,

        players:
          state.players,

        turn:
          state.turn,

        createdAt:
          state.createdAt,

        updatedAt:
          state.updatedAt
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
        socket.send(
          message
        );
      } catch {}
    }
  }

  async fetch(request) {
    const url =
      new URL(request.url);

    /*
      INITIALIZE
    */

    if (
      url.pathname ===
        "/init" &&
      request.method ===
        "POST"
    ) {
      const body =
        await request.json();

      let state =
        await this.ctx.storage.get(
          "state"
        );

      if (!state) {
        state =
          initialState(
            body.code
          );

        state.createdBy =
          body.createdBy || "";

        await this.save(
          state
        );
      }

      return json({
        ok: true
      });
    }

    /*
      POLLING STATE
    */

    if (
      url.pathname ===
      "/state"
    ) {
      return json(
        await this.getState()
      );
    }

    /*
      WEBSOCKET CONNECT
    */

    if (
      request.headers.get(
        "Upgrade"
      ) === "websocket"
    ) {
      const pair =
        new WebSocketPair();

      const client =
        pair[0];

      const server =
        pair[1];

      this.ctx.acceptWebSocket(
        server
      );

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
          webSocket:
            client
        }
      );
    }

    return new Response(
      "Not found",
      {
        status: 404
      }
    );
  }

  async webSocketMessage(
    ws,
    message
  ) {
    let msg;

    try {
      msg =
        JSON.parse(
          message
        );
    } catch {
      return;
    }

    const state =
      await this.getState();

    /*
      JOIN / CHOOSE SIDE
    */

    if (
      msg.type === "join"
    ) {
      const playerId =
        String(
          msg.playerId ||
            ""
        );

      const name =
        String(
          msg.name || ""
        )
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
            player.seat ===
              seat &&
            player.id !==
              playerId
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
            player.id ===
            playerId
        );

      const isNew =
        !player;

      if (!player) {
        player = {
          id:
            playerId,

          name,

          seat
        };

        state.players.push(
          player
        );
      } else {
        player.name =
          name;

        player.seat =
          seat;
      }

      state.log.unshift(
        isNew
          ? `${name} joined as ${SIDE_NAMES[seat]}.`
          : `${name} selected ${SIDE_NAMES[seat]}.`
      );

      /*
        Save FIRST,
        broadcast SECOND.

        Everyone connected gets the
        new authoritative lobby state.
      */

      await this.save(
        state
      );

      this.broadcast(
        state
      );

      return;
    }

    /*
      LEAVE LOBBY

      Releases your seat.
    */

    if (
      msg.type ===
      "leaveLobby"
    ) {
      if (
        state.phase !==
        "lobby"
      ) {
        return;
      }

      const leaving =
        state.players.find(
          player =>
            player.id ===
            msg.playerId
        );

      state.players =
        state.players.filter(
          player =>
            player.id !==
            msg.playerId
        );

      if (leaving) {
        state.log.unshift(
          `${leaving.name} left the lobby.`
        );
      }

      await this.save(
        state
      );

      this.broadcast(
        state
      );

      return;
    }

    const player =
      state.players.find(
        player =>
          player.id ===
          msg.playerId
      );

    /*
      START GAME

      IMPORTANT:
      Only ONE player is required.

      This makes solo testing easy.
    */

    if (
      msg.type === "start"
    ) {
      if (
        state.phase !==
        "lobby"
      ) {
        return;
      }

      if (!player) {
        ws.send(
          JSON.stringify({
            type: "error",

            message:
              "Take a side before starting."
          })
        );

        return;
      }

      const occupiedSeats =
        getOccupiedSeats(
          state
        );

      if (
        !occupiedSeats.length
      ) {
        return;
      }

      /*
        No fake waiting phase.
        No timeout.
        Start immediately.
      */

      state.phase =
        "playing";

      state.turn = 1;

      state.activeSeat =
        occupiedSeats[0];

      state.log.unshift(
        `Turn 1 begins. ${
          SIDE_NAMES[
            state.activeSeat
          ]
        } acts first.`
      );

      await this.save(
        state
      );

      this.broadcast(
        state
      );

      return;
    }

    /*
      FINISH GAME
    */

    if (
      msg.type ===
      "finish"
    ) {
      if (
        !player ||
        state.phase !==
          "playing"
      ) {
        return;
      }

      state.phase =
        "finished";

      state.finishedAt =
        Date.now();

      state.log.unshift(
        `${player.name} ended the game.`
      );

      await this.save(
        state
      );

      this.broadcast(
        state
      );

      return;
    }

    if (
      !player ||
      state.phase !==
        "playing"
    ) {
      return;
    }

    if (
      player.seat !==
      state.activeSeat
    ) {
      return;
    }

    /*
      MOVE
    */

    if (
      msg.type === "move"
    ) {
      const unit =
        state.units.find(
          unit =>
            unit.id ===
            msg.unitId
        );

      const destination =
        state.hexes.find(
          hex =>
            hex.q ===
              Number(
                msg.q
              ) &&
            hex.r ===
              Number(
                msg.r
              )
        );

      if (
        !unit ||
        !destination
      ) {
        return;
      }

      if (
        unit.owner !==
        player.seat
      ) {
        return;
      }

      if (
        unit.movedTurn ===
          state.turn ||
        unit.attackedTurn ===
          state.turn
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
        distance >
          unit.move
      ) {
        return;
      }

      if (
        unit.domain ===
          "naval" &&
        destination.domain !==
          "sea"
      ) {
        return;
      }

      if (
        unit.domain ===
          "land" &&
        destination.domain ===
          "sea"
      ) {
        return;
      }

      const occupied =
        state.units.find(
          other =>
            other.id !==
              unit.id &&
            other.q ===
              destination.q &&
            other.r ===
              destination.r
        );

      if (occupied) {
        return;
      }

      unit.q =
        destination.q;

      unit.r =
        destination.r;

      unit.movedTurn =
        state.turn;

      state.log.unshift(
        `${player.name} moved ${unit.label}.`
      );

      await this.save(
        state
      );

      this.broadcast(
        state
      );

      return;
    }

    /*
      ATTACK
    */

    if (
      msg.type ===
      "attack"
    ) {
      const attacker =
        state.units.find(
          unit =>
            unit.id ===
            msg.attackerId
        );

      const defender =
        state.units.find(
          unit =>
            unit.id ===
            msg.defenderId
        );

      if (
        !attacker ||
        !defender
      ) {
        return;
      }

      if (
        attacker.owner !==
        player.seat ||
        defender.owner ===
        player.seat
      ) {
        return;
      }

      if (
        attacker.attackedTurn ===
        state.turn
      ) {
        return;
      }

      if (
        attacker.domain !==
        defender.domain
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

      if (
        result >= 4
      ) {
        defender.steps -= 1;

        state.log.unshift(
          `${attacker.label} attacks ${defender.label}: defender loses 1 step.`
        );

        if (
          defender.steps <=
          0
        ) {
          state.units =
            state.units.filter(
              unit =>
                unit.id !==
                defender.id
            );

          state.log.unshift(
            `${defender.label} destroyed.`
          );
        }
      } else if (
        result <= 0
      ) {
        attacker.steps -= 1;

        state.log.unshift(
          `${attacker.label} attacks ${defender.label}: attacker loses 1 step.`
        );

        if (
          attacker.steps <=
          0
        ) {
          state.units =
            state.units.filter(
              unit =>
                unit.id !==
                attacker.id
            );

          state.log.unshift(
            `${attacker.label} destroyed.`
          );
        }
      } else {
        state.log.unshift(
          `${attacker.label} attacks ${defender.label}: no losses.`
        );
      }

      await this.save(
        state
      );

      this.broadcast(
        state
      );

      return;
    }

    /*
      END TURN
    */

    if (
      msg.type ===
      "endTurn"
    ) {
      const occupiedSeats =
        getOccupiedSeats(
          state
        );

      if (
        !occupiedSeats.length
      ) {
        return;
      }

      /*
        SOLO TEST GAME

        End Turn simply moves
        forward another turn.
      */

      if (
        occupiedSeats.length ===
        1
      ) {
        state.turn += 1;

        state.activeSeat =
          occupiedSeats[0];
      } else {
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
      }

      state.log.unshift(
        `Turn ${
          state.turn
        }: ${
          SIDE_NAMES[
            state.activeSeat
          ]
        }.`
      );

      await this.save(
        state
      );

      this.broadcast(
        state
      );
    }
  }
}

function getOccupiedSeats(
  state
) {
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

function hexDistance(
  a,
  b
) {
  const as =
    -a.q - a.r;

  const bs =
    -b.q - b.r;

  return Math.max(
    Math.abs(
      a.q - b.q
    ),

    Math.abs(
      a.r - b.r
    ),

    Math.abs(
      as - bs
    )
  );
}

function createHexes() {
  const hexes = [];

  const columns = 14;
  const rows = 9;

  for (
    let q = 0;
    q < columns;
    q++
  ) {
    for (
      let r = 0;
      r < rows;
      r++
    ) {
      const lat =
        38.7 -
        r * 1.85 -
        (
          q % 2
            ? 0.925
            : 0
        );

      const lng =
        43.3 +
        q * 1.67;

      hexes.push({
        q,
        r,
        lat,
        lng,

        domain:
          isSea(
            lat,
            lng
          )
            ? "sea"
            : "land"
      });
    }
  }

  return hexes;
}

function isSea(
  lat,
  lng
) {
  const persianGulf =
    lat >= 24 &&
    lat <= 29.8 &&
    lng >= 49 &&
    lng <= 56.5 &&
    lat <
      36.2 -
        lng *
          0.14;

  const gulfOfOman =
    lat >= 22 &&
    lat <= 26.8 &&
    lng > 56 &&
    lng <= 63.5;

  return (
    persianGulf ||
    gulfOfOman
  );
}

function initialState(
  code
) {
  return {
    code,

    phase:
      "lobby",

    createdAt:
      Date.now(),

    updatedAt:
      Date.now(),

    finishedAt:
      null,

    createdBy:
      "",

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
        id:
          "c-land-1",

        owner: 0,

        label:
          "Coalition I Corps",

        q: 2,
        r: 3,

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
        id:
          "c-land-2",

        owner: 0,

        label:
          "Coalition Expeditionary Force",

        q: 3,
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
        id:
          "c-navy-1",

        owner: 0,

        label:
          "Coalition Carrier Group",

        q: 7,
        r: 7,

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
        id:
          "iran-1",

        owner: 1,

        label:
          "Iranian Western Army",

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
        id:
          "iran-2",

        owner: 1,

        label:
          "Iranian Central Army",

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
        id:
          "iran-navy",

        owner: 1,

        label:
          "Iranian Gulf Fleet",

        q: 8,
        r: 7,

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
        id:
          "regional-1",

        owner: 2,

        label:
          "Regional Coalition",

        q: 4,
        r: 6,

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
        id:
          "irregular-1",

        owner: 3,

        label:
          "Irregular Formation",

        q: 5,
        r: 4,

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

    locations: [
      {
        name:
          "Tehran",
        lat: 35.6892,
        lng: 51.389
      },

      {
        name:
          "Isfahan",
        lat: 32.6546,
        lng: 51.668
      },

      {
        name:
          "Shiraz",
        lat: 29.5918,
        lng: 52.5837
      },

      {
        name:
          "Bandar Abbas",
        lat: 27.1832,
        lng: 56.2666
      },

      {
        name:
          "Baghdad",
        lat: 33.3152,
        lng: 44.3661
      },

      {
        name:
          "Kuwait City",
        lat: 29.3759,
        lng: 47.9774
      },

      {
        name:
          "Doha",
        lat: 25.2854,
        lng: 51.531
      },

      {
        name:
          "Manama",
        lat: 26.2235,
        lng: 50.5876
      },

      {
        name:
          "Abu Dhabi",
        lat: 24.4539,
        lng: 54.3773
      },

      {
        name:
          "Muscat",
        lat: 23.588,
        lng: 58.3829
      }
    ],

    log: [
      "Game created. Choose a side."
    ]
  };
}
