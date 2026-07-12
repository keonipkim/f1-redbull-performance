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
Per-race records compiled from official Formula 1 results via the open Jolpica/Ergast motorsport results database, cross-checked against Formula1.com. Season and championship statistics are computed client-side from the raw race records. 2026 data runs through the British Grand Prix (round 9 of 22).

### Driver Coverage
- **2021–2024:** Max Verstappen and Sergio Pérez (the full-season pairing in all four years)
- **2025:** Verstappen, Liam Lawson (rounds 1–2), and Yuki Tsunoda (round 3 onward)
- **2026:** Verstappen and Isack Hadjar
