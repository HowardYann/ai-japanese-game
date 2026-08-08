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
5. 每次回应不要太长，像真实对话一样自然、有来有回，不要一次性说一大段。`;
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
  return {
    systemPrompt: buildSystemPrompt(npc, relationship),
    messages: [
      ...turnsToMessages(recentTurns),
      { role: "user", content: newUserMessage },
    ],
  };
}
