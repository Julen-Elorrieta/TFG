import { buildMessageApiContent } from "../modules/chat.js";
import { buildConversationExportArtifact } from "../modules/export.js";
import {
  formatFileSizeLabel,
  getFileTypeIcon,
  getFileTypeLabel,
  truncateFileContentForPrompt,
} from "../modules/files.js";
import { deriveUnusableServiceReason } from "../modules/settings.js";
import {
  autoResize,
  capitalizeFirstLetter,
  escapeHtml,
  setHighlightTheme,
  updateThemeToggleLabel,
} from "../modules/ui.js";

const API = "";

const DEFAULT_MODELS = {
  groq: "moonshotai/kimi-k2-instruct-0905",
  cerebras: "gpt-oss-120b",
  openrouter: "openrouter/auto",
};
const SERVICES = ["groq", "cerebras", "openrouter"];
const DEFAULT_SERVICE_OPTIONS = ["auto", ...SERVICES];
const SERVICE_HEADERS = {
  groq: { key: "X-Groq-Key", model: "X-Groq-Model" },
  cerebras: { key: "X-Cerebras-Key", model: "X-Cerebras-Model" },
  openrouter: { key: "X-Openrouter-Key", model: "X-Openrouter-Model" },
};
const modelLoadTimers = {};
const lastAutoLoadedKeys = {};
const loadedModelCache = {};
const blockedServices = {};
const MODELS_CACHE_KEY = "neuralchat_models_cache_v1";

let state = {
  conversations: {},
  currentId: null,
  selectedService: "auto",
  pendingFiles: [],
  streaming: false,
  abortController: null,
  searchQuery: "",
  apiKeys: {
    groq: { key: "", model: DEFAULT_MODELS.groq, enabled: true },
    cerebras: { key: "", model: DEFAULT_MODELS.cerebras, enabled: true },
    openrouter: { key: "", model: DEFAULT_MODELS.openrouter, enabled: true },
  },
};

function getErrorMessage(error, fallback = "Error desconocido") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function initializeApplication() {
  loadFromStorage();
  renderConversationList();
  applyThemeSetting();
  setupDragDrop();
  setupKeyboardShortcuts();
  loadAvailableServices();
  updateSidebarKeysIndicator();
  if (!state.currentId) newConversation();
  else renderMessages();
  updateInputState();
}

function persistModelsCache() {
  try {
    localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(loadedModelCache));
  } catch (error) {
    console.warn("Models cache save failed", error);
  }
}

function setCachedModels(svc, key, models) {
  loadedModelCache[svc] = { key, models };
  persistModelsCache();
}

function clearCachedModels(svc) {
  loadedModelCache[svc] = null;
  persistModelsCache();
}

function resetAutoLoadedKey(svc) {
  lastAutoLoadedKeys[svc] = "";
}

function loadModelsCacheFromStorage() {
  try {
    const raw = localStorage.getItem(MODELS_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    SERVICES.forEach((svc) => {
      const entry = parsed?.[svc];
      if (
        entry &&
        typeof entry === "object" &&
        typeof entry.key === "string" &&
        Array.isArray(entry.models)
      ) {
        loadedModelCache[svc] = {
          key: entry.key,
          models: entry.models.filter((m) => typeof m === "string"),
        };
      }
    });
  } catch (error) {
    console.warn("Models cache load failed", error);
  }
}

function updateSidebarKeysIndicator() {
  const indicator = document.getElementById("keys-indicator");
  if (!indicator) return;
  const hasKeys = hasAnyApiKey();
  indicator.className = "keys-indicator" + (hasKeys ? " has-keys" : "");
}

function saveToStorage() {
  try {
    const toSave = {
      conversations: state.conversations,
      currentId: state.currentId,
      selectedService: state.selectedService,
      theme: document.documentElement.getAttribute("data-theme"),
      apiKeys: state.apiKeys,
    };
    localStorage.setItem("neuralchat_v2", JSON.stringify(toSave));
  } catch (error) {
    console.warn("Storage save failed", error);
  }
}

function loadFromStorage() {
  try {
    const raw =
      localStorage.getItem("neuralchat_v2") ||
      localStorage.getItem("neuralchat_state");
    if (!raw) return;
    const saved = JSON.parse(raw);
    const convs = saved.conversations || {};
    Object.values(convs).forEach((conv) => {
      (conv.messages || []).forEach((msg) => {
        if (msg.role === "user" && msg.rawText !== undefined) {
          msg.content = msg.rawText || msg.content;
          msg.displayText = msg.rawText || msg.displayText || msg.content;
        }
        (msg.files || []).forEach((f) => {
          delete f.fileContent;
        });
      });
    });
    state.conversations = convs;
    state.currentId = saved.currentId || null;
    state.selectedService = saved.selectedService || "auto";
    if (saved.theme)
      document.documentElement.setAttribute("data-theme", saved.theme);
    if (saved.apiKeys) {
      Object.keys(saved.apiKeys).forEach((k) => {
        if (state.apiKeys[k]) {
          state.apiKeys[k] = { ...state.apiKeys[k], ...saved.apiKeys[k] };
          if (typeof state.apiKeys[k].enabled !== "boolean") {
            state.apiKeys[k].enabled = true;
          }
        }
      });
    }
    loadModelsCacheFromStorage();
    refreshThemeToggleLabel();
  } catch (error) {
    console.warn("Storage load failed", error);
  }
}

function getApiHeaders() {
  const headers = {};
  SERVICES.forEach((svc) => {
    if (blockedServices[svc]?.blocked) return;
    const cfg = state.apiKeys[svc];
    if (!cfg?.key || cfg.enabled === false) return;
    headers[SERVICE_HEADERS[svc].key] = cfg.key;
    headers[SERVICE_HEADERS[svc].model] = cfg.model || DEFAULT_MODELS[svc];
  });
  return headers;
}

function setServiceBlocked(svc, reason = "") {
  blockedServices[svc] = { blocked: true, reason };
  ensureSelectableService();
}

function clearServiceBlocked(svc) {
  blockedServices[svc] = { blocked: false, reason: "" };
}

function ensureSelectableService() {
  const current = state.selectedService;
  if (current === "auto") return;
  if (blockedServices[current]?.blocked) {
    state.selectedService = "auto";
    saveToStorage();
  }
}

function hasAnyApiKey() {
  return Object.values(state.apiKeys).some(
    (s) => s.key.trim() !== "" && s.enabled !== false,
  );
}

const SERVICE_META = {
  auto: { icon: "⚡", label: "Rotación IA", sub: "Alterna entre IAs activas" },
  groq: { icon: "⚡", label: "Groq", sub: "Ultra-rápido" },
  cerebras: { icon: "🧠", label: "Cerebras", sub: "Alto rendimiento" },
  openrouter: { icon: "🌐", label: "OpenRouter", sub: "Múltiples modelos" },
};

async function loadAvailableServices() {
  try {
    const res = await fetch(`${API}/services`, { headers: getApiHeaders() });
    const data = await res.json();
    const services =
      data.services.length > 0
        ? data.services
        : hasAnyApiKey()
          ? []
          : DEFAULT_SERVICE_OPTIONS;
    renderServiceDropdown(services);
  } catch {
    renderServiceDropdown(DEFAULT_SERVICE_OPTIONS);
  }
  ensureSelectableService();
  updateServiceBadge();
  updateInputState();
}

function renderServiceDropdown(services) {
  const dropdown = document.getElementById("service-dropdown");
  if (!dropdown) return;

  dropdown.innerHTML =
    `<div class="svc-dropdown-header">Modo de respuesta</div>` +
    services
      .map((svc) => {
        const meta = SERVICE_META[svc] || {
          icon: "🤖",
          label: capitalizeFirstLetter(svc),
          sub: "",
        };
        const isActive = state.selectedService === svc;
        return `<button class="svc-option${isActive ? " active" : ""}" onclick="selectService('${svc}')" data-service="${svc}">
        <span class="svc-option-icon">${meta.icon}</span>
        <div class="svc-option-info">
          <div class="svc-option-name">${meta.label}</div>
          ${meta.sub ? `<div class="svc-option-sub">${meta.sub}</div>` : ""}
        </div>
        <svg class="svc-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </button>`;
      })
      .join("");
}

function toggleServiceDropdown(e) {
  e.stopPropagation();
  const btn = document.getElementById("service-selector");
  const dropdown = document.getElementById("service-dropdown");
  if (!btn || !dropdown) return;
  const isOpen = dropdown.classList.toggle("open");
  btn.classList.toggle("open", isOpen);
  if (isOpen) {
    setTimeout(() => {
      document.addEventListener("click", closeServiceDropdown, { once: true });
    }, 0);
  }
}

function closeServiceDropdown() {
  document.getElementById("service-dropdown")?.classList.remove("open");
  document.getElementById("service-selector")?.classList.remove("open");
}

function selectService(val) {
  if (val !== "auto" && blockedServices[val]?.blocked) {
    toast(
      `Servicio bloqueado${blockedServices[val].reason ? `: ${blockedServices[val].reason}` : ""}`,
      "error",
    );
    return;
  }
  state.selectedService = val;
  updateServiceBadge();
  saveToStorage();
  // Update active classes without full re-render
  document.querySelectorAll(".svc-option").forEach((el) => {
    const svcVal = el.getAttribute("data-service") || "";
    el.classList.toggle("active", svcVal === val);
  });
  closeServiceDropdown();
  const label =
    val === "auto"
      ? "Rotación IA"
      : SERVICE_META[val]?.label || capitalizeFirstLetter(val);
  toast(`Servicio: ${label}`, "info");
}

function updateInputState() {
  const hasKeys = hasAnyApiKey();
  const input = document.getElementById("msg-input");
  const btnSend = document.getElementById("btn-send");
  const noKeysBanner = document.getElementById("no-keys-banner");

  if (input) input.disabled = !hasKeys && !state.streaming;
  if (btnSend) btnSend.disabled = !hasKeys;
  if (noKeysBanner) noKeysBanner.style.display = hasKeys ? "none" : "flex";
}

function setPanelOpen(panelId, isOpen) {
  const panel = document.getElementById(panelId);
  if (!panel) return false;
  panel.classList.toggle("open", isOpen);
  return true;
}

function openSettings() {
  if (!setPanelOpen("settings-panel", true)) return;
  populateSettingsForm();
}

function closeSettings() {
  setPanelOpen("settings-panel", false);
}

function populateSettingsForm() {
  SERVICES.forEach((svc) => {
    const keyEl = document.getElementById(`key-${svc}`);
    const modelEl = document.getElementById(`model-${svc}`);
    const currentKey = keyEl?.value?.trim() || "";
    const savedKey = state.apiKeys[svc]?.key?.trim() || "";
    updateEnabledButton(svc);
    const effectiveKey = currentKey || savedKey;
    if (keyEl && !currentKey) keyEl.value = savedKey;
    const cached = loadedModelCache[svc];
    if (
      effectiveKey &&
      cached?.key === effectiveKey &&
      Array.isArray(cached.models) &&
      cached.models.length
    ) {
      setSelectOptions(
        modelEl,
        cached.models,
        state.apiKeys[svc]?.model || DEFAULT_MODELS[svc],
      );
      return;
    }
    resetModelSelect(svc);
  });
  updateKeyStatuses();
}

function setSelectOptions(selectEl, models, selectedModel) {
  if (!selectEl) return;
  selectEl.disabled = false;
  selectEl.innerHTML = "";
  models.forEach((model) => {
    const opt = document.createElement("option");
    opt.value = model;
    opt.textContent = model;
    if (model === selectedModel) opt.selected = true;
    selectEl.appendChild(opt);
  });

  if (
    selectedModel &&
    !models.includes(selectedModel) &&
    typeof selectedModel === "string"
  ) {
    const opt = document.createElement("option");
    opt.value = selectedModel;
    opt.textContent = `${selectedModel} (no disponible)`;
    opt.selected = true;
    selectEl.appendChild(opt);
  }
}

function resetModelSelect(svc) {
  const modelEl = document.getElementById(`model-${svc}`);
  if (!modelEl) return;
  modelEl.innerHTML =
    '<option value="">Escribe API key para cargar modelos</option>';
  modelEl.disabled = true;
}

function setModelSelectLoading(svc, message = "Validando modelos...") {
  const modelEl = document.getElementById(`model-${svc}`);
  if (!modelEl) return;
  modelEl.innerHTML = `<option value="">${message}</option>`;
  modelEl.disabled = true;
}

function onApiKeyInput(svc) {
  const keyEl = document.getElementById(`key-${svc}`);
  const key = keyEl?.value?.trim() || "";
  if (modelLoadTimers[svc]) clearTimeout(modelLoadTimers[svc]);
  if (!key) {
    resetAutoLoadedKey(svc);
    clearCachedModels(svc);
    clearServiceBlocked(svc);
    resetModelSelect(svc);
    return;
  }
  if (key.length < 10) {
    resetModelSelect(svc);
    return;
  }
  modelLoadTimers[svc] = setTimeout(() => {
    if (lastAutoLoadedKeys[svc] === key) return;
    lastAutoLoadedKeys[svc] = key;
    loadModelsForService(svc, { silent: true });
  }, 500);
}

function updateKeyStatuses() {
  SERVICES.forEach((svc) => {
    const indicator = document.getElementById(`status-${svc}`);
    if (indicator) {
      const hasKey = !!state.apiKeys[svc]?.key?.trim();
      const enabled = state.apiKeys[svc]?.enabled !== false;
      indicator.classList.remove("active", "inactive");
      indicator.classList.add(hasKey && enabled ? "active" : "inactive");
      indicator.title = hasKey
        ? enabled
          ? "API key configured"
          : "Servicio deshabilitado"
        : "No API key";
    }
  });
}

function refreshServiceStateUI(options = {}) {
  const { updateSidebarIndicator = false } = options;
  loadAvailableServices();
  updateKeyStatuses();
  updateInputState();
  if (updateSidebarIndicator) updateSidebarKeysIndicator();
}

function saveSettings() {
  SERVICES.forEach((svc) => {
    const keyEl = document.getElementById(`key-${svc}`);
    const modelEl = document.getElementById(`model-${svc}`);
    if (keyEl) state.apiKeys[svc].key = keyEl.value.trim();
    if (modelEl)
      state.apiKeys[svc].model = modelEl.value.trim() || DEFAULT_MODELS[svc];
    if (typeof state.apiKeys[svc].enabled !== "boolean") {
      state.apiKeys[svc].enabled = true;
    }
    const currentKey = state.apiKeys[svc].key || "";
    if (loadedModelCache[svc]?.key !== currentKey) {
      clearCachedModels(svc);
    }
  });
  saveToStorage();
  refreshServiceStateUI({ updateSidebarIndicator: true });
  closeSettings();
  toast("Configuración guardada ✓", "success");
}

function clearKey(svc) {
  const keyEl = document.getElementById(`key-${svc}`);
  if (keyEl) keyEl.value = "";
  state.apiKeys[svc].key = "";
  state.apiKeys[svc].model = DEFAULT_MODELS[svc];
  state.apiKeys[svc].enabled = true;
  resetAutoLoadedKey(svc);
  clearCachedModels(svc);
  clearServiceBlocked(svc);
  resetModelSelect(svc);
  saveToStorage();
  refreshServiceStateUI();
  toast(`Clave ${capitalizeFirstLetter(svc)} eliminada`, "info");
}

function updateEnabledButton(svc) {
  const btn = document.getElementById(`enabled-${svc}`);
  if (!(btn instanceof HTMLInputElement)) return;
  const enabled = state.apiKeys[svc]?.enabled !== false;
  btn.checked = enabled;
}

function toggleServiceEnabled(svc, checked) {
  const enabled = !!checked;
  state.apiKeys[svc].enabled = enabled;
  if (!state.apiKeys[svc].enabled && state.selectedService === svc) {
    state.selectedService = "auto";
  }
  updateEnabledButton(svc);
  saveToStorage();
  refreshServiceStateUI();
}

function copyApiKey(svc) {
  const keyEl = document.getElementById(`key-${svc}`);
  const key = keyEl?.value?.trim() || state.apiKeys[svc]?.key?.trim() || "";
  if (!key) {
    toast("No hay API key para copiar", "error");
    return;
  }
  navigator.clipboard
    .writeText(key)
    .then(() => toast("API key copiada", "success"))
    .catch(() => toast("No se pudo copiar la API key", "error"));
}

function toggleKeyVisibility(svc) {
  const input = document.getElementById(`key-${svc}`);
  const btn = document.getElementById(`toggle-${svc}`);
  if (!input || !btn) return;
  const isPassword = input.type === "password";
  input.type = isPassword ? "text" : "password";
  btn.innerHTML = isPassword
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}

async function loadModelsForService(svc, opts = {}) {
  const { silent = false } = opts;
  const modelEl = document.getElementById(`model-${svc}`);
  const loadBtn = document.getElementById(`load-models-${svc}`);
  if (!modelEl || !loadBtn) return;

  const keyEl = document.getElementById(`key-${svc}`);
  const tempKey = keyEl?.value?.trim();
  if (!tempKey && !state.apiKeys[svc]?.key) {
    if (!silent) toast("Introduce una API key primero", "error");
    return;
  }

  const tempHeaders = { ...getApiHeaders() };
  if (tempKey) {
    tempHeaders[SERVICE_HEADERS[svc].key] = tempKey;
  }

  loadBtn.disabled = true;
  loadBtn.textContent = "Validando...";
  setModelSelectLoading(svc);
  try {
    const fetchModels = async (validateOnly) => {
      const query = validateOnly
        ? `service=${svc}&validate=1`
        : `service=${svc}`;
      const res = await fetch(`${API}/models?${query}`, {
        headers: tempHeaders,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data?.models) ? data.models : [];
    };

    let models = await fetchModels(true);
    let loadedWithoutValidation = false;

    if (models.length === 0) {
      models = await fetchModels(false);
      loadedWithoutValidation = models.length > 0;
    }

    if (models.length > 0) {
      clearServiceBlocked(svc);
      setCachedModels(svc, tempKey || state.apiKeys[svc]?.key || "", models);
      setSelectOptions(
        modelEl,
        models,
        state.apiKeys[svc]?.model || DEFAULT_MODELS[svc],
      );
      if (!silent) {
        const extra = loadedWithoutValidation ? " (sin validación previa)" : "";
        toast(`${models.length} modelos cargados${extra}`, "success");
      }
    } else {
      setServiceBlocked(svc, "Sin modelos válidos");
      clearCachedModels(svc);
      resetModelSelect(svc);
      if (!silent)
        toast("No hay modelos disponibles para esta API key", "error");
    }
  } catch (error) {
    console.error(`[ERROR] loadModelsForService(${svc}):`, error);
    setServiceBlocked(svc, "Error de validación");
    clearCachedModels(svc);
    setModelSelectLoading(svc, "Error validando modelos");
    if (!silent) toast("Error cargando modelos", "error");
  } finally {
    loadBtn.disabled = false;
    loadBtn.textContent = "Cargar";
  }
}

function updateServiceBadge() {
  const label = document.getElementById("service-label");
  const val = state.selectedService;
  if (label) {
    const meta = SERVICE_META?.[val];
    label.textContent = meta ? meta.label : capitalizeFirstLetter(val);
  }
}

function focusComposer() {
  const input = document.getElementById("msg-input");
  if (input) input.focus();
}

function closeSidebarOnMobile() {
  if (window.innerWidth <= 768) closeMobileSidebar();
}

function newConversation() {
  const id = "conv_" + Date.now();
  state.conversations[id] = {
    id,
    title: "Nueva conversación",
    messages: [],
    systemPrompt: "",
    createdAt: Date.now(),
    usedService: null,
    pinned: false,
  };
  state.currentId = id;
  state.pendingFiles = [];
  saveToStorage();
  renderConversationList();
  renderMessages();
  const titleEl = document.getElementById("chat-title-header");
  if (titleEl) titleEl.textContent = "Nueva conversación";
  focusComposer();
  closeSidebarOnMobile();
}

function switchConversation(id) {
  if (state.streaming) stopStreaming();
  state.currentId = id;
  state.pendingFiles = [];
  renderFilePreviews();
  saveToStorage();
  renderConversationList();
  renderMessages();
  const conv = state.conversations[id];
  const titleEl = document.getElementById("chat-title-header");
  if (titleEl) titleEl.textContent = conv?.title || "Conversación";
  const sysEl = document.getElementById("system-prompt-input");
  if (sysEl) sysEl.value = conv?.systemPrompt || "";
  focusComposer();
  closeSidebarOnMobile();
}

function deleteConversation(id, e) {
  e.stopPropagation();
  if (!confirm("¿Eliminar esta conversación?")) return;
  delete state.conversations[id];
  if (state.currentId === id) {
    const remaining = Object.keys(state.conversations);
    if (remaining.length > 0)
      switchConversation(remaining[remaining.length - 1]);
    else newConversation();
  }
  saveToStorage();
  renderConversationList();
}

function pinConversation(id, e) {
  e.stopPropagation();
  const conv = state.conversations[id];
  if (conv) {
    conv.pinned = !conv.pinned;
    saveToStorage();
    renderConversationList();
  }
}

function clearCurrentConversation() {
  if (!state.currentId) return;
  if (!confirm("¿Limpiar todos los mensajes de esta conversación?")) return;
  state.conversations[state.currentId].messages = [];
  saveToStorage();
  renderMessages();
  toast("Conversación limpiada", "info");
}

function getCurrentConversation() {
  return state.conversations[state.currentId] || null;
}

function updateConversationTitle(id, messages) {
  const conv = state.conversations[id];
  if (!conv) return;
  if (messages.length > 0 && conv.title === "Nueva conversación") {
    const firstUser = messages.find((m) => m.role === "user");
    if (firstUser) {
      const raw =
        firstUser.displayText || firstUser.rawText || firstUser.content;
      conv.title =
        raw.slice(0, 48).replace(/\n/g, " ") + (raw.length > 48 ? "…" : "");
      const titleEl = document.getElementById("chat-title-header");
      if (titleEl) titleEl.textContent = conv.title;
    }
  }
}

function onSearchInput(val) {
  state.searchQuery = val.toLowerCase();
  const clearBtn = document.getElementById("search-clear-btn");
  if (clearBtn) clearBtn.style.display = val ? "block" : "none";
  renderConversationList();
}

function clearSearch() {
  state.searchQuery = "";
  const searchEl = document.getElementById("conv-search");
  if (searchEl) searchEl.value = "";
  const clearBtn = document.getElementById("search-clear-btn");
  if (clearBtn) clearBtn.style.display = "none";
  renderConversationList();
}

function getMessageTextSnippet(message) {
  return (
    message.displayText ||
    message.rawText ||
    message.content ||
    ""
  ).trim();
}

function renderConversationList() {
  const list = document.getElementById("conversations-list");
  if (!list) return;

  let convs = Object.values(state.conversations).sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.createdAt - a.createdAt;
  });

  const q = state.searchQuery.trim();
  if (q) {
    convs = convs.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) =>
          getMessageTextSnippet(m).toLowerCase().includes(q),
        ),
    );
  }

  if (convs.length === 0) {
    list.innerHTML = q
      ? `<div class="empty-conversations">Sin resultados para "<strong>${escapeHtml(q)}</strong>"</div>`
      : '<div class="empty-conversations">No hay conversaciones aún.<br/>Empieza una nueva.</div>';
    return;
  }

  list.innerHTML = convs
    .map((c) => {
      const lastMsg = c.messages
        .filter((m) => m.role !== "system")
        .slice(-1)[0];
      const preview = lastMsg
        ? getMessageTextSnippet(lastMsg).slice(0, 60).replace(/\n/g, " ") ||
          "Sin mensajes"
        : "Sin mensajes";
      const time = c.messages.length > 0 ? formatRelativeTime(c.createdAt) : "";
      return `
    <div class="conv-item ${c.id === state.currentId ? "active" : ""}" onclick="switchConversation('${c.id}')">
      <div class="conv-icon">${getConversationIcon(c)}</div>
      <div class="conv-meta">
        <div class="conv-title-row">
          <span class="conv-title">${escapeHtml(c.title)}</span>
          ${time ? `<span class="conv-time">${time}</span>` : ""}
        </div>
        <div class="conv-preview">${escapeHtml(preview)}</div>
      </div>
      <div class="conv-actions">
        <button class="conv-action-btn pin ${c.pinned ? "pinned" : ""}" onclick="pinConversation('${c.id}', event)" title="${c.pinned ? "Desanclar" : "Anclar"}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="${c.pinned ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a2 2 0 000-4H8a2 2 0 000 4h1v4.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V17z"/></svg>
        </button>
        <button class="conv-action-btn del" onclick="deleteConversation('${c.id}', event)" title="Eliminar">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        </button>
      </div>
    </div>`;
    })
    .join("");
}

function getConversationIcon(conversation) {
  if (conversation.pinned) return "📌";
  if (conversation.messages.length === 0) return "💬";
  const svc = conversation.usedService;
  if (svc === "Groq") return "⚡";
  if (svc === "Cerebras") return "🧠";
  if (svc === "OpenRouter") return "🌐";
  return "💬";
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return "ahora";
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
  });
}

function renderMessages() {
  const inner = document.getElementById("messages-inner");
  if (!inner) return;
  const conv = getCurrentConversation();

  if (!conv || conv.messages.length === 0) {
    inner.innerHTML = `<div id="welcome">
      <div class="welcome-logo">⚡</div>
      <div class="welcome-title">NeuralChat</div>
      <div class="welcome-sub">Chat con múltiples modelos de IA. Envía texto, imágenes, PDFs y cualquier archivo.</div>
      <div class="welcome-chips">
        <button class="welcome-chip" onclick="useChip('Explícame cómo funciona la IA de forma clara y concisa')">¿Cómo funciona la IA?</button>
        <button class="welcome-chip" onclick="useChip('Escribe un script en Python para analizar datos CSV y generar estadísticas')">Script Python CSV</button>
        <button class="welcome-chip" onclick="useChip('Resume los puntos clave de este documento en formato bullet points')">Resumir documento</button>
        <button class="welcome-chip" onclick="useChip('¿Cuáles son las mejores prácticas actuales en desarrollo web?')">Mejores prácticas web</button>
        <button class="welcome-chip" onclick="useChip('Traduce este texto al inglés manteniendo el tono y estilo original')">Traductor profesional</button>
        <button class="welcome-chip" onclick="useChip('Analiza este código y sugiere optimizaciones de rendimiento')">Revisar código</button>
      </div>
    </div>`;
    return;
  }

  inner.innerHTML = conv.messages
    .map((msg, idx) => renderMessageRow(msg, idx))
    .join("");
  applyHighlighting();
  scrollToBottom(false);
}

function renderMessageRow(msg, idx) {
  const isUser = msg.role === "user";
  const displayContent = isUser
    ? escapeHtml(msg.displayText ?? msg.content).replace(/\n/g, "<br>")
    : renderMarkdown(msg.content);
  const filesHtml =
    msg.files && msg.files.length > 0
      ? `<div class="msg-files">${msg.files.map((f) => renderFileChip(f)).join("")}</div>`
      : "";

  const svcTag =
    !isUser && msg.service
      ? `<span class="svc-tag">${msg.service}${msg.model ? ` · ${shortenModelIdentifier(msg.model)}` : ""}</span>`
      : "";

  const timeStr = msg.timestamp ? formatTime(msg.timestamp) : "";
  const timeTag = timeStr ? `<span class="msg-time">${timeStr}</span>` : "";

  return `<div class="msg-row ${msg.role}" data-idx="${idx}">
    <div class="msg-label">
      ${isUser ? '<span class="msg-author">Tú</span>' : `<span class="msg-author">Asistente</span> ${svcTag}`}
      ${timeTag}
    </div>
    <div class="msg-bubble">
      ${filesHtml}
      <div class="msg-content">${displayContent}</div>
    </div>
    <div class="msg-actions">
      <button class="msg-action-btn icon-only" onclick="copyMessage(${idx})" title="Copiar">⧉</button>
      ${
        isUser
          ? `<button class="msg-action-btn icon-only" onclick="editMessage(${idx})" title="Editar">✎</button>`
          : `<button class="msg-action-btn icon-only" onclick="regenerateFrom(${idx})" title="Regenerar">↻</button>`
      }
    </div>
  </div>`;
}

function shortenModelIdentifier(model) {
  if (!model) return "";
  // Shorten long model names
  return model.split("/").pop()?.split(":")[0]?.slice(0, 24) || model;
}

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function appendMessageToDom(msg, idx) {
  const welcome = document.getElementById("welcome");
  if (welcome) welcome.remove();
  const inner = document.getElementById("messages-inner");
  const div = document.createElement("div");
  div.innerHTML = renderMessageRow(msg, idx);
  const el = div.firstElementChild;
  el.style.opacity = "0";
  el.style.transform = "translateY(8px)";
  inner.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transition = "opacity 0.25s ease, transform 0.25s ease";
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  });
  applyHighlighting();
  scrollToBottom();
}

function renderCodeBlock(code, lang = "texto", includeLanguageClass = false) {
  return `<div class="code-block-wrapper">
          <div class="code-block-header">
            <span class="code-lang">${escapeHtml(lang)}</span>
            <button class="btn-copy-code" onclick="copyCodeBlock(this)">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              Copiar
            </button>
          </div>
          <pre><code${includeLanguageClass ? ` class="language-${escapeHtml(lang)}"` : ""}>${code}</code></pre>
        </div>`;
}

function renderMarkdown(text) {
  if (!text) return "";
  try {
    const html = marked.parse(text, { breaks: true, gfm: true });
    if (!html.includes("<pre><code")) return html;
    return html
      .replace(
        /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g,
        (_, lang, code) => renderCodeBlock(code, lang, true),
      )
      .replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (_, code) =>
        renderCodeBlock(code),
      );
  } catch {
    return escapeHtml(text);
  }
}

function applyHighlighting() {
  document
    .querySelectorAll(".code-block-wrapper pre code:not([data-highlighted])")
    .forEach((block) => {
      hljs.highlightElement(block);
      block.dataset.highlighted = "yes";
    });
}

function scrollToBottom(smooth = true) {
  const c = document.getElementById("messages-container");
  if (!c) return;
  c.scrollTo({ top: c.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

async function sendMessage() {
  if (!hasAnyApiKey()) {
    toast("Configura tus API keys primero", "error");
    openSettings();
    return;
  }
  const input = document.getElementById("msg-input");
  const text = input.value.trim();
  if (!text && state.pendingFiles.length === 0) return;
  if (state.streaming) return;

  const conv = getCurrentConversation();
  if (!conv) return;

  const userMsg = {
    role: "user",
    content: text,
    displayText: text,
    rawText: text,
    timestamp: Date.now(),
    files: state.pendingFiles.map((f) => ({
      name: f.name,
      mimeType: f.mimeType,
      size: f.size,
      displayType: f.displayType,
      preview: f.displayType === "image" ? f.content : null,
      fileContent:
        f.displayType === "text"
          ? truncateFileContentForPrompt(f.content)
          : null,
    })),
  };

  conv.messages.push(userMsg);
  updateConversationTitle(state.currentId, conv.messages);
  saveToStorage();
  appendMessageToDom(userMsg, conv.messages.length - 1);

  input.value = "";
  autoResize(input);
  clearFilePreviews();
  input.focus();

  await streamResponse(conv);
}

async function streamResponse(conv, retryCount = 0) {
  setStreaming(true);

  const apiMessages = [];
  if (conv.systemPrompt)
    apiMessages.push({ role: "system", content: conv.systemPrompt });
  conv.messages.forEach((m) => {
    apiMessages.push({ role: m.role, content: buildMessageApiContent(m) });
  });

  const typingId = addTypingIndicator();
  let fullContent = "";
  let usedService = "";
  let usedModel = "";
  const requestedService =
    state.selectedService === "auto" ? null : state.selectedService;

  if (requestedService && blockedServices[requestedService]?.blocked) {
    removeTypingIndicator(typingId);
    const reason = blockedServices[requestedService].reason;
    toast(
      `Ese servicio está bloqueado${reason ? ` (${reason})` : ""}. Vuelve a cargar modelos.`,
      "error",
    );
    setStreaming(false);
    return;
  }

  try {
    state.abortController = new AbortController();
    const res = await fetch(`${API}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getApiHeaders(),
      },
      body: JSON.stringify({
        messages: apiMessages,
        service:
          state.selectedService === "auto" ? undefined : state.selectedService,
      }),
      signal: state.abortController.signal,
    });

    if (!res.ok) {
      const errData = await res
        .json()
        .catch(() => ({ error: `HTTP ${res.status}` }));
      if (errData?.service) {
        const svc = String(errData.service).toLowerCase();
        if (SERVICES.includes(svc)) {
          const reason = deriveUnusableServiceReason(errData.error || "");
          setServiceBlocked(svc, reason);
        }
      }
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    removeTypingIndicator(typingId);

    const assistantMsg = {
      role: "assistant",
      content: "",
      service: "",
      model: "",
      timestamp: Date.now(),
    };
    conv.messages.push(assistantMsg);
    const msgIdx = conv.messages.length - 1;
    appendMessageToDom(assistantMsg, msgIdx);
    const bubble = document.querySelector(
      `.msg-row[data-idx="${msgIdx}"] .msg-content`,
    );
    if (bubble) bubble.classList.add("streaming-cursor");

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") break;
        try {
          const parsed = JSON.parse(data);
          if (parsed.service) {
            usedService = parsed.service;
            usedModel = parsed.model || "";
            conv.usedService = usedService;
          }
          if (parsed.content) {
            fullContent += parsed.content;
            assistantMsg.content = fullContent;
            assistantMsg.service = usedService;
            assistantMsg.model = usedModel;
            if (bubble) {
              bubble.innerHTML = renderMarkdown(fullContent);
              applyHighlighting();
            }
            scrollToBottom(false);
          }
          if (parsed.error) throw new Error(parsed.error);
        } catch (error) {
          const message = getErrorMessage(error, "");
          if (message && !message.includes("JSON")) throw error;
        }
      }
    }

    assistantMsg.content = fullContent;
    assistantMsg.service = usedService;
    assistantMsg.model = usedModel;

    if (bubble) {
      bubble.classList.remove("streaming-cursor");
      bubble.innerHTML = renderMarkdown(fullContent);
      applyHighlighting();
    }

    const label = document.querySelector(
      `.msg-row[data-idx="${msgIdx}"] .msg-label`,
    );
    if (label && usedService) {
      const modelShort = usedModel
        ? ` · ${shortenModelIdentifier(usedModel)}`
        : "";
      label.innerHTML = `<span class="msg-author">Asistente</span> <span class="svc-tag">${usedService}${modelShort}</span>`;
    }

    saveToStorage();
    renderConversationList();
    triggerNotification(usedService);
  } catch (err) {
    removeTypingIndicator(typingId);
    if (err instanceof Error && err.name === "AbortError") {
      toast("Respuesta cancelada", "info");
      const lastMsg = conv.messages[conv.messages.length - 1];
      if (lastMsg?.role === "assistant" && !lastMsg.content)
        conv.messages.pop();
    } else if (
      retryCount < 1 &&
      err instanceof Error &&
      err.message.includes("fetch")
    ) {
      toast("Reintentando conexión...", "info");
      setStreaming(false);
      await new Promise((r) => setTimeout(r, 1500));
      return streamResponse(conv, retryCount + 1);
    } else {
      const msg = getErrorMessage(err);
      const reason = deriveUnusableServiceReason(msg);
      if (requestedService && reason)
        setServiceBlocked(requestedService, reason);
      toast("Error: " + msg, "error");
      const lastMsg = conv.messages[conv.messages.length - 1];
      if (lastMsg?.role === "assistant") conv.messages.pop();
    }
    saveToStorage();
    renderMessages();
  } finally {
    setStreaming(false);
  }
}

function addTypingIndicator() {
  const id = "typing_" + Date.now();
  const welcome = document.getElementById("welcome");
  if (welcome) welcome.remove();
  const inner = document.getElementById("messages-inner");
  inner.insertAdjacentHTML(
    "beforeend",
    `
    <div class="msg-row assistant typing-row" id="${id}">
      <div class="msg-label"><span class="msg-author">Asistente</span></div>
      <div class="msg-bubble">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    </div>
  `,
  );
  scrollToBottom();
  return id;
}

function removeTypingIndicator(id) {
  document.getElementById(id)?.remove();
}

function setStreaming(val) {
  state.streaming = val;
  const btnSend = document.getElementById("btn-send");
  const btnStop = document.getElementById("btn-stop");
  const input = document.getElementById("msg-input");
  if (btnSend) btnSend.style.display = val ? "none" : "flex";
  if (btnStop) btnStop.style.display = val ? "flex" : "none";
  if (input) {
    input.disabled = val || !hasAnyApiKey();
    if (!val && hasAnyApiKey()) input.focus();
  }
}

function stopStreaming() {
  if (state.abortController) state.abortController.abort();
}

function copyMessage(idx) {
  const conv = getCurrentConversation();
  if (!conv) return;
  const msg = conv.messages[idx];
  if (!msg) return;
  navigator.clipboard
    .writeText(msg.content)
    .then(() => toast("Copiado ✓", "success"));
}

function editMessage(idx) {
  const conv = getCurrentConversation();
  if (!conv || state.streaming) return;
  const msg = conv.messages[idx];
  if (!msg || msg.role !== "user") return;
  const row = document.querySelector(`.msg-row[data-idx="${idx}"]`);
  if (!row) return;
  const bubble = row.querySelector(".msg-bubble");
  const original = msg.rawText || msg.content;
  bubble.innerHTML = `
    <textarea class="msg-edit-area" id="edit_${idx}" rows="3">${escapeHtml(original)}</textarea>
    <div class="msg-edit-actions">
      <button class="panel-btn primary" style="font-size:13px;padding:6px 14px" onclick="saveEdit(${idx})">Guardar y regenerar</button>
      <button class="panel-btn ghost" style="font-size:13px;padding:6px 14px" onclick="cancelEdit(${idx})">Cancelar</button>
    </div>
  `;
  const ta = document.getElementById(`edit_${idx}`);
  if (ta) {
    autoResize(ta);
    ta.focus();
  }
}

function saveEdit(idx) {
  const conv = getCurrentConversation();
  if (!conv) return;
  const textarea = document.getElementById(`edit_${idx}`);
  if (!textarea) return;
  const newText = textarea.value.trim();
  if (!newText) return;
  conv.messages[idx].content = newText;
  conv.messages[idx].rawText = newText;
  conv.messages[idx].displayText = newText;
  conv.messages.splice(idx + 1);
  saveToStorage();
  renderMessages();
  streamResponse(conv);
}

function cancelEdit() {
  renderMessages();
}

function regenerateFrom(idx) {
  const conv = getCurrentConversation();
  if (!conv || state.streaming) return;
  conv.messages.splice(idx);
  saveToStorage();
  renderMessages();
  streamResponse(conv);
}

function copyCodeBlock(btn) {
  const code = btn.closest(".code-block-wrapper").querySelector("code");
  if (!code) return;
  navigator.clipboard.writeText(code.innerText).then(() => {
    const originalHtml = btn.innerHTML;
    btn.classList.add("copied");
    btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copiado`;
    setTimeout(() => {
      btn.classList.remove("copied");
      btn.innerHTML = originalHtml;
    }, 2000);
  });
}

async function handleFileInput(event) {
  const files = Array.from(event.target.files);
  event.target.value = "";
  await processUploadedFilesBatch(files);
}

async function processUploadedFile(file) {
  const toastId = toastProgress(`Procesando ${file.name}...`);
  const formData = new FormData();
  formData.append("file", file);
  try {
    const res = await fetch(`${API}/upload`, {
      method: "POST",
      body: formData,
    });
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
    removeToast(toastId);
    toast(`${data.filename} listo ✓`, "success");
  } catch (error) {
    removeToast(toastId);
    toast(`Error: ${getErrorMessage(error)}`, "error");
  }
}

async function processUploadedFilesBatch(files) {
  for (const file of files) await processUploadedFile(file);
}

function renderFilePreviews() {
  const container = document.getElementById("file-previews");
  if (!container) return;
  container.innerHTML = state.pendingFiles
    .map((f, i) => {
      if (f.displayType === "image" && f.content) {
        return `<div class="file-preview-chip img-preview-chip">
        <img class="fp-thumb" src="data:${f.mimeType};base64,${f.content}" alt="${escapeHtml(f.name)}"/>
        <span class="fp-name-overlay">${escapeHtml(f.name)}</span>
        <button class="fp-remove" onclick="removeFile(${i})" title="Quitar">✕</button>
      </div>`;
      }
      return `<div class="file-preview-chip">
      <span class="fp-icon">${getFileTypeIcon(f.mimeType)}</span>
      <div style="display:flex;flex-direction:column;gap:1px;min-width:0;flex:1">
        <span class="fp-name">${escapeHtml(f.name)}</span>
        <span class="fp-type">${getFileTypeLabel(f.mimeType, f.name)}${f.size ? " · " + formatFileSizeLabel(f.size) : ""}</span>
      </div>
      <button class="fp-remove" onclick="removeFile(${i})" title="Quitar">✕</button>
    </div>`;
    })
    .join("");
}

function removeFile(idx) {
  state.pendingFiles.splice(idx, 1);
  renderFilePreviews();
}

function clearFilePreviews() {
  state.pendingFiles = [];
  renderFilePreviews();
}

function renderFileChip(f) {
  const label = getFileTypeLabel(f.mimeType, f.name);
  const size = f.size ? formatFileSizeLabel(f.size) : "";
  if (f.displayType === "image" && f.preview) {
    return `<div class="msg-file-chip img-chip" onclick="openLightbox('data:${f.mimeType};base64,${f.preview}')" title="Ampliar imagen">
      <img class="fc-thumb" src="data:${f.mimeType};base64,${f.preview}" alt="${escapeHtml(f.name)}"/>
      <div class="fc-thumb-overlay"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
    </div>`;
  }
  return `<div class="msg-file-chip doc-chip">
    <span class="fc-icon">${getFileTypeIcon(f.mimeType)}</span>
    <div class="fc-info">
      <div class="fc-name">${escapeHtml(f.name)}</div>
      <div class="fc-meta">${label}${size ? " · " + size : ""}</div>
    </div>
  </div>`;
}

function openLightbox(src) {
  let lb = document.getElementById("lightbox");
  if (!lb) {
    lb = document.createElement("div");
    lb.id = "lightbox";
    lb.innerHTML =
      '<div class="lb-overlay"></div><div class="lb-content"><img id="lb-img"/><button class="lb-close" onclick="closeLightbox()"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
    lb.querySelector(".lb-overlay").onclick = closeLightbox;
    document.body.appendChild(lb);
  }
  document.getElementById("lb-img").src = src;
  lb.classList.add("open");
  document.addEventListener("keydown", handleLightboxKeydown);
}

function closeLightbox() {
  document.getElementById("lightbox")?.classList.remove("open");
  document.removeEventListener("keydown", handleLightboxKeydown);
}

function handleLightboxKeydown(e) {
  if (e.key === "Escape") closeLightbox();
}

function setupDragDrop() {
  const body = document.body;
  const wrap = document.getElementById("textarea-wrap");

  body.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (wrap) wrap.classList.add("drag-over");
  });
  body.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget || !body.contains(e.relatedTarget)) {
      if (wrap) wrap.classList.remove("drag-over");
    }
  });
  body.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (wrap) wrap.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer.files);
    await processUploadedFilesBatch(files);
  });
}

function toggleSystemPanel() {
  const panel = document.getElementById("system-panel");
  const btn = document.getElementById("btn-system");
  if (!panel) return;
  const isOpen = panel.classList.toggle("open");
  if (btn) btn.classList.toggle("active", isOpen);
  if (isOpen) {
    const conv = getCurrentConversation();
    const sysEl = document.getElementById("system-prompt-input");
    if (sysEl) sysEl.value = conv?.systemPrompt || "";
  }
}

function saveSystemPrompt() {
  const conv = getCurrentConversation();
  if (!conv) return;
  const sysEl = document.getElementById("system-prompt-input");
  conv.systemPrompt = sysEl?.value || "";
  saveToStorage();
  toast("System prompt guardado ✓", "success");
}

function clearSystemPrompt() {
  const sysEl = document.getElementById("system-prompt-input");
  if (sysEl) sysEl.value = "";
  const conv = getCurrentConversation();
  if (conv) {
    conv.systemPrompt = "";
    saveToStorage();
  }
  toast("System prompt limpiado", "info");
}

const TEMPLATES = {
  python:
    "Eres un experto desarrollador Python. Siempre escribes código limpio, bien documentado con docstrings, siguiendo PEP 8. Explica cada parte del código con claridad.",
  translator:
    "Eres un traductor profesional experto. Traduce con precisión manteniendo el tono, estilo y matices del texto original. Si hay ambigüedad, indica las opciones.",
  analyst:
    "Eres un analista de datos experto. Estructura tu análisis con: 1) Resumen ejecutivo, 2) Hallazgos clave, 3) Visualizaciones sugeridas, 4) Recomendaciones accionables.",
  writer:
    "Eres un escritor creativo con prosa elegante y voz distintiva. Usa metáforas originales, ritmo variado y detalles sensoriales. Evita clichés y frases genéricas.",
  coder:
    "Eres un ingeniero de software senior. Escribe código production-ready, considera edge cases, incluye manejo de errores y tests. Explica las decisiones de diseño.",
  teacher:
    "Eres un profesor experto. Explica conceptos de forma clara usando analogías, ejemplos concretos y progresión lógica. Adapta el nivel de detalle al usuario.",
};

function applyTemplate(key) {
  const tpl = TEMPLATES[key];
  if (tpl) {
    const sysEl = document.getElementById("system-prompt-input");
    if (sysEl) sysEl.value = tpl;
    toast("Plantilla aplicada — guarda para confirmar", "info");
  }
}

function openExport() {
  const conv = getCurrentConversation();
  if (!conv || conv.messages.length === 0) {
    toast("No hay mensajes para exportar", "info");
    return;
  }
  setPanelOpen("export-panel", true);
}
function closeExport() {
  setPanelOpen("export-panel", false);
}

function exportAs(format) {
  const conv = getCurrentConversation();
  if (!conv) return;
  const { content, ext, mime } = buildConversationExportArtifact(conv, format);
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `neuralchat-${conv.title.slice(0, 30).replace(/\s+/g, "-")}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
  closeExport();
  toast(`Exportado como .${ext} ✓`, "success");
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  refreshThemeToggleLabel();
  setHighlightTheme(next);
  saveToStorage();
}

function refreshThemeToggleLabel() {
  const theme = document.documentElement.getAttribute("data-theme");
  updateThemeToggleLabel(theme);
}

function applyThemeSetting() {
  const theme = document.documentElement.getAttribute("data-theme");
  refreshThemeToggleLabel();
  setHighlightTheme(theme);
}

async function triggerNotification(service) {
  if (document.hasFocus()) return;
  if ("Notification" in window) {
    if (Notification.permission === "default")
      await Notification.requestPermission();
    if (Notification.permission === "granted") {
      new Notification("NeuralChat", {
        body: `${service || "AI"} ha respondido`,
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%237c6af7'/><text x='50%' y='55%' dominant-baseline='middle' text-anchor='middle' font-size='18'>⚡</text></svg>",
      });
    }
  }
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    if (e.key === "Escape") {
      if (state.streaming) stopStreaming();
      document.getElementById("system-panel")?.classList.remove("open");
      document.getElementById("btn-system")?.classList.remove("active");
      setPanelOpen("export-panel", false);
      setPanelOpen("settings-panel", false);
      closeServiceDropdown();
      closeLightbox();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      newConversation();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      toggleSystemPanel();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ",") {
      e.preventDefault();
      openSettings();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "e") {
      e.preventDefault();
      openExport();
    }

    if (e.key === "/" && !inInput) {
      e.preventDefault();
      document.getElementById("conv-search")?.focus();
    }
  });
}

function handleKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function toggleSidebar() {
  if (window.innerWidth <= 768) {
    document.getElementById("sidebar")?.classList.toggle("mobile-open");
  } else {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;
    sidebar.classList.toggle("collapsed");
  }
}

function closeMobileSidebar() {
  document.getElementById("sidebar")?.classList.remove("mobile-open");
}

function useChip(text) {
  if (!hasAnyApiKey()) {
    openSettings();
    return;
  }
  const input = document.getElementById("msg-input");
  if (!input) return;
  input.value = text;
  autoResize(input);
  input.focus();
}

let toastIdCounter = 0;

function appendToast(type, innerHtml) {
  const container = document.getElementById("toast-container");
  if (!container) return null;
  const id = "toast_" + ++toastIdCounter;
  const el = document.createElement("div");
  el.id = id;
  el.className = `toast ${type}`;
  el.innerHTML = innerHtml;
  container.appendChild(el);
  return { id, el };
}

function toast(msg, type = "info", duration = 3500) {
  const icons = { info: "●", success: "✓", error: "✕" };
  const toastEntry = appendToast(
    type,
    `<span class="toast-icon">${icons[type] || "●"}</span><span>${escapeHtml(msg)}</span>`,
  );
  if (!toastEntry) return;
  const { id, el } = toastEntry;
  setTimeout(() => {
    el.style.animation = "toastOut 0.25s ease-in forwards";
    setTimeout(() => el.remove(), 250);
  }, duration);
  return id;
}

function toastProgress(msg) {
  const toastEntry = appendToast(
    "info",
    `<span class="toast-spinner"></span><span>${escapeHtml(msg)}</span>`,
  );
  return toastEntry?.id ?? null;
}

function removeToast(id) {
  if (!id) return;
  const el = document.getElementById(id);
  if (el) {
    el.style.animation = "toastOut 0.2s ease-in forwards";
    setTimeout(() => el.remove(), 200);
  }
}

Object.assign(globalThis, {
  newConversation,
  switchConversation,
  deleteConversation,
  pinConversation,
  clearCurrentConversation,
  onSearchInput,
  clearSearch,
  openSettings,
  closeSettings,
  onApiKeyInput,
  saveSettings,
  clearKey,
  copyApiKey,
  toggleKeyVisibility,
  toggleServiceEnabled,
  loadModelsForService,
  openExport,
  closeExport,
  exportAs,
  toggleTheme,
  toggleSidebar,
  toggleSystemPanel,
  saveSystemPrompt,
  clearSystemPrompt,
  applyTemplate,
  toggleServiceDropdown,
  selectService,
  handleKeydown,
  autoResize,
  handleFileInput,
  sendMessage,
  stopStreaming,
  useChip,
  copyMessage,
  editMessage,
  saveEdit,
  cancelEdit,
  regenerateFrom,
  copyCodeBlock,
  removeFile,
  openLightbox,
  closeLightbox,
});

initializeApplication();
