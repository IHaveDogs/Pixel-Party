const themeGrid = document.getElementById("theme-grid");
const shopMessage = document.getElementById("shop-message");
const testCoinsButton = document.getElementById("test-coins");

const descriptions = {
  pixel: "The original lime-green pixel arcade look.",
  pixelText: "Makes menus, buttons, labels, and game text look blockier and more pixel-like.",
  sunset: "Warm gold, coral, and deep berry colors.",
  ocean: "Cool aqua lights over a deep-sea arcade.",
  candy: "Bright pink and blue with a playful glow.",
  gold: "A rich black-and-gold background with glowing coin colors."
};

function timeLeft(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderShop() {
  const owned = PP.ownedItems();
  const active = PP.activeTheme();
  const pixelTextOn = PP.pixelTextEnabled();
  const discount = PP.currentDiscount();

  themeGrid.innerHTML = Object.entries(PP.SHOP_ITEMS).map(([id, theme]) => {
    const isOwned = owned.includes(id);
    const isActive = theme.type === "font" ? pixelTextOn : active === id;
    const sale = discount && discount.item === id;
    const price = PP.itemPrice(id);
    let label = `${theme.cost} coins`;
    if (isActive && theme.type === "font") label = "Use regular text";
    else if (isActive) label = "Equipped";
    else if (isOwned) label = theme.type === "font" ? "Use pixel text" : "Equip theme";
    else label = `Buy for ${price} coins`;

    return `
      <article class="theme-card pixel-frame">
        <div class="theme-preview preview-${id}" aria-hidden="true">
          <span></span><span></span><span></span><span></span>
          <span></span><span></span><span></span><span></span>
        </div>
        ${sale ? `<span class="sale-badge">20% OFF • ${timeLeft(discount.endsAt - Date.now())}</span>` : ""}
        <h2>${PP.escapeHtml(theme.name)}</h2>
        <p>${PP.escapeHtml(descriptions[id])}</p>
        ${sale ? `<p class="price-line"><s>${theme.cost} coins</s> <strong>${price} coins</strong></p>` : ""}
        <button class="${isOwned ? "ghost-button" : "pixel-button"}" data-item="${id}" ${isActive && theme.type !== "font" ? "disabled" : ""}>${label}</button>
      </article>`;
  }).join("");

  const saleStatus = document.getElementById("sale-status");
  if (discount) {
    saleStatus.textContent = `Flash sale active! It ends in ${timeLeft(discount.endsAt - Date.now())}.`;
  } else {
    saleStatus.textContent = `Next random 20% discount in ${timeLeft(PP.nextDiscountAt() - Date.now())}.`;
  }
}

themeGrid.addEventListener("click", event => {
  const button = event.target.closest("[data-item]");
  if (!button) return;
  const id = button.dataset.item;

  if (PP.ownedItems().includes(id)) {
    if (id === "pixelText" && PP.pixelTextEnabled()) {
      PP.applyPixelText(false);
      shopMessage.textContent = "Regular text is back on.";
    } else {
      PP.equipItem(id);
      shopMessage.textContent = `${PP.SHOP_ITEMS[id].name} is now equipped.`;
    }
  } else {
    const price = PP.itemPrice(id);
    const result = PP.buyItem(id);
    shopMessage.textContent = result.ok
      ? `${PP.SHOP_ITEMS[id].name} purchased for ${result.price} coins and equipped!`
      : `You need ${Math.max(0, price - PP.coins())} more coins for that item.`;
  }
  renderShop();
});

window.addEventListener("pp:coinschange", renderShop);
testCoinsButton.addEventListener("click", () => {
  PP.addCoins(500);
  shopMessage.textContent = "500 test coins added.";
});
renderShop();
setInterval(renderShop, 1000);
