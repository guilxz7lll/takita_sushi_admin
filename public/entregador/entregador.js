(function () {
  "use strict";

  const POLL_MS = 3000;

  const config =
    window.TAKITA_CONFIG ||
    window.APP_CONFIG ||
    window.appConfig ||
    {};

  const supabaseUrl =
    config.supabaseUrl ||
    config.SUPABASE_URL ||
    config.url;

  const supabaseKey =
    config.supabaseAnonKey ||
    config.SUPABASE_ANON_KEY ||
    config.supabaseKey ||
    config.key;

  if (!window.supabase || !supabaseUrl || !supabaseKey) {
    console.error("Configuração do Supabase não encontrada.");
    return;
  }

  const client = window.supabase.createClient(supabaseUrl, supabaseKey);

  const $ = (selector) => document.querySelector(selector);

  let pollTimer = null;
  let knownOrderIds = new Set();
  let initialLoadDone = false;
  let audioContext = null;
  let loadInFlight = false;

  const paymentLabels = {
    pix: "Pix",
    cash: "Dinheiro",
    debit: "Cartão de débito",
    credit: "Cartão de crédito"
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });
  }

  function toast(message) {
    const element = $("#deliveryToast");
    if (!element) return;

    element.textContent = message;
    element.classList.add("active");

    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => {
      element.classList.remove("active");
    }, 2600);
  }

  function setLoginMessage(message, error = false) {
    const element = $("#loginMessage");
    element.textContent = message;
    element.classList.toggle("error", error);
  }

  function setDashboardMessage(message, error = false) {
    const element = $("#dashboardMessage");
    element.textContent = message;
    element.classList.toggle("error", error);
  }

  function ensureAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!audioContext) {
      audioContext = new AudioContextClass();
    }

    return audioContext;
  }

  async function unlockAudio() {
    const context = ensureAudio();
    if (!context) return;

    try {
      if (context.state === "suspended") {
        await context.resume();
      }
    } catch (_error) {}
  }

  function playNewDeliverySound() {
    const context = ensureAudio();
    if (!context || context.state !== "running") return;

    const now = context.currentTime;
    [640, 820, 1040].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.frequency.value = frequency;
      oscillator.type = "sine";

      const start = now + index * 0.17;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.13, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.16);
    });
  }

  function parseDestination(order) {
    const raw = String(order.customer_location_url || "").trim();

    if (raw) {
      const patterns = [
        /[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
        /[?&]query=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
        /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i
      ];

      for (const pattern of patterns) {
        const match = raw.match(pattern);
        if (match) {
          return `${match[1]},${match[2]}`;
        }
      }
    }

    return order.customer_address || "";
  }

  function openRoute(order) {
    unlockAudio();

    const destination = parseDestination(order);

    if (!destination) {
      toast("Este pedido não possui endereço para rota.");
      return;
    }

    const openMaps = (origin = "") => {
      const params = new URLSearchParams({
        api: "1",
        destination,
        travelmode: "driving"
      });

      if (origin) {
        params.set("origin", origin);
      }

      window.open(
        `https://www.google.com/maps/dir/?${params.toString()}`,
        "_blank",
        "noopener,noreferrer"
      );
    };

    if (!navigator.geolocation) {
      openMaps();
      return;
    }

    toast("Buscando sua localização para iniciar a rota...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const origin =
          `${position.coords.latitude},${position.coords.longitude}`;

        openMaps(origin);
      },
      () => {
        // O Google Maps ainda consegue usar a localização do aparelho.
        openMaps();
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 60000
      }
    );
  }

  function renderOrders(orders) {
    const list = $("#deliveriesList");
    const empty = $("#emptyState");

    $("#activeDeliveryCount").textContent = orders.length;
    empty.hidden = orders.length !== 0;

    list.innerHTML = orders.map((order) => {
      const locationUrl = String(order.customer_location_url || "").trim();
      const phoneDigits = String(order.customer_phone || "").replace(/\D/g, "");
      const whatsappNumber =
        phoneDigits.startsWith("55") ? phoneDigits : `55${phoneDigits}`;

      const itemRows = (order.items || []).map((item) => `
        <div class="item-row">
          <span>${Number(item.quantity)}x ${escapeHtml(item.name)}</span>
        </div>
      `).join("");

      return `
        <article class="delivery-card" data-order-id="${escapeHtml(order.id)}">
          <header class="delivery-card-header">
            <div>
              <small>Pedido</small>
              <div class="delivery-code">${escapeHtml(order.code)}</div>
            </div>

            <span class="delivery-status">Saiu para entrega</span>
          </header>

          <div class="delivery-card-body">
            <div>
              <h2 class="customer-name">${escapeHtml(order.customer_name)}</h2>
              <span>${escapeHtml(order.customer_phone || "")}</span>
            </div>

            <div class="address-box">
              <span>Endereço de entrega</span>
              <strong>${escapeHtml(order.customer_address || "Não informado")}</strong>
              ${
                order.customer_reference
                  ? `<div class="reference"><b>Referência:</b> ${escapeHtml(order.customer_reference)}</div>`
                  : ""
              }
            </div>

            <div class="actions-grid">
              <button
                class="route-button"
                type="button"
                data-action="route"
                data-order-id="${escapeHtml(order.id)}"
              >
                <i data-lucide="navigation"></i>
                Iniciar rota
              </button>

              ${
                locationUrl
                  ? `<a class="map-link" href="${escapeHtml(locationUrl)}" target="_blank" rel="noopener noreferrer">
                       <i data-lucide="map-pin"></i>
                       Localização
                     </a>`
                  : ""
              }

              ${
                phoneDigits
                  ? `<a class="phone-link" href="https://wa.me/${escapeHtml(whatsappNumber)}" target="_blank" rel="noopener noreferrer">
                       <i data-lucide="message-circle"></i>
                       Cliente
                     </a>`
                  : ""
              }
            </div>

            <div class="info-block">
              <span>Itens</span>
              <div class="items-list">${itemRows || "—"}</div>
            </div>

            ${
              order.customer_note
                ? `<div class="note-box"><b>Observação:</b> ${escapeHtml(order.customer_note)}</div>`
                : ""
            }

            <div class="money-box">
              <div class="money-line">
                <span>Pagamento</span>
                <strong>${escapeHtml(paymentLabels[order.payment_method] || order.payment_method || "—")}</strong>
              </div>

              ${
                Number(order.tip) > 0
                  ? `<div class="money-line tip-line">
                       <span>Sua gorjeta</span>
                       <strong>${formatCurrency(order.tip)}</strong>
                     </div>`
                  : ""
              }

              ${
                order.payment_method === "cash" && Number(order.cash_change_for) > 0
                  ? `<div class="money-line">
                       <span>Troco para</span>
                       <strong>${formatCurrency(order.cash_change_for)}</strong>
                     </div>`
                  : ""
              }

              <div class="money-line total-line">
                <span>Total</span>
                <strong>${formatCurrency(order.total)}</strong>
              </div>
            </div>
          </div>
        </article>
      `;
    }).join("");

    window.lucide?.createIcons();

    list.querySelectorAll("[data-action='route']").forEach((button) => {
      button.addEventListener("click", () => {
        const order = orders.find(
          (item) => String(item.id) === String(button.dataset.orderId)
        );

        if (order) {
          openRoute(order);
        }
      });
    });
  }

  async function getDeliveryProfile() {
    const { data, error } = await client
      .from("delivery_users")
      .select("display_name, active")
      .single();

    if (error) throw error;
    if (!data?.active) throw new Error("Conta de entregador desativada.");

    return data;
  }

  async function loadOrders(silent = false) {
    if (loadInFlight) return;
    loadInFlight = true;

    try {
      if (!silent) {
        setDashboardMessage("Atualizando entregas...");
      }

      const { data, error } = await client.rpc("get_delivery_orders");

      if (error) throw error;

      const orders = Array.isArray(data) ? data : [];
      const nextIds = new Set(orders.map((order) => String(order.id)));

      if (initialLoadDone) {
        const hasNewDelivery =
          orders.some((order) => !knownOrderIds.has(String(order.id)));

        if (hasNewDelivery) {
          playNewDeliverySound();
          toast("Nova entrega disponível!");
        }
      }

      knownOrderIds = nextIds;
      initialLoadDone = true;

      renderOrders(orders);
      setDashboardMessage(
        orders.length
          ? "Atualização automática ativa."
          : "Aguardando novas entregas."
      );
    } catch (error) {
      console.error(error);
      setDashboardMessage(
        error.message || "Não foi possível carregar as entregas.",
        true
      );
    } finally {
      loadInFlight = false;
    }
  }

  function startPolling() {
    window.clearInterval(pollTimer);

    pollTimer = window.setInterval(() => {
      loadOrders(true);
    }, POLL_MS);
  }

  async function showDashboard() {
    try {
      const profile = await getDeliveryProfile();

      $("#deliveryUserName").textContent =
        profile.display_name || "Entregador";

      $("#loginView").hidden = true;
      $("#dashboardView").hidden = false;

      await loadOrders();
      startPolling();
    } catch (error) {
      await client.auth.signOut();
      $("#dashboardView").hidden = true;
      $("#loginView").hidden = false;
      setLoginMessage(
        "Esta conta não possui acesso à área de entregas.",
        true
      );
    }
  }

  async function login(event) {
    event.preventDefault();
    await unlockAudio();

    const email = $("#deliveryEmail").value.trim();
    const password = $("#deliveryPassword").value;
    const button = $("#deliveryLoginForm button[type='submit']");

    button.disabled = true;
    setLoginMessage("Entrando...");

    try {
      const { error } = await client.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      setLoginMessage("");
      await showDashboard();
    } catch (error) {
      setLoginMessage(
        error.message === "Invalid login credentials"
          ? "E-mail ou senha incorretos."
          : (error.message || "Não foi possível entrar."),
        true
      );
    } finally {
      button.disabled = false;
    }
  }

  async function logout() {
    await client.auth.signOut();

    window.clearInterval(pollTimer);
    knownOrderIds = new Set();
    initialLoadDone = false;

    $("#dashboardView").hidden = true;
    $("#loginView").hidden = false;
    $("#deliveryPassword").value = "";

    setLoginMessage("Sessão encerrada.");
  }

  async function init() {
    window.lucide?.createIcons();

    document.addEventListener("pointerdown", unlockAudio, { passive: true });

    $("#deliveryLoginForm").addEventListener("submit", login);
    $("#logoutButton").addEventListener("click", logout);

    $("#refreshDeliveriesButton").addEventListener("click", async () => {
      await unlockAudio();
      await loadOrders();
    });

    document.addEventListener("visibilitychange", () => {
      if (
        document.visibilityState === "visible" &&
        !$("#dashboardView").hidden
      ) {
        loadOrders(true);
      }
    });

    const { data } = await client.auth.getSession();

    if (data.session) {
      await showDashboard();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
