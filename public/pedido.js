(function () {
  "use strict";

  const Store = window.TakitaStore;
  const POLL_MS = 3000;
  const steps = [
    ["awaiting_whatsapp", "Recebido"],
    ["whatsapp_opened", "WhatsApp aberto"],
    ["confirmed", "Confirmado"],
    ["preparing", "Em preparo"],
    ["out_for_delivery", "Saiu para entrega"],
    ["completed", "Concluído"]
  ];
  const labels = Object.fromEntries(steps);
  labels.cancelled = "Cancelado";

  let lastLookup = null;
  let refreshTimer = null;
  let lastStatus = null;
  let lookupInFlight = false;
  let audioContext = null;

  const $ = (selector) => document.querySelector(selector);

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

  function formatDate(value) {
    return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }

  function setMessage(message, error = false) {
    const element = $("#trackingMessage");
    element.textContent = message;
    element.classList.toggle("error", error);
  }

  function ensureAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    return audioContext;
  }

  function playStatusSound() {
    const context = ensureAudio();
    if (!context || context.state !== "running") return;

    const now = context.currentTime;
    [660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + index * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.12, now + index * 0.12 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.12 + 0.14);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + index * 0.12);
      oscillator.stop(now + index * 0.12 + 0.16);
    });
  }

  function notificationEnabled() {
    return "Notification" in window && Notification.permission === "granted";
  }

  function updateNotificationButton() {
    const button = $("#enableTrackingNotifications");
    if (!button) return;
    const enabled = notificationEnabled();
    button.classList.toggle("active", enabled);
    button.innerHTML = enabled
      ? '<i data-lucide="bell-ring"></i> Notificações ativadas'
      : '<i data-lucide="bell"></i> Ativar notificações';
    window.lucide?.createIcons();
  }

  async function requestNotifications() {
    ensureAudio();
    if (!("Notification" in window)) {
      setMessage("Seu navegador não oferece notificações do sistema.", true);
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      updateNotificationButton();
      if (permission === "granted") {
        playStatusSound();
        setMessage("Notificações ativadas. Você será avisado quando o status mudar.");
      } else {
        setMessage("Permissão de notificações não concedida. O status continuará atualizando automaticamente.");
      }
    } catch (_error) {
      setMessage("Não foi possível ativar as notificações neste navegador.", true);
    }
  }

  function notifyStatusChange(order) {
    playStatusSound();
    if (!notificationEnabled() || document.visibilityState === "visible") return;
    try {
      new Notification(`Pedido ${order.code}`, {
        body: `Novo status: ${labels[order.status] || order.status}`,
        tag: `takita-${order.code}`
      });
    } catch (_error) {}
  }

  function renderProgress(status) {
    const currentIndex = steps.findIndex(([value]) => value === status);
    const cancelled = status === "cancelled";
    $("#orderProgress").classList.toggle("cancelled", cancelled);
    $("#orderProgress").innerHTML = steps.map(([value, label], index) => `
      <div class="progress-step ${!cancelled && index <= currentIndex ? "done" : ""} ${value === status ? "current" : ""}">
        <span>${index < currentIndex || status === "completed" ? "✓" : index + 1}</span>
        <small>${escapeHtml(label)}</small>
      </div>`).join("");
  }

  function renderDeliveryConfirmation(order) {
    const box = $("#deliveryConfirmationBox");
    const button = $("#confirmDeliveredButton");
    if (!box || !button) return;
    const canConfirm = order.status === "out_for_delivery";
    box.hidden = !canConfirm;
    button.disabled = !canConfirm;
  }

  function renderOrder(order) {
    $("#orderStatusCard").hidden = false;
    $("#trackedOrderCode").textContent = order.code;
    $("#trackedStatus").textContent = labels[order.status] || order.status;
    $("#trackedStatus").className = `tracked-status status-${order.status}`;
    $("#trackedCustomer").textContent = order.customer_name;
    $("#trackedCreatedAt").textContent = `Realizado em ${formatDate(order.created_at)} • atualizado em ${formatDate(order.updated_at)}`;
    $("#trackedItems").innerHTML = (order.items || []).map((item) => `
      <div class="tracked-item"><span>${Number(item.quantity)}x ${escapeHtml(item.name)}</span><strong>${formatCurrency(item.subtotal)}</strong></div>`).join("");
    $("#trackedSubtotal").textContent = formatCurrency(order.subtotal);
    $("#trackedFee").textContent = formatCurrency(order.fee);
    $("#trackedFeeRow").hidden = Number(order.fee) <= 0;
    $("#trackedTip").textContent = formatCurrency(order.tip);
    $("#trackedTipRow").hidden = Number(order.tip) <= 0;
    $("#trackedTotal").textContent = formatCurrency(order.total);
    renderProgress(order.status);
    renderDeliveryConfirmation(order);
    window.lucide?.createIcons();
  }

  function startPolling() {
    window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
      if (lastLookup) lookup(lastLookup.code, lastLookup.phone, true);
    }, POLL_MS);
  }

  async function lookup(code, phone, silent = false) {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const normalizedPhone = String(phone || "").trim();
    if (!normalizedCode || !normalizedPhone || lookupInFlight) return;

    const button = $("#trackingForm button[type='submit']");
    lookupInFlight = true;
    if (!silent) {
      button.disabled = true;
      setMessage("Consultando pedido...");
    }

    try {
      const order = await Store.getPublicOrderStatus(normalizedCode, normalizedPhone);
      const previousStatus = lastStatus;
      lastLookup = { code: normalizedCode, phone: normalizedPhone };
      lastStatus = order.status;
      localStorage.setItem("takita_last_order", JSON.stringify(lastLookup));
      renderOrder(order);

      if (previousStatus && previousStatus !== order.status) {
        notifyStatusChange(order);
        setMessage(`Status atualizado: ${labels[order.status] || order.status}.`);
      } else if (!silent) {
        setMessage("Pedido encontrado. Atualizações automáticas estão ativas.");
      }
      startPolling();
    } catch (error) {
      if (!silent) {
        $("#orderStatusCard").hidden = true;
        setMessage(error.message || "Não foi possível localizar o pedido.", true);
      }
    } finally {
      lookupInFlight = false;
      button.disabled = false;
    }
  }

  async function confirmDelivered() {
    if (!lastLookup) return;
    const button = $("#confirmDeliveredButton");
    const confirmed = window.confirm("Confirmar que você recebeu o pedido?");
    if (!confirmed) return;

    button.disabled = true;
    button.dataset.original = button.innerHTML;
    button.textContent = "Confirmando...";

    try {
      await Store.confirmPublicOrderDelivered(lastLookup.code, lastLookup.phone);
      window.clearInterval(refreshTimer);
      localStorage.removeItem("takita_last_order");
      lastLookup = null;
      lastStatus = null;
      setMessage("Entrega confirmada. Obrigado por pedir com a Takita Sushi!");
      playStatusSound();
      window.setTimeout(() => window.location.replace("cardapio.html?pedido=entregue"), 900);
    } catch (error) {
      setMessage(error.message || "Não foi possível confirmar a entrega.", true);
      button.disabled = false;
      button.innerHTML = button.dataset.original || '<i data-lucide="package-check"></i> Pedido entregue';
      window.lucide?.createIcons();
    }
  }

  function init() {
    window.lucide?.createIcons();
    updateNotificationButton();

    document.addEventListener("pointerdown", ensureAudio, { once: true, passive: true });
    $("#enableTrackingNotifications")?.addEventListener("click", requestNotifications);
    $("#confirmDeliveredButton")?.addEventListener("click", confirmDelivered);

    $("#trackingForm").addEventListener("submit", (event) => {
      event.preventDefault();
      lastStatus = null;
      lookup($("#trackingCode").value, $("#trackingPhone").value);
    });

    $("#refreshOrderButton").addEventListener("click", () => {
      if (lastLookup) lookup(lastLookup.code, lastLookup.phone);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && lastLookup) {
        ensureAudio();
        lookup(lastLookup.code, lastLookup.phone, true);
      }
    });

    window.addEventListener("focus", () => {
      if (lastLookup) lookup(lastLookup.code, lastLookup.phone, true);
    });

    const queryCode = new URLSearchParams(window.location.search).get("codigo") || "";
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("takita_last_order")) || {}; } catch (_error) { saved = {}; }
    const code = queryCode || saved.code || "";
    const phone = saved.phone || "";
    $("#trackingCode").value = code;
    $("#trackingPhone").value = phone;
    if (code && phone) lookup(code, phone);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
