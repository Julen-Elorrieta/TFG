// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
const API = '';  // same origin
let state = {
  conversations: {},      // id → { id, title, messages, systemPrompt, createdAt }
  currentId: null,
  selectedService: 'auto',
  pendingFiles: [],       // { name, type, content, mimeType, displayType }
  streaming: false,
  abortController: null,
  sidebarOpen: true,
};

// ── Init ─────────────────────────────────────────────
function init() {
  loadFromStorage();
  loadServices();
  renderConversationList();
  applyTheme();
  setupDragDrop();
  setupKeyboardShortcuts();

  // Start a fresh conversation if none
  if (!state.currentId) newConversation();
  else renderMessages();
}

// ═══════════════════════════════════════════════════════
//  STORAGE
// ═══════════════════════════════════════════════════════
function saveToStorage() {
  try {
    // Don't save pending files (they're session-only)
    const toSave = {
      conversations: state.conversations,
      currentId: state.currentId,
      selectedService: state.selectedService,
      theme: document.documentElement.getAttribute('data-theme'),
    };
    localStorage.setItem('neuralchat_state', JSON.stringify(toSave));
  } catch(e) { console.warn('Storage save failed', e); }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('neuralchat_state');
    if (!raw) return;
    const saved = JSON.parse(raw);
    // Migrate: strip any huge file content accidentally stored in msg.content
    const convs = saved.conversations || {};
    Object.values(convs).forEach(conv => {
      (conv.messages || []).forEach(msg => {
        if (msg.role === 'user' && msg.rawText !== undefined) {
          // Restore clean content from rawText if it was bloated
          msg.content = msg.rawText || msg.content;
          msg.displayText = msg.rawText || msg.displayText || msg.content;
        }
        // Remove stored fileContent from files (not needed in history)
        (msg.files || []).forEach(f => { delete f.fileContent; });
      });
    });
    state.conversations = convs;
    state.currentId = saved.currentId || null;
    state.selectedService = saved.selectedService || 'auto';
    if (saved.theme) document.documentElement.setAttribute('data-theme', saved.theme);
    updateThemeUI();
  } catch(e) { console.warn('Storage load failed', e); }
}

// ═══════════════════════════════════════════════════════
//  SERVICES
// ═══════════════════════════════════════════════════════
async function loadServices() {
  try {
    const res = await fetch(`${API}/services`);
    const data = await res.json();
    const select = document.getElementById('service-select');
    select.innerHTML = '';
    data.services.forEach(svc => {
      const opt = document.createElement('option');
      opt.value = svc;
      opt.textContent = svc === 'auto' ? 'Auto (Round-robin)' : svc.charAt(0).toUpperCase() + svc.slice(1);
      if (svc === state.selectedService) opt.selected = true;
      select.appendChild(opt);
    });
    updateServiceBadge();
  } catch(e) {
    // Fallback: populate with known services
    const select = document.getElementById('service-select');
    ['auto','groq','cerebras'].forEach(svc => {
      const opt = document.createElement('option');
      opt.value = svc;
      opt.textContent = svc === 'auto' ? 'Auto (Round-robin)' : svc.charAt(0).toUpperCase() + svc.slice(1);
      if (svc === state.selectedService) opt.selected = true;
      select.appendChild(opt);
    });
    updateServiceBadge();
  }
}


function updateServiceBadge() {
  const badge = document.getElementById('current-service-badge');
  badge.textContent = state.selectedService.toUpperCase();
}

// ═══════════════════════════════════════════════════════
//  CONVERSATIONS
// ═══════════════════════════════════════════════════════
function newConversation() {
  const id = 'conv_' + Date.now();
  state.conversations[id] = {
    id, title: 'Nueva conversación',
    messages: [], systemPrompt: '',
    createdAt: Date.now(), usedService: null,
  };
  state.currentId = id;
  state.pendingFiles = [];
  saveToStorage();
  renderConversationList();
  renderMessages();
  document.getElementById('chat-title-header').textContent = 'Nueva conversación';
  document.getElementById('msg-input').focus();
  if (window.innerWidth <= 768) closeMobileSidebar();
}




function getCurrentConv() {
  return state.conversations[state.currentId] || null;
}


// ═══════════════════════════════════════════════════════
//  RENDER CONVERSATIONS LIST
// ═══════════════════════════════════════════════════════
function renderConversationList() {
  const list = document.getElementById('conversations-list');
  const convs = Object.values(state.conversations).sort((a, b) => b.createdAt - a.createdAt);

  if (convs.length === 0) {
    list.innerHTML = '<div class="empty-conversations">No hay conversaciones aún.<br/>Empieza una nueva.</div>';
    return;
  }

  list.innerHTML = convs.map(c => `
    <div class="conv-item ${c.id === state.currentId ? 'active' : ''}" onclick="switchConversation('${c.id}')">
      <div class="conv-icon">${getConvIcon(c)}</div>
      <div class="conv-meta">
        <div class="conv-title">${escHtml(c.title)}</div>
        <div class="conv-preview">${c.messages.length} mensaje${c.messages.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="conv-actions">
        <button class="conv-action-btn del" onclick="deleteConversation('${c.id}', event)" title="Eliminar">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        </button>
      </div>
    </div>
  `).join('');
}

function getConvIcon(conv) {
  if (conv.messages.length === 0) return '💬';
  const svc = conv.usedService;
  if (svc === 'Groq') return '⚡';
  if (svc === 'Cerebras') return '🧠';
  return '💬';
}

// ═══════════════════════════════════════════════════════
//  RENDER MESSAGES
// ═══════════════════════════════════════════════════════
function renderMessages() {
  const inner = document.getElementById('messages-inner');
  const conv = getCurrentConv();

  if (!conv || conv.messages.length === 0) {
    inner.innerHTML = `<div id="welcome">
      <div class="welcome-logo">⚡</div>
      <div class="welcome-title">NeuralChat</div>
      <div class="welcome-sub">Chat profesional con múltiples modelos de IA. Envía texto, imágenes, PDFs y cualquier tipo de archivo.</div>
      <div class="welcome-chips">
        <button class="welcome-chip" onclick="useChip('Explícame cómo funciona la IA en términos simples')">¿Cómo funciona la IA?</button>
        <button class="welcome-chip" onclick="useChip('Escribe un script en Python para analizar datos CSV')">Script Python CSV</button>
        <button class="welcome-chip" onclick="useChip('Resume los puntos clave de este documento')">Resumir documento</button>
        <button class="welcome-chip" onclick="useChip('¿Cuáles son las mejores prácticas en desarrollo web?')">Mejores prácticas web</button>
      </div>
    </div>`;
    return;
  }

  inner.innerHTML = conv.messages.map((msg, idx) => renderMessageRow(msg, idx)).join('');
  applyHighlighting();
  scrollToBottom();
}

function renderMessageRow(msg, idx) {
  const isUser = msg.role === 'user';
  // For user messages: show displayText (typed text only), not the full content with file data
  const displayContent = isUser
    ? escHtml(msg.displayText ?? msg.content).replace(/\n/g, '<br>')
    : renderMarkdown(msg.content);
  const filesHtml = (msg.files && msg.files.length > 0)
    ? `<div class="msg-files">${msg.files.map(f => renderFileChip(f)).join('')}</div>`
    : '';

  const svcTag = (!isUser && msg.service) ? `<span class="svc-tag">${msg.service}</span>` : '';

  return `<div class="msg-row ${msg.role}" data-idx="${idx}">
    <div class="msg-label">${isUser ? 'Tú' : `Asistente ${svcTag}`}</div>
    <div class="msg-bubble">
      ${filesHtml}
      <div class="msg-content">${displayContent}</div>
    </div>
    <div class="msg-actions">
      <button class="msg-action-btn" onclick="copyMessage(${idx})" title="Copiar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        Copiar
      </button>
      ${isUser ? `<button class="msg-action-btn" onclick="editMessage(${idx})" title="Editar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Editar
      </button>` : `<button class="msg-action-btn" onclick="regenerateFrom(${idx})" title="Regenerar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
        Regenerar
      </button>`}
    </div>
  </div>`;
}


function renderMarkdown(text) {
  if (!text) return '';
  try {
    // Pre-process code blocks for syntax highlighting + copy button
    let processed = text;
    const html = marked.parse(processed, { breaks: true, gfm: true });
    // Wrap pre>code with custom container
    return html.replace(/<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g, (_, lang, code) => {
      return `<div class="code-block-wrapper">
        <div class="code-block-header">
          <span class="code-lang">${escHtml(lang)}</span>
          <button class="btn-copy-code" onclick="copyCodeBlock(this)">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            Copiar
          </button>
        </div>
        <pre><code class="language-${escHtml(lang)}">${code}</code></pre>
      </div>`;
    }).replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (_, code) => {
      return `<div class="code-block-wrapper">
        <div class="code-block-header">
          <span class="code-lang">texto</span>
          <button class="btn-copy-code" onclick="copyCodeBlock(this)">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            Copiar
          </button>
        </div>
        <pre><code>${code}</code></pre>
      </div>`;
    });
  } catch(e) { return escHtml(text); }
}

function applyHighlighting() {
  document.querySelectorAll('.code-block-wrapper pre code').forEach(block => {
    if (!block.dataset.highlighted) {
      hljs.highlightElement(block);
      block.dataset.highlighted = 'yes';
    }
  });
}

function scrollToBottom(smooth = true) {
  const c = document.getElementById('messages-container');
  c.scrollTo({ top: c.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
}

// ═══════════════════════════════════════════════════════
//  SEND MESSAGE
// ═══════════════════════════════════════════════════════

// Max chars of file content to send to the model (~6000 chars ≈ ~1500 tokens)







function stopStreaming() {
  if (state.abortController) state.abortController.abort();
}

// ═══════════════════════════════════════════════════════
//  MESSAGE ACTIONS
// ═══════════════════════════════════════════════════════






// ═══════════════════════════════════════════════════════
//  FILE HANDLING
// ═══════════════════════════════════════════════════════

async function processFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  toast(`Procesando ${file.name}...`, 'info');
  try {
    const res = await fetch(`${API}/upload`, { method: 'POST', body: formData });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    state.pendingFiles.push({
      name: data.filename,
      mimeType: data.mimeType,
      content: data.content,
      displayType: data.type,
      size: data.size ?? null,
    });
    renderFilePreviews();
    toast(`${data.filename} listo`, 'success');
  } catch(e) {
    toast(`Error procesando ${file.name}: ${e.message}`, 'error');
  }
}

function renderFilePreviews() {
  const container = document.getElementById('file-previews');
  container.innerHTML = state.pendingFiles.map((f, i) => {
    if (f.displayType === 'image' && f.content) {
      return `<div class="file-preview-chip img-preview-chip">
        <img class="fp-thumb" src="data:${f.mimeType};base64,${f.content}" alt="${escHtml(f.name)}"/>
        <button class="fp-remove" onclick="removeFile(${i})">✕</button>
      </div>`;
    }
    return `<div class="file-preview-chip">
      <span class="fp-icon">${getFileIcon(f.mimeType)}</span>
      <div style="display:flex;flex-direction:column;gap:1px;min-width:0;flex:1">
        <span class="fp-name">${escHtml(f.name)}</span>
        <span class="fp-type">${getFileLabel(f.mimeType, f.name)}${f.size ? ' · ' + formatFileSize(f.size) : ''}</span>
      </div>
      <button class="fp-remove" onclick="removeFile(${i})">✕</button>
    </div>`;
  }).join('');
}



function getFileIcon(mimeType) {
  if (!mimeType) return '📎';
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType === 'application/pdf') return '📄';
  if (mimeType.includes('json')) return '🔧';
  if (mimeType.includes('csv')) return '📊';
  if (mimeType.startsWith('text/')) return '📝';
  return '📎';
}

function getFileLabel(mimeType, filename) {
  if (!mimeType) return 'Archivo';
  if (mimeType.startsWith('image/')) return mimeType.split('/')[1].toUpperCase();
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.includes('json')) return 'JSON';
  if (mimeType.includes('csv')) return 'CSV';
  const ext = filename?.split('.').pop()?.toUpperCase();
  if (ext) return ext;
  if (mimeType.startsWith('text/')) return 'TEXTO';
  return 'ARCHIVO';
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function renderFileChip(f) {
  const label = getFileLabel(f.mimeType, f.name);
  const size = f.size ? formatFileSize(f.size) : '';

  if (f.displayType === 'image' && f.preview) {
    // Image: thumbnail with click-to-expand
    return `<div class="msg-file-chip img-chip" onclick="openLightbox('data:${f.mimeType};base64,${f.preview}')" title="Ampliar imagen">
      <img class="fc-thumb" src="data:${f.mimeType};base64,${f.preview}" alt="${escHtml(f.name)}"/>
      <div class="fc-thumb-overlay">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
      </div>
    </div>`;
  }

  // Document / text / binary: compact info chip
  const icon = getFileIcon(f.mimeType);
  return `<div class="msg-file-chip doc-chip">
    <span class="fc-icon">${icon}</span>
    <div class="fc-info">
      <div class="fc-name">${escHtml(f.name)}</div>
      <div class="fc-meta">${label}${size ? ' · ' + size : ''}</div>
    </div>
  </div>`;
}


function closeLightbox() {
  document.getElementById('lightbox')?.classList.remove('open');
  document.removeEventListener('keydown', lbKeyHandler);
}

function lbKeyHandler(e) {
  if (e.key === 'Escape') closeLightbox();
}

// ── Drag & Drop ──────────────────────────────────────
function setupDragDrop() {
  const wrap = document.getElementById('textarea-wrap');
  const body = document.body;

  body.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('drag-over'); });
  body.addEventListener('dragleave', e => {
    if (!e.relatedTarget || !body.contains(e.relatedTarget)) wrap.classList.remove('drag-over');
  });
  body.addEventListener('drop', async e => {
    e.preventDefault();
    wrap.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) await processFile(file);
  });
}

// ═══════════════════════════════════════════════════════
//  SYSTEM PROMPT
// ═══════════════════════════════════════════════════════
function toggleSystemPanel() {
  const panel = document.getElementById('system-panel');
  const btn = document.getElementById('btn-system');
  const isOpen = panel.classList.toggle('open');
  btn.classList.toggle('active', isOpen);
  if (isOpen) {
    const conv = getCurrentConv();
    document.getElementById('system-prompt-input').value = conv?.systemPrompt || '';
  }
}





// ═══════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════
//  THEME
// ═══════════════════════════════════════════════════════

function updateThemeUI() {
  const theme = document.documentElement.getAttribute('data-theme');
  document.getElementById('theme-label').textContent = theme === 'dark' ? 'Modo claro' : 'Modo oscuro';
}

function applyTheme() {
  const theme = document.documentElement.getAttribute('data-theme');
  updateThemeUI();
  document.getElementById('hljs-theme').href = theme === 'dark'
    ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/tokyo-night-dark.min.css'
    : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
}

// ═══════════════════════════════════════════════════════
//  NOTIFICATIONS
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (state.streaming) stopStreaming();
      document.getElementById('system-panel').classList.remove('open');
      document.getElementById('btn-system').classList.remove('active');
      document.getElementById('export-panel').classList.remove('open');
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); newConversation(); }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); toggleSystemPanel(); }
  });
}


// ═══════════════════════════════════════════════════════
//  SIDEBAR
// ═══════════════════════════════════════════════════════

function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
}

// ═══════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}


function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { info: 'ℹ️', success: '✓', error: '✕' };
  el.innerHTML = `<span>${icons[type]}</span><span>${escHtml(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.2s ease-in forwards';
    setTimeout(() => el.remove(), 200);
  }, 3500);
}

// ═══════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════
init();