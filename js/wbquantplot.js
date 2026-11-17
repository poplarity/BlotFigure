(function (global) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
  const colours = ['#2864ac', '#b76022', '#22836f', '#845a9c', '#707070'];
  const format = value => Math.abs(value) >= 10000 || (value !== 0 && Math.abs(value) < 0.001) ? value.toExponential(1) : String(Number(value.toPrecision(3)));
  function wrap(text, limit) {
    const lines = [];
    String(text).split(/\r?\n/).forEach(paragraph => {
      let remaining = paragraph;
      while (remaining.length > limit) {
        const space = remaining.lastIndexOf(' ', limit), end = space > limit / 2 ? space : limit;
        lines.push(remaining.slice(0, end)); remaining = remaining.slice(end).trimStart();
      }
      lines.push(remaining);
    });
    return lines;
  }
  function textLines(text, horizontal, vertical, limit, attributes) {
    return `<text x="${horizontal}" y="${vertical}" ${attributes || ''}>` + wrap(text, limit).map((line, index) =>
      `<tspan x="${horizontal}" dy="${index ? 11 : 0}">${escape(line)}</tspan>`).join('') + '</text>';
  }
  function model(block, entry, scale) {
    const settings = block.settings, groups = global.BApp.columnData(block.id).groups || [];
    const values = scale === 'volume' ? entry.d.map(value => value && value.quantifiable ? value.volume : null) : entry.relative;
    const names = block.lanes.map(lane => (global.BApp.columnData(block.id).lanes[lane - 1] || {}).name || `Lane ${lane}`);
    const useGroups = groups.length > 0 && !block.overlapping && (settings.plotStyle !== 'bars' || settings.sampleUnit === 'independent');
    const buckets = useGroups ? groups.map(group => ({ label: group.text || `Lanes ${group.from}–${group.to}`, group, points: [] }))
      : block.lanes.map((lane, index) => ({ label: names[index], points: [] }));
    const exclusions = [];
    block.lanes.forEach((lane, index) => {
      const value = values && values[index];
      if (!Number.isFinite(value)) { exclusions.push({ lane, reason: entry.exclusions[index] || 'no normalised value' }); return; }
      let bucket = useGroups ? buckets.find(candidate => lane >= Math.min(candidate.group.from, candidate.group.to) && lane <= Math.max(candidate.group.from, candidate.group.to)) : buckets[index];
      if (!bucket) {
        bucket = settings.plotStyle === 'bars' ? null : buckets.find(candidate => !candidate.group);
        if (!bucket) { bucket = { label: settings.plotStyle === 'bars' ? names[index] : 'Ungrouped', points: [] }; buckets.push(bucket); }
      }
      bucket.points.push({ lane, value, name: names[index], row: entry.row.id });
    });
    buckets.forEach(bucket => {
      const count = bucket.points.length;
      bucket.mean = count ? bucket.points.reduce((sum, point) => sum + point.value, 0) / count : null;
      bucket.sd = count > 1 ? Math.sqrt(bucket.points.reduce((sum, point) => sum + (point.value - bucket.mean) ** 2, 0) / (count - 1)) : null;
      bucket.summary = useGroups && !!bucket.group && settings.sampleUnit === 'independent';
    });
    const control = global.BApp.row(entry.control);
    const denominator = settings.method === 'control' ? (control && control.name) || 'loading control' : settings.method === 'total' ? 'total protein' : 'lane sum';
    const label = scale === 'volume' ? 'Band volume (a.u.)' : entry.reference ? 'Relative expression (fold)' : 'Normalised signal (a.u.)';
    const formula = scale === 'volume' ? 'Background-subtracted source signal' : `${entry.row.name || 'Target'} / ${denominator}`
      + (entry.reference ? `; relative to ${entry.reference.group || 'missing reference'}` : '');
    return { block, entry, buckets, exclusions, useGroups, label, formula };
  }
  function panel(result, options) {
    const { block, entry, buckets, exclusions } = result, settings = block.settings;
    const width = Math.max(300, 80 + buckets.length * 43), left = 65, right = 18;
    const title = entry.row.name || 'Unnamed protein', titleLines = wrap(title, Math.floor((width - 36) / 5.4));
    const context = global.BApp.blotNameEn(entry.blot) + (block.column && block.column.title ? ' · ' + block.column.title : '');
    const formula = context + '\n' + result.formula;
    const formulaLines = wrap(formula, Math.floor((width - 36) / 4.5));
    const top = 38 + titleLines.length * 12 + formulaLines.length * 11, base = top + 125;
    const labelLines = Math.max(1, ...buckets.map(bucket => wrap(bucket.label, 10).length));
    const summary = settings.sampleUnit === 'independent' && result.useGroups;
    const notes = [summary ? `Independent samples; ${settings.errorBars === 'sd' ? 'mean ± SD (n > 1)' : 'mean; no error bars'}`
      : settings.sampleUnit === 'independent' ? 'Independent samples; individual lanes (no grouped summary)'
        : settings.sampleUnit === 'technical' ? 'Technical measurements; no biological summary' : 'Points are measurements; independence not confirmed'];
    const measured = buckets.reduce((sum, bucket) => sum + bucket.points.length, 0);
    if (settings.plotStyle === 'bars' && !summary) notes.push('Individual-lane bars; no grouped summary');
    notes.push(`${measured}/${block.lanes.length} measured; ${exclusions.length} excluded`);
    if (block.overlapping) notes.push('Overlapping groups: showing individual lanes');
    if (measured === 0) notes.push('No valid values. Check loading control and reference.');
    const captionLines = notes.flatMap(note => wrap(note, Math.floor((width - 30) / 4.5)));
    const height = base + 30 + labelLines * 11 + captionLines.length * 11;
    const limits = [0];
    buckets.forEach(bucket => {
      bucket.points.forEach(point => limits.push(point.value));
      if (bucket.summary && bucket.mean != null) {
        const deviation = settings.errorBars === 'sd' && bucket.sd != null ? bucket.sd : 0;
        limits.push(bucket.mean - deviation, bucket.mean + deviation);
      }
    });
    const minimum = Math.min(...limits), maximum = Math.max(...limits);
    const range = maximum - minimum || 1, rawStep = range / 4, magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const fraction = rawStep / magnitude, increment = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
    const bottomValue = Math.floor(minimum / increment) * increment, topValue = maximum === minimum ? bottomValue + 1 : Math.ceil(maximum / increment) * increment;
    const yPosition = value => base - (value - bottomValue) / (topValue - bottomValue) * (base - top);
    let content = textLines(title, 18, 19, Math.floor((width - 36) / 5.4), 'font-size="11" font-weight="600"');
    content += textLines(formula, 18, 23 + titleLines.length * 12, Math.floor((width - 36) / 4.5), 'font-size="8" fill="#555"');
    content += `<path d="M ${left} ${top} V ${base} H ${width - right}" fill="none" stroke="#222" stroke-width="0.8"/>`;
    for (let tick = bottomValue; tick <= topValue + increment * 0.001; tick += increment) {
      const vertical = yPosition(tick);
      content += `<path d="M ${left - 4} ${vertical} H ${left}" stroke="#222" stroke-width="0.8"/><text x="${left - 7}" y="${vertical + 3}" text-anchor="end" font-size="8">${escape(format(tick))}</text>`;
    }
    content += `<text transform="translate(13 ${(top + base) / 2}) rotate(-90)" text-anchor="middle" font-size="9">${escape(result.label)}</text>`;
    const spacing = (width - left - right) / Math.max(1, buckets.length);
    buckets.forEach((bucket, bucketIndex) => {
      const centre = left + spacing * (bucketIndex + 0.5), colour = colours[bucketIndex % colours.length];
      if (bucket.summary && bucket.mean != null) {
        const meanY = yPosition(bucket.mean), halfWidth = Math.min(13, spacing * 0.28);
        if (settings.plotStyle === 'bars') content += `<rect class="q-plot-bar" x="${centre - halfWidth}" y="${Math.min(meanY, yPosition(0))}" width="${halfWidth * 2}" height="${Math.abs(meanY - yPosition(0))}" fill="${colour}" fill-opacity="0.18" stroke="${colour}" stroke-width="0.8"/>`;
        content += `<path class="q-plot-mean" d="M ${centre - halfWidth} ${meanY} H ${centre + halfWidth}" stroke="${colour}" stroke-width="1.5"/>`;
        if (settings.errorBars === 'sd' && bucket.sd != null) {
          const upper = yPosition(bucket.mean + bucket.sd), lower = yPosition(bucket.mean - bucket.sd);
          content += `<path class="q-plot-error" d="M ${centre} ${upper} V ${lower} M ${centre - 4} ${upper} H ${centre + 4} M ${centre - 4} ${lower} H ${centre + 4}" fill="none" stroke="${colour}" stroke-width="1"/>`;
        }
        content += `<text x="${centre}" y="${top - 6}" text-anchor="middle" font-size="8">n=${bucket.points.length}</text>`;
      }
      bucket.points.forEach((point, pointIndex) => {
        const offset = bucket.points.length < 2 ? 0 : ((pointIndex % 5) - Math.min(bucket.points.length - 1, 4) / 2) * 4;
        const selected = options.highlight && options.highlight.row === entry.row.id && options.highlight.lane === point.lane;
        if (settings.plotStyle === 'bars' && !bucket.summary) {
          const halfWidth = Math.min(13, spacing * 0.28), valueY = yPosition(point.value);
          content += `<rect class="q-plot-bar" data-lane="${point.lane}" data-value="${point.value}" x="${centre + offset - halfWidth}" y="${Math.min(valueY, yPosition(0))}" width="${halfWidth * 2}" height="${Math.abs(valueY - yPosition(0))}" fill="${colour}" fill-opacity="0.18" stroke="${colour}" stroke-width="0.8"/>`;
        }
        content += `<circle class="q-plot-point" data-row="${escape(entry.row.id)}" data-lane="${point.lane}" data-value="${point.value}" cx="${centre + offset}" cy="${yPosition(point.value)}" r="${selected ? 4 : 2.8}" fill="${colour}" stroke="${selected ? '#111' : '#fff'}" stroke-width="${selected ? 1.5 : 0.6}" tabindex="0" role="button" aria-label="${escape(point.name + ': ' + format(point.value))}"><title>${escape(point.name)}: ${escape(format(point.value))}</title></circle>`;
      });
      content += `<path d="M ${centre} ${base} V ${base + 4}" stroke="#222" stroke-width="0.8"/>`;
      content += textLines(bucket.label, centre, base + 15, 10, 'text-anchor="middle" font-size="8"');
    });
    content += textLines(captionLines.join('\n'), 15, base + 30 + labelLines * 11, Math.floor((width - 30) / 4.5), 'font-size="7.5" fill="#555"');
    const source = `${global.BApp.blotNameEn(entry.blot)}; source ${entry.rec ? entry.rec.name : 'unknown'}; selected exposure ${entry.rec ? global.BApp.expoLabel(entry.rec) : 'unknown'}`;
    return { width, height, content, result, source };
  }
  function render(blocks, options) {
    options = options || {};
    const panels = blocks.flatMap(block => block.rows.filter(entry => entry.target && (options.all || entry.row.id === options.row))
      .map(entry => panel(model(block, entry, options.scale || 'norm'), options)));
    const columns = panels.length > 1 ? 2 : 1, gap = 20;
    const columnWidth = Math.max(300, ...panels.map(item => item.width));
    const rowHeight = Math.max(270, ...panels.map(item => item.height));
    const width = columnWidth * columns + gap * (columns - 1), height = Math.max(1, Math.ceil(panels.length / columns)) * (rowHeight + gap) - gap;
    const description = panels.map(item => `${item.result.entry.row.name || 'Unnamed protein'}: ${item.source}. ${item.result.exclusions.length} excluded. `
      + item.result.exclusions.map(excluded => `Lane ${excluded.lane}: ${excluded.reason}`).join('; ')).join('\n');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}pt" height="${height}pt" viewBox="0 0 ${width} ${height}" role="img" aria-label="Quantitative Western blot plots"><title>Quantitative Western blot plots</title><desc>${escape(description)}</desc><rect width="${width}" height="${height}" fill="white"/><g font-family="Arial, Helvetica, sans-serif" fill="#222">`
      + panels.map((item, index) => `<g class="q-plot-panel" data-row="${escape(item.result.entry.row.id)}" transform="translate(${(index % columns) * (columnWidth + gap)} ${Math.floor(index / columns) * (rowHeight + gap)})">${item.content}</g>`).join('') + '</g></svg>';
    return { svg, width, height, panels, description };
  }
  global.WBQuantPlot = { render };
})(window);
