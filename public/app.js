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


/*
  PERSISTENT DEVICE PLAYER ID

  This lets the main menu know
  which games belong to you after
  you quit or revisit the website.
*/

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


/*
  REMEMBER NAME
*/

const savedName =
  localStorage.cigPlayerName ||
  "";


$("#menuName").value =
  savedName;


$("#playerName").value =
  savedName;


/*
  MAP
*/

const map =
  L.map(
    "map",
    {
      zoomControl: true,

      minZoom: 4,

      maxZoom: 9
    }
  ).setView(
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
).addTo(map);


/*
  BUTTONS
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
    ).trim() ||
    "Player";


  rememberName(
    name
  );


  showLoading(
    "Creating lobby…"
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
  OPEN / RESUME ROOM
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
    "Connecting…"
  );


  /*
    Close previous socket WITHOUT
    triggering reconnect behavior.
  */

  intentionalClose =
    true;


  if (ws) {

    try {
      ws.close();
    } catch {}

  }


  ws = null;


  intentionalClose =
    false;


  clearInterval(
    pollTimer
  );


  connectSocket();


  /*
    Critical fix:

    don't wait on the WebSocket
    before showing game state.

    Fetch it immediately over HTTP.
  */

  await fetchCurrentState();


  /*
    Remove loading even if Safari
    takes a while to negotiate WS.
  */

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

      /*
        Do nothing dramatic.

        Polling keeps the game alive.
      */

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


      /*
        Quietly reconnect.

        No full-screen "Connecting"
        screen here.
      */

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
  FALLBACK POLLING

  Every second.

  This is intentionally redundant
  with WebSockets so iPhone Safari
  cannot leave the UI stale.
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


/*
  FETCH AUTHORITATIVE STATE
*/

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


    if (
      !response.ok
    ) {
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


/*
  APPLY SERVER STATE
*/

function applyState(
  newState
) {

  state =
    newState;


  hideLoading();


  render();

}


/*
  SEND

  WebSocket is the fast path.

  HTTP polling will reconcile
  afterward automatically.
*/

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


  /*
    Try reconnecting rather than
    making the user refresh.
  */

  connectSocket();


  return false;
}


/*
  TAKE SIDE

  This now immediately gives
  visual feedback, then pulls
  authoritative state again.
*/

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
    send(message)
  ) {

    $("#lobbyStatus")
      .textContent =
        "Side selected.";

  } else {

    /*
      Socket happened to be down.
      Try again very shortly.
    */

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


  setTimeout(
    fetchCurrentState,
    500
  );

}


/*
  START

  No indefinite loading screen.

  One-player test games allowed.
*/

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


/*
  LEAVE WAITING LOBBY

  Releases your side.
*/

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
  EXIT AN ACTIVE GAME

  Important:

  This does NOT remove you
  from the game.

  Therefore it appears under
  "My Current Games" and can
  be resumed later.
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
  MASTER RENDER
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
        `You are ${SIDES[me.seat]}.`;

  } else {

    $("#lobbyStatus")
      .textContent =
        "Choose a side.";

  }


  const ordered =
    [...state.players]
      .sort(
        (a, b) =>
          a.seat -
          b.seat
      );


  if (
    !ordered.length
  ) {

    $("#lobbyPlayers")
      .innerHTML =
        `
        <div class="muted">
          No players have taken a side yet.
        </div>
        `;

  } else {

    $("#lobbyPlayers")
      .innerHTML =
        ordered
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
          .join("");

  }


  /*
    Only need ONE player,
    but it must be you / you
    must have taken a side.
  */

  $("#startBtn")
    .disabled =
      !me;

}


/*
  ACTIVE GAME
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
      `TURN ${state.turn} · ${
        active
          ? active.name
          : SIDES[
              state.activeSeat
            ]
      }`;


  $("#yourSide")
    .textContent =
      me
        ? `You: ${SIDES[me.seat]}`
        : "Spectating";


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
  PLAYERS
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
  TRACKS
*/

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
  MAP HEXES
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
  PLACE LABELS
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
                  20
                ],

              iconAnchor:
                [
                  50,
                  10
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
  UNITS
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


    const icon =
      L.divIcon({

        className:
          "",

        html:
          `
          <div class="
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
          [
            38,
            38
          ],

        iconAnchor:
          [
            19,
            19
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
  UNIT CLICK
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
  HEX CLICK
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
  SELECTED UNIT
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

      A${unit.attack}
      ·
      D${unit.defense}
      ·
      M${unit.move}
      ·
      ${unit.steps} steps

      <br>

      ${
        unit.movedTurn ===
        state.turn

          ? "Moved"

          : "Movement available"
      }

      ·

      ${
        unit.attackedTurn ===
        state.turn

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
  MAIN MENU DIRECTORY
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


/*
  RENDER MENU GAME LIST
*/

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
                      ? ` · turn ${game.turn}`
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
  CLEAN UP MAP
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


  hexLayers = [];

  unitLayers = [];

  placeLayers = [];

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
    ) || null
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
    ) || null
  );

}


function shortUnitName(
  unit
) {

  if (
    unit.domain ===
    "naval"
  ) {

    return (
      unit.owner === 0
        ? "CV"
        : "NAV"
    );

  }


  if (
    unit.label.includes(
      "Corps"
    )
  ) {
    return "CORPS";
  }


  if (
    unit.label.includes(
      "Army"
    )
  ) {
    return "ARMY";
  }


  if (
    unit.label.includes(
      "Expeditionary"
    )
  ) {
    return "EXP";
  }


  if (
    unit.label.includes(
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
  ).replace(
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
  INITIAL LOAD

  Menu refreshes every 3 seconds
  while you're sitting on it.
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
  OLD ROOM LINK

  URLs like:
  site.com/#ABC123

  still work.
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
