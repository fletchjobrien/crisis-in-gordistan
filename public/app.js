const $ = selector =>
  document.querySelector(selector);

const sides = [
  "Coalition",
  "Iran",
  "Regional States",
  "Nonstate Forces"
];

const sideClasses = [
  "coalition",
  "iran",
  "regional",
  "nonstate"
];

let code = null;

let ws = null;

let state = null;

let selectedUnitId = null;

let hexLayers = [];

let unitLayers = [];

let placeLayers = [];

let playerId =
  localStorage.cigPlayerId ||
  crypto.randomUUID();

localStorage.cigPlayerId =
  playerId;

/*
  MAP
*/

const map = L.map(
  "map",
  {
    zoomControl: true,
    minZoom: 4,
    maxZoom: 9
  }
).setView(
  [30.7, 52.5],
  5
);

L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,

    attribution:
      "&copy; OpenStreetMap contributors"
  }
).addTo(map);

/*
  UI
*/

$("#createBtn").onclick =
  createGame;

$("#joinRoomBtn").onclick =
  () => {
    const room =
      $("#joinCode")
        .value
        .trim()
        .toUpperCase();

    openRoom(room);
  };

$("#takeSeatBtn").onclick =
  () => {
    const name =
      $("#playerName")
        .value
        .trim();

    if (!name) {
      alert("Enter your name.");
      return;
    }

    send({
      type: "join",

      playerId,

      name,

      seat:
        Number(
          $("#seat").value
        )
    });
  };

$("#startBtn").onclick =
  () => {
    showLoading(
      "Starting game…"
    );

    send({
      type: "start",
      playerId
    });
  };

$("#endTurnBtn").onclick =
  () => {
    selectedUnitId = null;

    send({
      type: "endTurn",
      playerId
    });
  };

$("#playersButton").onclick =
  () => {
    $("#playersDrawer")
      .classList
      .toggle("hidden");
  };

$("#closePlayers").onclick =
  () => {
    $("#playersDrawer")
      .classList
      .add("hidden");
  };

$("#logButton").onclick =
  () => {
    $("#logDrawer")
      .classList
      .remove("hidden");
  };

$("#closeLog").onclick =
  () => {
    $("#logDrawer")
      .classList
      .add("hidden");
  };

$("#clearSelection").onclick =
  () => {
    selectedUnitId = null;
    render();
  };

/*
  CREATE
*/

async function createGame() {
  showLoading(
    "Creating game…"
  );

  try {
    const response =
      await fetch(
        "/api/create",
        {
          method: "POST"
        }
      );

    const data =
      await response.json();

    location.hash =
      data.code;

    await openRoom(
      data.code
    );
  } catch {
    hideLoading();

    alert(
      "Could not create game."
    );
  }
}

/*
  OPEN ROOM
*/

async function openRoom(
  roomCode
) {
  roomCode =
    roomCode.toUpperCase();

  if (
    !/^[A-Z0-9]{6}$/.test(
      roomCode
    )
  ) {
    alert(
      "Enter a six-character room code."
    );

    return;
  }

  code = roomCode;

  $("#roomTag").textContent =
    `ROOM ${code}`;

  $("#joinCode").value =
    code;

  $("#seatBox")
    .classList
    .remove("hidden");

  showLoading(
    "Connecting…"
  );

  if (ws) {
    ws.close();
  }

  const protocol =
    location.protocol === "https:"
      ? "wss"
      : "ws";

  ws = new WebSocket(
    `${protocol}://${location.host}/ws/${code}`
  );

  ws.onopen =
    () => {
      hideLoading();
    };

  ws.onmessage =
    event => {
      const message =
        JSON.parse(
          event.data
        );

      if (
        message.type ===
        "state"
      ) {
        state =
          message.state;

        /*
          This is the important part:
          every WebSocket state update
          immediately rerenders the lobby
          or game.

          No manual refresh required.
        */

        render();
      }

      if (
        message.type ===
        "error"
      ) {
        hideLoading();

        alert(
          message.message
        );
      }
    };

  ws.onerror =
    () => {
      hideLoading();
    };

  ws.onclose =
    () => {
      /*
        Reconnect automatically if the
        connection disappears.
      */

      setTimeout(
        () => {
          if (
            code &&
            (!ws ||
              ws.readyState ===
                WebSocket.CLOSED)
          ) {
            openRoom(code);
          }
        },
        1500
      );
    };
}

/*
  SEND
*/

function send(message) {
  if (
    ws &&
    ws.readyState ===
      WebSocket.OPEN
  ) {
    ws.send(
      JSON.stringify(
        message
      )
    );
  }
}

/*
  RENDER
*/

function render() {
  if (!state) return;

  renderLobbyPlayers();

  if (
    state.phase ===
    "starting"
  ) {
    showLoading(
      "Deploying forces…"
    );

    return;
  }

  if (
    state.phase ===
    "lobby"
  ) {
    hideLoading();

    $("#lobby")
      .classList
      .remove("hidden");

    $("#turnPanel")
      .classList
      .add("hidden");

    $("#logButton")
      .classList
      .add("hidden");

    return;
  }

  hideLoading();

  $("#lobby")
    .classList
    .add("hidden");

  $("#turnPanel")
    .classList
    .remove("hidden");

  $("#logButton")
    .classList
    .remove("hidden");

  renderTurn();

  renderPlayers();

  renderTracks();

  renderHexes();

  renderLocations();

  renderUnits();

  renderSelected();

  renderLog();
}

/*
  LOBBY PLAYER LIST

  This updates every time any player joins,
  changes their side, reconnects, etc.
*/

function renderLobbyPlayers() {
  if (!state) return;

  const container =
    $("#lobbyPlayers");

  if (
    state.players.length ===
    0
  ) {
    container.innerHTML =
      "<div>No players yet.</div>";

    return;
  }

  const ordered =
    [...state.players]
      .sort(
        (a, b) =>
          a.seat - b.seat
      );

  container.innerHTML =
    ordered
      .map(
        (player, index) =>
          `
          <div class="lobbyPlayer">
            <strong>
              ${index + 1}.
              ${escapeHtml(
                player.name
              )}
            </strong>

            <div class="playerSeat">
              ${sides[player.seat]}
            </div>
          </div>
        `
      )
      .join("");
}

/*
  TURN INFO
*/

function renderTurn() {
  const active =
    state.players.find(
      player =>
        player.seat ===
        state.activeSeat
    );

  $("#turnLabel")
    .textContent =
      `TURN ${state.turn} · ${
        active
          ? active.name
          : sides[
              state.activeSeat
            ]
      }`;

  const me =
    getMe();

  $("#yourSide")
    .textContent =
      me
        ? `You: ${
            sides[me.seat]
          }`
        : "Spectating";

  const button =
    $("#endTurnBtn");

  button.disabled =
    !me ||
    me.seat !==
      state.activeSeat;
}

/*
  PLAYERS / TURN ORDER
*/

function renderPlayers() {
  const ordered =
    [...state.players]
      .sort(
        (a, b) =>
          a.seat - b.seat
      );

  $("#playerList")
    .innerHTML =
      ordered
        .map(
          (player, index) => {
            const active =
              player.seat ===
              state.activeSeat;

            const me =
              player.id ===
              playerId;

            return `
              <div class="
                playerCard
                ${
                  active
                    ? "active"
                    : ""
                }
              ">
                ${
                  index + 1
                }.
                ${escapeHtml(
                  player.name
                )}

                ${
                  me
                    ? " (you)"
                    : ""
                }

                ${
                  active
                    ? " ← ACTIVE"
                    : ""
                }

                <span class="playerSeat">
                  ${
                    sides[
                      player.seat
                    ]
                  }
                </span>
              </div>
            `;
          }
        )
        .join("");
}

function renderTracks() {
  $("#trackList")
    .innerHTML =
      `
      ESCALATION:
      ${
        state.tracks
          .escalation
      } / 6
      <br>

      COALITION SUPPORT:
      ${
        state.tracks
          .coalitionSupport
      } / 6
      <br>

      REGIONAL STABILITY:
      ${
        state.tracks
          .regionalStability
      } / 6
    `;
}

/*
  HEX GRID
*/

function renderHexes() {
  for (
    const layer of
    hexLayers
  ) {
    map.removeLayer(layer);
  }

  hexLayers = [];

  for (
    const hex of
    state.hexes
  ) {
    const polygon =
      L.polygon(
        createHexShape(
          hex.lat,
          hex.lng
        ),
        {
          className:
            "hexPath",

          interactive:
            true
        }
      );

    polygon.on(
      "click",
      () =>
        clickHex(hex)
    );

    polygon.addTo(map);

    hexLayers.push(
      polygon
    );
  }
}

function createHexShape(
  lat,
  lng
) {
  const latRadius =
    1.0;

  const lngRadius =
    1.15;

  return [
    [
      lat,
      lng -
        lngRadius
    ],

    [
      lat +
        latRadius,
      lng -
        lngRadius / 2
    ],

    [
      lat +
        latRadius,
      lng +
        lngRadius / 2
    ],

    [
      lat,
      lng +
        lngRadius
    ],

    [
      lat -
        latRadius,
      lng +
        lngRadius / 2
    ],

    [
      lat -
        latRadius,
      lng -
        lngRadius / 2
    ]
  ];
}

/*
  STRATEGIC LOCATIONS
*/

function renderLocations() {
  if (
    placeLayers.length
  ) {
    return;
  }

  for (
    const place of
    state.locations
  ) {
    const marker =
      L.marker(
        [
          place.lat,
          place.lng
        ],
        {
          interactive:
            false,

          icon:
            L.divIcon({
              className:
                "placeLabel",

              html:
                escapeHtml(
                  place.name
                ),

              iconSize:
                [100, 20],

              iconAnchor:
                [50, 10]
            })
        }
      );

    marker.addTo(map);

    placeLayers.push(
      marker
    );
  }
}

/*
  UNITS
*/

function renderUnits() {
  for (
    const layer of
    unitLayers
  ) {
    map.removeLayer(layer);
  }

  unitLayers = [];

  const me =
    getMe();

  for (
    const unit of
    state.units
  ) {
    const hex =
      state.hexes.find(
        hex =>
          hex.q ===
            unit.q &&
          hex.r ===
            unit.r
      );

    if (!hex) continue;

    const mine =
      me &&
      unit.owner ===
        me.seat;

    const selected =
      selectedUnitId ===
      unit.id;

    const used =
      unit.attackedTurn ===
        state.turn;

    const icon =
      L.divIcon({
        className: "",

        html:
          `
          <div class="
            unitMarker
            ${
              sideClasses[
                unit.owner
              ]
            }

            ${
              mine
                ? "mine"
                : ""
            }

            ${
              selected
                ? "selected"
                : ""
            }

            ${
              used
                ? "used"
                : ""
            }
          ">
            ${
              shortUnitName(
                unit
              )
            }

            <span class="unitSteps">
              ${unit.steps}
            </span>
          </div>
        `,

        iconSize:
          [40, 40],

        iconAnchor:
          [20, 20]
      });

    const marker =
      L.marker(
        [
          hex.lat,
          hex.lng
        ],
        {
          icon,
          zIndexOffset:
            selected
              ? 1000
              : 500
        }
      );

    marker.on(
      "click",
      event => {
        L.DomEvent
          .stopPropagation(
            event
          );

        clickUnit(unit);
      }
    );

    marker.addTo(map);

    unitLayers.push(
      marker
    );
  }
}

/*
  UNIT SELECTION
*/

function clickUnit(unit) {
  const me =
    getMe();

  if (!me) return;

  if (
    me.seat !==
    state.activeSeat
  ) {
    return;
  }

  if (
    !selectedUnitId
  ) {
    if (
      unit.owner ===
      me.seat
    ) {
      selectedUnitId =
        unit.id;
    }
  } else {
    const selected =
      getSelectedUnit();

    if (!selected) {
      selectedUnitId =
        null;

      render();

      return;
    }

    if (
      unit.owner ===
      me.seat
    ) {
      selectedUnitId =
        unit.id;
    } else {
      send({
        type: "attack",

        playerId,

        attackerId:
          selected.id,

        defenderId:
          unit.id
      });

      selectedUnitId =
        null;
    }
  }

  render();
}

function clickHex(hex) {
  const me =
    getMe();

  const selected =
    getSelectedUnit();

  if (
    !me ||
    !selected
  ) {
    return;
  }

  if (
    me.seat !==
    state.activeSeat
  ) {
    return;
  }

  if (
    selected.owner !==
    me.seat
  ) {
    return;
  }

  send({
    type: "move",

    playerId,

    unitId:
      selected.id,

    q:
      hex.q,

    r:
      hex.r
  });

  selectedUnitId =
    null;
}

/*
  SELECTED UNIT PANEL
*/

function renderSelected() {
  const unit =
    getSelectedUnit();

  if (!unit) {
    $("#unitPanel")
      .classList
      .add("hidden");

    return;
  }

  $("#unitPanel")
    .classList
    .remove("hidden");

  const moved =
    unit.movedTurn ===
    state.turn;

  const attacked =
    unit.attackedTurn ===
    state.turn;

  $("#selectedUnit")
    .innerHTML =
      `
      <div class="unitTitle">
        ${escapeHtml(
          unit.label
        )}
      </div>

      A${unit.attack}
      · D${unit.defense}
      · M${unit.move}
      · ${unit.steps} steps

      <br>

      ${
        moved
          ? "Moved"
          : "Movement available"
      }

      ·

      ${
        attacked
          ? "Attack used"
          : "Attack available"
      }
    `;
}

/*
  LOG
*/

function renderLog() {
  $("#log")
    .innerHTML =
      state.log
        .slice(
          0,
          25
        )
        .map(
          line =>
            `
            <div class="logLine">
              ${escapeHtml(
                line
              )}
            </div>
          `
        )
        .join("");
}

/*
  HELPERS
*/

function getMe() {
  if (!state) return null;

  return state.players.find(
    player =>
      player.id ===
      playerId
  );
}

function getSelectedUnit() {
  if (
    !state ||
    !selectedUnitId
  ) {
    return null;
  }

  return state.units.find(
    unit =>
      unit.id ===
      selectedUnitId
  );
}

function shortUnitName(
  unit
) {
  if (
    unit.domain ===
    "naval"
  ) {
    return unit.owner === 0
      ? "CV"
      : "NAV";
  }

  const words =
    unit.label.split(" ");

  if (
    words.includes(
      "Corps"
    )
  ) {
    return "CORPS";
  }

  if (
    words.includes(
      "Army"
    )
  ) {
    return "ARMY";
  }

  if (
    words.includes(
      "Expeditionary"
    )
  ) {
    return "EXP";
  }

  if (
    words.includes(
      "Regional"
    )
  ) {
    return "REG";
  }

  return "IRR";
}

function showLoading(
  text
) {
  $("#loadingText")
    .textContent =
      text;

  $("#loading")
    .classList
    .remove("hidden");
}

function hideLoading() {
  $("#loading")
    .classList
    .add("hidden");
}

function escapeHtml(
  value
) {
  return String(
    value
  ).replace(
    /[&<>"']/g,

    char =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[char]
  );
}

/*
  AUTO-OPEN ROOM FROM URL HASH
*/

if (
  location.hash.length > 1
) {
  const hashCode =
    location.hash
      .slice(1)
      .toUpperCase();

  $("#joinCode").value =
    hashCode;

  openRoom(
    hashCode
  );
}
