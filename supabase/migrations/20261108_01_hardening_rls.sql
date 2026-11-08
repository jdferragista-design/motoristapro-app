-- ============================================================
-- MotoristaPro — endurecimento de RLS e privilégios
-- Projeto: xncxzczftetctpazzecu (motoristapro-Project)
-- Aplicado em: 2026-11-08
--
-- Contexto: o schema do projeto foi criado fora do repositório (o
-- motoristapro-schema.sql só previa user_states). Ao auditar, encontraram-se
-- três problemas que o Postgres permitia mas que não deviam existir:
--
--   1. GRANT a `anon` em TODAS as tabelas (select/insert/update/delete).
--      O RLS ainda barrava, porque as políticas só valem para `authenticated`,
--      mas `anon` deve ser negado por privilégio E por política — defesa em
--      profundidade: se alguém criar no futuro uma política para `public`,
--      passa a haver exposição real.
--
--   2. Políticas FOR ALL em `users` e `shifts` (e outras) SEM `with_check`.
--      Sem with_check, um UPDATE pode mover a linha para outro user_id:
--      o atacante autenticado consegue ESCREVER na linha de outra pessoa
--      (não lê, mas destrói). Isto é o furo clássico de RLS mal escrito.
--
--   3. `service_types` e `fixed_expense_types` tinham UMA política FOR ALL
--      com qual = (user_id = eu) OR (is_default = 1). Como o `qual` de uma
--      política FOR ALL também governa UPDATE/DELETE, qualquer utilizador
--      podia ALTERAR ou APAGAR as linhas padrão partilhadas por todos.
--
-- Este ficheiro é idempotente: pode ser re-executado com segurança.
-- ============================================================

-- ---------- 1. anon não tem privilégio em nada de public ----------
revoke all on all tables in schema public from anon;

grant select, insert, update, delete
  on public.user_states, public.shifts, public.users, public.fuel_logs,
     public.maintenance_logs, public.fixed_expenses,
     public.service_types, public.fixed_expense_types
  to authenticated;

-- ---------- 2. políticas com with_check (impede escrever na linha alheia) ----------
drop policy if exists "own data" on public.users;
create policy "own data" on public.users
  for all to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "own data" on public.shifts;
create policy "own data" on public.shifts
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own data" on public.fuel_logs;
create policy "own data" on public.fuel_logs
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own data" on public.maintenance_logs;
create policy "own data" on public.maintenance_logs
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own data" on public.fixed_expenses;
create policy "own data" on public.fixed_expenses
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- user_states já estava correto (with_check presente); garantido por idempotência
drop policy if exists "user_manage_own_state" on public.user_states;
create policy "user_manage_own_state" on public.user_states
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------- 3. catálogos: ler padrões, mas só alterar o que é seu ----------
-- Uma política FOR ALL não serve aqui: o `qual` de ALL também vale para
-- UPDATE/DELETE, então `OR is_default = 1` deixava qualquer um editar/apagar
-- os padrões de todos. Separa-se por comando.
drop policy if exists "own data" on public.service_types;
drop policy if exists "ler padroes ou proprios" on public.service_types;
drop policy if exists "inserir proprios" on public.service_types;
drop policy if exists "alterar proprios" on public.service_types;
drop policy if exists "apagar proprios" on public.service_types;
create policy "ler padroes ou proprios" on public.service_types
  for select to authenticated
  using ((is_default = 1) or (auth.uid() = user_id));
create policy "inserir proprios" on public.service_types
  for insert to authenticated
  with check (auth.uid() = user_id);
create policy "alterar proprios" on public.service_types
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "apagar proprios" on public.service_types
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "own data" on public.fixed_expense_types;
drop policy if exists "ler padroes ou proprios" on public.fixed_expense_types;
drop policy if exists "inserir proprios" on public.fixed_expense_types;
drop policy if exists "alterar proprios" on public.fixed_expense_types;
drop policy if exists "apagar proprios" on public.fixed_expense_types;
create policy "ler padroes ou proprios" on public.fixed_expense_types
  for select to authenticated
  using ((is_default = 1) or (auth.uid() = user_id));
create policy "inserir proprios" on public.fixed_expense_types
  for insert to authenticated
  with check (auth.uid() = user_id);
create policy "alterar proprios" on public.fixed_expense_types
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "apagar proprios" on public.fixed_expense_types
  for delete to authenticated
  using (auth.uid() = user_id);

-- ---------- 4. o sync depende disto: updated_at nunca vem do relógio do cliente ----------
-- auth.js envia `updated_at: new Date().toISOString()` (relógio do telemóvel).
-- Se o telemóvel estiver adiantado, a linha fica "no futuro" e o pull nunca
-- mais a substitui. O trigger abaixo ignora o valor enviado e carimba no
-- servidor, que é a única fonte de tempo confiável para last-write-wins.
create or replace function public.mp_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_user_states_updated_at on public.user_states;
create trigger trg_user_states_updated_at
  before insert or update on public.user_states
  for each row execute function public.mp_touch_updated_at();
