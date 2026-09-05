require("dotenv").config({ quiet: true });

const path = require("path");
const express = require("express");
const mercadopago = require("mercadopago");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/entregador", (_req, res) => {
  res.redirect(308, "/entregador/");
});

app.get("/entregador/", (_req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "entregador", "index.html")
  );
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function buscarPedidoNoSupabase(codigoPedido) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase não configurado no servidor.");
  }

  const url = new URL("/rest/v1/orders", supabaseUrl);
  url.searchParams.set("code", `eq.${codigoPedido}`);
  url.searchParams.set("select", "id,code,total,status,deleted_at");
  url.searchParams.set("limit", "1");

  const response = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    }
  });

  if (!response.ok) {
    throw new Error("Não foi possível validar o pedido.");
  }

  const [pedido] = await response.json();

  if (!pedido) {
    const erro = new Error("Pedido não encontrado.");
    erro.statusCode = 404;
    throw erro;
  }

  return pedido;
}

app.post("/criar-pix", async (req, res) => {
  try {
    const codigoPedido = String(req.body?.orderCode || "").trim();

    if (!/^TS-[A-Z0-9]{8}$/.test(codigoPedido)) {
      return res.status(400).json({ erro: "Código de pedido inválido." });
    }

    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(503).json({ erro: "Pagamento Pix ainda não foi configurado." });
    }

    const pedido = await buscarPedidoNoSupabase(codigoPedido);

    if (pedido.deleted_at || pedido.status === "cancelled") {
      return res.status(409).json({ erro: "Este pedido foi cancelado ou arquivado." });
    }

    const valorValidado = Number(pedido.total);

    if (!Number.isFinite(valorValidado) || valorValidado <= 0) {
      return res.status(400).json({ erro: "O pedido não possui um total válido." });
    }

    const client = new mercadopago.MercadoPagoConfig({
      accessToken: process.env.MP_ACCESS_TOKEN
    });
    const payment = new mercadopago.Payment(client);

    const resultado = await payment.create({
      body: {
        transaction_amount: valorValidado,
        description: `Pedido Takita Sushi ${pedido.code}`,
        payment_method_id: "pix",
        external_reference: pedido.code,
        payer: {
          email: process.env.MP_PAYER_EMAIL || "pagamentos@takitasushi.com.br"
        }
      }
    });

    return res.json({
      id: resultado.id,
      orderCode: pedido.code,
      amount: valorValidado,
      qr_code: resultado.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: resultado.point_of_interaction?.transaction_data?.qr_code_base64
    });
  } catch (erro) {
    const statusCode = Number(erro.statusCode) || 500;
    console.error("Falha ao gerar Pix:", erro.message);
    return res.status(statusCode).json({
      erro: statusCode === 500 ? "Falha ao gerar Pix." : erro.message
    });
  }
});

app.use((_req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "index.html"));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Takita Sushi disponível em http://localhost:${PORT}`);
  });
}

module.exports = app;
