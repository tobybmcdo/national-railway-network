const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { join } = require('node:path');

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let directory;
app.whenReady().then(async () => {
  directory = await mkdtemp(join(process.cwd(), '.railway-smoke-'));
  const { createSaveStore } = await import('../src/saves.js');
  const store = createSaveStore(directory);
  ipcMain.handle('save:load', (_event, ...args) => store.load(...args));
  ipcMain.handle('save:write', (_event, ...args) => store.save(...args));
  const window = new BrowserWindow({
    show: false, width: 1390, height: 880,
    webPreferences: { preload: join(__dirname, '../src/preload.cjs'), sandbox: true, contextIsolation: true },
  });
  const web = window.webContents;
  const errors = [];
  web.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
  });
  await window.loadFile(join(__dirname, '../src/index.html'));
  const run = code => web.executeJavaScript(code);
  async function waitFor(selector) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await run(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw Error(`Timed out waiting for ${selector}. ${errors.join(' ')}`);
  }
  const click = (text, selector = '#app') => run(`(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector + ' button')})].find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (!button || button.disabled) throw Error('Button unavailable: ' + ${JSON.stringify(text)});
    button.click();
  })()`);
  const tool = name => `section[aria-label="${name}"]`;
  const field = (name, value, selector) => run(`(() => {
    const label = [...document.querySelectorAll(${JSON.stringify(selector + ' label')})].find(e => e.firstElementChild?.textContent === ${JSON.stringify(name)});
    const input = label?.querySelector('input,select');
    if (!input) throw Error('Missing field ' + ${JSON.stringify(name)});
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  async function mapClick(x, y) {
    const top = await run("Math.round(document.querySelector('#viewport').getBoundingClientRect().top)");
    web.debugger.attach('1.3');
    try {
      for (const type of ['mousePressed','mouseReleased']) {
        await web.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y: y + top, button:'left', clickCount:1 });
      }
    } finally { web.debugger.detach(); }
  }

  await waitFor('.slots');
  await click('New World');
  await waitFor('.city-map');
  assert.ok(await run("document.querySelector('.city-map').width > 100"));
  await click('Create World');
  await waitFor('#viewport');
  await click('Build','.toolbar');
  await click('Station',tool('Build'));
  for (const [name,x] of [['West Station',300],['East Station',575]]) {
    await field('Station name',name,tool('Build'));
    await click('Place on map',tool('Build'));
    await mapClick(x,300);
    assert.match(await run("document.querySelector('#notice').textContent"), /Added to/);
  }
  await click('Track',tool('Build'));
  await click('Place on map',tool('Build'));
  await mapClick(303,300);
  await mapClick(572,300);
  await click('Projects','.toolbar');
  await click('Details',tool('Projects'));
  await click('Build project',tool('Projects'));
  assert.match(await run("document.querySelector('#notice').textContent"), /Project built/);
  await click('Trains','.toolbar');
  await click('Buy',tool('Trains')+' .entry');
  await click('Routes','.toolbar');
  await click('Create route',tool('Routes'));
  await field('Route name','Main Line',tool('Routes'));
  await field('Symbol text','A',tool('Routes'));
  await field('Symbol shape','Diamond',tool('Routes'));
  await click('Stops',tool('Routes'));
  for (const name of ['West Station','East Station']) {
    const id = await run(`[...document.querySelectorAll('select option')].find(e => e.textContent === '${name}').value`);
    await field('Add stop',id,tool('Routes'));
    await click('Add',tool('Routes'));
  }
  await click('Service',tool('Routes'));
  const train = await run("[...document.querySelectorAll('section[aria-label=Routes] option')].find(e => e.textContent.includes('diesel')).value");
  await field('Trainset',train,tool('Routes'));
  await click('Save route',tool('Routes'));
  assert.match(await run("document.querySelector('#notice').textContent"), /Route saved/);
  await click('Map','.toolbar');
  await run("document.querySelector('section[aria-label=Map] input').click()");
  await click('Settings','.toolbar');
  await click('Create autosave now',tool('Settings'));
  await waitFor('section[aria-label=Settings] .entry');
  await click('Home','.toolbar');
  await waitFor('.slots');
  const saved = await store.load(1);
  assert.equal(saved.city.name,'Washington, D.C.');
  assert.equal(saved.stations.length,2);
  assert.equal(saved.tracks.length,1);
  assert.equal(saved.fleet.length,1);
  assert.equal(saved.routes[0].name,'Main Line');
  assert.equal(saved.routes[0].shape,'Diamond');
  assert.equal(saved.layers.tracks,false);
  assert.equal((await store.load(1,'auto')).id,saved.id);
  assert.deepEqual(errors,[]);
  console.log('Electron smoke test passed');
  window.destroy();
}).then(async () => {
  if (directory) await rm(directory, {recursive:true, force:true});
  app.exit(0);
}).catch(async error => {
  console.error(error);
  if (directory) await rm(directory, {recursive:true, force:true}).catch(() => {});
  app.exit(1);
});
