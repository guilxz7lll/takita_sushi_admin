(function () {
  "use strict";

  const Store = window.TakitaStore;
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
    $("#trackedTotal").textContent = formatCurrency(order.total);
    renderProgress(order.status);
    window.lucide?.createIcons();
  }

  async function lookup(code, phone, silent = false) {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const normalizedPhone = String(phone || "").trim();
    if (!normalizedCode || !normalizedPhone) return;

    const button = $("#trackingForm button[type='submit']");
    if (!silent) {
      button.disabled = true;
      setMessage("Consultando pedido...");
    }

    try {
      const order = await Store.getPublicOrderStatus(normalizedCode, normalizedPhone);
      lastLookup = { code: normalizedCode, phone: normalizedPhone };
      localStorage.setItem("takita_last_order", JSON.stringify(lastLookup));
      renderOrder(order);
      setMessage(silent ? "Status atualizado automaticamente." : "Pedido encontrado.");
      window.clearInterval(refreshTimer);
      refreshTimer = window.setInterval(() => lookup(lastLookup.code, lastLookup.phone, true), 30000);
    } catch (error) {
      if (!silent) {
        $("#orderStatusCard").hidden = true;
        setMessage(error.message || "Não foi possível localizar o pedido.", true);
      }
    } finally {
      button.disabled = false;
    }
  }

  function init() {
    window.lucide?.createIcons();
    $("#trackingForm").addEventListener("submit", (event) => {
      event.preventDefault();
      lookup($("#trackingCode").value, $("#trackingPhone").value);
    });
    $("#refreshOrderButton").addEventListener("click", () => {
      if (lastLookup) lookup(lastLookup.code, lastLookup.phone);
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
