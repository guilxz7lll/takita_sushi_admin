(function () {
  "use strict";

  const state = {
    products: [],
    categories: [],
    settings: {},
    cart: loadCart(),
    selectedCategory: "todos",
    featuredIndex: 0,
    featuredTimer: null,
    mapsLink: ""
  };

  const paymentLabels = {
    pix: "Pix",
    cash: "Dinheiro",
    debit: "Cartão de débito",
    credit: "Cartão de crédito"
  };

  function loadCart() {
    try {
      const saved = JSON.parse(localStorage.getItem("takita_cart"));
      if (!Array.isArray(saved)) return [];
      return saved
        .map((item) => ({ id: Number(item.id), quantity: Number(item.quantity) }))
        .filter((item) => Number.isInteger(item.id) && Number.isInteger(item.quantity) && item.quantity > 0);
    } catch (_error) {
      return [];
    }
  }

  function saveCart() {
    localStorage.setItem("takita_cart", JSON.stringify(state.cart));
  }

  function formatCurrency(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Consultar";
    return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function resolveImage(imageUrl) {
    const value = String(imageUrl || "").trim();
    if (!value) return "imagens/logo.png";
    if (/^(https?:|data:|blob:|\/)/i.test(value)) return value;
    if (value.startsWith("imagens/")) return value;
    return `imagens/${value}`;
  }

  function categoryName(categoryId) {
    return state.categories.find((category) => category.id === categoryId)?.name || "Produto";
  }

  function showToast(message, type = "success") {
    let toast = document.getElementById("toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.dataset.type = type;
    toast.classList.add("active");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("active"), 3200);
  }

  function syncCartWithCatalog() {
    const activeIds = new Set(state.products.map((product) => Number(product.id)));
    state.cart = state.cart.filter((item) => activeIds.has(Number(item.id)));
    saveCart();
  }

  function createProductCard(product, featuredLayout = false) {
    const article = document.createElement("article");
    article.className = `product-card${featuredLayout ? " product-featured" : ""}${product.featured ? " big-card" : ""}`;
    article.dataset.category = product.category_id;
    article.dataset.productId = product.id;
    article.innerHTML = `
      <div class="product-image">
        <img src="${escapeHtml(resolveImage(product.image_url))}" alt="${escapeHtml(product.name)}" loading="lazy" />
      </div>
      <div class="product-info">
        <span>${escapeHtml(product.feature_tag || categoryName(product.category_id))}</span>
        <h3>${escapeHtml(product.name)}</h3>
        <p>${escapeHtml(product.description || "")}</p>
        <div class="product-footer">
          <strong>${formatCurrency(product.price)}</strong>
          <button class="add-btn" type="button" data-id="${Number(product.id)}" ${state.settings.is_open ? "" : "disabled"}>
            <i data-lucide="plus"></i>
            Adicionar
          </button>
        </div>
      </div>`;
    return article;
  }

  function renderCategories() {
    const container = document.querySelector(".category-buttons");
    if (!container || !document.getElementById("menuGrid")) return;

    container.innerHTML = "";
    const all = [{ id: "todos", name: "Todos" }, ...state.categories];
    all.forEach((category) => {
      const button = document.createElement("button");
      button.className = `category-btn${category.id === state.selectedCategory ? " active" : ""}`;
      button.type = "button";
      button.dataset.category = category.id;
      button.textContent = category.name;
      container.appendChild(button);
    });
  }

  function renderMenu() {
    const grid = document.getElementById("menuGrid") || document.querySelector(".menu-section .menu-grid");
    if (!grid) return;

    const page = window.location.pathname.split("/").pop() || "index.html";
    const onlyBoats = page === "barcas.html";
    const products = state.products.filter((product) => {
      if (onlyBoats) return product.category_id === "barca";
      return state.selectedCategory === "todos" || product.category_id === state.selectedCategory;
    });

    grid.innerHTML = "";
    if (products.length === 0) {
      grid.innerHTML = '<p class="empty-menu">Nenhum produto disponível nesta categoria.</p>';
      return;
    }

    products.forEach((product) => grid.appendChild(createProductCard(product, onlyBoats)));
    window.lucide?.createIcons();
  }

  function featuredProducts() {
    const featured = state.products.filter((product) => product.featured);
    return featured.length ? featured : state.products.slice(0, 3);
  }

  function updateFeatured(index) {
    const items = featuredProducts();
    if (!items.length) return;
    state.featuredIndex = ((index % items.length) + items.length) % items.length;
    const item = items[state.featuredIndex];
    const image = document.getElementById("featuredImage");
    if (!image) return;

    image.classList.add("changing");
    window.setTimeout(() => {
      image.src = resolveImage(item.image_url);
      image.alt = item.name;
      const tag = document.getElementById("featuredTag");
      const name = document.getElementById("featuredName");
      const price = document.getElementById("featuredPrice");
      const info = document.getElementById("featuredInfo");
      if (tag) tag.textContent = item.feature_tag || "Destaque";
      if (name) name.textContent = item.name;
      if (price) price.textContent = formatCurrency(item.price);
      if (info) info.textContent = item.description || "";
      image.classList.remove("changing");
      renderFeaturedDots(items.length);
    }, 180);
  }

  function renderFeaturedDots(count) {
    const dots = document.getElementById("featuredDots");
    if (!dots) return;
    dots.innerHTML = "";
    for (let index = 0; index < count; index += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.slide = index;
      button.className = index === state.featuredIndex ? "active" : "";
      button.setAttribute("aria-label", `Ver destaque ${index + 1}`);
      dots.appendChild(button);
    }
  }

  function startFeaturedCarousel() {
    if (!document.getElementById("featuredImage")) return;
    updateFeatured(0);
    window.clearInterval(state.featuredTimer);
    state.featuredTimer = window.setInterval(() => updateFeatured(state.featuredIndex + 1), 4000);
  }

  function getCartItems() {
    return state.cart
      .map((cartItem) => {
        const product = state.products.find((candidate) => Number(candidate.id) === Number(cartItem.id));
        return product ? { ...product, quantity: cartItem.quantity } : null;
      })
      .filter(Boolean);
  }

  function addToCart(productId) {
    if (!state.settings.is_open) {
      showToast(state.settings.closed_message, "error");
      return;
    }
    const product = state.products.find((item) => Number(item.id) === Number(productId));
    if (!product) return showToast("Produto indisponível.", "error");
    const existing = state.cart.find((item) => item.id === Number(productId));
    if (existing) existing.quantity += 1;
    else state.cart.push({ id: Number(productId), quantity: 1 });
    saveCart();
    renderCart();
    showToast("Produto adicionado ao carrinho.");
  }

  function changeQuantity(productId, delta) {
    const item = state.cart.find((candidate) => candidate.id === Number(productId));
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) state.cart = state.cart.filter((candidate) => candidate.id !== Number(productId));
    saveCart();
    renderCart();
  }

  function clearCart(showMessage = true) {
    state.cart = [];
    saveCart();
    renderCart();
    if (showMessage) showToast("Carrinho limpo.");
  }

  function renderCart() {
    const container = document.getElementById("cartItems");
    const count = document.getElementById("cartCount");
    const total = document.getElementById("cartTotal");
    const items = getCartItems();
    const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const amount = items.reduce((sum, item) => sum + Number(item.price || 0) * item.quantity, 0);

    if (count) count.textContent = quantity;
    if (total) total.textContent = formatCurrency(amount);
    if (!container) return;

    if (!items.length) {
      container.innerHTML = '<p class="empty-cart">Seu carrinho está vazio.</p>';
      return;
    }

    container.innerHTML = items.map((item) => `
      <div class="cart-item">
        <div class="cart-item-image"><img src="${escapeHtml(resolveImage(item.image_url))}" alt="${escapeHtml(item.name)}" /></div>
        <div class="cart-item-info">
          <h4>${escapeHtml(item.name)}</h4>
          <p>${formatCurrency(Number(item.price) * item.quantity)}</p>
          <div class="cart-controls">
            <button class="qty-btn" type="button" data-action="decrease" data-id="${item.id}">−</button>
            <span>${item.quantity}</span>
            <button class="qty-btn" type="button" data-action="increase" data-id="${item.id}">+</button>
            <button class="remove-btn" type="button" data-action="remove" data-id="${item.id}">remover</button>
          </div>
        </div>
      </div>`).join("");
  }

  function openCart() {
    document.getElementById("cartDrawer")?.classList.add("active");
    document.getElementById("overlay")?.classList.add("active");
    document.body.classList.add("cart-open");
  }

  function closeAllPanels() {
    document.getElementById("cartDrawer")?.classList.remove("active");
    document.getElementById("checkoutModal")?.classList.remove("active");
    document.getElementById("overlay")?.classList.remove("active");
    document.body.classList.remove("cart-open");
  }

  function openCheckout() {
    if (!state.cart.length) return showToast("Adicione um produto antes de finalizar.", "error");
    if (!state.settings.is_open) return showToast(state.settings.closed_message, "error");
    document.getElementById("cartDrawer")?.classList.remove("active");
    document.getElementById("checkoutModal")?.classList.add("active");
    document.getElementById("overlay")?.classList.add("active");
  }

  function normalizePaymentMethod(value) {
    const normalized = String(value || "").toLowerCase();
    if (normalized === "pix") return "pix";
    if (normalized.includes("dinheiro") || normalized === "cash") return "cash";
    if (normalized.includes("débito") || normalized.includes("debito") || normalized === "debit") return "debit";
    if (normalized.includes("crédito") || normalized.includes("credito") || normalized === "credit") return "credit";
    return "";
  }

  function updatePixInfo() {
    const payment = normalizePaymentMethod(document.getElementById("paymentMethod")?.value);
    const pixInfo = document.getElementById("pixInfo");
    const pixKey = document.getElementById("pixKey");
    if (pixInfo) pixInfo.style.display = payment === "pix" ? "block" : "none";
    if (pixKey) pixKey.value = state.settings.pix_key || "";
  }

  function buildWhatsappMessage(order, customer) {
    return `Olá, eu sou ${customer.name} e o meu pedido é o ${order.code}.`;
  }

  async function submitOrder(event) {
    event.preventDefault();
    if (!state.cart.length) return showToast("Seu carrinho está vazio.", "error");

    const form = event.currentTarget;
    const submitButton = form.querySelector('[type="submit"]');
    const paymentMethod = normalizePaymentMethod(document.getElementById("paymentMethod")?.value);
    if (!paymentMethod) return showToast("Selecione a forma de pagamento.", "error");

    const customer = {
      name: document.getElementById("customerName")?.value.trim() || "",
      phone: document.getElementById("customerPhone")?.value.trim() || "",
      address: document.getElementById("customerAddress")?.value.trim() || "",
      reference: document.getElementById("customerReference")?.value.trim() || "",
      location_url: document.getElementById("customerLocation")?.value || state.mapsLink || "",
      payment_method: paymentMethod,
      note: document.getElementById("customerNote")?.value.trim() || ""
    };
    const payload = {
      customer,
      items: state.cart.map((item) => ({ product_id: item.id, quantity: item.quantity }))
    };

    const whatsappWindow = window.open("about:blank", "_blank");
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.dataset.originalText = submitButton.innerHTML;
      submitButton.textContent = "Validando valores...";
    }

    try {
      const order = await window.TakitaStore.createPublicOrder(payload);
      const message = buildWhatsappMessage(order, customer);
      const whatsappNumber = String(order.settings.whatsapp_number || state.settings.whatsapp_number).replace(/\D/g, "");
      const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

      localStorage.setItem("takita_last_order", JSON.stringify({
        code: order.code,
        phone: customer.phone
      }));

      const whatsappOpenedInNewTab = Boolean(whatsappWindow);
      if (whatsappWindow) whatsappWindow.location.href = whatsappUrl;

      window.TakitaStore.markOrderWhatsappOpened(order.code).catch(() => {});
      clearCart(false);
      form.reset();
      updatePixInfo();
      closeAllPanels();
      showToast(`Pedido ${order.code} criado. Abrindo o acompanhamento...`);
      if (whatsappOpenedInNewTab) {
        window.setTimeout(() => {
          window.location.href = `pedido.html?codigo=${encodeURIComponent(order.code)}`;
        }, 450);
      } else {
        window.location.href = whatsappUrl;
      }
    } catch (error) {
      whatsappWindow?.close();
      showToast(error.message || "Não foi possível preparar o pedido.", "error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.innerHTML = submitButton.dataset.originalText || "Finalizar pedido";
        window.lucide?.createIcons();
      }
    }
  }

  function requestLocation() {
    if (!navigator.geolocation) return showToast("Seu navegador não suporta localização.", "error");
    if (!window.isSecureContext) return showToast("Abra o site com HTTPS para usar a localização.", "error");
    showToast("Buscando localização...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        state.mapsLink = `https://www.google.com/maps?q=${position.coords.latitude},${position.coords.longitude}`;
        const input = document.getElementById("customerLocation");
        if (input) input.value = state.mapsLink;
        showToast("Localização adicionada.");
      },
      () => showToast("Não foi possível acessar sua localização.", "error"),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 300000 }
    );
  }

  function applyStoreSettings() {
    const whatsappNumber = String(state.settings.whatsapp_number || "").replace(/\D/g, "");
    document.querySelectorAll('a[href*="wa.me/"], .whatsapp-dynamic').forEach((link) => {
      link.href = `https://wa.me/${whatsappNumber}`;
    });
    updatePixInfo();

    document.querySelectorAll(".store-status-banner").forEach((element) => element.remove());
    if (!state.settings.is_open) {
      const banner = document.createElement("div");
      banner.className = "store-status-banner";
      banner.innerHTML = `<strong>Pedidos pausados</strong><span>${escapeHtml(state.settings.closed_message)}</span>`;
      document.body.prepend(banner);
    }
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const addButton = event.target.closest(".add-btn");
      if (addButton) return addToCart(Number(addButton.dataset.id));

      const cartAction = event.target.closest("[data-action]");
      if (cartAction) {
        const productId = Number(cartAction.dataset.id);
        if (cartAction.dataset.action === "increase") changeQuantity(productId, 1);
        if (cartAction.dataset.action === "decrease") changeQuantity(productId, -1);
        if (cartAction.dataset.action === "remove") {
          state.cart = state.cart.filter((item) => item.id !== productId);
          saveCart();
          renderCart();
        }
        return;
      }

      const categoryButton = event.target.closest(".category-btn");
      if (categoryButton) {
        state.selectedCategory = categoryButton.dataset.category;
        renderCategories();
        renderMenu();
        return;
      }

      const dot = event.target.closest("#featuredDots button");
      if (dot) {
        updateFeatured(Number(dot.dataset.slide));
        startFeaturedCarousel();
      }
    });

    document.getElementById("openCartBtn")?.addEventListener("click", openCart);
    document.getElementById("closeCartBtn")?.addEventListener("click", closeAllPanels);
    document.getElementById("closeModalBtn")?.addEventListener("click", closeAllPanels);
    document.getElementById("overlay")?.addEventListener("click", closeAllPanels);
    document.getElementById("checkoutBtn")?.addEventListener("click", openCheckout);
    document.getElementById("clearCartBtn")?.addEventListener("click", () => clearCart(true));
    document.getElementById("checkoutForm")?.addEventListener("submit", submitOrder);
    document.getElementById("paymentMethod")?.addEventListener("change", updatePixInfo);
    document.getElementById("getLocationBtn")?.addEventListener("click", requestLocation);
    document.getElementById("copyPixBtn")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(state.settings.pix_key || "");
        showToast("Chave Pix copiada.");
      } catch (_error) {
        showToast("Não foi possível copiar a chave Pix.", "error");
      }
    });
  }

  async function init() {
    bindEvents();
    try {
      const data = await window.TakitaStore.loadPublicData();
      state.products = data.products.map((product) => ({ ...product, price: Number(product.price) }));
      state.categories = data.categories;
      state.settings = data.settings;
      document.documentElement.dataset.dataSource = data.source;
      syncCartWithCatalog();
      renderCategories();
      renderMenu();
      renderCart();
      applyStoreSettings();
      startFeaturedCarousel();
      window.lucide?.createIcons();
    } catch (error) {
      showToast("Não foi possível carregar o cardápio. Tente novamente.", "error");
      console.error(error);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
