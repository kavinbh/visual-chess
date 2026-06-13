"use strict";

const DEFAULTS = {
  enabled: true,
  showMine: true,
  showOpp: true,
  opacity: 30,
  hoverMode: false,
  viewMode: "both",
  theme: "classic",
  mineColor: "#22c55e",
  oppColor: "#ef4444",
  hotkeyEnabled: true
};

const THEME_PRESETS = {
  classic: { mine: "#22c55e", opp: "#ef4444" },
  colorblind: { mine: "#3b82f6", opp: "#f97316" },
  cyberpunk: { mine: "#06b6d4", opp: "#ec4899" }
};

document.addEventListener("DOMContentLoaded", async () => {
  // Elements
  const enabledCb = document.getElementById("enabled");
  const viewModeSelect = document.getElementById("viewMode");
  const showMineCb = document.getElementById("showMine");
  const showOppCb = document.getElementById("showOpp");
  const themeSelect = document.getElementById("theme");
  const customColorsBox = document.getElementById("custom-colors-box");
  const mineColorPicker = document.getElementById("mineColor");
  const oppColorPicker = document.getElementById("oppColor");
  const hoverModeCb = document.getElementById("hoverMode");
  const hotkeyEnabledCb = document.getElementById("hotkeyEnabled");
  const opacitySlider = document.getElementById("opacity");
  const opacityVal = document.getElementById("opacity-val");
  const titleEl = document.getElementById("panel-title");

  function updateTitleState(enabled) {
    if (enabled) {
      titleEl.classList.remove("disabled");
    } else {
      titleEl.classList.add("disabled");
    }
  }

  function updateThemeColors(theme, customMine, customOpp) {
    let mine = customMine;
    let opp = customOpp;

    if (THEME_PRESETS[theme]) {
      mine = THEME_PRESETS[theme].mine;
      opp = THEME_PRESETS[theme].opp;
      customColorsBox.style.display = "none";
    } else {
      customColorsBox.style.display = "flex";
    }

    document.documentElement.style.setProperty("--popup-mine-color", mine);
    document.documentElement.style.setProperty("--popup-opp-color", opp);
  }

  async function updateStatusBadge() {
    const statusBadge = document.getElementById("board-status");
    const statusText = document.getElementById("status-text");

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs && tabs[0];
      if (!activeTab) {
        statusText.textContent = "No Tab";
        statusBadge.className = "status-badge inactive";
        return;
      }

      chrome.tabs.sendMessage(activeTab.id, { type: "PING" }, (response) => {
        if (chrome.runtime.lastError || !response) {
          statusText.textContent = "Inactive";
          statusBadge.className = "status-badge inactive";
        } else if (response.boardDetected) {
          statusText.textContent = response.site || "Active";
          statusBadge.className = "status-badge active";
        } else {
          statusText.textContent = "No Board";
          statusBadge.className = "status-badge inactive";
        }
      });
    } catch (e) {
      statusText.textContent = "Error";
      statusBadge.className = "status-badge inactive";
    }
  }

  // Load stored settings and initialize UI state
  const data = await chrome.storage.local.get("cvoSettings");
  const settings = { ...DEFAULTS, ...data.cvoSettings };
  
  enabledCb.checked = settings.enabled;
  viewModeSelect.value = settings.viewMode;
  showMineCb.checked = settings.showMine;
  showOppCb.checked = settings.showOpp;
  themeSelect.value = settings.theme;
  mineColorPicker.value = settings.mineColor;
  oppColorPicker.value = settings.oppColor;
  hoverModeCb.checked = settings.hoverMode;
  hotkeyEnabledCb.checked = settings.hotkeyEnabled;
  opacitySlider.value = settings.opacity;
  opacityVal.textContent = `${settings.opacity}%`;

  updateTitleState(settings.enabled);
  updateThemeColors(settings.theme, settings.mineColor, settings.oppColor);
  updateStatusBadge();

  // Save changes back to local storage
  async function save() {
    const theme = themeSelect.value;
    const mineVal = mineColorPicker.value;
    const oppVal = oppColorPicker.value;

    const settings = {
      enabled: enabledCb.checked,
      viewMode: viewModeSelect.value,
      showMine: showMineCb.checked,
      showOpp: showOppCb.checked,
      theme: theme,
      mineColor: mineVal,
      oppColor: oppVal,
      hoverMode: hoverModeCb.checked,
      hotkeyEnabled: hotkeyEnabledCb.checked,
      opacity: parseInt(opacitySlider.value, 10)
    };
    
    opacityVal.textContent = `${settings.opacity}%`;
    updateTitleState(settings.enabled);
    updateThemeColors(theme, mineVal, oppVal);
    
    await chrome.storage.local.set({ cvoSettings: settings });
  }

  // Event Listeners
  enabledCb.addEventListener("change", save);
  viewModeSelect.addEventListener("change", save);
  showMineCb.addEventListener("change", save);
  showOppCb.addEventListener("change", save);
  themeSelect.addEventListener("change", save);
  mineColorPicker.addEventListener("input", save);
  oppColorPicker.addEventListener("input", save);
  hoverModeCb.addEventListener("change", save);
  hotkeyEnabledCb.addEventListener("change", save);
  opacitySlider.addEventListener("input", save);
});