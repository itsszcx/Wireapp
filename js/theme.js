const STORAGE_KEY = "wire-theme"; // "dark" | "light"

function applyTheme(theme) {
  document.body.classList.toggle("dark", theme === "dark");
  const btn = document.getElementById("themeToggleBtn");
  if (btn) btn.textContent = theme === "dark" ? "☀️ Light" : "🌙 Dark";
}

function getPreferredTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  // No saved preference yet -- fall back to the OS/browser setting.
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let currentTheme = getPreferredTheme();
applyTheme(currentTheme);

document.getElementById("themeToggleBtn").addEventListener("click", () => {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  localStorage.setItem(STORAGE_KEY, currentTheme);
  applyTheme(currentTheme);
});
