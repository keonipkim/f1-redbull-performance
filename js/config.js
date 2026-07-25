/* ==========================================================================
 * config.js — palette plumbing and entity → color assignments.
 *
 * All data colors live in CSS custom properties (css/styles.css) so light and
 * dark themes swap in one place. This module only maps *entities* (teams,
 * driver slots, ordinal buckets) onto those variables. Color follows the
 * entity, never its current rank: the focus team is always --series-1,
 * Ferrari always --series-6, etc., no matter how a season shakes out.
 * ========================================================================== */

"use strict";

/** Read a CSS custom property off the document root (theme-aware). */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Fixed team → series-slot assignment (identity encoding). */
const TEAM_SLOT = {
  "Red Bull": "--series-1",
  "Red Bull Racing": "--series-1",
  "Mercedes": "--series-2",
  "Aston Martin": "--series-4",
  "Williams": "--series-5",
  "Ferrari": "--series-6",
  "Alpine": "--series-7",
  "McLaren": "--series-8",
  "Racing Bulls": "--series-5",
  "Haas": "--series-other",
  "Audi": "--series-other",
  "Cadillac": "--series-other",
};

function teamColor(teamName) {
  return cssVar(TEAM_SLOT[teamName] || "--series-other");
}

/**
 * Fixed driver → series-slot assignment. Verstappen always wears slot 1;
 * the teammate seat wears slot 3 (yellow); a third seasonal driver wears
 * slot 5. Blue/yellow/violet are non-adjacent palette slots, so any pair
 * stays CVD-distinct.
 */
const DRIVER_SLOT = {
  verstappen: "--series-1",
  perez: "--series-3",
  tsunoda: "--series-3",
  hadjar: "--series-3",
  lawson: "--series-5",
};

function driverColor(driverId) {
  return cssVar(DRIVER_SLOT[driverId] || "--series-other");
}

/** Ordinal ramp for the finish-distribution doughnut (best → worst bucket). */
function ordinalRamp() {
  return [cssVar("--ord-1"), cssVar("--ord-2"), cssVar("--ord-3"), cssVar("--ord-4")];
}

/** Diverging pair for polarity encodings (positions gained vs lost). */
function divergingPair() {
  return { pos: cssVar("--div-pos"), neg: cssVar("--div-neg"), mid: cssVar("--div-mid") };
}

/** Series hue at wash opacity, for area/radar fills. */
function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
