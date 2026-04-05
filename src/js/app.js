// ═══════════════════════════════════════════════════════════════
// KYRUN — Main Application Controller
// ═══════════════════════════════════════════════════════════════

// ── Key Code Map (Keyran VK codes → readable names) ──────────
const KEY_CODE_MAP = {
  1:'LButton',2:'RButton',4:'MButton',8:'Backspace',9:'Tab',13:'Enter',
  16:'Shift',17:'Ctrl',18:'Alt',19:'Pause',20:'CapsLock',27:'Escape',
  32:'Space',33:'PgUp',34:'PgDn',35:'End',36:'Home',
  37:'Left',38:'Up',39:'Right',40:'Down',44:'PrtSc',45:'Insert',46:'Delete',
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
  186:';',187:'=',188:',',189:'-',190:'.',191:'/',192:'`',
  219:'[',220:'\\',221:']',222:"'"
};

// ── Application State ────────────────────────────────────────
const state = {
  currentProfile: 'Default',
  currentMacro: null,       // { name, path, dirty }
  commands: [],              // current macro commands
  selectedIndices: new Set(),
  clipboard: [],
  undoStack: [],
  redoStack: [],
  isRecording: false,
  isRunning: false,
  isAnonymous: false,
  macroSettings: { loop: false, loopCount: 0, bindKey: '', windowBind: '', randomDelays: false },
  speedMultiplier: 1.0,
  currentView: 'editor' // 'editor' | 'settings'
};

// ── Utility Functions ────────────────────────────────────────
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function showToast(msg, type = 'info') {
  const c = $('#toast-container');
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}

function showModal(title, bodyHTML, buttons = []) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHTML;
  const footer = $('#modal-footer');
  footer.innerHTML = '';
  buttons.forEach(b => {
    const btn = document.createElement('button');
    btn.className = `btn btn--${b.type || 'secondary'}`;
    btn.textContent = b.label;
    btn.onclick = () => { b.action(); hideModal(); };
    footer.appendChild(btn);
  });
  $('#modal-overlay').classList.add('modal-overlay--visible');
}

function hideModal() {
  $('#modal-overlay').classList.remove('modal-overlay--visible');
}

function getKeyName(code) { return KEY_CODE_MAP[code] || `Key${code}`; }

// ── Profile Management ───────────────────────────────────────
async function loadProfiles() {
  try {
    const profiles = await window.kyrun.getProfiles();
    const dd = $('#profile-dropdown');
    dd.innerHTML = '';
    profiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      if (p === state.currentProfile) opt.selected = true;
      dd.appendChild(opt);
    });
    $('#statusbar-profile').textContent = state.currentProfile;
  } catch { /* running outside electron */ }
}

async function loadFileTree() {
  let macros;
  try {
    macros = await window.kyrun.getProfileMacros(state.currentProfile);
  } catch {
    // Demo data for development outside Electron
    macros = [
      { name: 'Recoil Control', type: 'macro', path: 'Recoil Control.kyrun' },
      { name: 'Auto Clicker', type: 'macro', path: 'Auto Clicker.kyrun' },
      { name: 'Spray Patterns', type: 'folder', path: 'Spray Patterns', children: [
        { name: 'AK-47', type: 'macro', path: 'Spray Patterns/AK-47.kyrun' },
        { name: 'M4A4', type: 'macro', path: 'Spray Patterns/M4A4.kyrun' }
      ]}
    ];
  }
  renderFileTree(macros);
}

function renderFileTree(items, container = null, depth = 0) {
  const tree = container || $('#file-tree');
  if (!container) tree.innerHTML = '';
  
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = `file-tree__item ${item.type === 'folder' ? 'file-tree__item--folder' : ''}`;
    el.style.paddingLeft = `${14 + depth * 16}px`;
    el.dataset.path = item.path;
    el.dataset.type = item.type;

    if (item.type === 'folder') {
      el.innerHTML = `
        <span class="file-tree__icon file-tree__icon--arrow">▶</span>
        <span class="file-tree__icon file-tree__icon--folder">📁</span>
        <span class="file-tree__name">${item.name}</span>
      `;
      el.onclick = (e) => {
        e.stopPropagation();
        const arrow = el.querySelector('.file-tree__icon--arrow');
        const childContainer = el.nextElementSibling;
        if (childContainer && childContainer.classList.contains('file-tree__children')) {
          childContainer.classList.toggle('hidden');
          arrow.classList.toggle('expanded');
        }
      };
      tree.appendChild(el);
      if (item.children && item.children.length) {
        const childDiv = document.createElement('div');
        childDiv.className = 'file-tree__children';
        renderFileTree(item.children, childDiv, depth + 1);
        tree.appendChild(childDiv);
      }
    } else {
      el.innerHTML = `
        <span class="file-tree__icon file-tree__icon--macro">⚡</span>
        <span class="file-tree__name">${item.name}</span>
      `;
      el.onclick = () => openMacro(item);
      el.oncontextmenu = (e) => showFileContextMenu(e, item);
      tree.appendChild(el);
    }
  });
}

// ── Macro Open / Save ────────────────────────────────────────
async function openMacro(item) {
  // Mark active in tree
  $$('.file-tree__item--active').forEach(e => e.classList.remove('file-tree__item--active'));
  const el = $(`.file-tree__item[data-path="${item.path}"]`);
  if (el) el.classList.add('file-tree__item--active');

  let data;
  try {
    const raw = await window.kyrun.readMacroFile(item.path);
    data = JSON.parse(raw);
  } catch {
    // Demo data
    data = { name: item.name, commands: [], settings: { loop: false, loopCount: 0, bindKey: '', windowBind: '' } };
  }

  state.currentMacro = { name: data.name || item.name, path: item.path, dirty: false };
  state.commands = data.commands || [];
  state.macroSettings = { loop: false, loopCount: 0, bindKey: '', windowBind: '', randomDelays: false, ...data.settings };
  state.selectedIndices.clear();
  state.undoStack = [];
  state.redoStack = [];

  // Show editor
  $('#welcome-view').classList.add('hidden');
  $('#settings-view').classList.remove('settings-view--visible');
  $('#editor-content').classList.remove('hidden');
  state.currentView = 'editor';

  updateMacroSettings();
  renderCommands();
  updateStatusBar();
}

async function saveMacro() {
  if (!state.currentMacro) return;
  const data = {
    name: state.currentMacro.name,
    version: '1.0',
    commands: state.commands,
    settings: state.macroSettings
  };
  try {
    await window.kyrun.saveMacroFile(state.currentMacro.path, JSON.stringify(data, null, 2));
    state.currentMacro.dirty = false;
    showToast('Macro saved', 'success');
  } catch {
    showToast('Saved locally (demo mode)', 'info');
  }
  updateStatusBar();
}

// ── Command Rendering ────────────────────────────────────────
function renderCommands() {
  const body = $('#command-list-body');
  const empty = $('#command-empty');

  if (state.commands.length === 0) {
    body.innerHTML = '';
    body.appendChild(empty);
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  body.innerHTML = '';

  state.commands.forEach((cmd, i) => {
    const row = document.createElement('div');
    row.className = 'command-row';
    if (state.selectedIndices.has(i)) row.classList.add('command-row--selected');
    if (cmd.breakpoint) row.classList.add('command-row--breakpoint');
    row.dataset.index = i;

    const typeClass = getTypeClass(cmd.type);
    const params = formatParams(cmd);
    const timing = cmd.type === 'Delay' ? `${cmd.value}ms` : cmd.type === 'RandomDelay' ? `${cmd.min}-${cmd.max}ms` : '';

    row.innerHTML = `
      <span class="command-row__num">${i + 1}</span>
      <span class="command-row__breakpoint ${cmd.breakpoint ? 'command-row__breakpoint--active' : ''}" data-bp="${i}"></span>
      <span class="command-row__type ${typeClass}">${cmd.type}</span>
      <span class="command-row__params">${params}</span>
      <span class="command-row__delay">${timing}</span>
    `;

    row.onclick = (e) => selectCommand(i, e);
    row.ondblclick = () => editCommandInline(i);
    row.oncontextmenu = (e) => showCommandContextMenu(e, i);
    row.querySelector('[data-bp]').onclick = (e) => { e.stopPropagation(); toggleBreakpoint(i); };

    body.appendChild(row);
  });

  updateKeyboardViz();
  updateStatusBar();
}

function getTypeClass(type) {
  const map = {
    KeyDown: 'command-row__type--keydown', KeyUp: 'command-row__type--keyup',
    LeftDown: 'command-row__type--mousedown', LeftUp: 'command-row__type--mouseup',
    RightDown: 'command-row__type--mousedown', RightUp: 'command-row__type--mouseup',
    Delay: 'command-row__type--delay', RandomDelay: 'command-row__type--delay',
    GoTo: 'command-row__type--goto', GoWhile: 'command-row__type--loop',
    Comment: 'command-row__type--comment', Variable: 'command-row__type--variable',
    ColorDetect: 'command-row__type--color', MouseMove: 'command-row__type--mousemove'
  };
  return map[type] || '';
}

function formatParams(cmd) {
  switch (cmd.type) {
    case 'KeyDown': case 'KeyUp': return `Key: ${getKeyName(cmd.keyCode)} (${cmd.keyCode})`;
    case 'LeftDown': return 'Left Mouse Button ↓';
    case 'LeftUp': return 'Left Mouse Button ↑';
    case 'RightDown': return 'Right Mouse Button ↓';
    case 'RightUp': return 'Right Mouse Button ↑';
    case 'Delay': return `Wait ${cmd.value}ms`;
    case 'RandomDelay': return `Wait ${cmd.min}-${cmd.max}ms`;
    case 'MouseMove': return `Move to (${cmd.x}, ${cmd.y})`;
    case 'GoTo': return `Jump to line ${cmd.targetLine}`;
    case 'GoWhile': return `Loop from line ${cmd.startLine}, ${cmd.count}x`;
    case 'Comment': return `// ${cmd.value}`;
    case 'ColorDetect': return `Check (${cmd.x},${cmd.y}) color #${cmd.color}`;
    case 'Variable': return `${cmd.varName} ${cmd.operation} ${cmd.varValue}`;
    default: return JSON.stringify(cmd);
  }
}

// ── Command Selection & Editing ──────────────────────────────
function selectCommand(index, e) {
  if (e && e.ctrlKey) {
    if (state.selectedIndices.has(index)) state.selectedIndices.delete(index);
    else state.selectedIndices.add(index);
  } else if (e && e.shiftKey && state.selectedIndices.size > 0) {
    const last = Math.max(...state.selectedIndices);
    const start = Math.min(last, index), end = Math.max(last, index);
    for (let i = start; i <= end; i++) state.selectedIndices.add(i);
  } else {
    state.selectedIndices.clear();
    state.selectedIndices.add(index);
  }
  renderCommands();
  showCommandProperties(index);
}

function showCommandProperties(index) {
  const cmd = state.commands[index];
  if (!cmd) return;
  const panel = $('#selected-command-props');
  const content = $('#command-props-content');
  panel.classList.remove('hidden');

  let html = '';
  switch (cmd.type) {
    case 'KeyDown': case 'KeyUp':
      html = `<div class="properties-panel__field">
        <label class="properties-panel__label">Key Code</label>
        <input type="number" class="properties-panel__input" value="${cmd.keyCode}" data-prop="keyCode" data-idx="${index}">
      </div>
      <div class="properties-panel__field">
        <label class="properties-panel__label">Key: ${getKeyName(cmd.keyCode)}</label>
      </div>`;
      break;
    case 'Delay':
      html = `<div class="properties-panel__field">
        <label class="properties-panel__label">Duration (ms)</label>
        <input type="number" class="properties-panel__input" value="${cmd.value}" min="1" data-prop="value" data-idx="${index}">
      </div>`;
      break;
    case 'RandomDelay':
      html = `<div class="properties-panel__field">
        <label class="properties-panel__label">Min (ms)</label>
        <input type="number" class="properties-panel__input" value="${cmd.min}" min="1" data-prop="min" data-idx="${index}">
      </div>
      <div class="properties-panel__field">
        <label class="properties-panel__label">Max (ms)</label>
        <input type="number" class="properties-panel__input" value="${cmd.max}" min="1" data-prop="max" data-idx="${index}">
      </div>`;
      break;
    case 'MouseMove':
      html = `<div class="properties-panel__field">
        <label class="properties-panel__label">X</label>
        <input type="number" class="properties-panel__input" value="${cmd.x}" data-prop="x" data-idx="${index}">
      </div>
      <div class="properties-panel__field">
        <label class="properties-panel__label">Y</label>
        <input type="number" class="properties-panel__input" value="${cmd.y}" data-prop="y" data-idx="${index}">
      </div>`;
      break;
    case 'GoTo':
      html = `<div class="properties-panel__field">
        <label class="properties-panel__label">Target Line</label>
        <input type="number" class="properties-panel__input" value="${cmd.targetLine}" min="1" data-prop="targetLine" data-idx="${index}">
      </div>`;
      break;
    case 'GoWhile':
      html = `<div class="properties-panel__field">
        <label class="properties-panel__label">Start Line</label>
        <input type="number" class="properties-panel__input" value="${cmd.startLine}" min="1" data-prop="startLine" data-idx="${index}">
      </div>
      <div class="properties-panel__field">
        <label class="properties-panel__label">Loop Count</label>
        <input type="number" class="properties-panel__input" value="${cmd.count}" min="1" data-prop="count" data-idx="${index}">
      </div>`;
      break;
    case 'Comment':
      html = `<div class="properties-panel__field">
        <label class="properties-panel__label">Comment</label>
        <input type="text" class="properties-panel__input" value="${cmd.value || ''}" data-prop="value" data-idx="${index}">
      </div>`;
      break;
    default:
      html = `<p style="color:var(--text-tertiary);font-size:12px;">No editable properties</p>`;
  }
  content.innerHTML = html;

  // Bind property change events
  content.querySelectorAll('input[data-prop]').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      const prop = e.target.dataset.prop;
      const val = e.target.type === 'number' ? parseInt(e.target.value) : e.target.value;
      pushUndo();
      state.commands[idx][prop] = val;
      state.currentMacro.dirty = true;
      renderCommands();
    });
  });
}

// ── Add Command ──────────────────────────────────────────────
function addCommand(type) {
  pushUndo();
  const insertAt = state.selectedIndices.size > 0 ? Math.max(...state.selectedIndices) + 1 : state.commands.length;
  let cmd;
  switch (type) {
    case 'KeyDown': cmd = { type, keyCode: 65, device: 1 }; break;
    case 'KeyUp': cmd = { type, keyCode: 65, device: 1 }; break;
    case 'LeftDown': case 'LeftUp': case 'RightDown': case 'RightUp': cmd = { type }; break;
    case 'Delay': cmd = { type, value: 100 }; break;
    case 'RandomDelay': cmd = { type, min: 50, max: 150 }; break;
    case 'MouseMove': cmd = { type, x: 0, y: 0 }; break;
    case 'GoTo': cmd = { type, targetLine: 1 }; break;
    case 'GoWhile': cmd = { type, startLine: 1, count: 10 }; break;
    case 'Comment': cmd = { type, value: 'New comment' }; break;
    case 'ColorDetect': cmd = { type, x: 0, y: 0, color: 'FF0000', tolerance: 10 }; break;
    case 'Variable': cmd = { type, varName: 'var1', operation: '=', varValue: 0 }; break;
    default: cmd = { type }; break;
  }
  state.commands.splice(insertAt, 0, cmd);
  state.currentMacro.dirty = true;
  state.selectedIndices.clear();
  state.selectedIndices.add(insertAt);
  renderCommands();
  showCommandProperties(insertAt);
}

// ── Undo / Redo ──────────────────────────────────────────────
function pushUndo() {
  state.undoStack.push(JSON.parse(JSON.stringify(state.commands)));
  if (state.undoStack.length > 50) state.undoStack.shift();
  state.redoStack = [];
}

function undo() {
  if (state.undoStack.length === 0) return;
  state.redoStack.push(JSON.parse(JSON.stringify(state.commands)));
  state.commands = state.undoStack.pop();
  state.currentMacro.dirty = true;
  renderCommands();
}

function redo() {
  if (state.redoStack.length === 0) return;
  state.undoStack.push(JSON.parse(JSON.stringify(state.commands)));
  state.commands = state.redoStack.pop();
  state.currentMacro.dirty = true;
  renderCommands();
}

// ── Cut / Copy / Paste / Delete / Move ───────────────────────
function cutSelected() {
  if (state.selectedIndices.size === 0) return;
  pushUndo();
  state.clipboard = [...state.selectedIndices].sort((a,b) => a-b).map(i => ({...state.commands[i]}));
  deleteSelectedInternal();
  renderCommands();
}

function copySelected() {
  if (state.selectedIndices.size === 0) return;
  state.clipboard = [...state.selectedIndices].sort((a,b) => a-b).map(i => ({...state.commands[i]}));
  showToast(`Copied ${state.clipboard.length} command(s)`, 'info');
}

function pasteCommands() {
  if (state.clipboard.length === 0) return;
  pushUndo();
  const insertAt = state.selectedIndices.size > 0 ? Math.max(...state.selectedIndices) + 1 : state.commands.length;
  const copies = state.clipboard.map(c => JSON.parse(JSON.stringify(c)));
  state.commands.splice(insertAt, 0, ...copies);
  state.currentMacro.dirty = true;
  state.selectedIndices.clear();
  copies.forEach((_, j) => state.selectedIndices.add(insertAt + j));
  renderCommands();
}

function deleteSelected() {
  if (state.selectedIndices.size === 0) return;
  pushUndo();
  deleteSelectedInternal();
  renderCommands();
}

function deleteSelectedInternal() {
  const indices = [...state.selectedIndices].sort((a,b) => b-a);
  indices.forEach(i => state.commands.splice(i, 1));
  state.selectedIndices.clear();
  state.currentMacro.dirty = true;
}

function moveSelected(dir) {
  if (state.selectedIndices.size !== 1) return;
  const idx = [...state.selectedIndices][0];
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= state.commands.length) return;
  pushUndo();
  [state.commands[idx], state.commands[newIdx]] = [state.commands[newIdx], state.commands[idx]];
  state.selectedIndices.clear();
  state.selectedIndices.add(newIdx);
  state.currentMacro.dirty = true;
  renderCommands();
}

function toggleBreakpoint(i) {
  state.commands[i].breakpoint = !state.commands[i].breakpoint;
  renderCommands();
}

function editCommandInline(i) { showCommandProperties(i); }

// ── Keyboard Viz ─────────────────────────────────────────────
function updateKeyboardViz() {
  $$('.keyboard-viz__key').forEach(k => k.classList.remove('keyboard-viz__key--active'));
  state.selectedIndices.forEach(i => {
    const cmd = state.commands[i];
    if (cmd && (cmd.type === 'KeyDown' || cmd.type === 'KeyUp')) {
      const key = $(`.keyboard-viz__key[data-key="${cmd.keyCode}"]`);
      if (key) key.classList.add('keyboard-viz__key--active');
    }
  });
}

// ── .amc / .krm Import ──────────────────────────────────────
function parseAmcXml(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');
  if (doc.querySelector('parsererror')) return null;
  const syntaxNode = doc.querySelector('KeyDown > Syntax') || doc.querySelector('Syntax');
  if (!syntaxNode) return null;
  const lines = syntaxNode.textContent.split(/\r?\n/).filter(l => l.trim());
  const commands = [];
  lines.forEach(line => {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    switch (cmd) {
      case 'keydown': commands.push({ type: 'KeyDown', keyCode: parseInt(parts[1]) || 0, device: parseInt(parts[2]) || 1 }); break;
      case 'keyup': commands.push({ type: 'KeyUp', keyCode: parseInt(parts[1]) || 0, device: parseInt(parts[2]) || 1 }); break;
      case 'leftdown': commands.push({ type: 'LeftDown' }); break;
      case 'leftup': commands.push({ type: 'LeftUp' }); break;
      case 'rightdown': commands.push({ type: 'RightDown' }); break;
      case 'rightup': commands.push({ type: 'RightUp' }); break;
      case 'delay': commands.push({ type: 'Delay', value: parseInt(parts[1]) || 100 }); break;
      case 'gowhile': commands.push({ type: 'GoWhile', startLine: parseInt(parts[1]) || 1, count: parseInt(parts[2]) || 1 }); break;
      case 'goto': commands.push({ type: 'GoTo', targetLine: parseInt(parts[1]) || 1 }); break;
      case 'mousemove': commands.push({ type: 'MouseMove', x: parseInt(parts[1]) || 0, y: parseInt(parts[2]) || 0 }); break;
    }
  });
  return { commands, name: 'Imported Macro' };
}

function exportToAmc(commands, name) {
  let syntax = '';
  commands.forEach(cmd => {
    switch (cmd.type) {
      case 'KeyDown': syntax += `KeyDown ${cmd.keyCode} ${cmd.device || 1}\n`; break;
      case 'KeyUp': syntax += `KeyUp ${cmd.keyCode} ${cmd.device || 1}\n`; break;
      case 'LeftDown': syntax += 'LeftDown\n'; break;
      case 'LeftUp': syntax += 'LeftUp\n'; break;
      case 'RightDown': syntax += 'RightDown\n'; break;
      case 'RightUp': syntax += 'RightUp\n'; break;
      case 'Delay': syntax += `Delay ${cmd.value}\n`; break;
      case 'GoWhile': syntax += `GoWhile ${cmd.startLine} ${cmd.count}\n`; break;
      case 'GoTo': syntax += `GoTo ${cmd.targetLine}\n`; break;
      case 'MouseMove': syntax += `MouseMove ${cmd.x} ${cmd.y}\n`; break;
    }
  });
  return `<Root>\n  <DefaultMacro>\n    <KeyDown>\n      <Syntax>\n${syntax}      </Syntax>\n    </KeyDown>\n  </DefaultMacro>\n</Root>`;
}

// ── Context Menus ────────────────────────────────────────────
function showCommandContextMenu(e, index) {
  e.preventDefault();
  if (!state.selectedIndices.has(index)) {
    state.selectedIndices.clear();
    state.selectedIndices.add(index);
    renderCommands();
  }
  const menu = $('#context-menu');
  menu.innerHTML = `
    <button class="context-menu__item" data-action="cut">✂ Cut<span class="context-menu__shortcut">Ctrl+X</span></button>
    <button class="context-menu__item" data-action="copy">📋 Copy<span class="context-menu__shortcut">Ctrl+C</span></button>
    <button class="context-menu__item" data-action="paste">📌 Paste<span class="context-menu__shortcut">Ctrl+V</span></button>
    <div class="context-menu__separator"></div>
    <button class="context-menu__item" data-action="duplicate">⧉ Duplicate</button>
    <button class="context-menu__item" data-action="toggle-bp">⏸ Toggle Breakpoint</button>
    <div class="context-menu__separator"></div>
    <button class="context-menu__item context-menu__item--danger" data-action="delete">🗑 Delete<span class="context-menu__shortcut">Del</span></button>
  `;
  positionContextMenu(menu, e);
  menu.querySelectorAll('[data-action]').forEach(btn => {
    btn.onclick = () => {
      hideContextMenu();
      switch (btn.dataset.action) {
        case 'cut': cutSelected(); break;
        case 'copy': copySelected(); break;
        case 'paste': pasteCommands(); break;
        case 'duplicate': copySelected(); pasteCommands(); break;
        case 'toggle-bp': toggleBreakpoint(index); break;
        case 'delete': deleteSelected(); break;
      }
    };
  });
}

function showFileContextMenu(e, item) {
  e.preventDefault();
  const menu = $('#context-menu');
  menu.innerHTML = `
    <button class="context-menu__item" data-action="open">📂 Open</button>
    <button class="context-menu__item" data-action="rename">✎ Rename</button>
    <button class="context-menu__item" data-action="export">📤 Export</button>
    <div class="context-menu__separator"></div>
    <button class="context-menu__item context-menu__item--danger" data-action="delete">🗑 Delete</button>
  `;
  positionContextMenu(menu, e);
  menu.querySelectorAll('[data-action]').forEach(btn => {
    btn.onclick = () => {
      hideContextMenu();
      switch (btn.dataset.action) {
        case 'open': openMacro(item); break;
        case 'delete': deleteMacroFile(item); break;
        case 'export': exportMacro(); break;
      }
    };
  });
}

function positionContextMenu(menu, e) {
  menu.classList.add('context-menu--visible');
  let x = e.clientX, y = e.clientY;
  const rect = menu.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 4;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 4;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

function hideContextMenu() { $('#context-menu').classList.remove('context-menu--visible'); }

// ── UI Updates ───────────────────────────────────────────────
function updateMacroSettings() {
  $('#loop-enabled').checked = state.macroSettings.loop;
  $('#loop-count').value = state.macroSettings.loopCount || 0;
  $('#loop-count-field').style.display = state.macroSettings.loop ? 'block' : 'none';
  $('#random-delays').checked = state.macroSettings.randomDelays;
  $('#bind-key-input').value = state.macroSettings.bindKey || '';
  $('#window-bind-input').value = state.macroSettings.windowBind || '';
}

function updateStatusBar() {
  $('#statusbar-profile').textContent = state.currentProfile;
  const macroNameEl = $('#statusbar-macro-name span');
  macroNameEl.textContent = state.currentMacro ? `${state.currentMacro.name}${state.currentMacro.dirty ? ' •' : ''}` : 'No macro open';
  $('#statusbar-commands span').textContent = `${state.commands.length} commands`;
}

async function deleteMacroFile(item) {
  showModal('Delete Macro', `<p>Are you sure you want to delete <strong>${item.name}</strong>?</p>`, [
    { label: 'Cancel', type: 'secondary', action: () => {} },
    { label: 'Delete', type: 'danger', action: async () => {
      try { await window.kyrun.deleteMacro(item.path); } catch {}
      if (state.currentMacro && state.currentMacro.path === item.path) {
        state.currentMacro = null; state.commands = [];
        $('#editor-content').classList.add('hidden');
        $('#welcome-view').classList.remove('hidden');
      }
      loadFileTree();
      showToast('Macro deleted', 'info');
    }}
  ]);
}

async function exportMacro() {
  if (!state.currentMacro) return;
  try {
    const filePath = await window.kyrun.exportFileDialog(state.currentMacro.name);
    if (!filePath) return;
    let content;
    if (filePath.endsWith('.amc')) content = exportToAmc(state.commands, state.currentMacro.name);
    else content = JSON.stringify({ name: state.currentMacro.name, commands: state.commands, settings: state.macroSettings }, null, 2);
    await window.kyrun.saveMacroFile(filePath, content);
    showToast('Exported successfully', 'success');
  } catch { showToast('Export (demo mode)', 'info'); }
}

// ── Keyboard Viz Click Handler ───────────────────────────────
$$('.keyboard-viz__key').forEach(key => {
  key.addEventListener('click', () => {
    const keyCode = parseInt(key.dataset.key);
    if (!state.currentMacro) return;
    addCommand('KeyDown');
    const lastIdx = state.commands.length - 1;
    state.commands[lastIdx].keyCode = keyCode;
    addCommand('Delay');
    addCommand('KeyUp');
    state.commands[state.commands.length - 1].keyCode = keyCode;
    renderCommands();
  });
});

// ── Event Bindings ───────────────────────────────────────────
$('#btn-minimize').onclick = () => { try { window.kyrun.minimize(); } catch {} };
$('#btn-maximize').onclick = () => { try { window.kyrun.maximize(); } catch {} };
$('#btn-close').onclick = () => { try { window.kyrun.close(); } catch {} };
$('#modal-close').onclick = hideModal;
$('#modal-overlay').onclick = (e) => { if (e.target === e.currentTarget) hideModal(); };

$('#profile-dropdown').onchange = async (e) => {
  state.currentProfile = e.target.value;
  try { await window.kyrun.switchProfile(state.currentProfile); } catch {}
  loadFileTree();
  state.currentMacro = null; state.commands = [];
  $('#editor-content').classList.add('hidden');
  $('#welcome-view').classList.remove('hidden');
  updateStatusBar();
};

$('#btn-add-profile').onclick = () => {
  showModal('New Profile', '<input type="text" class="properties-panel__input" id="new-profile-name" placeholder="Profile name...">', [
    { label: 'Cancel', type: 'secondary', action: () => {} },
    { label: 'Create', type: 'primary', action: async () => {
      const name = document.getElementById('new-profile-name').value.trim();
      if (!name) return;
      try { await window.kyrun.createProfile(name); } catch {}
      state.currentProfile = name;
      loadProfiles();
      loadFileTree();
      showToast(`Profile "${name}" created`, 'success');
    }}
  ]);
};

$('#btn-delete-profile').onclick = () => {
  if (state.currentProfile === 'Default') { showToast('Cannot delete default profile', 'error'); return; }
  showModal('Delete Profile', `<p>Delete profile <strong>${state.currentProfile}</strong>?</p>`, [
    { label: 'Cancel', type: 'secondary', action: () => {} },
    { label: 'Delete', type: 'danger', action: async () => {
      try { await window.kyrun.deleteProfile(state.currentProfile); } catch {}
      state.currentProfile = 'Default';
      loadProfiles(); loadFileTree();
      showToast('Profile deleted', 'info');
    }}
  ]);
};

$('#btn-new-macro').onclick = $('#btn-welcome-new').onclick = () => {
  showModal('New Macro', '<input type="text" class="properties-panel__input" id="new-macro-name" placeholder="Macro name...">', [
    { label: 'Cancel', type: 'secondary', action: () => {} },
    { label: 'Create', type: 'primary', action: async () => {
      const name = document.getElementById('new-macro-name').value.trim();
      if (!name) return;
      try { await window.kyrun.createMacro(name); } catch {}
      loadFileTree();
      openMacro({ name, path: `${name}.kyrun`, type: 'macro' });
      showToast(`Macro "${name}" created`, 'success');
    }}
  ]);
};

$('#btn-import-macro').onclick = $('#btn-welcome-import').onclick = async () => {
  try {
    const files = await window.kyrun.importFileDialog();
    if (!files) return;
    files.forEach(f => {
      let data;
      if (f.name.endsWith('.amc') || f.name.endsWith('.krm')) data = parseAmcXml(f.content);
      else data = JSON.parse(f.content);
      if (data) {
        state.commands = data.commands;
        state.currentMacro = { name: data.name || f.name.replace(/\.\w+$/, ''), path: f.name, dirty: true };
        renderCommands();
        showToast(`Imported ${f.name}`, 'success');
      }
    });
    $('#welcome-view').classList.add('hidden');
    $('#editor-content').classList.remove('hidden');
  } catch { showToast('Import not available in demo', 'info'); }
};

// Toolbar buttons
$('#btn-save').onclick = saveMacro;
$('#btn-export').onclick = exportMacro;
$('#btn-undo').onclick = undo;
$('#btn-redo').onclick = redo;
$('#btn-cut').onclick = cutSelected;
$('#btn-copy').onclick = copySelected;
$('#btn-paste').onclick = pasteCommands;
$('#btn-move-up').onclick = () => moveSelected(-1);
$('#btn-move-down').onclick = () => moveSelected(1);

$('#speed-slider').oninput = (e) => {
  state.speedMultiplier = parseInt(e.target.value) / 100;
  $('#speed-value').textContent = `${e.target.value}%`;
};

// Command palette buttons
$$('.command-palette__btn').forEach(btn => {
  btn.onclick = () => { if (state.currentMacro) addCommand(btn.dataset.cmd); };
});

// Macro settings
$('#loop-enabled').onchange = (e) => {
  state.macroSettings.loop = e.target.checked;
  $('#loop-count-field').style.display = e.target.checked ? 'block' : 'none';
  state.currentMacro && (state.currentMacro.dirty = true);
};
$('#loop-count').onchange = (e) => { state.macroSettings.loopCount = parseInt(e.target.value); };
$('#random-delays').onchange = (e) => { state.macroSettings.randomDelays = e.target.checked; };

// Bind key capture
$('#bind-key-input').onclick = function() {
  this.value = 'Press a key...';
  this.classList.add('capturing');
  const handler = (e) => {
    e.preventDefault();
    this.value = getKeyName(e.keyCode);
    state.macroSettings.bindKey = getKeyName(e.keyCode);
    state.currentMacro && (state.currentMacro.dirty = true);
    this.classList.remove('capturing');
    document.removeEventListener('keydown', handler);
  };
  document.addEventListener('keydown', handler);
};

// Anonymous mode toggle
$('#btn-anonymous').onclick = async () => {
  try { state.isAnonymous = await window.kyrun.toggleAnonymous(); } catch { state.isAnonymous = !state.isAnonymous; }
  const el = $('#btn-anonymous');
  el.className = `statusbar__anonymous statusbar__anonymous--${state.isAnonymous ? 'on' : 'off'}`;
  $('#anonymous-text').textContent = `Anonymous: ${state.isAnonymous ? 'ON' : 'OFF'}`;
  showToast(`Anonymous mode ${state.isAnonymous ? 'enabled' : 'disabled'}`, state.isAnonymous ? 'success' : 'info');
};

// Settings view
$('.titlebar__menu-item[data-action="settings"]').onclick = () => {
  if (state.currentView === 'settings') {
    $('#settings-view').classList.remove('settings-view--visible');
    if (state.currentMacro) { $('#editor-content').classList.remove('hidden'); }
    else { $('#welcome-view').classList.remove('hidden'); }
    state.currentView = 'editor';
  } else {
    $('#settings-view').classList.add('settings-view--visible');
    $('#editor-content').classList.add('hidden');
    $('#welcome-view').classList.add('hidden');
    state.currentView = 'settings';
  }
};

// Global keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
  if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
  if (e.ctrlKey && e.key === 'x') { e.preventDefault(); cutSelected(); }
  if (e.ctrlKey && e.key === 'c') { e.preventDefault(); copySelected(); }
  if (e.ctrlKey && e.key === 'v') { e.preventDefault(); pasteCommands(); }
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveMacro(); }
  if (e.key === 'Delete') { e.preventDefault(); deleteSelected(); }
  if (e.key === 'Escape') hideContextMenu();
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.context-menu')) hideContextMenu();
});

// ── Initialize ───────────────────────────────────────────────
(async function init() {
  loadProfiles();
  loadFileTree();
  try {
    const info = await window.kyrun.getAppInfo();
    $('#statusbar-pid').textContent = `PID: ${info.pid}`;
  } catch {
    $('#statusbar-pid').textContent = 'PID: demo';
  }
  updateStatusBar();
})();
