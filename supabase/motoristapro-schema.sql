-- ============================================================
-- MotoristaPro — Schema Supabase (PostgreSQL)
-- No Supabase Dashboard → SQL Editor → New query → colar → RUN
-- ============================================================

-- Tabela: estado completo do app por utilizador (sync nuvem)
create table if not exists public.user_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_states_updated_at on public.user_states(updated_at desc);

-- Row Level Security: cada utilizador só vê/edita o próprio estado
alter table public.user_states enable row level security;

drop policy if exists "user_manage_own_state" on public.user_states;
create policy "user_manage_own_state"
  on public.user_states
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- (Opcional) não permitir leitura anónima — já garantido: sem policy p/ anon
