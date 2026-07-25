#!/usr/bin/env python3
"""
Refresh Red Bull season data in data/f1-data.json from the Jolpica-F1 API
(Ergast-compatible successor: https://api.jolpi.ca/ergast/).

Preserves hand-authored fields:
  - profiles, photos, carImage, car name, partial-season rounds windows
  - per-result status / note text when the same round+driver still exists
  - pit-lane grid (0) when a preserved note mentions pit-lane

Usage:
  python3 scripts/sync-jolpica.py              # current (latest) season in the file
  python3 scripts/sync-jolpica.py --season 2026
  python3 scripts/sync-jolpica.py --dry-run    # print summary, write nothing
  python3 scripts/sync-jolpica.py --check      # exit 0 if already up to date

After a successful sync, commit and push to update GitHub Pages:
  git add data/f1-data.json && git commit -m "Data: sync 2026 through R…" && git push
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "data" / "f1-data.json"
API_BASE = "https://api.jolpi.ca/ergast/f1"
USER_AGENT = "f1-redbull-performance/1.0 (local sync; +https://github.com/keonipkim/f1-redbull-performance)"

# Jolpica constructorId for Oracle Red Bull Racing
CONSTRUCTOR_ID = "red_bull"

# Jolpica driverId → our dashboard id
DRIVER_ID_MAP = {
    "max_verstappen": "verstappen",
    "perez": "perez",
    "lawson": "lawson",
    "tsunoda": "tsunoda",
    "hadjar": "hadjar",
}

# Jolpica circuitId → our circuits key in f1-data.json
CIRCUIT_MAP = {
    "albert_park": "albertpark",
    "shanghai": "shanghai",
    "suzuka": "suzuka",
    "bahrain": "bahrain",
    "jeddah": "jeddah",
    "miami": "miami",
    "imola": "imola",
    "monaco": "monaco",
    "catalunya": "barcelona",
    "villeneuve": "montreal",
    "red_bull_ring": "redbullring",
    "silverstone": "silverstone",
    "hungaroring": "hungaroring",
    "spa": "spa",
    "zandvoort": "zandvoort",
    "monza": "monza",
    "baku": "baku",
    "marina_bay": "singapore",
    "americas": "cota",
    "rodriguez": "mexico",
    "interlagos": "interlagos",
    "vegas": "lasvegas",
    "losail": "losail",
    "yas_marina": "yasmarina",
    "madring": "madring",  # 2026 Madrid — add circuit meta if missing
    "portimao": "portimao",
    "paul_ricard": "paulricard",
    "sochi": "sochi",
    "istanbul": "istanbul",
}

# Constructors kept named in the rival chart; the rest roll into "Others"
NAMED_CONSTRUCTORS = ("mercedes", "ferrari", "mclaren", "alpine", "rb")

TEAM_DISPLAY = {
    "mercedes": "Mercedes",
    "ferrari": "Ferrari",
    "mclaren": "McLaren",
    "alpine": "Alpine",
    "rb": "Racing Bulls",
    "haas": "Haas",
    "williams": "Williams",
    "audi": "Audi",
    "aston_martin": "Aston Martin",
    "cadillac": "Cadillac",
    "red_bull": "Red Bull",
    "sauber": "Kick Sauber",
    "alphatauri": "AlphaTauri",
}

# Ergast positionText / status values that mean "not classified"
DNF_POSITION_TEXT = {"R", "D", "W", "E", "F", "N"}
DNF_STATUS = {
    "Retired",
    "Disqualified",
    "Withdrew",
    "Excluded",
    "Did not start",
    "Did not qualify",
    "Did not prequalify",
    "Collision",
    "Collision damage",
    "Accident",
    "Spun off",
    "Engine",
    "Gearbox",
    "Transmission",
    "Electrical",
    "Hydraulics",
    "Brakes",
    "Power Unit",
    "ERS",
    "Oil leak",
    "Fuel system",
    "Suspension",
    "Wheel",
    "Tyre",
    "Overheating",
    "Mechanical",
    "Power loss",
    "Exhaust",
    "Clutch",
    "Driveshaft",
    "Rear wing",
    "Front wing",
    "Undertray",
    "Water leak",
    "Oil pressure",
    "Fuel pressure",
    "Ignition",
    "Battery",
    "Turbo",
}


def log(msg: str = "") -> None:
    print(msg, file=sys.stderr)


def get_json(url: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} fetching {url}") from e
    except urllib.error.URLError as e:
        raise SystemExit(f"Network error fetching {url}: {e.reason}") from e


def num(v: Any) -> int | float:
    f = float(v)
    return int(f) if f == int(f) else f


def map_driver(api_id: str) -> str | None:
    return DRIVER_ID_MAP.get(api_id)


def map_circuit(api_id: str) -> str:
    return CIRCUIT_MAP.get(api_id, api_id.replace("_", ""))


def is_dnf(res: dict[str, Any]) -> bool:
    if res.get("positionText") in DNF_POSITION_TEXT:
        return True
    status = res.get("status") or ""
    if status in DNF_STATUS:
        return True
    if status.startswith("Retired") or status.startswith("+"):
        # "+1 Lap" etc. are classified — only pure retired
        if status.startswith("+"):
            return False
    if status == "Retired":
        return True
    # Classified finishes: Finished, +N Laps, Lapped
    if status in ("Finished", "Lapped") or status.startswith("+"):
        return False
    # If position is numeric and status is not retired-like, trust position
    try:
        int(res.get("position", ""))
        return False
    except (TypeError, ValueError):
        return True


def status_label(res: dict[str, Any]) -> str:
    status = res.get("status") or "Retired"
    if status == "Retired":
        return "DNF"
    if status in DNF_STATUS or res.get("positionText") in DNF_POSITION_TEXT:
        return f"DNF — {status}" if not status.startswith("DNF") else status
    return f"DNF — {status}"


def fetch_season_bundle(season: str) -> dict[str, Any]:
    """Pull all Jolpica endpoints needed for one season."""
    base = f"{API_BASE}/{season}"
    log(f"Fetching Jolpica data for {season}…")
    races = get_json(f"{base}/constructors/{CONSTRUCTOR_ID}/results.json?limit=200")
    sprint = get_json(f"{base}/constructors/{CONSTRUCTOR_ID}/sprint.json?limit=100")
    ctors = get_json(f"{base}/constructorStandings.json")
    drivers = get_json(f"{base}/driverStandings.json")
    schedule = get_json(f"{base}.json?limit=30")

    race_list = races["MRData"]["RaceTable"]["Races"]
    if not race_list:
        raise SystemExit(f"No race results yet for {season} (constructor {CONSTRUCTOR_ID}).")

    # Winners per completed round (paginate if needed)
    winners: dict[int, str] = {}
    for race in race_list:
        rnd = int(race["round"])
        detail = get_json(f"{base}/{rnd}/results.json?limit=30")
        rows = detail["MRData"]["RaceTable"]["Races"]
        if not rows:
            continue
        for res in rows[0]["Results"]:
            if res.get("position") == "1":
                winners[rnd] = f"{res['Driver']['givenName']} {res['Driver']['familyName']}"
                break

    return {
        "races": race_list,
        "sprint": sprint["MRData"]["RaceTable"]["Races"],
        "ctors": ctors["MRData"]["StandingsTable"]["StandingsLists"][0],
        "drivers": drivers["MRData"]["StandingsTable"]["StandingsLists"][0],
        "schedule": schedule["MRData"]["RaceTable"]["Races"],
        "winners": winners,
    }


def sprint_points_index(sprint_races: list[dict]) -> dict[int, dict[str, float]]:
    out: dict[int, dict[str, float]] = {}
    for race in sprint_races:
        rnd = int(race["round"])
        out[rnd] = {}
        for res in race.get("SprintResults", []):
            did = map_driver(res["Driver"]["driverId"])
            if did:
                out[rnd][did] = float(res["points"])
    return out


def build_races(
    bundle: dict[str, Any],
    old_races: list[dict],
    known_circuits: dict[str, Any],
) -> tuple[list[dict], list[str]]:
    warnings: list[str] = []
    old_by_round = {int(r["round"]): r for r in old_races}
    sprint_pts = sprint_points_index(bundle["sprint"])
    winners = bundle["winners"]

    new_races: list[dict] = []
    for race in bundle["races"]:
        rnd = int(race["round"])
        api_circuit = race["Circuit"]["circuitId"]
        circuit = map_circuit(api_circuit)
        if circuit not in known_circuits:
            warnings.append(
                f"R{rnd}: circuit '{circuit}' (API '{api_circuit}') not in data.circuits — "
                "add metadata so the Circuits view labels it correctly."
            )

        old = old_by_round.get(rnd, {})
        entry: dict[str, Any] = {
            "round": rnd,
            "gp": race["raceName"],
            "circuit": circuit,
            "date": race["date"],
            "winner": winners.get(rnd) or old.get("winner") or "",
            "results": {},
        }

        for res in race["Results"]:
            did = map_driver(res["Driver"]["driverId"])
            if not did:
                warnings.append(
                    f"R{rnd}: unknown driverId '{res['Driver']['driverId']}' — "
                    "add to DRIVER_ID_MAP in scripts/sync-jolpica.py"
                )
                continue

            dnf = is_dnf(res)
            finish = None if dnf else int(res["position"])
            race_pts = float(res["points"])
            sp = sprint_pts.get(rnd, {}).get(did, 0.0)
            total = race_pts + sp
            fl = res.get("FastestLap", {}).get("rank") == "1"

            result: dict[str, Any] = {
                "grid": int(res["grid"]),
                "finish": finish,
                "points": num(total),
            }
            if fl:
                result["fl"] = True
            if sp:
                result["sprint"] = num(sp)

            # Preserve editorial notes / DNF detail from previous JSON
            old_res = (old.get("results") or {}).get(did) or {}
            if dnf:
                if old_res.get("status"):
                    result["status"] = old_res["status"]
                else:
                    result["status"] = status_label(res)
            if old_res.get("note"):
                result["note"] = old_res["note"]
                # Dataset convention: pit-lane starts use grid 0
                if "pit-lane" in old_res["note"].lower() or "pit lane" in old_res["note"].lower():
                    result["grid"] = 0

            entry["results"][did] = result

        # Stable driver order: verstappen first when present
        ordered: dict[str, Any] = {}
        for key in ("verstappen", "perez", "lawson", "tsunoda", "hadjar"):
            if key in entry["results"]:
                ordered[key] = entry["results"][key]
        for key, val in entry["results"].items():
            if key not in ordered:
                ordered[key] = val
        entry["results"] = ordered
        new_races.append(entry)

    return new_races, warnings


def build_rival_constructors(ctor_list: list[dict]) -> tuple[list[dict], float | None, int | None]:
    rivals: list[dict] = []
    others = 0.0
    rb_points: float | None = None
    rb_pos: int | None = None
    for c in ctor_list:
        cid = c["Constructor"]["constructorId"]
        pts = float(c["points"])
        if cid == CONSTRUCTOR_ID:
            rb_points = pts
            rb_pos = int(c["position"])
            continue
        if cid in NAMED_CONSTRUCTORS:
            rivals.append({"team": TEAM_DISPLAY.get(cid, c["Constructor"]["name"]), "points": num(pts)})
        else:
            others += pts
    if others:
        rivals.append({"team": "Others", "points": num(others)})
    return rivals, rb_points, rb_pos


def build_rival_drivers(drv_list: list[dict], rb_local_ids: set[str], min_rb_points: float) -> list[dict]:
    """Rivals with more points than the lowest full-season RB driver (for correct ranks)."""
    api_rb_ids = {k for k, v in DRIVER_ID_MAP.items() if v in rb_local_ids}
    rivals: list[dict] = []
    for d in drv_list:
        did = d["Driver"]["driverId"]
        if did in api_rb_ids:
            continue
        pts = float(d["points"])
        if pts <= min_rb_points:
            continue
        team_api = d["Constructors"][0]["constructorId"]
        team = TEAM_DISPLAY.get(team_api, d["Constructors"][0]["name"])
        # Strip trailing " F1 Team" style noise already handled in TEAM_DISPLAY
        rivals.append(
            {
                "name": f"{d['Driver']['givenName']} {d['Driver']['familyName']}",
                "team": team,
                "points": num(pts),
            }
        )
    return rivals


def driver_point_totals(races: list[dict]) -> dict[str, float]:
    totals: dict[str, float] = {}
    for race in races:
        for did, res in race["results"].items():
            totals[did] = totals.get(did, 0.0) + float(res["points"])
    return totals


def sync_season(data: dict[str, Any], season: str, bundle: dict[str, Any]) -> dict[str, Any]:
    if season not in data["seasons"]:
        raise SystemExit(f"Season {season} not present in data file — add a skeleton first.")

    season_obj = data["seasons"][season]
    old_races = season_obj.get("races", [])
    new_races, warnings = build_races(bundle, old_races, data.get("circuits", {}))

    rivals, rb_points, rb_pos = build_rival_constructors(bundle["ctors"]["ConstructorStandings"])
    totals = driver_point_totals(new_races)
    team_total = sum(totals.values())

    # Prefer derived team total (includes sprint) over standings if they match closely
    if rb_points is not None and abs(team_total - float(rb_points)) > 0.1:
        warnings.append(
            f"Derived team points ({team_total}) ≠ API constructor standings ({rb_points}). "
            "Check sprint folding or mid-season seat changes."
        )

    rb_driver_ids = {d["id"] for d in season_obj["drivers"]}
    min_rb = min((totals.get(d, 0.0) for d in rb_driver_ids if totals.get(d) is not None), default=0.0)
    # Only full-season (no rounds window) count for the floor
    full_season_ids = {d["id"] for d in season_obj["drivers"] if not d.get("rounds")}
    if full_season_ids:
        min_rb = min(totals.get(d, 0.0) for d in full_season_ids)

    rival_drivers = build_rival_drivers(
        bundle["drivers"]["DriverStandings"],
        full_season_ids or rb_driver_ids,
        min_rb,
    )

    scheduled = len(bundle["schedule"]) or season_obj.get("scheduledRounds") or 24

    season_obj["races"] = new_races
    season_obj["rivalConstructorStandings"] = rivals
    season_obj["rivalDriverStandings"] = rival_drivers
    if rb_pos is not None:
        season_obj["teamPosition"] = rb_pos
    season_obj["scheduledRounds"] = scheduled

    last = new_races[-1]
    data["meta"]["generated"] = date.today().isoformat()
    data["meta"]["note"] = (
        "Race records compiled from official Formula 1 results (Jolpica/Ergast motorsport database, "
        "cross-checked against Formula1.com). Per-race 'points' totals fold in sprint points and, "
        "through 2024, fastest-lap bonus points. "
        f"{season} season data runs through the {last['gp']} (round {last['round']} of {scheduled})."
    )

    summary = {
        "season": season,
        "rounds": len(new_races),
        "scheduled": scheduled,
        "last_gp": last["gp"],
        "last_round": last["round"],
        "team_points": num(team_total),
        "team_position": season_obj.get("teamPosition"),
        "driver_points": {k: num(v) for k, v in sorted(totals.items(), key=lambda kv: -kv[1])},
        "api_rb_points": num(rb_points) if rb_points is not None else None,
        "warnings": warnings,
        "previous_rounds": len(old_races),
    }
    return summary


def print_summary(summary: dict[str, Any]) -> None:
    log()
    log(f"Season {summary['season']}: {summary['rounds']} completed of {summary['scheduled']}")
    log(f"  Latest: R{summary['last_round']} {summary['last_gp']}")
    log(f"  Team:   P{summary['team_position']} · {summary['team_points']} pts "
        f"(API standings: {summary['api_rb_points']})")
    log("  Drivers:")
    for did, pts in summary["driver_points"].items():
        log(f"    {did}: {pts}")
    if summary["previous_rounds"] != summary["rounds"]:
        delta = summary["rounds"] - summary["previous_rounds"]
        log(f"  Change: {summary['previous_rounds']} → {summary['rounds']} rounds ({delta:+d})")
    else:
        log(f"  Change: still {summary['rounds']} rounds (standings/notes may still have updated)")
    for w in summary["warnings"]:
        log(f"  ⚠ {w}")
    log()


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync Red Bull F1 data from Jolpica into f1-data.json")
    parser.add_argument("--season", help="Season year (default: latest season key in the data file)")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA, help="Path to f1-data.json")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and report without writing")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit 0 if local completed-round count matches Jolpica; 1 if behind (no write)",
    )
    args = parser.parse_args()

    data_path: Path = args.data
    if not data_path.is_file():
        raise SystemExit(f"Data file not found: {data_path}")

    with data_path.open(encoding="utf-8") as f:
        data = json.load(f)

    season = args.season or sorted(data["seasons"].keys())[-1]
    if season not in data["seasons"]:
        raise SystemExit(f"Unknown season {season}. Known: {', '.join(sorted(data['seasons']))}")

    local_rounds = len(data["seasons"][season].get("races", []))
    bundle = fetch_season_bundle(season)
    remote_rounds = len(bundle["races"])

    if args.check:
        if local_rounds < remote_rounds:
            log(f"Behind: local R{local_rounds}, Jolpica R{remote_rounds}")
            return 1
        log(f"Up to date: {local_rounds} completed rounds for {season}")
        return 0

    summary = sync_season(data, season, bundle)
    print_summary(summary)

    if args.dry_run:
        log("Dry run — data file not written.")
        return 0

    # Preserve stable formatting (2-space indent, trailing newline)
    with data_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    try:
        shown = data_path.relative_to(ROOT)
    except ValueError:
        shown = data_path
    log(f"Wrote {shown}")
    log("Next: spot-check on formula1.com, then commit & push to refresh GitHub Pages.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
