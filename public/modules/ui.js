const HIGHLIGHT_THEMES = {
  dark: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/tokyo-night-dark.min.css",
  light:
    "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css",
};

export function setHighlightTheme(theme) {
  const hljsLink = document.getElementById("hljs-theme");
  if (!hljsLink) return;
  hljsLink.href = HIGHLIGHT_THEMES[theme] || HIGHLIGHT_THEMES.dark;
}

export function updateThemeToggleLabel(theme) {
  const label = document.getElementById("theme-label");
  if (!label) return;
  label.textContent = theme === "dark" ? "Modo claro" : "Modo oscuro";
}

export function autoResize(el, maxHeight = 240) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function capitalizeFirstLetter(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
