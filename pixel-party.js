(function (global) {
  const USERNAME_KEY = "pixel-party:username";
  const COINS_KEY = "pixel-party:coins";
  const COIN_PROGRESS_KEY = "pixel-party:coin-progress";
  const OWNED_THEMES_KEY = "pixel-party:owned-themes";
  const ACTIVE_THEME_KEY = "pixel-party:active-theme";
  const PIXEL_TEXT_KEY = "pixel-party:pixel-text";
  const DISCOUNT_EPOCH_KEY = "pixel-party:discount-epoch";
  const DISCOUNT_PICK_KEY = "pixel-party:discount-pick";
  const DISCOUNT_CYCLE_MS = 5 * 60 * 1000;
  const DISCOUNT_LENGTH_MS = 3 * 60 * 1000;
  const THEMES = {
    pixel: { name: "Pixel Classic", cost: 0, type: "theme" },
    sunset: { name: "Sunset Arcade", cost: 60, type: "theme" },
    ocean: { name: "Ocean Quest", cost: 60, type: "theme" },
    candy: { name: "Candy Pop", cost: 60, type: "theme" },
    gold: { name: "Golden Arcade", cost: 70, type: "theme" }
  };
  const SHOP_ITEMS = {
    pixel: THEMES.pixel,
    pixelText: { name: "Pixel Text", cost: 100, type: "font" },
    sunset: THEMES.sunset,
    ocean: THEMES.ocean,
    candy: THEMES.candy,
    gold: THEMES.gold
  };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character]));
  }

  function normalizeUsername(value) {
    return String(value || "").trim().slice(0, 16);
  }

  function currentUsername() {
    return localStorage.getItem(USERNAME_KEY) || "";
  }

  function setUsername(value) {
    const username = normalizeUsername(value);
    if (username) {
      localStorage.setItem(USERNAME_KEY, username);
    } else {
      localStorage.removeItem(USERNAME_KEY);
    }

    global.dispatchEvent(new CustomEvent("pp:userchange", {
      detail: { username }
    }));

    return username;
  }

  function onUsernameChange(handler) {
    global.addEventListener("pp:userchange", () => handler(currentUsername()));
  }

  function storageKey(scope) {
    const suffix = currentUsername().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "guest";
    return `${scope}:${suffix}`;
  }

  function coins() {
    return Math.max(0, Math.floor(Number(localStorage.getItem(COINS_KEY)) || 0));
  }

  function setCoins(value) {
    const balance = Math.max(0, Math.floor(Number(value) || 0));
    localStorage.setItem(COINS_KEY, String(balance));
    global.dispatchEvent(new CustomEvent("pp:coinschange", { detail: { coins: balance } }));
    return balance;
  }

  function addCoins(amount) {
    return setCoins(coins() + Math.max(0, Math.floor(Number(amount) || 0)));
  }

  function ownedItems() {
    try {
      const saved = JSON.parse(localStorage.getItem(OWNED_THEMES_KEY)) || [];
      return Array.from(new Set(["pixel", ...saved.filter(name => SHOP_ITEMS[name])]));
    } catch {
      return ["pixel"];
    }
  }

  function ownedThemes() {
    return ownedItems().filter(name => THEMES[name]);
  }

  function activeTheme() {
    const saved = localStorage.getItem(ACTIVE_THEME_KEY) || "pixel";
    return ownedThemes().includes(saved) ? saved : "pixel";
  }

  function applyTheme(name) {
    const theme = THEMES[name] && ownedThemes().includes(name) ? name : "pixel";
    localStorage.setItem(ACTIVE_THEME_KEY, theme);
    document.documentElement.dataset.ppTheme = theme;
    global.dispatchEvent(new CustomEvent("pp:themechange", { detail: { theme } }));
    return theme;
  }

  function pixelTextEnabled() {
    return ownedItems().includes("pixelText") && localStorage.getItem(PIXEL_TEXT_KEY) === "on";
  }

  function applyPixelText(enabled) {
    const next = Boolean(enabled) && ownedItems().includes("pixelText");
    localStorage.setItem(PIXEL_TEXT_KEY, next ? "on" : "off");
    if (next) document.documentElement.dataset.ppFont = "pixel";
    else delete document.documentElement.dataset.ppFont;
    global.dispatchEvent(new CustomEvent("pp:fontchange", { detail: { pixelText: next } }));
    return next;
  }

  function discountEpoch() {
    let epoch = Number(localStorage.getItem(DISCOUNT_EPOCH_KEY));
    if (!epoch || epoch > Date.now()) {
      epoch = Date.now();
      localStorage.setItem(DISCOUNT_EPOCH_KEY, String(epoch));
    }
    return epoch;
  }

  function currentDiscount() {
    const elapsed = Math.max(0, Date.now() - discountEpoch());
    const cycle = Math.floor(elapsed / DISCOUNT_CYCLE_MS);
    const cycleElapsed = elapsed % DISCOUNT_CYCLE_MS;
    if (cycle < 1 || cycleElapsed >= DISCOUNT_LENGTH_MS) return null;

    const eligible = Object.keys(SHOP_ITEMS).filter(id => SHOP_ITEMS[id].cost > 0 && !ownedItems().includes(id));
    if (!eligible.length) return null;

    let pick;
    try { pick = JSON.parse(localStorage.getItem(DISCOUNT_PICK_KEY)); } catch { pick = null; }
    if (!pick || pick.cycle !== cycle || !SHOP_ITEMS[pick.item]) {
      pick = { cycle, item: eligible[Math.floor(Math.random() * eligible.length)] };
      localStorage.setItem(DISCOUNT_PICK_KEY, JSON.stringify(pick));
    }

    if (ownedItems().includes(pick.item)) return null;

    return {
      item: pick.item,
      percent: 20,
      endsAt: discountEpoch() + cycle * DISCOUNT_CYCLE_MS + DISCOUNT_LENGTH_MS
    };
  }

  function nextDiscountAt() {
    const elapsed = Math.max(0, Date.now() - discountEpoch());
    const nextCycle = Math.floor(elapsed / DISCOUNT_CYCLE_MS) + 1;
    return discountEpoch() + nextCycle * DISCOUNT_CYCLE_MS;
  }

  function itemPrice(name) {
    const item = SHOP_ITEMS[name];
    if (!item) return 0;
    const discount = currentDiscount();
    return discount && discount.item === name ? Math.ceil(item.cost * 0.8) : item.cost;
  }

  function equipItem(name) {
    const item = SHOP_ITEMS[name];
    if (!item || !ownedItems().includes(name)) return false;
    if (item.type === "font") return applyPixelText(true);
    return applyTheme(name);
  }

  function buyItem(name) {
    const item = SHOP_ITEMS[name];
    if (!item) return { ok: false, reason: "missing" };
    if (ownedItems().includes(name)) return { ok: true, owned: true, item: equipItem(name) };
    const price = itemPrice(name);
    if (coins() < price) return { ok: false, reason: "coins", price };

    setCoins(coins() - price);
    const owned = [...ownedItems(), name];
    localStorage.setItem(OWNED_THEMES_KEY, JSON.stringify(Array.from(new Set(owned))));
    return { ok: true, owned: false, price, item: equipItem(name) };
  }

  function buyTheme(name) {
    return buyItem(name);
  }

  function mountCoinBar() {
    let bar = document.getElementById("pp-coin-bar");
    if (!bar) {
      bar = document.createElement("a");
      bar.id = "pp-coin-bar";
      bar.className = "pp-coin-bar";
      bar.href = "CoinShop.html";
      bar.setAttribute("aria-label", "Open Coin Shop");
      document.body.appendChild(bar);
    }

    const render = () => {
      bar.innerHTML = `<span class="pp-coin-icon" aria-hidden="true">C</span><span><b>${coins()}</b><small> COINS</small></span>`;
    };
    render();
    global.addEventListener("pp:coinschange", render);
  }

  function startCoinTimer(options = {}) {
    const rate = Math.max(0, Number(options.rate) || 1);
    const isActive = typeof options.isActive === "function" ? options.isActive : () => true;
    let last = performance.now();

    const timer = global.setInterval(() => {
      const now = performance.now();
      const elapsed = Math.min(2000, Math.max(0, now - last));
      last = now;
      if (document.hidden || !isActive()) return;

      let progress = Number(localStorage.getItem(COIN_PROGRESS_KEY)) || 0;
      progress += elapsed * rate;
      const earned = Math.floor(progress / 60000);
      if (earned > 0) {
        addCoins(earned);
        progress -= earned * 60000;
      }
      localStorage.setItem(COIN_PROGRESS_KEY, String(progress));
    }, 1000);

    return () => global.clearInterval(timer);
  }

  function formatPlayers(value) {
    const count = Number(value) || 0;
    if (count >= 1000000) return `${(count / 1000000).toFixed(count >= 10000000 ? 0 : 1).replace(/\.0$/, "")}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1).replace(/\.0$/, "")}K`;
    return String(count);
  }

  function mountAuthBar(target, options = {}) {
    if (!target) return;

    const label = options.label || "Save progress";
    const note = options.note || "Use a username to keep your best scores on this device.";
    const username = currentUsername();

    target.innerHTML = `
      <form class="pp-auth-bar" autocomplete="off">
        <label class="pp-auth-field">
          <span>${escapeHtml(label)}</span>
          <input
            name="username"
            maxlength="16"
            autocomplete="nickname"
            placeholder="PLAYER"
            value="${escapeHtml(username)}"
          />
        </label>
        <button type="submit">${username ? "Update" : "Save"}</button>
      </form>
      <p class="pp-auth-note">${escapeHtml(note)}</p>
    `;

    const form = target.querySelector("form");
    const input = target.querySelector("input");
    const submit = target.querySelector("button");

    submit.textContent = username ? "Update" : "Save";

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const saved = setUsername(input.value);
      mountAuthBar(target, options);
      if (typeof options.onChange === "function") {
        options.onChange(saved);
      }
    });
  }

  global.PP = {
    SHOP_ITEMS,
    THEMES,
    activeTheme,
    addCoins,
    applyPixelText,
    applyTheme,
    buyItem,
    buyTheme,
    coins,
    currentDiscount,
    currentUsername,
    equipItem,
    escapeHtml,
    formatPlayers,
    itemPrice,
    mountAuthBar,
    nextDiscountAt,
    onUsernameChange,
    ownedItems,
    ownedThemes,
    pixelTextEnabled,
    setCoins,
    setUsername,
    startCoinTimer,
    storageKey
  };

  discountEpoch();
  applyTheme(activeTheme());
  applyPixelText(pixelTextEnabled());
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountCoinBar, { once: true });
  } else {
    mountCoinBar();
  }
})(window);
