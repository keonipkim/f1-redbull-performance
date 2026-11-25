#!/usr/bin/env python3
"""
Attach compact OpenF1 race strategy onto data/f1-data.json.

For each 2023+ race, store a session key and a weather summary on the race,
and tyre stints plus pit stops on each Red Bull result. A race matches the
OpenF1 session on the circuit-local start date, or on the UTC date when
Jolpica stored the night race that way (Las Vegas). Jolpica still owns
grid, finish, points, and notes. 2021–2022 are left untouched.

Historical OpenF1 data is free. The script stays under the free-tier limit
(3 requests/second, 30/minute) by waiting 2.1s between calls.

Usage:
  python3 scripts/sync-openf1.py                 # every season from 2023 on
  python3 scripts/sync-openf1.py --season 2026
  python3 scripts/sync-openf1.py --dry-run       # fetch and report, write nothing
  python3 scripts/sync-openf1.py --check         # exit 0 when matched races already have strategy

After a Jolpica refresh for a new Grand Prix, run this, then commit the JSON.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "data" / "f1-data.json"
API_BASE = "https://api.openf1.org/v1"
USER_AGENT = "f1-redbull-performance/1.0 (local sync; +https://github.com/keonipkim/f1-redbull-performance)"
MIN_INTERVAL = 2.1
FIRST_SEASON = 2023

_last_request = 0.0


def log(msg: str = "") -> None:
    print(msg, file=sys.stderr)


def num(v: Any) -> int | float:
    f = round(float(v), 1)
    return int(f) if f == int(f) else f


def parse_offset(text: str) -> timedelta:
    """OpenF1 gmt_offset is '03:00:00' or '-08:00:00'."""
    sign = -1 if text.startswith("-") else 1
    body = text[1:] if text[:1] in "+-" else text
    hours, minutes, seconds = (int(part) for part in body.split(":"))
    return sign * timedelta(hours=hours, minutes=minutes, seconds=seconds)


def local_race_date(session: dict[str, Any]) -> str:
    """Calendar date at the circuit, which is what f1-data.json usually stores."""
    start = datetime.fromisoformat(session["date_start"])
    local = start + parse_offset(session.get("gmt_offset") or "00:00:00")
    return local.date().isoformat()


def utc_race_date(session: dict[str, Any]) -> str:
    """UTC calendar date of the start. Jolpica uses this for some night races."""
    return datetime.fromisoformat(session["date_start"]).date().isoformat()


def get_json(url: str, *, missing_ok: bool = False) -> Any:
    global _last_request
    wait = MIN_INTERVAL - (time.monotonic() - _last_request)
    if _last_request and wait > 0:
        time.sleep(wait)

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    delay = 2.0
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                _last_request = time.monotonic()
                return json.load(resp)
        except urllib.error.HTTPError as e:
            _last_request = time.monotonic()
            # OpenF1 uses 404 with {"detail":"No results found."} for an empty collection.
            if missing_ok and e.code == 404:
                return []
            if e.code == 429 and attempt < 4:
                log(f"HTTP 429 fetching {url}; retrying in {delay:.0f}s…")
                time.sleep(delay)
                delay *= 2
                continue
            raise SystemExit(f"HTTP {e.code} fetching {url}") from e
        except urllib.error.URLError as e:
            raise SystemExit(f"Network error fetching {url}: {e.reason}") from e
    raise SystemExit(f"Failed to fetch {url}")


def seasons_to_sync(data: dict[str, Any], requested: str | None) -> list[str]:
    known = sorted(data["seasons"])
    if requested:
        if requested not in data["seasons"]:
            raise SystemExit(f"Unknown season {requested}. Known: {', '.join(known)}")
        if int(requested) < FIRST_SEASON:
            raise SystemExit(f"OpenF1 strategy starts in {FIRST_SEASON}; {requested} has race results only.")
        return [requested]
    seasons = [year for year in known if int(year) >= FIRST_SEASON]
    if not seasons:
        raise SystemExit(f"No seasons from {FIRST_SEASON} onward in the data file.")
    return seasons


def race_sessions(year: str) -> list[dict[str, Any]]:
    rows = get_json(f"{API_BASE}/sessions?year={year}&session_name=Race")
    if not isinstance(rows, list):
        raise SystemExit(f"Unexpected sessions payload for {year}")
    return [row for row in rows if not row.get("is_cancelled") and row.get("session_type") == "Race"]


def match_sessions(
    races: list[dict[str, Any]], sessions: list[dict[str, Any]]
) -> tuple[dict[int, dict[str, Any]], list[str]]:
    """Map round → session.

    Prefer the circuit-local date. A night race such as Las Vegas can be stored
    under the UTC date instead, so a still-free session may match on that.
    A date with two race sessions is skipped.
    """
    dated = [(session, local_race_date(session), utc_race_date(session)) for session in sessions]
    matched: dict[int, dict[str, Any]] = {}
    used: set[int] = set()
    skipped: set[int] = set()
    warnings: list[str] = []

    def take(race: dict[str, Any], found: list[dict[str, Any]], label: str) -> bool:
        rnd = int(race["round"])
        if len(found) > 1:
            keys = ", ".join(str(session.get("session_key")) for session in found)
            warnings.append(
                f"R{rnd} {race['gp']}: {len(found)} race sessions on {race['date']} "
                f"by {label} ({keys}); skipped"
            )
            skipped.add(rnd)
            return True
        if len(found) == 1:
            session = found[0]
            matched[rnd] = session
            used.add(int(session["session_key"]))
            return True
        return False

    by_local: dict[str, list[dict[str, Any]]] = {}
    for session, local, _utc in dated:
        by_local.setdefault(local, []).append(session)
    for race in races:
        take(race, by_local.get(race["date"], []), "local date")

    by_utc: dict[str, list[dict[str, Any]]] = {}
    for session, local, utc in dated:
        if local == utc or int(session["session_key"]) in used:
            continue
        by_utc.setdefault(utc, []).append(session)
    for race in races:
        if int(race["round"]) in matched or int(race["round"]) in skipped:
            continue
        found = [session for session in by_utc.get(race["date"], []) if int(session["session_key"]) not in used]
        if not take(race, found, "UTC date"):
            warnings.append(f"R{race['round']} {race['gp']}: no OpenF1 race session on {race['date']}")
    return matched, warnings


def driver_numbers(season: dict[str, Any]) -> dict[int, str]:
    out: dict[int, str] = {}
    for driver in season["drivers"]:
        number = driver.get("number")
        if number is None:
            continue
        out[int(number)] = driver["id"]
    return out


def compact_stints(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    stints: list[dict[str, Any]] = []
    for row in sorted(rows, key=lambda r: (r.get("stint_number") or 0, r.get("lap_start") or 0)):
        stint: dict[str, Any] = {}
        if row.get("compound"):
            stint["compound"] = row["compound"]
        if row.get("lap_start") is not None:
            stint["lapStart"] = int(row["lap_start"])
        if row.get("lap_end") is not None:
            stint["lapEnd"] = int(row["lap_end"])
        if row.get("tyre_age_at_start") is not None:
            stint["tyreAge"] = int(row["tyre_age_at_start"])
        if "lapStart" in stint or "compound" in stint:
            stints.append(stint)
    return stints


def compact_pits(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    pits: list[dict[str, Any]] = []
    ordered = sorted(rows, key=lambda r: (r.get("lap_number") is None, r.get("lap_number") or 0, r.get("date") or ""))
    for row in ordered:
        if row.get("lap_number") is None:
            continue
        pit: dict[str, Any] = {"lap": int(row["lap_number"])}
        if row.get("lane_duration") is not None:
            pit["lane"] = num(row["lane_duration"])
        # Stationary time is missing for stops before the 2024 United States Grand Prix.
        if row.get("stop_duration") is not None:
            pit["stop"] = num(row["stop_duration"])
        pits.append(pit)
    return pits


def compact_weather(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    samples = [row for row in rows if row.get("date")]
    if not samples:
        return None
    samples.sort(key=lambda r: r["date"])
    first, last = samples[0], samples[-1]

    def series(key: str) -> list[float]:
        return [float(row[key]) for row in samples if row.get(key) is not None]

    weather: dict[str, Any] = {}
    if first.get("air_temperature") is not None:
        weather["airStart"] = num(first["air_temperature"])
    if last.get("air_temperature") is not None:
        weather["airEnd"] = num(last["air_temperature"])
    if first.get("track_temperature") is not None:
        weather["trackStart"] = num(first["track_temperature"])
    if last.get("track_temperature") is not None:
        weather["trackEnd"] = num(last["track_temperature"])
    humidity = series("humidity")
    if humidity:
        weather["humidity"] = num(statistics.median(humidity))
    wind = series("wind_speed")
    if wind:
        weather["wind"] = num(statistics.median(wind))
    weather["rain"] = any(bool(row.get("rainfall")) for row in samples)
    return weather


def set_driver_strategy(result: dict[str, Any], strategy: dict[str, Any] | None) -> None:
    result.pop("strategy", None)
    if strategy:
        result["strategy"] = strategy


def set_race_strategy(race: dict[str, Any], strategy: dict[str, Any] | None) -> None:
    results = race.pop("results")
    race.pop("strategy", None)
    if strategy:
        race["strategy"] = strategy
    race["results"] = results


def fetch_race_strategy(
    session_key: int, race: dict[str, Any], numbers: dict[int, str]
) -> dict[str, Any] | None:
    stint_rows = get_json(f"{API_BASE}/stints?session_key={session_key}", missing_ok=True)
    pit_rows = get_json(f"{API_BASE}/pit?session_key={session_key}", missing_ok=True)
    weather_rows = get_json(f"{API_BASE}/weather?session_key={session_key}", missing_ok=True)
    for label, payload in (("stints", stint_rows), ("pit", pit_rows), ("weather", weather_rows)):
        if not isinstance(payload, list):
            raise SystemExit(f"Unexpected {label} payload for session {session_key}")

    by_driver: dict[str, dict[str, list]] = {}
    for row in stint_rows:
        driver_id = numbers.get(int(row["driver_number"])) if row.get("driver_number") is not None else None
        if driver_id and driver_id in race["results"]:
            by_driver.setdefault(driver_id, {"stints": [], "pits": []})["stints"].append(row)
    for row in pit_rows:
        driver_id = numbers.get(int(row["driver_number"])) if row.get("driver_number") is not None else None
        if driver_id and driver_id in race["results"]:
            by_driver.setdefault(driver_id, {"stints": [], "pits": []})["pits"].append(row)

    attached = False
    for driver_id, buckets in by_driver.items():
        stints = compact_stints(buckets["stints"])
        pits = compact_pits(buckets["pits"])
        if not stints and not pits:
            set_driver_strategy(race["results"][driver_id], None)
            continue
        strategy: dict[str, Any] = {}
        if stints:
            strategy["stints"] = stints
        if pits:
            strategy["pits"] = pits
        set_driver_strategy(race["results"][driver_id], strategy)
        attached = True

    # A matched session with no rows for a car should not keep a stale block.
    for driver_id, result in race["results"].items():
        if driver_id not in by_driver:
            set_driver_strategy(result, None)

    weather = compact_weather(weather_rows)
    if not attached and not weather:
        return None
    strategy = {"sessionKey": session_key}
    if weather:
        strategy["weather"] = weather
    return strategy


def coverage_gaps(races: list[dict[str, Any]], matched: dict[int, dict[str, Any]]) -> list[str]:
    missing: list[str] = []
    for race in races:
        rnd = int(race["round"])
        if rnd not in matched:
            continue
        block = race.get("strategy") or {}
        if block.get("sessionKey") != matched[rnd].get("session_key"):
            missing.append(f"R{rnd} {race['gp']}")
    return missing


def sync_season(data: dict[str, Any], year: str, *, write: bool) -> dict[str, Any]:
    season = data["seasons"][year]
    log(f"Fetching OpenF1 race sessions for {year}…")
    sessions = race_sessions(year)
    matched, warnings = match_sessions(season["races"], sessions)
    numbers = driver_numbers(season)

    updated: list[str] = []
    if write:
        for race in season["races"]:
            rnd = int(race["round"])
            session = matched.get(rnd)
            if not session:
                continue
            key = int(session["session_key"])
            log(f"  R{rnd} {race['gp']} · session {key}")
            strategy = fetch_race_strategy(key, race, numbers)
            set_race_strategy(race, strategy)
            if strategy:
                bits = []
                for did, res in race["results"].items():
                    block = res.get("strategy") or {}
                    stints = block.get("stints") or []
                    pits = block.get("pits") or []
                    stops = sum(1 for pit in pits if pit.get("stop") is not None)
                    if stints or pits:
                        bits.append(f"{did} {len(stints)} stints/{len(pits)} pits/{stops} stops")
                weather = strategy.get("weather") or {}
                sky = "rain" if weather.get("rain") else "dry"
                track = weather.get("trackStart")
                track_bit = f", track {track}°C" if track is not None else ", no weather"
                detail = ", ".join(bits) if bits else "weather only"
                log(f"    {detail}; {sky}{track_bit}")
                updated.append(f"R{rnd} {race['gp']} ({detail}; {sky})")
            else:
                warnings.append(f"R{rnd} {race['gp']}: session {key} had no stints, pits, or weather")

    return {
        "season": year,
        "races": len(season["races"]),
        "matched": len(matched),
        "updated": updated,
        "missing": coverage_gaps(season["races"], matched),
        "warnings": warnings,
    }


def print_summary(summary: dict[str, Any], *, wrote: bool) -> None:
    log()
    log(f"Season {summary['season']}: {summary['matched']} of {summary['races']} races matched an OpenF1 session")
    if wrote:
        for line in summary["updated"]:
            log(f"  {line}")
    elif summary["missing"]:
        log("  Missing strategy: " + ", ".join(summary["missing"]))
    else:
        log("  Strategy already present on every matched race")
    for warning in summary["warnings"]:
        log(f"  ⚠ {warning}")
    log()


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync Red Bull race strategy from OpenF1 into f1-data.json")
    parser.add_argument("--season", help="Season year (default: every season from 2023 onward)")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA, help="Path to f1-data.json")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and report without writing")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit 0 if every matched race already has that session's strategy; 1 if behind (no write)",
    )
    args = parser.parse_args()

    data_path: Path = args.data
    if not data_path.is_file():
        raise SystemExit(f"Data file not found: {data_path}")

    with data_path.open(encoding="utf-8") as f:
        data = json.load(f)

    years = seasons_to_sync(data, args.season)
    behind = False
    for year in years:
        summary = sync_season(data, year, write=not args.check)
        print_summary(summary, wrote=not args.check)
        if summary["missing"]:
            behind = True

    if args.check:
        if behind:
            log("Behind: one or more races are missing OpenF1 strategy.")
            return 1
        log("Up to date: matched races already have strategy.")
        return 0

    if args.dry_run:
        log("Dry run — data file not written.")
        return 0

    with data_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    try:
        shown = data_path.relative_to(ROOT)
    except ValueError:
        shown = data_path
    log(f"Wrote {shown}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
