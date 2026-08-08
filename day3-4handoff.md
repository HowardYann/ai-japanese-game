# Day3-4 代码更新交接文档

> 用途：新session开头，和 `MVP开发上下文交接_md.md`、项目代码一起喂给AI，接着往下开发。

---

## 一、今天完成的模块

对照 `MVP开发上下文交接_md.md` 第七节 "Day3-5" 目标，完成了：

1. **NPC 配置层**（`lib/npc/`）
   - `types.ts`：明确区分 `persona`（会进prompt）和 `hidden`（后端专用，MVP阶段留空但架子先搭好，防止未来解锁条件之类的字段被误塞进prompt）
   - `data/mizuki.ts`、`data/taisho.ts`：按世界档案.md里的人设写死，包含各自的说话方式（speechStyle）和纠错风格（correctionStyle）描述
   - `registry.ts`：按id查配置

2. **上下文组装**（`lib/context/buildContext.ts`）
   - 核心函数 `buildChatContext(npc, relationship, recentTurns, newUserMessage)`
   - 白名单式拼system prompt：显式一个个字段取（不会把整个npc对象/hidden字段丢进prompt）
   - system prompt里直接写入了product_vision.md的"沉浸优先""关系优先"等原则，作为对Claude的硬性指令（比如明确写了"不要用教学口吻""纠正必须自然发生在角色台词里"）
   - 已用独立测试脚本验证过：hidden字段不会泄漏进prompt、最新消息正确追加在messages末尾

3. **DB查询层**（`lib/db/`）
   - `npcRelationships.ts`：get / createInitial / getOrCreate / updateSummary，summary是整段覆盖式更新（不是AI自由追加的黑箱文本）
   - `events.ts`：createEvent / getOwnedEvent / getTurnsForEvent / appendTurn / closeEvent
   - 安全纪律贯彻：**每一条查询都手动带 `user_id` 过滤**，追加turn前先校验event归属权（防止传别人的eventId进来写内容）

4. **AI调用层**（`lib/claude/client.ts`）
   - 不做tool calling，只吃组装好的context、吐纯文本
   - **支持多供应商切换**（通过环境变量 `AI_PROVIDER`）：
     - 默认走 Anthropic API（需要 `ANTHROPIC_API_KEY`，模型可用 `CLAUDE_MODEL` 覆盖，默认 `claude-sonnet-5`）
     - 设置 `AI_PROVIDER=openai_compatible` 时走任意OpenAI兼容接口（需要 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`），可指向 Groq / OpenRouter 等有免费额度的供应商，方便省钱测试
   - `.env.local.example` 里给了Groq/OpenRouter的具体配置示例

5. **API routes**
   - `POST /api/event/start`：开始一场新对话事件，附带初始化关系记录
   - `POST /api/chat`：核心链路——校验event归属→取relationship+最近turns→组装context→调AI→存user和npc两条turn→返回npc回复

---

## 二、重要修正记录（新session要注意）

**背景**：昨天生成 `lib/supabase/server.ts` 时，实际上没有成功读取到用户上传的项目zip（zip解压失败），AI在没有明确告知用户的情况下，自己编了一个通用版本的Supabase SSR client（`getSupabaseServerClient`同步写法），而不是用户项目里真实存在的版本。

**用户实际项目里的 `server.ts`**是这样的（async `createClient()` + `getAll/setAll` 写法）：

```typescript
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }: CookieToSet) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Component 里调用 setAll 会报错，可以忽略
          }
        },
      },
    }
  );
}
```

**已给出的修正方案**（用户已在自己项目里落地，本session不需要重做）：
- 新建 `lib/supabase/requireUserId.ts`，内部调用真实的 `createClient()`
- `lib/db/npcRelationships.ts`、`lib/db/events.ts` 里所有 `getSupabaseServerClient()` 改成 `await createClient()`，import来源改成 `../supabase/server`
- 两个API route里 `requireUserId` 的import路径改成 `lib/supabase/requireUserId`

**新session开始时的注意事项**：
- 如果新session里AI又要生成/修改涉及用户已有基础设施代码（认证、DB client等）的文件，**必须先确认能不能真的读到用户当前项目的文件**，读不到要明确说，不能编一个看似合理的版本替代
- 建议新session开头，先让AI重新读一遍当前项目里实际的 `lib/supabase/server.ts`、`lib/db/*.ts`、两个route文件，确认都已经是修正后的版本，再继续往下开发，避免这次的问题重演

---

## 三、测试方式结论

- **本地/Codespace 跑 `npm run dev` + magic link 登录一直有问题**（多次尝试过修复Codespace端口转发/Supabase redirect白名单未解决）
- **当前采用方案**：push到非main分支 → Vercel自动生成Preview部署（不影响正式环境）→ 在Preview域名上走magic link登录（这条路径验证过没问题）→ 登录后F12打开控制台，用fetch直接调 `/api/event/start` 和 `/api/chat`（同源请求，cookie自动带上，不用手动复制session cookie）
- Preview部署链接可以在 Vercel后台"Deployments"标签页找，或者GitHub PR页面下Vercel bot自动评论的链接
- 还没有搭建任何前端UI（世界档案页目前仍是Day1-2的静态占位），当前是纯接口层面的测试

---

## 四、Day5及之后待做

- 对话结束后生成 summary / 人生收藏（life_collection_title）的逻辑——目前 `closeEvent` 函数已就位，但触发时机和summary生成的prompt还没写
- "世界档案"页面读取 `npc_relationships` + `events` 数据并展示的接口/UI
- 最简单的聊天UI（选NPC → 输入框 → 发送 → 显示回复），目前测试都是走控制台fetch，UI还没搭
