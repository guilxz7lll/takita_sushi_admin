window.TAKITA_SEED = {
  categories: [
    { id: "hot-holl", name: "Hot Holl's", sort_order: 10, active: true },
    { id: "hossomaki", name: "Uramakis e Hossomakis", sort_order: 20, active: true },
    { id: "temaki", name: "Temaki's", sort_order: 30, active: true },
    { id: "barca", name: "Barcas", sort_order: 40, active: true },
    { id: "bebidas", name: "Bebidas", sort_order: 50, active: true },
    { id: "adicionais", name: "Adicionais", sort_order: 60, active: true }
  ],
  products: [
    { id: 1, name: "Hot Holl Philadelphia", category_id: "hot-holl", price: 30, image_url: "imagens/salmão_hot.png", description: "Porção de hot holl de salmão com finalização especial.", active: true, featured: true, feature_tag: "Mais pedido", sort_order: 10 },
    { id: 2, name: "Hot Holl Butterfly", category_id: "hot-holl", price: 30, image_url: "imagens/hotholl2.png", description: "Porção de hot holl de camarão crocante e bem recheado.", active: true, featured: false, feature_tag: "", sort_order: 20 },
    { id: 3, name: "Uramaki Salmão", category_id: "hossomaki", price: 35, image_url: "imagens/uramaki.png", description: "Uramaki de salmão com 10 unidades.", active: true, featured: false, feature_tag: "", sort_order: 30 },
    { id: 4, name: "Uramaki Camarão", category_id: "hossomaki", price: 30, image_url: "imagens/uramakicamarão.png", description: "Uramaki de camarão com 10 unidades.", active: true, featured: false, feature_tag: "", sort_order: 40 },
    { id: 5, name: "Hossomaki Salmão", category_id: "hossomaki", price: 30, image_url: "imagens/hossomaki.png", description: "Hossomaki de salmão com 10 unidades.", active: true, featured: false, feature_tag: "", sort_order: 50 },
    { id: 6, name: "Temaki Salmão Cru", category_id: "temaki", price: 38, image_url: "imagens/temaki (1).png", description: "Temaki de salmão. 1 unidade.", active: true, featured: true, feature_tag: "Especial", sort_order: 60 },
    { id: 7, name: "Temaki Camarão Cru", category_id: "temaki", price: 40, image_url: "imagens/temakicamarão.png", description: "Temaki de camarão. 1 unidade.", active: true, featured: false, feature_tag: "", sort_order: 70 },
    { id: 8, name: "Dog-Hot Salmão", category_id: "hot-holl", price: 38, image_url: "imagens/dog.png", description: "Dog-Hot de salmão. 1 unidade.", active: true, featured: false, feature_tag: "", sort_order: 80 },
    { id: 9, name: "Dog-Hot Camarão", category_id: "hot-holl", price: 38, image_url: "imagens/dog.png", description: "Dog-Hot de camarão. 1 unidade.", active: true, featured: false, feature_tag: "", sort_order: 90 },
    { id: 10, name: "Temaki Salmão Hot", category_id: "temaki", price: 40, image_url: "imagens/temakihot.png", description: "Temaki frito de salmão. 1 unidade.", active: true, featured: false, feature_tag: "", sort_order: 100 },
    { id: 11, name: "Temaki Camarão Hot", category_id: "temaki", price: 40, image_url: "imagens/temaki3.png", description: "Temaki frito de camarão. 1 unidade.", active: true, featured: false, feature_tag: "", sort_order: 110 },
    { id: 12, name: "P Mista", category_id: "barca", price: 60, image_url: "imagens/barcaG.png", description: "Barca mista com 20 unidades. Boa para um pedido menor.", active: true, featured: false, feature_tag: "", sort_order: 120 },
    { id: 13, name: "M Mista", category_id: "barca", price: 90, image_url: "imagens/barcaG.png", description: "Barca mista com 30 unidades. Ideal para dividir.", active: true, featured: false, feature_tag: "", sort_order: 130 },
    { id: 22, name: "M Hot", category_id: "barca", price: 90, image_url: "imagens/barcaG.png", description: "Barca hot com 30 unidades. Ideal para dividir.", active: true, featured: false, feature_tag: "", sort_order: 140 },
    { id: 14, name: "G Mista", category_id: "barca", price: 150, image_url: "imagens/barcaG.png", description: "Barca mista com 55 unidades. Boa para família, eventos e aniversários.", active: true, featured: true, feature_tag: "Destaque", sort_order: 150 },
    { id: 15, name: "G Hot", category_id: "barca", price: 120, image_url: "imagens/barcaG.png", description: "Barca hot com 40 unidades. Boa para família, eventos e aniversários.", active: true, featured: false, feature_tag: "", sort_order: 160 },
    { id: 16, name: "Coca-Cola 2L", category_id: "bebidas", price: 15, image_url: "imagens/coca.png", description: "Refrigerante Coca-Cola. Garrafa de 2 litros.", active: true, featured: false, feature_tag: "", sort_order: 170 },
    { id: 17, name: "Coca-Cola lata 350ml", category_id: "bebidas", price: 6, image_url: "imagens/cocalata.png", description: "Refrigerante Coca-Cola. Lata de 350ml.", active: true, featured: false, feature_tag: "", sort_order: 180 },
    { id: 18, name: "Molho Tarê", category_id: "adicionais", price: 0.5, image_url: "imagens/tare.png", description: "Sachê de molho tarê adicional.", active: true, featured: false, feature_tag: "", sort_order: 190 },
    { id: 19, name: "Molho Shoyu", category_id: "adicionais", price: 0.5, image_url: "imagens/shoyu.png", description: "Sachê de shoyu adicional.", active: true, featured: false, feature_tag: "", sort_order: 200 }
  ],
  settings: {
    id: 1,
    store_name: "Takita Sushi",
    whatsapp_number: "5592985194693",
    pix_key: "92985194693",
    credit_card_fee_percent: 5,
    is_open: true,
    closed_message: "Estamos fechados no momento. Voltamos em breve!"
  }
};
