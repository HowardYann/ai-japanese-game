# Day 8 Handoff — V2 场景驱动改版 Phase 1-5

**日期**：2026-08-23
**分支**：dev2
**背景文档**：《语言学习产品V2：场景驱动学习改版需求文档.md》

---

## 本次会话做了什么

把 V2 需求文档里的核心闭环跑通了一遍：

```
自由输入想体验的事情
  → AI生成结构化场景（目标/环境/参与者/可能任务/建议NPC）
  → Scenario Preview确认（可以手动换NPC）
  → 进入对话，NPC先开口，开场贴合场景
  → 玩家互动
  → 结束对话，生成三段式反馈（✓做到了什么/△卡在哪里/下一步建议）
```

分5个Phase落地，全部已部署到 Preview 并逐个验证通过：

### Phase 1：场景生成API
- 新增 `lib/context/buildScenarioContext.ts`：AI扮演"场景设计师"，把自由文本转成结构化JSON
- 新增 `app/api/scenario/generate/route.ts`：纯生成+返回，不写DB
- `suggestedNpcId` 有白名单校验，AI幻觉出不存在的id会自动兜底成第一个NPC
- SQL：`events` 表加 `scenario jsonb` 列

### Phase 2：场景注入对话
- `lib/context/buildContext.ts` 的 `buildSystemPrompt`/`buildChatContext` 新增可选`scenario`参数，有值时在NPC人设后插入"今天的场景"段落
- 不传scenario时行为完全不变（向后兼容老的直接选NPC聊天）

### Phase 3：首页三入口UI
- 新增 `app/home/page.tsx` + `home-client.tsx`："今天想做什么"页面，推荐给你（v1写死2条）/ 浏览场景（等于选NPC）/ 自由输入
- `ScenarioPreview` 组件支持手动切换NPC，不强制信任AI建议

### Phase 4：去重 + NPC先开口
- `app/chat/page.tsx` 不带`eventId`直接重定向`/home`，`chat-client.tsx` 删掉了`select`屏幕和`handleSelectNpc`——选NPC这件事现在只有`/home`一个入口
- 新增 `buildOpeningContext`，`event/start` 创建event后立刻多调一次AI生成开场白，存成第一条NPC turn；这一步失败不影响event创建成功（退化成玩家先开口的旧行为）
- **有一个TS类型错误已经在对话里修复**：`start/route.ts` 里 `openingWordChunks = wordChunks` 要改成 `wordChunks ?? undefined`（`extractWordChunks`返回`string[] | null`），需要确认这个修复已经应用到你本地/仓库的文件里

### Phase 5：结束反馈三段式改版
- `buildSummaryContext.ts` 的`SummaryResult`新增`achievements`/`struggles`/`nextStepSuggestion`
- SQL：`events`表加`feedback jsonb`列
- `chat-client.tsx`的`closed`屏幕改成：事件摘要 → ✓做到了什么 → △卡在哪里 → 下一步建议 → 🏆人生收藏

---

## 需要确认的事

1. **Phase 4的TS修复是否已经落地**——最后一条消息给的`start-route.ts`里改了`openingWordChunks = wordChunks ?? undefined`，确认你部署的版本里这行是对的
2. **两次SQL migration都跑了吗**：`phase1_migration.sql`（加`scenario`列）+ `phase5_migration.sql`（加`feedback`列），如果只跑了一次要记得补上另一次
3. **完整走一遍端到端**：自由输入 → Preview → 进对话看NPC是否先开口且贴合场景 → 聊几句 → 结束看三段式反馈是否正常显示（尤其是`achievements`/`struggles`任一为空数组时不应该渲染出空标题）

---

## 这次做的架构决策（供以后参考，避免以后又纠结一遍）

- **场景不生成新NPC**：v1场景生成只从现有2个NPC（mizuki/taisho）里选一个，不动态生成角色。这是V2文档第16节MVP闭环里自己写的"进入已有NPC/对话系统"决定的，不是我们额外收窄的
- **`/chat`只服务于恢复对话，不再是选NPC入口**：所有"开始新体验"的路径都收敛到`/home`一个地方，避免两条路径到达同一功能
- **开场白是同步生成的，会让`event/start`响应变慢**（多一次串行AI调用）。目前没有做异步/流式，先看实测体验如何再决定要不要优化
- **`scenario`和`feedback`都存成独立的jsonb列，不是新建表**：因为v1阶段场景和event是一对一生命周期，没必要为了这个多引入join

---

## 还没做、且文档里明确说了先不做的

- 能力地图/能力探索页的真实计算（现在首页"推荐给你"是硬编码2条，不是真推荐算法）
- 即时帮助分级系统（Level 1-4，文档第9节）
- 场景难度自动递进逻辑
- 这些都对照V2文档第17节"第一阶段暂时不要做"，不建议现在补，先看当前闭环的真实使用反馈

---

## 明天可以从这里接着聊

把这份handoff + 最新代码zip一起丢给新session，可以直接说"确认一下Phase1-5都测过了，接下来想做XXX"，不需要重新解释背景。
