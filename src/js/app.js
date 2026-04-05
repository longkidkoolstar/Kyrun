// ═══════════════════════════════════════════════════════════════
// KYRUN — Main Application Controller (Full Featured)
// ═══════════════════════════════════════════════════════════════

// ── Complete Key Code Map ────────────────────────────────────
const KEY_CODE_MAP = {
  1:'LButton',2:'RButton',3:'Cancel',4:'MButton',5:'XButton1',6:'XButton2',
  8:'Backspace',9:'Tab',12:'Clear',13:'Enter',16:'Shift',17:'Ctrl',18:'Alt',
  19:'Pause',20:'CapsLock',27:'Escape',32:'Space',33:'PgUp',34:'PgDn',
  35:'End',36:'Home',37:'Left',38:'Up',39:'Right',40:'Down',
  44:'PrtSc',45:'Insert',46:'Delete',
  48:'0',49:'1',50:'2',51:'3',52:'4',53:'5',54:'6',55:'7',56:'8',57:'9',
  65:'A',66:'B',67:'C',68:'D',69:'E',70:'F',71:'G',72:'H',73:'I',74:'J',
  75:'K',76:'L',77:'M',78:'N',79:'O',80:'P',81:'Q',82:'R',83:'S',84:'T',
  85:'U',86:'V',87:'W',88:'X',89:'Y',90:'Z',
  91:'Win',93:'Menu',
  96:'Num0',97:'Num1',98:'Num2',99:'Num3',100:'Num4',
  101:'Num5',102:'Num6',103:'Num7',104:'Num8',105:'Num9',
  106:'Num*',107:'Num+',109:'Num-',110:'Num.',111:'Num/',
  112:'F1',113:'F2',114:'F3',115:'F4',116:'F5',117:'F6',
  118:'F7',119:'F8',120:'F9',121:'F10',122:'F11',123:'F12',
  144:'NumLock',145:'ScrollLock',
  160:'LShift',161:'RShift',162:'LCtrl',163:'RCtrl',164:'LAlt',165:'RAlt',
  186:';',187:'=',188:',',189:'-',190:'.',191:'/',192:'`',
  219:'[',220:'\\',221:']',222:"'"
};

// ── State ────────────────────────────────────────────────────
const state = {
  currentProfile: 'Default',
  currentMacro: null,
  commands: [],
  selectedIndices: new Set(),
  clipboard: [],
  undoStack: [],
  redoStack: [],
  isRecording: false,
  isRunning: false,
  isAnonymous: false,
  macroSettings: { loop: false, loopCount: 0, bindKey: '', bindVk: 0, bindIsMouse: false, randomDelays: false },
  speedMultiplier: 1.0,
  currentView: 'editor',
  hasRobot: false,
  recordLastTime: 0,
  dragIndex: -1
};

// ── Helpers ──────────────────────────────────────────────────
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const getKeyName = c => KEY_CODE_MAP[c] || `Key${c}`;

/** querySelector('[data-path="..."]') breaks on paths with () or other special chars — compare in JS instead */
function findFileTreeItemByPath(relPath) {
  return [...document.querySelectorAll('.file-tree__item')].find(el => el.dataset.path === relPath);
}

function sanitizeMacroFilenameBase(name) {
  if (!name || typeof name !== 'string') return 'Imported';
  let s = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
  if (!s || s === '.' || s === '..') s = 'Imported';
  if (s.length > 100) s = s.slice(0, 100);
  return s;
}

function collectMacroRelPaths(items, out = []) {
  for (const it of items || []) {
    if (it.type === 'folder' && it.children) collectMacroRelPaths(it.children, out);
    else if (it.type === 'macro') out.push(it.path);
  }
  return out;
}

/** Avoid overwriting; Windows FS is case-insensitive — track lowercased names */
function pickUniqueKyrunFilename(base, reservedLowercaseSet) {
  const safe = sanitizeMacroFilenameBase(base);
  let candidate = `${safe}.kyrun`;
  let n = 0;
  while (reservedLowercaseSet.has(candidate.toLowerCase())) {
    n++;
    candidate = `${safe} (${n}).kyrun`;
  }
  reservedLowercaseSet.add(candidate.toLowerCase());
  return candidate;
}

/** Stable bind label for global shortcuts (Electron); avoids deprecated keyCode mismatches. */
function keyEventToBindLabel(e) {
  const code = e.code || '';
  const km = code.match(/^Key([A-Z])$/);
  if (km) return km[1];
  const dig = code.match(/^Digit([0-9])$/);
  if (dig) return dig[1];
  const np = code.match(/^Numpad([0-9])$/);
  if (np) return `Num${np[1]}`;
  const fk = code.match(/^F([1-9]|1[0-2])$/);
  if (fk) return `F${fk[1]}`;
  const codeMap = {
    Space: 'Space', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace',
    Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Pause: 'Pause', CapsLock: 'CapsLock', NumLock: 'NumLock', ScrollLock: 'ScrollLock',
    ShiftLeft: 'LShift', ShiftRight: 'RShift', ControlLeft: 'LCtrl', ControlRight: 'RCtrl',
    AltLeft: 'LAlt', AltRight: 'RAlt'
  };
  if (codeMap[code]) return codeMap[code];
  return getKeyName(e.keyCode);
}

function showToast(msg, type='info') {
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = msg;
  $('#toast-container').appendChild(t);
  setTimeout(() => { t.style.opacity='0'; setTimeout(()=>t.remove(),300); }, 3000);
}

function showModal(title, bodyHTML, buttons=[]) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHTML;
  const f = $('#modal-footer'); f.innerHTML = '';
  buttons.forEach(b => {
    const btn = document.createElement('button');
    btn.className = `btn btn--${b.type||'secondary'}`;
    btn.textContent = b.label;
    btn.onclick = () => { b.action(); hideModal(); };
    f.appendChild(btn);
  });
  $('#modal-overlay').classList.add('modal-overlay--visible');
  // Auto-focus first input
  setTimeout(() => { const inp = $('#modal-body input'); if(inp) inp.focus(); }, 100);
}
function hideModal() { $('#modal-overlay').classList.remove('modal-overlay--visible'); }

// ── Profiles ─────────────────────────────────────────────────
async function loadProfiles() {
  try {
    const profiles = await window.kyrun.getProfiles();
    const dd = $('#profile-dropdown');
    dd.innerHTML = '';
    profiles.forEach(p => {
      const o = document.createElement('option');
      o.value = p; o.textContent = p;
      if (p === state.currentProfile) o.selected = true;
      dd.appendChild(o);
    });
  } catch {}
  $('#statusbar-profile').textContent = state.currentProfile;
}

async function loadFileTree() {
  let macros;
  try { macros = await window.kyrun.getProfileMacros(state.currentProfile); }
  catch { macros = []; }
  renderFileTree(macros);
}

function renderFileTree(items, container=null, depth=0) {
  const tree = container || $('#file-tree');
  if (!container) tree.innerHTML = '';
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = `file-tree__item ${item.type==='folder'?'file-tree__item--folder':''}`;
    el.style.paddingLeft = `${14+depth*16}px`;
    el.dataset.path = item.path; el.dataset.type = item.type;
    if (item.type === 'folder') {
      el.innerHTML = `<span class="file-tree__icon file-tree__icon--arrow">▶</span><span class="file-tree__icon file-tree__icon--folder">📁</span><span class="file-tree__name">${item.name}</span>`;
      el.onclick = e => { e.stopPropagation(); const a=el.querySelector('.file-tree__icon--arrow'),c=el.nextElementSibling; if(c&&c.classList.contains('file-tree__children')){c.classList.toggle('hidden');a.classList.toggle('expanded');} };
      tree.appendChild(el);
      if (item.children && item.children.length) { const d=document.createElement('div'); d.className='file-tree__children'; renderFileTree(item.children,d,depth+1); tree.appendChild(d); }
    } else {
      el.innerHTML = `<span class="file-tree__icon file-tree__icon--macro">⚡</span><span class="file-tree__name">${item.name}</span>`;
      el.onclick = () => openMacro(item);
      el.oncontextmenu = e => showFileContextMenu(e, item);
      tree.appendChild(el);
    }
  });
}

// ── Macro Open/Save ──────────────────────────────────────────
async function openMacro(item) {
  $$('.file-tree__item--active').forEach(e=>e.classList.remove('file-tree__item--active'));
  const el = findFileTreeItemByPath(item.path);
  if (el) el.classList.add('file-tree__item--active');
  let data;
  try {
    const raw = await window.kyrun.readMacroFile(item.path);
    data = raw ? JSON.parse(raw) : null;
    if (!data) data = { name: item.name, commands: [], settings: {} };
  } catch { data = { name: item.name, commands: [], settings: {} }; }
  state.currentMacro = { name: data.name||item.name, path: item.path, dirty: false };
  state.commands = data.commands || [];
  state.macroSettings = { loop:false, loopCount:0, bindKey:'', bindVk:0, bindIsMouse:false, randomDelays:false, ...data.settings };
  state.selectedIndices.clear(); state.undoStack=[]; state.redoStack=[];
  $('#welcome-view').classList.add('hidden');
  $('#settings-view').classList.remove('settings-view--visible');
  $('#editor-content').classList.remove('hidden');
  state.currentView = 'editor';
  updateMacroSettings();
  $('#selected-command-props').classList.add('hidden');
  $('#command-props-content').innerHTML = '';
  renderCommands(); updateStatusBar();
}

async function saveMacro(opts = {}) {
  const silent = opts.silent === true;
  if (!state.currentMacro) return;
  const data = { name:state.currentMacro.name, version:'1.0', commands:state.commands, settings:state.macroSettings };
  try {
    await window.kyrun.saveMacroFile(state.currentMacro.path, JSON.stringify(data,null,2));
    state.currentMacro.dirty=false;
    if (!silent) showToast('Macro saved','success');
    await reloadProfileTriggers(); // Re-apply binds!
  }
  catch { if (!silent) showToast('Save failed','error'); }
  updateStatusBar();
}

// ── Command Rendering ────────────────────────────────────────
function renderCommands() {
  const body = $('#command-list-body'), empty = $('#command-empty');
  if (state.commands.length === 0) { body.innerHTML=''; body.appendChild(empty); empty.classList.remove('hidden'); updateStatusBar(); return; }
  empty.classList.add('hidden'); body.innerHTML='';
  state.commands.forEach((cmd, i) => {
    const row = document.createElement('div');
    row.className = 'command-row';
    if (state.selectedIndices.has(i)) row.classList.add('command-row--selected');
    if (cmd.breakpoint) row.classList.add('command-row--breakpoint');
    row.dataset.index = i;
    row.draggable = true;
    const tc = getTypeClass(cmd.type), params = formatParams(cmd);
    const timing = cmd.type === 'Delay' ? `${cmd.value} ms`
      : cmd.type === 'RandomDelay' ? `from ${cmd.min} to ${cmd.max} ms` : '';
    const typeShown = cmd.type === 'RandomDelay' ? 'Delay' : cmd.type;
    row.innerHTML = `<span class="command-row__num">${i+1}</span><span class="command-row__breakpoint ${cmd.breakpoint?'command-row__breakpoint--active':''}" data-bp="${i}"></span><span class="command-row__type ${tc}">${typeShown}</span><span class="command-row__params">${params}</span><span class="command-row__delay">${timing}</span>`;
    row.onclick = e => selectCommand(i,e);
    row.ondblclick = () => showCommandProperties(i);
    row.oncontextmenu = e => showCommandContextMenu(e,i);
    row.querySelector('[data-bp]').onclick = e => { e.stopPropagation(); toggleBreakpoint(i); };
    // Drag and drop
    row.ondragstart = e => { state.dragIndex=i; e.dataTransfer.effectAllowed='move'; row.style.opacity='0.4'; };
    row.ondragend = () => { row.style.opacity='1'; state.dragIndex=-1; };
    row.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect='move'; row.style.borderTop='2px solid var(--accent-primary)'; };
    row.ondragleave = () => { row.style.borderTop=''; };
    row.ondrop = e => { e.preventDefault(); row.style.borderTop=''; const from=state.dragIndex, to=i; if(from!==to&&from>=0){pushUndo();const c=state.commands.splice(from,1)[0];state.commands.splice(to>from?to-1:to,0,c);state.selectedIndices.clear();state.selectedIndices.add(to>from?to-1:to);state.currentMacro.dirty=true;renderCommands();} };
    body.appendChild(row);
  });
  if (state.selectedIndices.size) {
    const hi = Math.max(...state.selectedIndices);
    const r = body.querySelector(`.command-row[data-index="${hi}"]`);
    if (r) try { r.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { r.scrollIntoView(); }
  }
  updateKeyboardViz(); updateStatusBar();
}

function getTypeClass(t) {
  const m = { KeyDown:'command-row__type--keydown',KeyUp:'command-row__type--keyup',LeftDown:'command-row__type--mousedown',LeftUp:'command-row__type--mouseup',RightDown:'command-row__type--mousedown',RightUp:'command-row__type--mouseup',MiddleDown:'command-row__type--mousedown',MiddleUp:'command-row__type--mouseup',XButton1Down:'command-row__type--mousedown',XButton1Up:'command-row__type--mouseup',XButton2Down:'command-row__type--mousedown',XButton2Up:'command-row__type--mouseup',ScrollUp:'command-row__type--mousemove',ScrollDown:'command-row__type--mousemove',Delay:'command-row__type--delay',RandomDelay:'command-row__type--delay',GoTo:'command-row__type--goto',GoWhile:'command-row__type--loop',Comment:'command-row__type--comment',Variable:'command-row__type--variable',ColorDetect:'command-row__type--color',MouseMove:'command-row__type--mousemove'};
  return m[t]||'';
}

function formatParams(cmd) {
  switch(cmd.type) {
    case 'KeyDown': case 'KeyUp': return `Key: ${getKeyName(cmd.keyCode)} (${cmd.keyCode})`;
    case 'LeftDown': return 'Left Mouse ↓'; case 'LeftUp': return 'Left Mouse ↑';
    case 'RightDown': return 'Right Mouse ↓'; case 'RightUp': return 'Right Mouse ↑';
    case 'MiddleDown': return 'Middle Mouse ↓'; case 'MiddleUp': return 'Middle Mouse ↑';
    case 'XButton1Down': return 'Side Button 1 ↓'; case 'XButton1Up': return 'Side Button 1 ↑';
    case 'XButton2Down': return 'Side Button 2 ↓'; case 'XButton2Up': return 'Side Button 2 ↑';
    case 'ScrollUp': return `Scroll Up ×${cmd.value||3}`; case 'ScrollDown': return `Scroll Down ×${cmd.value||3}`;
    case 'Delay': return `Wait ${cmd.value} ms`;
    case 'RandomDelay': return `Wait from ${cmd.min} to ${cmd.max} ms`;
    case 'MouseMove': return `Move to (${cmd.x}, ${cmd.y})`; case 'GoTo': return `Jump to line ${cmd.targetLine}`;
    case 'GoWhile': return `Loop from line ${cmd.startLine}, ${cmd.count}×`;
    case 'Comment': return `// ${cmd.value}`; case 'ColorDetect': return `Check (${cmd.x},${cmd.y}) #${cmd.color}`;
    case 'Variable': return `${cmd.varName} ${cmd.operation} ${cmd.varValue}`;
    default: return JSON.stringify(cmd);
  }
}

// ── Selection / Editing ──────────────────────────────────────
function selectCommand(i,e) {
  if (e&&e.ctrlKey) { state.selectedIndices.has(i)?state.selectedIndices.delete(i):state.selectedIndices.add(i); }
  else if (e&&e.shiftKey&&state.selectedIndices.size>0) { const l=Math.max(...state.selectedIndices),s=Math.min(l,i),en=Math.max(l,i); for(let j=s;j<=en;j++) state.selectedIndices.add(j); }
  else { state.selectedIndices.clear(); state.selectedIndices.add(i); }
  renderCommands(); showCommandProperties(i);
}

function showCommandProperties(idx) {
  const cmd = state.commands[idx]; if(!cmd) return;
  const panel=$('#selected-command-props'), content=$('#command-props-content');
  panel.classList.remove('hidden');
  let html = '';
  const field = (label,prop,type='number',val) => `<div class="properties-panel__field"><label class="properties-panel__label">${label}</label><input type="${type}" class="properties-panel__input" value="${val!==undefined?val:cmd[prop]}" data-prop="${prop}" data-idx="${idx}" ${type==='number'?'min="0"':''}></div>`;
  switch(cmd.type) {
    case 'KeyDown': case 'KeyUp':
      html = field('Key Code','keyCode','number') + `<div class="properties-panel__field"><label class="properties-panel__label">Key: ${getKeyName(cmd.keyCode)}</label></div>`; break;
    case 'Delay': case 'RandomDelay': {
      const isR = cmd.type === 'RandomDelay';
      const fv = cmd.value != null ? cmd.value : 100;
      const mn = cmd.min != null ? cmd.min : 50;
      const mx = cmd.max != null ? cmd.max : 150;
      html = `<div class="properties-panel__field"><label class="properties-panel__label" style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="delay-random-toggle" data-idx="${idx}" ${isR ? 'checked' : ''}> Random delay (min–max ms, Keyran-style)</label></div>`;
      html += `<div id="delay-fields-fixed" style="display:${isR ? 'none' : 'block'}">${field('Duration (ms)','value','number', fv)}</div>`;
      html += `<div id="delay-fields-random" style="display:${isR ? 'block' : 'none'}">${field('Min (ms)','min','number', mn)}${field('Max (ms)','max','number', mx)}</div>`;
      break;
    }
    case 'MouseMove': html = field('X','x','number') + field('Y','y','number') + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-coords">📍 Pick from Screen</button>`; break;
    case 'GoTo': html = field('Target Line','targetLine','number'); break;
    case 'GoWhile': html = field('Start Line','startLine','number') + field('Loop Count','count','number'); break;
    case 'Comment': html = field('Comment','value','text'); break;
    case 'ScrollUp': case 'ScrollDown': html = field('Scroll Amount','value','number'); break;
    case 'ColorDetect': html = field('X','x','number') + field('Y','y','number') + field('Color (hex)','color','text') + field('Tolerance','tolerance','number') + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-color">🎨 Pick from Screen</button>`; break;
    case 'Variable': html = field('Name','varName','text') + `<select class="properties-panel__select" data-prop="operation" data-idx="${idx}" style="width:100%;margin-bottom:8px"><option ${cmd.operation==='='?'selected':''} value="=">=</option><option ${cmd.operation==='+='?'selected':''} value="+=">+=</option><option ${cmd.operation==='-='?'selected':''} value="-=">-=</option></select>` + field('Value','varValue','number'); break;
    default: html = `<p style="color:var(--text-tertiary);font-size:12px;">No editable properties</p>`;
  }
  content.innerHTML = html;
  content.querySelectorAll('input[data-prop],select[data-prop]').forEach(inp => {
    inp.addEventListener('change', e => {
      const i=parseInt(e.target.dataset.idx,10), prop=e.target.dataset.prop;
      const val = e.target.type==='number'?parseInt(e.target.value,10):e.target.value;
      pushUndo(); state.commands[i][prop]=val; state.currentMacro.dirty=true; renderCommands(); showCommandProperties(i);
    });
  });
  const delayRandToggle = document.getElementById('delay-random-toggle');
  if (delayRandToggle) {
    delayRandToggle.addEventListener('change', () => {
      const i = parseInt(delayRandToggle.dataset.idx, 10);
      const c = state.commands[i];
      if (!c) return;
      pushUndo();
      if (delayRandToggle.checked) {
        const base = c.type === 'Delay' ? (c.value != null ? c.value : 100) : (c.min != null ? c.min : 50);
        const hi = c.type === 'Delay' ? base + 10 : (c.max != null ? c.max : 150);
        state.commands[i] = { type: 'RandomDelay', min: Math.min(base, hi), max: Math.max(base, hi) };
      } else {
        const v = c.type === 'RandomDelay' ? (c.min != null ? c.min : 100) : (c.value != null ? c.value : 100);
        state.commands[i] = { type: 'Delay', value: v };
      }
      state.currentMacro.dirty = true;
      renderCommands();
      state.selectedIndices.clear(); state.selectedIndices.add(i);
      showCommandProperties(i);
    });
  }
  // Coordinate picker
  const pickBtn = document.getElementById('btn-pick-coords');
  if (pickBtn) pickBtn.onclick = async () => {
    try { const pos = await window.kyrun.getMousePosition(); pushUndo(); state.commands[idx].x=pos.x; state.commands[idx].y=pos.y; state.currentMacro.dirty=true; renderCommands(); showCommandProperties(idx); showToast(`Coords: ${pos.x}, ${pos.y}`,'success'); } catch {}
  };
  // Color picker
  const colorBtn = document.getElementById('btn-pick-color');
  if (colorBtn) colorBtn.onclick = async () => {
    try { const pos = await window.kyrun.getMousePosition(); const col = await window.kyrun.getPixelColor(pos.x,pos.y); pushUndo(); state.commands[idx].x=pos.x; state.commands[idx].y=pos.y; state.commands[idx].color=col; state.currentMacro.dirty=true; renderCommands(); showCommandProperties(idx); showToast(`Color: #${col} at ${pos.x},${pos.y}`,'success'); } catch {}
  };
}

// ── Add Command ──────────────────────────────────────────────
function addCommand(type) {
  if (!state.currentMacro) { showToast('Open or create a macro first', 'error'); return; }
  pushUndo();
  const insertAt = state.selectedIndices.size>0 ? Math.max(...state.selectedIndices)+1 : state.commands.length;
  let cmd;
  switch(type) {
    case 'KeyDown': cmd={type,keyCode:65,device:1}; break;
    case 'KeyUp': cmd={type,keyCode:65,device:1}; break;
    case 'LeftDown': case 'LeftUp': case 'RightDown': case 'RightUp':
    case 'MiddleDown': case 'MiddleUp':
    case 'XButton1Down': case 'XButton1Up': case 'XButton2Down': case 'XButton2Up':
      cmd={type}; break;
    case 'ScrollUp': case 'ScrollDown': cmd={type,value:3}; break;
    case 'Delay': cmd={type,value:100}; break;
    case 'RandomDelay': cmd={type,min:50,max:150}; break;
    case 'MouseMove': cmd={type,x:0,y:0}; break;
    case 'GoTo': cmd={type,targetLine:1}; break;
    case 'GoWhile': cmd={type,startLine:1,count:10}; break;
    case 'Comment': cmd={type,value:'Comment'}; break;
    case 'ColorDetect': cmd={type,x:0,y:0,color:'FF0000',tolerance:10}; break;
    case 'Variable': cmd={type,varName:'var1',operation:'=',varValue:0}; break;
    default: cmd={type}; break;
  }
  state.commands.splice(insertAt,0,cmd);
  state.currentMacro.dirty=true;
  state.selectedIndices.clear(); state.selectedIndices.add(insertAt);
  renderCommands(); showCommandProperties(insertAt);
}

// ── Undo/Redo ────────────────────────────────────────────────
function pushUndo() { state.undoStack.push(JSON.parse(JSON.stringify(state.commands))); if(state.undoStack.length>50)state.undoStack.shift(); state.redoStack=[]; }
function undo() { if(!state.undoStack.length)return; state.redoStack.push(JSON.parse(JSON.stringify(state.commands))); state.commands=state.undoStack.pop(); state.currentMacro.dirty=true; renderCommands(); }
function redo() { if(!state.redoStack.length)return; state.undoStack.push(JSON.parse(JSON.stringify(state.commands))); state.commands=state.redoStack.pop(); state.currentMacro.dirty=true; renderCommands(); }

// ── Cut/Copy/Paste/Delete/Move ───────────────────────────────
function cutSelected() { if(!state.selectedIndices.size)return; pushUndo(); state.clipboard=[...state.selectedIndices].sort((a,b)=>a-b).map(i=>({...state.commands[i]})); deleteSelectedInternal(); renderCommands(); }
function copySelected() { if(!state.selectedIndices.size)return; state.clipboard=[...state.selectedIndices].sort((a,b)=>a-b).map(i=>JSON.parse(JSON.stringify(state.commands[i]))); showToast(`Copied ${state.clipboard.length} command(s)`,'info'); }
function pasteCommands() { if(!state.clipboard.length)return; pushUndo(); const at=state.selectedIndices.size>0?Math.max(...state.selectedIndices)+1:state.commands.length; const c=state.clipboard.map(x=>JSON.parse(JSON.stringify(x))); state.commands.splice(at,0,...c); state.currentMacro.dirty=true; state.selectedIndices.clear(); c.forEach((_,j)=>state.selectedIndices.add(at+j)); renderCommands(); }
function deleteSelected() { if(!state.selectedIndices.size)return; pushUndo(); deleteSelectedInternal(); renderCommands(); }
function deleteSelectedInternal() { [...state.selectedIndices].sort((a,b)=>b-a).forEach(i=>state.commands.splice(i,1)); state.selectedIndices.clear(); state.currentMacro.dirty=true; }
function moveSelected(dir) { if(state.selectedIndices.size!==1)return; const i=[...state.selectedIndices][0],n=i+dir; if(n<0||n>=state.commands.length)return; pushUndo(); [state.commands[i],state.commands[n]]=[state.commands[n],state.commands[i]]; state.selectedIndices.clear(); state.selectedIndices.add(n); state.currentMacro.dirty=true; renderCommands(); }
function toggleBreakpoint(i) { state.commands[i].breakpoint=!state.commands[i].breakpoint; renderCommands(); }

// ── Recording ────────────────────────────────────────────────
function startRecording() {
  if (!state.currentMacro) { showToast('Open a macro first','error'); return; }
  state.isRecording = true;
  state.recordLastTime = Date.now();
  pushUndo();
  $('#btn-record').classList.add('toolbar__btn--active');
  $('#btn-record').innerHTML = '<span class="toolbar__btn-icon" style="color:#ef4444">⏺</span> Stop Rec';
  showToast('Recording... Press keys and click mouse. Press Escape or click Stop Rec to finish.','info');
  document.addEventListener('keydown', recordKeyHandler, true);
  document.addEventListener('keyup', recordKeyUpHandler, true);
  document.addEventListener('mousedown', recordMouseHandler, true);
  document.addEventListener('mouseup', recordMouseUpHandler, true);
  document.addEventListener('wheel', recordWheelHandler, true);
}

function stopRecording() {
  state.isRecording = false;
  $('#btn-record').classList.remove('toolbar__btn--active');
  $('#btn-record').innerHTML = '<span class="toolbar__btn-icon">⏺</span> Record';
  document.removeEventListener('keydown', recordKeyHandler, true);
  document.removeEventListener('keyup', recordKeyUpHandler, true);
  document.removeEventListener('mousedown', recordMouseHandler, true);
  document.removeEventListener('mouseup', recordMouseUpHandler, true);
  document.removeEventListener('wheel', recordWheelHandler, true);
  state.currentMacro.dirty = true;
  renderCommands();
  showToast(`Recorded ${state.commands.length} commands`,'success');
}

function addRecordDelay() {
  const now = Date.now();
  const elapsed = now - state.recordLastTime;
  state.recordLastTime = now;
  if (elapsed > 5) state.commands.push({ type:'Delay', value: Math.max(1, elapsed) });
}

function recordKeyHandler(e) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopRecording(); return; }
  // Ignore if typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  e.preventDefault(); e.stopPropagation();
  addRecordDelay();
  state.commands.push({ type:'KeyDown', keyCode: e.keyCode, device:1 });
  renderCommands();
}

function recordKeyUpHandler(e) {
  if (!state.isRecording) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  e.preventDefault(); e.stopPropagation();
  addRecordDelay();
  state.commands.push({ type:'KeyUp', keyCode: e.keyCode, device:1 });
  renderCommands();
}

function recordMouseHandler(e) {
  if (!state.isRecording) return;
  // Don't record clicks on the toolbar/sidebar
  if (e.target.closest('.toolbar') || e.target.closest('.sidebar') || e.target.closest('.properties-panel') || e.target.closest('.statusbar') || e.target.closest('.titlebar')) return;
  e.preventDefault(); e.stopPropagation();
  addRecordDelay();
  switch(e.button) {
    case 0: state.commands.push({type:'LeftDown'}); break;
    case 1: state.commands.push({type:'MiddleDown'}); break;
    case 2: state.commands.push({type:'RightDown'}); break;
    case 3: state.commands.push({type:'XButton1Down'}); break;
    case 4: state.commands.push({type:'XButton2Down'}); break;
  }
  renderCommands();
}

function recordMouseUpHandler(e) {
  if (!state.isRecording) return;
  if (e.target.closest('.toolbar') || e.target.closest('.sidebar') || e.target.closest('.properties-panel') || e.target.closest('.statusbar') || e.target.closest('.titlebar')) return;
  e.preventDefault(); e.stopPropagation();
  addRecordDelay();
  switch(e.button) {
    case 0: state.commands.push({type:'LeftUp'}); break;
    case 1: state.commands.push({type:'MiddleUp'}); break;
    case 2: state.commands.push({type:'RightUp'}); break;
    case 3: state.commands.push({type:'XButton1Up'}); break;
    case 4: state.commands.push({type:'XButton2Up'}); break;
  }
  renderCommands();
}

function recordWheelHandler(e) {
  if (!state.isRecording) return;
  if (e.target.closest('.toolbar') || e.target.closest('.sidebar') || e.target.closest('.properties-panel')) return;
  e.preventDefault(); e.stopPropagation();
  addRecordDelay();
  state.commands.push({ type: e.deltaY<0?'ScrollUp':'ScrollDown', value:3 });
  renderCommands();
}

// ── Macro Execution ──────────────────────────────────────────
async function runMacro() {
  if (!state.currentMacro || !state.commands.length) { showToast('No macro to run','error'); return; }
  if (state.isRunning) { stopMacro(); return; }
  state.isRunning = true;
  updateRunningUI(true);
  try {
    const settings = { ...state.macroSettings, speedMultiplier: state.speedMultiplier };
    const result = await window.kyrun.executeMacro(state.commands, settings);
    if (!result.success) showToast(result.error||'Execution failed','error');
  } catch(e) { showToast('Input module not available','error'); }
  state.isRunning = false;
  updateRunningUI(false);
}

async function stopMacro() {
  try { await window.kyrun.stopMacro(); } catch {}
  state.isRunning = false;
  updateRunningUI(false);
}

function updateRunningUI(running) {
  const dot = $('#macro-dot'), text = $('#macro-status-text');
  if (running) {
    dot.className='titlebar__status-dot titlebar__status-dot--active';
    text.textContent='Running';
    $('#btn-play').innerHTML='<span class="toolbar__btn-icon">⏸</span> Pause';
  } else {
    dot.className='titlebar__status-dot titlebar__status-dot--inactive';
    text.textContent='Stopped';
    $('#btn-play').innerHTML='<span class="toolbar__btn-icon">▶</span> Run';
    $$('.command-row--executing').forEach(r=>r.classList.remove('command-row--executing'));
  }
}

// ── .amc/.krm Import/Export ──────────────────────────────────

// Keyran-specific indices → Windows VK (when file uses Keyran numbering, not HID / not raw VK)
const KEYRAN_TO_VK = {
  1:1, 2:2, 4:4, // L, R, M mouse
  8:8, 9:9, 13:13, 16:16, 17:17, 18:18, // Backspace, Tab, Enter, Shift, Ctrl, Alt
  20:81, // q
  22:83, // s
  26:87, // w
  27:27, 32:32, 33:33, 34:34, 35:35, 36:36, 37:37, 38:38, 39:39, 40:40, // Esc, Space, PgUp, PgDn, End, Home, Arrows
  45:45, 46:46, // Ins, Del
  48:48, 49:49, 50:50, 51:51, 52:52, 53:53, 54:54, 55:55, 56:56, 57:57, // 0-9
  65:65, 66:66, 67:67, 68:68, 69:69, 70:70, 71:71, 72:72, 73:73, 74:74, 75:75, 76:76, 77:77, // a-m
  78:78, 79:79, 80:80, 81:81, 82:82, 83:83, 84:84, 85:85, 86:86, 87:87, 88:88, 89:89, 90:90, // n-z
  96:96, 97:97, 98:98, 99:99, 100:100, 101:101, 102:102, 103:103, 104:104, 105:105, // Numpad
  112:112, 113:113, 114:114, 115:115, 116:116, 117:117, 118:118, 119:119, 120:120, 121:121, 122:122, 123:123, // F1-F12
  225:16 // Keyran extended shift → VK_SHIFT
};

/**
 * USB HID keyboard usage IDs (decimal) → Windows VK.
 * Many .amc exports (mouse software, some games) store HID usages: 8=E, 9=F — same numbers Keyran uses for Backspace/Tab.
 */
function hidKeyboardUsageToVk(u) {
  if (u <= 0) return null;
  // Letters a–z: HID 4–29 → VK A–Z
  if (u >= 4 && u <= 29) return 65 + (u - 4);
  // Row 1–0: HID 30–39
  if (u >= 30 && u <= 38) return 49 + (u - 30); // 1..9
  if (u === 39) return 48; // 0
  // HID 40–46 → Enter, Esc, Backspace, Tab, Space (USB HID 0x28–0x2E)
  if (u === 40) return 13; // Enter
  if (u === 41) return 27; // Escape
  if (u === 42) return 8; // Backspace
  if (u === 43) return 9; // Tab
  if (u === 44) return 32; // Space
  if (u === 45) return 189; // -_
  if (u === 46) return 187; // =+
  // 47–56: [ ] \ ; ' ` , . /
  const misc47 = { 47:219,48:221,49:220,50:186,51:222,52:192,53:188,54:190,55:191 };
  if (misc47[u]) return misc47[u];
  if (u === 57) return 20; // CapsLock
  // F1–F12: HID 58–69
  if (u >= 58 && u <= 69) return 112 + (u - 58);
  // Nav cluster: 70–83 approx (PrintScreen, ScrollLock, Pause, Insert, Home, etc.) — partial
  if (u === 73) return 45; // Insert
  if (u === 74) return 36; // Home
  if (u === 75) return 33; // PageUp
  if (u === 76) return 46; // Delete
  if (u === 77) return 35; // End
  if (u === 78) return 34; // PageDown
  if (u === 79) return 39; // Right
  if (u === 80) return 37; // Left
  if (u === 81) return 40; // Down
  if (u === 82) return 38; // Up
  // Numpad 1–9: HID 89–97, Numpad 0: 98
  if (u >= 89 && u <= 97) return 97 + (u - 89); // VK_NUMPAD1 = 97 … NUMPAD9 = 105
  if (u === 98) return 96; // Numpad 0
  // Left/right modifiers (common in macro tools, decimal 224–231)
  if (u === 224) return 162; // Left Ctrl
  if (u === 225) return 160; // Left Shift
  if (u === 226) return 164; // Left Alt
  if (u === 227) return 91; // Left Win
  if (u === 228) return 163; // Right Ctrl
  if (u === 229) return 161; // Right Shift
  if (u === 230) return 165; // Right Alt
  if (u === 231) return 92; // Right Win
  return null;
}

function keyranIndexToVk(raw) {
  return KEYRAN_TO_VK[raw] !== undefined ? KEYRAN_TO_VK[raw] : raw;
}

function collectRawKeyCodesFromSyntax(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p.length >= 2 && /^(KeyDown|KeyUp)$/i.test(p[0])) {
      const n = parseInt(p[1], 10);
      if (!isNaN(n)) out.push(n);
    }
  }
  return out;
}

/** Choose HID vs Keyran table: HID 8,9 = E,F; Keyran 8,9 = Backspace,Tab — same numbers, different meaning. */
function detectImportKeyCodec(rawCodes) {
  const uniq = [...new Set(rawCodes)].filter(c => c > 0);
  if (uniq.length === 0) return 'keyran';
  // File already stores Windows VK codes (65–90 letters)
  if (uniq.some(c => c >= 65 && c <= 90)) return 'keyran';
  // Keyran index 27 = Escape (VK 27); HID usage 27 = X — lone 27 must stay Keyran for Esc macros
  if (uniq.length === 1 && uniq[0] === 27) return 'keyran';

  let hidLetter = 0, krLetter = 0;
  for (const raw of uniq) {
    const h = hidKeyboardUsageToVk(raw);
    const k = keyranIndexToVk(raw);
    if (h >= 65 && h <= 90) hidLetter++;
    if (k >= 65 && k <= 90) krLetter++;
  }
  if (hidLetter > krLetter) return 'hid';
  if (krLetter > hidLetter) return 'keyran';
  if (uniq.includes(8) && uniq.includes(9)) return 'hid';
  // Tie: do NOT map lone 8/9 to Keyran — that turns USB E/F into Backspace/Tab. Prefer HID (typical Keyran .amc export).
  return 'hid';
}

function importRawKeyCodeToVk(raw, codec) {
  if (codec === 'hid') {
    const h = hidKeyboardUsageToVk(raw);
    if (h != null) return h;
  }
  return keyranIndexToVk(raw);
}

// Parse Keyran syntax lines into command array
function parseSyntaxLines(text, codec = 'keyran') {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const commands = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0].replace(/;+$/g, '').toLowerCase();
    switch(cmd) {
      case 'keydown': {
        const raw = parseInt(parts[1])||0;
        commands.push({type:'KeyDown',keyCode:importRawKeyCodeToVk(raw, codec),device:parseInt(parts[2])||1});
        break;
      }
      case 'keyup': {
        const raw = parseInt(parts[1])||0;
        commands.push({type:'KeyUp',keyCode:importRawKeyCodeToVk(raw, codec),device:parseInt(parts[2])||1});
        break;
      }
      case 'leftdown': commands.push({type:'LeftDown'}); break;
      case 'leftup': commands.push({type:'LeftUp'}); break;
      case 'rightdown': commands.push({type:'RightDown'}); break;
      case 'rightup': commands.push({type:'RightUp'}); break;
      case 'middledown': commands.push({type:'MiddleDown'}); break;
      case 'middleup': commands.push({type:'MiddleUp'}); break;
      case 'xbutton1down': commands.push({type:'XButton1Down'}); break;
      case 'xbutton1up': commands.push({type:'XButton1Up'}); break;
      case 'xbutton2down': commands.push({type:'XButton2Down'}); break;
      case 'xbutton2up': commands.push({type:'XButton2Up'}); break;
      case 'delay': {
        const a = parseInt(String(parts[1] || '').replace(/;+$/g, ''), 10) || 100;
        const bStr = parts[2] !== undefined ? String(parts[2]).replace(/;+$/g, '') : '';
        const b = bStr !== '' ? parseInt(bStr, 10) : NaN;
        if (!isNaN(b)) {
          const lo = Math.min(a, b), hi = Math.max(a, b);
          commands.push({ type: 'RandomDelay', min: lo, max: hi });
        } else {
          commands.push({ type: 'Delay', value: a });
        }
        break;
      }
      case 'gowhile': commands.push({type:'GoWhile',startLine:parseInt(parts[1])||1,count:parseInt(parts[2])||1}); break;
      case 'goto': commands.push({type:'GoTo',targetLine:parseInt(parts[1])||1}); break;
      case 'mousemove': commands.push({type:'MouseMove',x:parseInt(parts[1])||0,y:parseInt(parts[2])||0}); break;
      case 'scrollup': commands.push({type:'ScrollUp',value:parseInt(parts[1])||3}); break;
      case 'scrolldown': commands.push({type:'ScrollDown',value:parseInt(parts[1])||3}); break;
      // Ignore unknown or comment lines
    }
  }
  return commands;
}

// Parse Keyran .amc/.krm XML — handles all known XML structures
function parseAmcXml(content) {
  // First: try to parse as XML
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');
  const hasParseError = doc.querySelector('parsererror');

  if (!hasParseError) {
    // Try every known Keyran XML structure to find Syntax nodes:
    // 1) <Root><DefaultMacro><KeyDown><Syntax>...</Syntax></KeyDown></DefaultMacro></Root>
    // 2) <Root><MacroName><KeyDown><Syntax>...</Syntax></KeyDown></MacroName></Root>
    // 3) <KeyDown><Syntax>...</Syntax></KeyDown>
    // 4) Any element named Syntax anywhere in the tree
    const syntaxNodes = doc.querySelectorAll('Syntax');
    if (syntaxNodes.length > 0) {
      let combinedSyntax = '';
      syntaxNodes.forEach(node => { combinedSyntax += node.textContent + '\n'; });
      const codec = detectImportKeyCodec(collectRawKeyCodesFromSyntax(combinedSyntax));
      const allCommands = [];
      syntaxNodes.forEach(node => {
        const cmds = parseSyntaxLines(node.textContent, codec);
        allCommands.push(...cmds);
      });
      if (allCommands.length > 0) {
        return { commands: allCommands, name: 'Imported Macro', importCodec: codec };
      }
    }
  }

  // Second: try to parse as raw syntax text (no XML wrapper)
  // Check if the content looks like syntax lines (starts with a known command)
  const knownCmds = ['keydown','keyup','leftdown','leftup','rightdown','rightup','delay','gowhile','goto','mousemove','middledown','middleup','scrollup','scrolldown','xbutton'];
  const firstWord = content.trim().split(/\s+/)[0];
  if (firstWord && knownCmds.some(c => firstWord.toLowerCase().startsWith(c))) {
    const codec = detectImportKeyCodec(collectRawKeyCodesFromSyntax(content));
    const cmds = parseSyntaxLines(content, codec);
    if (cmds.length > 0) return { commands: cmds, name: 'Imported Macro', importCodec: codec };
  }

  return null;
}

function exportToAmc(commands) {
  let syntax = '';
  commands.forEach(cmd => {
    switch(cmd.type) {
      case 'KeyDown': syntax+=`KeyDown ${cmd.keyCode} ${cmd.device||1}\n`; break;
      case 'KeyUp': syntax+=`KeyUp ${cmd.keyCode} ${cmd.device||1}\n`; break;
      case 'LeftDown': syntax+='LeftDown\n'; break; case 'LeftUp': syntax+='LeftUp\n'; break;
      case 'RightDown': syntax+='RightDown\n'; break; case 'RightUp': syntax+='RightUp\n'; break;
      case 'MiddleDown': syntax+='MiddleDown\n'; break; case 'MiddleUp': syntax+='MiddleUp\n'; break;
      case 'XButton1Down': syntax+='XButton1Down\n'; break; case 'XButton1Up': syntax+='XButton1Up\n'; break;
      case 'XButton2Down': syntax+='XButton2Down\n'; break; case 'XButton2Up': syntax+='XButton2Up\n'; break;
      case 'ScrollUp': syntax+=`ScrollUp ${cmd.value||3}\n`; break;
      case 'ScrollDown': syntax+=`ScrollDown ${cmd.value||3}\n`; break;
      case 'Delay': syntax+=`Delay ${cmd.value}\n`; break;
      case 'RandomDelay': syntax+=`Delay ${cmd.min} ${cmd.max}\n`; break;
      case 'GoWhile': syntax+=`GoWhile ${cmd.startLine} ${cmd.count}\n`; break;
      case 'GoTo': syntax+=`GoTo ${cmd.targetLine}\n`; break;
      case 'MouseMove': syntax+=`MouseMove ${cmd.x} ${cmd.y}\n`; break;
    }
  });
  return `<Root>\n  <DefaultMacro>\n    <KeyDown>\n      <Syntax>\n${syntax}      </Syntax>\n    </KeyDown>\n  </DefaultMacro>\n</Root>`;
}

function exportToAhk(commands, hotkey='F1', speed=1.0) {
  let body = '';
  commands.forEach(cmd => {
    const k = KEY_CODE_MAP[cmd.keyCode];
    switch(cmd.type) {
      case 'KeyDown': body+=`    Send, {${k||'a'} Down}\n`; break;
      case 'KeyUp': body+=`    Send, {${k||'a'} Up}\n`; break;
      case 'LeftDown': body+='    Click, Left, Down\n'; break; case 'LeftUp': body+='    Click, Left, Up\n'; break;
      case 'RightDown': body+='    Click, Right, Down\n'; break; case 'RightUp': body+='    Click, Right, Up\n'; break;
      case 'Delay': body+=`    Sleep, ${Math.round(cmd.value*speed)}\n`; break;
      case 'MouseMove': body+=`    MouseMove, ${cmd.x}, ${cmd.y}\n`; break;
    }
  });
  return `; Generated by Kyrun\n#SingleInstance force\nSetBatchLines, -1\nSetKeyDelay, -1, -1\nSetMouseDelay, -1\ntoggle := false\n#MaxThreadsPerHotkey 2\n\n${hotkey}::\n    toggle := !toggle\n    if (!toggle)\n        return\n    Loop\n    {\n        if (!toggle)\n            break\n${body}    }\nReturn\n`;
}

// ── Import Handler ───────────────────────────────────────────
async function importMacros() {
  try {
    const files = await window.kyrun.importFileDialog();
    if (!files || !files.length) return;
    let lastImported = null;
    let macros;
    try { macros = await window.kyrun.getProfileMacros(state.currentProfile); }
    catch { macros = []; }
    const reserved = new Set(collectMacroRelPaths(macros).map(p => p.toLowerCase()));

    for (const f of files) {
      let data = null;
      const isAmcKrm = f.name.endsWith('.amc') || f.name.endsWith('.krm');
      
      if (isAmcKrm) {
        data = parseAmcXml(f.content);
        if (data) data.name = f.name.replace(/\.\w+$/,'');
      } else {
        // Try JSON (.kyrun)
        try { data = JSON.parse(f.content); } catch { data = null; }
      }

      if (data && data.commands && data.commands.length > 0) {
        const baseName = data.name || f.name.replace(/\.\w+$/,'') || 'Imported';
        const destName = pickUniqueKyrunFilename(baseName, reserved);
        const macroName = destName.replace(/\.kyrun$/i, '');
        const macroData = { name: macroName, version:'1.0', commands: data.commands, settings: data.settings||{} };
        await window.kyrun.saveMacroFile(destName, JSON.stringify(macroData, null, 2));
        lastImported = { name: macroName, path: destName, type: 'macro' };
        const codecHint = data.importCodec === 'hid' ? ' (USB HID key codes)' : '';
        showToast(`Imported "${macroName}" — ${data.commands.length} commands${codecHint}`, 'success');
      } else {
        showToast(`Failed to parse: ${f.name} (no commands found)`, 'error');
      }
    }

    // Refresh the file tree
    await loadFileTree();

    // Auto-open the last imported macro so user sees it immediately
    if (lastImported) {
      openMacro(lastImported);
    }
  } catch(e) { showToast('Import failed: ' + (e.message||'unknown error'), 'error'); }
}

async function exportMacro() {
  if (!state.currentMacro) return;
  try {
    const filePath = await window.kyrun.exportFileDialog(state.currentMacro.name);
    if (!filePath) return;
    let content;
    if (filePath.endsWith('.amc')) content = exportToAmc(state.commands);
    else if (filePath.endsWith('.ahk')) content = exportToAhk(state.commands);
    else content = JSON.stringify({name:state.currentMacro.name,commands:state.commands,settings:state.macroSettings},null,2);
    await window.kyrun.saveMacroFile(filePath, content);
    showToast('Exported successfully','success');
  } catch { showToast('Export not available','error'); }
}

// ── Context Menus ────────────────────────────────────────────
function showCommandContextMenu(e,i) {
  e.preventDefault();
  if(!state.selectedIndices.has(i)){state.selectedIndices.clear();state.selectedIndices.add(i);renderCommands();}
  const m=$('#context-menu');
  m.innerHTML=`<button class="context-menu__item" data-a="edit">✏ Edit properties…</button><div class="context-menu__separator"></div><button class="context-menu__item" data-a="cut">✂ Cut<span class="context-menu__shortcut">Ctrl+X</span></button><button class="context-menu__item" data-a="copy">📋 Copy<span class="context-menu__shortcut">Ctrl+C</span></button><button class="context-menu__item" data-a="paste">📌 Paste<span class="context-menu__shortcut">Ctrl+V</span></button><div class="context-menu__separator"></div><button class="context-menu__item" data-a="dup">⧉ Duplicate</button><button class="context-menu__item" data-a="bp">⏸ Toggle Breakpoint</button><div class="context-menu__separator"></div><button class="context-menu__item context-menu__item--danger" data-a="del">🗑 Delete<span class="context-menu__shortcut">Del</span></button>`;
  posCtx(m,e);
  m.querySelectorAll('[data-a]').forEach(b=>{b.onclick=()=>{hideCtx();switch(b.dataset.a){case'edit':showCommandProperties(i);break;case'cut':cutSelected();break;case'copy':copySelected();break;case'paste':pasteCommands();break;case'dup':copySelected();pasteCommands();break;case'bp':toggleBreakpoint(i);break;case'del':deleteSelected();break;}}});
}
function showFileContextMenu(e,item) {
  e.preventDefault();
  const m=$('#context-menu');
  m.innerHTML=`<button class="context-menu__item" data-a="open">📂 Open</button><button class="context-menu__item" data-a="export">📤 Export</button><div class="context-menu__separator"></div><button class="context-menu__item context-menu__item--danger" data-a="del">🗑 Delete</button>`;
  posCtx(m,e);
  m.querySelectorAll('[data-a]').forEach(b=>{b.onclick=()=>{hideCtx();switch(b.dataset.a){case'open':openMacro(item);break;case'del':deleteMacroFile(item);break;case'export':exportMacro();break;}}});
}
function posCtx(m,e){m.classList.add('context-menu--visible');let x=e.clientX,y=e.clientY;setTimeout(()=>{const r=m.getBoundingClientRect();if(x+r.width>innerWidth)x=innerWidth-r.width-4;if(y+r.height>innerHeight)y=innerHeight-r.height-4;m.style.left=x+'px';m.style.top=y+'px';},0);}
function hideCtx(){$('#context-menu').classList.remove('context-menu--visible');}

// ── UI Updates ───────────────────────────────────────────────
function updateMacroSettings() {
  $('#loop-enabled').checked = state.macroSettings.loop;
  $('#loop-count').value = state.macroSettings.loopCount||0;
  $('#loop-count-field').style.display = state.macroSettings.loop?'block':'none';
  $('#random-delays').checked = state.macroSettings.randomDelays;
  $('#bind-key-input').value = state.macroSettings.bindKey||'';
}
function updateStatusBar() {
  $('#statusbar-profile').textContent = state.currentProfile;
  const mn=$('#statusbar-macro-name span');
  mn.textContent = state.currentMacro ? `${state.currentMacro.name}${state.currentMacro.dirty?' •':''}` : 'No macro open';
  $('#statusbar-commands span').textContent = `${state.commands.length} commands`;
}
function updateKeyboardViz() {
  $$('.keyboard-viz__key').forEach(k=>k.classList.remove('keyboard-viz__key--active'));
  state.selectedIndices.forEach(i=>{const c=state.commands[i];if(c&&(c.type==='KeyDown'||c.type==='KeyUp')){const k=$(`.keyboard-viz__key[data-key="${c.keyCode}"]`);if(k)k.classList.add('keyboard-viz__key--active');}});
}

async function deleteMacroFile(item) {
  showModal('Delete Macro',`<p>Delete <strong>${item.name}</strong>?</p>`,[
    {label:'Cancel',type:'secondary',action:()=>{}},
    {label:'Delete',type:'danger',action:async()=>{
      try{await window.kyrun.deleteMacro(item.path);}catch{}
      if(state.currentMacro&&state.currentMacro.path===item.path){state.currentMacro=null;state.commands=[];$('#editor-content').classList.add('hidden');$('#welcome-view').classList.remove('hidden');}
      loadFileTree(); showToast('Deleted','info');
    }}
  ]);
}

// ── Keyboard Viz Click ───────────────────────────────────────
$$('.keyboard-viz__key').forEach(key => {
  key.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const kc = parseInt(key.dataset.key, 10);
    if (!state.currentMacro) { showToast('Open or create a macro first', 'error'); return; }
    pushUndo();
    const at = state.selectedIndices.size>0?Math.max(...state.selectedIndices)+1:state.commands.length;
    state.commands.splice(at,0,{type:'KeyDown',keyCode:kc,device:1},{type:'Delay',value:50},{type:'KeyUp',keyCode:kc,device:1});
    state.currentMacro.dirty=true;
    state.selectedIndices.clear(); state.selectedIndices.add(at);
    renderCommands();
    showCommandProperties(at);
  });
});

// ── Event Listeners from IPC ─────────────────────────────────
try {
  window.kyrun.onMacroState(data => { state.isRunning=data.running; updateRunningUI(data.running); });
  window.kyrun.onMacroLine(line => {
    $$('.command-row--executing').forEach(r=>r.classList.remove('command-row--executing'));
    const row=$(`.command-row[data-index="${line}"]`);
    if(row) row.classList.add('command-row--executing');
  });
  window.kyrun.onProfileChanged(name => { state.currentProfile=name; loadProfiles(); loadFileTree(); reloadProfileTriggers(); });
  
  // Background macro execution from globally bound triggers
  window.kyrun.onHotkeyTriggered(async (macroPath) => {
    // Check if it's a profile switch trigger
    if (macroPath.startsWith('!profile:')) {
      const pName = macroPath.replace('!profile:', '');
      if (pName !== state.currentProfile) {
        state.currentProfile = pName;
        try { await window.kyrun.switchProfile(pName); } catch {}
        loadProfiles(); loadFileTree(); reloadProfileTriggers();
        $('#editor-content').classList.add('hidden'); $('#welcome-view').classList.remove('hidden');
        updateStatusBar();
        showToast(`Profile switched: ${pName}`, 'info');
      }
      return;
    }

    if (state.isRunning) { stopMacro(); return; }
    try {
      const raw = await window.kyrun.readMacroFile(macroPath);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || !data.commands) return;
      
      state.isRunning = true;
      updateRunningUI(true);
      const settings = { ...data.settings, speedMultiplier: state.speedMultiplier };
      const result = await window.kyrun.executeMacro(data.commands, settings);
      if (!result.success && result.error !== 'Macro already running') {
        showToast(result.error||'Execution failed', 'error');
      }
      state.isRunning = false;
      updateRunningUI(false);
    } catch {}
  });
} catch {}

// ── Trigger Registration ─────────────────────────────────────
let activeTriggers = []; // {path, isMouse, vk, bindKey}

async function reloadProfileTriggers() {
  let firstHotkeyError = null;
  // Unregister all existing
  for (const t of activeTriggers) {
    if (t.isMouse) await window.kyrun.unregisterMouseTrigger(t.vk);
    else await window.kyrun.unregisterHotkey(t.path);
  }
  activeTriggers = [];
  
  // Find all macros in this profile and check settings
  async function scanTree(items) {
    for (const item of items) {
      if (item.type === 'folder') {
        if (item.children) await scanTree(item.children);
      } else {
        try {
          const raw = await window.kyrun.readMacroFile(item.path);
          const data = JSON.parse(raw);
          if (data && data.settings && (data.settings.bindKey || data.settings.bindVk)) {
            const vk = data.settings.bindVk || 0;
            const isMouse = data.settings.bindIsMouse || false;
            const macroLabel = data.name || item.name || item.path;
            if (isMouse && vk) {
              const ok = await window.kyrun.registerMouseTrigger(item.path, vk);
              if (ok) activeTriggers.push({path: item.path, isMouse: true, vk});
              else if (!firstHotkeyError) firstHotkeyError = `Mouse trigger failed: "${macroLabel}"`;
            } else if (data.settings.bindKey) {
              const electronAc = convertToElectronAccelerator(data.settings.bindKey);
              if (!electronAc) {
                if (!firstHotkeyError) {
                  firstHotkeyError = `Unsupported hotkey "${data.settings.bindKey}" for "${macroLabel}" — use a letter, number, F1–F12, or Space.`;
                }
              } else {
                const ok = await window.kyrun.registerHotkey(item.path, electronAc);
                if (ok) {
                  activeTriggers.push({path: item.path, isMouse: false, bindKey: data.settings.bindKey});
                } else if (!firstHotkeyError) {
                  firstHotkeyError = `Could not register "${electronAc}" for "${macroLabel}" (in use or blocked by the OS).`;
                }
              }
            }
          }
        } catch {} // ignore bad files
      }
    }
  }
  
  try {
    const macros = await window.kyrun.getProfileMacros(state.currentProfile);
    await scanTree(macros);
  } catch {}
  
  // Register Profile Hotkeys
  try {
    const settings = await window.kyrun.getSettings();
    if (settings && settings.profileHotkeys) {
      for (const [pName, bindKey] of Object.entries(settings.profileHotkeys)) {
        if (!bindKey) continue;
        const electronAc = convertToElectronAccelerator(bindKey);
        if (electronAc) {
          await window.kyrun.registerHotkey(`!profile:${pName}`, electronAc);
          activeTriggers.push({path: `!profile:${pName}`, isMouse: false, bindKey});
        } else if (bindKey.startsWith('Mouse')) {
          // Future: map back to vk code, but for now electronAc works for F-keys and Alt+etc.
          // Note: Full mouse button support for profile switching requires VK mapping.
        }
      }
    }
  } catch {}
  if (firstHotkeyError) showToast(firstHotkeyError, 'error');
}

function convertToElectronAccelerator(keyname) {
  if (!keyname) return null;
  // Mouse buttons can't be Electron accelerators
  if (keyname.includes('Mouse')) return null;
  // Single letter or digit
  if (/^[A-Z0-9]$/i.test(keyname)) return keyname.toUpperCase();
  // F-keys
  if (/^F([1-9]|1[0-2])$/i.test(keyname)) return keyname.toUpperCase();
  // Common key names → Electron accelerator names
  const map = {
    'Space':'Space','Enter':'Return','Escape':'Escape','Tab':'Tab',
    'Backspace':'Backspace','Delete':'Delete','Insert':'Insert',
    'Home':'Home','End':'End','PgUp':'PageUp','PgDn':'PageDown',
    'Up':'Up','Down':'Down','Left':'Left','Right':'Right',
    'Pause':'Pause','CapsLock':'CapsLock','NumLock':'NumLock','ScrollLock':'ScrollLock',
    'Num0':'num0','Num1':'num1','Num2':'num2','Num3':'num3','Num4':'num4',
    'Num5':'num5','Num6':'num6','Num7':'num7','Num8':'num8','Num9':'num9',
    'Num*':'nummult','Num+':'numadd','Num-':'numsub','Num.':'numdec','Num/':'numdiv',
    // Left/right modifiers → Electron names (single-modifier hotkeys may still fail on some OSes)
    'LShift':'Shift','RShift':'Shift','Shift':'Shift',
    'LCtrl':'Control','RCtrl':'Control','Ctrl':'Control',
    'LAlt':'Alt','RAlt':'Alt','Alt':'Alt'
  };
  if (map[keyname]) return map[keyname];
  return null;
}

// ── All Event Bindings ───────────────────────────────────────
$('#btn-minimize').onclick = ()=>{ try{window.kyrun.minimize();}catch{} };
$('#btn-maximize').onclick = ()=>{ try{window.kyrun.maximize();}catch{} };
$('#btn-close').onclick = ()=>{ try{window.kyrun.close();}catch{} };
$('#modal-close').onclick = hideModal;
$('#modal-overlay').onclick = e=>{ if(e.target===e.currentTarget) hideModal(); };

$('#profile-dropdown').onchange = async e => {
  state.currentProfile=e.target.value;
  try{await window.kyrun.switchProfile(state.currentProfile);}catch{}
  loadFileTree(); state.currentMacro=null; state.commands=[];
  $('#editor-content').classList.add('hidden'); $('#welcome-view').classList.remove('hidden');
  updateStatusBar();
};

$('#btn-add-profile').onclick = ()=>showModal('New Profile','<input type="text" class="properties-panel__input" id="new-profile-name" placeholder="Profile name...">',[{label:'Cancel',type:'secondary',action:()=>{}},{label:'Create',type:'primary',action:async()=>{const n=document.getElementById('new-profile-name').value.trim();if(!n)return;try{await window.kyrun.createProfile(n);}catch{}state.currentProfile=n;loadProfiles();loadFileTree();showToast(`Profile "${n}" created`,'success');}}]);

$('#btn-rename-profile').onclick = ()=>{
  if(state.currentProfile==='Default'){showToast('Cannot rename Default','error');return;}
  showModal('Rename Profile',`<input type="text" class="properties-panel__input" id="rename-profile-name" value="${state.currentProfile}">`,[
    {label:'Cancel',type:'secondary',action:()=>{}},
    {label:'Rename',type:'primary',action:async()=>{const n=document.getElementById('rename-profile-name').value.trim();if(!n||n===state.currentProfile)return;try{await window.kyrun.renameProfile(state.currentProfile,n);state.currentProfile=n;loadProfiles();loadFileTree();showToast('Renamed','success');}catch{showToast('Rename failed','error');}}}
  ]);
};

$('#btn-delete-profile').onclick = ()=>{
  if(state.currentProfile==='Default'){showToast('Cannot delete Default','error');return;}
  showModal('Delete Profile',`<p>Delete <strong>${state.currentProfile}</strong> and all its macros?</p>`,[{label:'Cancel',type:'secondary',action:()=>{}},{label:'Delete',type:'danger',action:async()=>{try{await window.kyrun.deleteProfile(state.currentProfile);}catch{}state.currentProfile='Default';loadProfiles();loadFileTree();showToast('Deleted','info');}}]);
};

$('#btn-new-macro').onclick = $('#btn-welcome-new').onclick = ()=>showModal('New Macro','<input type="text" class="properties-panel__input" id="new-macro-name" placeholder="Macro name...">',[{label:'Cancel',type:'secondary',action:()=>{}},{label:'Create',type:'primary',action:async()=>{const n=document.getElementById('new-macro-name').value.trim();if(!n)return;try{await window.kyrun.createMacro(n);}catch{}loadFileTree();openMacro({name:n,path:`${n}.kyrun`,type:'macro'});showToast(`"${n}" created`,'success');}}]);

$('#btn-new-folder').onclick = ()=>showModal('New Folder','<input type="text" class="properties-panel__input" id="new-folder-name" placeholder="Folder name...">',[{label:'Cancel',type:'secondary',action:()=>{}},{label:'Create',type:'primary',action:async()=>{const n=document.getElementById('new-folder-name').value.trim();if(!n)return;try{await window.kyrun.createFolder(n);}catch{}loadFileTree();showToast(`Folder "${n}" created`,'success');}}]);

$('#btn-import-macro').onclick = $('#btn-welcome-import').onclick = importMacros;

// File menu
$('.titlebar__menu-item[data-action="import"]').onclick = ()=>{
  showModal('File',`<div style="display:flex;flex-direction:column;gap:8px"><button class="btn btn--secondary" id="fm-import">📥 Import Macro Files (.amc, .krm, .kyrun)</button><button class="btn btn--secondary" id="fm-export">📤 Export Current Macro</button><button class="btn btn--secondary" id="fm-save">💾 Save Current Macro</button></div>`,[{label:'Close',type:'secondary',action:()=>{}}]);
  setTimeout(()=>{
    const imp=document.getElementById('fm-import');if(imp)imp.onclick=()=>{hideModal();importMacros();};
    const exp=document.getElementById('fm-export');if(exp)exp.onclick=()=>{hideModal();exportMacro();};
    const sav=document.getElementById('fm-save');if(sav)sav.onclick=()=>{hideModal();saveMacro();};
  },50);
};

// Toolbar
$('#btn-record').onclick = ()=>{ state.isRecording?stopRecording():startRecording(); };
$('#btn-play').onclick = runMacro;
$('#btn-stop').onclick = stopMacro;
$('#btn-save').onclick = saveMacro;
$('#btn-export').onclick = exportMacro;
$('#btn-undo').onclick = undo; $('#btn-redo').onclick = redo;
$('#btn-cut').onclick = cutSelected; $('#btn-copy').onclick = copySelected; $('#btn-paste').onclick = pasteCommands;
$('#btn-move-up').onclick = ()=>moveSelected(-1); $('#btn-move-down').onclick = ()=>moveSelected(1);

$('#speed-slider').oninput = e=>{ state.speedMultiplier=parseInt(e.target.value)/100; $('#speed-value').textContent=`${e.target.value}%`; };

// Command palette (delegation — reliable when panel scrolls / repaints)
$('#editor-content').addEventListener('click', e => {
  const btn = e.target.closest('.command-palette__btn');
  if (!btn || !btn.dataset.cmd) return;
  e.preventDefault();
  e.stopPropagation();
  addCommand(btn.dataset.cmd);
});

// Macro settings
$('#loop-enabled').onchange = e=>{ state.macroSettings.loop=e.target.checked; $('#loop-count-field').style.display=e.target.checked?'block':'none'; if(state.currentMacro)state.currentMacro.dirty=true; };
$('#loop-count').onchange = e=>{ state.macroSettings.loopCount=parseInt(e.target.value); };
$('#random-delays').onchange = e=>{ state.macroSettings.randomDelays=e.target.checked; };
$('#bind-key-input').onclick = function() {
  this.value = 'Press a key or mouse button...';
  const self = this;
  const keyH = e => {
    e.preventDefault();
    const name = keyEventToBindLabel(e);
    self.value = name;
    state.macroSettings.bindKey = name;
    state.macroSettings.bindVk = e.keyCode;
    state.macroSettings.bindIsMouse = false;
    if (state.currentMacro) state.currentMacro.dirty = true;
    cleanup();
    if (state.currentMacro) saveMacro({ silent: true });
  };
  const mouseH = e => {
    if (e.button === 0) return; // ignore left click (that's what opened this)
    e.preventDefault(); e.stopPropagation();
    const names = { 1:'Middle Mouse', 2:'Right Mouse', 3:'Mouse X1 (Side)', 4:'Mouse X2 (Side)' };
    const vkCodes = { 1:4, 2:2, 3:5, 4:6 }; // VK_MBUTTON=4, VK_RBUTTON=2, VK_XBUTTON1=5, VK_XBUTTON2=6
    const name = names[e.button] || `Mouse ${e.button}`;
    self.value = name;
    state.macroSettings.bindKey = name;
    state.macroSettings.bindVk = vkCodes[e.button] || e.button;
    state.macroSettings.bindIsMouse = true;
    if (state.currentMacro) state.currentMacro.dirty = true;
    cleanup();
    if (state.currentMacro) saveMacro({ silent: true });
  };
  function cleanup() {
    document.removeEventListener('keydown', keyH);
    document.removeEventListener('mousedown', mouseH);
  }
  document.addEventListener('keydown', keyH);
  document.addEventListener('mousedown', mouseH);
};

// Anonymous
$('#btn-anonymous').onclick = async()=>{
  try{state.isAnonymous=await window.kyrun.toggleAnonymous();}catch{state.isAnonymous=!state.isAnonymous;}
  $('#btn-anonymous').className=`statusbar__anonymous statusbar__anonymous--${state.isAnonymous?'on':'off'}`;
  $('#anonymous-text').textContent=`Anonymous: ${state.isAnonymous?'ON':'OFF'}`;
  showToast(`Anonymous ${state.isAnonymous?'enabled':'disabled'}`,state.isAnonymous?'success':'info');
};

// ── Settings UI ──────────────────────────────────────────────
async function renderProfileHotkeys() {
  const container = $('#profile-hotkeys-list');
  if (!container) return;
  
  try {
    const settings = await window.kyrun.getSettings();
    const hotkeys = settings.profileHotkeys || {};
    const profiles = await window.kyrun.getProfiles();
    
    let html = '';
    profiles.forEach(p => {
      const currentBind = hotkeys[p] || '';
      html += `
        <div class="settings-view__row" style="margin-bottom:8px">
          <div>
            <div class="settings-view__row-label" style="font-weight:600;color:var(--text-primary)">${p}</div>
          </div>
          <input type="text" class="properties-panel__input" style="width:140px;cursor:pointer;" 
            placeholder="Click to bind..." 
            value="${currentBind}" 
            data-profile="${p}" readonly>
        </div>
      `;
    });
    container.innerHTML = html;
    
    // Bind click events
    container.querySelectorAll('input').forEach(input => {
      input.onclick = function() {
        this.value = 'Press key/mouse...';
        const profile = this.dataset.profile;
        const self = this;
        const keyH = async e => {
          e.preventDefault();
          const name = getKeyName(e.keyCode);
          self.value = name;
          cleanup();
          await saveBind(profile, name);
        };
        const mouseH = async e => {
          if (e.button === 0) return; // ignore left click
          e.preventDefault(); e.stopPropagation();
          const names = { 1:'Middle Mouse', 2:'Right Mouse', 3:'Mouse X1 (Side)', 4:'Mouse X2 (Side)' };
          const name = names[e.button] || `Mouse ${e.button}`;
          self.value = name;
          cleanup();
          await saveBind(profile, name);
        };
        function cleanup() {
          document.removeEventListener('keydown', keyH);
          document.removeEventListener('mousedown', mouseH);
        }
        async function saveBind(prof, n) {
          settings.profileHotkeys = settings.profileHotkeys || {};
          settings.profileHotkeys[prof] = n;
          await window.kyrun.saveSettings(settings);
          reloadProfileTriggers();
          showToast(`Bound ${n} to ${prof}`, 'success');
        }
        document.addEventListener('keydown', keyH);
        document.addEventListener('mousedown', mouseH);
      };
    });
  } catch {}
}

$('.titlebar__menu-item[data-action="settings"]').onclick = () => {
  if(state.currentView==='settings') {
    $('#settings-view').classList.remove('settings-view--visible');
    if(state.currentMacro)$('#editor-content').classList.remove('hidden');
    else $('#welcome-view').classList.remove('hidden');
    state.currentView='editor';
  } else {
    $('#settings-view').classList.add('settings-view--visible');
    $('#editor-content').classList.add('hidden');
    $('#welcome-view').classList.add('hidden');
    state.currentView='settings';
    renderProfileHotkeys();
  }
};

// Help
$('.titlebar__menu-item[data-action="help"]').onclick = ()=>{
  showModal('About Kyrun',`<div style="text-align:center"><div style="width:60px;height:60px;background:linear-gradient(135deg,var(--accent-primary),var(--accent-secondary));border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:var(--bg-primary);margin-bottom:12px">K</div><h3 style="margin-bottom:4px">Kyrun v1.0</h3><p style="color:var(--text-tertiary);font-size:12px;margin-bottom:12px">Advanced Macro Editor & Executor</p><p style="color:var(--text-secondary);font-size:12px;line-height:1.6">Keyran-compatible macro application with<br>full .amc file support, recording, execution,<br>profile management, and anonymous mode.</p><p style="color:var(--text-secondary);font-size:11px;line-height:1.5;margin-top:14px;text-align:left;max-width:340px;margin-left:auto;margin-right:auto">Games with strong anti-cheat (e.g. Marvel Rivals / NetEase ACE, Easy Anti-Cheat) often block <strong>software</strong> keyboard and mouse from other apps. Tools like Keyran may use a <strong>kernel driver</strong> or mouse firmware, which this app does not ship. Kyrun uses Windows <code>SendInput</code> (standard user-mode injection). Try running Kyrun <strong>as Administrator</strong> if the game runs elevated; if input still does nothing in-game, only hardware-level solutions or the game’s own settings may work. Always follow each game’s terms of service.</p></div>`,[{label:'Close',type:'secondary',action:()=>{}}]);
};

// Global shortcuts
document.addEventListener('keydown', e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;
  if(state.isRecording)return; // handled by record handlers
  if(e.ctrlKey&&e.key==='z'){e.preventDefault();undo();}
  if(e.ctrlKey&&e.key==='y'){e.preventDefault();redo();}
  if(e.ctrlKey&&e.key==='x'){e.preventDefault();cutSelected();}
  if(e.ctrlKey&&e.key==='c'){e.preventDefault();copySelected();}
  if(e.ctrlKey&&e.key==='v'){e.preventDefault();pasteCommands();}
  if(e.ctrlKey&&e.key==='s'){e.preventDefault();saveMacro();}
  if(e.ctrlKey&&e.key==='r'){e.preventDefault();state.isRecording?stopRecording():startRecording();}
  if(e.key==='Delete'){e.preventDefault();deleteSelected();}
  if(e.key==='F5'){e.preventDefault();runMacro();}
  if(e.key==='F6'){e.preventDefault();stopMacro();}
  if(e.key==='Escape')hideCtx();
});
document.addEventListener('click', e=>{ if(!e.target.closest('.context-menu'))hideCtx(); });

// ── Init ─────────────────────────────────────────────────────
(async function init() {
  loadProfiles(); loadFileTree();
  // We cannot reload triggers simultaneously because it reads the same macro files we just grabbed
  setTimeout(reloadProfileTriggers, 500); 
  try {
    const info = await window.kyrun.getAppInfo();
    $('#statusbar-pid').textContent = `PID: ${info.pid}`;
    state.hasRobot = info.hasInput;
    if (info.hasInput) { $('#driver-dot').className='titlebar__status-dot titlebar__status-dot--active'; }
  } catch { $('#statusbar-pid').textContent='PID: demo'; }
  updateStatusBar();
})();
