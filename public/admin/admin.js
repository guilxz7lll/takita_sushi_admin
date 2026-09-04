(function () {
  "use strict";

  const Store = window.TakitaStore;
  const state = {
    data: { categories: [], products: [], settings: {}, orders: [] },
    reportData: [],
    view: "dashboard",
    editingImageUrl: ""
  };

  let adminAudioContext = null;
  let orderSubscription = null;
  let orderFallbackTimer = null;
  let realtimeReloadTimer = null;

  const statusLabels = {
    awaiting_whatsapp: "Aguardando WhatsApp",
    whatsapp_opened: "WhatsApp aberto",
    confirmed: "Confirmado",
    preparing: "Em preparo",
    out_for_delivery: "Saiu para entrega",
    completed: "Concluído",
    cancelled: "Cancelado"
  };
  const paymentLabels = { pix: "Pix", cash: "Dinheiro", debit: "Débito", credit: "Crédito" };
  const viewTitles = {
    dashboard: ["Painel administrativo", "Visão geral"],
    products: ["Gestão do cardápio", "Produtos"],
    orders: ["Atendimento", "Pedidos"],
    reports: ["Auditoria e resultados", "Relatórios"],
    settings: ["Preferências da loja", "Configurações"]
  };

  const $ = (selector, context = document) => context.querySelector(selector);
  const $$ = (selector, context = document) => Array.from(context.querySelectorAll(selector));

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatDate(value, includeTime = true) {
    if (!value) return "—";
    return new Date(value).toLocaleString("pt-BR", includeTime
      ? { dateStyle: "short", timeStyle: "short" }
      : { dateStyle: "short" });
  }

  function resolveImage(imageUrl) {
    const value = String(imageUrl || "").trim();
    if (!value) return "../imagens/logo.png";
    if (/^(https?:|data:|blob:|\/)/i.test(value)) return value;
    if (value.startsWith("imagens/")) return `../${value}`;
    return `../imagens/${value}`;
  }

  function showToast(message, type = "success") {
    const toast = $("#adminToast");
    toast.textContent = message;
    toast.className = `admin-toast active${type === "error" ? " error" : ""}`;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("active"), 3300);
  }

  function ensureAdminAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!adminAudioContext) adminAudioContext = new AudioContextClass();
    if (adminAudioContext.state === "suspended") adminAudioContext.resume().catch(() => {});
    return adminAudioContext;
  }

  function playAdminSound(kind = "update") {
    const context = ensureAdminAudio();
    if (!context || context.state !== "running") return;
    const frequencies = kind === "new" ? [523, 659, 784] : [659, 784];
    const now = context.currentTime;
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === "new" ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      const start = now + index * 0.11;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(kind === "new" ? 0.16 : 0.1, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.15);
    });
  }

  function adminNotificationsEnabled() {
    return "Notification" in window && Notification.permission === "granted";
  }

  function updateAdminNotificationButton() {
    const button = $("#adminNotificationsButton");
    if (!button) return;
    const enabled = adminNotificationsEnabled();
    button.classList.toggle("active", enabled);
    button.setAttribute("aria-label", enabled ? "Notificações ativadas" : "Ativar notificações");
    button.innerHTML = enabled
      ? '<i data-lucide="bell-ring"></i><span>Ativadas</span>'
      : '<i data-lucide="bell"></i><span>Notificações</span>';
    window.lucide?.createIcons();
  }

  async function requestAdminNotifications() {
    ensureAdminAudio();
    if (!("Notification" in window)) return showToast("Este navegador não oferece notificações.", "error");
    try {
      const permission = await Notification.requestPermission();
      updateAdminNotificationButton();
      if (permission === "granted") {
        playAdminSound("update");
        showToast("Notificações ativadas.");
      } else {
        showToast("Permissão de notificações não concedida.", "error");
      }
    } catch (_error) {
      showToast("Não foi possível ativar as notificações.", "error");
    }
  }

  function showSystemNotification(title, body, tag) {
    if (!adminNotificationsEnabled() || document.visibilityState === "visible") return;
    try { new Notification(title, { body, tag }); } catch (_error) {}
  }

  function scheduleRealtimeReload() {
    window.clearTimeout(realtimeReloadTimer);
    realtimeReloadTimer = window.setTimeout(async () => {
      try {
        await reloadData();
        if (state.view === "reports") await loadReport();
      } catch (_error) {}
    }, 220);
  }

  function handleOrderRealtime(payload) {
    if (payload.eventType === "INSERT") {
      const order = payload.new || {};
      playAdminSound("new");
      showToast(`Novo pedido ${order.code || "recebido"}.`);
      showSystemNotification(
        "Novo pedido Takita Sushi",
        `${order.code || "Novo pedido"}${order.customer_name ? ` • ${order.customer_name}` : ""}`,
        `takita-new-${order.id || Date.now()}`
      );
    } else if (payload.eventType === "UPDATE") {
      const current = payload.new || {};
      const previous = payload.old || {};
      if (current.customer_confirmed_at && current.customer_confirmed_at !== previous.customer_confirmed_at) {
        playAdminSound("update");
        showToast(`${current.code || "Pedido"} confirmado como entregue pelo cliente.`);
        showSystemNotification(
          "Entrega confirmada",
          `${current.code || "Pedido"} foi confirmado como entregue pelo cliente.`,
          `takita-delivered-${current.id || Date.now()}`
        );
      }
    }
    scheduleRealtimeReload();
  }

  function stopOrderSync() {
    orderSubscription?.unsubscribe?.();
    orderSubscription = null;
    window.clearInterval(orderFallbackTimer);
    orderFallbackTimer = null;
    window.clearTimeout(realtimeReloadTimer);
  }

  function startOrderSync() {
    stopOrderSync();
    orderSubscription = Store.subscribeAdminOrders(handleOrderRealtime);
    orderFallbackTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") reloadData().catch(() => {});
    }, 8000);
  }

  function setButtonLoading(button, loading, text = "Salvando...") {
    if (!button) return;
    if (loading) {
      button.dataset.original = button.innerHTML;
      button.textContent = text;
      button.disabled = true;
    } else {
      button.innerHTML = button.dataset.original || button.innerHTML;
      button.disabled = false;
      window.lucide?.createIcons();
    }
  }

  function showLogin() {
    $("#loginScreen").hidden = false;
    $("#adminApp").hidden = true;
    $("#setupWarning").hidden = Store.isConfigured();
    const submit = $("#adminLoginForm button[type='submit']");
    submit.disabled = !Store.isConfigured();
    window.lucide?.createIcons();
  }

  function showApp() {
    $("#loginScreen").hidden = true;
    $("#adminApp").hidden = false;
    $("#loadingPanel").hidden = false;
    $$('[data-view-panel]').forEach((panel) => panel.classList.remove("active"));
    window.lucide?.createIcons();
  }

  function setView(view) {
    state.view = view;
    $$('[data-view-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === view));
    $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    $("#viewKicker").textContent = viewTitles[view][0];
    $("#viewTitle").textContent = viewTitles[view][1];
    closeSidebar();
    window.lucide?.createIcons();
  }

  function openSidebar() {
    $("#sidebar").classList.add("open");
    $("#sidebarOverlay").classList.add("active");
  }

  function closeSidebar() {
    $("#sidebar").classList.remove("open");
    $("#sidebarOverlay").classList.remove("active");
  }

  function statusClass(status) {
    if (["awaiting_whatsapp", "whatsapp_opened"].includes(status)) return "pending";
    if (status === "confirmed") return "confirmed";
    if (status === "preparing") return "preparing";
    if (status === "out_for_delivery") return "delivery";
    return status;
  }

  function orderBadge(status) {
    return `<span class="status-badge ${statusClass(status)}">${escapeHtml(statusLabels[status] || status)}</span>`;
  }

  function renderStoreStatus() {
    const pill = $("#storePill");
    const isOpen = Boolean(state.data.settings.is_open);
    pill.className = `store-pill ${isOpen ? "open" : "closed"}`;
    $("strong", pill).textContent = isOpen ? "Loja aberta" : "Loja fechada";
  }

  function isToday(value) {
    const date = new Date(value);
    const today = new Date();
    return date.getFullYear() === today.getFullYear()
      && date.getMonth() === today.getMonth()
      && date.getDate() === today.getDate();
  }

  function renderDashboard() {
    const todayOrders = state.data.orders.filter((order) => isToday(order.created_at));
    const validTodayOrders = todayOrders.filter((order) => order.status !== "cancelled");
    const pending = state.data.orders.filter((order) => ["awaiting_whatsapp", "whatsapp_opened"].includes(order.status));
    const activeProducts = state.data.products.filter((product) => product.active);
    const inactiveProducts = state.data.products.length - activeProducts.length;
    const todayRevenue = validTodayOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);

    $("#todayOrdersMetric").textContent = todayOrders.length;
    $("#todayRevenueMetric").textContent = formatCurrency(todayRevenue);
    $("#pendingOrdersMetric").textContent = pending.length;
    $("#activeProductsMetric").textContent = activeProducts.length;
    $("#inactiveProductsCaption").textContent = `${inactiveProducts} pausado${inactiveProducts === 1 ? "" : "s"}`;
    $("#pendingOrdersBadge").textContent = pending.length;
    $("#welcomeSummary").textContent = state.data.settings.is_open
      ? `A loja está recebendo pedidos e possui ${activeProducts.length} produtos ativos.`
      : "A loja está fechada para novos pedidos no momento.";

    const recent = state.data.orders.slice(0, 6);
    $("#recentOrdersBody").innerHTML = recent.map((order) => `
      <tr data-order-id="${order.id}">
        <td data-label="Pedido"><button class="text-button order-code" type="button" data-view-order="${order.id}">${escapeHtml(order.code)}</button></td>
        <td data-label="Cliente"><div class="customer-cell"><strong>${escapeHtml(order.customer_name)}</strong><span>${escapeHtml(order.customer_phone)}</span></div></td>
        <td data-label="Horário">${formatDate(order.created_at)}</td>
        <td data-label="Total"><strong>${formatCurrency(order.total)}</strong></td>
        <td data-label="Status">${orderBadge(order.status)}</td>
      </tr>`).join("");
    $("#recentOrdersEmpty").hidden = recent.length > 0;
  }

  function filteredProducts() {
    const search = $("#productSearch").value.trim().toLocaleLowerCase("pt-BR");
    const status = $("#productStatusFilter").value;
    return state.data.products.filter((product) => {
      const matchesText = `${product.name} ${product.categories?.name || ""}`.toLocaleLowerCase("pt-BR").includes(search);
      const matchesStatus = status === "all"
        || (status === "active" && product.active)
        || (status === "inactive" && !product.active)
        || (status === "featured" && product.featured);
      return matchesText && matchesStatus;
    });
  }

  function renderProducts() {
    const products = filteredProducts();
    $("#productsCountLabel").textContent = `${products.length} produto${products.length === 1 ? "" : "s"}`;
    $("#productsTableBody").innerHTML = products.map((product) => `
      <tr>
        <td data-label="Produto"><div class="product-cell"><img src="${escapeHtml(resolveImage(product.image_url))}" alt="" /><div><strong>${escapeHtml(product.name)}</strong><small>${product.featured ? "Destaque da home" : "Produto do cardápio"}</small></div></div></td>
        <td data-label="Categoria">${escapeHtml(product.categories?.name || product.category_id)}</td>
        <td data-label="Preço"><strong>${formatCurrency(product.price)}</strong></td>
        <td data-label="Status"><span class="status-badge ${product.active ? "active" : "inactive"}">${product.active ? "Ativo" : "Pausado"}</span></td>
        <td data-label="Ações"><div class="row-actions">
          <button type="button" title="${product.active ? "Pausar" : "Ativar"}" data-toggle-product="${product.id}" data-next-active="${!product.active}"><i data-lucide="${product.active ? "pause" : "play"}"></i></button>
          <button type="button" title="Editar" data-edit-product="${product.id}"><i data-lucide="pencil"></i></button>
        </div></td>
      </tr>`).join("");
    $("#productsEmpty").hidden = products.length > 0;
    window.lucide?.createIcons();
  }

  function filteredOrders() {
    const search = $("#orderSearch").value.trim().toLocaleLowerCase("pt-BR");
    const status = $("#orderStatusFilter").value;
    return state.data.orders.filter((order) => {
      const matchesText = `${order.code} ${order.customer_name} ${order.customer_phone}`.toLocaleLowerCase("pt-BR").includes(search);
      const matchesStatus = status === "all" || order.status === status;
      return matchesText && matchesStatus;
    });
  }

  function statusOptions(selectedStatus) {
    return Object.entries(statusLabels)
      .map(([value, label]) => `<option value="${value}" ${value === selectedStatus ? "selected" : ""}>${label}</option>`)
      .join("");
  }

  function renderOrders() {
    const orders = filteredOrders();
    $("#ordersCountLabel").textContent = `${orders.length} pedido${orders.length === 1 ? "" : "s"}`;
    $("#ordersTableBody").innerHTML = orders.map((order) => `
      <tr>
        <td data-label="Pedido"><button class="text-button order-code" type="button" data-view-order="${order.id}">${escapeHtml(order.code)}</button></td>
        <td data-label="Cliente"><div class="customer-cell"><strong>${escapeHtml(order.customer_name)}</strong><span>${escapeHtml(order.customer_phone)}</span></div></td>
        <td data-label="Data">${formatDate(order.created_at)}</td>
        <td data-label="Pagamento">${escapeHtml(paymentLabels[order.payment_method] || order.payment_method)}</td>
        <td data-label="Total"><strong>${formatCurrency(order.total)}</strong></td>
        <td data-label="Status"><select class="status-select" data-order-status="${order.id}">${statusOptions(order.status)}</select></td>
        <td data-label="Ações"><div class="row-actions"><button type="button" title="Ver detalhes" data-view-order="${order.id}"><i data-lucide="eye"></i></button><button class="danger-action" type="button" title="Excluir da tela e manter no relatório" data-archive-order="${order.id}"><i data-lucide="trash-2"></i></button></div></td>
      </tr>`).join("");
    $("#ordersEmpty").hidden = orders.length > 0;
    window.lucide?.createIcons();
  }

  function fillSettingsForm() {
    const settings = state.data.settings;
    $("#storeName").value = settings.store_name || "";
    $("#whatsappNumber").value = settings.whatsapp_number || "";
    $("#pixKeySetting").value = settings.pix_key || "";
    $("#creditFee").value = Number(settings.credit_card_fee_percent || 0);
    $("#storeOpen").checked = Boolean(settings.is_open);
    $("#closedMessage").value = settings.closed_message || "";
  }

  function renderAll() {
    renderStoreStatus();
    renderDashboard();
    renderProducts();
    renderOrders();
    fillSettingsForm();
    $("#loadingPanel").hidden = true;
    setView(state.view);
  }

  async function reloadData() {
    state.data = await Store.loadAdminData();
    renderAll();
  }

  function fillCategoryOptions(selected = "") {
    $("#productCategory").innerHTML = state.data.categories
      .filter((category) => category.active)
      .map((category) => `<option value="${escapeHtml(category.id)}" ${category.id === selected ? "selected" : ""}>${escapeHtml(category.name)}</option>`)
      .join("");
  }

  function renderImagePreview(url) {
    const preview = $("#imagePreview");
    preview.innerHTML = url
      ? `<img src="${escapeHtml(resolveImage(url))}" alt="Prévia do produto" />`
      : '<i data-lucide="image-plus"></i><span>Prévia da imagem</span>';
    window.lucide?.createIcons();
  }

  function openModal(id) {
    const modal = $(`#${id}`);
    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    const modal = $(`#${id}`);
    modal.classList.remove("active");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function openNewProduct() {
    $("#productForm").reset();
    $("#productId").value = "";
    $("#productActive").checked = true;
    $("#productCost").value = 0;
    $("#productSortOrder").value = (Math.max(0, ...state.data.products.map((product) => Number(product.sort_order || 0))) + 10);
    $("#productModalTitle").textContent = "Novo produto";
    state.editingImageUrl = "";
    fillCategoryOptions();
    renderImagePreview("");
    openModal("productModal");
  }

  function openEditProduct(productId) {
    const product = state.data.products.find((candidate) => Number(candidate.id) === Number(productId));
    if (!product) return;
    $("#productForm").reset();
    $("#productId").value = product.id;
    $("#productName").value = product.name;
    $("#productPrice").value = Number(product.price);
    $("#productCost").value = Number(product.cost_price || 0);
    $("#productDescription").value = product.description || "";
    $("#productSortOrder").value = Number(product.sort_order || 0);
    $("#productFeatureTag").value = product.feature_tag || "";
    $("#productActive").checked = Boolean(product.active);
    $("#productFeatured").checked = Boolean(product.featured);
    $("#productModalTitle").textContent = "Editar produto";
    state.editingImageUrl = product.image_url || "";
    fillCategoryOptions(product.category_id);
    renderImagePreview(state.editingImageUrl);
    openModal("productModal");
  }

  async function submitProduct(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('[type="submit"]');
    setButtonLoading(button, true, "Salvando produto...");
    try {
      const file = $("#productImageFile").files[0];
      const imageUrl = file ? await Store.uploadProductImage(file) : state.editingImageUrl;
      if (!imageUrl) throw new Error("Selecione uma imagem para o produto.");

      const id = Number($("#productId").value) || null;
      await Store.saveProduct({
        id,
        name: $("#productName").value.trim(),
        category_id: $("#productCategory").value,
        price: Number($("#productPrice").value),
        cost_price: Number($("#productCost").value || 0),
        description: $("#productDescription").value.trim(),
        image_url: imageUrl,
        sort_order: Number($("#productSortOrder").value || 0),
        feature_tag: $("#productFeatureTag").value.trim(),
        active: $("#productActive").checked,
        featured: $("#productFeatured").checked
      });
      await reloadData();
      closeModal("productModal");
      showToast(id ? "Produto atualizado." : "Produto criado.");
    } catch (error) {
      showToast(error.message || "Não foi possível salvar o produto.", "error");
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function toggleProduct(productId, nextActive) {
    try {
      await Store.setProductActive(productId, nextActive);
      await reloadData();
      showToast(nextActive ? "Produto ativado." : "Produto pausado.");
    } catch (error) {
      showToast(error.message || "Não foi possível alterar o produto.", "error");
    }
  }

  async function submitSettings(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('[type="submit"]');
    setButtonLoading(button, true, "Salvando...");
    try {
      await Store.updateSettings({
        store_name: $("#storeName").value.trim(),
        whatsapp_number: $("#whatsappNumber").value.replace(/\D/g, ""),
        pix_key: $("#pixKeySetting").value.trim(),
        credit_card_fee_percent: Number($("#creditFee").value || 0),
        is_open: $("#storeOpen").checked,
        closed_message: $("#closedMessage").value.trim()
      });
      await reloadData();
      showToast("Configurações atualizadas.");
    } catch (error) {
      showToast(error.message || "Não foi possível salvar as configurações.", "error");
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function changeOrderStatus(orderId, status, select) {
    select.disabled = true;
    try {
      await Store.updateOrderStatus(orderId, status);
      await reloadData();
      showToast("Status do pedido atualizado.");
    } catch (error) {
      select.disabled = false;
      showToast(error.message || "Não foi possível atualizar o pedido.", "error");
    }
  }

  function openOrderDetail(orderId) {
    const order = state.data.orders.find((candidate) => Number(candidate.id) === Number(orderId));
    if (!order) return;
    $("#orderModalTitle").textContent = order.code;
    const items = order.order_items || [];
    $("#orderDetailContent").innerHTML = `
      <div class="order-detail">
        <div class="order-detail-grid">
          <div class="detail-box"><span>Cliente</span><strong>${escapeHtml(order.customer_name)}</strong><p>${escapeHtml(order.customer_phone)}</p></div>
          <div class="detail-box"><span>Status</span><strong>${escapeHtml(statusLabels[order.status] || order.status)}</strong><p>${formatDate(order.created_at)}</p></div>
          <div class="detail-box"><span>Entrega</span><strong>${escapeHtml(order.customer_address)}</strong><p>Referência: ${escapeHtml(order.customer_reference || "Não informada")}</p></div>
          <div class="detail-box"><span>Pagamento</span><strong>${escapeHtml(paymentLabels[order.payment_method] || order.payment_method)}</strong><p>${Number(order.fee) > 0 ? `Taxa: ${formatCurrency(order.fee)}` : "Sem taxa adicional"}</p></div>
        </div>
        <div class="detail-section"><h3>Itens</h3>${items.map((item) => `<div class="detail-item"><span>${item.quantity}x ${escapeHtml(item.product_name)}</span><strong>${formatCurrency(item.subtotal)}</strong></div>`).join("") || "<p>Nenhum item encontrado.</p>"}<div class="detail-total"><span>Total</span><strong>${formatCurrency(order.total)}</strong></div></div>
        <div class="detail-section"><h3>Observação</h3><div class="detail-box"><p>${escapeHtml(order.customer_note || "Nenhuma")}</p></div></div>
        <div class="detail-actions"><button class="secondary-button danger-button" type="button" data-archive-order="${order.id}"><i data-lucide="trash-2"></i>Excluir da tela</button><small>O pedido continuará disponível nos relatórios.</small></div>
      </div>`;
    window.lucide?.createIcons();
    openModal("orderModal");
  }

  function todayInManaus() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Manaus",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }

  function orderCost(order) {
    return (order.order_items || []).reduce(
      (sum, item) => {
        const product = state.data.products.find((candidate) => Number(candidate.id) === Number(item.product_id));
        const unitCost = item.unit_cost === null || item.unit_cost === undefined
          ? Number(product?.cost_price || 0)
          : Number(item.unit_cost || 0);
        return sum + unitCost * Number(item.quantity || 0);
      },
      0
    );
  }

  function orderProfit(order) {
    return Number(order.total || 0) - orderCost(order);
  }

  function orderItemsText(order) {
    return (order.order_items || [])
      .map((item) => `${item.quantity}x ${item.product_name}`)
      .join(" | ");
  }

  function deliveredItemsText(order) {
    return order.status === "completed" ? orderItemsText(order) : "";
  }

  function orderEventsText(order) {
    return (order.order_events || [])
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((event) => {
        const change = event.old_status && event.new_status
          ? `: ${statusLabels[event.old_status] || event.old_status} > ${statusLabels[event.new_status] || event.new_status}`
          : "";
        return `${formatDate(event.created_at)} ${event.event_type}${change}`;
      })
      .join(" | ");
  }

  function reportSummary(orders) {
    const completed = orders.filter((order) => order.status === "completed");
    const cancelled = orders.filter((order) => order.status === "cancelled");
    const archived = orders.filter((order) => order.deleted_at);
    return {
      completed,
      cancelled,
      archived,
      expectedRevenue: orders.reduce((sum, order) => sum + Number(order.total || 0), 0),
      actualRevenue: completed.reduce((sum, order) => sum + Number(order.total || 0), 0),
      expectedProfit: orders.reduce((sum, order) => sum + orderProfit(order), 0),
      actualProfit: completed.reduce((sum, order) => sum + orderProfit(order), 0)
    };
  }

  function renderReport() {
    const orders = state.reportData;
    const summary = reportSummary(orders);
    $("#reportOrdersMetric").textContent = orders.length;
    $("#reportOrdersCaption").textContent = `${summary.completed.length} concluído${summary.completed.length === 1 ? "" : "s"} • ${summary.cancelled.length} cancelado${summary.cancelled.length === 1 ? "" : "s"} • ${summary.archived.length} excluído${summary.archived.length === 1 ? "" : "s"}`;
    $("#reportExpectedRevenue").textContent = formatCurrency(summary.expectedRevenue);
    $("#reportActualRevenue").textContent = formatCurrency(summary.actualRevenue);
    $("#reportProfitMetric").textContent = formatCurrency(summary.actualProfit);
    $("#reportProfitCaption").textContent = `Previsto: ${formatCurrency(summary.expectedProfit)}`;
    $("#reportCountLabel").textContent = `${orders.length} pedido${orders.length === 1 ? "" : "s"}`;
    $("#downloadReportButton").disabled = orders.length === 0;
    $("#printReportButton").disabled = orders.length === 0;
    $("#reportEmpty").hidden = orders.length > 0;
    $("#reportTableBody").innerHTML = orders.map((order) => `
      <tr>
        <td data-label="Pedido"><strong>${escapeHtml(order.code)}</strong><small>${formatDate(order.created_at)}</small></td>
        <td data-label="Cliente"><div class="customer-cell"><strong>${escapeHtml(order.customer_name)}</strong><span>${escapeHtml(order.customer_phone)}</span></div></td>
        <td data-label="Itens" class="report-items-cell"><strong>Pedido:</strong> ${escapeHtml(orderItemsText(order) || "Nenhum item")}<br><strong>Entregue:</strong> ${escapeHtml(deliveredItemsText(order) || "—")}</td>
        <td data-label="Previsto"><strong>${formatCurrency(order.total)}</strong></td>
        <td data-label="Custo">${formatCurrency(orderCost(order))}</td>
        <td data-label="Lucro"><strong>${formatCurrency(orderProfit(order))}</strong></td>
        <td data-label="Status">${orderBadge(order.status)}</td>
        <td data-label="Entregue">${order.status === "completed" ? "Sim" : "Não"}</td>
        <td data-label="Excluído">${order.deleted_at ? `Sim, ${formatDate(order.deleted_at)}` : "Não"}</td>
      </tr>`).join("");
    window.lucide?.createIcons();
  }

  async function loadReport() {
    const day = $("#reportDate").value;
    if (!day) return showToast("Selecione a data do relatório.", "error");
    const button = $("#loadReportButton");
    setButtonLoading(button, true, "Carregando...");
    try {
      state.reportData = await Store.loadReportData(day);
      renderReport();
      showToast(state.reportData.length ? "Relatório atualizado." : "Nenhum pedido nessa data.");
    } catch (error) {
      showToast(error.message || "Não foi possível carregar o relatório.", "error");
    } finally {
      setButtonLoading(button, false);
    }
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function downloadReport() {
    if (!state.reportData.length) return;
    const day = $("#reportDate").value;
    const summary = reportSummary(state.reportData);
    const rows = [
      ["RELATÓRIO TAKITA SUSHI", day],
      ["Pedidos recebidos", state.reportData.length],
      ["Pedidos concluídos", summary.completed.length],
      ["Pedidos cancelados", summary.cancelled.length],
      ["Pedidos excluídos da tela", summary.archived.length],
      ["Faturamento previsto", summary.expectedRevenue.toFixed(2)],
      ["Faturamento realizado", summary.actualRevenue.toFixed(2)],
      ["Lucro bruto previsto", summary.expectedProfit.toFixed(2)],
      ["Lucro bruto realizado", summary.actualProfit.toFixed(2)],
      [],
      ["Código", "Data", "Cliente", "Telefone", "Endereço", "Referência", "Localização", "Observação", "Pagamento", "Itens pedidos", "Itens entregues", "Subtotal", "Taxa", "Total", "Custo", "Lucro bruto", "Status final", "Entregue", "Excluído da tela", "Data da exclusão", "Histórico de alterações"],
      ...state.reportData.map((order) => [
        order.code,
        formatDate(order.created_at),
        order.customer_name,
        order.customer_phone,
        order.customer_address,
        order.customer_reference,
        order.customer_location_url,
        order.customer_note,
        paymentLabels[order.payment_method] || order.payment_method,
        orderItemsText(order),
        deliveredItemsText(order),
        Number(order.subtotal || 0).toFixed(2),
        Number(order.fee || 0).toFixed(2),
        Number(order.total || 0).toFixed(2),
        orderCost(order).toFixed(2),
        orderProfit(order).toFixed(2),
        statusLabels[order.status] || order.status,
        order.status === "completed" ? "Sim" : "Não",
        order.deleted_at ? "Sim" : "Não",
        order.deleted_at ? formatDate(order.deleted_at) : "",
        orderEventsText(order)
      ])
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-takita-${day}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function printReport() {
    if (!state.reportData.length) return;
    const day = $("#reportDate").value;
    const summary = reportSummary(state.reportData);
    const reportWindow = window.open("", "_blank");
    if (!reportWindow) return showToast("Permita pop-ups para imprimir o relatório.", "error");
    reportWindow.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório Takita ${escapeHtml(day)}</title><style>body{font:13px Arial,sans-serif;color:#111;margin:28px}h1{margin-bottom:4px}p{margin-top:0;color:#555}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:22px 0}.metric{border:1px solid #bbb;padding:12px}.metric span{display:block;font-size:10px;text-transform:uppercase;color:#555}.metric strong{display:block;margin-top:6px;font-size:17px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{padding:7px;border:1px solid #bbb;text-align:left;vertical-align:top}th{background:#eee}@media print{body{margin:8mm}.no-print{display:none}}</style></head><body><h1>Relatório Takita Sushi</h1><p>Data: ${escapeHtml(day)}</p><div class="metrics"><div class="metric"><span>Pedidos</span><strong>${state.reportData.length}</strong></div><div class="metric"><span>Faturamento previsto</span><strong>${formatCurrency(summary.expectedRevenue)}</strong></div><div class="metric"><span>Faturamento realizado</span><strong>${formatCurrency(summary.actualRevenue)}</strong></div><div class="metric"><span>Lucro bruto realizado</span><strong>${formatCurrency(summary.actualProfit)}</strong></div></div><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Itens pedidos</th><th>Itens entregues</th><th>Total</th><th>Custo</th><th>Lucro</th><th>Status</th><th>Excluído</th></tr></thead><tbody>${state.reportData.map((order) => `<tr><td>${escapeHtml(order.code)}<br>${formatDate(order.created_at)}</td><td>${escapeHtml(order.customer_name)}<br>${escapeHtml(order.customer_phone)}</td><td>${escapeHtml(orderItemsText(order))}</td><td>${escapeHtml(deliveredItemsText(order) || "—")}</td><td>${formatCurrency(order.total)}</td><td>${formatCurrency(orderCost(order))}</td><td>${formatCurrency(orderProfit(order))}</td><td>${escapeHtml(statusLabels[order.status] || order.status)}</td><td>${order.deleted_at ? `Sim<br>${formatDate(order.deleted_at)}` : "Não"}</td></tr>`).join("")}</tbody></table><script>window.addEventListener('load',()=>window.print())<\/script></body></html>`);
    reportWindow.document.close();
  }

  async function archiveOrder(orderId) {
    const order = state.data.orders.find((candidate) => Number(candidate.id) === Number(orderId));
    if (!order) return;
    const confirmed = window.confirm(`Excluir ${order.code} da tela de pedidos?\n\nEle continuará salvo e aparecerá nos relatórios.`);
    if (!confirmed) return;
    try {
      await Store.archiveOrder(orderId);
      closeModal("orderModal");
      await reloadData();
      showToast("Pedido removido da tela e preservado no relatório.");
    } catch (error) {
      showToast(error.message || "Não foi possível excluir o pedido da tela.", "error");
    }
  }

  async function archiveToday() {
    const day = todayInManaus();
    const confirmed = window.confirm("Excluir todos os pedidos de hoje da tela?\n\nNada será apagado do relatório.");
    if (!confirmed) return;
    const button = $("#archiveTodayButton");
    setButtonLoading(button, true, "Excluindo...");
    try {
      const count = Number(await Store.archiveOrdersForDay(day) || 0);
      await reloadData();
      showToast(`${count} pedido${count === 1 ? "" : "s"} removido${count === 1 ? "" : "s"} da tela.`);
    } catch (error) {
      showToast(error.message || "Não foi possível excluir o histórico do dia.", "error");
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    ensureAdminAudio();
    const button = event.currentTarget.querySelector('[type="submit"]');
    setButtonLoading(button, true, "Entrando...");
    try {
      await Store.signIn($("#adminEmail").value.trim(), $("#adminPassword").value);
      await Store.assertAdmin();
      showApp();
      await reloadData();
      startOrderSync();
    } catch (error) {
      await Store.signOut().catch(() => {});
      showToast(error.message || "E-mail ou senha inválidos.", "error");
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function logout() {
    stopOrderSync();
    await Store.signOut().catch(() => {});
    showLogin();
  }

  function bindEvents() {
    document.addEventListener("pointerdown", ensureAdminAudio, { once: true, passive: true });
    $("#adminLoginForm").addEventListener("submit", handleLogin);
    $("#logoutButton").addEventListener("click", logout);
    $("#adminNotificationsButton").addEventListener("click", requestAdminNotifications);
    $("#menuButton").addEventListener("click", openSidebar);
    $("#sidebarOverlay").addEventListener("click", closeSidebar);
    $("#productSearch").addEventListener("input", renderProducts);
    $("#productStatusFilter").addEventListener("change", renderProducts);
    $("#orderSearch").addEventListener("input", renderOrders);
    $("#orderStatusFilter").addEventListener("change", renderOrders);
    $("#productForm").addEventListener("submit", submitProduct);
    $("#settingsForm").addEventListener("submit", submitSettings);
    $("#archiveTodayButton").addEventListener("click", archiveToday);
    $("#loadReportButton").addEventListener("click", loadReport);
    $("#downloadReportButton").addEventListener("click", downloadReport);
    $("#printReportButton").addEventListener("click", printReport);

    $("#productImageFile").addEventListener("change", (event) => {
      const [file] = event.target.files;
      if (!file) return renderImagePreview(state.editingImageUrl);
      const url = URL.createObjectURL(file);
      renderImagePreview(url);
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    });

    document.addEventListener("change", (event) => {
      const statusSelect = event.target.closest("[data-order-status]");
      if (statusSelect) changeOrderStatus(Number(statusSelect.dataset.orderStatus), statusSelect.value, statusSelect);
    });

    document.addEventListener("click", (event) => {
      const viewButton = event.target.closest("[data-view]");
      if (viewButton) {
        setView(viewButton.dataset.view);
        if (viewButton.dataset.view === "reports") loadReport();
        return;
      }
      const goView = event.target.closest("[data-go-view]");
      if (goView) setView(goView.dataset.goView);
      if (event.target.closest("[data-new-product]")) return openNewProduct();
      const edit = event.target.closest("[data-edit-product]");
      if (edit) return openEditProduct(Number(edit.dataset.editProduct));
      const toggle = event.target.closest("[data-toggle-product]");
      if (toggle) return toggleProduct(Number(toggle.dataset.toggleProduct), toggle.dataset.nextActive === "true");
      const order = event.target.closest("[data-view-order]");
      if (order) return openOrderDetail(Number(order.dataset.viewOrder));
      const archive = event.target.closest("[data-archive-order]");
      if (archive) return archiveOrder(Number(archive.dataset.archiveOrder));
      const close = event.target.closest("[data-close-modal]");
      if (close) return closeModal(close.dataset.closeModal);
      if (event.target.classList.contains("modal")) closeModal(event.target.id);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !$("#adminApp").hidden) {
        ensureAdminAudio();
        reloadData().catch(() => {});
      }
    });

    window.addEventListener("focus", () => {
      if (!$("#adminApp").hidden) reloadData().catch(() => {});
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") $$(".modal.active").forEach((modal) => closeModal(modal.id));
    });
  }

  async function init() {
    bindEvents();
    $("#reportDate").value = todayInManaus();
    updateAdminNotificationButton();
    window.lucide?.createIcons();
    if (!Store.isConfigured()) return showLogin();

    try {
      const session = await Store.getSession();
      if (!session) return showLogin();
      await Store.assertAdmin();
      showApp();
      await reloadData();
      startOrderSync();
    } catch (_error) {
      await Store.signOut().catch(() => {});
      showLogin();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
