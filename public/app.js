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

function onServiceChange(val) {
  state.selectedService = val;
  updateServiceBadge();
  saveToStorage();
  toast(`Servicio: ${val === 'auto' ? 'Auto round-robin' : val}`, 'info');
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

function switchConversation(id) {
  if (state.streaming) stopStreaming();
  state.currentId = id;
  state.pendingFiles = [];
  saveToStorage();
  renderConversationList();
  renderMessages();
  const conv = state.conversations[id];
  document.getElementById('chat-title-header').textContent = conv?.title || 'Conversación';
  document.getElementById('system-prompt-input').value = conv?.systemPrompt || '';
  document.getElementById('msg-input').focus();
  if (window.innerWidth <= 768) closeMobileSidebar();
}

function deleteConversation(id, e) {
  e.stopPropagation();
  if (!confirm('¿Eliminar esta conversación?')) return;
  delete state.conversations[id];
  if (state.currentId === id) {
    const remaining = Object.keys(state.conversations);
    if (remaining.length > 0) switchConversation(remaining[remaining.length - 1]);
    else newConversation();
  }
  saveToStorage();
  renderConversationList();
}

function clearCurrentConversation() {
  if (!state.currentId) return;
  if (!confirm('¿Limpiar todos los mensajes de esta conversación?')) return;
  state.conversations[state.currentId].messages = [];
  saveToStorage();
  renderMessages();
  toast('Conversación limpiada', 'info');
}

function getCurrentConv() {
  return state.conversations[state.currentId] || null;
}

function updateConvTitle(id, messages) {
  const conv = state.conversations[id];
  if (!conv) return;
  if (messages.length > 0 && conv.title === 'Nueva conversación') {
    const firstUser = messages.find(m => m.role === 'user');
    if (firstUser) {
      conv.title = firstUser.content.slice(0, 48).replace(/\n/g, ' ') + (firstUser.content.length > 48 ? '…' : '');
      document.getElementById('chat-title-header').textContent = conv.title;
    }
  }
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

function addMessageToDOM(msg, idx) {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();
  const inner = document.getElementById('messages-inner');
  const div = document.createElement('div');
  div.innerHTML = renderMessageRow(msg, idx);
  inner.appendChild(div.firstElementChild);
  applyHighlighting();
  scrollToBottom();
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
async function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text && state.pendingFiles.length === 0) return;
  if (state.streaming) return;

  const conv = getCurrentConv();
  if (!conv) return;

  // Build user message
  // msg.content = only the user's typed text (stored in history, sent to model)
  // fileContents = file data injected into API call only, not persisted in history
  const userMsg = {
    role: 'user',
    content: text,                             // only typed text stored in history
    displayText: text,
    rawText: text,
    files: state.pendingFiles.map(f => ({
      name: f.name,
      mimeType: f.mimeType,
      size: f.size,
      displayType: f.displayType,
      preview: f.displayType === 'image' ? f.content : null,
      // Store truncated file content for the API call (not re-sent in follow-up messages)
      fileContent: f.displayType === 'text' ? truncateFileContent(f.content, f.name) : null,
    })),
  };

  conv.messages.push(userMsg);
  updateConvTitle(state.currentId, conv.messages);
  saveToStorage();

  // Render user message
  addMessageToDOM(userMsg, conv.messages.length - 1);

  // Clear input
  input.value = '';
  autoResize(input);
  clearFilePreviews();
  input.focus();

  // Start streaming
  await streamResponse(conv);
}

// Max chars of file content to send to the model (~6000 chars ≈ ~1500 tokens)
const MAX_FILE_CHARS = 6000;

function truncateFileContent(text, filename) {
  if (!text) return '';
  if (text.length <= MAX_FILE_CHARS) return text;
  const half = Math.floor(MAX_FILE_CHARS / 2);
  return text.slice(0, half)
    + `\n\n[... contenido truncado — ${text.length.toLocaleString()} caracteres en total, mostrando primeros y últimos ${half} ...]\n\n`
    + text.slice(-half);
}

function buildApiContent(msg) {
  // Inject file contents only when building API messages (not stored in history)
  const files = msg.files ?? [];
  if (files.length === 0) return msg.content;

  let extra = '';
  files.forEach(f => {
    if (f.displayType === 'image') {
      extra += `[Imagen adjunta: ${f.name}]\n`;
    } else if (f.fileContent) {
      extra += `\n--- Archivo: ${f.name} ---\n${f.fileContent}\n---\n`;
    } else if (f.displayType === 'binary') {
      extra += `[Archivo binario adjunto: ${f.name} (${f.mimeType})]\n`;
    }
  });

  return (msg.content ? msg.content + '\n\n' : '') + extra.trim();
}

async function streamResponse(conv) {
  setStreaming(true);

  // Build messages for API — inject file contents inline, not stored in history
  const apiMessages = [];
  if (conv.systemPrompt) {
    apiMessages.push({ role: 'system', content: conv.systemPrompt });
  }
  conv.messages.forEach(m => {
    apiMessages.push({ role: m.role, content: buildApiContent(m) });
  });

  // Add typing indicator
  const typingId = addTypingIndicator();

  let fullContent = '';
  let usedService = '';

  try {
    state.abortController = new AbortController();
    const res = await fetch(`${API}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: apiMessages,
        service: state.selectedService === 'auto' ? undefined : state.selectedService,
      }),
      signal: state.abortController.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    removeTypingIndicator(typingId);

    // Add assistant message placeholder
    const assistantMsg = { role: 'assistant', content: '', service: '' };
    conv.messages.push(assistantMsg);
    const msgIdx = conv.messages.length - 1;
    addMessageToDOM(assistantMsg, msgIdx);
    const bubble = document.querySelector(`.msg-row[data-idx="${msgIdx}"] .msg-content`);
    if (bubble) bubble.classList.add('streaming-cursor');

    // Read SSE stream
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          if (parsed.service) {
            usedService = parsed.service;
            conv.usedService = usedService;
          }
          if (parsed.content) {
            fullContent += parsed.content;
            assistantMsg.content = fullContent;
            assistantMsg.service = usedService;
            if (bubble) {
              bubble.innerHTML = renderMarkdown(fullContent);
              applyHighlighting();
            }
            scrollToBottom(false);
          }
          if (parsed.error) throw new Error(parsed.error);
        } catch(e) {
          if (e.message !== 'Unexpected end of JSON input') console.error('Parse error', e);
        }
      }
    }

    // Update final message
    assistantMsg.content = fullContent;
    assistantMsg.service = usedService;
    if (bubble) {
      bubble.classList.remove('streaming-cursor');
      bubble.innerHTML = renderMarkdown(fullContent);
      applyHighlighting();
    }
    // Update label with service tag
    const label = document.querySelector(`.msg-row[data-idx="${msgIdx}"] .msg-label`);
    if (label && usedService) {
      label.innerHTML = `Asistente <span class="svc-tag">${usedService}</span>`;
    }

    saveToStorage();
    renderConversationList();

    // Browser notification
    triggerNotification(usedService);

  } catch (err) {
    removeTypingIndicator(typingId);
    if (err.name === 'AbortError') {
      toast('Respuesta cancelada', 'info');
      if (conv.messages[conv.messages.length - 1]?.role === 'assistant') {
        const lastMsg = conv.messages[conv.messages.length - 1];
        if (!lastMsg.content) conv.messages.pop();
      }
    } else {
      toast('Error al conectar con el servicio AI: ' + err.message, 'error');
      if (conv.messages[conv.messages.length - 1]?.role === 'assistant') conv.messages.pop();
    }
    saveToStorage();
    renderMessages();
  } finally {
    setStreaming(false);
  }
}

function addTypingIndicator() {
  const id = 'typing_' + Date.now();
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();
  const inner = document.getElementById('messages-inner');
  inner.insertAdjacentHTML('beforeend', `
    <div class="msg-row assistant" id="${id}">
      <div class="msg-label">Asistente</div>
      <div class="msg-bubble">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    </div>
  `);
  scrollToBottom();
  return id;
}

function removeTypingIndicator(id) {
  document.getElementById(id)?.remove();
}

function setStreaming(val) {
  state.streaming = val;
  document.getElementById('btn-send').style.display = val ? 'none' : 'flex';
  document.getElementById('btn-stop').style.display = val ? 'flex' : 'none';
  const input = document.getElementById('msg-input');
  input.disabled = val;
  if (!val) input.focus();
}

function stopStreaming() {
  if (state.abortController) state.abortController.abort();
}

// ═══════════════════════════════════════════════════════
//  MESSAGE ACTIONS
// ═══════════════════════════════════════════════════════
function copyMessage(idx) {
  const conv = getCurrentConv();
  if (!conv) return;
  const msg = conv.messages[idx];
  if (!msg) return;
  navigator.clipboard.writeText(msg.content).then(() => toast('Copiado al portapapeles', 'success'));
}

function editMessage(idx) {
  const conv = getCurrentConv();
  if (!conv || state.streaming) return;
  const msg = conv.messages[idx];
  if (!msg || msg.role !== 'user') return;

  const row = document.querySelector(`.msg-row[data-idx="${idx}"]`);
  if (!row) return;

  const bubble = row.querySelector('.msg-bubble');
  const original = msg.rawText || msg.content;

  bubble.innerHTML = `
    <textarea class="msg-edit-area" id="edit_${idx}">${escHtml(original)}</textarea>
    <div class="msg-edit-actions">
      <button class="panel-btn primary" style="font-size:13px;padding:6px 14px" onclick="saveEdit(${idx})">Guardar y regenerar</button>
      <button class="panel-btn ghost" style="font-size:13px;padding:6px 14px" onclick="cancelEdit(${idx})">Cancelar</button>
    </div>
  `;
  document.getElementById(`edit_${idx}`)?.focus();
}

function saveEdit(idx) {
  const conv = getCurrentConv();
  if (!conv) return;
  const textarea = document.getElementById(`edit_${idx}`);
  if (!textarea) return;
  const newText = textarea.value.trim();
  if (!newText) return;

  // Truncate messages from idx onwards and re-send
  conv.messages[idx].content = newText;
  conv.messages[idx].rawText = newText;
  conv.messages.splice(idx + 1);
  saveToStorage();
  renderMessages();
  streamResponse(conv);
}

function cancelEdit(idx) { renderMessages(); }

function regenerateFrom(idx) {
  const conv = getCurrentConv();
  if (!conv || state.streaming) return;
  // Remove from idx onwards and re-stream
  conv.messages.splice(idx);
  saveToStorage();
  renderMessages();
  streamResponse(conv);
}

function copyCodeBlock(btn) {
  const code = btn.closest('.code-block-wrapper').querySelector('code');
  if (!code) return;
  navigator.clipboard.writeText(code.innerText).then(() => {
    btn.classList.add('copied');
    btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copiado`;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copiar`;
    }, 2000);
  });
}

// ═══════════════════════════════════════════════════════
//  FILE HANDLING
// ═══════════════════════════════════════════════════════
async function handleFileInput(event) {
  const files = Array.from(event.target.files);
  event.target.value = '';
  for (const file of files) await processFile(file);
}

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

function removeFile(idx) {
  state.pendingFiles.splice(idx, 1);
  renderFilePreviews();
}

function clearFilePreviews() {
  state.pendingFiles = [];
  renderFilePreviews();
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

function openLightbox(src) {
  let lb = document.getElementById('lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'lightbox';
    lb.innerHTML = '<div class="lb-overlay"></div><div class="lb-content"><img id="lb-img"/><button class="lb-close" onclick="closeLightbox()"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
    lb.querySelector('.lb-overlay').onclick = closeLightbox;
    document.body.appendChild(lb);
  }
  document.getElementById('lb-img').src = src;
  lb.classList.add('open');
  document.addEventListener('keydown', lbKeyHandler);
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

function saveSystemPrompt() {
  const conv = getCurrentConv();
  if (!conv) return;
  conv.systemPrompt = document.getElementById('system-prompt-input').value;
  saveToStorage();
  toast('System prompt guardado', 'success');
}

function clearSystemPrompt() {
  document.getElementById('system-prompt-input').value = '';
  const conv = getCurrentConv();
  if (conv) { conv.systemPrompt = ''; saveToStorage(); }
  toast('System prompt limpiado', 'info');
}

const TEMPLATES = {
  python: 'Eres un experto desarrollador Python. Siempre escribes código limpio, bien documentado con docstrings, siguiendo PEP 8. Explica cada parte del código con claridad.',
  translator: 'Eres un traductor profesional experto. Traduce con precisión manteniendo el tono, estilo y matices del texto original. Si hay ambigüedad, indica las opciones.',
  analyst: 'Eres un analista de datos experto. Estructura tu análisis con: 1) Resumen ejecutivo, 2) Hallazgos clave, 3) Visualizaciones sugeridas, 4) Recomendaciones accionables.',
  writer: 'Eres un escritor creativo con prosa elegante y voz distintiva. Usa metáforas originales, ritmo variado y detalles sensoriales. Evita clichés y frases genéricas.',
};

function applyTemplate(key) {
  const tpl = TEMPLATES[key];
  if (tpl) {
    document.getElementById('system-prompt-input').value = tpl;
    toast('Plantilla aplicada — haz clic en Guardar', 'info');
  }
}

// ═══════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════
function openExport() {
  const conv = getCurrentConv();
  if (!conv || conv.messages.length === 0) { toast('No hay mensajes para exportar', 'info'); return; }
  document.getElementById('export-panel').classList.add('open');
}
function closeExport() { document.getElementById('export-panel').classList.remove('open'); }

function exportAs(format) {
  const conv = getCurrentConv();
  if (!conv) return;
  let content = '', ext = '', mime = '';

  if (format === 'markdown') {
    content = `# ${conv.title}\n\n_Exportado: ${new Date().toLocaleString()}_\n\n---\n\n`;
    if (conv.systemPrompt) content += `**System Prompt:** ${conv.systemPrompt}\n\n---\n\n`;
    conv.messages.forEach(m => {
      content += `## ${m.role === 'user' ? '👤 Tú' : `🤖 Asistente${m.service ? ` (${m.service})` : ''}`}\n\n${m.content}\n\n---\n\n`;
    });
    ext = 'md'; mime = 'text/markdown';
  } else if (format === 'json') {
    content = JSON.stringify({ title: conv.title, exportedAt: new Date().toISOString(), systemPrompt: conv.systemPrompt, messages: conv.messages.map(m => ({ role: m.role, content: m.content, service: m.service })) }, null, 2);
    ext = 'json'; mime = 'application/json';
  } else {
    content = `${conv.title}\nExportado: ${new Date().toLocaleString()}\n${'='.repeat(50)}\n\n`;
    conv.messages.forEach(m => {
      content += `[${m.role === 'user' ? 'TÚ' : `ASISTENTE${m.service ? ` - ${m.service}` : ''}`}]\n${m.content}\n\n${'-'.repeat(40)}\n\n`;
    });
    ext = 'txt'; mime = 'text/plain';
  }

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `neuralchat-${conv.title.slice(0,30).replace(/\s+/g,'-')}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
  closeExport();
  toast(`Exportado como .${ext}`, 'success');
}

// ═══════════════════════════════════════════════════════
//  THEME
// ═══════════════════════════════════════════════════════
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  updateThemeUI();
  // Swap hljs theme
  const hljsLink = document.getElementById('hljs-theme');
  hljsLink.href = next === 'dark'
    ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/tokyo-night-dark.min.css'
    : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
  saveToStorage();
}

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
async function triggerNotification(service) {
  if (document.hasFocus()) return;
  if ('Notification' in window) {
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission === 'granted') {
      new Notification('NeuralChat', {
        body: `${service || 'AI'} ha respondido`,
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%237c6af7'/><text x='50%' y='55%' dominant-baseline='middle' text-anchor='middle' font-size='18'>⚡</text></svg>",
      });
    }
  }
}

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

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
  // Shift+Enter = nueva línea (comportamiento por defecto)
}

// ═══════════════════════════════════════════════════════
//  SIDEBAR
// ═══════════════════════════════════════════════════════
function toggleSidebar() {
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.toggle('mobile-open');
  } else {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    state.sidebarOpen = !sidebar.classList.contains('collapsed');
  }
}

function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
}

// ═══════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 220) + 'px';
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function useChip(text) {
  const input = document.getElementById('msg-input');
  input.value = text;
  autoResize(input);
  input.focus();
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