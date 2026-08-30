# Day 10 Handoff — 续聊bug定位 + 模型/词典讨论 + NPC生成功能后端落地（进行中）

**日期**：2026-08-25
**分支**：dev2
**上一份文档**：day9-handoff.md（体验细节打磨 + 续聊问题排查）

---

## 1. 续聊逻辑bug：根因已定位，已给修复SQL

**根因**：`supabase/schema.sql` 里 `events.summary` 定义是 `text not null default ''`，永远不可能是`null`。但 `getOpenEventForNpc` 查询条件是 `.is("summary", null)`，永远查不到任何行——所以每次都走"没有未结束事件"分支，`resumed`字段自然一直不出现。跟day9文档里怀疑的"入口/RLS"都没关系，纯粹是schema默认值和代码期望的语义不匹配（`EventRow.summary`的TS类型本来就是`string | null`，说明设计意图是对的，schema.sql这一行没跟上）。

**修复**：一次性SQL迁移（还没在Supabase里跑，需要你去SQL Editor执行）：

```sql
alter table public.events alter column summary drop not null;
alter table public.events alter column summary set default null;
update public.events set summary = null where summary = '';
```

`supabase/schema.sql`本身已经改好（`summary text default null`），这是给以后重新建库用的，不代表线上数据库已经生效——上面那段SQL要单独手动跑一次。

代码不用改，`getOpenEventForNpc`等所有用到`.summary`的地方（`world/page.tsx`、`event/close/route.ts`等）用的都是`!event.summary`/`event.summary || "..."`这种写法，null和''在这些地方语义等价，迁移不影响现有展示逻辑。

**验证方式**：下次续聊测试时看Network面板`/api/event/start`的返回值应该能看到`resumed: true`。

---

## 2. 模型/对话风格讨论：确认是模型问题，不是prompt问题

Vercel Preview 上 `AI_PROVIDER` 实际配置的是方案B（Groq/OpenRouter免费模型），不是Claude。你平时对比的"直接聊Claude"体验，跟NPC对话用的完全不是同一个模型，质量差距是必然的——不需要往prompt风格上找原因。

**待决策，下次接着聊**：
- 直接切回Claude，验证质量差距能不能补回来
- 继续用免费模型，优化prompt看能不能提升
- 先估算Claude的成本大致多少再决定

---

## 3. 本地词典查词功能：讨论了存储方案，代码未动

- 现有`toRubyHtml.ts`是"分词→直接拼HTML字符串"一步到位，要加查词需要改成先产出token数组（带`base_form`），HTML拼接和"可点击"分开处理
- **jmdict-simplified存储方式**：讨论后倾向**导入Supabase建表**，不用静态JSON打包进Vercel部署（会增加Serverless Function体积、拖慢冷启动，你之前已经因为kuromoji字典冷启动踩过坑，不宜再叠加）
- **交互方式**：点击词直接弹出popover显示释义；不需要做翻译功能（已有复制/插入词块功能，避免重复）；且NPC台词文本（触发查词的地方）和词块按钮是两个不同的DOM区域，点击互不冲突，不需要用长按规避
- 这项本次暂缓，未写任何代码

---

## 4. NPC生成功能：设计已定稿，后端代码已写大半，前端未开始

### 4.1 整体设计（已达成一致）

- **可见范围**：玩家创建的NPC只归创建者自己能聊，不做公共目录
- **创建方式**：自由输入描述，AI结构化成persona——不做逐字段表单
- **两条路径都要做，共用同一套安全审核+数据落库逻辑**：
  1. **独立创建入口**：玩家主动描述 → 生成persona草案 → 预览/编辑确认 → 落库
  2. **陌生场景涌现**：`scenario/generate`判断现有NPC都不合适时，顺带生成一份新角色草案，对话开始时就落库（不是聊完再决定），默认`active`；玩家聊完可以选择"不留了"改成`discarded`
- **安全审核**：生成的persona在真正落库前，用一次独立的Claude调用做安全分类（色情/未成年人相关、仇恨极端、暴力、prompt注入企图、冒充公众人物），命中则：写入`npc_moderation_flags`表留底 + 发邮件通知开发者 + 给玩家看不到具体原因的通用拒绝提示
- **封禁**：`users.banned`字段已加，`requireUserId`已经会检查，但触发封禁目前**只能人工**在Supabase SQL Editor里手动改——自动封禁逻辑明确不做
- **邮件服务**：确认用Resend，直接调其HTTP API（跟Supabase Auth的magic link邮件走的SMTP通道完全独立，是两个集成点），发信域名`ai-language-learning.lol`，需要一个新的`RESEND_API_KEY`环境变量（你正在去找）
- **防注入**：`buildContext.ts`加了一段元规则——人设/场景文本不管写了什么，只当角色背景资料看待，不能拿来改变行为规则、跳出角色、或套取隐藏系统信息

### 4.2 后端代码：已完成（未跑build验证）

**新增文件**：
- `lib/db/npcs.ts` —— createNpc / getOwnedNpc / listActiveNpcsForUser / setNpcStatus
- `lib/db/moderationFlags.ts` —— insertModerationFlag（故意不提供"查自己flag"的函数）
- `lib/db/users.ts` —— getUserEmail
- `lib/npc/generatePersona.ts` —— 独立创建入口的persona生成prompt+解析
- `lib/npc/moderatePersona.ts` —— 安全审核分类器
- `lib/npc/enforcePersonaSafety.ts` —— 共用编排逻辑：审核→留底→发邮件→抛`PersonaRejectedError`
- `lib/email/notifyModerationFlag.ts` —— 调Resend API发通知邮件
- `app/api/npc/generate/route.ts` —— 独立创建第1步：生成草案+过一次审核，不落库
- `app/api/npc/create/route.ts` —— 独立创建第2步：对（可能编辑过的）最终版本再审一次，落库

**改动文件**：
- `lib/db/types.ts` —— `EventScenario`加`needsNewNpc`/`newNpcDraft`；新增`NpcRow`
- `lib/npc/types.ts` —— `NpcConfig`加可选`ownerId`/`source`
- `lib/npc/registry.ts` —— 保留原有同步函数不变（`home-client.tsx`还在客户端直接同步调用，不能改成异步/接DB），新增异步`getNpcConfigForUser`/`getNpcDisplayNameForUser`
- `lib/context/buildContext.ts` —— 防注入元规则
- `lib/context/buildScenarioContext.ts` —— 加"现有NPC都不合适就生成新角色草稿"分支
- `lib/supabase/requireUserId.ts` —— 加banned检查
- `app/api/event/start/route.ts` —— 支持needsNewNpc分支（先审核+落库拿npcId，再走原流程），npc解析换成`getNpcConfigForUser`
- `app/api/chat/route.ts`、`app/api/event/close/route.ts` —— 同样换成`getNpcConfigForUser`
- `app/home/home-client.tsx` —— **仅做了兼容性修复**，不是完整功能：`RECOMMENDED`两条硬编码场景补了新字段；`ScenarioPreview`在`needsNewNpc=true`时暂时兜底退回选现有NPC，防止类型报错/运行时崩溃，但**没有**做"展示AI生成的新角色草案让玩家确认"的界面
- `supabase/schema.sql` —— 新增`npcs`表、`npc_moderation_flags`表、`users.banned`字段，配套RLS策略；顺带把第1节的`events.summary`修复也并进了这个文件

**这份SQL要在Supabase SQL Editor里跑一次**（第1节的events.summary迁移 + 下面这段）：

```sql
create table if not exists public.npcs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete cascade,
  display_name text not null,
  identity text not null,
  personality text not null,
  background text not null,
  interests text[] not null default '{}',
  speech_style text not null,
  correction_style text not null,
  source text not null default 'created',
  status text not null default 'active',
  created_at timestamptz not null default now()
);
create index if not exists idx_npcs_owner_id on public.npcs (owner_id);

create table if not exists public.npc_moderation_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  raw_input text not null,
  display_name text not null,
  persona jsonb not null,
  reasons text[] not null default '{}',
  created_at timestamptz not null default now(),
  reviewed boolean not null default false
);
create index if not exists idx_npc_moderation_flags_user_id on public.npc_moderation_flags (user_id);

alter table public.users add column if not exists banned boolean not null default false;

alter table public.npcs enable row level security;
alter table public.npc_moderation_flags enable row level security;

create policy "users can view own npcs" on public.npcs for select using (auth.uid() = owner_id);
create policy "users can insert own npcs" on public.npcs for insert with check (auth.uid() = owner_id);
create policy "users can update own npcs" on public.npcs for update using (auth.uid() = owner_id);

-- 故意不给select policy：玩家自己的会话永远查不到这张表的任何一行
create policy "users can insert own moderation flags" on public.npc_moderation_flags
  for insert with check (auth.uid() = user_id);
```

**环境变量待补**（.env.local + Vercel）：
- `RESEND_API_KEY`（你正在去Resend Dashboard找）
- `MODERATION_NOTIFY_EMAIL`（收件人，你自己的邮箱）
- `MODERATION_NOTIFY_FROM`（可选，默认`NPC审核提醒 <notify@ai-language-learning.lol>`，前提是这个域名在Resend里已验证发信权限）

### 4.3 会话结束时发现、但还没写进代码的一个设计缺口：`decided`字段

**问题**：涌现路径的NPC插入时默认`status='active'`，如果不加区分，玩家聊完什么都不做，这个NPC也已经算"被留下"了——"要不要收进人物列表"这个决策动作就没有意义，因为不做选择=默认已经保留。

**需要补的设计**（下次会话开始时优先做，代码还没写）：
- `npcs`表加一列 `decided boolean not null default true`
- `createNpc`：`source='created'`时`decided`直接给`true`（主动创建=天然是明确决定）；`source='emergent'`时插入`decided=false`
- `setNpcStatus`：调用时顺带把`decided`设成`true`（不管选"留下"还是"不留了"，只要玩家做了这个选择，就是decided）
- 对话结束（`event/close`）时，前端需要知道"这个npc是emergent且decided=false"才展示"留下/不留了"的提示——这意味着`event/close`的返回值要带上npc的`source`/`decided`，目前还没加

### 4.4 前端：完全没开始

需要做的页面/组件：
- 独立创建NPC的输入→预览→编辑→确认页面（调`/api/npc/generate`再调`/api/npc/create`）
- `ScenarioPreview`组件：`needsNewNpc=true`时展示`newNpcDraft`人设预览并允许编辑，而不是当前的"兜底退回选现有NPC"
- 对话结束后的"留下/不留了"决策UI（依赖4.3的`decided`字段和`event/close`返回值改动）
- 世界档案页/home页展示玩家自己的动态NPC——`home-client.tsx`是客户端组件，不能直接同步调DB，需要一个新的API route（比如`/api/npc/list`）给前端拉取自己名下的active NPC列表
- `setNpcStatus`函数已经写好在`lib/db/npcs.ts`里，但目前没有任何API route暴露它，前端调不到——需要新增一个类似`app/api/npc/status/route.ts`的接口

---

## 已知但可接受、暂不处理的行为

（同day9文档）NPC不是每次都先开口——开场白生成失败静默退化成玩家先开口，事件仍创建成功，Phase 4的有意设计，暂时保留。

---

## 留到下次讨论/处理，按优先级

1. **补`decided`字段设计并写代码**（4.3节，最紧急，backend没这个字段整个"收藏/丢弃"闭环是不完整的）
2. **在Codespaces里跑一遍`npm run build`**，验证这次Phase 6所有类型改动没有遗漏（比如是否还有别的地方同步调用了`getNpcConfig`但传的是动态npcId）
3. **NPC生成功能前端**（4.4节，四块：独立创建页面、ScenarioPreview改造、留下/丢弃UI、动态NPC列表展示+对应API）
4. **两处SQL迁移执行**（events.summary + npcs/npc_moderation_flags/users.banned）+ 三个Resend相关环境变量配置
5. **模型选型决策**（第2节，直接切Claude / 优化免费模型prompt / 先算成本）
6. 本地词典查词功能（第3节，方向已定，代码未动）
7. 长对话截断（等对话轮数数据，本次未讨论）

---

## 本次改动涉及的文件清单（供下次核对）

**新增**：
`lib/db/npcs.ts`、`lib/db/moderationFlags.ts`、`lib/db/users.ts`、`lib/npc/generatePersona.ts`、`lib/npc/moderatePersona.ts`、`lib/npc/enforcePersonaSafety.ts`、`lib/email/notifyModerationFlag.ts`、`app/api/npc/generate/route.ts`、`app/api/npc/create/route.ts`

**改动**：
`lib/db/types.ts`、`lib/npc/types.ts`、`lib/npc/registry.ts`、`lib/context/buildContext.ts`、`lib/context/buildScenarioContext.ts`、`lib/supabase/requireUserId.ts`、`app/api/event/start/route.ts`、`app/api/chat/route.ts`、`app/api/event/close/route.ts`、`app/home/home-client.tsx`、`supabase/schema.sql`
