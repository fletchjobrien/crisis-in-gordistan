const $ =
  selector =>
    document.querySelector(selector);


const SIDES = [
  "Coalition",
  "Iran",
  "Regional States",
  "Nonstate Forces"
];


const SIDE_CLASSES = [
  "coalition",
  "iran",
  "regional",
  "nonstate"
];


let playerId =
  localStorage.cigPlayerId ||
  crypto.randomUUID();


localStorage.cigPlayerId =
  playerId;


let code = null;
let ws = null;
let state = null;

let selectedUnitId = null;

let pollTimer = null;
let directoryTimer = null;
let intentionalClose = false;

let hexLayers = [];
let unitLayers = [];
let mapLayers = [];

let stackQ = null;
let stackR = null;


const savedName =
  localStorage.cigPlayerName || "";


$("#menuName").value =
  savedName;


$("#playerName").value =
  savedName;


/* =========================================================
   MAP
   ========================================================= */

const map =
  L.map(
    "map",
    {
      zoomControl: true,

      attributionControl: false,

      minZoom: 4,

      maxZoom: 8,

      zoomSnap: .25,

      wheelPxPerZoomLevel: 100
    }
  )
  .setView(
    [31, 52],
    5
  );


/*
  NO OPENSTREETMAP TILE LAYER.

  We build a boardgame-style
  vector map ourselves.
*/

drawStrategicMap();


/* =========================================================
   BUTTONS
   ========================================================= */

$("#createBtn").onclick =
  createGame;


$("#joinRoomBtn").onclick =
  () =>
    openRoom(
      $("#joinCode")
        .value
        .trim()
        .toUpperCase()
    );


$("#refreshMenuBtn").onclick =
  loadDirectory;


$("#takeSeatBtn").onclick =
  takeSide;


$("#startBtn").onclick =
  startGame;


$("#leaveLobbyBtn").onclick =
  leaveLobby;


$("#gameMenuBtn").onclick =
  () =>
    $("#gameMenu")
      .classList
      .remove("hidden");


$("#closeGameMenu").onclick =
  () =>
    $("#gameMenu")
      .classList
      .add("hidden");


$("#exitGameBtn").onclick =
  exitToMenu;


$("#finishGameBtn").onclick =
  () => {
    send({
      type: "finish",
      playerId
    });
  };


$("#playersButton").onclick =
  () =>
    $("#playersDrawer")
      .classList
      .toggle("hidden");


$("#closePlayers").onclick =
  () =>
    $("#playersDrawer")
      .classList
      .add("hidden");


$("#logButton").onclick =
  () =>
    $("#logDrawer")
      .classList
      .remove("hidden");


$("#closeLog").onclick =
  () =>
    $("#logDrawer")
      .classList
      .add("hidden");


$("#clearSelection").onclick =
  () => {
    selectedUnitId = null;
    render();
  };


$("#closeStack").onclick =
  () => {
    stackQ = null;
    stackR = null;

    $("#stackPanel")
      .classList
      .add("hidden");
  };


$("#endTurnBtn").onclick =
  () => {
    selectedUnitId = null;

    send({
      type: "endTurn",
      playerId
    });

    setTimeout(
      fetchCurrentState,
      100
    );
  };


/* =========================================================
   VECTOR BOARD MAP
   ========================================================= */

function drawStrategicMap() {
  clearStrategicMap();

  /*
    The polygons are intentionally
    stylized boardgame geography,
    not GIS-precision boundaries.
  */

  addCountry(
    [
      [39.7, 44.0],
      [39.4, 48.5],
      [38.0, 49.3],
      [36.8, 53.2],
      [38.0, 57.3],
      [37.3, 60.4],
      [35.0, 61.2],
      [31.0, 61.0],
      [27.4, 59.3],
      [25.2, 57.1],
      [25.0, 54.5],
      [27.0, 52.0],
      [29.5, 48.0],
      [32.0, 46.0],
      [35.0, 45.2]
    ],
    "iranArea"
  );

  addCountry(
    [
      [37.3, 42.8],
      [37.2, 46.0],
      [35.5, 46.5],
      [33.2, 46.0],
      [30.2, 47.8],
      [29.0, 46.2],
      [30.0, 42.5],
      [33.0, 41.0],
      [36.0, 41.7]
    ],
    "iraqArea"
  );

  addCountry(
    [
      [31.0, 46.0],
      [29.3, 48.0],
      [28.5, 49.0],
      [26.2, 50.2],
      [24.0, 52.0],
      [22.0, 55.0],
      [21.5, 46.0],
      [25.2, 43.0],
      [29.0, 43.0]
    ],
    "arabiaArea"
  );

  addCountry(
    [
      [40.5, 39.0],
      [41.0, 51.0],
      [39.2, 49.0],
      [38.0, 45.0],
      [37.0, 42.0]
    ],
    "turkeyArea"
  );

  addCountry(
    [
      [31.5, 61.0],
      [35.0, 61.2],
      [37.0, 63.5],
      [30.0, 66.0],
      [24.0, 64.0],
      [25.0, 58.0]
    ],
    "pakistanArea"
  );

  /*
    Zagros mountain belt.
  */

  addPolygon(
    [
      [38.0, 44.3],
      [37.0, 46.5],
      [35.5, 47.5],
      [34.0, 49.0],
      [32.0, 50.0],
      [30.2, 51.5],
      [28.5, 53.5],
      [27.0, 55.0],
      [28.2, 56.2],
      [30.1, 54.8],
      [32.0, 53.0],
      [34.0, 51.8],
      [36.0, 50.0],
      [38.6, 47.2]
    ],
    "mountainArea"
  );

  /*
    Alborz.
  */

  addPolygon(
    [
      [36.0, 49.0],
      [36.8, 50.5],
      [37.2, 53.5],
      [36.7, 56.5],
      [35.9, 55.2],
      [35.6, 52.0]
    ],
    "mountainArea"
  );

  /*
    Arabian desert.
  */

  addPolygon(
    [
      [29.0, 44.0],
      [28.5, 49.0],
      [25.0, 52.5],
      [22.0, 55.5],
      [20.0, 46.0],
      [24.0, 42.0]
    ],
    "desertArea"
  );


  /*
    Tigris / Euphrates.
  */

  addLine(
    [
      [37.0, 39.8],
      [36.0, 41.5],
      [34.8, 43.2],
      [33.3, 44.4],
      [31.4, 46.2],
      [30.4, 47.5]
    ],
    "riverLine"
  );


  addLine(
    [
      [38.0, 38.2],
      [36.5, 40.0],
      [35.0, 41.0],
      [33.5, 43.0],
      [32.0, 44.5],
      [30.5, 46.5]
    ],
    "riverLine"
  );


  /*
    Main road network.
  */

  addLine(
    [
      [35.69, 51.39],
      [34.31, 47.07],
      [33.31, 44.36]
    ],
    "roadLine"
  );


  addLine(
    [
      [35.69, 51.39],
      [32.65, 51.67],
      [29.59, 52.58],
      [27.18, 56.27]
    ],
    "roadLine"
  );


  addLine(
    [
      [33.31, 44.36],
      [30.51, 47.82],
      [29.37, 47.98],
      [26.22, 50.59]
    ],
    "roadLine"
  );


  addLine(
    [
      [29.37, 47.98],
      [25.29, 51.53],
      [24.45, 54.38]
    ],
    "roadLine"
  );


  addLine(
    [
      [24.45, 54.38],
      [23.59, 58.38]
    ],
    "roadLine"
  );


  /*
    Board labels.
  */

  addLargeLabel(
    32.5,
    54.5,
    "IRAN"
  );

  addLargeLabel(
    33.0,
    43.4,
    "IRAQ"
  );

  addLargeLabel(
    23.5,
    47.0,
    "ARABIAN PENINSULA"
  );


  /*
    Cities.
  */

  const cities = [
    ["TEHRAN", 35.689, 51.389],
    ["TABRIZ", 38.080, 46.291],
    ["ISFAHAN", 32.654, 51.668],
    ["SHIRAZ", 29.592, 52.584],
    ["AHVAZ", 31.318, 48.671],
    ["BANDAR ABBAS", 27.183, 56.267],
    ["MASHHAD", 36.260, 59.616],

    ["BAGHDAD", 33.315, 44.366],
    ["BASRA", 30.508, 47.783],
    ["ERBIL", 36.191, 44.009],

    ["KUWAIT CITY", 29.376, 47.977],
    ["MANAMA", 26.224, 50.588],
    ["DOHA", 25.285, 51.531],
    ["ABU DHABI", 24.454, 54.377],
    ["MUSCAT", 23.588, 58.383]
  ];

  for (
    const [
      name,
      lat,
      lng
    ] of cities
  ) {
    addCity(
      name,
      lat,
      lng
    );
  }
}


function clearStrategicMap() {
  for (
    const layer of
    mapLayers
  ) {
    try {
      map.removeLayer(layer);
    } catch {}
  }

  mapLayers = [];
}


function addCountry(
  points,
  className
) {
  addPolygon(
    points,
    `countryFill ${className}`
  );
}


function addPolygon(
  points,
  className
) {
  const layer =
    L.polygon(
      points,
      {
        className,
        interactive: false
      }
    );

  layer.addTo(map);

  mapLayers.push(layer);
}


function addLine(
  points,
  className
) {
  const layer =
    L.polyline(
      points,
      {
        className,
        interactive: false
      }
    );

  layer.addTo(map);

  mapLayers.push(layer);
}


function addLargeLabel(
  lat,
  lng,
  text
) {
  const marker =
    L.marker(
      [lat, lng],
      {
        interactive: false,

        icon:
          L.divIcon({
            className:
              "boardTitle",

            html:
              text,

            iconSize:
              [230, 35],

            iconAnchor:
              [115, 18]
          })
      }
    );

  marker.addTo(map);

  mapLayers.push(marker);
}


function addCity(
  name,
  lat,
  lng
) {
  const dot =
    L.marker(
      [lat, lng],
      {
        interactive: false,

        icon:
          L.divIcon({
            className:
              "cityDot",

            iconSize:
              [7, 7],

            iconAnchor:
              [3, 3]
          })
      }
    );

  dot.addTo(map);

  mapLayers.push(dot);


  const label =
    L.marker(
      [lat, lng],
      {
        interactive: false,

        icon:
          L.divIcon({
            className:
              "cityLabel",

            html:
              name,

            iconSize:
              [120, 20],

            iconAnchor:
              [-7, 10]
          })
      }
    );

  label.addTo(map);

  mapLayers.push(label);
}


/* =========================================================
   NETWORKING
   ========================================================= */

function rememberName(name) {
  if (!name) return;

  localStorage.cigPlayerName =
    name;

  $("#menuName").value =
    name;

  $("#playerName").value =
    name;
}


async function createGame() {
  const name =
    (
      $("#menuName").value ||
      ""
    ).trim() ||
    "Player";

  rememberName(name);

  showLoading(
    "Preparing game…"
  );

  try {
    const response =
      await fetch(
        "/api/create",
        {
          method: "POST",

          headers: {
            "content-type":
              "application/json"
          },

          body:
            JSON.stringify({
              playerId,
              name
            })
        }
      );

    const data =
      await response.json();

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


async function openRoom(roomCode) {
  roomCode =
    String(roomCode || "")
      .trim()
      .toUpperCase();

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

  location.hash = code;

  $("#roomTag").textContent =
    `ROOM ${code}`;

  $("#roomCodeInMenu").textContent =
    `ROOM ${code}`;

  $("#joinCode").value =
    code;

  showLoading(
    "Opening game…"
  );

  intentionalClose = true;

  if (ws) {
    try {
      ws.close();
    } catch {}
  }

  intentionalClose = false;

  clearInterval(
    pollTimer
  );

  connectSocket();

  await fetchCurrentState();

  setTimeout(
    hideLoading,
    700
  );
}


function connectSocket() {
  if (!code) return;

  const protocol =
    location.protocol ===
    "https:"
      ? "wss"
      : "ws";

  const socket =
    new WebSocket(
      `${protocol}://${location.host}/ws/${code}`
    );

  ws = socket;

  socket.onopen =
    () => {
      hideLoading();
      startPolling();
    };

  socket.onmessage =
    event => {
      const message =
        JSON.parse(
          event.data
        );

      if (
        message.type === "state"
      ) {
        applyState(
          message.state
        );
      }

      if (
        message.type === "error"
      ) {
        alert(
          message.message
        );
      }
    };

  socket.onclose =
    () => {
      if (
        intentionalClose ||
        !code
      ) {
        return;
      }

      startPolling();

      setTimeout(
        connectSocket,
        1200
      );
    };
}


function startPolling() {
  clearInterval(
    pollTimer
  );

  pollTimer =
    setInterval(
      fetchCurrentState,
      1000
    );
}


async function fetchCurrentState() {
  if (!code) return;

  try {
    const response =
      await fetch(
        `/api/game/${code}?t=${Date.now()}`,
        {
          cache:
            "no-store"
        }
      );

    if (!response.ok) {
      return;
    }

    const latest =
      await response.json();

    if (
      !state ||
      latest.updatedAt !==
        state.updatedAt ||
      latest.phase !==
        state.phase
    ) {
      applyState(latest);
    }
  } catch {}
}


function applyState(newState) {
  state = newState;

  hideLoading();

  render();
}


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

    return true;
  }

  connectSocket();

  return false;
}


/* =========================================================
   LOBBY
   ========================================================= */

function takeSide() {
  const name =
    (
      $("#playerName").value ||
      $("#menuName").value ||
      ""
    ).trim();

  if (!name) {
    alert(
      "Enter your name."
    );

    return;
  }

  rememberName(name);

  const message = {
    type: "join",

    playerId,

    name,

    seat:
      Number(
        $("#seat").value
      )
  };

  if (!send(message)) {
    setTimeout(
      () =>
        send(message),
      300
    );
  }

  setTimeout(
    fetchCurrentState,
    150
  );
}


function startGame() {
  if (!getMe()) {
    alert(
      "Take a side first."
    );

    return;
  }

  send({
    type: "start",
    playerId
  });

  setTimeout(
    fetchCurrentState,
    150
  );
}


function leaveLobby() {
  if (
    state?.phase === "lobby" &&
    getMe()
  ) {
    send({
      type:
        "leaveLobby",

      playerId
    });
  }

  exitToMenu();
}


function exitToMenu() {
  intentionalClose = true;

  if (ws) {
    try {
      ws.close();
    } catch {}
  }

  clearInterval(
    pollTimer
  );

  ws = null;

  code = null;

  state = null;

  selectedUnitId = null;

  stackQ = null;
  stackR = null;

  history.replaceState(
    null,
    "",
    location.pathname
  );

  clearUnitLayers();

  $("#lobby")
    .classList
    .add("hidden");

  $("#topbar")
    .classList
    .add("hidden");

  $("#gameMenu")
    .classList
    .add("hidden");

  $("#playersDrawer")
    .classList
    .add("hidden");

  $("#stackPanel")
    .classList
    .add("hidden");

  $("#unitPanel")
    .classList
    .add("hidden");

  $("#logDrawer")
    .classList
    .add("hidden");

  $("#logButton")
    .classList
    .add("hidden");

  $("#endTurnBtn")
    .classList
    .add("hidden");

  $("#menuScreen")
    .classList
    .remove("hidden");

  intentionalClose = false;

  loadDirectory();
}


/* =========================================================
   RENDER
   ========================================================= */

function render() {
  if (!state) return;

  if (
    state.phase === "lobby"
  ) {
    renderLobby();

    return;
  }

  if (
    state.phase === "finished"
  ) {
    exitToMenu();

    return;
  }

  renderGame();
}


function renderLobby() {
  $("#menuScreen")
    .classList
    .add("hidden");

  $("#topbar")
    .classList
    .add("hidden");

  $("#lobby")
    .classList
    .remove("hidden");

  const me =
    getMe();

  if (me) {
    $("#playerName").value =
      me.name;

    $("#seat").value =
      String(me.seat);

    $("#lobbyStatus").textContent =
      `You command ${SIDES[me.seat]}.`;
  } else {
    $("#lobbyStatus").textContent =
      "Select a command.";
  }

  const ordered =
    [...state.players]
      .sort(
        (a, b) =>
          a.seat - b.seat
      );

  $("#lobbyPlayers").innerHTML =
    ordered.length
      ? ordered.map(
          player => `
            <div class="lobbyPlayer">

              <strong>
                ${escapeHtml(player.name)}
                ${
                  player.id === playerId
                    ? " (YOU)"
                    : ""
                }
              </strong>

              <span class="playerSeat">
                ${SIDES[player.seat]}
              </span>

            </div>
          `
        ).join("")
      : `
        <div class="smallText">
          No commanders assigned.
        </div>
      `;

  $("#startBtn").disabled =
    !me;
}


function renderGame() {
  $("#menuScreen")
    .classList
    .add("hidden");

  $("#lobby")
    .classList
    .add("hidden");

  $("#topbar")
    .classList
    .remove("hidden");

  $("#logButton")
    .classList
    .remove("hidden");

  $("#endTurnBtn")
    .classList
    .remove("hidden");

  const active =
    state.players.find(
      player =>
        player.seat ===
        state.activeSeat
    );

  const me =
    getMe();

  $("#turnLabel").textContent =
    `TURN ${state.turn} — ${
      active
        ? active.name
        : SIDES[
            state.activeSeat
          ]
    }`;

  $("#yourSide").textContent =
    me
      ? SIDES[me.seat]
      : "Observer";

  $("#endTurnBtn").disabled =
    !me ||
    me.seat !==
      state.activeSeat;

  renderPlayers();
  renderTracks();
  renderHexes();
  renderUnits();
  renderSelected();
  renderLog();

  if (
    stackQ !== null &&
    stackR !== null
  ) {
    renderStackPanel(
      stackQ,
      stackR
    );
  }

  setTimeout(
    () =>
      map.invalidateSize(),
    0
  );
}


/* =========================================================
   PLAYERS
   ========================================================= */

function renderPlayers() {
  const ordered =
    [...state.players]
      .sort(
        (a, b) =>
          a.seat - b.seat
      );

  $("#playerList").innerHTML =
    ordered.map(
      player => `
        <div
          class="
            playerCard
            ${
              player.seat ===
              state.activeSeat
                ? "active"
                : ""
            }
          "
        >

          ${escapeHtml(player.name)}

          ${
            player.id === playerId
              ? " (YOU)"
              : ""
          }

          <span class="playerSeat">
            ${SIDES[player.seat]}
          </span>

        </div>
      `
    ).join("");
}


function renderTracks() {
  $("#trackList").innerHTML =
    `
    ESCALATION
    ${state.tracks.escalation}/6

    <br>

    COALITION SUPPORT
    ${state.tracks.coalitionSupport}/6

    <br>

    REGIONAL STABILITY
    ${state.tracks.regionalStability}/6
    `;
}


/* =========================================================
   PROPER HEXES
   ========================================================= */

function renderHexes() {
  for (
    const layer of
    hexLayers
  ) {
    map.removeLayer(layer);
  }

  hexLayers = [];

  /*
    These dimensions line up with
    the server's hex-center spacing.

    Pointy-top hex:
      vertical radius = .95°
      horizontal radius ≈ .82°
  */

  const radiusLat =
    .95;

  const radiusLng =
    .93;

  for (
    const hex of
    state.hexes
  ) {
    const polygon =
      L.polygon(
        createPointyHex(
          hex.lat,
          hex.lng,
          radiusLat,
          radiusLng
        ),

        {
          className:
            `hexPath ${
              hex.domain === "sea"
                ? "seaHex"
                : ""
            }`,

          interactive: true
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


function createPointyHex(
  lat,
  lng,
  radiusLat,
  radiusLng
) {
  return [
    [
      lat + radiusLat,
      lng
    ],

    [
      lat + radiusLat / 2,
      lng + radiusLng
    ],

    [
      lat - radiusLat / 2,
      lng + radiusLng
    ],

    [
      lat - radiusLat,
      lng
    ],

    [
      lat - radiusLat / 2,
      lng - radiusLng
    ],

    [
      lat + radiusLat / 2,
      lng - radiusLng
    ]
  ];
}


/* =========================================================
   STACKED COUNTERS
   ========================================================= */

function renderUnits() {
  clearUnitLayers();

  const grouped =
    groupUnitsByHex();

  for (
    const [
      key,
      units
    ] of grouped
  ) {
    const [q, r] =
      key
        .split(",")
        .map(Number);

    const hex =
      state.hexes.find(
        hex =>
          hex.q === q &&
          hex.r === r
      );

    if (!hex) continue;

    const marker =
      createStackMarker(
        units,
        hex
      );

    marker.addTo(map);

    unitLayers.push(marker);
  }
}


function groupUnitsByHex() {
  const map =
    new Map();

  for (
    const unit of
    state.units
  ) {
    const key =
      `${unit.q},${unit.r}`;

    if (!map.has(key)) {
      map.set(
        key,
        []
      );
    }

    map.get(key)
      .push(unit);
  }

  return map;
}


function createStackMarker(
  units,
  hex
) {
  /*
    Only visually expose up to
    three counters in the little
    pile. The badge gives the full
    stack size.
  */

  const visible =
    units.slice(0, 3);

  const stackHTML =
    visible.map(
      (
        unit,
        index
      ) => `
        <div
          class="stackCounter"
          style="
            left:${index * 4}px;
            top:${-index * 4}px;
            z-index:${10 + index};
          "
        >
          ${counterHTML(unit)}
        </div>
      `
    ).join("");


  const badge =
    units.length > 1
      ? `
        <div class="stackBadge">
          ${units.length}
        </div>
      `
      : "";


  const icon =
    L.divIcon({
      className: "",

      html:
        `
        <div class="stackMarker">
          ${stackHTML}
          ${badge}
        </div>
        `,

      iconSize:
        [60, 60],

      iconAnchor:
        [27, 27]
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
          700
      }
    );


  marker.on(
    "click",
    event => {
      L.DomEvent
        .stopPropagation(
          event
        );

      if (
        units.length > 1
      ) {
        openStack(
          hex.q,
          hex.r
        );

        return;
      }

      clickUnit(
        units[0]
      );
    }
  );


  return marker;
}


/* =========================================================
   COUNTER ART
   ========================================================= */

function counterHTML(unit) {
  const me =
    getMe();

  const mine =
    me &&
    unit.owner === me.seat;

  const selected =
    unit.id ===
    selectedUnitId;

  const used =
    unit.attackedTurn ===
    state.turn;


  return `
    <div
      class="
        unitMarker
        ${SIDE_CLASSES[unit.owner]}
        ${mine ? "mine" : ""}
        ${selected ? "selected" : ""}
        ${used ? "used" : ""}
      "
    >

      <div class="counterDesignation">
        ${
          escapeHtml(
            unit.designation ||
            unit.label
          )
        }
      </div>

      <div class="counterSymbol">
        ${unitSymbolSVG(unit)}
      </div>

      <div class="counterFactors">

        <span>
          ${unit.attack}
        </span>

        <span>
          ${unit.defense}
        </span>

        <span>
          ${unit.move}
        </span>

      </div>

      <div class="counterSteps">
        ${unit.steps}
      </div>

    </div>
  `;
}


function unitSymbolSVG(unit) {
  const type =
    unit.type ||
    inferUnitType(unit);


  /*
    All symbols share the exact
    same SVG viewBox, so they stay
    centered and aligned.
  */

  if (type === "armor") {
    return `
      <svg viewBox="0 0 40 24">
        <rect
          x="1"
          y="1"
          width="38"
          height="22"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        />

        <ellipse
          cx="20"
          cy="12"
          rx="10"
          ry="5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        />
      </svg>
    `;
  }


  if (type === "naval") {
    return `
      <svg viewBox="0 0 40 24">

        <rect
          x="1"
          y="1"
          width="38"
          height="22"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        />

        <path
          d="
            M7 10
            Q12 6 17 10
            T27 10
            T35 10
          "
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        />

        <path
          d="
            M7 15
            Q12 11 17 15
            T27 15
            T35 15
          "
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        />

      </svg>
    `;
  }


  if (type === "irregular") {
    return `
      <svg viewBox="0 0 40 24">

        <rect
          x="1"
          y="1"
          width="38"
          height="22"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        />

        <path
          d="
            M20 6
            L27 12
            L20 18
            L13 12
            Z
          "
          fill="currentColor"
        />

      </svg>
    `;
  }


  /*
    Infantry.
  */

  return `
    <svg viewBox="0 0 40 24">

      <rect
        x="1"
        y="1"
        width="38"
        height="22"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      />

      <line
        x1="3"
        y1="3"
        x2="37"
        y2="21"
        stroke="currentColor"
        stroke-width="1.5"
      />

      <line
        x1="37"
        y1="3"
        x2="3"
        y2="21"
        stroke="currentColor"
        stroke-width="1.5"
      />

    </svg>
  `;
}


function inferUnitType(unit) {
  if (
    unit.domain === "naval"
  ) {
    return "naval";
  }

  const label =
    unit.label.toLowerCase();

  if (
    label.includes("expeditionary")
  ) {
    return "armor";
  }

  if (
    label.includes("irregular")
  ) {
    return "irregular";
  }

  return "infantry";
}


/* =========================================================
   STACK INSPECTOR
   ========================================================= */

function openStack(q, r) {
  stackQ = q;
  stackR = r;

  renderStackPanel(
    q,
    r
  );
}


function renderStackPanel(q, r) {
  const units =
    state.units.filter(
      unit =>
        unit.q === q &&
        unit.r === r
    );

  if (!units.length) {
    $("#stackPanel")
      .classList
      .add("hidden");

    stackQ = null;
    stackR = null;

    return;
  }

  $("#stackPanel")
    .classList
    .remove("hidden");

  $("#stackHex")
    .textContent =
      `HEX ${q}-${r}`;


  $("#stackContents")
    .innerHTML =
      units.map(
        unit => `
          <div class="stackUnit">

            <div class="stackMiniCounter">
              ${counterHTML(unit)}
            </div>

            <div>

              <div class="stackUnitName">
                ${escapeHtml(unit.label)}
              </div>

              <div class="stackUnitStats">
                A${unit.attack}
                ·
                D${unit.defense}
                ·
                M${unit.move}
                ·
                ${unit.steps} steps

                <br>

                ${SIDES[unit.owner]}
              </div>

            </div>

            <button
              data-stack-unit="${escapeHtml(unit.id)}"
            >
              Select
            </button>

          </div>
        `
      ).join("");


  $("#stackContents")
    .querySelectorAll(
      "[data-stack-unit]"
    )
    .forEach(
      button => {
        button.onclick =
          () => {
            const unit =
              state.units.find(
                unit =>
                  unit.id ===
                  button.dataset
                    .stackUnit
              );

            if (!unit) return;

            $("#stackPanel")
              .classList
              .add("hidden");

            stackQ = null;
            stackR = null;

            clickUnit(unit);
          };
      }
    );
}


/* =========================================================
   UNIT INTERACTION
   ========================================================= */

function clickUnit(unit) {
  const me =
    getMe();

  if (
    !me ||
    me.seat !==
      state.activeSeat
  ) {
    return;
  }

  if (!selectedUnitId) {
    if (
      unit.owner === me.seat
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
    } else if (
      unit.owner === me.seat
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

      setTimeout(
        fetchCurrentState,
        150
      );
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
    !selected ||
    me.seat !==
      state.activeSeat ||
    selected.owner !==
      me.seat
  ) {
    /*
      No selected counter:
      tapping an occupied hex
      should still inspect its stack.
    */

    const stack =
      state.units.filter(
        unit =>
          unit.q === hex.q &&
          unit.r === hex.r
      );

    if (
      stack.length > 1
    ) {
      openStack(
        hex.q,
        hex.r
      );
    }

    return;
  }

  send({
    type: "move",

    playerId,

    unitId:
      selected.id,

    q: hex.q,
    r: hex.r
  });

  selectedUnitId =
    null;

  setTimeout(
    fetchCurrentState,
    150
  );
}


/* =========================================================
   SELECTED UNIT
   ========================================================= */

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

  $("#selectedUnit")
    .innerHTML =
      `
      <div class="unitTitle">
        ${escapeHtml(unit.label)}
      </div>

      Attack ${unit.attack}
      ·
      Defense ${unit.defense}
      ·
      Movement ${unit.move}
      ·
      ${unit.steps} steps

      <br>

      ${
        unit.movedTurn ===
        state.turn
          ? "Movement expended"
          : "Movement available"
      }

      ·

      ${
        unit.attackedTurn ===
        state.turn
          ? "Combat expended"
          : "Combat available"
      }
      `;
}


/* =========================================================
   LOG
   ========================================================= */

function renderLog() {
  $("#log").innerHTML =
    state.log
      .slice(0, 25)
      .map(
        line => `
          <div class="logLine">
            ${escapeHtml(line)}
          </div>
        `
      )
      .join("");
}


/* =========================================================
   DIRECTORY
   ========================================================= */

async function loadDirectory() {
  try {
    const response =
      await fetch(
        `/api/directory?playerId=${encodeURIComponent(playerId)}&t=${Date.now()}`,
        {
          cache:
            "no-store"
        }
      );

    const data =
      await response.json();

    renderGameList(
      "#joinableGames",
      data.joinable,
      "Join"
    );

    renderGameList(
      "#currentGames",
      data.mine,
      "Resume"
    );

    renderGameList(
      "#finishedGames",
      data.finished,
      null
    );
  } catch {
    $("#joinableGames")
      .innerHTML =
        `<div class="smallText">Unable to load.</div>`;
  }
}


function renderGameList(
  selector,
  games,
  buttonLabel
) {
  const root =
    $(selector);

  if (!games?.length) {
    root.innerHTML =
      `<div class="smallText">None.</div>`;

    return;
  }

  root.innerHTML =
    games.map(
      game => {
        const names =
          (game.players || [])
            .map(
              player =>
                player.name
            )
            .join(", ") ||
          "Empty";

        return `
          <div class="gameRow">

            <div>

              <div class="gameCode">
                ${escapeHtml(game.code)}
              </div>

              <div class="gameDesc">
                ${escapeHtml(game.phase)}
                ·
                ${game.players?.length || 0}/4
                ·
                ${escapeHtml(names)}
                ${
                  game.turn
                    ? ` · Turn ${game.turn}`
                    : ""
                }
              </div>

            </div>

            ${
              buttonLabel
                ? `
                  <button
                    data-open-room="${escapeHtml(game.code)}"
                  >
                    ${buttonLabel}
                  </button>
                `
                : `
                  <span class="smallText">
                    Finished
                  </span>
                `
            }

          </div>
        `;
      }
    ).join("");

  root.querySelectorAll(
    "[data-open-room]"
  ).forEach(
    button => {
      button.onclick =
        () =>
          openRoom(
            button.dataset.openRoom
          );
    }
  );
}


/* =========================================================
   HELPERS
   ========================================================= */

function clearUnitLayers() {
  for (
    const layer of
    unitLayers
  ) {
    try {
      map.removeLayer(layer);
    } catch {}
  }

  unitLayers = [];
}


function getMe() {
  return (
    state?.players?.find(
      player =>
        player.id === playerId
    ) ||
    null
  );
}


function getSelectedUnit() {
  return (
    state?.units?.find(
      unit =>
        unit.id ===
        selectedUnitId
    ) ||
    null
  );
}


function showLoading(text) {
  $("#loadingText").textContent =
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


function escapeHtml(value) {
  return String(value)
    .replace(
      /[&<>"']/g,
      char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[char]
    );
}


/* =========================================================
   INITIALIZE
   ========================================================= */

loadDirectory();


directoryTimer =
  setInterval(
    () => {
      if (!code) {
        loadDirectory();
      }
    },
    3000
  );


if (
  location.hash.length > 1
) {
  const hashCode =
    location.hash
      .slice(1)
      .toUpperCase();

  $("#joinCode").value =
    hashCode;

  openRoom(hashCode);
}
