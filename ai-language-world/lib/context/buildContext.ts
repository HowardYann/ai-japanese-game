// lib/context/buildContext.ts
//
// 这是 Day3-4 的核心：把 "NPC配置 + 关系记录 + 最近对话" 组装成
// 一段 system prompt + 一串 messages，喂给 Claude。
//
// 安全纪律 #3：白名单选字段，不是把整个对象丢进去。
// 所以下面永远是显式地一个个字段拿出来拼，而不是 JSON.stringify(npc) 完事——
// 这样 npc.hidden 永远没有物理可能进入 prompt。

import type { NpcConfig } from "../npc/types";
import type { NpcRelationshipRow } from "../db/types";
import type { ConversationTurnRow } from "../db/types";
import type { EventScenario } from "../db/types";

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface BuiltContext {
  systemPrompt: string;
  messages: ClaudeMessage[];
}

/**
 * 组装system prompt。
 * 只挑 persona 里明确设计给prompt用的字段，绝不整对象展开。
 */
function buildSystemPrompt(
  npc: NpcConfig,
  relationship: NpcRelationshipRow,
  scenario?: EventScenario | null
): string {
  const { persona, displayName } = npc; // 注意：没有解构 hidden

  const knownFactsText =
    Object.keys(relationship.known_facts).length > 0
      ? JSON.stringify(relationship.known_facts, null, 2)
      : "（暂无特别记住的事）";

  // Phase 2（V2场景驱动改版）：如果这场event是从"自由输入场景"生成的，
  // 把场景目标/环境/可能任务作为一层"今天的场景"叠加在NPC人设之上——
  // 不替换角色扮演本身，只是给这次互动一个具体的情境锚点。
  // possibleTasks不是要NPC照本宣科走流程，只是给它一个"这次对话大概会
  // 自然涉及哪些话题"的参考，实际怎么发生完全由对话本身决定。
  const scenarioBlock = scenario
    ? `

# 今天的场景（这次对话的具体情境，务必让对话自然贴合这个场景，而不是泛泛聊天）
- 玩家今天想做的事：${scenario.goal}
- 场景环境：${scenario.environment}
- 参与者：${scenario.participants}
- 对话中可能自然涉及的话题（仅供参考，不要生硬地逐条完成，让它们像真实对话一样自然出现或不出现）：
${scenario.possibleTasks.map((t) => `  - ${t}`).join("\n")}

如果这是这场对话的第一条消息（玩家还没发过话），你的开场要贴合上面的场景环境，
让玩家一进来就有"我正身处这个场景"的感觉，不要用通用的问候语开场。`
    : "";

  return `你正在角色扮演一个名叫「${displayName}」的角色，与玩家进行沉浸式日语对话练习。

# 你的人设（严格遵守，不要跳出角色）
- 身份：${persona.identity}
- 性格：${persona.personality}
- 背景：${persona.background}
- 兴趣：${persona.interests.join("、")}
- 说话方式：${persona.speechStyle}
${scenarioBlock}

# 你和玩家目前的关系
- 关系阶段：${relationship.stage}
- 你记得的事：
${knownFactsText}
- 关系摘要：${relationship.summary || "（你们才刚认识，还没什么共同经历）"}

# 纠错方式（非常重要）
${persona.correctionStyle}

# 核心原则（对照产品设计理念，务必遵守）
1. 【沉浸优先】不要用任何"教学口吻"，不要说"你这句话语法错了"这种话，
   不要弹出括号解释语法。纠正必须自然地发生在角色的台词里。
2. 【体验优先】你在扮演一个真实的人，在经历一段真实的互动，不是在批改作业。
   保持角色的生活感和真实反应，不要每句话都刻意教学。
3. 【关系优先】记得你们之间已经发生过的事，让对话延续这段关系，而不是每次都像初次见面。
4. 用日语回应为主（可以偶尔用简单中文加一两个词辅助理解，但不要大段中文解释）。
5. 每次回应不要太长，像真实对话一样自然、有来有回，不要一次性说一大段。

# 组句辅助（当玩家用中文表达"我想说……"这类意图，而不是直接尝试日语时触发）
玩家有时会先用中文说出自己想表达的意思（比如"我想说，虽然今天很累，但还是很开心能见到你"），
这时候不要直接把整句日语翻译给他——那样他只是在抄写，不是在练习。

你的角色台词部分照常自然回应就好（比如回应他这句话的内容、鼓励他自己试试看），
不要在台词里念出任何具体的日语词块——词块会由前端单独展示成可点击的区块，
不需要你在台词里预告、复述或者用"大概会想这么说吧"这类话引出它们。

词块本身：把玩家想表达的意思拆成几个词块，按你从对话历史里判断出的玩家水平定拆分粒度，
按"语义单元"切，不是按语法成分切：
- 玩家水平还很基础/经常需要你纠正基础语法：给的词块本身已经变位好、可以直接抄写排序，
  例如：今日 / 疲れました / けど / 会えて / 嬉しいです
- 玩家已经能比较自如地组织句子：功能词只给辞书形/简体形，让玩家自己变位和接续，
  例如：今日 / 疲れる / けど / 会う / 嬉しい
- 玩家日语已经很流利：只给内容词，语法结构完全交给玩家自己搭，
  例如：疲れ / 会えて / 嬉しい

不确定玩家水平时，宁可给稍微多帮一点的档位，不要让玩家卡住打不出字来。

技术格式要求（严格遵守，否则前端无法把词块渲染出来）：
触发组句辅助时，在你整条回应的最后单独一行给出词块，格式固定为：
[[CHUNKS: 词块1|词块2|词块3]]
用英文竖线 | 分隔各词块，词块前后不要多余的空格或标点。这一行不是角色台词，
玩家永远不会看到这行原文本身，只会看到你正常的角色台词、以及前端单独渲染出的可点击词块按钮。
如果这一轮没有触发组句辅助，就完全不要输出这一行。`;
}

/**
 * Phase 4：生成"NPC先开口"的开场白用的context。
 * 和 buildChatContext 的区别：没有玩家消息可以回应，是让NPC主动起个头。
 * Claude的messages必须以user角色开头，所以这里用一条"导演提示"当作
 * 唯一的user消息触发NPC开口——这条提示本身不会被存进conversation_turns，
 * 也不会被玩家看到，调用方只应该把AI的回复存成一条npc turn。
 */
export function buildOpeningContext(
  npc: NpcConfig,
  relationship: NpcRelationshipRow,
  scenario?: EventScenario | null
): BuiltContext {
  const directive = scenario
    ? "[导演提示：这场对话刚开始，玩家还没有说任何话。请直接以角色身份说出第一句台词，让开场自然贴合场景设定里的环境和情境，不需要等玩家先开口，也不要在台词里提到这是\"第一句话\"这种元信息。]"
    : "[导演提示：这场对话刚开始，玩家还没有说任何话。请直接以角色身份说出第一句台词，像是你注意到玩家、自然地打了个招呼开启对话，不需要等玩家先开口，也不要在台词里提到这是\"第一句话\"这种元信息。]";

  return {
    systemPrompt: buildSystemPrompt(npc, relationship, scenario),
    messages: [{ role: "user", content: directive }],
  };
}

/** 把DB里的turn记录转成Claude messages格式 */
function turnsToMessages(turns: ConversationTurnRow[]): ClaudeMessage[] {
  return turns.map((t) => ({
    role: t.role === "user" ? "user" : "assistant",
    content: t.content,
  }));
}

/**
 * 组装一次调用Claude所需的完整上下文。
 * @param npc 白名单：只用persona字段
 * @param relationship 白名单：只用 stage/known_facts/summary
 * @param recentTurns 当前event里已经发生的对话（正序）
 * @param newUserMessage 玩家这一轮刚发的消息（还没入库）
 */
export function buildChatContext(
  npc: NpcConfig,
  relationship: NpcRelationshipRow,
  recentTurns: ConversationTurnRow[],
  newUserMessage: string,
  scenario?: EventScenario | null
): BuiltContext {
  // 格式类指令（组句辅助）随对话变长容易被"稀释"——system prompt本身
  // 已经完整讲过一次规则，这里只在发给AI的最后一条消息前追加一句极简提醒，
  // 每一轮都重新提醒一次，不依赖"AI记得开头说过的话"。
  // 注意：这个提醒只出现在发给Claude的这份拷贝里，appendTurn存的仍然是
  // 玩家的原始输入，不会被这条提醒污染。
  const reinforcedMessage = `[提醒：如果这轮是玩家用中文表达想说的话，按人设里"组句辅助"的规则来——台词里别念出具体词块，词块单独放进结尾的[[CHUNKS: 词块1|词块2]]标记行，别直接给整句翻译]\n${newUserMessage}`;

  return {
    systemPrompt: buildSystemPrompt(npc, relationship, scenario),
    messages: [
      ...turnsToMessages(recentTurns),
      { role: "user", content: reinforcedMessage },
    ],
  };
}
