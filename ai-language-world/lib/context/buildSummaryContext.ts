// lib/context/buildSummaryContext.ts
//
// Day5-6：对话结束后，把这一场event的完整turns + NPC人设 + 关系旧状态
// 组装成一次"总结用"的prompt，喂给AI，要求它只输出结构化JSON。
//
// 和 buildChatContext 的区别：
//   - buildChatContext 是"演角色"，输出是角色台词（纯文本）
//   - buildSummaryContext 是"写档案"，输出是给后端消费的结构化数据（JSON），
//     绝不能混进角色扮演语气，所以系统提示词的角色完全不同——
//     这里明确让AI跳出NPC身份，作为"记录者"工作。
//
// 安全纪律 #3 延续：仍然是白名单取字段，不整对象塞入prompt。

import type { NpcConfig } from "../npc/types";
import type { NpcRelationshipRow, ConversationTurnRow } from "../db/types";

export interface SummaryContext {
  systemPrompt: string;
  userMessage: string;
}

/** AI应该返回的JSON结构（后端解析后使用） */
export interface SummaryResult {
  eventSummary: string;
  relationshipSummary: string;
  relationshipStage: "初识" | "熟悉中" | "熟悉" | "亲近";
  knownFacts: Record<string, string>;
  lifeCollectionTitle: string | null;
}

const VALID_STAGES = ["初识", "熟悉中", "熟悉", "亲近"] as const;

export function isValidStage(
  s: unknown
): s is SummaryResult["relationshipStage"] {
  return typeof s === "string" && (VALID_STAGES as readonly string[]).includes(s);
}

function turnsToTranscript(turns: ConversationTurnRow[]): string {
  if (turns.length === 0) return "（这场对话还没有任何往来，可能玩家还没发过消息）";
  return turns
    .map((t) => `${t.role === "user" ? "玩家" : "NPC"}：${t.content}`)
    .join("\n");
}

export function buildSummaryContext(
  npc: NpcConfig,
  relationship: NpcRelationshipRow,
  turns: ConversationTurnRow[]
): SummaryContext {
  const { persona, displayName } = npc; // 白名单：不解构hidden

  const knownFactsText =
    Object.keys(relationship.known_facts).length > 0
      ? JSON.stringify(relationship.known_facts, null, 2)
      : "{}";

  const systemPrompt = `你现在不是在角色扮演，而是作为一个"世界档案记录者"工作。
任务：阅读玩家和NPC「${displayName}」刚刚结束的一场对话，输出结构化总结。

# NPC背景（帮助你判断对话中哪些内容重要）
- 身份：${persona.identity}
- 性格：${persona.personality}

# 这段关系目前的存量状态（对话开始前）
- 关系阶段：${relationship.stage}
- 已记住的事：${knownFactsText}
- 关系摘要（旧）：${relationship.summary || "（还没有共同经历）"}

# 你的输出要求（非常重要，严格遵守）
只输出一个JSON对象，不要有任何前言、解释、Markdown代码块标记（不要\`\`\`）。
JSON结构必须是：

{
  "eventSummary": "用第三人称、1-2句话客观描述这次对话发生了什么，给玩家看的事件时间线用",
  "relationshipSummary": "整体重写关系摘要，合并旧摘要和这次新发生的内容，2-4句话，不是追加而是覆盖式重写",
  "relationshipStage": "初识 | 熟悉中 | 熟悉 | 亲近 中的一个（根据对话质量和次数判断是否该推进，不确定就保持不变）",
  "knownFacts": { "键": "值", "...": "..." }，把旧的known_facts和这次新透露的事合并成的最新版本（键用简短的中文短语，比如"日语自学方法"，值是具体内容；没有新增就原样返回旧的）,
  "lifeCollectionTitle": "如果这次对话有一个值得被记住的高光时刻（比如约定了下次做什么、一次真诚的情感交流、一个有意思的转折），给它起一个简短有生活感的标题（8-16字），像日记标题那样；如果只是普通闲聊没有特别值得记住的瞬间，返回 null"
}

判断标准：
- lifeCollectionTitle 不需要每次都有，普通寒暄对话应该返回 null，不要为了有而硬造
- relationshipStage 的推进要谨慎，一两次对话不足以从"初识"跳到"熟悉"
- 如果对话内容很短（比如玩家只发了一两条消息就结束），仍然要正常输出JSON，eventSummary可以如实反映"简短的互动"`;

  const userMessage = `这是完整对话记录：\n\n${turnsToTranscript(turns)}\n\n请输出JSON。`;

  return { systemPrompt, userMessage };
}

/**
 * 解析AI返回的文本为SummaryResult。
 * 容错：AI偶尔会不听话地包一层```json代码块，这里做兜底剥离。
 * 解析失败或字段不合法时抛错，由调用方决定fallback策略。
 */
export function parseSummaryResult(raw: string): SummaryResult {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Summary AI 返回内容不是合法JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Summary AI 返回内容不是JSON对象");
  }

  const p = parsed as Record<string, unknown>;

  if (typeof p.eventSummary !== "string" || !p.eventSummary.trim()) {
    throw new Error("Summary缺少合法的eventSummary");
  }
  if (typeof p.relationshipSummary !== "string" || !p.relationshipSummary.trim()) {
    throw new Error("Summary缺少合法的relationshipSummary");
  }
  if (!isValidStage(p.relationshipStage)) {
    throw new Error("Summary返回了非法的relationshipStage");
  }
  if (typeof p.knownFacts !== "object" || p.knownFacts === null || Array.isArray(p.knownFacts)) {
    throw new Error("Summary缺少合法的knownFacts");
  }

  const lifeCollectionTitle =
    typeof p.lifeCollectionTitle === "string" && p.lifeCollectionTitle.trim()
      ? p.lifeCollectionTitle.trim()
      : null;

  return {
    eventSummary: p.eventSummary.trim(),
    relationshipSummary: p.relationshipSummary.trim(),
    relationshipStage: p.relationshipStage,
    knownFacts: p.knownFacts as Record<string, string>,
    lifeCollectionTitle,
  };
}
