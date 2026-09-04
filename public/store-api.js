(function () {
  "use strict";

  const config = window.TAKITA_CONFIG || {};
  const seed = window.TAKITA_SEED || { categories: [], products: [], settings: {} };
  let client = null;
  let publicCache = null;

  function isConfigured() {
    return Boolean(
      window.supabase?.createClient &&
      config.supabaseUrl &&
      config.supabaseAnonKey &&
      !config.supabaseUrl.includes("COLE_") &&
      !config.supabaseAnonKey.includes("COLE_")
    );
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (!client) {
      client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
    }
    return client;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function throwIfError(result) {
    if (result?.error) throw result.error;
    return result?.data;
  }

  async function loadPublicData(options = {}) {
    if (publicCache && !options.force) return publicCache;

    const supabaseClient = getClient();
    if (!supabaseClient) {
      publicCache = { ...clone(seed), source: "local" };
      return publicCache;
    }

    const [categoriesResult, productsResult, settingsResult] = await Promise.all([
      supabaseClient.from("categories").select("*").eq("active", true).order("sort_order"),
      supabaseClient.from("products").select("id,name,category_id,description,featured_description,price,image_url,active,featured,feature_tag,sort_order,promotion_enabled,promotion_price,promotion_label,promotion_starts_at,promotion_ends_at,created_at,updated_at").eq("active", true).order("sort_order"),
      supabaseClient.from("store_settings").select("*").eq("id", 1).single()
    ]);

    const categories = throwIfError(categoriesResult);
    const products = throwIfError(productsResult);
    const settings = throwIfError(settingsResult);

    publicCache = { categories, products, settings, source: "supabase" };
    return publicCache;
  }

  function calculateLocalOrder(payload) {
    const data = publicCache || clone(seed);
    const paymentMethod = payload.customer.payment_method;
    const items = payload.items.map((requestedItem) => {
      const product = data.products.find(
        (candidate) => Number(candidate.id) === Number(requestedItem.product_id) && candidate.active
      );
      const quantity = Number(requestedItem.quantity);

      if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        throw new Error("O carrinho possui um item inválido ou indisponível.");
      }
      if (product.price === null || product.price === undefined) {
        throw new Error(`${product.name} precisa de orçamento antes da finalização.`);
      }

      const now = Date.now();
      const promotionStarts = product.promotion_starts_at ? new Date(product.promotion_starts_at).getTime() : null;
      const promotionEnds = product.promotion_ends_at ? new Date(product.promotion_ends_at).getTime() : null;
      const promotionActive = Boolean(
        product.promotion_enabled &&
        product.promotion_price !== null &&
        product.promotion_price !== undefined &&
        (!promotionStarts || promotionStarts <= now) &&
        (!promotionEnds || promotionEnds > now)
      );
      const unitPrice = Number(promotionActive ? product.promotion_price : product.price);
      return {
        product_id: product.id,
        name: product.name,
        quantity,
        unit_price: unitPrice,
        subtotal: Number((unitPrice * quantity).toFixed(2))
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const minimumOrderValue = Number(data.settings.minimum_order_value ?? 15);
    if (subtotal < minimumOrderValue) {
      throw new Error(`O pedido mínimo é de ${minimumOrderValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`);
    }

    const feePercent = paymentMethod === "credit"
      ? Number(data.settings.credit_card_fee_percent || 0)
      : 0;
    const fee = Number((subtotal * feePercent / 100).toFixed(2));
    const tip = Math.max(0, Number(payload.customer.tip || 0));
    const total = Number((subtotal + fee + tip).toFixed(2));
    const cashChangeFor = paymentMethod === "cash" && payload.customer.cash_change_for !== null && payload.customer.cash_change_for !== ""
      ? Number(payload.customer.cash_change_for)
      : null;

    if (cashChangeFor !== null && cashChangeFor < total) {
      throw new Error("O valor informado para troco deve ser igual ou maior que o total do pedido.");
    }

    return {
      id: null,
      code: `LOCAL-${Date.now().toString().slice(-8)}`,
      items,
      subtotal: Number(subtotal.toFixed(2)),
      fee,
      tip,
      cash_change_for: cashChangeFor,
      total,
      settings: data.settings,
      local_only: true
    };
  }

  async function createPublicOrder(payload) {
    const supabaseClient = getClient();
    if (!supabaseClient) return calculateLocalOrder(payload);

    const result = await supabaseClient.rpc("create_public_order", {
      p_customer: payload.customer,
      p_items: payload.items
    });
    return throwIfError(result);
  }

  async function markOrderWhatsappOpened(orderCode) {
    const supabaseClient = getClient();
    if (!supabaseClient || !orderCode || orderCode.startsWith("LOCAL-")) return;
    const result = await supabaseClient.rpc("mark_order_whatsapp_opened", {
      p_order_code: orderCode
    });
    throwIfError(result);
  }

  async function getPublicOrderStatus(orderCode, customerPhone) {
    const supabaseClient = getClient();
    if (!supabaseClient) throw new Error("Supabase não configurado.");
    const result = await supabaseClient.rpc("get_public_order_status", {
      p_order_code: String(orderCode || "").trim().toUpperCase(),
      p_customer_phone: String(customerPhone || "").trim()
    });
    return throwIfError(result);
  }

  async function confirmPublicOrderDelivered(orderCode, customerPhone) {
    const supabaseClient = getClient();
    if (!supabaseClient) throw new Error("Supabase não configurado.");
    const result = await supabaseClient.rpc("confirm_public_order_delivered", {
      p_order_code: String(orderCode || "").trim().toUpperCase(),
      p_customer_phone: String(customerPhone || "").trim()
    });
    return throwIfError(result);
  }

  function subscribeAdminOrders(callback, statusCallback) {
    const supabaseClient = getClient();
    if (!supabaseClient) return { unsubscribe() {} };

    const channel = supabaseClient
      .channel(`takita-admin-orders-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        (payload) => callback?.(payload)
      )
      .subscribe((status) => statusCallback?.(status));

    return {
      unsubscribe() {
        supabaseClient.removeChannel(channel).catch(() => {});
      }
    };
  }

  async function signIn(email, password) {
    const supabaseClient = getClient();
    if (!supabaseClient) throw new Error("Conecte o projeto ao Supabase em app-config.js.");
    return throwIfError(await supabaseClient.auth.signInWithPassword({ email, password }));
  }

  async function signOut() {
    const supabaseClient = getClient();
    if (supabaseClient) throwIfError(await supabaseClient.auth.signOut());
  }

  async function getSession() {
    const supabaseClient = getClient();
    if (!supabaseClient) return null;
    const data = throwIfError(await supabaseClient.auth.getSession());
    return data.session;
  }

  function onAuthStateChange(callback) {
    const supabaseClient = getClient();
    if (!supabaseClient) return { unsubscribe() {} };
    return supabaseClient.auth.onAuthStateChange((_event, session) => callback(session)).data.subscription;
  }

  async function assertAdmin() {
    const supabaseClient = getClient();
    if (!supabaseClient) throw new Error("Supabase não configurado.");
    const result = await supabaseClient.rpc("is_admin");
    const allowed = throwIfError(result);
    if (!allowed) throw new Error("Esta conta não possui acesso administrativo.");
    return true;
  }

  async function loadAdminData() {
    const supabaseClient = getClient();
    if (!supabaseClient) throw new Error("Supabase não configurado.");

    const [categoriesResult, productsResult, settingsResult, ordersResult] = await Promise.all([
      supabaseClient.from("categories").select("*").order("sort_order"),
      supabaseClient.from("products").select("*, categories(name)").order("sort_order"),
      supabaseClient.from("store_settings").select("*").eq("id", 1).single(),
      supabaseClient.from("orders").select("*, order_items(*)").is("deleted_at", null).order("created_at", { ascending: false }).limit(150)
    ]);

    return {
      categories: throwIfError(categoriesResult),
      products: throwIfError(productsResult),
      settings: throwIfError(settingsResult),
      orders: throwIfError(ordersResult)
    };
  }

  async function saveProduct(product) {
    const supabaseClient = getClient();
    const payload = { ...product };
    const productId = payload.id;
    delete payload.id;

    const query = productId
      ? supabaseClient.from("products").update(payload).eq("id", productId).select().single()
      : supabaseClient.from("products").insert(payload).select().single();

    publicCache = null;
    return throwIfError(await query);
  }

  async function setProductActive(productId, active) {
    const supabaseClient = getClient();
    const result = await supabaseClient
      .from("products")
      .update({ active })
      .eq("id", productId)
      .select()
      .single();
    publicCache = null;
    return throwIfError(result);
  }

  async function updateSettings(settings) {
    const supabaseClient = getClient();
    const result = await supabaseClient
      .from("store_settings")
      .update(settings)
      .eq("id", 1)
      .select()
      .single();
    publicCache = null;
    return throwIfError(result);
  }

  async function updateOrderStatus(orderId, status) {
    const supabaseClient = getClient();
    const result = await supabaseClient
      .from("orders")
      .update({ status })
      .eq("id", orderId)
      .is("deleted_at", null)
      .select()
      .single();
    return throwIfError(result);
  }

  async function archiveOrder(orderId) {
    const supabaseClient = getClient();
    if (!supabaseClient) throw new Error("Supabase não configurado.");
    const result = await supabaseClient.rpc("archive_order", { p_order_id: Number(orderId) });
    return throwIfError(result);
  }

  async function archiveOrdersForDay(day) {
    const supabaseClient = getClient();
    if (!supabaseClient) throw new Error("Supabase não configurado.");
    const result = await supabaseClient.rpc("archive_orders_for_day", { p_day: day });
    return throwIfError(result);
  }

  function nextDay(day) {
    const date = new Date(`${day}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) throw new Error("Data inválida.");
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  async function loadReportData(day) {
    const supabaseClient = getClient();
    if (!supabaseClient) throw new Error("Supabase não configurado.");
    const start = `${day}T00:00:00-04:00`;
    const end = `${nextDay(day)}T00:00:00-04:00`;
    const result = await supabaseClient
      .from("orders")
      .select("*, order_items(*), order_events(*)")
      .gte("created_at", start)
      .lt("created_at", end)
      .order("created_at", { ascending: true });
    return throwIfError(result);
  }

  async function uploadProductImage(file) {
    const supabaseClient = getClient();
    if (!file) return null;
    if (!file.type.startsWith("image/")) throw new Error("Selecione um arquivo de imagem.");
    if (file.size > 5 * 1024 * 1024) throw new Error("A imagem deve ter no máximo 5 MB.");

    const extension = (file.name.split(".").pop() || "webp").toLowerCase().replace(/[^a-z0-9]/g, "");
    const randomId = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    const fileName = `produtos/${randomId}.${extension || "webp"}`;
    const uploadResult = await supabaseClient.storage
      .from("product-images")
      .upload(fileName, file, { cacheControl: "3600", upsert: false });
    throwIfError(uploadResult);

    return supabaseClient.storage.from("product-images").getPublicUrl(fileName).data.publicUrl;
  }

  window.TakitaStore = {
    isConfigured,
    getClient,
    loadPublicData,
    createPublicOrder,
    markOrderWhatsappOpened,
    getPublicOrderStatus,
    confirmPublicOrderDelivered,
    subscribeAdminOrders,
    signIn,
    signOut,
    getSession,
    onAuthStateChange,
    assertAdmin,
    loadAdminData,
    saveProduct,
    setProductActive,
    updateSettings,
    updateOrderStatus,
    archiveOrder,
    archiveOrdersForDay,
    loadReportData,
    uploadProductImage
  };
})();
