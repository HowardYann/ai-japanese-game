# Day 9 Handoff — 体验细节打磨 + 剧情推进问题排查

**日期**：2026-08-23
**分支**：dev2
**上一份文档**：day8handoff.md（V2 场景驱动改版 Phase 1-5）

---

## 本次会话做了什么

### 1. 词块交互：从"复制到剪贴板"改成"插入光标位置"
- `chat-client.tsx`：`handleCopyChunk` → `handleInsertChunk`，用 `inputRef` + `selectionStart/selectionEnd` 在光标处插入词块，插入后手动把光标移到插入内容之后
- 待验证：手机浏览器上按钮点击导致输入框先失焦，`selectionStart` 有没有读错/读不到的情况，如果有要把 `onClick` 换成 `onMouseDown`/`onTouchStart` 提前读取光标位置

### 2. 同一NPC有未结束对话时，新对话应续聊旧对话（**本次遗留问题，见下**）
- `lib/db/events.ts` 新增 `getOpenEventForNpc(userId, npcId)`：查 `summary IS NULL` 的最近一条event
- `app/api/event/start/route.ts`：在 `createEvent` 之前先查有没有未结束事件，有则直接返回该eventId（`resumed: true`），跳过开场白生成
- 前端：`home-client.tsx` 传递 `resumed` 参数到 `/chat?eventId=X&resumed=1`；`chat-client.tsx` 读取 `resumed` prop，在续聊时显示一条提示"继续你和XX之前没聊完的对话"
- **状态：本次实测未生效，具体原因待查**（见"未解决问题"一节）

### 3. 手动切换NPC时，场景描述同步更新
- `lib/npc/registry.ts` 新增 `defaultParticipantsFor(npc)`，用NPC自身persona现算一段替换文案
- `ScenarioPreview` 组件里，玩家手动切NPC后（`npcId !== scenario.suggestedNpcId`），提交时用 `defaultParticipantsFor` 覆盖 `scenario.participants` 再传给 `onConfirm`
- `onConfirm` 签名从 `(npcId: string) => void` 改成 `(npcId: string, effectiveScenario: EventScenario) => void`
- 已知局限：只修复了 `participants` 字段，`environment`/`possibleTasks` 如果原场景和新NPC身份类型差异很大（比如"定食屋点菜"场景切到IT行政瑞希），依然可能不完全贴合——这类"跨场景类型切换"目前没有轻量修法，需要重新调 `/api/scenario/generate` 才能彻底解决，先不做

### 4. Prompt改动：解决"模型直接示范整句台词逼玩家复制"的问题
- 原因：AI把"给玩家一个标准答案"直接说成台词，而不是走 `[[CHUNKS: ...]]` 标记机制；原有规则只覆盖"玩家用中文求助"这一种触发场景，没盖住这种情况
- `buildContext.ts` 核心原则列表新增一条硬约束：除非玩家明确用中文求助"这句话怎么说"，否则任何情况下都不能在台词正文里直接给出一整句"标准答案"式日语

### 5. Prompt改动：解决"目标已达成但还在原地反复道别/确认"的空转问题
- 和之前加的"轮数提醒"（针对"迟迟不落地"）是两种不同的停滞模式，这次是"已经落地了但不知道收"
- `buildContext.ts` 新增一条：如果场景目标已达成或已无新内容可聊，用1-2句自然收尾，不要用不同措辞反复表达同一件已确定的事

### 6. 新增"建议结束对话"信号机制
- Prompt新增：AI判断场景已达成时，在回复最后一行追加不可见标记 `[[SUGGEST_CLOSE]]`
- `extractWordChunks.ts` 扩展出解析这个标记，返回 `suggestClose: boolean`
- `chat/route.ts` 透传该字段；`chat-client.tsx` 在最后一条NPC消息带此标记时，于输入框上方显示一条"这次的事看起来已经聊定了，要不要先告一段落"的提示条 + "结束对话"按钮
- 目的：即使AI在台词层面还是没完全收住，玩家也有一个不打断沉浸感的明确出口，不用一直被动"はい/うん"下去

---

## 未解决问题：续聊逻辑本次实测未生效

已确认排除的可能原因：
1. `getOpenEventForNpc` 用的是 `.is("summary", null)`（非 `.eq`）——已核实写法正确
2. 上一场对话确认没有点过"结束对话"按钮，`summary` 理论上应该还是 null
3. Vercel Preview 部署时间戳已确认是最新代码

下一次会话要排查的方向：
- **是否存在另一个不经过 `/api/event/start` 的入口**——比如世界地图页/NPC主页如果有独立的"开始对话"按钮，可能没打这次的补丁。需要先确认这次测试点击的具体入口
- Network面板实测：请求是否真的打到 `/api/event/start`，返回的 `resumed` 字段和 `eventId` 分别是什么值，藉此判断是"没查到旧事件"还是"查到了但前端没正确处理"
- 如果确认查询本身没问题、入口也对，再考虑是不是RLS策略或者Supabase查询本身在Preview环境下有别的限制

---

## 已知但可接受、暂不处理的行为

- **NPC不是每次都先开口**：`event/start` 里开场白生成包在 try/catch 里，AI调用失败（超时/限流/解析失败）会静默退化成"玩家先开口"，事件仍创建成功。想查具体失败原因可以去Vercel Logs搜"生成开场白失败"。这是Phase 4的有意设计（不让开场白失败拖垮整个"开始体验"流程），暂时保留。

---

## 留到下次讨论

1. **续聊逻辑debug**（上面详述，优先级最高，先确认入口和Network返回值）
2. **模型/对话风格调整**：观察到当前NPC对话的表达质量不如直接用Claude聊天——需要讨论是模型选型问题（是否该换更强的模型）、还是system prompt风格设计需要调整（比如是否过于约束、语料不够生动等），值得单独拆开讨论
3. **本地词典查词功能**：上次已确认方向（用kuromoji的`basic_form`辞书形 + jmdict-simplified精简数据），还没开始写。需要先扩展 `KuromojiToken` 类型加入 `basic_form`，再改 `toRubyHtml.ts` 的返回结构（从拼html字符串改成返回token数组），这个改动比furigana本身大，值得单独一次会话专门做
4. **生成新NPC的功能**：目前完全没有，两个NPC是写死在 `lib/npc/registry.ts` 里的静态配置。产品档案里这属于"暂缓"清单，如果现在想启动，需要单独规划（persona设计规范、白名单/校验机制、场景生成如何认识新NPC等）
5. **长对话截断**：上次讨论过 `getTurnsForEvent` 无上限拉全部turns的问题，你说先观察用户平均对话轮数再决定要不要做，此项等数据

---

## 本次改动涉及的文件清单（供下次核对）

- `app/chat/chat-client.tsx`（词块插入、resumed提示条、SUGGEST_CLOSE提示条）
- `app/home/home-client.tsx`（onConfirm签名、resumed参数透传）
- `app/api/event/start/route.ts`（续聊查询逻辑）
- `app/api/chat/route.ts`（suggestClose字段透传）
- `lib/db/events.ts`（新增 `getOpenEventForNpc`）
- `lib/npc/registry.ts`（新增 `defaultParticipantsFor`）
- `lib/context/buildContext.ts`（3条新prompt规则：禁止整句示范、避免达成后空转、SUGGEST_CLOSE标记说明）
- `lib/chat/extractWordChunks.ts`（新增 `suggestClose` 解析）
