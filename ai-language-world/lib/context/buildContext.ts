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
  relationship: NpcRelationshipRow
): string {
  const { persona, displayName } = npc; // 注意：没有解构 hidden

  const knownFactsText =
    Object.keys(relationship.known_facts).length > 0
      ? JSON.stringify(relationship.known_facts, null, 2)
      : "（暂无特别记住的事）";

  return `你正在角色扮演一个名叫「${displayName}」的角色，与玩家进行沉浸式日语对话练习。

# 你的人设（严格遵守，不要跳出角色）
- 身份：${persona.identity}
- 性格：${persona.personality}
- 背景：${persona.background}
- 兴趣：${persona.interests.join("、")}
- 说话方式：${persona.speechStyle}

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
改成：把这句话拆成几个可以直接复制的词块，让玩家自己把它们拼成完整的句子。

拆分粒度要按你从对话历史里判断出的玩家水平来定，按"语义单元"切，不是按语法成分切：
- 如果玩家平时说的日语还很简单、或经常需要你纠正基础语法：给的词块本身已经变位好、可以直接抄写排序，
  例如"今日 / 疲れました / けど / 会えて / 嬉しいです"
- 如果玩家已经能比较自如地组织句子：功能词只给辞书形/简体形，让玩家自己变位和接续，
  例如"今日 / 疲れる / けど / 会う / 嬉しい"
- 如果玩家日语已经很流利：只给内容词，语法结构完全交给玩家自己搭，
  例如"疲れ / 会えて / 嬉しい"

不确定玩家水平时，宁可给稍微多帮一点的档位，不要让玩家卡住打不出字来。
词块本身仍然要用角色的语气自然地说出来（比如"嗯……大概会想这么说吧：今日 / 疲れました / けど……"），
不是切换成一个脱离角色的工具界面。`;
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
  newUserMessage: string
): BuiltContext {
  // 格式类指令（组句辅助）随对话变长容易被"稀释"——system prompt本身
  // 已经完整讲过一次规则，这里只在发给AI的最后一条消息前追加一句极简提醒，
  // 每一轮都重新提醒一次，不依赖"AI记得开头说过的话"。
  // 注意：这个提醒只出现在发给Claude的这份拷贝里，appendTurn存的仍然是
  // 玩家的原始输入，不会被这条提醒污染。
  const reinforcedMessage = `[提醒：如果这轮是玩家用中文表达想说的话，按人设里"组句辅助"的规则给词块，别直接给整句翻译]\n${newUserMessage}`;

  return {
    systemPrompt: buildSystemPrompt(npc, relationship),
    messages: [
      ...turnsToMessages(recentTurns),
      { role: "user", content: reinforcedMessage },
    ],
  };
}
