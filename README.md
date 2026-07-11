# Red Bull Racing Performance Dashboard

A fully client-side web dashboard exploring **Red Bull Racing's Formula 1 performance
across the 2021–2025 seasons** — championship metrics, race-by-race driver results,
and circuit-level history, with a strong focus on Max Verstappen's title runs.

No build step, no backend, no framework: plain HTML, CSS and JavaScript, with
[Chart.js](https://www.chartjs.org/) for charts and [Luxon](https://moment.github.io/luxon/)
for date handling.

## Features

- **Season selector** — one global filter (2021–2025) that scopes every view, tile and chart.
- **Overview** — stat tiles (points, wins, podiums, poles, fastest laps, DNFs) with
  deltas vs the previous season, cumulative points race-by-race, points per round split
  by driver, constructors' standings, a finish-distribution doughnut, driver-profile
  radar, and the drivers' championship table.
- **Driver & race explorer** — per-driver stat tiles, a places-gained/lost diverging bar
  chart, a points-accumulation line, and the full race table (grid, finish, points,
  pole/fastest-lap/sprint/DNF notes).
- **Circuit performance** — pick any of the 28 circuits in the dataset and see Red Bull's
  record there across seasons: Verstappen's finishing positions per visit, team points
  per event, and the full results table.
- **Interactive charts** — line, stacked bar, horizontal bar, radar and doughnut, each
  with hover tooltips (and a tracking crosshair on line charts). Every chart also has a
  **"View data as table"** twin, so no value is reachable only by hovering.
- **Light & dark themes** — follows your OS preference, with a manual toggle that
  persists. Chart colors are re-derived from CSS custom properties on switch.
- **Fully responsive** — stat tiles reflow, chart grids collapse to one column, and
  wide tables scroll inside their own container on small screens.

## Data

All data lives in a single file: [`data/f1-data.json`](data/f1-data.json).

> **Important:** this is **realistic sample data**, hand-modelled on the real
> 2021–2025 seasons for demonstration purposes. Season-level figures track official
> results closely (e.g. Verstappen 395.5 pts in 2021, 454 in 2022, 575 in 2023,
> 437 in 2024), but individual race entries are approximations and the 2025 season is
> partly illustrative. It is **not** an official F1/FIA/Formula One Management data
> source and should not be cited as one. For real data, see the
> [Jolpica-F1 API](https://github.com/jolpica/jolpica-f1) (the successor to the Ergast
> API) or the [FastF1](https://docs.fastf1.dev/) Python package.

The schema is deliberately simple:

```jsonc
{
  "circuits": { "monza": { "name": "...", "country": "...", "lengthKm": 5.793, ... } },
  "seasons": {
    "2023": {
      "car": "RB19",
      "teamPosition": 1,
      "drivers": [ { "id": "verstappen", "name": "Max Verstappen", ... } ],
      "rivalDriverStandings": [ ... ],       // top non-Red-Bull scorers
      "rivalConstructorStandings": [ ... ],  // other teams' final points
      "profiles": { "verstappen": { "qualifying": 9.8, ... } },  // radar ratings
      "races": [
        {
          "round": 14, "gp": "Italian Grand Prix", "circuit": "monza",
          "date": "2023-09-03", "winner": "Max Verstappen",
          "results": {
            "verstappen": { "grid": 2, "finish": 1, "points": 25 },
            "perez":      { "grid": 5, "finish": 2, "points": 18 }
          }
        }
      ]
    }
  }
}
```

Conventions worth knowing:

- `points` per race is the **weekend total** — sprint and fastest-lap points folded in
  (broken out via the optional `sprint` and `fl` fields).
- A DNF is `finish: null` plus a human-readable `status`.
- Everything shown in the UI (wins, podiums, cumulative points, standings positions,
  circuit history) is **derived from the race records at load time** — see
  [`js/data.js`](js/data.js) — so tiles, charts and tables always agree.

## Key insights surfaced by the dashboard

- **2023 was the most dominant season in F1 history**: 19 wins for Verstappen
  (including a record 10 in a row), 575 points, and 860 team points — visible as a
  near-straight cumulative-points line and a doughnut that is mostly "Wins".
- **2021 vs 2024 tell opposite stories with similar win counts**: ~10 wins each, but
  2021 was a season-long title duel while 2024 was a strong start followed by defending
  a lead as McLaren and Ferrari overhauled the RB20.
- **The second seat is the team's weak point**: the driver-split view shows Pérez
  contributing 40% of the team's points in 2022 but only ~26% by 2024, and the
  2025 Lawson→Tsunoda rotation contributing under 15%.
- **Circuit view highlights strongholds**: the Red Bull Ring, Suzuka and Zandvoort show
  consistent front-running finishes, while Singapore stands out as the one circuit that
  resisted the 2023 steamroller.

## Project structure

```
f1-redbull-performance/
├── index.html          # Single page: header, tabs, three views, chart canvases
├── README.md
├── css/
│   └── styles.css      # Theme tokens (light/dark), layout, tiles, tables
├── data/
│   └── f1-data.json    # Sample dataset: circuits + 5 seasons of race records
└── js/
    ├── config.js       # Palette plumbing; fixed team/driver → color mapping
    ├── data.js         # Data loading + every derived statistic
    ├── charts.js       # Chart.js factories, shared theme, plugins, table builder
    └── app.js          # State, view rendering, event wiring
```

Chart.js and Luxon are loaded from the jsDelivr CDN with pinned versions — there is
nothing to install.

## Running locally

The page fetches `data/f1-data.json`, so it must be served over HTTP (opening
`index.html` directly via `file://` is blocked by browser CORS rules). Any static
server works:

```bash
# Python (preinstalled on macOS/Linux)
python3 -m http.server 8000

# or Node
npx serve
```

Then open <http://localhost:8000>.

## Deploying to GitHub Pages

The project is 100% static, so GitHub Pages hosts it as-is:

1. Push the repository to GitHub:

   ```bash
   git remote add origin https://github.com/<your-username>/f1-redbull-performance.git
   git push -u origin main
   ```

2. On GitHub, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*, choose the
   `main` branch and the `/ (root)` folder, and save.
4. After a minute, the dashboard is live at
   `https://<your-username>.github.io/f1-redbull-performance/`.

All asset paths in the project are relative, so it works from a subpath without
configuration. To update the live site, just push to `main`.

## Design notes

- **Color is assigned by entity, not rank**: Red Bull is always blue, Ferrari always
  red, McLaren always orange, and the teammate seat always yellow — filtering or
  re-sorting never repaints a series. The eight-slot categorical palette was validated
  for color-vision-deficiency separation and contrast in both themes.
- The finish-distribution doughnut uses a single-hue **ordinal ramp** (dark → light =
  best → worst result) rather than categorical hues, because its buckets are ordered.
- The places-gained chart uses a **diverging blue/red pair** around a neutral zero.
- Text never wears a series color; identity comes from a colored swatch beside the text.
- Tooltips enhance but never gate: every chart has a table twin.

## License

Sample/educational project. Red Bull Racing, Formula 1 and all related marks belong to
their respective owners; this dashboard is an unofficial fan-made demo and is not
affiliated with or endorsed by them.
