import { buildProject, buyTrain, catalog, cities, newWorld, projectCost } from './railway.js';
import { closestEndpoint, createProjection, mercator, geographic, stationGeometry, trackGeometry } from './geometry.js';
import { compileServices, getActiveTrains, servicePeriods, validateRoute } from './simulation.js';
import { drawMap, layerOptions } from './map.js';
import { clearMapTiles, landUseStyles } from './basemap.js';
import { boundaryLayers, mapLayerEnabled } from './geography-layers.js';
import { findToolPosition, toolGap } from './tool-layout.js';

const app = document.querySelector('#app');
const notice = document.querySelector('#notice');
const saves = window.railwaySaves;
const money = new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 });
const speeds = [0,1,5,20];
const tools = ['Projects','Build','Trains','Stations','Routes','Population','Metrics','Finances','Map','Settings','Help'];
const windows = new Map();
let slots = [];
let world, slot, canvas, viewport, budget, clock, hint, camera;
let schedules = [];
let speed = 0;
let placement = null;
let preview = null;
let selectedProject;
let zIndex = 0;
let noticeTimer;
let loading = false;
let repaintFrame = 0;

function element(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (value != null) node.setAttribute(key,value);
  }
  node.append(...children.flat().filter(child => child != null));
  return node;
}
const div = (style,...children) => element('div',{class:style},...children);
const p = text => element('p',{},text);
const small = text => element('small',{},text);
const title = text => element('h3',{},text);
function tell(message) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  noticeTimer = setTimeout(() => { notice.textContent = ''; },4500);
}
function action(label, fn, options = {}) {
  const button = element('button',{type:'button',class:options.primary ? 'primary' : '',title:options.title,'aria-label':options.label},label);
  if (options.active != null) button.setAttribute('aria-pressed',options.active);
  button.disabled = !!options.disabled;
  button.addEventListener('click',async () => {
    try { await fn(); } catch (error) { tell(error.message); }
  });
  return button;
}
function input(type,value,attributes = {}) {
  const node = element('input',{type,...attributes});
  node.value = value ?? '';
  return node;
}
function select(values, value) {
  const node = element('select',{},values.map(option => {
    const [id,label] = Array.isArray(option) ? option : [option,option];
    return element('option',{value:id},String(label));
  }));
  if (value != null) node.value = value;
  return node;
}
const field = (label,control) => element('label',{class:'field'},element('span',{},label),control);
function toggle(label, checked, onChange) {
  const node = input('checkbox');
  node.checked = checked;
  node.addEventListener('change',() => onChange(node.checked));
  return element('label',{class:'row'},node,label);
}
async function readSlots() {
  slots = await Promise.all([1,2,3].map(async id => {
    try { return { id, world:await saves.load(id) ?? await saves.load(id,'auto') }; }
    catch (error) { return { id,error:error.message }; }
  }));
}

async function home() {
  cancelToolDrag?.();
  clearMapTiles();
  speed = 0;
  world = null;
  canvas = null;
  toolResize.disconnect();
  windows.clear();
  document.documentElement.dataset.theme = localStorage.getItem('appearance') ?? 'standard';
  await readSlots();
  const cards = slots.map(entry => action('',() => {
    if (entry.error) throw new Error(entry.error);
    if (entry.world) return startWorld(entry.id,entry.world);
    pickCity(entry.id);
  }));
  cards.forEach((card,index) => {
    const entry = slots[index];
    card.append(element('strong',{},`Save ${entry.id}`),small(entry.world?.name ?? (entry.error ? 'Unable to open' : 'Empty slot')));
  });
  app.replaceChildren(element('section',{class:'launch home'},
    element('h1',{},'National Railway Network'),
    element('section',{class:'tool'},
      div('content stack',div('row',
        action('New World',() => {
          const empty = slots.find(item => !item.world && !item.error);
          pickCity(empty?.id);
        },{primary:true}),
        action('Settings',showStartSettings),
        action('Tutorial',showTutorial)),
      div('slots',cards)))));
}
function showStartSettings() {
  const appearance = select([['standard','Standard'],['contrast','High contrast']],localStorage.getItem('appearance') ?? 'standard');
  appearance.addEventListener('change',() => {
    localStorage.setItem('appearance',appearance.value);
    document.documentElement.dataset.theme = appearance.value;
  });
  app.replaceChildren(element('section',{class:'launch'},element('h1',{},'Settings'),
    element('section',{class:'tool'},div('content stack',field('Appearance',appearance),action('Back',home)))));
}
function showTutorial() {
  app.replaceChildren(element('section',{class:'launch'},element('h1',{},'Tutorial'),
    element('section',{class:'tool'},div('content stack',
      p('Pick a starting city and create a world. In Build, place two stations, then connect their endpoints with a track. Open Projects to review the costs and build the project.'),
      p('Buy a diesel train with enough cars for your service and short enough to fit the platforms. Open Routes, add the stations in order, and assign the train to at least one operating period. Run the clock to see service on the map.'),
      action('Back',home)))));
}
function pickCity(initialSlot) {
  const choices = slots.filter(entry => !entry.world && !entry.error);
  if (!choices.length) {
    tell('All three save slots are occupied.');
    return;
  }
  let city = cities[0];
  const citySelect = select(cities.map((item,index) => [index,item.name]),0);
  const slotSelect = select(choices.map(entry => [entry.id,`Save ${entry.id}`]),initialSlot ?? choices[0].id);
  const name = input('text','',{maxlength:60,placeholder:'Use the starting city name'});
  const picker = element('canvas',{class:'map city-map','aria-label':'Map of starting cities'});
  app.replaceChildren(element('section',{class:'launch'},element('h1',{},'Pick your city'),picker,
    element('section',{class:'tool'},div('content stack',
      div('fields',field('Starting city',citySelect),field('Save slot',slotSelect),field('World name',name)),
      div('row',action('Back',home),action('Create World',async () => {
        if (loading) return;
        loading = true;
        try {
          const id = Number(slotSelect.value);
          const created = newWorld(city,name.value.trim() || city.name);
          await saves.save(id,created);
          startWorld(id,created);
        } finally { loading = false; }
      },{primary:true}))))));
  let pickerProjection;
  function draw() {
    const zoom = Math.min(picker.clientWidth/6800000,picker.clientHeight/4200000);
    pickerProjection = drawMap(picker,{center:{lat:38.8,lon:-96},zoom},null,{picker:true});
  }
  citySelect.addEventListener('change',() => { city = cities[Number(citySelect.value)]; });
  picker.addEventListener('click',event => {
    const rect = picker.getBoundingClientRect();
    const index = cities.findIndex(item => {
      const point = pickerProjection.project(item);
      return Math.hypot(point.x-event.clientX+rect.left,point.y-event.clientY+rect.top) < 14;
    });
    if (index >= 0) {
      city = cities[index];
      citySelect.value = index;
    }
  });
  draw();
  const resize = new ResizeObserver(() => {
    if (picker.isConnected) draw();
    else resize.disconnect();
  });
  resize.observe(picker);
}
function overviewZoom() {
  return Math.min(canvas.clientWidth/6800000,canvas.clientHeight/4100000);
}
function showUS(schedule = repaint) {
  camera = {center:{lat:38.8,lon:-96},zoom:overviewZoom()};
  schedule();
}
function startWorld(id, value) {
  slot = id;
  world = value;
  speed = 0;
  placement = null;
  preview = null;
  selectedProject = world.projects[0]?.id;
  toolResize.disconnect();
  windows.clear();
  camera = { center:world.city,zoom:.024 };
  schedules = compileServices(world);
  document.documentElement.dataset.theme = world.theme ?? localStorage.getItem('appearance') ?? 'standard';
  canvas = element('canvas',{class:'map','aria-label':'Rail network map'});
  viewport = div('',canvas);
  viewport.id = 'viewport';
  hint = div('placement');
  hint.hidden = true;
  viewport.append(div('map-controls',
    action('+',() => zoomAt(1.6),{label:'Zoom in'}),
    action('−',() => zoomAt(.625),{label:'Zoom out'}),
    action('City',() => { camera = {center:world.city,zoom:.024}; repaint(); }),
    action('U.S.',showUS)
  ),hint);
  budget = element('span',{id:'budget'});
  clock = element('span',{id:'clock'});
  const speedButtons = speeds.map(rate => action(rate ? `${rate}×` : 'Pause',() => {
    speed = rate;
    speedButtons.forEach((button,index) => button.setAttribute('aria-pressed',rate === speeds[index]));
  },{active:rate === 0}));
  const toolbar = div('toolbar',action('Home',async () => {
    await saves.save(slot,world);
    await home();
  }),tools.map(name => Object.hasOwn(renderers,name)
    ? action(name,() => openTool(name))
    : element('button',{type:'button','aria-disabled':'true',title:'Coming soon'},name)));
  const status = div('statusbar',
    div('row',element('strong',{},world.name),budget),
    element('small',{class:'map-credit'},
      element('a',{href:'https://www.openstreetmap.org/copyright',target:'_blank',rel:'noopener'},'© OpenStreetMap contributors'),
      ' · Terrain: USGS 3DEP · Public lands: NPS, ',
      element('a',{href:'https://catalog.data.gov/dataset/fs-national-forests-dataset-us-forest-service-proclaimed-forests',target:'_blank',rel:'noopener'},'U.S. Forest Service'),
      ' · Names: ',
      element('a',{href:'https://www.geonames.org/',target:'_blank',rel:'noopener'},'GeoNames')),
    div('row',clock,speedButtons));
  app.replaceChildren(div('game',toolbar,viewport,status));
  bindMap();
  if (world.stations.length || world.tracks.length || world.projects.some(project => project.items.length)) repaint();
  else showUS();
}
function updateStatus() {
  const balance = money.format(world.budget);
  const day = Math.floor(world.clock/1440) + 1;
  const minute = Math.floor(world.clock)%1440;
  const time = `Day ${day} · ${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
  if (budget.textContent !== balance) budget.textContent = balance;
  if (clock.textContent !== time) clock.textContent = time;
}
function activeDraft() {
  return world.projects.find(project => project.id === selectedProject);
}
function queueRepaint() {
  if (!repaintFrame) repaintFrame = requestAnimationFrame(() => {
    repaintFrame = 0;
    repaint();
  });
}
function repaint() {
  if (repaintFrame) cancelAnimationFrame(repaintFrame);
  repaintFrame = 0;
  if (!canvas?.isConnected || !world) return;
  const current = new Map();
  const moment = world.clock % 1440;
  for (const entry of schedules) {
    const onDuty = moment >= entry.period.start && moment < entry.period.end;
    if (!current.has(entry.route.id) || onDuty) current.set(entry.route.id,entry);
  }
  drawMap(canvas,camera,world,{
    repaint,
    drafts:activeDraft()?.items,preview,anchor:placement?.start?.point,
    routes:[...current.values()],trains:getActiveTrains(schedules,world.clock),
  });
  updateStatus();
}
function zoomAt(factor,x = canvas.clientWidth/2,y = canvas.clientHeight/2,schedule = repaint) {
  const nextZoom = camera.zoom*factor;
  if (factor < 1 && nextZoom <= overviewZoom()) {
    if (camera.zoom !== overviewZoom() || camera.center.lat !== 38.8 || camera.center.lon !== -96) showUS(schedule);
    return;
  }
  const zoom = Math.min(4,nextZoom);
  if (zoom === camera.zoom) return;
  const center = mercator(camera.center);
  const dx = x-canvas.clientWidth/2;
  const dy = y-canvas.clientHeight/2;
  const focalShift = 1/camera.zoom-1/zoom;
  camera.center = geographic({
    x:center.x+dx*focalShift,
    y:center.y-dy*focalShift,
  });
  camera.zoom = zoom;
  schedule();
}
function bindMap() {
  let down;
  function mouse(event) {
    const rect = canvas.getBoundingClientRect();
    return {x:event.clientX-rect.left,y:event.clientY-rect.top};
  }
  function mapPosition(point) {
    return createProjection(camera.center,camera.zoom,canvas.clientWidth,canvas.clientHeight).unproject(point);
  }
  canvas.addEventListener('wheel',event => {
    event.preventDefault();
    const {x,y} = mouse(event);
    zoomAt(Math.exp(-event.deltaY*.0015),x,y,queueRepaint);
  },{passive:false});
  canvas.addEventListener('pointerdown',event => {
    canvas.setPointerCapture(event.pointerId);
    down = {...mouse(event),center:mercator(camera.center),moving:false};
  });
  canvas.addEventListener('pointermove',event => {
    const point = mouse(event);
    if (down) {
      const dx = point.x-down.x;
      const dy = point.y-down.y;
      if (down.moving || Math.hypot(dx,dy)>4) {
        down.moving = true;
        camera.center = geographic({x:down.center.x-dx/camera.zoom,y:down.center.y+dy/camera.zoom});
        queueRepaint();
      }
    } else if (placement) {
      const position = mapPosition(point);
      if (placement.kind === 'station') preview = {...placement,points:stationGeometry(position,placement.length,placement.heading)};
      else if (placement.start) {
        const end = snapped(position);
        preview = {...placement,points:trackGeometry(placement.start.point,end.point,placement.start.inside,end.inside)};
      }
      queueRepaint();
    }
  });
  canvas.addEventListener('pointerup',event => {
    if (down && !down.moving && placement) {
      try { place(mapPosition(mouse(event))); } catch (error) { tell(error.message); }
    }
    down = null;
  });
  canvas.addEventListener('pointercancel',() => { down = null; });
}
function snapped(point) {
  const items = [...world.stations,...world.tracks,...(activeDraft()?.items ?? [])];
  const candidates = items.filter(item => item.track === placement.track);
  const radius = Math.min(100,12/camera.zoom*Math.cos(point.lat*Math.PI/180));
  return closestEndpoint(point,candidates,radius) ?? {point};
}
function startPlacement(data) {
  placement = data;
  preview = null;
  updatePlacement();
}
function updatePlacement() {
  canvas.classList.toggle('placing',!!placement);
  hint.hidden = !placement;
  if (placement) {
    const message = placement.kind === 'station' ? 'Click the map to place the station.'
      : placement.start ? 'Click the track end point.' : 'Click the track start point.';
    hint.replaceChildren(div('row',message,action('Cancel',cancelPlacement)));
  }
  repaint();
}
function cancelPlacement() {
  placement = null;
  preview = null;
  if (world) updatePlacement();
}
function place(point) {
  const {start,...data} = placement;
  if (data.kind === 'track' && !start) {
    placement.start = snapped(point);
    updatePlacement();
    return;
  }
  const end = snapped(point);
  let geometry;
  if (data.kind === 'station') geometry = stationGeometry(point,data.length,data.heading);
  else {
    if (start.point.lat === end.point.lat && start.point.lon === end.point.lon) throw new Error('Choose two different points.');
    geometry = trackGeometry(start.point,end.point,start.inside,end.inside);
  }
  const project = activeDraft() ?? createProject();
  project.items.push({...data,id:crypto.randomUUID(),points:geometry});
  cancelPlacement();
  refresh('Build');
  refresh('Projects');
  tell(`Added to ${project.name}.`);
}
function createProject(name = `Project ${world.projects.length+1}`) {
  const project = {id:crypto.randomUUID(),name,items:[]};
  world.projects.push(project);
  selectedProject = project.id;
  return project;
}
function refresh(name) { windows.get(name)?.render(); }

const renderers = { Build:buildView,Projects:projectView,Trains:trainView,Stations:stationView,Routes:routeView,Map:mapView,Settings:settingsView };
let cancelToolDrag;
const toolBounds = () => ({width:viewport.clientWidth,height:viewport.clientHeight});
const toolRect = panel => ({
  x:panel.offsetLeft,y:panel.offsetTop,width:panel.offsetWidth,height:panel.offsetHeight,
});
function positionTool(panel, {x,y}) {
  panel.style.left = x+'px';
  panel.style.top = y+'px';
  panel.style.right = 'auto';
}
function limitToolResize() {
  if (cancelToolDrag) return;
  const panels = [...windows.values()].map(({panel}) => panel);
  const rects = panels.map(toolRect);
  const bounds = toolBounds();
  panels.forEach((panel,index) => {
    const rect = rects[index];
    let right = bounds.width;
    let bottom = bounds.height;
    for (const other of rects) {
      // Account for diagonal growth from the bottom-right resize handle.
      if (other.x >= rect.x+rect.width+toolGap && other.y+other.height+toolGap > rect.y) {
        right = Math.min(right,other.x-toolGap);
      }
      if (other.y >= rect.y+rect.height+toolGap &&
          other.x-toolGap < rect.x+rect.width && other.x+other.width+toolGap > rect.x) {
        bottom = Math.min(bottom,other.y-toolGap);
      }
    }
    panel.style.maxWidth = right-rect.x+'px';
    panel.style.maxHeight = bottom-rect.y+'px';
  });
}
const toolResize = new ResizeObserver(() => {
  if (windows.size) limitToolResize();
});
function closeTool(name) {
  const {panel} = windows.get(name);
  toolResize.unobserve(panel);
  panel.remove();
  windows.delete(name);
  if (windows.size) limitToolResize();
}
function fitTool(panel, occupied, bounds, preferred) {
  const {width,height} = toolRect(panel);
  const style = getComputedStyle(panel);
  const minimum = {width:parseFloat(style.minWidth),height:parseFloat(style.minHeight)};
  const position = findToolPosition({...preferred,width,height},minimum,occupied,bounds);
  if (!position) return null;
  panel.style.width = position.width+'px';
  panel.style.height = position.height+'px';
  positionTool(panel,position);
  return position;
}
function reflowTools() {
  cancelToolDrag?.();
  if (!windows.size) return;
  const bounds = toolBounds();
  const occupied = [];
  const overflow = [];
  for (const [name,{panel}] of windows) {
    const {x,y,width,height} = toolRect(panel);
    const preferred = {
      x:Math.max(0,Math.min(bounds.width-width,x)),
      y:Math.max(0,Math.min(bounds.height-height,y)),
    };
    const position = fitTool(panel,occupied,bounds,preferred);
    if (position) occupied.push(position);
    else overflow.push(name);
  }
  overflow.forEach(closeTool);
  limitToolResize();
  if (overflow.length) tell('Some tools closed because the window is too small.');
}
function openTool(name) {
  cancelToolDrag?.();
  if (windows.has(name)) {
    windows.get(name).panel.style.zIndex = ++zIndex;
    return;
  }
  const content = div('content stack');
  const panel = element('section',{class:'tool','aria-label':name});
  const state = {};
  const render = () => content.replaceChildren(...renderers[name](state,render));
  let settleAnimation;
  const settle = (target, fallback) => {
    const before = toolRect(panel);
    settleAnimation?.cancel();
    const occupied = [...windows.values()].filter(other => other.panel !== panel).map(other => toolRect(other.panel));
    const after = fitTool(panel,occupied,toolBounds(),target) ?? fallback;
    positionTool(panel,after);
    limitToolResize();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches ||
        (before.x === after.x && before.y === after.y && before.width === after.width && before.height === after.height)) return;
    settleAnimation = panel.animate([
      {
        transformOrigin:'top left',
        transform:`translate(${before.x-after.x}px,${before.y-after.y}px) scale(${before.width/after.width},${before.height/after.height})`,
      },
      {transformOrigin:'top left',transform:'none'},
    ],{duration:170,easing:'ease-out'});
  };
  const snap = side => {
    const current = toolRect(panel);
    settle({x:side === 'left' ? 16 : viewport.clientWidth-current.width-16,y:16},current);
  };
  const header = element('header',{},element('h2',{},name),div('row',
    action('Left',() => snap('left'),{title:'Snap left'}),
    action('Right',() => snap('right'),{title:'Snap right'}),
    action('×',() => closeTool(name),{label:`Close ${name}`})));
  panel.append(header,content);
  panel.style.zIndex = ++zIndex;
  panel.addEventListener('pointerdown',() => { panel.style.zIndex = ++zIndex; });
  let drag;
  header.addEventListener('pointerdown',event => {
    if (event.button !== 0 || cancelToolDrag || event.target.closest('button')) return;
    settleAnimation?.cancel();
    const origin = toolRect(panel);
    drag = {origin,x:event.clientX-origin.x,y:event.clientY-origin.y,id:event.pointerId};
    cancelToolDrag = () => {
      const {id} = drag;
      drag = null;
      cancelToolDrag = null;
      positionTool(panel,origin);
      if (header.hasPointerCapture(id)) header.releasePointerCapture(id);
      limitToolResize();
    };
    header.setPointerCapture(event.pointerId);
  });
  header.addEventListener('pointermove',event => {
    if (drag?.id !== event.pointerId) return;
    positionTool(panel,{
      x:Math.max(0,Math.min(viewport.clientWidth-drag.origin.width,event.clientX-drag.x)),
      y:Math.max(0,Math.min(viewport.clientHeight-drag.origin.height,event.clientY-drag.y)),
    });
  });
  header.addEventListener('pointerup',event => {
    if (drag?.id !== event.pointerId) return;
    const {origin} = drag;
    drag = null;
    cancelToolDrag = null;
    settle(toolRect(panel),origin);
  });
  header.addEventListener('lostpointercapture',event => {
    if (drag?.id === event.pointerId) cancelToolDrag();
  });
  viewport.append(panel);
  const occupied = [...windows.values()].map(({panel}) => toolRect(panel));
  if (!fitTool(panel,occupied,toolBounds(),toolRect(panel))) {
    panel.remove();
    tell('Close or move another tool to make room.');
    return;
  }
  windows.set(name,{panel,render});
  limitToolResize();
  toolResize.observe(panel);
  render();
}
function tabs(names, selected, change) {
  return div('tabs',names.map(name => action(name,() => change(name),{active:selected === name})));
}

function buildView(state, render) {
  const mode = state.mode ?? 'Track';
  const options = tabs(['Track','Station'],mode,value => { state.mode = value; cancelPlacement(); render(); });
  const project = select([['','Create a project on placement'],...world.projects.map(item => [item.id,item.name])],selectedProject);
  project.addEventListener('change',() => { selectedProject = project.value || undefined; repaint(); });
  const lanes = select([1,2,3,4,5,6],state.lanes ?? 1);
  const track = select([['standard','Standard gauge'],['narrow','Narrow gauge']],state.track);
  const power = select([['none','None'],['overhead','Overhead'],['third rail','Third rail']],state.power);
  const elevation = select([['surface','At grade'],['elevated','Elevated'],['tunnel','Tunnel']],state.elevation);
  const name = input('text',state.name ?? '',{maxlength:60});
  const length = input('number',state.length ?? 180,{min:30,max:1200});
  const heading = input('number',state.heading ?? 90,{min:0,max:359});
  const platforms = select([1,2,3,4,5,6,7,8,9,10,11,12],state.platforms ?? 1);
  function updatePlatforms() {
    const limit = Number(lanes.value)*2;
    for (const option of platforms.options) option.disabled = Number(option.value)>limit;
    if (Number(platforms.value)>limit) platforms.value = limit;
  }
  lanes.addEventListener('change',updatePlatforms);
  updatePlatforms();
  for (const [key,control] of Object.entries({lanes,track,power,elevation,name,length,heading,platforms})) {
    control.addEventListener('input',() => { state[key] = control.value; });
  }
  const extra = mode === 'Station'
    ? [field('Station name',name),field('Platforms',platforms),field('Length (m)',length),field('Heading (°)',heading)] : [];
  return [options,field('Project',project),div('fields',
    field('Parallel tracks',lanes),field('Track type',track),field('Electrification',power),field('Elevation',elevation),extra),
    action('Place on map',() => {
      const data = {kind:mode.toLowerCase(),lanes:Number(lanes.value),track:track.value,power:power.value,elevation:elevation.value};
      if (mode === 'Station') {
        if (!name.value.trim() || !length.value || !length.checkValidity() || !heading.value || !heading.checkValidity()) {
          throw new Error('Enter a name, a station length from 30 to 1,200 m, and a heading from 0 to 359°.');
        }
        Object.assign(data,{name:name.value.trim(),length:Number(length.value),heading:Number(heading.value),platforms:Number(platforms.value)});
      }
      startPlacement(data);
    },{primary:true})];
}
function projectView(state, render) {
  const name = input('text','',{placeholder:'Project name',maxlength:60});
  const rows = world.projects.map(item => div('entry',
    div('',element('strong',{},item.name),small(`${item.items.length} items`)),
    action('Details',() => {
      selectedProject = item.id;
      state.projectId = item.id;
      render();
      refresh('Build');
      repaint();
    })));
  const project = world.projects.find(item => item.id === state.projectId);
  if (!project) return [div('row',field('New project name',name),action('Create',() => {
    state.projectId = createProject(name.value.trim() || undefined).id;
    refresh('Build');
    render();
    repaint();
  },{primary:true})),rows.length ? div('stack',rows) : p('No projects yet. Place track or stations in Build to start one.')];
  const costs = projectCost(project);
  return [div('row',action('All projects',() => { state.projectId = null; render(); }),title(project.name)),
    ...project.items.map((item,index) => div('entry',div('',element('strong',{},item.name ?? `Track ${index+1}`),
      small(`${item.lanes} track(s) · ${item.elevation}`)),div('row',money.format(costs[index].cost),
      action('Remove',() => { project.items.splice(index,1); render(); repaint(); })))),
    p(`Total ${money.format(costs.reduce((sum,item) => sum+item.cost,0))}`),
    div('row',action('Build project',() => {
      const paid = buildProject(world,project.id);
      selectedProject = world.projects[0]?.id;
      state.projectId = null;
      refresh('Build');
      refresh('Stations');
      refresh('Routes');
      render();
      repaint();
      tell(`Project built for ${money.format(paid)}.`);
    },{primary:true,disabled:!project.items.length}),
    action('Discard draft',() => {
      if (!state.confirmDiscard) {
        state.confirmDiscard = project.id;
        render();
        return;
      }
      if (state.confirmDiscard !== project.id) {
        state.confirmDiscard = project.id;
        render();
        return;
      }
      world.projects = world.projects.filter(item => item.id !== project.id);
      if (selectedProject === project.id) selectedProject = world.projects[0]?.id;
      state.projectId = null;
      state.confirmDiscard = null;
      refresh('Build');
      render();
      repaint();
    }),
    state.confirmDiscard === project.id ? small('Click Discard draft again to remove it.') : null)];
}
function trainView(state, render) {
  const tab = state.tab ?? 'Buy';
  const nav = tabs(['Buy','Owned'],tab,value => { state.tab = value; render(); });
  if (tab === 'Owned') {
    const owned = world.fleet.map((unit,index) => {
      const model = catalog.find(item => item.id === unit.modelId);
      const routes = world.routes.filter(route => Object.values(route.services).some(service => service.unitId === unit.id));
      return div('entry',div('',element('strong',{},`${index+1}. ${model.name}`),
        small(`${unit.cars} cars · ${unit.cars*model.carLength} m · ${routes.map(route => route.name).join(', ') || 'No route assigned'}`)));
    });
    return [nav,...(owned.length ? owned : [p('No trainsets owned.')])];
  }
  return [nav,...catalog.map(model => {
    const cars = select(model.cars);
    const cost = small('');
    const update = () => { cost.textContent = `${money.format(model.price*Number(cars.value))} · ${Number(cars.value)*model.carLength} m`; };
    cars.addEventListener('change',update);
    update();
    return div('entry',div('',element('strong',{},model.name),
      small(`${model.track} gauge · ${model.power ?? 'diesel'} · ${model.speed} km/h`),cost),
      div('row',field('Cars',cars),action('Buy',() => {
        buyTrain(world,model.id,Number(cars.value));
        repaint();
        tell('Trainset added to your fleet.');
      })));
  })];
}
function stationView() {
  if (!world.stations.length) return [p('Build a project with stations to see them here.'),action('Open Build',() => openTool('Build'))];
  return world.stations.map(station => {
    const serving = world.routes.filter(route => servicePeriods.some(period => {
      const service = route.services[period.id];
      return service?.unitId && (service.stops ?? route.stops).includes(station.id);
    }));
    const models = new Set(schedules.filter(({route, service}) => (service.stops ?? route.stops).includes(station.id))
      .map(entry => entry.plan.model.name));
    return div('entry',div('',element('strong',{},station.name),
      small(`${station.platforms} platforms · ${station.length} m · ${station.track} gauge`),
      small(serving.map(route => route.name).join(', ') || 'No routes'),
      models.size ? small([...models].join(', ')) : null),
    action('Locate',() => { camera = {center:station.points[0],zoom:.18}; repaint(); }));
  });
}
function routeView(state, render) {
  if (!state.draft) {
    return [action('Create route',() => {
      state.draft = {id:crypto.randomUUID(),name:'',color:'#80d8bd',letter:'',shape:'Circle',type:'Regional',
        group:'',offset:0,loop:false,stops:[],services:{}};
      state.tab = 'Identity';
      render();
    },{primary:true}),
    ...world.routes.map(route => div('entry',div('',element('strong',{},`${route.letter ? route.letter+' · ' : ''}${route.name}`),
      small([route.type,route.group,`${route.stops.length} stops`].filter(Boolean).join(' · '))),
      action('Manage',() => { state.draft = structuredClone(route); state.tab = 'Stops'; render(); })))];
  }
  const draft = state.draft;
  const tab = state.tab ?? 'Identity';
  const back = action('All routes',() => { state.draft = null; render(); });
  const nav = tabs(['Identity','Stops','Service'],tab,value => { state.tab = value; render(); });
  const finish = action('Save route',() => {
    validateRoute(world,draft);
    const next = {...world,routes:[...world.routes.filter(route => route.id !== draft.id),draft]};
    schedules = compileServices(next);
    world.routes = next.routes;
    if (!world.colors.includes(draft.color)) world.colors.push(draft.color);
    state.draft = null;
    repaint();
    refresh('Stations');
    refresh('Trains');
    render();
    tell('Route saved.');
  },{primary:true});
  if (tab === 'Identity') {
    const name = input('text',draft.name,{maxlength:60});
    const letter = input('text',draft.letter,{maxlength:4});
    const color = input('color',draft.color);
    const shape = select(['Circle','Square','Diamond'],draft.shape);
    const type = select(['Regional','Intercity','Heavy Metro','Light Rail'],draft.type);
    const group = input('text',draft.group,{maxlength:40,placeholder:'Optional branch group'});
    const offset = input('number',draft.offset,{min:0,max:359});
    const colors = select([['','Choose a color'],...new Set(['#80d8bd','#efba5d','#ea888e','#93bafa','#c49ef5',...world.colors])]);
    colors.addEventListener('change',() => {
      if (colors.value) { color.value = colors.value; draft.color = color.value; }
    });
    for (const [key,control] of Object.entries({name,letter,color,shape,type,group,offset})) {
      control.addEventListener('input',() => { draft[key] = key === 'offset' ? Number(control.value) : control.value; });
    }
    return [back,nav,div('fields',field('Route name',name),field('Symbol text',letter),field('Symbol shape',shape),
      field('Service type',type),field('Saved and preset colors',colors),field('Custom color',color),
      field('Branch group',group),field('Departure offset (min)',offset)),finish];
  }
  if (tab === 'Stops') {
    const platform = (stationId,key,label) => {
      const station = world.stations.find(item => item.id === stationId);
      const values = [['','Any platform'],...Array.from({length:station?.platforms ?? 0},(_,i) => [i+1,i+1])];
      const control = select(values,draft[key]);
      control.addEventListener('change',() => { draft[key] = Number(control.value) || null; });
      return field(label,control);
    };
    return [back,nav,...stopEditor(draft.stops,render),
      toggle('Loop route',draft.loop,value => { draft.loop = value; render(); }),
      !draft.loop && draft.stops.length ? div('fields',platform(draft.stops[0],'firstPlatform','First terminus'),
        platform(draft.stops.at(-1),'lastPlatform','Last terminus')) : null,finish];
  }
  const periodSelect = select(servicePeriods.map(period => [period.id,period.name]),state.period ?? 'morning');
  periodSelect.addEventListener('change',() => { state.period = periodSelect.value; render(); });
  const service = draft.services[periodSelect.value] ??= {unitId:'',interval:15};
  const units = [['','No service'],...world.fleet.map((unit,index) => {
    const model = catalog.find(item => item.id === unit.modelId);
    return [unit.id,`${index+1}. ${model.name}, ${unit.cars} cars`];
  })];
  const train = select(units,service.unitId);
  const interval = input('number',service.interval,{min:1,max:360});
  train.addEventListener('change',() => { service.unitId = train.value; });
  interval.addEventListener('input',() => { service.interval = Number(interval.value); });
  return [back,nav,field('Operating period',periodSelect),div('fields',field('Trainset',train),field('Interval (min)',interval)),
    toggle('Use different stops for this period',!!service.stops,checked => {
      if (checked) service.stops = [...draft.stops];
      else delete service.stops;
      render();
    }),...(service.stops ? stopEditor(service.stops,render) : []),finish];
}
function stopEditor(stops, render) {
  const remaining = world.stations.filter(station => !stops.includes(station.id));
  const candidates = select([['','Select a station'],...remaining.map(station => [station.id,station.name])]);
  function move(index,delta) {
    [stops[index],stops[index+delta]] = [stops[index+delta],stops[index]];
    render();
  }
  return [
    ...stops.map((stationId,index) => {
      const station = world.stations.find(item => item.id === stationId);
      return div('entry',`${index+1}. ${station?.name ?? 'Missing station'}`,div('row',
        action('Up',() => move(index,-1),{disabled:index === 0}),
        action('Down',() => move(index,1),{disabled:index === stops.length-1}),
        action('Remove',() => { stops.splice(index,1); render(); })));
    }),
    div('row',field('Add stop',candidates),action('Add',() => {
      if (!candidates.value) throw new Error('Select a station.');
      stops.push(candidates.value);
      render();
    },{disabled:remaining.length === 0})),
  ];
}
function mapView() {
  const control = id => toggle(layerOptions[id],mapLayerEnabled(world.layers,id),value => {
    world.layers[id] = value;
    repaint();
  });
  const controls = Object.keys(layerOptions).filter(id => !boundaryLayers.includes(id)).map(control);
  const boundaries = element('fieldset',{class:'map-boundaries'},
    element('legend',{},'Boundaries'),
    div('stack',boundaryLayers.map(control),small('County and ZIP Code boundaries appear as you zoom in.')));
  const legend = div('map-legend',Object.values(landUseStyles).map(({label,color}) => {
    const swatch = element('span',{class:'map-swatch','aria-hidden':'true'});
    swatch.style.backgroundColor = color;
    return element('small',{},swatch,label);
  }));
  return [...controls,boundaries,legend];
}
function settingsView(state, render) {
  const appearance = select([['standard','Standard'],['contrast','High contrast']],document.documentElement.dataset.theme);
  appearance.addEventListener('change',() => {
    world.theme = appearance.value;
    document.documentElement.dataset.theme = appearance.value;
  });
  async function readSnapshots() {
    state.snapshots = await Promise.all(['auto','previous'].map(async type => ({type,snapshot:await saves.load(slot,type)})));
    if (world) render();
  }
  return [field('Appearance',appearance),action('Save game',async () => {
    await saves.save(slot,world);
    tell('Game saved.');
  },{primary:true}),action('Create autosave now',async () => {
    await saves.save(slot,world,'auto');
    await readSnapshots();
    tell('Autosave created.');
  }),action('View autosaves',readSnapshots),
  ...(state.snapshots ?? []).map(({type,snapshot}) => div('entry',
    div('',element('strong',{},type === 'auto' ? 'Latest autosave' : 'Previous autosave'),
      small(snapshot ? `${snapshot.name} · ${new Date(snapshot.savedAt).toLocaleString()}` : 'No snapshot')),
    snapshot ? action('Restore',() => {
      if (state.confirm !== type) { state.confirm = type; tell('Click Restore again to open this autosave.'); return; }
      startWorld(slot,snapshot);
      tell('Autosave opened.');
    }) : null))];
}

window.addEventListener('resize',() => {
  reflowTools();
  queueRepaint();
});
window.addEventListener('keydown',event => { if (event.key === 'Escape' && placement) cancelPlacement(); });
setInterval(() => {
  if (!world || !speed) return;
  world.clock += speed/10;
  repaint();
},100);
setInterval(() => {
  if (!world) return;
  saves.save(slot,world,'auto').catch(error => tell(error.message));
},45000);
home().catch(error => tell(error.message));
