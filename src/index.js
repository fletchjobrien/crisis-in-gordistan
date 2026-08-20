import { DurableObject } from "cloudflare:workers";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/create" && request.method === "POST") {
      const code = randomCode();
      const id = env.GAMES.idFromName(code);
      const stub = env.GAMES.get(id);
      await stub.fetch("https://room/init", {
        method: "POST",
        body: JSON.stringify({ code })
      });
      return json({ code });
    }

    const match = url.pathname.match(/^\/api\/game\/([A-Z0-9]{6})$/);
    if (match && request.method === "GET") {
      const id = env.GAMES.idFromName(match[1]);
      return env.GAMES.get(id).fetch("https://room/state");
    }

    const wsMatch = url.pathname.match(/^\/ws\/([A-Z0-9]{6})$/);
    if (wsMatch && request.headers.get("Upgrade") === "websocket") {
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
    const payload = JSON.stringify({ type: "state", state });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(payload); } catch {}
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      const { code } = await request.json();
      const existing = await this.ctx.storage.get("state");
      if (!existing) await this.save(initialState(code));
      return json({ ok: true });
    }

    if (url.pathname === "/state") {
      return json(await this.getState());
    }

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      const state = await this.getState();
      server.send(JSON.stringify({ type: "state", state }));
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws, message) {
    let msg;
    try { msg = JSON.parse(message); } catch { return; }

    const state = await this.getState();

    if (msg.type === "join") {
      const name = String(msg.name || "").trim().slice(0, 24);
      const seat = Number(msg.seat);
      if (!name || seat < 0 || seat > 3) return;

      const taken = state.players.find(p => p.seat === seat && p.id !== msg.playerId);
      if (taken) {
        ws.send(JSON.stringify({ type: "error", message: "That seat is already taken." }));
        return;
      }

      let p = state.players.find(p => p.id === msg.playerId);
      if (!p) {
        p = { id: msg.playerId, name, seat };
        state.players.push(p);
      } else {
        p.name = name;
        p.seat = seat;
      }
      await this.save(state);
      this.broadcast(state);
      return;
    }

    const player = state.players.find(p => p.id === msg.playerId);
    if (!player) return;

    if (msg.type === "start") {
      if (state.phase !== "lobby") return;
      if (state.players.length < 2) return;
      state.phase = "playing";
      state.turn = 1;
      state.activeSeat = 0;
      state.log.unshift("Turn 1 begins.");
      await this.save(state);
      this.broadcast(state);
      return;
    }

    if (state.phase !== "playing") return;
    if (player.seat !== state.activeSeat) return;

    if (msg.type === "move") {
      const unit = state.units.find(u => u.id === msg.unitId);
      const dest = state.hexes.find(h => h.q === msg.q && h.r === msg.r);
      if (!unit || !dest || unit.owner !== player.seat) return;
      if (hexDistance(unit, dest) > unit.move) return;

      const occupied = state.units.find(u => u.q === dest.q && u.r === dest.r && u.id !== unit.id);
      if (occupied) return;

      unit.q = dest.q;
      unit.r = dest.r;
      state.log.unshift(`${player.name} moved ${unit.label}.`);
      await this.save(state);
      this.broadcast(state);
      return;
    }

    if (msg.type === "attack") {
      const attacker = state.units.find(u => u.id === msg.attackerId);
      const defender = state.units.find(u => u.id === msg.defenderId);
      if (!attacker || !defender) return;
      if (attacker.owner !== player.seat || defender.owner === player.seat) return;
      if (hexDistance(attacker, defender) !== 1) return;

      // Intentionally abstract combat: a simple odds + d6 system.
      const roll = 1 + Math.floor(Math.random() * 6);
      const score = attacker.attack + roll - defender.defense;
      if (score >= 4) {
        defender.steps -= 1;
        state.log.unshift(`${attacker.label} attacked ${defender.label}: defender loses 1 step.`);
        if (defender.steps <= 0) {
          state.units = state.units.filter(u => u.id !== defender.id);
          state.log.unshift(`${defender.label} eliminated.`);
        }
      } else if (score <= 0) {
        attacker.steps -= 1;
        state.log.unshift(`${attacker.label} attacked ${defender.label}: attacker loses 1 step.`);
        if (attacker.steps <= 0) {
          state.units = state.units.filter(u => u.id !== attacker.id);
          state.log.unshift(`${attacker.label} eliminated.`);
        }
      } else {
        state.log.unshift(`${attacker.label} attacked ${defender.label}: no loss.`);
      }
      await this.save(state);
      this.broadcast(state);
      return;
    }

    if (msg.type === "endTurn") {
      const occupiedSeats = [...new Set(state.players.map(p => p.seat))].sort();
      let i = occupiedSeats.indexOf(state.activeSeat);
      i = (i + 1) % occupiedSeats.length;
      if (i === 0) state.turn += 1;
      state.activeSeat = occupiedSeats[i];
      state.log.unshift(`Turn ${state.turn}: ${seatName(state.activeSeat)} acts.`);
      await this.save(state);
      this.broadcast(state);
    }
  }
}

function seatName(seat) {
  return ["Coalition", "Iran", "Regional States", "Nonstate / Political"][seat] || `Seat ${seat + 1}`;
}

function hexDistance(a, b) {
  const aq = a.q, ar = a.r, as = -aq - ar;
  const bq = b.q, br = b.r, bs = -bq - br;
  return Math.max(Math.abs(aq-bq), Math.abs(ar-br), Math.abs(as-bs));
}

function initialState(code) {
  const hexes = [];
  for (let r = 0; r < 8; r++) {
    for (let q = 0; q < 11; q++) {
      // small irregular edges
      if ((r === 0 && (q < 1 || q > 8)) || (r === 7 && q > 8)) continue;
      const terrain =
        (q === 5 && r >= 1 && r <= 6) ? "mountain" :
        ((q + r) % 7 === 0 ? "city" :
        ((q * 3 + r) % 9 === 0 ? "desert" : "plain"));
      hexes.push({ q, r, terrain });
    }
  }

  return {
    code,
    phase: "lobby",
    turn: 0,
    activeSeat: 0,
    players: [],
    tracks: {
      escalation: 1,
      regionalSupport: 3,
      worldOpinion: 3
    },
    hexes,
    units: [
      { id: "c1", owner: 0, label: "I Corps", q: 1, r: 2, attack: 4, defense: 3, move: 2, steps: 3 },
      { id: "c2", owner: 0, label: "Air Wing", q: 1, r: 4, attack: 3, defense: 2, move: 3, steps: 2 },
      { id: "i1", owner: 1, label: "1st Army", q: 7, r: 2, attack: 3, defense: 4, move: 1, steps: 3 },
      { id: "i2", owner: 1, label: "Guard Corps", q: 7, r: 5, attack: 4, defense: 4, move: 1, steps: 3 },
      { id: "r1", owner: 2, label: "Regional Force", q: 3, r: 6, attack: 2, defense: 3, move: 1, steps: 2 },
      { id: "n1", owner: 3, label: "Irregulars", q: 5, r: 4, attack: 2, defense: 2, move: 2, steps: 2 }
    ],
    log: ["Game created. Choose seats, then start."]
  };
}
