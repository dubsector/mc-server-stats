(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  var PROJECTS = [
    { key: 'paper', name: 'Paper', varName: '--series-paper' },
    { key: 'folia', name: 'Folia', varName: '--series-folia' },
    { key: 'purpur', name: 'Purpur', varName: '--series-purpur' },
    { key: 'leaf', name: 'Leaf', varName: '--series-leaf' },
  ];

  var RANGES = [
    { key: '7d', label: '7d', days: 7 },
    { key: '30d', label: '30d', days: 30 },
    { key: '90d', label: '90d', days: 90 },
    { key: 'all', label: 'All', days: null },
  ];

  var state = {
    activeProjects: new Set(PROJECTS.map(function (p) { return p.key; })),
    stability: 'all',
    range: '30d',
    breakdownMetric: 'count',
    adoptionMetric: 'count',
    search: '',
    sort: { col: 'count', dir: 'desc' },
    breakdownView: 'bars',
    ecosystemView: 'bars',
    totalsView: 'exclusive',
    breakdownMode: 'exclusive',
    tableExpanded: false,
  };

  var TABLE_COLLAPSED_ROWS = 15;

  // Fixed name-to-color map so ecosystem pie slices keep their color as ranks shift.
  // Anything unmapped folds into the gray "Other" slice.
  var ECO_COLOR_VARS = {
    Paper: '--series-paper',
    Purpur: '--series-purpur',
    Folia: '--series-folia',
    Leaf: '--series-leaf',
    Spigot: '--eco-violet',
    UniverseSpigot: '--eco-red',
    Arclight: '--eco-magenta',
    Mohist: '--eco-orange',
  };

  var data = { meta: null, projects: {}, ecosystem: null };

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function projectColor(key) {
    var p = PROJECTS.filter(function (x) { return x.key === key; })[0];
    return p ? cssVar(p.varName) : cssVar('--text-muted');
  }

  function statusColor(stable) {
    return cssVar(stable ? '--status-good' : '--status-warning');
  }

  function fmtFull(n) {
    return Math.round(n).toLocaleString('en-US');
  }

  function fmtCompact(n) {
    var v = Math.abs(n);
    if (v >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (v >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(Math.round(n));
  }

  // All data is keyed by UTC day, so dates must render in UTC too; the browser's
  // local timezone would shift midnight-stamped points to the previous day for
  // viewers west of UTC and contradict the "Snapshot: YYYY-MM-DD" captions.
  // Rounding tiny nonzero shares to "0.0%" reads as "none"; show "<0.1%" instead.
  function fmtShare(v) {
    if (v > 0 && v < 0.05) return '<0.1%';
    return v.toFixed(1) + '%';
  }

  function formatDate(ts, withYear) {
    var opts = { month: 'short', day: 'numeric', timeZone: 'UTC' };
    if (withYear) opts.year = 'numeric';
    return new Date(ts).toLocaleDateString('en-US', opts);
  }

  function niceCeil(max) {
    if (max <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(max)));
    var norm = max / mag;
    var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    }
    return node;
  }

  // ---------------------------------------------------------------- data

  function loadJson(path) {
    return fetch(path).then(function (res) {
      if (!res.ok) throw new Error('failed to load ' + path);
      return res.json();
    });
  }

  function loadAll() {
    var projectLoads = PROJECTS.map(function (p) {
      return loadJson('data/history/' + p.key + '.json').then(function (json) {
        data.projects[p.key] = json;
      });
    });
    return Promise.all(
      projectLoads.concat([
        loadJson('data/meta.json').then(function (json) { data.meta = json; }),
        loadJson('data/ecosystem.json').then(function (json) { data.ecosystem = json; }),
      ])
    );
  }

  function latestDateKey(versionsMap) {
    var keys = Object.keys(versionsMap || {});
    if (!keys.length) return null;
    return keys.sort()[keys.length - 1];
  }

  // The global serverSoftware chart counts each server under exactly one software
  // name. The projects' own bStats pages also receive pings from downstream forks
  // (a Purpur server reports to both Purpur and Paper), so headline counts must
  // come from here to avoid counting the same server twice.
  function ecosystemSeries(name) {
    var points = [];
    Object.keys(data.ecosystem || {}).sort().forEach(function (dk) {
      var entry = (data.ecosystem[dk] || []).filter(function (e) { return e.name === name; })[0];
      if (entry) points.push([Date.parse(dk + 'T00:00:00Z'), entry.count]);
    });
    return points;
  }

  // Per-version splits only ever exist in fork-inclusive form (bStats never breaks
  // the exclusive serverSoftware count down by version), so the counting-method
  // toggle on the breakdown card can only swap this one rolled-up total, while
  // the bars/donut beneath it always show the fork-inclusive split.
  // Exclusive is the default view, so it shows a bare number; only the
  // fork-inclusive count carries a qualifier, to keep the panels uncluttered.
  function projectHeadlineTotal(p, familyTotal, mode) {
    if (mode === 'exclusive') {
      var eco = ecosystemSeries(p.name);
      return { value: eco.length ? eco[eco.length - 1][1] : null, label: '' };
    }
    return { value: familyTotal, label: ' (incl. forks)' };
  }

  function rangeCutoff() {
    var r = RANGES.filter(function (x) { return x.key === state.range; })[0];
    if (!r || r.days == null) return null;
    return Date.now() - r.days * 86400000;
  }

  function matchesSearch(version) {
    if (!state.search) return true;
    return version.toLowerCase().indexOf(state.search) !== -1;
  }

  function matchesStability(stable) {
    if (state.stability === 'all') return true;
    return state.stability === 'stable' ? stable : !stable;
  }

  // ---------------------------------------------------------------- chart: line

  function renderLineChart(container, series, opts) {
    opts = opts || {};
    container.innerHTML = '';
    container.classList.add('chart-pos');

    var W = opts.width || 880;
    var H = opts.height || 240;
    var padL = 46, padR = opts.padR || 96, padT = 14, padB = 26;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    var visibleSeries = series.filter(function (s) { return !s.hidden; });
    var allPoints = [];
    visibleSeries.forEach(function (s) { s.points.forEach(function (pt) { allPoints.push(pt); }); });

    if (!allPoints.length) {
      container.appendChild(el('div', { class: 'empty-state', text: opts.emptyText || 'No data yet.' }));
      return;
    }

    var xs = allPoints.map(function (p) { return p[0]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    if (minX === maxX) { minX -= 43200000; maxX += 43200000; }

    // A shared linear axis flattens smaller series to the baseline when one series is
    // 100x+ larger (e.g. Paper vs Folia), making them indistinguishable from each other.
    // Switch to a log axis once the spread is wide enough to matter; falls back to
    // linear automatically once filters narrow the active series to a similar scale.
    var maxY = 0, minPosY = Infinity;
    allPoints.forEach(function (p) {
      if (p[1] > maxY) maxY = p[1];
      if (p[1] > 0 && p[1] < minPosY) minPosY = p[1];
    });
    var niceY = niceCeil(maxY || 1);
    var useLog = opts.yScale === 'log' && maxY > 0 && minPosY !== Infinity && maxY / minPosY >= 15;
    var minLog, maxLog;
    if (useLog) {
      minLog = Math.floor(Math.log10(minPosY));
      maxLog = Math.ceil(Math.log10(maxY));
      if (minLog === maxLog) { minLog -= 1; maxLog += 1; }
    }

    function xPos(ts) { return padL + ((ts - minX) / (maxX - minX)) * plotW; }
    function yPos(v) {
      if (useLog) {
        if (v <= 0) return padT + plotH;
        var frac = (Math.log10(v) - minLog) / (maxLog - minLog);
        return padT + plotH - frac * plotH;
      }
      return padT + plotH - (v / niceY) * plotH;
    }

    // In share mode (suffix '%') values are 0-100 percentages: keep one decimal and
    // show the unit on the axis and line labels, not just in the tooltip.
    function fmtVal(v) {
      if (opts.suffix) return Math.round(v * 10) / 10 + opts.suffix;
      return fmtCompact(v);
    }

    var root = svgEl('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H });

    if (useLog) {
      root.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: yPos(0), y2: yPos(0), class: 'baseline' }));
      for (var p10 = minLog; p10 <= maxLog; p10++) {
        var gv = Math.pow(10, p10);
        var gy = yPos(gv);
        root.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: gy, y2: gy, class: 'gridline' }));
        var gt = svgEl('text', { x: padL - 8, y: gy + 4, class: 'axis-label', 'text-anchor': 'end' });
        gt.textContent = fmtVal(gv);
        root.appendChild(gt);
      }
    } else {
      var steps = 4;
      for (var i = 0; i <= steps; i++) {
        var v = (niceY * i) / steps;
        var y = yPos(v);
        root.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: i === 0 ? 'baseline' : 'gridline' }));
        var t = svgEl('text', { x: padL - 8, y: y + 4, class: 'axis-label', 'text-anchor': 'end' });
        t.textContent = fmtVal(v);
        root.appendChild(t);
      }
    }

    var spansYears = maxX - minX > 300 * 86400000;
    [minX, maxX].forEach(function (ts, idx) {
      var t = svgEl('text', { x: xPos(ts), y: H - 6, class: 'axis-label', 'text-anchor': idx === 0 ? 'start' : 'end' });
      t.textContent = formatDate(ts, spansYears);
      root.appendChild(t);
    });

    visibleSeries.forEach(function (s) {
      if (s.points.length === 1) {
        var p0 = s.points[0];
        root.appendChild(
          svgEl('circle', { cx: xPos(p0[0]), cy: yPos(p0[1]), r: 4, fill: s.color, stroke: cssVar('--surface-1'), 'stroke-width': 2 })
        );
        return;
      }
      if (s.points.length < 2) return;
      var d = s.points
        .map(function (pt, idx) { return (idx === 0 ? 'M' : 'L') + xPos(pt[0]).toFixed(1) + ',' + yPos(pt[1]).toFixed(1); })
        .join(' ');
      root.appendChild(svgEl('path', { d: d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      var last = s.points[s.points.length - 1];
      root.appendChild(
        svgEl('circle', { cx: xPos(last[0]), cy: yPos(last[1]), r: 4, fill: s.color, stroke: cssVar('--surface-1'), 'stroke-width': 2 })
      );
    });

    var labelEntries = visibleSeries
      .filter(function (s) { return s.points.length; })
      .map(function (s) {
        var last = s.points[s.points.length - 1];
        return { s: s, y: yPos(last[1]), x: xPos(last[0]), val: last[1] };
      })
      .sort(function (a, b) { return a.y - b.y; });
    var minGap = opts.compact ? 12 : 14;
    for (var li = 1; li < labelEntries.length; li++) {
      if (labelEntries[li].y - labelEntries[li - 1].y < minGap) {
        labelEntries[li].y = labelEntries[li - 1].y + minGap;
      }
    }
    labelEntries.forEach(function (le) {
      var t = svgEl('text', { x: le.x + 8, y: le.y + 3, class: 'data-label strong' });
      t.textContent = le.s.name + ' ' + fmtVal(le.val);
      root.appendChild(t);
    });

    var crosshair = svgEl('line', { y1: padT, y2: padT + plotH, class: 'gridline', visibility: 'hidden' });
    var hit = svgEl('rect', { x: padL, y: padT, width: Math.max(plotW, 1), height: Math.max(plotH, 1), fill: 'transparent' });
    root.appendChild(crosshair);
    root.appendChild(hit);

    container.appendChild(root);
    var tooltip = el('div', { class: 'chart-tooltip' });
    container.appendChild(tooltip);

    var allXs = Array.from(new Set(xs)).sort(function (a, b) { return a - b; });

    function nearestX(target) {
      var best = allXs[0], bestDiff = Infinity;
      allXs.forEach(function (x) {
        var diff = Math.abs(x - target);
        if (diff < bestDiff) { bestDiff = diff; best = x; }
      });
      return best;
    }

    function handleMove(evt) {
      var rect = root.getBoundingClientRect();
      var scaleX = W / rect.width;
      var mouseX = (evt.clientX - rect.left) * scaleX;
      var mouseTs = minX + ((mouseX - padL) / plotW) * (maxX - minX);
      var snapped = nearestX(mouseTs);
      var sx = xPos(snapped);
      crosshair.setAttribute('x1', sx);
      crosshair.setAttribute('x2', sx);
      crosshair.setAttribute('visibility', 'visible');

      var rows = visibleSeries
        .map(function (s) {
          var pt = s.points.filter(function (p) { return p[0] === snapped; })[0];
          return { name: s.name, color: s.color, value: pt ? pt[1] : null };
        })
        .filter(function (r) { return r.value !== null; });

      tooltip.innerHTML = '';
      tooltip.appendChild(el('div', { class: 'tt-title', text: formatDate(snapped, spansYears) }));
      rows.forEach(function (r) {
        var row = el('div', { class: 'tt-row' });
        var key = el('span', { class: 'tt-key' });
        var stroke = el('span', { class: 'stroke' });
        stroke.style.background = r.color;
        key.appendChild(stroke);
        key.appendChild(document.createTextNode(r.name));
        row.appendChild(key);
        row.appendChild(el('span', { class: 'tt-value', text: fmtFull(r.value) + (opts.suffix || '') }));
        tooltip.appendChild(row);
      });
      tooltip.classList.add('visible');
      var ttX = (sx / W) * rect.width;
      var flip = ttX > rect.width - 170;
      tooltip.style.left = (flip ? ttX - 170 : ttX + 12) + 'px';
      tooltip.style.top = '6px';
    }

    function handleLeave() {
      crosshair.setAttribute('visibility', 'hidden');
      tooltip.classList.remove('visible');
    }

    hit.addEventListener('pointermove', handleMove);
    hit.addEventListener('pointerleave', handleLeave);
  }

  // ---------------------------------------------------------------- chart: horizontal bars

  function renderBarPanel(container, rows, opts) {
    opts = opts || {};
    container.innerHTML = '';
    container.classList.add('chart-pos');

    if (!rows.length) {
      container.appendChild(el('div', { class: 'panel-note', text: 'No versions match the current filters.' }));
      return;
    }

    var barH = 18, gap = 6, labelW = 84, valueW = 54, padX = 4;
    var W = 420;
    var plotW = W - labelW - valueW - padX * 2;
    var H = rows.length * (barH + gap);

    var maxVal = Math.max.apply(
      null,
      rows.map(function (r) { return opts.metric === 'share' ? r.share : r.count; })
    );

    var root = svgEl('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H });
    var tooltip = el('div', { class: 'chart-tooltip' });

    rows.forEach(function (r, i) {
      var y = i * (barH + gap);
      var val = opts.metric === 'share' ? r.share : r.count;
      var w = Math.max(2, (val / maxVal) * plotW);
      var isMatch = matchesSearch(r.version);
      var dim = state.search && !isMatch;

      var label = svgEl('text', { x: labelW - 8, y: y + barH / 2 + 4, class: dim ? 'data-label' : 'data-label strong', 'text-anchor': 'end' });
      label.textContent = r.version;
      root.appendChild(label);

      var bar = svgEl('rect', {
        x: labelW, y: y, width: w, height: barH, rx: 4,
        fill: statusColor(r.stable), opacity: dim ? 0.3 : 1,
      });
      root.appendChild(bar);

      var valText = svgEl('text', { x: labelW + w + 8, y: y + barH / 2 + 4, class: 'data-label strong' });
      valText.textContent = opts.metric === 'share' ? fmtShare(val) : fmtCompact(val);
      root.appendChild(valText);

      var hitRow = svgEl('rect', { x: 0, y: y, width: W, height: barH + gap, fill: 'transparent' });
      hitRow.addEventListener('pointerenter', function () { showRowTooltip(r); });
      hitRow.addEventListener('pointermove', function (evt) { positionTooltip(evt, root, tooltip); });
      hitRow.addEventListener('pointerleave', function () { tooltip.classList.remove('visible'); });
      root.appendChild(hitRow);
    });

    function showRowTooltip(r) {
      tooltip.innerHTML = '';
      tooltip.appendChild(el('div', { class: 'tt-title', text: r.version }));
      var statusRow = el('div', { class: 'tt-row' });
      var key = el('span', { class: 'tt-key' });
      var dot = el('span', { class: 'stroke' });
      dot.style.background = statusColor(r.stable);
      key.appendChild(dot);
      key.appendChild(document.createTextNode(r.stable ? 'Stable' : 'Experimental'));
      statusRow.appendChild(key);
      tooltip.appendChild(statusRow);

      var countRow = el('div', { class: 'tt-row' });
      countRow.appendChild(el('span', { class: 'tt-key', text: 'Servers' }));
      countRow.appendChild(el('span', { class: 'tt-value', text: fmtFull(r.count) }));
      tooltip.appendChild(countRow);

      var shareRow = el('div', { class: 'tt-row' });
      shareRow.appendChild(el('span', { class: 'tt-key', text: 'Share' }));
      shareRow.appendChild(el('span', { class: 'tt-value', text: fmtShare(r.share) }));
      tooltip.appendChild(shareRow);
      tooltip.classList.add('visible');
    }

    container.appendChild(root);
    container.appendChild(tooltip);
  }

  // ---------------------------------------------------------------- chart: donut

  // Slices within one stability family get a monotone lightness ladder so neighbors
  // stay distinguishable while the green/amber meaning holds. Rank 0 is the largest.
  function stabilityLadderColor(stable, rank) {
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stable) {
      var gl = dark ? 58 - rank * 6 : 34 + rank * 7;
      return 'hsl(120 55% ' + gl + '%)';
    }
    var al = dark ? 60 - rank * 6 : 42 + rank * 6;
    return 'hsl(38 85% ' + al + '%)';
  }

  function donutArcPath(cx, cy, rOuter, rInner, a0, a1) {
    var large = a1 - a0 > Math.PI ? 1 : 0;
    var x0o = cx + rOuter * Math.cos(a0), y0o = cy + rOuter * Math.sin(a0);
    var x1o = cx + rOuter * Math.cos(a1), y1o = cy + rOuter * Math.sin(a1);
    var x0i = cx + rInner * Math.cos(a1), y0i = cy + rInner * Math.sin(a1);
    var x1i = cx + rInner * Math.cos(a0), y1i = cy + rInner * Math.sin(a0);
    return (
      'M' + x0o.toFixed(2) + ',' + y0o.toFixed(2) +
      ' A' + rOuter + ',' + rOuter + ' 0 ' + large + ' 1 ' + x1o.toFixed(2) + ',' + y1o.toFixed(2) +
      ' L' + x0i.toFixed(2) + ',' + y0i.toFixed(2) +
      ' A' + rInner + ',' + rInner + ' 0 ' + large + ' 0 ' + x1i.toFixed(2) + ',' + y1i.toFixed(2) +
      ' Z'
    );
  }

  // slices: [{ name, count, color, dim, tooltipRows: [[label, value]] }]
  function renderDonut(container, slices, opts) {
    opts = opts || {};
    container.innerHTML = '';
    container.classList.add('chart-pos');

    if (!slices.length) {
      container.appendChild(el('div', { class: 'panel-note', text: 'No data matches the current filters.' }));
      return;
    }

    var size = opts.size || 240;
    var labelPad = 96;
    var W = size + labelPad * 2;
    var H = size + 20;
    var cx = W / 2, cy = H / 2;
    var rOuter = size / 2 - 6;
    var rInner = rOuter * 0.62;
    var total = slices.reduce(function (sum, s) { return sum + s.count; }, 0);
    if (!total) {
      container.appendChild(el('div', { class: 'panel-note', text: 'No data matches the current filters.' }));
      return;
    }

    var root = svgEl('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H });
    var tooltip = el('div', { class: 'chart-tooltip' });
    var surface = cssVar('--surface-1');

    function attachHover(target, s) {
      target.addEventListener('pointerenter', function () {
        tooltip.innerHTML = '';
        tooltip.appendChild(el('div', { class: 'tt-title', text: s.name }));
        s.tooltipRows.forEach(function (pair) {
          var row = el('div', { class: 'tt-row' });
          row.appendChild(el('span', { class: 'tt-key', text: pair[0] }));
          row.appendChild(el('span', { class: 'tt-value', text: pair[1] }));
          tooltip.appendChild(row);
        });
        tooltip.classList.add('visible');
      });
      target.addEventListener('pointermove', function (evt) { positionTooltip(evt, root, tooltip); });
      target.addEventListener('pointerleave', function () { tooltip.classList.remove('visible'); });
    }

    if (slices.length === 1) {
      var only = slices[0];
      var ring = svgEl('circle', {
        cx: cx, cy: cy, r: (rOuter + rInner) / 2,
        fill: 'none', stroke: only.color, 'stroke-width': rOuter - rInner,
        opacity: only.dim ? 0.3 : 1,
      });
      attachHover(ring, only);
      root.appendChild(ring);
    } else {
      var angle = -Math.PI / 2;
      slices.forEach(function (s) {
        var span = (s.count / total) * Math.PI * 2;
        var path = svgEl('path', {
          d: donutArcPath(cx, cy, rOuter, rInner, angle, angle + span),
          fill: s.color, stroke: surface, 'stroke-width': 2, 'stroke-linejoin': 'round',
          opacity: s.dim ? 0.3 : 1,
        });
        attachHover(path, s);
        root.appendChild(path);

        var frac = s.count / total;
        if (frac >= 0.05) {
          var mid = angle + span / 2;
          var lx = cx + (rOuter + 10) * Math.cos(mid);
          var ly = cy + (rOuter + 10) * Math.sin(mid);
          var onRight = Math.cos(mid) >= 0;
          var label = svgEl('text', {
            x: lx, y: ly + 3,
            class: s.dim ? 'data-label' : 'data-label strong',
            'text-anchor': onRight ? 'start' : 'end',
          });
          label.textContent = s.name + ' ' + (opts.metric === 'count' ? fmtCompact(s.count) : (frac * 100).toFixed(1) + '%');
          root.appendChild(label);
        }
        angle += span;
      });
    }

    var centerValue = svgEl('text', { x: cx, y: cy, class: 'donut-center-value', 'text-anchor': 'middle' });
    centerValue.textContent = fmtCompact(total);
    root.appendChild(centerValue);
    var centerCaption = svgEl('text', { x: cx, y: cy + 18, class: 'donut-center-caption', 'text-anchor': 'middle' });
    centerCaption.textContent = opts.caption || 'servers';
    root.appendChild(centerCaption);

    container.appendChild(root);
    container.appendChild(tooltip);
  }

  function positionTooltip(evt, root, tooltip) {
    var rect = root.getBoundingClientRect();
    var x = evt.clientX - rect.left;
    var y = evt.clientY - rect.top;
    var flip = x > rect.width - 170;
    tooltip.style.left = (flip ? x - 170 : x + 14) + 'px';
    tooltip.style.top = Math.max(0, y - 10) + 'px';
  }

  // ---------------------------------------------------------------- sections

  function renderStatRow() {
    var container = document.getElementById('stat-row');
    container.innerHTML = '';
    PROJECTS.forEach(function (p) {
      var points = ecosystemSeries(p.name);
      var latest = points.length ? points[points.length - 1][1] : null;
      var weekAgoTs = points.length ? points[points.length - 1][0] - 7 * 86400000 : null;
      var weekAgoPoint = null;
      if (weekAgoTs) {
        points.forEach(function (pt) {
          if (pt[0] <= weekAgoTs) weekAgoPoint = pt;
        });
      }

      var tile = el('div', { class: 'stat-tile' });
      var label = el('div', { class: 'label' });
      var dot = el('span', { class: 'dot' });
      dot.style.background = projectColor(p.key);
      label.appendChild(dot);
      label.appendChild(document.createTextNode(p.name));
      tile.appendChild(label);
      tile.appendChild(el('div', { class: 'value', text: latest == null ? '—' : fmtFull(latest) }));

      if (weekAgoPoint && latest != null) {
        var delta = latest - weekAgoPoint[1];
        var pct = weekAgoPoint[1] ? (delta / weekAgoPoint[1]) * 100 : 0;
        var deltaEl = el('div', { class: 'panel-note' });
        deltaEl.style.color = delta >= 0 ? cssVar('--success-text') : cssVar('--status-warning');
        deltaEl.textContent = (delta >= 0 ? '+' : '') + fmtFull(delta) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%) vs 7d ago';
        tile.appendChild(deltaEl);
      }

      var servers = (data.projects[p.key] || {}).servers || [];
      var familyLatest = servers.length ? servers[servers.length - 1][1] : null;
      if (familyLatest != null) {
        tile.appendChild(el('div', { class: 'panel-note', text: 'Incl. forks: ' + fmtFull(familyLatest) }));
      }

      var sparkContainer = el('div', { class: 'sparkline' });
      tile.appendChild(sparkContainer);
      container.appendChild(tile);
      renderSparkline(sparkContainer, points.slice(-60), projectColor(p.key));
    });
  }

  function renderSparkline(container, points, color) {
    if (points.length < 2) return;
    var W = 240, H = 32, pad = 2;
    var xs = points.map(function (p) { return p[0]; });
    var ys = points.map(function (p) { return p[1]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    if (minX === maxX) minX -= 1;
    if (minY === maxY) { minY -= 1; maxY += 1; }
    function xPos(ts) { return pad + ((ts - minX) / (maxX - minX)) * (W - pad * 2); }
    function yPos(v) { return H - pad - ((v - minY) / (maxY - minY)) * (H - pad * 2); }
    var d = points.map(function (p, i) { return (i === 0 ? 'M' : 'L') + xPos(p[0]).toFixed(1) + ',' + yPos(p[1]).toFixed(1); }).join(' ');
    var root = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H });
    root.appendChild(svgEl('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0.85 }));
    container.appendChild(root);
  }

  function renderFilters() {
    var projectsGroup = document.getElementById('filter-projects');
    PROJECTS.forEach(function (p) {
      var chip = el('button', {
        class: 'chip',
        'aria-pressed': state.activeProjects.has(p.key) ? 'true' : 'false',
        onclick: function () { toggleProject(p.key); },
      });
      var dot = el('span', { class: 'dot' });
      dot.style.background = projectColor(p.key);
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(p.name));
      chip.dataset.project = p.key;
      projectsGroup.appendChild(chip);
    });

    var stabilityGroup = document.getElementById('filter-stability');
    [['all', 'All'], ['stable', 'Stable'], ['experimental', 'Experimental']].forEach(function (pair) {
      var chip = el('button', {
        class: 'chip',
        'aria-pressed': state.stability === pair[0] ? 'true' : 'false',
        text: pair[1],
        onclick: function () {
          state.stability = pair[0];
          renderAll();
        },
      });
      chip.dataset.stability = pair[0];
      stabilityGroup.appendChild(chip);
    });

    var rangeGroup = document.getElementById('filter-range');
    RANGES.forEach(function (r) {
      var chip = el('button', {
        class: 'chip',
        'aria-pressed': state.range === r.key ? 'true' : 'false',
        text: r.label,
        onclick: function () {
          state.range = r.key;
          renderAll();
        },
      });
      chip.dataset.range = r.key;
      rangeGroup.appendChild(chip);
    });

    document.querySelectorAll('[data-metric-target]').forEach(function (group) {
      var target = group.dataset.metricTarget;
      group.querySelectorAll('[data-metric]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (target === 'breakdown') state.breakdownMetric = btn.dataset.metric;
          else state.adoptionMetric = btn.dataset.metric;
          renderAll();
        });
      });
    });

    var searchInput = document.getElementById('version-search');
    searchInput.addEventListener('input', function () {
      state.search = searchInput.value.trim().toLowerCase();
      renderAll();
    });

    document.querySelectorAll('.view-switch').forEach(function (group) {
      var target = group.dataset.viewTarget;
      group.querySelectorAll('[data-view]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (target === 'breakdown') state.breakdownView = btn.dataset.view;
          else state.ecosystemView = btn.dataset.view;
          renderAll();
        });
      });
    });

    // Single flip button per card: shows "Incl. forks" in the default exclusive
    // view and "Excl. forks" once flipped, so the label always names the way back.
    document.querySelectorAll('[data-mode-flip]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.modeFlip === 'totals') state.totalsView = state.totalsView === 'family' ? 'exclusive' : 'family';
        else state.breakdownMode = state.breakdownMode === 'family' ? 'exclusive' : 'family';
        renderAll();
      });
    });

    document.querySelectorAll('[data-toggle-table]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.toggleTable;
        var chartId = key === 'totals' ? 'chart-totals' : 'breakdown-grid';
        var tableId = 'table-' + key;
        var legendId = key === 'totals' ? 'legend-totals' : null;
        var chartEl = document.getElementById(chartId);
        var tableEl = document.getElementById(tableId);
        var showingTable = !tableEl.classList.contains('hidden');
        tableEl.classList.toggle('hidden', showingTable);
        chartEl.classList.toggle('hidden', !showingTable);
        if (legendId) document.getElementById(legendId).classList.toggle('hidden', !showingTable);
        btn.closest('.card').querySelectorAll('.view-switch').forEach(function (viewSwitch) {
          viewSwitch.classList.toggle('hidden', !showingTable);
        });
        btn.textContent = showingTable ? 'Table view' : 'Chart view';
      });
    });
  }

  function toggleProject(key) {
    if (state.activeProjects.has(key)) state.activeProjects.delete(key);
    else state.activeProjects.add(key);
    renderAll();
  }

  function syncFilterChips() {
    document.querySelectorAll('[data-project]').forEach(function (chip) {
      chip.setAttribute('aria-pressed', state.activeProjects.has(chip.dataset.project) ? 'true' : 'false');
    });
    document.querySelectorAll('[data-stability]').forEach(function (chip) {
      chip.setAttribute('aria-pressed', chip.dataset.stability === state.stability ? 'true' : 'false');
    });
    document.querySelectorAll('[data-range]').forEach(function (chip) {
      chip.setAttribute('aria-pressed', chip.dataset.range === state.range ? 'true' : 'false');
    });
    document.querySelectorAll('[data-metric-target]').forEach(function (group) {
      var active = group.dataset.metricTarget === 'breakdown' ? state.breakdownMetric : state.adoptionMetric;
      group.querySelectorAll('[data-metric]').forEach(function (chip) {
        chip.setAttribute('aria-pressed', chip.dataset.metric === active ? 'true' : 'false');
      });
    });
    document.querySelectorAll('.view-switch').forEach(function (group) {
      var target = group.dataset.viewTarget;
      if (!target) return;
      var active = target === 'breakdown' ? state.breakdownView : state.ecosystemView;
      group.querySelectorAll('[data-view]').forEach(function (btn) {
        btn.setAttribute('aria-pressed', btn.dataset.view === active ? 'true' : 'false');
      });
    });
    document.querySelectorAll('[data-mode-flip]').forEach(function (btn) {
      var mode = btn.dataset.modeFlip === 'totals' ? state.totalsView : state.breakdownMode;
      btn.textContent = mode === 'family' ? 'Excl. forks' : 'Incl. forks';
      btn.setAttribute('aria-pressed', mode === 'family' ? 'true' : 'false');
    });
  }

  function activeProjectList() {
    return PROJECTS.filter(function (p) { return state.activeProjects.has(p.key); });
  }

  function renderTotalsChart() {
    var cutoff = rangeCutoff();
    var exclusive = state.totalsView === 'exclusive';
    var series = activeProjectList().map(function (p) {
      var all = exclusive ? ecosystemSeries(p.name) : (data.projects[p.key] || {}).servers || [];
      var points = cutoff ? all.filter(function (pt) { return pt[0] >= cutoff; }) : all;
      return { key: p.key, name: p.name, color: projectColor(p.key), points: points };
    });

    var legend = document.getElementById('legend-totals');
    legend.innerHTML = '';
    PROJECTS.forEach(function (p) {
      var active = state.activeProjects.has(p.key);
      var item = el('span', {
        class: 'legend-item',
        'data-off': active ? 'false' : 'true',
        onclick: function () { toggleProject(p.key); },
      });
      var swatch = el('span', { class: 'legend-swatch' });
      swatch.style.background = projectColor(p.key);
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(p.name));
      legend.appendChild(item);
    });

    var chartContainer = document.getElementById('chart-totals');
    renderLineChart(chartContainer, series, { emptyText: 'Select a project to see its history.', yScale: 'log' });
    if (exclusive) {
      chartContainer.appendChild(
        el('div', { class: 'panel-note', text: 'Daily snapshots of the global server-software chart. bStats cannot backfill these, so the line grows one point per day.' })
      );
    }

    var tableContainer = document.getElementById('table-totals');
    tableContainer.innerHTML = '';
    var table = el('table', { class: 'data-table' });
    var thead = el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Project' }),
        el('th', { class: 'num', text: 'Excl. forks' }),
        el('th', { class: 'num', text: 'Incl. forks' }),
      ]),
    ]);
    table.appendChild(thead);
    var tbody = el('tbody');
    activeProjectList().forEach(function (p) {
      var eco = ecosystemSeries(p.name);
      var ecoLatest = eco.length ? eco[eco.length - 1][1] : null;
      var servers = (data.projects[p.key] || {}).servers || [];
      var latest = servers.length ? servers[servers.length - 1][1] : null;
      tbody.appendChild(
        el('tr', {}, [
          el('td', { text: p.name }),
          el('td', { class: 'num', text: ecoLatest == null ? '—' : fmtFull(ecoLatest) }),
          el('td', { class: 'num', text: latest == null ? '—' : fmtFull(latest) }),
        ])
      );
    });
    table.appendChild(tbody);
    tableContainer.appendChild(table);
  }

  function projectVersionRows(projectKey) {
    var proj = data.projects[projectKey];
    if (!proj) return { rows: [], date: null };
    var dateKey = latestDateKey(proj.versions);
    if (!dateKey) return { rows: [], date: null };
    var raw = proj.versions[dateKey];
    var total = raw.reduce(function (sum, r) { return sum + r.count; }, 0);
    var rows = raw.map(function (r) {
      return { version: r.version, count: r.count, stable: r.stable, share: total ? (r.count / total) * 100 : 0 };
    });
    return { rows: rows, date: dateKey, total: total };
  }

  // Top versions as donut slices, everything smaller folded into a gray "Other".
  // Expects rows sorted by count descending.
  function versionSlices(rows) {
    var top = rows.slice(0, 6);
    var rest = rows.slice(6);
    var stableRank = 0, expRank = 0;
    var slices = top.map(function (r) {
      return {
        name: r.version,
        count: r.count,
        color: stabilityLadderColor(r.stable, r.stable ? stableRank++ : expRank++),
        dim: !!state.search && !matchesSearch(r.version),
        tooltipRows: [
          ['Status', r.stable ? 'Stable' : 'Experimental'],
          ['Servers', fmtFull(r.count)],
          ['Share', fmtShare(r.share)],
        ],
      };
    });
    if (rest.length) {
      var otherCount = rest.reduce(function (sum, r) { return sum + r.count; }, 0);
      var otherShare = rest.reduce(function (sum, r) { return sum + r.share; }, 0);
      slices.push({
        name: 'Other (' + rest.length + ')',
        count: otherCount,
        color: cssVar('--text-muted'),
        dim: !!state.search,
        tooltipRows: [
          ['Versions', String(rest.length)],
          ['Servers', fmtFull(otherCount)],
          ['Share', fmtShare(otherShare)],
        ],
      });
    }
    return slices;
  }

  function renderBreakdownGrid() {
    var grid = document.getElementById('breakdown-grid');
    grid.innerHTML = '';
    var actives = activeProjectList();
    if (!actives.length) {
      grid.appendChild(el('div', { class: 'empty-state', text: 'Select at least one project.' }));
      return;
    }
    actives.forEach(function (p) {
      var snapshot = projectVersionRows(p.key);
      var filtered = snapshot.rows.filter(function (r) { return matchesStability(r.stable); });
      filtered.sort(function (a, b) { return b.count - a.count; });
      var shown = filtered.slice(0, 8);

      var panel = el('div', { class: 'multiple-panel' });
      var heading = el('h3');
      var dot = el('span', { class: 'dot' });
      dot.style.width = '8px';
      dot.style.height = '8px';
      dot.style.borderRadius = '50%';
      dot.style.background = projectColor(p.key);
      heading.appendChild(dot);
      heading.appendChild(document.createTextNode(p.name));
      panel.appendChild(heading);

      var headline = projectHeadlineTotal(p, snapshot.total, state.breakdownMode);
      panel.appendChild(el('div', {
        class: 'panel-total',
        text: (headline.value == null ? '—' : fmtFull(headline.value)) + headline.label,
      }));

      var chartHolder = el('div');
      panel.appendChild(chartHolder);
      if (state.breakdownView === 'pie') {
        renderDonut(chartHolder, versionSlices(filtered), { caption: p.name, metric: state.breakdownMetric });
      } else {
        renderBarPanel(chartHolder, shown, { metric: state.breakdownMetric });
      }

      if (state.breakdownView !== 'pie' && filtered.length > shown.length) {
        panel.appendChild(el('div', { class: 'panel-note', text: '+' + (filtered.length - shown.length) + ' more in the table below' }));
      }
      if (snapshot.date) {
        panel.appendChild(el('div', { class: 'panel-note', text: 'Snapshot: ' + snapshot.date }));
      }
      grid.appendChild(panel);
    });

    var tableContainer = document.getElementById('table-breakdown');
    tableContainer.innerHTML = '';
    tableContainer.appendChild(buildVersionsTable(collectAllRows()));
  }

  function projectVersionHistorySeries(projectKey, versionNames) {
    var proj = data.projects[projectKey];
    if (!proj || !proj.versions) return [];
    var cutoff = rangeCutoff();
    var dateKeys = Object.keys(proj.versions).sort();
    return versionNames.map(function (versionName) {
      var points = [];
      dateKeys.forEach(function (dk) {
        var ts = Date.parse(dk + 'T00:00:00Z');
        if (cutoff && ts < cutoff) return;
        var dayRows = proj.versions[dk];
        var total = dayRows.reduce(function (s, r) { return s + r.count; }, 0);
        var entry = dayRows.filter(function (r) { return r.version === versionName; })[0];
        if (entry) {
          points.push([ts, state.adoptionMetric === 'share' ? (total ? (entry.count / total) * 100 : 0) : entry.count]);
        }
      });
      var latestEntry = null;
      dateKeys.slice().reverse().some(function (dk) {
        var e = proj.versions[dk].filter(function (r) { return r.version === versionName; })[0];
        if (e) { latestEntry = e; return true; }
        return false;
      });
      return { name: versionName, stable: latestEntry ? latestEntry.stable : true, points: points };
    });
  }

  function renderAdoptionGrid() {
    var grid = document.getElementById('adoption-grid');
    grid.innerHTML = '';
    var actives = activeProjectList();
    if (!actives.length) {
      grid.appendChild(el('div', { class: 'empty-state', text: 'Select at least one project.' }));
      return;
    }
    actives.forEach(function (p) {
      var snapshot = projectVersionRows(p.key);
      var filtered = snapshot.rows.filter(function (r) { return matchesStability(r.stable) && matchesSearch(r.version); });
      filtered.sort(function (a, b) { return b.count - a.count; });
      var topNames = filtered.slice(0, 4).map(function (r) { return r.version; });

      var panel = el('div', { class: 'multiple-panel' });
      var heading = el('h3');
      var dot = el('span', { class: 'dot' });
      dot.style.width = '8px';
      dot.style.height = '8px';
      dot.style.borderRadius = '50%';
      dot.style.background = projectColor(p.key);
      heading.appendChild(dot);
      heading.appendChild(document.createTextNode(p.name));
      panel.appendChild(heading);

      if (!topNames.length) {
        panel.appendChild(el('div', { class: 'panel-note', text: 'No versions match the current filters.' }));
        grid.appendChild(panel);
        return;
      }

      var series = projectVersionHistorySeries(p.key, topNames).map(function (s) {
        return { name: s.name, color: statusColor(s.stable), points: s.points };
      });
      var chartHolder = el('div');
      panel.appendChild(chartHolder);
      renderLineChart(chartHolder, series, { compact: true, height: 210, padR: 84, suffix: state.adoptionMetric === 'share' ? '%' : '' });

      var dateKeys = Object.keys((data.projects[p.key] || {}).versions || {});
      if (dateKeys.length <= 1) {
        panel.appendChild(el('div', { class: 'panel-note', text: 'Tracking since ' + (dateKeys[0] || 'today') + '. Trend fills in daily.' }));
      }
      grid.appendChild(panel);
    });
  }

  function collectAllRows() {
    // No "% of all tracked" column: its denominator would sum each project's own
    // (fork-inclusive) total, and a Purpur server is already counted inside Paper's
    // total, so a cross-project share here would double-count and understate.
    var rows = [];
    activeProjectList().forEach(function (p) {
      var snapshot = projectVersionRows(p.key);
      snapshot.rows.forEach(function (r) {
        if (!matchesStability(r.stable) || !matchesSearch(r.version)) return;
        rows.push({
          project: p.name,
          projectKey: p.key,
          version: r.version,
          stable: r.stable,
          count: r.count,
          share: r.share,
        });
      });
    });
    return rows;
  }

  function buildVersionsTable(rows, opts) {
    opts = opts || {};
    var wrap = el('div');
    if (!rows.length) {
      wrap.appendChild(el('div', { class: 'empty-state', text: 'No versions match the current filters.' }));
      return wrap;
    }

    var cols = [
      { key: 'project', label: 'Project', numeric: false },
      { key: 'version', label: 'Version', numeric: false },
      { key: 'stable', label: 'Status', numeric: false },
      { key: 'count', label: 'Servers', numeric: true },
      { key: 'share', label: '% of project', numeric: true },
    ];

    var sorted = rows.slice().sort(function (a, b) {
      var col = state.sort.col, dir = state.sort.dir === 'asc' ? 1 : -1;
      var av = a[col], bv = b[col];
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });

    var table = el('table', { class: 'data-table' });
    var headRow = el('tr');
    cols.forEach(function (c) {
      var th = el('th', {
        class: c.numeric ? 'num' : '',
        text: c.label + (state.sort.col === c.key ? (state.sort.dir === 'asc' ? ' ▲' : ' ▼') : ''),
        onclick: function () {
          if (state.sort.col === c.key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
          else state.sort = { col: c.key, dir: 'desc' };
          renderAll();
        },
      });
      headRow.appendChild(th);
    });
    table.appendChild(el('thead', {}, [headRow]));

    var collapsed = opts.collapsible && !state.tableExpanded && sorted.length > TABLE_COLLAPSED_ROWS;
    var visible = collapsed ? sorted.slice(0, TABLE_COLLAPSED_ROWS) : sorted;

    var tbody = el('tbody');
    visible.forEach(function (r) {
      var pill = el('span', { class: 'status-pill' });
      var dot = el('span', { class: 'dot' });
      dot.style.background = statusColor(r.stable);
      pill.appendChild(dot);
      pill.appendChild(document.createTextNode(r.stable ? 'Stable' : 'Experimental'));

      var statusCell = el('td');
      statusCell.appendChild(pill);

      tbody.appendChild(
        el('tr', {}, [
          el('td', { text: r.project }),
          el('td', { text: r.version }),
          statusCell,
          el('td', { class: 'num', text: fmtFull(r.count) }),
          el('td', { class: 'num', text: fmtShare(r.share) }),
        ])
      );
    });
    table.appendChild(tbody);
    wrap.appendChild(table);

    if (opts.collapsible && sorted.length > TABLE_COLLAPSED_ROWS) {
      wrap.appendChild(
        el('button', {
          class: 'table-toggle show-more',
          text: collapsed ? 'Show all ' + sorted.length + ' versions' : 'Show fewer',
          onclick: function () {
            state.tableExpanded = !state.tableExpanded;
            renderFullTable();
          },
        })
      );
    }
    return wrap;
  }

  function renderFullTable() {
    var container = document.getElementById('full-table');
    container.innerHTML = '';
    container.appendChild(buildVersionsTable(collectAllRows(), { collapsible: true }));
  }

  function renderEcosystem() {
    var container = document.getElementById('ecosystem-list');
    container.innerHTML = '';
    if (!data.ecosystem) return;
    var dateKey = latestDateKey(data.ecosystem);
    if (!dateKey) return;
    var entries = data.ecosystem[dateKey];

    if (state.ecosystemView === 'pie') {
      renderEcosystemDonut(container, entries);
    } else {
      var maxVal = Math.max.apply(null, entries.map(function (e) { return e.count; }));
      entries.forEach(function (e) {
        var row = el('div', { class: 'eco-bar-row' });
        row.appendChild(el('div', { class: 'name', text: e.name }));
        var track = el('div', { class: 'eco-bar-track' });
        var fill = el('div', { class: 'eco-bar-fill' });
        fill.style.width = Math.max(2, (e.count / maxVal) * 100) + '%';
        track.appendChild(fill);
        row.appendChild(track);
        row.appendChild(el('div', { class: 'count', text: fmtFull(e.count) }));
        container.appendChild(row);
      });
    }

    var note = el('div', { class: 'panel-note', text: 'Snapshot: ' + dateKey });
    container.appendChild(note);
  }

  // Named forks keep their fixed colors; unmapped ones merge into the gray "Other"
  // slice, since a pie cannot give a dozen small slices distinct readable hues.
  function renderEcosystemDonut(container, entries) {
    var total = entries.reduce(function (sum, e) { return sum + e.count; }, 0);
    var named = [];
    var otherCount = 0;
    var otherNames = [];
    entries.forEach(function (e) {
      if (ECO_COLOR_VARS[e.name]) {
        named.push(e);
      } else {
        otherCount += e.count;
        otherNames.push(e.name);
      }
    });
    named.sort(function (a, b) { return b.count - a.count; });

    var slices = named.map(function (e) {
      return {
        name: e.name,
        count: e.count,
        color: cssVar(ECO_COLOR_VARS[e.name]),
        dim: false,
        tooltipRows: [
          ['Servers', fmtFull(e.count)],
          ['Share', fmtShare((e.count / total) * 100)],
        ],
      };
    });
    if (otherCount > 0) {
      slices.push({
        name: 'Other',
        count: otherCount,
        color: cssVar('--text-muted'),
        dim: false,
        tooltipRows: [
          ['Includes', otherNames.slice(0, 5).join(', ') + (otherNames.length > 5 ? ', more' : '')],
          ['Servers', fmtFull(otherCount)],
          ['Share', fmtShare((otherCount / total) * 100)],
        ],
      });
    }
    slices.sort(function (a, b) { return b.count - a.count; });
    renderDonut(container, slices, { size: 280, caption: 'servers total' });
  }

  function renderMeta() {
    var target = document.getElementById('last-updated');
    if (data.meta && data.meta.lastUpdated) {
      target.textContent = 'Last updated ' + new Date(data.meta.lastUpdated).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }) + ' UTC';
    } else {
      target.textContent = '';
    }
  }

  function renderAll() {
    syncFilterChips();
    renderStatRow();
    renderTotalsChart();
    renderBreakdownGrid();
    renderAdoptionGrid();
    renderFullTable();
    renderEcosystem();
  }

  function init() {
    renderFilters();
    loadAll()
      .then(function () {
        renderMeta();
        renderAll();
      })
      .catch(function (err) {
        console.error(err);
        document.querySelector('.wrap').appendChild(el('div', { class: 'empty-state', text: 'Failed to load data: ' + err.message }));
      });

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        if (data.meta) renderAll();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
