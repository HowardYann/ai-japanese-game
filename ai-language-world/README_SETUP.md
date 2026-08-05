# 在 Codespace 里跑起来 —— Day 1-2 验收步骤

对应 MVP开发上下文交接.md 第七节目标：
1. Next.js 项目初始化，接入 Supabase（DB+Auth）
2. users 表 + 登录流程跑通
3. 能看到一个空的"世界档案"页

---

## 第一步：建 Supabase 项目

1. 打开 https://database.new ，用 GitHub 账号登录，新建一个项目（免费额度够用）
2. 项目建好后，进 **Project Settings → API**，复制两个值：
   - `Project URL`
   - `anon public` key（也可能显示为 publishable key）
3. 进左侧 **SQL Editor**，新建一条 query，把本项目 `supabase/schema.sql` 的全部内容粘贴进去，点 Run。
   跑完应该能在 **Table Editor** 里看到 `users` / `npc_relationships` / `events` / `conversation_turns` 四张表。

---

## 第二步：把这些文件放进 Codespace

把这个压缩包解压后的全部内容，放进你 Codespace 里的项目根目录（如果 Codespace 已经有 `git init` 的空仓库，直接把文件拖进去 / 用 `cp -r` 覆盖过去即可）。

---

## 第三步：装依赖、配环境变量

```bash
npm install
cp .env.local.example .env.local
```

打开 `.env.local`，把第一步复制的两个值填进去：

```
NEXT_PUBLIC_SUPABASE_URL=你的Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的anon key
```

---

## 第四步：Supabase 后台打开邮箱登录方式

Supabase Dashboard → **Authentication → Providers** → 确认 **Email** 是开着的（默认就是开的，不用改）。

本地开发时，Supabase 默认会把 magic link 邮件通过它自带的测试邮件服务发出——去注册用的邮箱收件箱（也查一下垃圾邮件）里点链接即可。

---

## 第五步：跑起来

```bash
npm run dev
```

Codespace 会提示 "在浏览器打开 3000 端口"，点开：

1. 应该看到登录页，输入邮箱，点"发送登录链接"
2. 去邮箱点链接
3. 应该跳转到 `/world`，看到"🌏 我的世界档案"占位页，显示你的邮箱、三个空白区块

**这就是 Day 1-2 要验收的东西：鉴权 + 路由链路通了。**

---

## 遇到问题怎么办

- 报错信息直接贴给我，我用不了网络所以看不到 Codespace 里发生了什么，需要你把终端报错或浏览器控制台报错复制过来
- 常见坑：
  - `.env.local` 没填或填错 → 页面加载直接报 Supabase 相关错误
  - 邮箱没收到链接 → 先查垃圾邮件；Supabase 免费版邮件发送有速率限制，狂点"发送"会被限流

---

## 接下来（Day 3 开始，不是现在要做的）

- `lib/npc/` 目录放 mizuki.json / taisho.json 两个NPC配置
- 一个 API route（比如 `app/api/chat/route.ts`）负责：读 `npc_relationships` 组装 context → 调 Claude API → 存 `conversation_turns`
- 世界档案页从"占位"改成真的读 `npc_relationships` / `events` 表渲染

这些先不用管，等 Day 1-2 跑通了再继续。
