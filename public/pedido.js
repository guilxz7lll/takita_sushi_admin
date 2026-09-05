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
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", error);
  }

  function ensureAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContext) audioContext = new AudioContextClass();
    return audioContext;
  }

  async function unlockAudio() {
    const context = ensureAudioContext();
    if (!context) return;
    try {
      if (context.state === "suspended") await context.resume();
      if (context.state === "running") {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        gain.gain.value = 0.00001;
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.01);
      }
    } catch (_error) {}
  }

  function playDeliverySound() {
    const context = ensureAudioContext();
    if (!context || context.state !== "running") return;
    const now = context.currentTime;
    [
      { frequency: 740, start: 0.00, duration: 0.16 },
      { frequency: 940, start: 0.18, duration: 0.16 },
      { frequency: 1180, start: 0.36, duration: 0.28 }
    ].forEach(({ frequency, start, duration }) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.16, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + start);
      oscillator.stop(now + start + duration + 0.02);
    });
  }

  function renderProgress(status) {
    const currentIndex = steps.findIndex(([value]) => value === status);
    const cancelled = status === "cancelled";
    $("#orderProgress").classList.toggle("cancelled", cancelled);
    $("#orderProgress").innerHTML = steps.map(([value, label], index) => `
      <div class="progress-step ${!cancelled && index <= currentIndex ? "done" : ""} ${value === status ? "current" : ""}">
        <span>${index < currentIndex || status === "completed" ? "✓" : index + 1}</span>
        <small>${escapeHtml(label)}</small>
      </div>
    `).join("");
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
      <div class="tracked-item"><span>${Number(item.quantity)}x ${escapeHtml(item.name)}</span><strong>${formatCurrency(item.subtotal)}</strong></div>
    `).join("");
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

  function currentLookup() {
    if (!lastLookup) return Promise.resolve();
    if (lastLookup.token) return lookupToken(lastLookup.token, true);
    return lookupCredentials(lastLookup.code, lastLookup.phone, true);
  }

  function startPolling() {
    window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => currentLookup(), POLL_MS);
  }

  function handleLookupResult(order, previousStatus, silent) {
    lastStatus = order.status;
    localStorage.setItem("takita_last_order", JSON.stringify(lastLookup));
    renderOrder(order);
    if (previousStatus && previousStatus !== order.status) {
      if (order.status === "out_for_delivery") {
        playDeliverySound();
        setMessage("Seu pedido saiu para entrega!");
      } else {
        setMessage(`Status atualizado: ${labels[order.status] || order.status}.`);
      }
    } else if (!silent) {
      setMessage("Pedido encontrado. Atualizações automáticas estão ativas.");
    }
    startPolling();
  }

  async function lookupCredentials(code, phone, silent = false) {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const normalizedPhone = String(phone || "").trim();
    if (!normalizedCode || !normalizedPhone || lookupInFlight) return;
    const button = $("#trackingForm button[type='submit']");
    lookupInFlight = true;
    if (!silent) { button.disabled = true; setMessage("Consultando pedido..."); }
    try {
      const previousStatus = lastStatus;
      const order = await Store.getPublicOrderStatus(normalizedCode, normalizedPhone);
      lastLookup = { code: normalizedCode, phone: normalizedPhone };
      handleLookupResult(order, previousStatus, silent);
    } catch (error) {
      if (!silent) { $("#orderStatusCard").hidden = true; setMessage(error.message || "Não foi possível localizar o pedido.", true); }
    } finally {
      lookupInFlight = false;
      button.disabled = false;
    }
  }

  async function lookupToken(token, silent = false) {
    const normalizedToken = String(token || "").trim();
    if (!normalizedToken || lookupInFlight) return;
    lookupInFlight = true;
    if (!silent) setMessage("Abrindo seu pedido...");
    try {
      const previousStatus = lastStatus;
      const order = await Store.getPublicOrderByToken(normalizedToken);
      lastLookup = { token: normalizedToken };
      handleLookupResult(order, previousStatus, silent);
    } catch (error) {
      if (!silent) { $("#orderStatusCard").hidden = true; setMessage(error.message || "Este link de acompanhamento não é válido.", true); }
    } finally {
      lookupInFlight = false;
    }
  }

  async function confirmDelivered() {
    if (!lastLookup) return;
    const button = $("#confirmDeliveredButton");
    if (!window.confirm("Confirmar que você recebeu o pedido?")) return;
    button.disabled = true;
    button.dataset.original = button.innerHTML;
    button.textContent = "Confirmando...";
    try {
      if (lastLookup.token) await Store.confirmPublicOrderDeliveredByToken(lastLookup.token);
      else await Store.confirmPublicOrderDelivered(lastLookup.code, lastLookup.phone);
      window.clearInterval(refreshTimer);
      localStorage.removeItem("takita_last_order");
      lastLookup = null;
      lastStatus = null;
      setMessage("Entrega confirmada. Obrigado por pedir com a Takita Sushi!");
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
    document.addEventListener("pointerdown", unlockAudio, { passive: true });
    document.addEventListener("keydown", unlockAudio);
    $("#confirmDeliveredButton")?.addEventListener("click", confirmDelivered);

    $("#trackingForm").addEventListener("submit", (event) => {
      event.preventDefault();
      unlockAudio();
      lastStatus = null;
      lookupCredentials($("#trackingCode").value, $("#trackingPhone").value);
    });

    $("#refreshOrderButton").addEventListener("click", () => { unlockAudio(); currentLookup(); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") currentLookup(); });
    window.addEventListener("focus", () => currentLookup());

    const params = new URLSearchParams(window.location.search);
    const queryToken = params.get("t") || "";
    const queryCode = params.get("codigo") || "";
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("takita_last_order")) || {}; } catch (_error) { saved = {}; }

    if (queryToken) {
      $("#trackingForm").hidden = true;
      setMessage("Link seguro de acompanhamento carregado.");
      lookupToken(queryToken);
      return;
    }

    if (saved.token && !queryCode) {
      $("#trackingForm").hidden = true;
      lookupToken(saved.token);
      return;
    }

    const code = queryCode || saved.code || "";
    const phone = saved.phone || "";
    $("#trackingCode").value = code;
    $("#trackingPhone").value = phone;
    if (code && phone) lookupCredentials(code, phone);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
