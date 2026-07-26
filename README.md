# F1 Performance Dashboard

Interactive client-side web dashboard analyzing Formula 1 constructor performance from 2021 to the current 2026 season, with strong emphasis on championship runs and driver-level comparisons.

Built as a single-page application using vanilla HTML, CSS, and JavaScript.

### Key Features
- Global season selector (2021–2026, including the in-progress 2026 season)
- Championship overview with wins, podiums, points, poles, and fastest laps
- Head-to-head comparison of any two team drivers in a season
- Driver performance explorer with places gained/lost analysis
- Circuit-by-circuit historical performance
- Interactive visualizations including line charts, stacked bars, radar, and doughnut charts
- Responsive design with light/dark theme support (dark by default)

### Live Demo
https://keonikim.com/f1-redbull-performance/

### Tech Stack
- HTML5, CSS3, Vanilla JavaScript
- Chart.js for data visualization
- Luxon for date handling

### Data Source
Per-race records compiled from official Formula 1 results via the open [Jolpica/Ergast](https://api.jolpi.ca/ergast/) motorsport results database, cross-checked against [Formula1.com results](https://www.formula1.com/en/results). Season and championship statistics are computed client-side from the raw race records. 2026 data runs through the Hungarian Grand Prix (round 11 of 22).

Supporting references: [OpenF1](https://openf1.org/) (telemetry), [FIA documents](https://www.fia.com/documents), [Jolpica-F1 repo](https://github.com/jolpica/jolpica-f1). The original Ergast API is deprecated past 2024.

### Refreshing after a Grand Prix
Sync the latest Red Bull race/sprint results and championship standings into `data/f1-data.json`:

```bash
# See what would change (no write)
python3 scripts/sync-jolpica.py --dry-run

# Apply update for the latest season in the file
python3 scripts/sync-jolpica.py

# Or pin a year / check if local data is behind Jolpica
python3 scripts/sync-jolpica.py --season 2026
python3 scripts/sync-jolpica.py --check
```

The script preserves editorial DNF notes, radar profiles, and photo paths. After a good sync, commit and push — this repo is a static GitHub Pages site, so **the live site updates only when the updated JSON is on `main`** (Pages rebuilds after the push; CDN may take a few minutes).

```bash
git add data/f1-data.json
git commit -m "Data: sync 2026 through latest GP"
git push origin main
```

### Media
Driver portraits and car shots live under `assets/drivers/` and `assets/cars/`. Paths are optional fields on each season driver (`photo`) and season (`carImage`). Images are Wikimedia Commons sources used for illustration; replace with your own assets as needed.

Chassis photos are year-specific: RB16B (2021), RB18 (2022), RB19 (2023), RB20 (2024), RB21 (2025), RB22 (2026).

### Driver Coverage
- **2021–2024:** Max Verstappen and Sergio Pérez (the full-season pairing in all four years)
- **2025:** Verstappen, Liam Lawson (rounds 1–2), and Yuki Tsunoda (round 3 onward)
- **2026:** Verstappen and Isack Hadjar
