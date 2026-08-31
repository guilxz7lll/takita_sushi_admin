# Takita Sushi — site + painel administrativo (v2)

Esta versão centraliza produtos, preços, disponibilidade, destaques, pedidos e configurações no Supabase. O painel fica em `/admin/`.

## Atualização da versão que já está funcionando

Não execute `schema.sql` novamente no projeto atual. Abra o SQL Editor do Supabase e execute somente:

```text
supabase/migration_v2.sql
```

A migração preserva os produtos, usuários e pedidos existentes. Depois publique os novos arquivos do site. O pacote de atualização não substitui o seu `public/app-config.js` já configurado. Em uma instalação nova, copie `public/app-config.example.js` para `public/app-config.js` e preencha os dois valores públicos.

## Novidades da v2

- O WhatsApp recebe somente a confirmação com nome e código do pedido, sem itens ou valores editáveis.
- O cliente acompanha o andamento em `pedido.html`, usando código e telefone.
- O resumo completo e os valores confirmados aparecem dentro do site, separados por seções.
- Pedidos podem ser removidos da tela individualmente ou por dia sem serem apagados do relatório.
- A área **Relatórios** mostra pedidos, concluídos, cancelados, excluídos, faturamento previsto/real e lucro bruto previsto/real.
- O relatório pode ser baixado em CSV ou impresso/salvo como PDF.
- O custo do produto pode ser informado no cadastro para o cálculo do lucro bruto.
- Fontes, ícones, filtros, tabelas e formulários foram ajustados para computador e celular.
- O upload de imagem ganhou alternativa compatível com acesso local por HTTP.

Para o lucro ficar correto, edite cada produto e informe seu custo. Pedidos novos congelam o custo usado no momento da compra. Nos pedidos criados antes desta atualização, o relatório usa o custo atual cadastrado no produto.

## O que foi corrigido

- O preço deixou de ser repetido no HTML, no carrinho e no carrossel.
- O carrinho salva apenas o ID e a quantidade de cada produto.
- Antes de criar o resumo do WhatsApp, o banco recalcula os itens usando os preços atuais.
- A taxa do cartão de crédito vem das configurações do painel.
- O número do WhatsApp, a chave Pix e o status aberto/fechado são editáveis.
- O endpoint do Mercado Pago não aceita mais um valor livre enviado pelo navegador; ele recebe o código do pedido e consulta o total validado no banco.
- O token do Mercado Pago não é mais exibido no console.
- O servidor e os HTMLs que estavam incompletos foram corrigidos.

## Ativação do Supabase

Na criação do projeto, use estas opções:

- **Enable Data API:** ligado.
- **Automatically expose new tables:** desligado.
- **Enable automatic RLS:** ligado.

Depois:

1. Abra o projeto no Supabase e entre no **SQL Editor**.
2. Execute todo o arquivo `supabase/schema.sql` e, em seguida, `supabase/migration_v2.sql`.
3. Em **Authentication > Users**, crie o usuário que entrará no painel.
4. No final de `supabase/schema.sql`, copie o comando de cadastro de administrador, troque o e-mail e execute esse comando.
5. Em **Project Settings > API Keys**, copie a URL do projeto e a chave `Publishable` (`sb_publishable_...`) ou a chave legada `anon`.
6. Cole esses dois valores em `public/app-config.js`.

A chave `anon` pode ficar no navegador porque as regras RLS do SQL controlam as permissões. A chave `service_role` é privada e nunca deve ser colocada em `public/`.

## Variáveis privadas e execução

Crie um arquivo `.env` usando `.env.example` como modelo:

```env
PORT=3000
MP_ACCESS_TOKEN=
MP_PAYER_EMAIL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Depois:

```bash
npm install
npm start
```

- Site: `http://localhost:3000/`
- Painel: `http://localhost:3000/admin/`

O catálogo continua abrindo com os dados atuais enquanto `app-config.js` não estiver configurado, mas o painel e o registro real de pedidos só funcionam após a conexão com o Supabase.

No painel, alterar **Loja aberta** só entra em vigor depois de clicar em **Salvar configurações**.

## Segurança importante

O arquivo ZIP original continha um `.env`. Ele não foi incluído no pacote atualizado. Se esse arquivo original já foi enviado a terceiros ou colocado em repositório público, gere um novo token do Mercado Pago e desative o anterior.

Para publicar, configure as variáveis privadas no painel da hospedagem. Não envie `.env`, `SUPABASE_SERVICE_ROLE_KEY` ou `MP_ACCESS_TOKEN` ao GitHub.
