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
  const { readMapTile } = await import('../src/map-tile-store.js');
  const store = createSaveStore(directory);
  ipcMain.handle('save:load', (_event, ...args) => store.load(...args));
  ipcMain.handle('save:write', (_event, ...args) => store.save(...args));
  const tileRequests = [];
  let activeReads = 0;
  let maxActiveReads = 0;
  ipcMain.handle('map:tile',async (_event,bundle,id) => {
    tileRequests.push({bundle,id});
    activeReads++;
    maxActiveReads = Math.max(maxActiveReads,activeReads);
    try {
      return await readMapTile(bundle,id);
    } finally {
      activeReads--;
    }
  });
  const window = new BrowserWindow({
    show: false, width: 1390, height: 880,
    webPreferences: { preload: join(__dirname, '../src/preload.cjs'), sandbox: true, contextIsolation: true, backgroundThrottling:false },
  });
  const web = window.webContents;
  web.session.webRequest.onBeforeRequest({ urls:['http://*/*','https://*/*'] },(_details,reply) => reply({cancel:true}));
  const errors = [];
  web.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
  });
  await window.loadFile(join(__dirname, '../src/index.html'));
  const run = code => web.executeJavaScript(code);
  const backgroundPaints = await run(`(async () => {
    const {drawMap} = await import('./map.js');
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;left:-1000px;width:360px;height:260px';
    document.body.append(canvas);
    const world = {tracks:[],stations:[],layers:{
      terrain:false,roads:false,buildings:false,water:false,green:false,landUse:false,cities:false,
    }};
    let paints = 0;
    const getContext = OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext = function (...args) {
      paints++;
      return getContext.apply(this,args);
    };
    try {
      const center = {lat:38.9072,lon:-77.0369};
      const counts = [];
      for (const zoom of [.0001,.0384]) {
        const camera = {center,zoom};
        for (let frame = 0; frame < 12; frame++) {
          drawMap(canvas,camera,world,{trains:[{point:{lat:center.lat,lon:center.lon+frame*.0001},color:'white'}]});
        }
        counts.push(paints);
      }
      const camera = {center,zoom:.0384};
      world.layers.states = false;
      drawMap(canvas,camera,world);
      counts.push(paints);
      canvas.style.width = '400px';
      drawMap(canvas,camera,world);
      counts.push(paints);
      return counts;
    } finally {
      OffscreenCanvas.prototype.getContext = getContext;
      canvas.remove();
    }
  })()`);
  assert.deepEqual(backgroundPaints,[1,2,3,4],
    'Train frames reuse the basemap at both zoom levels, layers and viewport changes redraw it');
  const corridorCoverage = await run(`(async () => {
    const {drawBasemap} = await import('./basemap.js');
    const {geographic,mercator} = await import('./geometry.js');
    const {cities} = await import('./railway.js');
    const [start,end] = cities.slice(0,2).map(mercator);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 120;
    const ctx = canvas.getContext('2d');
    const layers = {roads:false,water:false,green:false,landUse:false,buildings:false,cities:false};
    function sample(center,terrain) {
      ctx.fillStyle = '#102d3d';
      ctx.fillRect(0,0,120,120);
      drawBasemap(ctx,{center,zoom:.003},120,120,{...layers,terrain},() => {});
      const pixels = ctx.getImageData(0,0,120,120).data;
      return pixels.some((value,index) => index%4 === 0 && value !== 16);
    }
    const centers = [0,.25,.5,.75,1].map(fraction => geographic({
      x:start.x+(end.x-start.x)*fraction,y:start.y+(end.y-start.y)*fraction,
    }));
    for (const center of centers) {
      for (let attempt = 0; attempt < 100 && !sample(center,true); attempt++) {
        await new Promise(resolve => setTimeout(resolve,25));
      }
      if (!sample(center,true) || sample(center,false)) return false;
    }
    return true;
  })()`);
  assert.ok(corridorCoverage,'Offline terrain renders between nearby cities and respects the terrain toggle');
  async function waitForTileReads() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const count = tileRequests.length;
      await new Promise(resolve => setTimeout(resolve,450));
      if (!activeReads && count === tileRequests.length) return;
    }
    throw Error('Map tile reads did not settle.');
  }
  const hasOverview = selector => run(`(() => {
    const canvas = document.querySelector(${JSON.stringify(selector)});
    const context = canvas.getContext('2d');
    const alphaAt = (x,y) => context.getImageData(Math.floor(canvas.width*x),Math.floor(canvas.height*y),1,1).data[3];
    return alphaAt(.5,.5) === 255 && alphaAt(.01,.01) < 255;
  })()`);
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
  assert.deepEqual(await run(`(() => {
    const { backgroundColor, backgroundImage } = getComputedStyle(document.querySelector('.home'));
    return [backgroundColor, backgroundImage];
  })()`), ['rgb(3, 25, 38)', 'none']);
  const backgroundOf = selector => run(`getComputedStyle(
    document.querySelector(${JSON.stringify(selector)})
  ).backgroundColor`);
  assert.equal(await backgroundOf('.home .tool'), 'rgb(16, 45, 61)');
  assert.equal(await backgroundOf('.home .slots button'), 'rgb(34, 70, 91)');
  assert.ok(await run(`(() => {
    const home = document.querySelector('.home');
    const { left, top } = home.querySelector('h1').getBoundingClientRect();
    const style = getComputedStyle(home);
    return left === parseFloat(style.paddingLeft) && top === parseFloat(style.paddingTop);
  })()`), 'Home title sits at the top-left inset');
  assert.ok(await run(`(async () => {
    const title = document.querySelector('.home h1');
    const style = getComputedStyle(title);
    if (!style.fontFamily.startsWith('"Momo Trust Display"')) return false;
    const faces = await document.fonts.load(style.fontSize + ' "Momo Trust Display"', title.textContent);
    return faces.some(face => face.status === 'loaded');
  })()`), 'Home title uses the bundled display font');
  assert.ok(await run(`(async () => {
    const faces = await document.fonts.load('16px "Bpmf Huninn"');
    return faces.some(face => face.status === 'loaded');
  })()`), 'The local button font loads');
  const buttonsUseBundledFont = () => run(`Array.from(document.querySelectorAll('button')).every(
    button => getComputedStyle(button).fontFamily.startsWith('"Bpmf Huninn"')
  )`);
  assert.ok(await buttonsUseBundledFont(), 'Home buttons use the bundled font');
  await click('New World');
  await waitFor('.city-map');
  assert.ok(await hasOverview('.city-map'), 'City picker renders the U.S. outline');
  await click('Create World');
  await waitFor('#viewport');
  for (const name of ['Population','Metrics','Finances','Help']) {
    await click(name,'.toolbar');
    assert.equal(await run(`!!document.querySelector(${JSON.stringify(tool(name))})`),false);
  }
  const topButton = '.toolbar button';
  assert.ok(await run("document.querySelector('.toolbar').getBoundingClientRect().height <= 40"),
    'The top toolbar fits in a compact single row');
  assert.equal(await backgroundOf(topButton),'rgba(0, 0, 0, 0)');
  const hoverPoint = await run(`(() => {
    const {left,top,width,height} = document.querySelector(${JSON.stringify(topButton)}).getBoundingClientRect();
    return {x:left+width/2,y:top+height/2};
  })()`);
  web.debugger.attach('1.3');
  try {
    await web.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...hoverPoint});
    assert.equal(await backgroundOf(topButton),'rgb(16, 38, 53)');
    await web.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:100});
    assert.equal(await backgroundOf(topButton),'rgba(0, 0, 0, 0)');
  } finally { web.debugger.detach(); }
  await click('Build','.toolbar');
  await click('Projects','.toolbar');
  const toolBox = name => run(`document.querySelector(${JSON.stringify(tool(name))}).getBoundingClientRect().toJSON()`);
  const buildBefore = await toolBox('Build');
  const projectsBefore = await toolBox('Projects');
  assert.ok(buildBefore.left-projectsBefore.right >= 8, 'Opening a tool leaves room between tools');
  web.debugger.attach('1.3');
  try {
    const x = Math.round(projectsBefore.left + 20);
    const y = Math.round(projectsBefore.top + 15);
    await web.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mousePressed',x,y,button:'left',clickCount:1});
    await web.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mouseMoved',x:x+100,y,buttons:1});
    assert.ok((await toolBox('Projects')).right > buildBefore.left,'Tools can overlap during a drag');
    assert.deepEqual(await toolBox('Build'),buildBefore,'Dragging leaves the other tool in place');
    await web.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mouseReleased',x:x+100,y,button:'left',clickCount:1});
  } finally { web.debugger.detach(); }
  await run(`Promise.all(document.querySelector(${JSON.stringify(tool('Projects'))}).getAnimations()
    .map(animation => animation.finished))`);
  const projectsAfter = await toolBox('Projects');
  assert.equal(buildBefore.left-projectsAfter.right,8,'The dropped tool leaves a small gap beside the other tool');
  assert.ok(projectsAfter.width < projectsBefore.width,'The dropped tool reshapes to fit');
  assert.deepEqual(await toolBox('Build'),buildBefore,'Dropping leaves the other tool in place');
  await click('×',tool('Projects'));
  await click('×',tool('Build'));
  assert.equal(await backgroundOf('.game .map'), 'rgb(3, 25, 38)');
  assert.equal(await backgroundOf('.game .toolbar'), 'rgb(3, 25, 38)');
  assert.equal(await backgroundOf('.game .statusbar'), 'rgb(3, 25, 38)');
  assert.ok(await hasOverview('#viewport canvas'), 'New world renders the U.S. outline');
  const wheelPaints = await run(`(async () => {
    const canvas = document.querySelector('#viewport canvas');
    const {left,top,width,height} = canvas.getBoundingClientRect();
    const getContext = OffscreenCanvas.prototype.getContext;
    let paints = 0;
    OffscreenCanvas.prototype.getContext = function (...args) {
      paints++;
      return getContext.apply(this,args);
    };
    try {
      for (let index = 0; index < 8; index++) {
        canvas.dispatchEvent(new WheelEvent('wheel',{
          deltaY:-10,clientX:left+width/3,clientY:top+height/2,cancelable:true,
        }));
      }
      await new Promise(requestAnimationFrame);
      return paints;
    } finally {
      OffscreenCanvas.prototype.getContext = getContext;
    }
  })()`);
  assert.equal(wheelPaints,1,'Wheel events in the same animation frame share one basemap redraw');
  await click('City','.map-controls');
  assert.equal(await hasOverview('#viewport canvas'), false, 'City button opens the local construction view');
  await click('U.S.','.map-controls');
  assert.ok(await hasOverview('#viewport canvas'), 'U.S. button restores the overview');
  await click('Map','.toolbar');
  assert.deepEqual(await run(`[...document.querySelectorAll('.map-boundaries label')].map(label =>
    [label.textContent.trim(),label.querySelector('input').checked])`),
    [['State borders',true],['County borders',false],['ZIP Code areas',false]]);
  const toggleLayer = name => run(`[...document.querySelectorAll('section[aria-label="Map"] label')].find(
    label => label.textContent.trim() === ${JSON.stringify(name)}
  ).querySelector('input').click()`);
  const landUsePixels = () => run(`(async () => {
    const {landUseStyles} = await import('./basemap.js');
    const counts = Object.fromEntries(Object.keys(landUseStyles).map(layer => [layer,0]));
    const colors = new Map(Object.entries(landUseStyles).map(([layer,{color}]) => [parseInt(color.slice(1),16),layer]));
    const canvas = document.querySelector('#viewport canvas');
    const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      const layer = colors.get((pixels[i] << 16) | (pixels[i+1] << 8) | pixels[i+2]);
      if (layer && pixels[i+3] === 255) counts[layer]++;
    }
    return counts;
  })()`);
  const publicLand = await landUsePixels();
  assert.ok(publicLand.nationalForests > 0 && publicLand.nationalParks > 0,'National view colors forests and parks separately');
  await toggleLayer('Land-use colors');
  assert.equal((await landUsePixels()).nationalForests,0);
  assert.equal((await landUsePixels()).nationalParks,0);
  await toggleLayer('Land-use colors');
  assert.deepEqual(await landUsePixels(),publicLand);
  assert.equal(await run("document.querySelectorAll('.map-legend .map-swatch').length"),5);
  const nationalPixels = () => run(`(() => {
    const canvas = document.querySelector('#viewport canvas');
    const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let borders = 0;
    let lakes = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 18 && pixels[i+1] === 61 && pixels[i+2] === 84 && pixels[i+3] === 255) lakes++;
      if (pixels[i] > 65 && pixels[i] <= 83 && pixels[i+1] > 97 && pixels[i+1] <= 116 && pixels[i+2] > 115 && pixels[i+2] <= 136) borders++;
    }
    return {borders,lakes};
  })()`);
  const overview = await nationalPixels();
  assert.ok(overview.lakes > 1000, 'National view renders lake polygons');
  await toggleLayer('Water');
  assert.equal((await nationalPixels()).lakes,0,'Water toggle hides the national water layer');
  await toggleLayer('Water');
  await toggleLayer('State borders');
  assert.ok((await nationalPixels()).borders < overview.borders,'State borders toggle hides inland boundary strokes');
  await toggleLayer('State borders');
  await run("document.querySelector('[aria-label=\"Close Map\"]').click()");
  await click('City','.map-controls');
  for (let step = 0; step < 14; step++) await click('−','.map-controls');
  assert.deepEqual(await nationalPixels(),overview,'Zooming all the way out returns to the national view');
  await click('City','.map-controls');
  await waitForTileReads();
  const waterDraws = () => run(`(() => {
    const drawing = OffscreenCanvasRenderingContext2D.prototype;
    const fill = drawing.fill;
    const stroke = drawing.stroke;
    const operations = [];
    drawing.fill = function (...args) {
      if (this.fillStyle === '#144763') operations.push('body');
      return fill.apply(this,args);
    };
    drawing.stroke = function (...args) {
      if (this.strokeStyle === '#34718b') operations.push('stream');
      return stroke.apply(this,args);
    };
    try {
      const label = [...document.querySelectorAll('section[aria-label="Map"] label')]
        .find(node => node.textContent.trim() === 'Water');
      const checkbox = label.querySelector('input');
      checkbox.click();
      checkbox.click();
      return operations;
    } finally {
      drawing.fill = fill;
      drawing.stroke = stroke;
    }
  })()`);
  await click('Map','.toolbar');
  const cityWater = await waterDraws();
  await run("document.querySelector('[aria-label=\"Close Map\"]').click()");
  await click('+','.map-controls');
  await waitForTileReads();
  const mapPixels = () => run(`(() => {
    const canvas = document.querySelector('#viewport canvas');
    const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let hash = 0;
    let buildings = 0;
    let outskirtsRoads = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      hash = Math.imul(hash,31) + pixels[i] + 3*pixels[i+1] + 7*pixels[i+2] + 11*pixels[i+3] | 0;
      if (pixels[i] === 113 && pixels[i+1] === 131 && pixels[i+2] === 148 && pixels[i+3] === 255) buildings++;
      if ((i/4)%canvas.width < canvas.width*.22 && pixels[i] === 128 && pixels[i+1] === 155 && pixels[i+2] === 176) outskirtsRoads++;
    }
    return {hash,buildings,outskirtsRoads};
  })()`);
  for (let attempt = 0; attempt < 100; attempt++) {
    const {buildings,outskirtsRoads} = await mapPixels();
    if (buildings && outskirtsRoads) break;
    await new Promise(resolve => setTimeout(resolve,30));
  }
  assert.ok((await mapPixels()).buildings, 'Building footprints render without network access');
  assert.ok((await mapPixels()).outskirtsRoads, 'Main roads render well beyond the downtown extract while offline');
  assert.equal(await run("document.querySelector('.map-credit a').href"),'https://www.openstreetmap.org/copyright');
  await click('Map','.toolbar');
  await waitForTileReads();
  const streetWater = await waterDraws();
  await click('+','.map-controls');
  await waitForTileReads();
  const closeWater = await waterDraws();
  await click('−','.map-controls');
  await waitForTileReads();
  assert.ok(cityWater.includes('body') && !cityWater.includes('stream'),
    'City view draws water bodies without creek centerlines');
  assert.ok(streetWater.includes('body') && !streetWater.includes('stream'),
    'The first street zoom still hides creek centerlines');
  assert.ok(closeWater.includes('stream') && closeWater.every((entry,index) =>
    entry !== 'stream' || closeWater[index+1] === 'body'),
    'Closer zoom draws line-only streams beneath filled water bodies');
  const localLandUse = await landUsePixels();
  for (const layer of ['schools','universities','hospitals']) assert.ok(localLandUse[layer] > 0,layer + ' render locally');
  await toggleLayer('Land-use colors');
  const hiddenLandUse = await landUsePixels();
  for (const layer of ['schools','universities','hospitals']) assert.equal(hiddenLandUse[layer],0);
  await toggleLayer('Land-use colors');
  await waitForTileReads();
  const restoredLandUse = await landUsePixels();
  for (const layer of ['schools','universities','hospitals']) {
    assert.ok(restoredLandUse[layer] > 0,layer + ' return when the land-use layer is restored');
  }
  for (const name of ['Roads','Buildings','Terrain relief','Water','Parks and woodland']) {
    const before = await mapPixels();
    await toggleLayer(name);
    const hidden = await mapPixels();
    assert.notEqual(hidden.hash,before.hash,`${name} toggle changes the rendered map`);
    if (name === 'Buildings') assert.equal(hidden.buildings,0);
    await toggleLayer(name);
    const restored = await mapPixels();
    assert.notEqual(restored.hash,hidden.hash,`${name} toggle restores the rendered layer`);
    if (name === 'Buildings') assert.ok(restored.buildings > 0);
    if (name === 'Roads') assert.ok(restored.outskirtsRoads > 0);
  }
  await toggleLayer('County borders');
  await toggleLayer('ZIP Code areas');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (['geo-counties','geo-zips'].every(bundle => tileRequests.some(tile => tile.bundle === bundle))) break;
    await new Promise(resolve => setTimeout(resolve,50));
  }
  await waitForTileReads();
  const geography = await run(`(() => {
    const labels = [];
    const strokes = new Set();
    const drawing = OffscreenCanvasRenderingContext2D.prototype;
    const fillText = drawing.fillText;
    const stroke = drawing.stroke;
    drawing.fillText = function (label,...args) {
      labels.push(label);
      return fillText.call(this,label,...args);
    };
    drawing.stroke = function (...args) {
      strokes.add(this.strokeStyle);
      return stroke.apply(this,args);
    };
    try {
      const state = [...document.querySelectorAll('.map-boundaries label')].find(label => label.textContent.trim() === 'State borders');
      state.querySelector('input').click();
      const withoutStates = [...strokes];
      strokes.clear();
      state.querySelector('input').click();
      return {labels,withoutStates,withStates:[...strokes]};
    } finally {
      drawing.fillText = fillText;
      drawing.stroke = stroke;
    }
  })()`);
  assert.ok(geography.labels.some(name => ['Foggy Bottom','Adams Morgan','Dupont Circle','Capitol Hill','Georgetown','Chinatown'].includes(name)),
    'Neighborhood labels render at street zoom');
  assert.ok(geography.labels.some(name => ['Falls Church','Hyattsville','Bladensburg'].includes(name)),
    'Smaller cities and towns render at street zoom');
  assert.ok(geography.labels.some(name => /^\d{5}$/.test(name)),'ZIP Code area numbers render at street zoom');
  assert.ok(geography.withoutStates.includes('#718299') && geography.withoutStates.includes('#8b7967'),
    'County and ZIP Code outlines render independently of the state layer');
  assert.ok(!geography.withoutStates.includes('#537488') && geography.withStates.includes('#537488'));
  await run("document.querySelector('[aria-label=\"Close Map\"]').click()");
  await click('City','.map-controls');
  await click('Build','.toolbar');
  await click('Station',tool('Build'));
  assert.ok(await buttonsUseBundledFont(), 'In-game buttons use the bundled font');
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
  await run("[...document.querySelectorAll('section[aria-label=Map] label')].find(label => label.textContent.trim() === 'Terrain relief').querySelector('input').click()");
  await toggleLayer('Land-use colors');
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
  assert.equal(saved.layers.terrain,false);
  assert.equal(saved.layers.landUse,false);
  assert.equal(saved.layers.counties,true);
  assert.equal(saved.layers.zips,true);
  assert.equal((await store.load(1,'auto')).id,saved.id);
  await run(`(async () => {
    const {drawBasemap} = await import('./basemap.js');
    const ctx = document.createElement('canvas').getContext('2d');
    let center;
    function repaint() {
      drawBasemap(ctx,{center,zoom:.5},120,100,{terrain:false,cities:false},repaint);
    }
    window.testMapViewport = point => { center = point; repaint(); };
  })()`);
  const {mercator} = await import('../src/geometry.js');
  const circumference = mercator({lat:0,lon:180}).x*2;
  const chicago = {lat:41.8781,lon:-87.6298};
  async function checkTileReads(center,expected) {
    const start = tileRequests.length;
    await run(`window.testMapViewport(${JSON.stringify(center)})`);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (tileRequests.slice(start).some(({bundle}) => bundle === expected)) break;
      await new Promise(resolve => setTimeout(resolve,50));
    }
    await waitForTileReads();
    const requests = tileRequests.slice(start);
    assert.ok(requests.some(({bundle}) => bundle === expected),'Requested detailed tiles for ' + expected);
    const origin = mercator(center);
    for (const {bundle,id} of requests) {
      assert.ok(bundle === expected || bundle === expected + '-regional');
      const [column,row] = id.split(',').map(Number);
      const size = circumference / (bundle.endsWith('-regional') ? 4096 : 32768);
      const left = 60+(column*size-circumference/2-origin.x)*.5;
      const top = 50+(row*size-circumference/2+origin.y)*.5;
      assert.ok(left+size*.5 >= -128 && left <= 248 && top+size*.5 >= -128 && top <= 228,
        'Tile overlaps the viewport or its immediate margin');
    }
  }
  await checkTileReads(chicago,'chicago');
  await checkTileReads({lat:34.0522,lon:-118.2437},'los-angeles');
  await checkTileReads(chicago,'chicago');
  assert.ok(maxActiveReads <= 6,'Map reads are concurrency limited');
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
