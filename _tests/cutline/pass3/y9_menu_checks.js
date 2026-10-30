// View / Sequence menu toggles show their current state as a check mark.
const L = require('../pass2/plib.js');
(async () => {
  const { b, p, errs } = await L.launch();
  await L.boot(p); await L.newProjectUI(p);
  async function state(title, label) {
    await p.click(`.menu-title:text-is("${title}")`); await p.waitForTimeout(80);
    const it = p.locator('.cl-menu .item', { hasText: label }).first();
    const chk = (await it.locator('.chk').textContent()).trim();
    await p.keyboard.press('Escape'); await p.waitForTimeout(60);
    return chk === '✓';
  }
  for (const [title, label, prop] of [['View', 'Safe Margins', 'Program.safe'], ['View', 'Grid Overlay', 'Program.grid'], ['View', 'Loop Playback', 'Engine.loop'], ['Sequence', 'Toggle Snapping', 'state.snapping'], ['Sequence', 'Toggle Linked Selection', 'state.linked']]) {
    const before = await state(title, label);
    const live = await p.evaluate((pp) => { let o = Cutline; pp.split('.').forEach(k => { o = o[k]; }); return !!o; }, prop);
    L.ok(before === live, `${label}: check mark matches state before toggle (${live})`);
    await L.menu(p, title, label);
    const after = await state(title, label);
    L.ok(after === !before, `${label}: check mark flips after clicking (${after})`);
    await L.menu(p, title, label);
    L.ok(await state(title, label) === before, `${label}: restored`);
  }
  L.ok(await state('View', 'Use Proxies') === true, 'Use Proxies checked by default');
  L.ok(await state('View', 'Pop Out Program Monitor') === false, 'Pop Out unchecked when no window');
  L.ok(await state('View', 'Full-Screen Preview') === false, 'Full-screen unchecked');
  await L.finish(b, errs, 'y9_menu_checks');
})();
