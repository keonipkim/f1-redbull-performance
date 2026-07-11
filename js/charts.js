/* ==========================================================================
 * charts.js — Chart.js factories, shared theme, and small plugins.
 *
 * All charts read their colors from CSS custom properties at render time, so
 * a theme change simply re-renders. Shared specs, applied everywhere:
 *   - bars ≤ 20px thick, 4px rounded at the data end, square at the baseline
 *   - 2px lines, hidden points with generous hover hit areas
 *   - hairline solid gridlines, muted axis text, tabular-nums ticks
 *   - a legend whenever there are ≥ 2 series; none for a single series
 *   - one tooltip listing every series at the hovered X (crosshair on lines)
 * ========================================================================== */

"use strict";

const CHARTS = {
  registry: {},

  /** Create (or re-create) a chart on the canvas with the given id. */
  mount(canvasId, config) {
    if (this.registry[canvasId]) this.registry[canvasId].destroy();
    const ctx = document.getElementById(canvasId).getContext("2d");
    this.registry[canvasId] = new Chart(ctx, config);
    return this.registry[canvasId];
  },

  /** Base options shared by every cartesian chart. */
  baseOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: {
            color: cssVar("--ink-2"),
            usePointStyle: true,
            boxWidth: 8,
            boxHeight: 8,
            font: { size: 12 },
          },
        },
        tooltip: this.tooltipOptions(),
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: cssVar("--axis") },
          ticks: { color: cssVar("--muted"), font: { size: 11 }, maxRotation: 0, autoSkipPadding: 8 },
        },
        y: {
          grid: { color: cssVar("--grid"), drawTicks: false },
          border: { display: false },
          ticks: { color: cssVar("--muted"), font: { size: 11 }, padding: 6 },
        },
      },
    };
  },

  tooltipOptions() {
    return {
      backgroundColor: cssVar("--tooltip-bg"),
      titleColor: cssVar("--tooltip-ink"),
      bodyColor: cssVar("--tooltip-ink"),
      titleFont: { size: 12, weight: "600" },
      bodyFont: { size: 12 },
      padding: 10,
      cornerRadius: 6,
      boxWidth: 12,
      boxHeight: 2,   // short stroke keys, not filled boxes
      boxPadding: 4,
      usePointStyle: false,
    };
  },

  /* ---- Plugins ----------------------------------------------------------- */

  /** Vertical hairline that tracks the hovered X on line charts. */
  crosshair: {
    id: "crosshair",
    afterDraw(chart) {
      const active = chart.tooltip && chart.tooltip.getActiveElements();
      if (!active || !active.length) return;
      const x = active[0].element.x;
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = cssVar("--axis");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.restore();
    },
  },

  /**
   * Selective direct labels: the last value of each line series, set beside
   * the line end in ink (never the series color). Nudges apart on collision.
   */
  endLabels: {
    id: "endLabels",
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      const used = [];
      ctx.save();
      ctx.font = "600 11px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = cssVar("--ink-2");
      ctx.textAlign = "left";
      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        if (meta.hidden || meta.type !== "line") return;
        // Anchor to the last non-null datum — skipped (null) points still get
        // a pixel position from Chart.js, so filter on the data, not the y.
        let lastIdx = -1;
        ds.data.forEach((v, di) => { if (v !== null && v !== undefined) lastIdx = di; });
        const last = lastIdx >= 0 ? meta.data[lastIdx] : null;
        if (!last) return;
        let y = last.y;
        for (const other of used) {
          if (Math.abs(other - y) < 14) y = other + (y >= other ? 14 : -14);
        }
        used.push(y);
        const fmt = chart.$endLabelFmt || ((v) => Number(v).toLocaleString());
        ctx.fillText(fmt(ds.data[lastIdx]), last.x + 8, y + 4);
      });
      ctx.restore();
    },
  },

  /** Value labels just past the end of horizontal bars. */
  hbarValues: {
    id: "hbarValues",
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = "600 11px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = cssVar("--ink-2");
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const meta = chart.getDatasetMeta(0);
      meta.data.forEach((bar, i) => {
        const v = chart.data.datasets[0].data[i];
        ctx.fillText(Number(v).toLocaleString(), bar.x + 6, bar.y);
      });
      ctx.restore();
    },
  },

  /* ---- Factories ---------------------------------------------------------- */

  /** Multi-series line chart with crosshair + end labels. */
  line(canvasId, labels, series, { yTitle, reverse = false, yMax, endLabelFmt } = {}) {
    const opts = this.baseOptions();
    opts.layout = { padding: { right: 52 } }; // room for the end labels
    if (reverse) {
      opts.scales.y.reverse = true;
      opts.scales.y.min = 1;
      if (yMax) opts.scales.y.max = yMax;
      opts.scales.y.ticks.stepSize = 5;
      opts.scales.y.ticks.callback = (v) => `P${v}`;
    }
    if (yTitle) opts.scales.y.title = { display: true, text: yTitle, color: cssVar("--muted"), font: { size: 11 } };
    opts.plugins.legend.display = series.length > 1;
    opts.plugins.legend.labels.pointStyle = "line";

    const chart = this.mount(canvasId, {
      type: "line",
      data: {
        labels,
        datasets: series.map((s) => ({
          label: s.label,
          data: s.data,
          borderColor: s.color,
          backgroundColor: s.fill ? withAlpha(s.color, 0.1) : "transparent",
          fill: !!s.fill,
          borderWidth: 2,
          tension: 0.25,
          spanGaps: false,
          pointRadius: s.showPoints ? 4 : 0,
          pointHoverRadius: 5,
          pointHitRadius: 24, // generous hit target — never just the painted pixels
          pointBackgroundColor: s.color,
          pointBorderColor: cssVar("--surface"), // 2px surface ring
          pointBorderWidth: 2,
        })),
      },
      options: opts,
      plugins: [this.crosshair, this.endLabels],
    });
    // Kept on the chart instance, NOT in options: Chart.js resolves unknown
    // option keys as scriptable and would call the function with a context
    // object instead of a value.
    chart.$endLabelFmt = endLabelFmt || null;
    return chart;
  },

  /** Vertical bars; pass multiple series with `stacked: true` for a stack. */
  bar(canvasId, labels, series, { stacked = false, yTitle, tooltipTitle } = {}) {
    const opts = this.baseOptions();
    opts.scales.x.stacked = stacked;
    opts.scales.y.stacked = stacked;
    opts.plugins.legend.display = series.length > 1;
    opts.plugins.legend.labels.pointStyle = "rect";
    if (yTitle) opts.scales.y.title = { display: true, text: yTitle, color: cssVar("--muted"), font: { size: 11 } };
    if (tooltipTitle) opts.plugins.tooltip.callbacks = { title: (items) => tooltipTitle(items[0].dataIndex) };

    return this.mount(canvasId, {
      type: "bar",
      data: {
        labels,
        datasets: series.map((s, i) => ({
          label: s.label,
          data: s.data,
          backgroundColor: s.colors || s.color,
          maxBarThickness: 20,
          // Round the data end only; in a stack, only the top-most dataset.
          borderRadius: !stacked || i === series.length - 1 ? 4 : 0,
          borderSkipped: stacked ? false : "start",
          // 2px surface gap between stacked segments.
          borderColor: stacked ? cssVar("--surface") : "transparent",
          borderWidth: stacked ? { top: 2, bottom: 0, left: 0, right: 0 } : 0,
        })),
      },
      options: opts,
      plugins: [],
    });
  },

  /** Horizontal bar with entity colors and direct value labels. */
  hbar(canvasId, labels, values, colors, { xTitle } = {}) {
    const opts = this.baseOptions();
    opts.indexAxis = "y";
    opts.interaction = { mode: "nearest", intersect: true };
    opts.layout = { padding: { right: 56 } }; // room for the value labels
    opts.plugins.legend.display = false;      // identity is in the row labels
    // Swap grid roles for the horizontal orientation.
    opts.scales.x = {
      grid: { color: cssVar("--grid"), drawTicks: false },
      border: { display: false },
      ticks: { color: cssVar("--muted"), font: { size: 11 } },
      title: xTitle ? { display: true, text: xTitle, color: cssVar("--muted"), font: { size: 11 } } : undefined,
    };
    opts.scales.y = {
      grid: { display: false },
      border: { color: cssVar("--axis") },
      ticks: { color: cssVar("--ink-2"), font: { size: 12 } },
    };

    return this.mount(canvasId, {
      type: "bar",
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: colors, maxBarThickness: 20, borderRadius: 4, borderSkipped: "start" }],
      },
      options: opts,
      plugins: [this.hbarValues],
    });
  },

  /** Doughnut with 2px surface gaps between segments. */
  doughnut(canvasId, labels, values, colors) {
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: {
          // Right of the ring on wide screens; below it on phones.
          position: window.innerWidth < 640 ? "bottom" : "right",
          labels: { color: cssVar("--ink-2"), usePointStyle: true, boxWidth: 8, boxHeight: 8, font: { size: 12 } },
        },
        tooltip: this.tooltipOptions(),
      },
    };
    return this.mount(canvasId, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderColor: cssVar("--surface"), // the surface gap between segments
          borderWidth: 2,
          hoverOffset: 4,
        }],
      },
      options: opts,
    });
  },

  /** Radar for driver skill profiles: 2px lines, 10% washes, ringed points. */
  radar(canvasId, axes, series) {
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: cssVar("--ink-2"), usePointStyle: true, pointStyle: "line", boxWidth: 14, font: { size: 12 } },
        },
        tooltip: this.tooltipOptions(),
      },
      scales: {
        r: {
          min: 0,
          max: 10,
          ticks: { stepSize: 2, color: cssVar("--muted"), backdropColor: "transparent", font: { size: 10 } },
          grid: { color: cssVar("--grid") },
          angleLines: { color: cssVar("--grid") },
          pointLabels: { color: cssVar("--ink-2"), font: { size: 11 } },
        },
      },
    };
    return this.mount(canvasId, {
      type: "radar",
      data: {
        labels: axes,
        datasets: series.map((s) => ({
          label: s.label,
          data: s.data,
          borderColor: s.color,
          backgroundColor: withAlpha(s.color, 0.1),
          borderWidth: 2,
          pointRadius: 3,
          pointHitRadius: 16,
          pointBackgroundColor: s.color,
          pointBorderColor: cssVar("--surface"),
          pointBorderWidth: 2,
        })),
      },
      options: opts,
    });
  },
};

/* ==========================================================================
 * Table builder — every chart's no-hover twin. Values are inserted with
 * textContent (labels are data, never markup).
 * ========================================================================== */

/**
 * Render a table into `container`.
 * headers: [{label, num?}] — num right-aligns with tabular figures.
 * rows: array of arrays; a cell may be a string/number or
 *       {text, num?, swatch?, highlight?(row-level via rowClass)}.
 */
function renderTable(container, headers, rows, { rowClass } = {}) {
  container.textContent = "";
  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  const table = document.createElement("table");

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h.label;
    if (h.num) th.className = "num";
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((cells, ri) => {
    const tr = document.createElement("tr");
    if (rowClass) {
      const cls = rowClass(ri);
      if (cls) tr.className = cls;
    }
    cells.forEach((cell, ci) => {
      const td = document.createElement("td");
      const spec = cell !== null && typeof cell === "object" ? cell : { text: cell };
      if (headers[ci] && headers[ci].num) td.className = "num";
      if (spec.swatch) {
        const dot = document.createElement("span");
        dot.className = "swatch";
        dot.style.background = spec.swatch;
        td.appendChild(dot);
      }
      td.appendChild(document.createTextNode(spec.text === null || spec.text === undefined ? "—" : String(spec.text)));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  scroll.appendChild(table);
  container.appendChild(scroll);
}
