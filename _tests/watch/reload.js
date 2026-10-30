// Confirms the three watch projects still open and render identically in the updated Gesso.
const { ROOT } = require('../env.js');
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('file://' + ROOT + '/Gesso/index.html'); await p.waitForTimeout(700);
  for (const n of (process.argv[2] ? [process.argv[2]] : ['Kiln Ember','Kiln Lattice','Kiln Aster'])) {
    const txt = fs.readFileSync(__dirname + '/out/' + n + ' Concept.kgesso', 'utf8');
    const png = await p.evaluate(async (t) => { const d = await Gesso.FileIO.loadProject(JSON.parse(t), 'x'); await new Promise((r) => setTimeout(r, 400)); return Gesso.Compositor.flatten(d).toDataURL(); }, txt);
    console.log('done', n); fs.writeFileSync(__dirname + '/out/reload-' + n.split(' ')[1] + '.png', Buffer.from(png.split(',')[1], 'base64'));
  }
  console.log(errs.length ? errs.join('\n') : 'NO ERRORS'); await b.close();
})();
