# Day 1-2 状态记录

> 用途：配合《MVP开发上下文交接.md》一起丢给新 session。
> 这份文档只记"仓库外的配置状态"和"踩过的坑"，代码本身直接读 GitHub 仓库：
> https://github.com/HowardYann/ai-japanese-game

---

## 一、Day 1-2 目标：已完成 ✅

- Next.js 项目跑通，接入 Supabase Auth
- 登录流程（邮箱 magic link）已验证成功
- `/world` 路由受保护，未登录会跳回登录页
- 空的"世界档案"占位页可访问

---

## 二、Supabase 配置状态

- **schema.sql 已在 Supabase 项目里执行过**：`users` / `npc_relationships` / `events` / `conversation_turns` 四张表都建好了，RLS（行级安全）策略也生效了
- **登录方式**：Email 方式，PKCE flow，magic link（点击邮件链接登录）
  - ⚠️ **PKCE 要求同一个浏览器会话**：发起登录请求（输入邮箱那步）和点击邮件链接确认，必须在同一个浏览器里完成，否则 code 兑换会失败（跳回登录页带 `?error=` 参数）。这是当前实现的已知限制，不是 bug。
  - 邮件模板目前还是 Supabase **默认模板**（发的是链接，不是6位验证码）——原本想改成验证码方式更适合真实用户（不受设备/浏览器限制），但那需要先配置 custom SMTP（Supabase 免费版不让直接改模板），**这件事还没做，留到之后再看要不要弄**
- **URL Configuration**（Authentication → URL Configuration）：
  - Site URL 已改成 Vercel 部署域名
  - Redirect URLs 已加入 `<你的vercel域名>/auth/callback`
- Email 登录方式在 Authentication → Sign In / Providers 里默认开着，没改过

---

## 三、Vercel 部署状态

- 已部署，仓库已连接 GitHub 自动部署
- 环境变量已配置：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **`ANTHROPIC_API_KEY` 还没填**——Day 3 接对话功能时需要补上

---

## 四、踩过的坑（新 session 不用重踩）

1. **Next.js 16 把 `middleware.ts` 改名成了 `proxy.ts`**，函数名也从 `middleware` 改成 `proxy`。当前仓库里用的已经是 `proxy.ts`，如果新 session 要改这部分代码，注意用新的文件名和导出函数名。
2. **TypeScript 严格模式下，Supabase cookie 的 `setAll` 回调参数会报隐式 any**——已经通过显式定义 `CookieToSet` type 解决，`lib/supabase/server.ts` 和 `proxy.ts` 里都是这个写法。
3. **Codespaces 转发端口默认 Private**，会导致邮件链接跳转失败/触发异常下载——已经通过部署到 Vercel、直接用 Vercel 域名测试登录规避了这个问题。开发时 `npm run dev` 仍在 Codespace 里跑，但**测登录这件事要在 Vercel 域名下测**，不要在 Codespace 转发出的临时域名下测。

---

## 五、接下来：Day 3-4 待做（参照交接文档第六、七节）

- `lib/npc/` 目录：mizuki.json / taisho.json 两个NPC配置（人设参考已在交接文档里）
- API route（如 `app/api/chat/route.ts`）：读 `npc_relationships` 组装 context → 调 Claude API → 存 `conversation_turns`
- 世界档案页从占位改成真实读取 `npc_relationships` / `events` 表渲染
