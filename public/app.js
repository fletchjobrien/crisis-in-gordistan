const $ = s => document.querySelector(s);

let code = null;
let ws = null;
let state = null;
let selected = null;
let playerId = localStorage.cigPlayerId || crypto.randomUUID();
localStorage.cigPlayerId = playerId;

const seats = ["Coalition", "Iran", "Regional States", "Nonstate / Political"];

$("#createBtn").onclick = async () => {
  const r = await fetch("/api/create", { method: "POST" });
  const data = await r.json();
  location.hash = data.code;
  openRoom(data.code);
};

$("#joinRoomBtn").onclick = () => openRoom($("#joinCode").value.trim().toUpperCase());

$("#takeSeatBtn").onclick = () => send({
  type: "join",
  playerId,
  name: $("#playerName").value.trim(),
  seat: Number($("#seat").value)
});

$("#startBtn").onclick = () => send({ type: "start", playerId });
$("#endTurnBtn").onclick = () => send({ type: "endTurn", playerId });
$("#cancelBtn").onclick = () => { selected = null; render(); };

function send(obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function openRoom(roomCode) {
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) return alert("Enter a 6-character room code.");
  code = roomCode;
  $("#roomTag").textContent = `ROOM ${code}`;
  $("#seatBox").classList.remove("hidden");
  $("#joinCode").value = code;

  if (ws) ws.close();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/${code}`);
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === "state") {
      state = msg.state;
      render();
    } else if (msg.type === "error") {
      alert(msg.message);
    }
  };
}

function render() {
  if (!state) return;

  $("#players").innerHTML = state.players.length
    ? state.players.map(p => `${seats[p.seat]} — ${escapeHtml(p.name)}`).join("<br>")
    : "No seats taken yet.";

  const playing = state.phase === "playing";
  $("#lobby").classList.toggle("hidden", playing);
  $("#game").classList.toggle("hidden", !playing);
  if (!playing) return;

  $("#turnLabel").textContent = `TURN ${state.turn} · ${seats[state.activeSeat]} ACTIVE`;
  $("#tracks").innerHTML =
    `<span>Escalation ${state.tracks.escalation}/6</span>
     <span>Regional support ${state.tracks.regionalSupport}/6</span>
     <span>World opinion ${state.tracks.worldOpinion}/6</span>`;

  drawBoard();
  drawSelected();

  $("#log").innerHTML = state.log.slice(0, 40)
    .map(x => `<div class="logLine">${escapeHtml(x)}</div>`).join("");
}

function drawBoard() {
  const board = $("#board");
  board.innerHTML = "";

  for (const h of state.hexes) {
    const { x, y } = pixel(h.q, h.r);
    const el = document.createElement("button");
    el.className = `hex ${h.terrain}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.title = `${h.terrain} (${h.q},${h.r})`;
    el.onclick = () => clickHex(h);
    board.appendChild(el);
  }

  for (const u of state.units) {
    const { x, y } = pixel(u.q, u.r);
    const el = document.createElement("button");
    el.className = `counter s${u.owner}` + (selected?.id === u.id ? " selected" : "");
    el.style.left = `${x + 17}px`;
    el.style.top = `${y + 12}px`;
    el.innerHTML = `${escapeHtml(u.label.split(" ")[0])}<small>${u.steps}</small>`;
    el.title = `${u.label} · A${u.attack} D${u.defense} M${u.move} · ${u.steps} steps`;
    el.onclick = e => { e.stopPropagation(); clickUnit(u); };
    board.appendChild(el);
  }
}

function clickUnit(u) {
  const me = state.players.find(p => p.id === playerId);
  if (!me || me.seat !== state.activeSeat) return;

  if (!selected) {
    if (u.owner === me.seat) selected = u;
  } else if (selected.owner === me.seat && u.owner !== me.seat) {
    send({ type:"attack", playerId, attackerId:selected.id, defenderId:u.id });
    selected = null;
  } else if (u.owner === me.seat) {
    selected = u;
  }
  render();
}

function clickHex(h) {
  const me = state.players.find(p => p.id === playerId);
  if (!me || me.seat !== state.activeSeat || !selected) return;
  send({ type:"move", playerId, unitId:selected.id, q:h.q, r:h.r });
  selected = null;
}

function drawSelected() {
  if (!selected) {
    $("#selected").textContent = "Select one of your counters. Then click an empty hex to move, or an adjacent enemy counter to attack.";
    return;
  }
  $("#selected").innerHTML =
    `<b>${escapeHtml(selected.label)}</b><br>
     Attack ${selected.attack} · Defense ${selected.defense} · Move ${selected.move}<br>
     Steps ${selected.steps}`;
}

function pixel(q, r) {
  const w = 76, h = 66;
  return { x: q * (w * 0.75) + 24, y: r * h + (q % 2 ? h / 2 : 0) + 10 };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

if (location.hash.length > 1) openRoom(location.hash.slice(1).toUpperCase());
