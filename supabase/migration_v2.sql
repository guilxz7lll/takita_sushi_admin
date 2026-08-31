-- TAKITA SUSHI — atualização v2
-- Execute este arquivo inteiro UMA VEZ no SQL Editor do projeto que já está funcionando.
-- Ele preserva produtos, usuários e pedidos existentes.

begin;

alter table public.products
  add column if not exists cost_price numeric(10,2) not null default 0;

alter table public.orders
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

alter table public.order_items
  add column if not exists unit_cost numeric(10,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_cost_price_nonnegative'
  ) then
    alter table public.products
      add constraint products_cost_price_nonnegative check (cost_price >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'order_items_unit_cost_nonnegative'
  ) then
    alter table public.order_items
      add constraint order_items_unit_cost_nonnegative check (unit_cost is null or unit_cost >= 0);
  end if;
end;
$$;

create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('created', 'status_changed', 'archived')),
  old_status text,
  new_status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_deleted_at_idx on public.orders (deleted_at);
create index if not exists order_events_order_id_idx on public.order_events (order_id, created_at);

-- Cria um marco inicial para pedidos anteriores à v2 sem inventar alterações passadas.
insert into public.order_events (order_id, actor_id, event_type, new_status, details, created_at)
select o.id, null, 'created', o.status, jsonb_build_object('imported_from_v1', true), o.created_at
from public.orders o
where not exists (
  select 1 from public.order_events e
  where e.order_id = o.id and e.event_type = 'created'
);

alter table public.order_events enable row level security;
revoke all on table public.order_events from anon, authenticated;
grant select on table public.order_events to authenticated;

-- O custo é administrativo e não pode aparecer no cardápio público.
revoke select on table public.products from anon;
grant select (
  id, name, category_id, description, price, image_url, active, featured,
  feature_tag, sort_order, created_at, updated_at
) on table public.products to anon;
grant select on table public.products to authenticated;

drop policy if exists "admins read order events" on public.order_events;
create policy "admins read order events" on public.order_events
for select to authenticated using (public.is_admin());

create or replace function public.audit_order_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_events (order_id, actor_id, event_type, new_status)
    values (new.id, auth.uid(), 'created', new.status);
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.order_events (order_id, actor_id, event_type, old_status, new_status)
    values (new.id, auth.uid(), 'status_changed', old.status, new.status);
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    insert into public.order_events (order_id, actor_id, event_type, old_status, new_status, details)
    values (
      new.id,
      coalesce(new.deleted_by, auth.uid()),
      'archived',
      old.status,
      new.status,
      jsonb_build_object('deleted_at', new.deleted_at)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists orders_audit_changes on public.orders;
create trigger orders_audit_changes
after insert or update on public.orders
for each row execute function public.audit_order_changes();

create or replace function public.create_public_order(p_customer jsonb, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.store_settings%rowtype;
  v_order public.orders%rowtype;
  v_product public.products%rowtype;
  v_item jsonb;
  v_quantity integer;
  v_product_id bigint;
  v_subtotal numeric(10,2) := 0;
  v_fee numeric(10,2) := 0;
  v_total numeric(10,2) := 0;
  v_result_items jsonb := '[]'::jsonb;
  v_payment_method text := trim(coalesce(p_customer->>'payment_method', ''));
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'O pedido deve ter entre 1 e 50 itens.';
  end if;

  select * into strict v_settings from public.store_settings where id = 1;
  if not v_settings.is_open then
    raise exception '%', v_settings.closed_message;
  end if;

  if char_length(trim(coalesce(p_customer->>'name', ''))) not between 2 and 100 then
    raise exception 'Informe um nome válido.';
  end if;
  if char_length(trim(coalesce(p_customer->>'phone', ''))) not between 8 and 30 then
    raise exception 'Informe um telefone válido.';
  end if;
  if char_length(trim(coalesce(p_customer->>'address', ''))) not between 3 and 250 then
    raise exception 'Informe um endereço válido.';
  end if;
  if v_payment_method not in ('pix', 'cash', 'debit', 'credit') then
    raise exception 'Forma de pagamento inválida.';
  end if;

  insert into public.orders (
    customer_name, customer_phone, customer_address, customer_reference,
    customer_location_url, payment_method, customer_note
  ) values (
    left(trim(p_customer->>'name'), 100),
    left(trim(p_customer->>'phone'), 30),
    left(trim(p_customer->>'address'), 250),
    left(trim(coalesce(p_customer->>'reference', '')), 250),
    left(trim(coalesce(p_customer->>'location_url', '')), 500),
    v_payment_method,
    left(trim(coalesce(p_customer->>'note', '')), 1000)
  ) returning * into v_order;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := (v_item->>'product_id')::bigint;
      v_quantity := (v_item->>'quantity')::integer;
    exception when others then
      raise exception 'O pedido contém um item inválido.';
    end;

    if v_quantity < 1 or v_quantity > 99 then
      raise exception 'A quantidade de cada item deve estar entre 1 e 99.';
    end if;

    select * into v_product
    from public.products
    where id = v_product_id and active = true;

    if not found then
      raise exception 'Um produto foi removido ou está indisponível. Atualize o cardápio.';
    end if;
    if v_product.price is null then
      raise exception 'O produto % precisa de orçamento.', v_product.name;
    end if;

    insert into public.order_items (
      order_id, product_id, product_name, unit_price, unit_cost, quantity, subtotal
    ) values (
      v_order.id, v_product.id, v_product.name, v_product.price, v_product.cost_price,
      v_quantity, round(v_product.price * v_quantity, 2)
    );

    v_subtotal := v_subtotal + round(v_product.price * v_quantity, 2);
    v_result_items := v_result_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'name', v_product.name,
      'unit_price', v_product.price,
      'quantity', v_quantity,
      'subtotal', round(v_product.price * v_quantity, 2)
    ));
  end loop;

  if v_payment_method = 'credit' then
    v_fee := round(v_subtotal * v_settings.credit_card_fee_percent / 100, 2);
  end if;
  v_total := v_subtotal + v_fee;

  update public.orders
  set subtotal = v_subtotal, fee = v_fee, total = v_total
  where id = v_order.id
  returning * into v_order;

  return jsonb_build_object(
    'id', v_order.id,
    'code', v_order.code,
    'items', v_result_items,
    'subtotal', v_subtotal,
    'fee', v_fee,
    'total', v_total,
    'status', v_order.status,
    'created_at', v_order.created_at,
    'settings', jsonb_build_object(
      'store_name', v_settings.store_name,
      'whatsapp_number', v_settings.whatsapp_number,
      'pix_key', v_settings.pix_key,
      'credit_card_fee_percent', v_settings.credit_card_fee_percent
    )
  );
end;
$$;

create or replace function public.get_public_order_status(p_order_code text, p_customer_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_items jsonb;
begin
  select * into v_order
  from public.orders
  where upper(code) = upper(trim(p_order_code))
    and regexp_replace(customer_phone, '[^0-9]', '', 'g') = regexp_replace(p_customer_phone, '[^0-9]', '', 'g')
  limit 1;

  if not found then
    raise exception 'Pedido não encontrado. Confira o código e o telefone.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', product_name,
    'quantity', quantity,
    'unit_price', unit_price,
    'subtotal', subtotal
  ) order by id), '[]'::jsonb)
  into v_items
  from public.order_items
  where order_id = v_order.id;

  return jsonb_build_object(
    'code', v_order.code,
    'customer_name', v_order.customer_name,
    'status', v_order.status,
    'created_at', v_order.created_at,
    'updated_at', v_order.updated_at,
    'payment_method', v_order.payment_method,
    'subtotal', v_order.subtotal,
    'fee', v_order.fee,
    'total', v_order.total,
    'items', v_items
  );
end;
$$;

create or replace function public.archive_order(p_order_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso administrativo necessário.';
  end if;

  update public.orders
  set deleted_at = now(), deleted_by = auth.uid()
  where id = p_order_id and deleted_at is null;

  return found;
end;
$$;

create or replace function public.archive_orders_for_day(p_day date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Acesso administrativo necessário.';
  end if;

  with archived as (
    update public.orders
    set deleted_at = now(), deleted_by = auth.uid()
    where deleted_at is null
      and (created_at at time zone 'America/Manaus')::date = p_day
    returning id
  )
  select count(*) into v_count from archived;

  return v_count;
end;
$$;

revoke all on function public.get_public_order_status(text, text) from public;
grant execute on function public.get_public_order_status(text, text) to anon, authenticated;

revoke all on function public.archive_order(bigint) from public;
grant execute on function public.archive_order(bigint) to authenticated;

revoke all on function public.archive_orders_for_day(date) from public;
grant execute on function public.archive_orders_for_day(date) to authenticated;

commit;
