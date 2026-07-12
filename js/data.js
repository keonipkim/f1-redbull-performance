/* ==========================================================================
 * data.js — loading and derived statistics.
 *
 * The JSON stores one record per race with per-driver results; everything the
 * dashboard shows (wins, podiums, cumulative points, standings, circuit
 * history) is DERIVED from those records here, so every chart, tile and table
 * agrees by construction. Rival teams/drivers, which we don't track per-race,
 * come from the season's hand-set standings arrays.
 * ========================================================================== */

"use strict";

const DATA = {
  raw: null,

  /** Fetch the dataset once; throws if the page is opened without a server. */
  async load() {
    const res = await fetch("data/f1-data.json");
    if (!res.ok) throw new Error(`HTTP ${res.status} loading data/f1-data.json`);
    this.raw = await res.json();
    return this.raw;
  },

  seasonYears() {
    return Object.keys(this.raw.seasons).sort();
  },

  season(year) {
    return this.raw.seasons[year];
  },

  circuit(id) {
    return this.raw.circuits[id];
  },

  driverName(year, driverId) {
    const d = this.season(year).drivers.find((d) => d.id === driverId);
    return d ? d.name : driverId;
  },

  /** All (race, result) pairs for one driver in one season, in round order. */
  driverRaces(year, driverId) {
    return this.season(year)
      .races.filter((r) => r.results[driverId])
      .map((r) => ({ race: r, result: r.results[driverId] }));
  },

  /** Season aggregates for a single driver. */
  driverStats(year, driverId) {
    const rows = this.driverRaces(year, driverId);
    const s = { points: 0, wins: 0, podiums: 0, poles: 0, fastestLaps: 0, dnfs: 0, starts: rows.length };
    for (const { result: r } of rows) {
      s.points += r.points;
      if (r.finish === 1) s.wins += 1;
      if (r.finish !== null && r.finish <= 3) s.podiums += 1;
      if (r.grid === 1) s.poles += 1;
      if (r.fl) s.fastestLaps += 1;
      if (r.finish === null) s.dnfs += 1;
    }
    return s;
  },

  /**
   * Head-to-head between two drivers in one season, over the rounds where
   * both cars entered. Qualifying compares grid slots (a pit-lane start,
   * grid 0, loses to any grid slot); the race score only counts rounds where
   * both cars were classified.
   */
  headToHead(year, aId, bId) {
    const rounds = this.season(year)
      .races.filter((r) => r.results[aId] && r.results[bId])
      .map((r) => ({ race: r, a: r.results[aId], b: r.results[bId] }));
    const h2h = { rounds, quali: { a: 0, b: 0 }, race: { a: 0, b: 0 } };
    for (const { a, b } of rounds) {
      const ga = a.grid === 0 ? Infinity : a.grid;
      const gb = b.grid === 0 ? Infinity : b.grid;
      if (ga !== gb) h2h.quali[ga < gb ? "a" : "b"] += 1;
      if (a.finish !== null && b.finish !== null && a.finish !== b.finish)
        h2h.race[a.finish < b.finish ? "a" : "b"] += 1;
    }
    return h2h;
  },

  /** Season aggregates summed over every Red Bull car entered. */
  teamStats(year) {
    const season = this.season(year);
    const total = { points: 0, wins: 0, podiums: 0, poles: 0, fastestLaps: 0, dnfs: 0 };
    for (const d of season.drivers) {
      const s = this.driverStats(year, d.id);
      for (const k of Object.keys(total)) total[k] += s[k];
    }
    return total;
  },

  /** Round-by-round cumulative points for one driver (null before debut round). */
  cumulativePoints(year, driverId) {
    let running = 0;
    return this.season(year).races.map((race) => {
      const r = race.results[driverId];
      if (!r) return null; // seat occupied by another driver that round
      running += r.points;
      return running;
    });
  },

  /** Short x-axis labels: the round number; full GP name lives in the tooltip. */
  roundLabels(year) {
    return this.season(year).races.map((r) => `R${r.round}`);
  },

  /**
   * Constructors' standings: hand-set rivals merged with Red Bull's DERIVED
   * total, sorted descending so the chart and the table always agree.
   */
  constructorStandings(year) {
    const rb = { team: "Red Bull", points: this.teamStats(year).points, isRedBull: true };
    const rows = [rb, ...this.season(year).rivalConstructorStandings.map((r) => ({ ...r }))];
    rows.sort((a, b) => b.points - a.points);
    rows.forEach((r, i) => (r.position = i + 1));
    return rows;
  },

  /**
   * Drivers' standings: rivals merged with derived Red Bull driver totals.
   * The rival lists include every scorer down to the last full-season Red Bull
   * driver, so the merged rank IS the championship position. Partial-season
   * stints (drivers with a `rounds` window) score points here that don't match
   * their whole-season total, so they get no position.
   */
  driverStandings(year) {
    const season = this.season(year);
    const rbRows = season.drivers.map((d) => ({
      name: d.name,
      team: "Red Bull",
      points: this.driverStats(year, d.id).points,
      isRedBull: true,
      partial: !!d.rounds,
    }));
    const rows = [...rbRows, ...season.rivalDriverStandings.map((r) => ({ ...r }))];
    rows.sort((a, b) => b.points - a.points);
    let pos = 0;
    rows.forEach((r) => (r.position = r.partial ? null : ++pos));
    return rows;
  },

  /**
   * Team-wide finish distribution, bucketed for the doughnut.
   * Buckets are ordered (win > podium > points > out > DNF), hence the
   * ordinal ramp rather than categorical hues.
   */
  finishDistribution(year) {
    const buckets = { "Wins": 0, "Podiums (P2–P3)": 0, "Points (P4–P10)": 0, "Outside points": 0, "DNF": 0 };
    for (const race of this.season(year).races) {
      for (const r of Object.values(race.results)) {
        if (r.finish === null) buckets["DNF"] += 1;
        else if (r.finish === 1) buckets["Wins"] += 1;
        else if (r.finish <= 3) buckets["Podiums (P2–P3)"] += 1;
        else if (r.finish <= 10) buckets["Points (P4–P10)"] += 1;
        else buckets["Outside points"] += 1;
      }
    }
    return buckets;
  },

  /** Every circuit that appears in any season, sorted by name. */
  allCircuitIds() {
    const ids = new Set();
    for (const year of this.seasonYears()) {
      for (const race of this.season(year).races) ids.add(race.circuit);
    }
    return [...ids].sort((a, b) => this.circuit(a).name.localeCompare(this.circuit(b).name));
  },

  /**
   * Red Bull's history at one circuit across all seasons: one row per race
   * held there (Austria hosted two races in 2021).
   */
  circuitHistory(circuitId) {
    const rows = [];
    for (const year of this.seasonYears()) {
      for (const race of this.season(year).races) {
        if (race.circuit !== circuitId) continue;
        const teamPoints = Object.values(race.results).reduce((a, r) => a + r.points, 0);
        rows.push({ year, race, ver: race.results.verstappen || null, teamPoints });
      }
    }
    return rows;
  },
};
