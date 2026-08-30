# Day 11 Handoff — build报错修复 + decided字段闭环确认 + NPC生成功能前端全部落地

**日期**：2026-08-26
**分支**：dev2
**上一份文档**：day10-handoff.md（续聊bug定位 + 模型/词典讨论 + NPC生成功能后端落地）

---

## 1. 修了一个build报错：`next/headers` 泄漏进客户端bundle

**现象**：`./lib/supabase/server.ts:2:1 Error: You're importing a module that depends on "next/headers"...`

**根因**：`lib/npc/registry.ts` 被 `home-client.tsx`/`chat-client.tsx`（两个 `"use client"` 组件）直接 import，用来同步渲染NPC选择列表。day10新加的 `getNpcConfigForUser`/`getNpcDisplayNameForUser` 也塞在这个文件里，为了"不污染客户端bundle"用了 `await import("../db/npcs")` 做动态引入——**这个假设是错的**：动态 `import()` 只是切webpack chunk，不代表这条依赖链会从客户端构建图里消失。只要 `registry.ts` 整个文件被客户端组件引用，webpack 打包时就会顺着链路解析到 `db/npcs.ts → supabase/server.ts → next/headers`，触发这个报错。

**修复**：新建 `lib/npc/registryServer.ts`，把这两个异步函数整体搬过去。`registry.ts` 现在只保留纯同步、客户端安全的部分（`getNpcConfig`/`listNpcIds`/`getNpcDisplayName`/`defaultParticipantsFor`）。所有服务端route（`event/start`、`event/close`、`chat`）改成从 `registryServer` import。

**教训记下来**：以后任何会碰到 `next/headers`（即任何调用 `supabase/server.ts` 的函数）的代码，都不能待在被客户端组件引用的文件里，哪怕用动态import包一层也不行。这类函数应该单独放一个"服务端专用"文件，物理隔离，不能靠import方式隔离。

---

## 2. 确认：`decided` 字段的后端逻辑其实day10已经写完了

上一份handoff（day10 4.3节）把这个列为"最紧急、还没写代码"的缺口，但逐个检查后发现——**代码其实已经在zip里写好了**：

- `NpcRow`/`NpcConfig` 类型都有 `decided` 字段
- `createNpc`：`source='created'`→`decided=true`，`source='emergent'`→`decided=false`
- `setNpcStatus`：调用时把 `decided` 置 `true`
- `event/start` 涌现路径正确调用 `createNpc(..., "emergent")`
- `event/close` 返回值带 `npcSource`/`npcDecided`
- `app/api/npc/status/route.ts` 也已经存在并且接线正确（day10文档说这个route还没建，实际已经有了）

**唯一真正缺的是数据库**：你确认过，手动跑的那段npcs表建表SQL（day10 4.2节）没有包含 `decided` 列。已经给你一条幂等SQL在Supabase SQL Editor里补上：

```sql
alter table public.npcs
  add column if not exists decided boolean not null default true;
```

**这条你说已经跑过了**——之后没有再检查一次实际列是否存在，建议下次连上Supabase Dashboard时顺手确认一眼 `npcs` 表结构。

同时把 `supabase/schema.sql` 补齐到跟你线上库一致（之前这个文件一直没跟手动执行的SQL同步，缺了整个 `npcs`/`npc_moderation_flags` 表、`users.banned`、`events.summary`允许null、以及 `events.language_observations`/`scenario`/`feedback` 三个列——后两组缺失是更早期的遗留，不是day10造成的，顺手一起补了）。这个文件是纯文档/未来重建库用，不需要现在再跑一次。

---

## 3. 新增：`/api/npc/list`

day10 4.4节提到前端要展示"我的动态NPC列表"需要一个新route，当时还不存在。现在加上了：

```
GET /api/npc/list
→ { npcs: [{ id, displayName, identity, personality, interests, source, createdAt }] }
```

只返回 `status='active'` 的（`discarded` 的不出现，不代表删除）。给home页那块新UI（见下）用。

---

## 4. NPC生成功能前端：四块全部做完

按上次商量的顺序，一块一块做，每块之间都跑过 `npm run build` 验证：

### 4.1 独立创建NPC页面（新增）

新路由 `/npc/new`：
- 输入screen：自由文本描述 → 调 `/api/npc/generate`（不落库，只生成草案）
- 预览/编辑screen：草案所有字段可编辑（名字/身份/性格/背景/兴趣/说话方式/纠错方式）—— 不是逐字段表单硬填，而是AI先给一版，玩家在这基础上改
- 确认screen：调 `/api/npc/create`（真正落库，且对最终版本重新过一次审核，不信任generate那一步的审核结果，因为玩家可能编辑过内容）
- 成功后：可以直接点"现在就去找TA聊天"，走 `/api/event/start` 跳进 `/chat`
- 422（审核拒绝）统一显示"这个人设暂时无法创建，换个描述试试"，不透露具体命中了哪条规则

`/home` 页加了一个"创造"分区链接过去，不然这页面做完也没入口。

**新增文件**：`app/npc/new/page.tsx`、`app/npc/new/npc-new-client.tsx`

### 4.2 ScenarioPreview改造（涌现路径）

之前 `needsNewNpc=true` 时的兜底行为是"退回选一个现有NPC"（day10遗留的临时方案，为了不让页面崩）。现在改成：

- 默认展示AI为这个场景设计的新角色草案，字段可编辑（跟4.1同一套编辑体验、同一批字段）
- 玩家仍然可以主动切换成"算了，选一个已经认识的人"（回到原来的静态NPC选择），也可以从那边切回来
- 确认时如果走的是"新角色"分支：`npcId` 传 `null`，`scenario` 里带上（可能被编辑过的）`newNpcDraft`——后端 `event/start` 看到 `needsNewNpc && newNpcDraft` 会自己创建NPC、自己决定真正的npcId，不需要前端瞎编一个占位值
- 编辑过身份/性格后，"你会遇到"那段场景介绍文字（`participants`）会跟着重新拼一份，不会跟实际生效的角色对不上

**改动文件**：`app/home/home-client.tsx`（`ScenarioPreview` 组件、`handleConfirmScenario` 签名改成接受 `npcId: string | null`）

### 4.3 对话结束后"留下/不留了"决策UI

依赖的后端字段（`npcSource`/`npcDecided`）day10已经在 `event/close` 里加了，但发现另外两个地方漏了，顺手补上：
- `/api/event/[eventId]` GET（页面刷新/从/world点进未结束对话时用这个接口，之前没带这两个字段）
- `event/close` 的另外两条返回路径（已关档直接返回、AI摘要生成失败的降级兜底）也补上了，之前只有正常成功路径带了

**同时发现并修掉一个连带问题**：`chat-client.tsx` 显示NPC名字时用的是同步的 `getNpcDisplayName(npcId)`（只认识静态注册表），对着一个动态NPC的uuid查不到，会直接把这串uuid当名字显示出来。现在改成用后端返回的 `npcDisplayName`（三个event相关的API route都补了这个字段：`event/start`、`event/[eventId]`、`event/close`）。

**决策UI逻辑**：对话结束后，如果 `npcSource === "emergent" && npcDecided === false`，展示"要把TA留下，变成你认识的人吗？"和两个按钮，分别调 `/api/npc/status` 传 `status: "active"` 或 `"discarded"`。点击后本地状态直接置 `decided: true`，按钮消失，换成一行"已经记下你的选择了"。

**改动文件**：`app/chat/chat-client.tsx`、`app/api/event/start/route.ts`、`app/api/event/[eventId]/route.ts`、`app/api/event/close/route.ts`

### 4.4 动态NPC列表展示

`/home` 页新增"你认识的人"分区，进入页面时调 `/api/npc/list` 拉取，列表为空时这个分区直接不渲染（不是空状态提示，做成"没有就不出现"更干净）。点击直接走现成的 `handleBrowseNpc`（跟静态NPC是同一套函数，因为服务端 `getNpcConfigForUser` 本来就同时认识静态和动态NPC，前端不需要区分）。

**顺带修的一个连带问题**：`world/page.tsx`（世界档案页）也是一样的静态查找bug——`getNpcDisplayName` 对动态NPC查不到会显示uuid。这个页面是服务端组件，可以放心调 `registryServer.ts` 里会查DB的 `getNpcDisplayNameForUser`（不像客户端组件那样有next/headers泄漏的风险），批量去重解析了一次，三处 `getNpcDisplayName(...)` 调用都换掉了。这个问题原本属于day10 4.4节没列出来的隐藏缺口，这次一起清掉了。

**改动文件**：`app/home/home-client.tsx`、`app/world/page.tsx`

---

## 本次改动涉及的文件清单

**新增**：
`lib/npc/registryServer.ts`、`app/api/npc/list/route.ts`、`app/npc/new/page.tsx`、`app/npc/new/npc-new-client.tsx`

**改动**：
`lib/npc/registry.ts`、`app/api/event/start/route.ts`、`app/api/event/close/route.ts`、`app/api/chat/route.ts`、`app/api/event/[eventId]/route.ts`、`app/home/home-client.tsx`、`app/chat/chat-client.tsx`、`app/world/page.tsx`、`supabase/schema.sql`

**已经跑过 `npm run build` + `npx tsc --noEmit`，全部干净**（用占位环境变量在沙盒里跑的，真实Supabase key下建议再跑一次实际功能测试）。

---

## 已知但可接受、暂不处理的行为

（同day9/day10文档）NPC不是每次都先开口——开场白生成失败静默退化成玩家先开口，Phase 4的有意设计，暂时保留。

---

## 留到下次讨论/处理，按优先级

1. **在Codespaces/Vercel Preview上做一次真实端到端测试**，走完整条链路：`/npc/new`创建 → 聊天 → world档案页确认显示名正常 → 涌现路径（自由输入一个现有NPC都不合适的场景）→ 结束对话选"留下/不留了" → 确认下次刷新/home能在"你认识的人"里看到
2. **模型选型决策**（day10第2节遗留，直接切Claude / 优化免费模型prompt / 先算成本，Vercel Preview上目前还是Groq/OpenRouter免费模型）
3. **本地词典查词功能**（day10第3节，方向已定：Supabase建表存jmdict-simplified，代码还没动）
4. **长对话截断**（等对话轮数数据，一直没讨论）
5. 三个Resend环境变量（`RESEND_API_KEY`、`MODERATION_NOTIFY_EMAIL`、`MODERATION_NOTIFY_FROM`）——如果还没配上，NPC安全审核命中时的邮件通知这一步会静默失败（建议检查一下 `notifyModerationFlag.ts` 是不是有try/catch兜底，没有的话邮件失败可能会连带审核流程一起挂掉，这个待确认，我这次没有专门去看）
6. Backlog里更靠后的项（能力树、自动难度、跨用户NPC互动等，V2文档里明确说的"以后再做"）