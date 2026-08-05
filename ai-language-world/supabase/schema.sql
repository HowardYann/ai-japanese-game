-- ============================================================
-- AI Language World - MVP schema
-- 对应 MVP开发上下文交接.md 第四节数据模型
-- 在 Supabase Dashboard -> SQL Editor 里整段执行一次即可
-- ============================================================

-- ---------- users ----------
-- Supabase Auth 自带 auth.users 表（管密码/邮箱验证）。
-- 这里建一张 public.users 做业务侧镜像，方便外键引用、以后加业务字段。
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

-- 新用户注册后，自动在 public.users 里镜像一条记录
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- npc_relationships ----------
create table if not exists public.npc_relationships (
  user_id uuid not null references public.users (id) on delete cascade,
  npc_id text not null, -- 对应代码里 NPC JSON 配置的 id，比如 "mizuki" / "taisho"
  stage text not null default 'new', -- 关系阶段，例如 new / familiar / close
  known_facts jsonb not null default '{}'::jsonb, -- 玩家在对话中透露过的、NPC记得的事
  summary text not null default '', -- AI每次对话结束后整体重新生成、覆盖式摘要（不是追加）
  updated_at timestamptz not null default now(),
  primary key (user_id, npc_id)
);

-- ---------- events ----------
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  npc_id text not null,
  summary text not null default '',
  life_collection_title text, -- 这次对话是否产出了一条"人生收藏"，没有就是 null
  created_at timestamptz not null default now()
);

-- ---------- conversation_turns ----------
create table if not exists public.conversation_turns (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  role text not null check (role in ('user', 'npc')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_events_user_id on public.events (user_id);
create index if not exists idx_conversation_turns_event_id on public.conversation_turns (event_id);
create index if not exists idx_npc_relationships_user_id on public.npc_relationships (user_id);

-- ============================================================
-- Row Level Security：每张表强制"只能看自己的数据"
-- 这是安全纪律第1条（手动user_id过滤）的数据库层兜底
-- ============================================================

alter table public.users enable row level security;
alter table public.npc_relationships enable row level security;
alter table public.events enable row level security;
alter table public.conversation_turns enable row level security;

create policy "users can view own row"
  on public.users for select
  using (auth.uid() = id);

create policy "users can view own npc_relationships"
  on public.npc_relationships for select
  using (auth.uid() = user_id);

create policy "users can modify own npc_relationships"
  on public.npc_relationships for insert
  with check (auth.uid() = user_id);

create policy "users can update own npc_relationships"
  on public.npc_relationships for update
  using (auth.uid() = user_id);

create policy "users can view own events"
  on public.events for select
  using (auth.uid() = user_id);

create policy "users can insert own events"
  on public.events for insert
  with check (auth.uid() = user_id);

create policy "users can view own conversation_turns"
  on public.conversation_turns for select
  using (
    exists (
      select 1 from public.events e
      where e.id = conversation_turns.event_id
      and e.user_id = auth.uid()
    )
  );

create policy "users can insert own conversation_turns"
  on public.conversation_turns for insert
  with check (
    exists (
      select 1 from public.events e
      where e.id = conversation_turns.event_id
      and e.user_id = auth.uid()
    )
  );
