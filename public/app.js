const $ =
  selector =>
    document.querySelector(
      selector
    );


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

let selectedUnitId =
  null;

let pollTimer =
  null;

let directoryTimer =
  null;

let intentionalClose =
  false;


let hexLayers = [];

let unitLayers = [];

let placeLayers = [];


const savedName =
  localStorage.cigPlayerName ||
  "";


$("#menuName").value =
  savedName;


$("#playerName").value =
  savedName;


/*
  MAP

  Keep the real geography, but CSS now
  processes the tiles to look much more
  like subdued printed wargame cartography.
*/

const map =
  L.map(
    "map",

    {
      zoomControl: true,

      minZoom: 4,

      maxZoom: 9,

      zoomSnap: .5,

      wheelPxPerZoomLevel: 100
    }
  )
  .setView(
    [
      30.7,
      52.5
    ],

    5
  );


L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",

  {
    maxZoom: 19,

    attribution:
      "&copy; OpenStreetMap contributors"
  }
)
.addTo(map);


/*
  UI BUTTONS
*/

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
  () => {

    $("#gameMenu")
      .classList
      .remove(
        "hidden"
      );

  };


$("#closeGameMenu").onclick =
  () => {

    $("#gameMenu")
      .classList
      .add(
        "hidden"
      );

  };


$("#exitGameBtn").onclick =
  exitToMenu;


$("#finishGameBtn").onclick =
  () => {

    send({

      type:
        "finish",

      playerId

    });

  };


$("#playersButton").onclick =
  () => {

    $("#playersDrawer")
      .classList
      .toggle(
        "hidden"
      );

  };


$("#closePlayers").onclick =
  () => {

    $("#playersDrawer")
      .classList
      .add(
        "hidden"
      );

  };


$("#logButton").onclick =
  () => {

    $("#logDrawer")
      .classList
      .remove(
        "hidden"
      );

  };


$("#closeLog").onclick =
  () => {

    $("#logDrawer")
      .classList
      .add(
        "hidden"
      );

  };


$("#clearSelection").onclick =
  () => {

    selectedUnitId =
      null;

    render();

  };


$("#endTurnBtn").onclick =
  () => {

    selectedUnitId =
      null;


    send({

      type:
        "endTurn",

      playerId

    });


    setTimeout(
      fetchCurrentState,
      100
    );

  };


function rememberName(
  name
) {

  if (!name) {
    return;
  }


  localStorage.cigPlayerName =
    name;


  $("#menuName").value =
    name;


  $("#playerName").value =
    name;

}


/*
  CREATE GAME
*/

async function createGame() {

  const name =
    (
      $("#menuName").value ||
      ""
    )
    .trim() ||
    "Player";


  rememberName(
    name
  );


  showLoading(
    "Preparing map…"
  );


  try {

    const response =
      await fetch(
        "/api/create",

        {
          method:
            "POST",

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
      "Could not create lobby."
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
    String(
      roomCode || ""
    )
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


  code =
    roomCode;


  location.hash =
    code;


  $("#roomTag")
    .textContent =
      `ROOM ${code}`;


  $("#roomCodeInMenu")
    .textContent =
      `Room ${code}`;


  $("#joinCode")
    .value =
      code;


  showLoading(
    "Opening game…"
  );


  intentionalClose =
    true;


  if (ws) {

    try {
      ws.close();
    } catch {}

  }


  ws =
    null;


  intentionalClose =
    false;


  clearInterval(
    pollTimer
  );


  connectSocket();


  await fetchCurrentState();


  setTimeout(
    hideLoading,
    800
  );

}


/*
  WEBSOCKET
*/

function connectSocket() {

  if (!code) {
    return;
  }


  const protocol =
    location.protocol ===
    "https:"

      ? "wss"

      : "ws";


  const socket =
    new WebSocket(
      `${protocol}://${location.host}/ws/${code}`
    );


  ws =
    socket;


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
        message.type ===
        "state"
      ) {

        applyState(
          message.state
        );

      }


      if (
        message.type ===
        "error"
      ) {

        hideLoading();


        $("#lobbyStatus")
          .textContent =
            message.message;


        alert(
          message.message
        );

      }

    };


  socket.onerror =
    () => {

      startPolling();

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
        () => {

          if (
            code &&
            (
              !ws ||
              ws.readyState ===
                WebSocket.CLOSED
            )
          ) {

            connectSocket();

          }

        },

        1200
      );

    };

}


/*
  STATE POLLING FALLBACK
*/

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

  if (!code) {
    return;
  }


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

      applyState(
        latest
      );

    }

  } catch {}

}


function applyState(
  newState
) {

  state =
    newState;


  hideLoading();


  render();

}


function send(
  message
) {

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


/*
  LOBBY CONTROLS
*/

function takeSide() {

  const name =
    (
      $("#playerName").value ||

      $("#menuName").value ||

      ""
    )
    .trim();


  if (!name) {

    alert(
      "Enter your name."
    );

    return;

  }


  rememberName(
    name
  );


  $("#lobbyStatus")
    .textContent =
      "Joining…";


  const message = {

    type:
      "join",

    playerId,

    name,

    seat:
      Number(
        $("#seat").value
      )

  };


  if (
    send(
      message
    )
  ) {

    $("#lobbyStatus")
      .textContent =
        "Side selected.";

  } else {

    setTimeout(
      () =>
        send(
          message
        ),

      300
    );

  }


  setTimeout(
    fetchCurrentState,
    150
  );


  setTimeout(
    fetchCurrentState,
    500
  );

}


function startGame() {

  if (!state) {
    return;
  }


  const me =
    getMe();


  if (!me) {

    alert(
      "Take a side first."
    );

    return;

  }


  $("#lobbyStatus")
    .textContent =
      "Starting game…";


  send({

    type:
      "start",

    playerId

  });


  setTimeout(
    fetchCurrentState,
    100
  );


  setTimeout(
    fetchCurrentState,
    400
  );


  setTimeout(
    fetchCurrentState,
    900
  );

}


function leaveLobby() {

  if (
    state &&
    state.phase ===
      "lobby" &&
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


/*
  EXIT / RESUME
*/

function exitToMenu() {

  intentionalClose =
    true;


  if (ws) {

    try {
      ws.close();
    } catch {}

  }


  ws = null;


  clearInterval(
    pollTimer
  );


  code =
    null;


  state =
    null;


  selectedUnitId =
    null;


  history.replaceState(
    null,
    "",
    location.pathname
  );


  clearMapLayers();


  $("#lobby")
    .classList
    .add(
      "hidden"
    );


  $("#topbar")
    .classList
    .add(
      "hidden"
    );


  $("#gameMenu")
    .classList
    .add(
      "hidden"
    );


  $("#playersDrawer")
    .classList
    .add(
      "hidden"
    );


  $("#logDrawer")
    .classList
    .add(
      "hidden"
    );


  $("#logButton")
    .classList
    .add(
      "hidden"
    );


  $("#endTurnBtn")
    .classList
    .add(
      "hidden"
    );


  $("#unitPanel")
    .classList
    .add(
      "hidden"
    );


  $("#menuScreen")
    .classList
    .remove(
      "hidden"
    );


  intentionalClose =
    false;


  loadDirectory();

}


/*
  RENDER
*/

function render() {

  if (!state) {
    return;
  }


  if (
    state.phase ===
    "lobby"
  ) {

    renderLobby();

    return;

  }


  if (
    state.phase ===
    "finished"
  ) {

    exitToMenu();

    return;

  }


  renderGame();

}


/*
  LOBBY
*/

function renderLobby() {

  $("#menuScreen")
    .classList
    .add(
      "hidden"
    );


  $("#topbar")
    .classList
    .add(
      "hidden"
    );


  $("#lobby")
    .classList
    .remove(
      "hidden"
    );


  $("#roomTag")
    .textContent =
      `ROOM ${state.code}`;


  const me =
    getMe();


  if (me) {

    $("#playerName")
      .value =
        me.name;


    $("#seat")
      .value =
        String(
          me.seat
        );


    $("#lobbyStatus")
      .textContent =
        `You command ${SIDES[me.seat]}.`;

  } else {

    $("#lobbyStatus")
      .textContent =
        "Select a side.";

  }


  const ordered =
    [...state.players]
      .sort(
        (a, b) =>
          a.seat -
          b.seat
      );


  $("#lobbyPlayers")
    .innerHTML =
      ordered.length

        ? ordered
          .map(
            (
              player,
              index
            ) =>
              `
              <div class="lobbyPlayer">

                <strong>
                  ${
                    index + 1
                  }.
                  ${
                    escapeHtml(
                      player.name
                    )
                  }

                  ${
                    player.id ===
                    playerId
                      ? " (you)"
                      : ""
                  }
                </strong>

                <span class="playerSeat">
                  ${
                    SIDES[
                      player.seat
                    ]
                  }
                </span>

              </div>
              `
          )
          .join("")

        : `
          <div class="muted">
            No commanders have taken a side.
          </div>
        `;


  $("#startBtn")
    .disabled =
      !me;

}


/*
  GAME
*/

function renderGame() {

  $("#menuScreen")
    .classList
    .add(
      "hidden"
    );


  $("#lobby")
    .classList
    .add(
      "hidden"
    );


  $("#topbar")
    .classList
    .remove(
      "hidden"
    );


  $("#logButton")
    .classList
    .remove(
      "hidden"
    );


  $("#endTurnBtn")
    .classList
    .remove(
      "hidden"
    );


  const active =
    state.players.find(
      player =>
        player.seat ===
        state.activeSeat
    );


  const me =
    getMe();


  $("#turnLabel")
    .textContent =
      `TURN ${state.turn} — ${
        active
          ? active.name
          : SIDES[
              state.activeSeat
            ]
      }`;


  $("#yourSide")
    .textContent =
      me
        ? SIDES[
            me.seat
          ]
        : "Observer";


  $("#endTurnBtn")
    .disabled =
      !me ||
      me.seat !==
        state.activeSeat;


  renderPlayers();

  renderTracks();

  renderHexes();

  renderLocations();

  renderUnits();

  renderSelected();

  renderLog();


  setTimeout(
    () =>
      map.invalidateSize(),

    0
  );

}


/*
  PLAYER LIST
*/

function renderPlayers() {

  const ordered =
    [...state.players]
      .sort(
        (a, b) =>
          a.seat -
          b.seat
      );


  $("#playerList")
    .innerHTML =
      ordered
        .map(
          (
            player,
            index
          ) => {

            const active =
              player.seat ===
              state.activeSeat;


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

                ${
                  escapeHtml(
                    player.name
                  )
                }

                ${
                  player.id ===
                  playerId
                    ? " (YOU)"
                    : ""
                }

                ${
                  active
                    ? " — ACTIVE"
                    : ""
                }

                <span class="playerSeat">
                  ${
                    SIDES[
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


/*
  POLITICAL TRACKS
*/

function renderTracks() {

  $("#trackList")
    .innerHTML =
      `
      ESCALATION
      &nbsp;
      ${
        state.tracks
          .escalation
      } / 6

      <br>

      COALITION SUPPORT
      &nbsp;
      ${
        state.tracks
          .coalitionSupport
      } / 6

      <br>

      REGIONAL STABILITY
      &nbsp;
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

    map.removeLayer(
      layer
    );

  }


  hexLayers =
    [];


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
        clickHex(
          hex
        )
    );


    polygon.addTo(
      map
    );


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
  CITY LABELS
*/

function renderLocations() {

  for (
    const layer of
    placeLayers
  ) {

    map.removeLayer(
      layer
    );

  }


  placeLayers =
    [];


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
                [
                  100,
                  18
                ],

              iconAnchor:
                [
                  50,
                  9
                ]

            })
        }
      );


    marker.addTo(
      map
    );


    placeLayers.push(
      marker
    );

  }

}


/*
  WARGAME COUNTERS
*/

function renderUnits() {

  for (
    const layer of
    unitLayers
  ) {

    map.removeLayer(
      layer
    );

  }


  unitLayers =
    [];


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


    if (!hex) {
      continue;
    }


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


    const unitClass =
      counterUnitClass(
        unit
      );


    const icon =
      L.divIcon({

        className:
          "",

        html:
          `
          <div
            class="
              unitMarker
              ${
                SIDE_CLASSES[
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
            "
          >

            <div class="counterDesignation">
              ${
                counterDesignation(
                  unit
                )
              }
            </div>

            <div
              class="
                counterSymbol
                ${unitClass}
              "
            ></div>

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

            <span class="counterSteps">
              ${unit.steps}
            </span>

          </div>
          `,

        iconSize:
          [
            45,
            45
          ],

        iconAnchor:
          [
            22,
            22
          ]

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


        clickUnit(
          unit
        );

      }
    );


    marker.addTo(
      map
    );


    unitLayers.push(
      marker
    );

  }

}


/*
  Gives the counter a military symbol.

  These are generic wargame/NATO-style
  visual conventions rather than replicas
  of any individual published counter.
*/

function counterUnitClass(
  unit
) {

  if (
    unit.domain ===
    "naval"
  ) {

    return "naval";

  }


  const name =
    unit.label
      .toLowerCase();


  if (
    name.includes(
      "carrier"
    )
  ) {

    return "naval";

  }


  if (
    name.includes(
      "irregular"
    )
  ) {

    return "irregular";

  }


  if (
    name.includes(
      "expeditionary"
    )
  ) {

    return "armor";

  }


  return "infantry";

}


/*
  Tiny top-line unit designation.
*/

function counterDesignation(
  unit
) {

  const label =
    unit.label;


  if (
    label.includes(
      "I Corps"
    )
  ) {

    return "I CORPS";

  }


  if (
    label.includes(
      "Expeditionary"
    )
  ) {

    return "EXP FORCE";

  }


  if (
    label.includes(
      "Carrier"
    )
  ) {

    return "CVBG";

  }


  if (
    label.includes(
      "Western"
    )
  ) {

    return "WEST ARMY";

  }


  if (
    label.includes(
      "Central"
    )
  ) {

    return "CENT ARMY";

  }


  if (
    label.includes(
      "Gulf Fleet"
    )
  ) {

    return "GULF FLT";

  }


  if (
    label.includes(
      "Regional"
    )
  ) {

    return "REGIONAL";

  }


  if (
    label.includes(
      "Irregular"
    )
  ) {

    return "IRREG";

  }


  return "UNIT";

}


/*
  UNIT SELECTION
*/

function clickUnit(
  unit
) {

  const me =
    getMe();


  if (
    !me ||
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

    } else if (
      unit.owner ===
      me.seat
    ) {

      selectedUnitId =
        unit.id;

    } else {

      send({

        type:
          "attack",

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


/*
  MOVE
*/

function clickHex(
  hex
) {

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

    return;

  }


  send({

    type:
      "move",

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


  setTimeout(
    fetchCurrentState,
    150
  );

}


/*
  UNIT INFO
*/

function renderSelected() {

  const unit =
    getSelectedUnit();


  if (!unit) {

    $("#unitPanel")
      .classList
      .add(
        "hidden"
      );

    return;

  }


  $("#unitPanel")
    .classList
    .remove(
      "hidden"
    );


  $("#selectedUnit")
    .innerHTML =
      `
      <div class="unitTitle">
        ${
          escapeHtml(
            unit.label
          )
        }
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
              ${
                escapeHtml(
                  line
                )
              }
            </div>
            `
        )
        .join("");

}


/*
  GAME DIRECTORY
*/

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
        `
        <div class="muted">
          Could not load lobbies.
        </div>
        `;

  }

}


function renderGameList(
  selector,
  games,
  buttonLabel
) {

  const root =
    $(selector);


  if (
    !games ||
    !games.length
  ) {

    root.innerHTML =
      `
      <div class="muted">
        None.
      </div>
      `;

    return;

  }


  root.innerHTML =
    games
      .map(
        game => {

          const names =
            (
              game.players ||
              []
            )
              .map(
                player =>
                  player.name
              )
              .join(
                ", "
              ) ||
            "Empty";


          return `
            <div class="gameRow">

              <div class="gameRowMeta">

                <div class="gameCode">
                  ${
                    escapeHtml(
                      game.code
                    )
                  }
                </div>

                <div class="gameDesc">

                  ${
                    escapeHtml(
                      game.phase
                    )
                  }

                  ·

                  ${
                    game.players
                      ?.length ||
                    0
                  }/4

                  ·

                  ${
                    escapeHtml(
                      names
                    )
                  }

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
                      data-open-room="${
                        escapeHtml(
                          game.code
                        )
                      }"
                    >
                      ${buttonLabel}
                    </button>
                    `
                  : `
                    <span class="muted">
                      Finished
                    </span>
                    `
              }

            </div>
          `;

        }
      )
      .join("");


  root
    .querySelectorAll(
      "[data-open-room]"
    )
    .forEach(
      button => {

        button.onclick =
          () =>
            openRoom(
              button.dataset
                .openRoom
            );

      }
    );

}


/*
  CLEAR MAP
*/

function clearMapLayers() {

  const allLayers = [

    ...hexLayers,

    ...unitLayers,

    ...placeLayers

  ];


  for (
    const layer of
    allLayers
  ) {

    try {

      map.removeLayer(
        layer
      );

    } catch {}

  }


  hexLayers =
    [];


  unitLayers =
    [];


  placeLayers =
    [];

}


/*
  HELPERS
*/

function getMe() {

  if (!state) {
    return null;
  }


  return (
    state.players.find(
      player =>
        player.id ===
        playerId
    ) ||
    null
  );

}


function getSelectedUnit() {

  if (
    !state ||
    !selectedUnitId
  ) {

    return null;

  }


  return (
    state.units.find(
      unit =>
        unit.id ===
        selectedUnitId
    ) ||
    null
  );

}


function showLoading(
  text
) {

  $("#loadingText")
    .textContent =
      text;


  $("#loading")
    .classList
    .remove(
      "hidden"
    );

}


function hideLoading() {

  $("#loading")
    .classList
    .add(
      "hidden"
    );

}


function escapeHtml(
  value
) {

  return String(
    value
  )
  .replace(
    /[&<>"']/g,

    char =>
      ({

        "&":
          "&amp;",

        "<":
          "&lt;",

        ">":
          "&gt;",

        '"':
          "&quot;",

        "'":
          "&#039;"

      })[char]
  );

}


/*
  INITIAL MENU LOAD
*/

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


/*
  DIRECT ROOM LINKS
*/

if (
  location.hash.length >
  1
) {

  const hashCode =
    location.hash
      .slice(1)
      .toUpperCase();


  $("#joinCode")
    .value =
      hashCode;


  openRoom(
    hashCode
  );

}
