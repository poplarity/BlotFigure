import assert from 'node:assert/strict';
import { readPptx } from './pptx-read.mjs';

export async function conditionLayoutChecks(browser, base) {
  const results = [], context = await browser.newContext({ viewport: { width: 1720, height: 1050 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const check = async (name, action) => {
    console.log('conditionlayout:', name);
    try { await action(); results.push(['ok', name]); }
    catch (error) { results.push(['FAIL', name, error.message]); }
  };
  try {
    await page.goto(`${base}/index.html?demo=1&lang=en`);
    await page.waitForFunction(() => document.title.startsWith('READY '), null, { timeout: 180000 });
    await page.evaluate(() => {
      UI.openStep(5);
      const initial = JSON.stringify(BApp.S);
      window.conditionFixture = () => {
        BApp.S = JSON.parse(initial);
        BApp.activeColumn = 'main';
        BApp.S.rows = BApp.S.rows.slice(0, 1);
        BApp.S.rows[0].name = 'Protein';
        BApp.S.lanes.forEach(lane => { lane.name = ''; delete lane.nameRuns; });
        BApp.S.groups = [];
        BApp.S.conditions = [];
        BApp.S.notes = [];
        Object.assign(BApp.S.style, { showMW: false, laneNumbers: false, fontPt: 7, lanePt: null, labelAngle: '0' });
      };
      window.conditionMount = figure => {
        const host = document.createElement('div');
        host.innerHTML = figure.svg;
        document.body.appendChild(host);
        return host;
      };
      window.conditionBox = element => {
        const bounds = element.getBBox();
        return { left: bounds.x, top: bounds.y, right: bounds.x + bounds.width, bottom: bounds.y + bounds.height };
      };
    });
    await check('legacy defaults and invalid fields keep inward-facing title anchors', async () => {
      const cases = await page.evaluate(() => {
        conditionFixture();
        const outputs = [];
        for (const fields of [{}, { nameSide: 'right' }, { nameSide: 'right', nameAlign: 'invalid' }, { nameSide: 'invalid', nameAlign: 'invalid' }]) {
          BApp.S.conditions = [{ name: 'Legacy treatment', values: BApp.S.lanes.map(() => '+'), ...fields }];
          for (const preview of [true, false]) for (const ppt of [false, true]) {
            const figure = BRender.build(preview, ppt), host = conditionMount(figure);
            const title = [...host.querySelectorAll('text')].find(element => element.textContent === 'Legacy treatment');
            outputs.push({ fields, anchor: title.getAttribute('text-anchor'), position: +title.getAttribute('x'), width: figure.figW, gap: BApp.S.style.labelGapPt * 2 });
            host.remove();
          }
        }
        return outputs;
      });
      for (const result of cases) {
        const right = result.fields.nameSide === 'right';
        assert.equal(result.anchor, right ? 'start' : 'end', JSON.stringify(result));
        assert(Math.abs(result.position - (right ? result.width + result.gap : -result.gap)) < 0.02, JSON.stringify(result));
      }
    });
    await check('all six side/alignment combinations share a title column and preserve lane/image positions', async () => {
      const cases = await page.evaluate(() => {
        conditionFixture();
        const outputs = [], names = ['A long treatment title', 'Dose', 'Time'];
        BApp.S.conditions = names.map((name, index) => ({ name, pt: index === 1 ? 9 : 7, values: BApp.S.lanes.map(() => '+') }));
        const baseline = BRender.build(false);
        const pixels = figure => [...new DOMParser().parseFromString(figure.svg, 'image/svg+xml').querySelectorAll('image')].map(image => ['x', 'y', 'width', 'height', 'href'].map(attribute => image.getAttribute(attribute)));
        for (const side of ['left', 'right']) for (const align of ['left', 'center', 'right']) {
          BApp.S.conditions.forEach(condition => Object.assign(condition, { nameSide: side, nameAlign: align }));
          const sharedWidth = Math.max(...BApp.S.conditions.map(condition => BRender.measure(FigureText.label(condition), condition.pt)));
          for (const preview of [true, false]) for (const ppt of [false, true]) {
            const figure = BRender.build(preview, ppt), host = conditionMount(figure);
            const titles = names.map(name => [...host.querySelectorAll('text')].find(element => element.textContent === name));
            const fraction = { left: 0, center: 0.5, right: 1 }[align];
            const start = side === 'right' ? figure.figW + BApp.S.style.labelGapPt * 2 : -BApp.S.style.labelGapPt * 2 - sharedWidth;
            outputs.push({ side, align, anchor: titles.map(title => title.getAttribute('text-anchor')), positions: titles.map(title => +title.getAttribute('x')), expected: start + fraction * sharedWidth,
              lanes: [...figure.laneX], baselineLanes: [...baseline.laneX], cells: [...host.querySelectorAll('text')].filter(element => element.textContent === '+').map(element => +element.getAttribute('x')),
              contained: titles.every(title => { const bounds = conditionBox(title); return bounds.left >= figure.vx && bounds.right <= figure.vx + figure.w && bounds.top >= figure.vy && bounds.bottom <= figure.vy + figure.h; }),
              pixelsUnchanged: ppt || JSON.stringify(pixels(figure)) === JSON.stringify(pixels(baseline)) });
            host.remove();
          }
        }
        return outputs;
      });
      for (const result of cases) {
        assert.deepEqual(result.anchor, Array(3).fill({ left: 'start', center: 'middle', right: 'end' }[result.align]), JSON.stringify(result));
        assert(result.positions.every(position => Math.abs(position - result.expected) < 0.02), JSON.stringify(result));
        assert(result.contained, JSON.stringify(result));
        assert.deepEqual(result.lanes, result.baselineLanes);
        assert(result.cells.every(position => result.lanes.some(([, center]) => Math.abs(center - position) < 0.02)));
        assert(result.pixelsUnchanged);
      }
    });
    await check('opposite-side title widths and empty preview names are independent', async () => {
      const result = await page.evaluate(() => {
        conditionFixture();
        BApp.S.conditions = [
          { name: 'Left title', nameAlign: 'left', values: [] },
          { name: 'Right', nameSide: 'right', nameAlign: 'center', values: [] },
          { name: '', nameSide: 'right', values: BApp.S.lanes.map(() => '+') }
        ];
        const collect = preview => {
          const figure = BRender.build(preview), host = conditionMount(figure);
          const title = [...host.querySelectorAll('text')].find(element => element.textContent === 'Left title');
          const placeholder = host.querySelector('[data-edit="condname"][data-r="2"] text');
          const output = { position: +title.getAttribute('x'), placeholder: placeholder && { text: placeholder.textContent, anchor: placeholder.getAttribute('text-anchor'), position: +placeholder.getAttribute('x') }, width: figure.figW };
          host.remove(); return output;
        };
        const before = collect(true);
        BApp.S.conditions[1].name = 'An independently much wider title on the right';
        return { before, after: collect(true), exported: collect(false) };
      });
      assert.equal(result.before.position, result.after.position);
      assert.equal(result.after.placeholder.text, 'Condition');
      assert.equal(result.after.placeholder.anchor, 'start');
      assert(result.after.placeholder.position > result.after.width);
      assert.equal(result.exported.placeholder, null);
    });
    await check('formatted multiline titles retain line formatting, spacing and complete SVG bounds', async () => {
      const cases = await page.evaluate(() => {
        conditionFixture();
        BApp.S.lanes[0].name = 'Lane above';
        const outputs = [];
        for (const side of ['left', 'right']) for (const align of ['left', 'center', 'right']) {
          BApp.S.conditions = [
            { name: 'Upper', nameSide: side, nameAlign: align, values: BApp.S.lanes.map(() => '−') },
            { name: 'Formatted 2\nSubscript 3', pt: 12, color: 'red', nameSide: side, nameAlign: align, values: BApp.S.lanes.map(() => '+'),
              nameRuns: [{ text: 'Formatted ', italic: true }, { text: '2', script: 'sup' }, { text: '\nSubscript ' }, { text: '3', script: 'sub', color: 'red' }] }
          ];
          for (const preview of [true, false]) for (const ppt of [false, true]) {
            const figure = BRender.build(preview, ppt), host = conditionMount(figure);
            const lines = [...host.querySelectorAll('text')].filter(element => /Formatted|Subscript/.test(element.textContent));
            const upper = [...host.querySelectorAll('text')].find(element => element.textContent === 'Upper');
            const lane = [...host.querySelectorAll('text')].find(element => element.textContent === 'Lane above');
            const bounds = lines.map(conditionBox), upperBounds = conditionBox(upper), laneBounds = conditionBox(lane);
            outputs.push({ side, align, lines: lines.map(element => element.textContent), anchors: lines.map(element => element.getAttribute('text-anchor')),
              grouped: lines.length === 2 && lines[0].parentElement === lines[1].parentElement && lines[0].parentElement.hasAttribute('data-pptx-lines'),
              italic: !!host.querySelector('tspan[font-style="italic"]'), sup: !!host.querySelector('tspan[data-name-baseline="4.8"]'), sub: !!host.querySelector('tspan[data-name-baseline="-2.64"]'),
              contained: bounds.every(bounds => bounds.left >= figure.vx && bounds.right <= figure.vx + figure.w && bounds.top >= figure.vy && bounds.bottom <= figure.vy + figure.h),
              bounds, upperBounds, laneBounds,
              separated: bounds.length === 2 && upperBounds.bottom < Math.min(...bounds.map(bounds => bounds.top)) && laneBounds.bottom < upperBounds.top && bounds[0].bottom < bounds[1].top });
            host.remove();
          }
        }
        return outputs;
      });
      for (const result of cases) {
        assert.deepEqual(result.lines, ['Formatted 2', 'Subscript 3'], JSON.stringify(result));
        assert.deepEqual(result.anchors, Array(2).fill({ left: 'start', center: 'middle', right: 'end' }[result.align]));
        assert(result.grouped && result.italic && result.sup && result.sub && result.contained && result.separated, JSON.stringify(result));
      }
    });
    await check('units clear titles on their own side without lifting opposite-side titles', async () => {
      const cases = await page.evaluate(() => {
        conditionFixture();
        const row = BApp.S.rows[0], segment = row.segs[0], piece = BApp.pieceOf(row, segment), outputs = [];
        for (const unitSide of ['left', 'right']) for (const nameSide of ['left', 'right']) for (const size of [5, 7, 14]) for (const tickAtTop of [false, true]) {
          piece.marks = [{ id: 'condition-mark', u: 0, v: tickAtTop ? segment.vc - BApp.boxAbove(row, segment) + 1 : segment.vc, kda: 50 }];
          BApp.S.conditions = [{ name: 'Treatment', nameSide, values: BApp.S.lanes.map(() => '+') }];
          Object.assign(BApp.S.style, { showMW: true, mwSide: unitSide, markerPt: size });
          for (const preview of [true, false]) for (const ppt of [false, true]) {
            BApp.S.style.unitHeader = false;
            const baselineHost = conditionMount(BRender.build(preview, ppt));
            const baseline = +[...baselineHost.querySelectorAll('text')].find(element => element.textContent === 'Treatment').getAttribute('y');
            baselineHost.remove(); BApp.S.style.unitHeader = true;
            const host = conditionMount(BRender.build(preview, ppt)), unit = host.querySelector('[data-unit-header] text');
            const title = [...host.querySelectorAll('text')].find(element => element.textContent === 'Treatment');
            const unitBounds = conditionBox(unit), titleBounds = conditionBox(title);
            outputs.push({ unitSide, nameSide, size, tickAtTop, baseline, position: +title.getAttribute('y'), overlap: unitBounds.left < titleBounds.right && titleBounds.left < unitBounds.right && unitBounds.top < titleBounds.bottom && titleBounds.top < unitBounds.bottom });
            host.remove();
          }
        }
        return outputs;
      });
      for (const result of cases) {
        assert(!result.overlap, JSON.stringify(result));
        if (result.unitSide !== result.nameSide) assert.equal(result.position, result.baseline, JSON.stringify(result));
      }
    });
    await check('same-side units respect horizontal separation and formatted multiline bounds', async () => {
      const cases = await page.evaluate(() => {
        conditionFixture();
        const row = BApp.S.rows[0], segment = row.segs[0], piece = BApp.pieceOf(row, segment), outputs = [];
        piece.marks = [{ id: 'condition-mark', u: 0, v: segment.vc - BApp.boxAbove(row, segment) + 1, kda: 50 }];
        for (const side of ['left', 'right']) {
          Object.assign(BApp.S.style, { showMW: true, mwSide: side, markerPt: 7 });
          BApp.S.conditions = Array.from({ length: 6 }, (_, index) => ({ name: index ? `Dose ${index}` : 'A wide title above the unit header', nameSide: side, nameAlign: side, values: [] }));
          BApp.S.style.unitHeader = false;
          const baselineHost = conditionMount(BRender.build(false));
          const baseline = +[...baselineHost.querySelectorAll('text')].find(element => element.textContent === 'Dose 5').getAttribute('y');
          baselineHost.remove(); BApp.S.style.unitHeader = true;
          const separatedHost = conditionMount(BRender.build(false));
          outputs.push({ side, separated: true, baseline, position: +[...separatedHost.querySelectorAll('text')].find(element => element.textContent === 'Dose 5').getAttribute('y') });
          separatedHost.remove();
          for (const align of ['left', 'center', 'right']) {
            BApp.S.conditions = [{ name: 'Drug2\nDose3', nameSide: side, nameAlign: align, pt: 12, values: BApp.S.lanes.map(() => '+'),
              nameRuns: [{ text: 'Drug', italic: true }, { text: '2', script: 'sup' }, { text: '\nDose' }, { text: '3', script: 'sub' }] }];
            const figure = BRender.build(false, true), host = conditionMount(figure);
            const unitBounds = conditionBox(host.querySelector('[data-unit-header] text'));
            const titles = [...host.querySelectorAll('text')].filter(element => /Drug|Dose/.test(element.textContent));
            outputs.push({ side, align, separated: false, clear: titles.every(title => {
              const bounds = conditionBox(title);
              return bounds.right <= unitBounds.left || bounds.left >= unitBounds.right || bounds.bottom <= unitBounds.top || bounds.top >= unitBounds.bottom;
            }) });
            host.remove();
          }
        }
        return outputs;
      });
      for (const result of cases) {
        if (result.separated) assert.equal(result.position, result.baseline, JSON.stringify(result));
        else assert(result.clear, JSON.stringify(result));
      }
    });
    await check('independent layout columns keep their own title widths and avoid their neighbours', async () => {
      const result = await page.evaluate(() => {
        conditionFixture();
        const second = BApp.addColumn(), row = JSON.parse(JSON.stringify(BApp.S.rows[0]));
        row.id = 'condition-column-row'; row.column = second.id; BApp.S.rows.push(row);
        second.lanes = JSON.parse(JSON.stringify(BApp.S.lanes)); second.range = [...BApp.S.range];
        second.conditions = [{ name: 'Second left', nameAlign: 'center', values: second.lanes.map(() => '−') }];
        BApp.S.conditions = [{ name: 'First right', nameSide: 'right', nameAlign: 'center', values: BApp.S.lanes.map(() => '+') }];
        const collect = () => {
          const figure = BRender.build(false), host = conditionMount(figure);
          const title = [...host.querySelectorAll('[data-layout-column] text')].find(element => element.textContent === 'Second left');
          const output = { position: +title.getAttribute('x'), columns: figure.columnBoxes.map(column => ({ left: column.x0, right: column.x1 })), width: figure.w };
          host.remove(); return output;
        };
        const before = collect(); BApp.S.conditions[0].name = 'A very long title belonging only to the first column';
        return { before, after: collect() };
      });
      assert.equal(result.before.position, result.after.position);
      assert(result.after.width > result.before.width);
      assert(result.after.columns[1].left > result.after.columns[0].right);
    });
    await check('editable PPT retains left/center/right anchors, title positions and rich multiline text', async () => {
      const output = await page.evaluate(async () => {
        conditionFixture();
        BApp.S.conditions = ['left', 'right'].flatMap(side => ['left', 'center', 'right'].map(align => ({
          name: `${side} ${align}`, nameSide: side, nameAlign: align, values: BApp.S.lanes.map(() => '+')
        })));
        BApp.S.conditions.push({ name: 'Rich 2\nBottom 3', nameSide: 'right', nameAlign: 'center', values: [], nameRuns: [{ text: 'Rich ', italic: true }, { text: '2', script: 'sup' }, { text: '\nBottom ' }, { text: '3', script: 'sub', color: 'red' }] });
        const before = JSON.stringify(BApp.S), figure = BRender.build(false, true), host = conditionMount(figure);
        const names = BApp.S.conditions.slice(0, 6).map(condition => {
          const title = [...host.querySelectorAll('text')].find(element => element.textContent === condition.name);
          return { text: condition.name, align: condition.nameAlign, anchor: +title.getAttribute('x') - figure.vx };
        });
        host.remove();
        const canvas = await Export.svgToCanvas(BRender.build(false).svg, figure.w, figure.h, 150);
        const bytes = Array.from(new Uint8Array(await (await PPTX.build()).arrayBuffer()));
        return { bytes, names, unchanged: before === JSON.stringify(BApp.S), raster: canvas.width > 100 && canvas.height > 10 };
      });
      assert(output.unchanged && output.raster);
      const files = readPptx(Buffer.from(output.bytes)), slide = files.get('ppt/slides/slide1.xml').toString();
      for (const expected of output.names) {
        const shape = [...slide.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map(match => match[0]).find(shape => shape.includes(`>${expected.text}</a:t>`));
        assert(shape, expected.text);
        assert.match(shape, new RegExp(`algn="${{ left: 'l', center: 'ctr', right: 'r' }[expected.align]}"`));
        const position = +shape.match(/<a:off x="([^"]+)"/)[1] / 12700;
        const width = +shape.match(/<a:ext cx="([^"]+)"/)[1] / 12700;
        const anchor = position + width * { left: 0, center: 0.5, right: 1 }[expected.align];
        assert(Math.abs(anchor - expected.anchor) < 0.03, `${expected.text}: ${anchor} vs ${expected.anchor}`);
      }
      const rich = [...slide.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map(match => match[0]).find(shape => shape.includes('>Rich </a:t>'));
      assert(rich && rich.includes('>Bottom </a:t>'));
      assert.equal((rich.match(/<a:p>/g) || []).length, 2);
      assert.match(rich, /i="1"/); assert.match(rich, /baseline="[1-9]/); assert.match(rich, /baseline="-/); assert.match(rich, /D32F2F/i);
    });
    await check('real condition controls update all side/alignment combinations and support undo/redo', async () => {
      await page.evaluate(() => {
        conditionFixture();
        BApp.S.conditions = [
          { name: 'UI treatment', values: BApp.S.lanes.map(() => '+') },
          { name: 'UI right default', nameSide: 'right', values: BApp.S.lanes.map(() => '−') }
        ];
        BApp.commit(); UI.openStep(5);
        window.conditionUIValues = JSON.stringify(BApp.S.conditions.map(condition => condition.values));
        window.conditionUICrops = JSON.stringify(BApp.S.rows);
      });
      const sideControl = page.locator('[data-cond-side="0"]'), alignControl = page.locator('[data-cond-align="0"]');
      await sideControl.waitFor({ state: 'visible', timeout: 10000 });
      assert.equal(await sideControl.inputValue(), 'left');
      assert.equal(await alignControl.inputValue(), 'right');
      assert.equal(await page.locator('[data-cond-side="1"]').inputValue(), 'right');
      assert.equal(await page.locator('[data-cond-align="1"]').inputValue(), 'left');
      await sideControl.selectOption('right');
      assert.equal(await alignControl.inputValue(), 'left');
      await sideControl.selectOption('left');
      assert.equal(await alignControl.inputValue(), 'right');
      await alignControl.selectOption('center'); await sideControl.selectOption('right');
      assert.equal(await alignControl.inputValue(), 'center');
      for (const side of ['left', 'right']) for (const align of ['left', 'center', 'right']) {
        await sideControl.selectOption(side); await alignControl.selectOption(align);
        await page.waitForFunction(({ side, align }) => BApp.S.conditions[0].nameSide === side && BApp.S.conditions[0].nameAlign === align, { side, align });
        const title = page.locator('#preview [data-edit="condname"][data-r="0"][data-column="main"] text');
        await page.waitForFunction(({ side, align }) => {
          const title = document.querySelector('#preview [data-edit="condname"][data-r="0"][data-column="main"] text');
          return title?.getAttribute('text-anchor') === { left: 'start', center: 'middle', right: 'end' }[align]
            && (side === 'right' ? +title.getAttribute('x') > BRender.build(true).figW : +title.getAttribute('x') < 0);
        }, { side, align });
        assert.equal(await title.textContent(), 'UI treatment');
      }
      await page.click('#btnUndo');
      await page.waitForFunction(() => BApp.S.conditions[0].nameSide === 'right' && BApp.S.conditions[0].nameAlign === 'center');
      await page.click('#btnRedo');
      await page.waitForFunction(() => BApp.S.conditions[0].nameSide === 'right' && BApp.S.conditions[0].nameAlign === 'right');
      assert(await page.evaluate(() => conditionUIValues === JSON.stringify(BApp.S.conditions.map(condition => condition.values)) && conditionUICrops === JSON.stringify(BApp.S.rows)));
    });
    await check('real condition controls apply to the selected layout column only', async () => {
      const columnId = await page.evaluate(() => {
        conditionFixture();
        BApp.S.conditions = [{ name: 'Main condition', nameSide: 'left', nameAlign: 'right', values: BApp.S.lanes.map(() => '+') }];
        const column = BApp.addColumn(), row = JSON.parse(JSON.stringify(BApp.S.rows[0]));
        row.id = 'condition-ui-row'; row.column = column.id; BApp.S.rows.push(row);
        column.lanes = JSON.parse(JSON.stringify(BApp.S.lanes)); column.range = [...BApp.S.range];
        column.conditions = [{ name: 'Second condition', values: column.lanes.map(() => '−') }];
        BApp.commit(); UI.openStep(5); return column.id;
      });
      await page.locator('[data-cond-side="0"]').waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('[data-cond-side="0"]').selectOption('right');
      await page.locator('[data-cond-align="0"]').selectOption('center');
      assert(await page.evaluate(columnId => {
        const main = BApp.S.conditions[0], second = BApp.columnData(columnId).conditions[0];
        return main.nameSide === 'left' && main.nameAlign === 'right' && second.nameSide === 'right' && second.nameAlign === 'center';
      }, columnId));
      await page.click('[data-column-pick="main"]');
      assert.equal(await page.locator('[data-cond-side="0"]').inputValue(), 'left');
      assert.equal(await page.locator('[data-cond-align="0"]').inputValue(), 'right');
      await page.click(`[data-column-pick="${columnId}"]`);
      assert.equal(await page.locator('[data-cond-side="0"]').inputValue(), 'right');
      assert.equal(await page.locator('[data-cond-align="0"]').inputValue(), 'center');
    });
    await check('condition rendering has no JavaScript errors', async () => assert.deepEqual(errors, []));
  } finally { await context.close(); }
  return results;
}
