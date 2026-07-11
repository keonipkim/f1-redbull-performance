/* ==========================================================================
 * app.js — state, wiring, and the three views.
 *
 * State is tiny: selected season (scopes every view), selected driver and
 * circuit (explorer dimensions), active tab, theme. Any state change
 * re-renders from the derived data in data.js; charts are rebuilt so they
 * pick up the current theme's CSS variables.
 * ========================================================================== */

"use strict";

const { DateTime } = luxon;

const state = {
  season: null,   // e.g. "2025"
  driver: null,   // driver id within the season
  circuit: null,  // circuit id
  view: "overview",
};

/* ---- Small helpers -------------------------------------------------------- */

const $ = (sel) => document.querySelector(sel);

function fmtDate(iso) {
  return DateTime.fromISO(iso).toLocaleString(DateTime.DATE_MED);
}

function fmtPoints(n) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function positionLabel(result) {
  return result.finish === null ? "DNF" : `P${result.finish}`;
}

/** One stat tile; delta is optional {value, goodWhenUp, vs}. */
function tile(label, value, delta) {
  const el = document.createElement("div");
  el.className = "tile";
  const l = document.createElement("div");
  l.className = "label";
  l.textContent = label;
  const v = document.createElement("div");
  v.className = "value";
  v.textContent = value;
  el.append(l, v);
  if (delta) {
    const d = document.createElement("div");
    const good = delta.goodWhenUp ? delta.value > 0 : delta.value < 0;
    d.className = "delta " + (delta.value === 0 ? "flat" : good ? "up" : "down");
    const sign = delta.value > 0 ? "+" : "";
    d.textContent = `${sign}${fmtPoints(delta.value)} vs ${delta.vs}`;
    el.appendChild(d);
  }
  return el;
}

function renderTiles(containerSel, tiles) {
  const box = $(containerSel);
  box.textContent = "";
  tiles.forEach((t) => box.appendChild(t));
}

/* ==========================================================================
 * Overview view
 * ========================================================================== */

function renderOverview() {
  const year = state.season;
  const season = DATA.season(year);
  const stats = DATA.teamStats(year);
  const years = DATA.seasonYears();
  const prevYear = years[years.indexOf(year) - 1];
  const prev = prevYear ? DATA.teamStats(prevYear) : null;

  // Season subtitle: car, calendar span (Luxon), championship position.
  const first = season.races[0], last = season.races[season.races.length - 1];
  const span = `${DateTime.fromISO(first.date).toFormat("d LLL")} – ${DateTime.fromISO(last.date).toFormat("d LLL yyyy")}`;
  $("#overview-sub").textContent =
    `${season.car} · ${season.races.length} rounds (${span}) · P${season.teamPosition} in the Constructors' Championship`;

  // ---- Stat tiles (team totals, delta vs previous season) ----
  const d = (key, goodWhenUp = true) =>
    prev ? { value: stats[key] - prev[key], goodWhenUp, vs: prevYear } : null;
  renderTiles("#overview-tiles", [
    tile("Constructors' position", `P${season.teamPosition}`),
    tile("Points", fmtPoints(stats.points), d("points")),
    tile("Wins", stats.wins, d("wins")),
    tile("Podiums", stats.podiums, d("podiums")),
    tile("Poles", stats.poles, d("poles")),
    tile("Fastest laps", stats.fastestLaps, d("fastestLaps")),
    tile("DNFs", stats.dnfs, d("dnfs", false)),
  ]);

  const labels = DATA.roundLabels(year);
  const gpName = (i) => season.races[i].gp;

  // ---- Cumulative championship points (line, one series per driver) ----
  const cumSeries = season.drivers.map((drv) => ({
    label: drv.name,
    data: DATA.cumulativePoints(year, drv.id),
    color: driverColor(drv.id),
  }));
  const cumChart = CHARTS.line("chart-cumulative", labels, cumSeries, { yTitle: "Points" });
  cumChart.options.plugins.tooltip.callbacks = { title: (items) => gpName(items[0].dataIndex) };
  cumChart.update();

  renderTable(
    $("#table-cumulative"),
    [{ label: "Round" }, { label: "Grand Prix" }, ...season.drivers.map((drv) => ({ label: drv.name, num: true }))],
    season.races.map((race, i) => [
      `R${race.round}`,
      race.gp,
      ...cumSeries.map((s) => (s.data[i] === null ? "—" : fmtPoints(s.data[i]))),
    ])
  );

  // ---- Points per round (stacked bar, driver split) ----
  const roundSeries = season.drivers.map((drv) => ({
    label: drv.name,
    data: season.races.map((race) => (race.results[drv.id] ? race.results[drv.id].points : 0)),
    color: driverColor(drv.id),
  }));
  CHARTS.bar("chart-rounds", labels, roundSeries, { stacked: true, yTitle: "Points", tooltipTitle: gpName });

  renderTable(
    $("#table-rounds"),
    [{ label: "Round" }, { label: "Grand Prix" }, ...season.drivers.map((drv) => ({ label: drv.name, num: true })), { label: "Team", num: true }],
    season.races.map((race, i) => [
      `R${race.round}`,
      race.gp,
      ...roundSeries.map((s) => fmtPoints(s.data[i])),
      fmtPoints(roundSeries.reduce((a, s) => a + s.data[i], 0)),
    ])
  );

  // ---- Constructors' standings (horizontal bar, entity colors) ----
  const ctors = DATA.constructorStandings(year);
  CHARTS.hbar(
    "chart-constructors",
    ctors.map((c) => c.team),
    ctors.map((c) => c.points),
    ctors.map((c) => teamColor(c.team)),
    { xTitle: "Points" }
  );

  renderTable(
    $("#table-constructors"),
    [{ label: "Pos", num: true }, { label: "Team" }, { label: "Points", num: true }],
    ctors.map((c) => [c.position, { text: c.team, swatch: teamColor(c.team) }, fmtPoints(c.points)]),
    { rowClass: (i) => (ctors[i].isRedBull ? "highlight" : "") }
  );

  // ---- Finish distribution (doughnut, ordinal ramp: best -> worst) ----
  const dist = DATA.finishDistribution(year);
  const distLabels = Object.keys(dist);
  const distValues = Object.values(dist);
  const distColors = [...ordinalRamp(), cssVar("--series-other")]; // DNF wears neutral gray
  CHARTS.doughnut("chart-distribution", distLabels, distValues, distColors);

  renderTable(
    $("#table-distribution"),
    [{ label: "Result" }, { label: "Car-races", num: true }, { label: "Share", num: true }],
    distLabels.map((l, i) => {
      const total = distValues.reduce((a, b) => a + b, 0);
      return [{ text: l, swatch: distColors[i] }, distValues[i], `${Math.round((distValues[i] / total) * 100)}%`];
    })
  );

  // ---- Driver profiles (radar) ----
  const axes = ["Qualifying", "Race pace", "Racecraft", "Consistency", "Tyre mgmt", "Wet weather"];
  const keys = ["qualifying", "racePace", "racecraft", "consistency", "tyreManagement", "wetWeather"];
  const radarSeries = season.drivers
    .filter((drv) => season.profiles[drv.id])
    .map((drv) => ({
      label: drv.name,
      data: keys.map((k) => season.profiles[drv.id][k]),
      color: driverColor(drv.id),
    }));
  CHARTS.radar("chart-radar", axes, radarSeries);

  renderTable(
    $("#table-radar"),
    [{ label: "Attribute" }, ...radarSeries.map((s) => ({ label: s.label, num: true }))],
    axes.map((a, i) => [a, ...radarSeries.map((s) => s.data[i].toFixed(1))])
  );

  // ---- Drivers' championship table ----
  const standings = DATA.driverStandings(year);
  renderTable(
    $("#table-driver-standings"),
    [{ label: "Pos", num: true }, { label: "Driver" }, { label: "Team" }, { label: "Points", num: true }],
    standings.map((s) => [s.position, s.name, { text: s.team, swatch: teamColor(s.team) }, fmtPoints(s.points)]),
    { rowClass: (i) => (standings[i].isRedBull ? "highlight" : "") }
  );
}

/* ==========================================================================
 * Driver & race explorer
 * ========================================================================== */

function renderDrivers() {
  const year = state.season;
  const season = DATA.season(year);

  // (Re)populate the driver selector for this season.
  const sel = $("#driver-select");
  sel.textContent = "";
  for (const drv of season.drivers) {
    const opt = document.createElement("option");
    opt.value = drv.id;
    opt.textContent = `${drv.name} (#${drv.number})`;
    sel.appendChild(opt);
  }
  if (!season.drivers.some((drv) => drv.id === state.driver)) state.driver = season.drivers[0].id;
  sel.value = state.driver;

  const rows = DATA.driverRaces(year, state.driver);
  const stats = DATA.driverStats(year, state.driver);
  const finishes = rows.filter((r) => r.result.finish !== null).map((r) => r.result.finish);
  const avgFinish = finishes.length ? (finishes.reduce((a, b) => a + b, 0) / finishes.length).toFixed(1) : "—";

  renderTiles("#driver-tiles", [
    tile("Points", fmtPoints(stats.points)),
    tile("Wins", stats.wins),
    tile("Podiums", stats.podiums),
    tile("Poles", stats.poles),
    tile("Fastest laps", stats.fastestLaps),
    tile("Avg finish", avgFinish),
    tile("DNFs", stats.dnfs),
  ]);

  const labels = rows.map(({ race }) => `R${race.round}`);
  const gpName = (i) => rows[i].race.gp;

  // ---- Positions gained/lost per race (diverging bars: blue up, red down) ----
  const pair = divergingPair();
  const deltas = rows.map(({ result }) => (result.finish === null ? null : result.grid - result.finish));
  const colors = deltas.map((v) => (v === null || v === 0 ? pair.mid : v > 0 ? pair.pos : pair.neg));
  const deltaChart = CHARTS.bar("chart-driver-delta", labels, [{ label: "Places", data: deltas, colors }], {
    yTitle: "Places gained vs grid",
    tooltipTitle: gpName,
  });
  deltaChart.options.plugins.tooltip.callbacks.label = (item) => {
    const v = item.raw;
    if (v === null) return " DNF";
    if (v === 0) return " Finished where they started";
    return ` ${v > 0 ? "Gained" : "Lost"} ${Math.abs(v)} place${Math.abs(v) === 1 ? "" : "s"}`;
  };
  deltaChart.update();

  // ---- Cumulative points (single series — title carries the identity) ----
  let running = 0;
  const cum = rows.map(({ result }) => (running += result.points));
  CHARTS.line("chart-driver-cumulative", labels, [
    { label: DATA.driverName(year, state.driver), data: cum, color: driverColor(state.driver) },
  ], { yTitle: "Points" });

  // ---- Full race table (grid, finish, points, notes) ----
  renderTable(
    $("#table-driver-races"),
    [
      { label: "Rnd", num: true }, { label: "Grand Prix" }, { label: "Date" },
      { label: "Grid", num: true }, { label: "Finish", num: true }, { label: "Points", num: true }, { label: "Notes" },
    ],
    rows.map(({ race, result }) => {
      const notes = [];
      if (result.grid === 1) notes.push("Pole");
      if (result.fl) notes.push("Fastest lap");
      if (result.sprint) notes.push(`Sprint +${result.sprint}`);
      if (result.status) notes.push(result.status);
      else if (result.note) notes.push(result.note);
      return [
        race.round, race.gp, fmtDate(race.date),
        `P${result.grid}`, positionLabel(result), fmtPoints(result.points),
        notes.join(" · ") || "—",
      ];
    }),
    { rowClass: (i) => (rows[i].result.finish === 1 ? "highlight" : "") }
  );
}

/* ==========================================================================
 * Circuit performance view
 * ========================================================================== */

function renderCircuits() {
  // Populate the circuit selector once (all circuits across all seasons).
  const sel = $("#circuit-select");
  if (!sel.options.length) {
    for (const id of DATA.allCircuitIds()) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = `${DATA.circuit(id).name} — ${DATA.circuit(id).country}`;
      sel.appendChild(opt);
    }
    state.circuit = state.circuit || "redbullring";
  }
  sel.value = state.circuit;

  const circuit = DATA.circuit(state.circuit);
  const history = DATA.circuitHistory(state.circuit);

  $("#circuit-sub").textContent =
    `${circuit.location}, ${circuit.country} · ${circuit.lengthKm.toFixed(3)} km · ${circuit.laps} laps · ${circuit.type} circuit`;

  // ---- Red Bull record at this circuit (2021–2025 sample window) ----
  const verRows = history.filter((h) => h.ver);
  const verWins = verRows.filter((h) => h.ver.finish === 1).length;
  const verPodiums = verRows.filter((h) => h.ver.finish !== null && h.ver.finish <= 3).length;
  const verPoles = verRows.filter((h) => h.ver.grid === 1).length;
  const best = Math.min(...verRows.filter((h) => h.ver.finish !== null).map((h) => h.ver.finish));
  const avgTeamPts = history.reduce((a, h) => a + h.teamPoints, 0) / history.length;

  renderTiles("#circuit-tiles", [
    tile("Races held (dataset)", history.length),
    tile("Verstappen wins", verWins),
    tile("Verstappen podiums", verPodiums),
    tile("Verstappen poles", verPoles),
    tile("Best finish", isFinite(best) ? `P${best}` : "—"),
    tile("Avg team points / event", avgTeamPts.toFixed(1)),
  ]);

  const labels = history.map((h) => (history.filter((x) => x.year === h.year).length > 1 ? `${h.year} (${h.race.gp.split(" ")[0]})` : h.year));
  const gpName = (i) => `${history[i].race.gp} ${history[i].year}`;

  // ---- Verstappen finishing position by season (reversed axis: P1 on top) ----
  const posChart = CHARTS.line("chart-circuit-pos", labels, [
    {
      label: "Max Verstappen — finish",
      data: history.map((h) => (h.ver && h.ver.finish !== null ? h.ver.finish : null)),
      color: driverColor("verstappen"),
      showPoints: true,
    },
  ], { reverse: true, yMax: 20, endLabelFmt: (v) => `P${v}` });
  posChart.options.plugins.tooltip.callbacks = {
    title: (items) => gpName(items[0].dataIndex),
    label: (item) => (item.raw === null ? " DNF" : ` Finished P${item.raw}`),
  };
  posChart.update();

  // ---- Team points per event here ----
  CHARTS.bar("chart-circuit-points", labels, [
    { label: "Team points", data: history.map((h) => h.teamPoints), color: driverColor("verstappen") },
  ], { yTitle: "Points", tooltipTitle: gpName });

  // ---- Full results table at this circuit ----
  renderTable(
    $("#table-circuit"),
    [
      { label: "Year" }, { label: "Grand Prix" }, { label: "Winner" },
      { label: "VER grid", num: true }, { label: "VER finish", num: true }, { label: "Team points", num: true },
    ],
    history.map((h) => [
      h.year, h.race.gp, h.race.winner,
      h.ver ? `P${h.ver.grid}` : "—", h.ver ? positionLabel(h.ver) : "—", fmtPoints(h.teamPoints),
    ]),
    { rowClass: (i) => (history[i].ver && history[i].ver.finish === 1 ? "highlight" : "") }
  );
}

/* ==========================================================================
 * Wiring
 * ========================================================================== */

function renderAll() {
  renderOverview();
  renderDrivers();
  renderCircuits();
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll(".tab").forEach((btn) => {
    const active = btn.dataset.view === view;
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".view").forEach((sec) => {
    sec.hidden = sec.id !== `view-${view}`;
  });
}

function initTheme() {
  // Precedence: ?theme= URL param (deep links) > stored choice > OS preference.
  const param = new URLSearchParams(location.search).get("theme");
  const stored = localStorage.getItem("rbr-theme");
  const preferred = (param === "light" || param === "dark" ? param : null) ||
    stored || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = preferred;
  updateThemeButton();
}

function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === "dark";
  $("#theme-toggle").textContent = dark ? "☀ Light" : "☾ Dark";
}

async function init() {
  initTheme();

  try {
    await DATA.load();
  } catch (err) {
    // fetch() of local JSON fails when the page is opened via file:// —
    // point at the one-line fix instead of showing a blank page.
    $("main").innerHTML = "";
    const n = document.createElement("div");
    n.className = "notice";
    n.append(
      Object.assign(document.createElement("p"), {
        textContent: "Could not load data/f1-data.json — this page needs to be served over HTTP.",
      }),
      Object.assign(document.createElement("p"), { style: "margin-top:8px" })
    );
    const p = n.lastChild;
    p.append("Run ", Object.assign(document.createElement("code"), { textContent: "python3 -m http.server 8000" }),
      " (or ", Object.assign(document.createElement("code"), { textContent: "npx serve" }),
      ") in the project folder, then open ",
      Object.assign(document.createElement("code"), { textContent: "http://localhost:8000" }), ".");
    $("main").appendChild(n);
    console.error(err);
    return;
  }

  // Season selector (global filter — scopes every view below it).
  const seasonSel = $("#season-select");
  for (const year of DATA.seasonYears()) {
    const opt = document.createElement("option");
    opt.value = year;
    opt.textContent = `${year} season`;
    seasonSel.appendChild(opt);
  }
  // Deep link ?season=YYYY, else default to the most recent season.
  const seasonParam = new URLSearchParams(location.search).get("season");
  state.season = DATA.seasonYears().includes(seasonParam) ? seasonParam : DATA.seasonYears().at(-1);
  seasonSel.value = state.season;
  seasonSel.addEventListener("change", () => {
    state.season = seasonSel.value;
    renderAll();
  });

  // Tabs.
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  // Explorer selectors.
  $("#driver-select").addEventListener("change", (e) => {
    state.driver = e.target.value;
    renderDrivers();
  });
  $("#circuit-select").addEventListener("change", (e) => {
    state.circuit = e.target.value;
    renderCircuits();
  });

  // Theme toggle: flip the attribute, then rebuild charts against the new vars.
  $("#theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("rbr-theme", next);
    updateThemeButton();
    renderAll();
  });

  $("#footer-note").textContent = DATA.raw.meta.note;

  // Deep links: ?view=drivers|circuits opens straight to that tab.
  const viewParam = new URLSearchParams(location.search).get("view");
  switchView(["overview", "drivers", "circuits"].includes(viewParam) ? viewParam : "overview");
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);
