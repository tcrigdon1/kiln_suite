const { launch, newProject, importFiles } = require('./lib');
(async () => {
  const { b, p, errs } = await launch();
  try {
    await newProject(p);
    await importFiles(p, ['test1.webm', 'tone.wav', 'green.png']);
    await p.evaluate(() => {
      const C = Cutline;
      C.edit('x', s2 => {
        const m = C.state.project.media;
        C.T.placeMedia(s2, m[0], 0, C.P.vtracks(s2)[0].id, C.P.atracks(s2)[0].id, 'overwrite');
        C.T.placeMedia(s2, m[1], 30, null, C.P.atracks(s2)[1].id, 'overwrite');
      });
      C.TL.zoomFit(); C.Engine.seek(45);
      C.A.select([C.P.seq().clips.find(c => c.kind === 'video').id]);
    });
    await p.click('.tabs .tab[data-id="color"]');
    await p.waitForTimeout(600);
    // drag the midtone wheel puck and bump exposure
    const wheel = p.locator('.wheel canvas').nth(1); const wb = await wheel.boundingBox();
    await p.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2); await p.mouse.down(); await p.mouse.move(wb.x + wb.width * 0.25, wb.y + wb.height * 0.35, { steps: 4 }); await p.mouse.up();
    await p.waitForTimeout(500);
    await p.screenshot({ path: 'shots/10-color.png' });
    await p.selectOption('.scopes select', 'vector'); await p.waitForTimeout(300);
    await p.locator('.scopes').screenshot({ path: 'shots/11-vector.png' });
    await p.selectOption('.scopes select', 'parade'); await p.waitForTimeout(300);
    await p.locator('.scopes').screenshot({ path: 'shots/12-parade.png' });
    await p.click('.tabs .tab[data-id="audio"]');
    await p.keyboard.press('Space'); await p.waitForTimeout(900);
    await p.screenshot({ path: 'shots/13-audio.png' });
    await p.keyboard.press('Space');
    await p.click('.tabs .tab[data-id="effects"]');
    await p.waitForTimeout(200);
    await p.screenshot({ path: 'shots/14-effects.png' });
    await p.keyboard.press('Control+m'); await p.waitForTimeout(800);
    await p.screenshot({ path: 'shots/15-export.png' });
    await p.keyboard.press('Escape');
    await p.keyboard.press('F1'); await p.waitForTimeout(300);
    await p.screenshot({ path: 'shots/16-shortcuts.png' });
    await p.keyboard.press('Escape');
    // menus
    await p.click('.menu-title:has-text("Sequence")'); await p.waitForTimeout(200);
    await p.screenshot({ path: 'shots/17-menu.png' });
    await p.keyboard.press('Escape');
  } catch (e) { console.log('TEST ERROR', e); }
  console.log('ERRORS:\n' + errs.join('\n').slice(0, 2000));
  await b.close();
})();
