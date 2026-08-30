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

/** 单条语言观察——原始行为记录，不是打分。assistLevel/operation这些标签
 *  是为将来的水平聚合分析准备的最小必要metadata，现在只负责如实记录。 */
export interface LanguageObservation {
  item: string; // 具体语言元素，自由字符串，如"〜てもいいですか"
  category: "vocabulary" | "expression" | "grammar";
  assistLevel: "unassisted" | "scaffolded" | "corrected";
  operation:
    | "comprehension"
    | "inference"
    | "formulation"
    | "interaction"
    | "repair"
    | "adaptation"
    | null;
  outcome: "success" | "partial" | "repair_needed";
}

/** AI应该返回的JSON结构（后端解析后使用） */
export interface SummaryResult {
  eventSummary: string;
  /** Phase 5：三段式反馈，对照V2文档第10节，替代"学了几个词/几个语法"这种展示方式 */
  achievements: string[]; // ✓ 做到了什么
  struggles: string[]; // △ 卡在哪里
  nextStepSuggestion: string; // 下一步建议
  relationshipSummary: string;
  relationshipStage: "初识" | "熟悉中" | "熟悉" | "亲近";
  knownFacts: Record<string, string>;
  lifeCollectionTitle: string | null;
  languageObservations: LanguageObservation[];
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
  const nameNote = relationship.known_facts.playerName
  ? `你已经知道玩家叫"${relationship.known_facts.playerName}"。`
  : `你还不知道玩家的名字（如果对话自然进行到合适的时机，可以礼貌地问一下，但不要生硬地一上来就问）。`;
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
  "achievements": ["玩家这场对话里真正做到的具体事情，用玩家能看懂的第二人称口吻，2-4条，例如'能够自然介绍自己最近看的电影'、'能听懂对方的追问并给出相关的回应'；只写观察到的、玩家自己完成的事，不要泛泛地写'完成了一次对话'这种空话，如果这场对话确实很短、几乎没有做成什么，可以只给1条或者如实写'完成了简短的自我介绍'这种小事，不要为了凑数量夸大"],
  "struggles": ["玩家这场对话里卡住、或者需要NPC纠正/帮助才能继续的地方，用玩家能看懂的第二人称口吻，1-3条，例如'当对方突然追问细节时，很难继续展开'、'不确定该怎么礼貌地转移话题'；如果这场对话玩家表现很顺畅没有明显卡点，返回空数组[]，不要硬造"],
  "nextStepSuggestion": "基于这场对话的表现，给玩家一个具体的、稍微进一步的下一步挑战建议，1句话，例如'下次可以试着和一个刚认识的人聊10分钟，并主动提出两个问题'；要具体到'做什么事'，不是'多练习口语'这种空泛建议",
  "relationshipSummary": "整体重写关系摘要，合并旧摘要和这次新发生的内容，2-4句话，不是追加而是覆盖式重写",
  "relationshipStage": "初识 | 熟悉中 | 熟悉 | 亲近 中的一个（根据对话质量和次数判断是否该推进，不确定就保持不变）",
  "knownFacts": { "键": "值", "...": "..." }，把旧的known_facts和这次新透露的事合并成的最新版本（键用简短的中文短语，比如"日语自学方法"，值是具体内容；没有新增就原样返回旧的）,
  "lifeCollectionTitle": "如果这次对话有一个值得被记住的高光时刻（比如约定了下次做什么、一次真诚的情感交流、一个有意思的转折），给它起一个简短有生活感的标题（8-16字），像日记标题那样；如果只是普通闲聊没有特别值得记住的瞬间，返回 null",
  "languageObservations": [
    {
      "item": "具体的词汇/表达/语法，比如「〜てもいいですか」",
      "category": "vocabulary | expression | grammar 中的一个",
      "assistLevel": "unassisted（玩家自己独立说出/写出，没有任何提示辅助） | scaffolded（玩家是拼接/复用了对话中出现过的词块或例句） | corrected（玩家说错了，是NPC纠正后玩家才用对的）中的一个",
      "operation": "这次使用主要体现了玩家哪种沟通能力，从 comprehension（理解输入）| inference（靠已知推断未知）| formulation（用已有资源表达意图）| interaction（根据对方反馈调整）| repair（沟通卡住后主动修复，比如请求重复/换种说法/确认理解）| adaptation（根据场合调整表达方式）中选一个最贴切的，如果这条只是单纯记录\"用了某个词\"看不出体现了哪种能力，返回 null",
      "outcome": "success | partial | repair_needed 中的一个"
    }
  ]
}

判断标准：
- achievements/struggles 要基于对话记录里真实发生的事，不要脱离对话内容泛泛而谈；如果languageObservations里有unassisted的用法，通常对应achievements；有corrected/scaffolded的用法，通常对应struggles，但不是机械映射，用你对整场对话的理解来写
- nextStepSuggestion 要衔接这次的表现，是"往前一小步"，不是重新开始或者跳跃太大
- lifeCollectionTitle 不需要每次都有，普通寒暄对话应该返回 null，不要为了有而硬造
- relationshipStage 的推进要谨慎，一两次对话不足以从"初识"跳到"熟悉"
- 如果对话内容很短（比如玩家只发了一两条消息就结束），仍然要正常输出JSON，eventSummary可以如实反映"简短的互动"
- languageObservations 只记录这场对话里真实观察到的、值得注意的语言使用瞬间（不需要覆盖每一句话），没有明显值得记录的就返回空数组 []；重点标注清楚assistLevel——尤其要分清楚"玩家自己独立说出来的"和"玩家只是复用/拼接了对话里已经出现过的表达"这两种情况，这个区分对后续的水平判断非常关键，不要为了图省事把scaffolded的用法标成unassisted`;

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

  // achievements/struggles：单条格式不对就丢弃，不因为这个字段的瑕疵让整个总结失败
  const achievements = Array.isArray(p.achievements)
    ? p.achievements.filter(
        (a): a is string => typeof a === "string" && a.trim().length > 0
      )
    : [];
  const struggles = Array.isArray(p.struggles)
    ? p.struggles.filter(
        (s): s is string => typeof s === "string" && s.trim().length > 0
      )
    : [];
  const nextStepSuggestion =
    typeof p.nextStepSuggestion === "string" ? p.nextStepSuggestion.trim() : "";

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

  // languageObservations是增量的学习信号，不是关档能不能成功的必要条件——
  // 单条格式不对就丢弃那一条，不因为这个字段的瑕疵让整个总结失败
  const VALID_CATEGORIES = ["vocabulary", "expression", "grammar"];
  const VALID_ASSIST_LEVELS = ["unassisted", "scaffolded", "corrected"];
  const VALID_OPERATIONS = [
    "comprehension",
    "inference",
    "formulation",
    "interaction",
    "repair",
    "adaptation",
  ];
  const VALID_OUTCOMES = ["success", "partial", "repair_needed"];

  const languageObservations: LanguageObservation[] = Array.isArray(
    p.languageObservations
  )
    ? p.languageObservations.filter((o): o is LanguageObservation => {
        if (typeof o !== "object" || o === null) return false;
        const obs = o as Record<string, unknown>;
        return (
          typeof obs.item === "string" &&
          obs.item.trim().length > 0 &&
          VALID_CATEGORIES.includes(obs.category as string) &&
          VALID_ASSIST_LEVELS.includes(obs.assistLevel as string) &&
          (obs.operation === null || VALID_OPERATIONS.includes(obs.operation as string)) &&
          VALID_OUTCOMES.includes(obs.outcome as string)
        );
      })
    : [];

  return {
    eventSummary: p.eventSummary.trim(),
    achievements,
    struggles,
    nextStepSuggestion,
    relationshipSummary: p.relationshipSummary.trim(),
    relationshipStage: p.relationshipStage,
    knownFacts: p.knownFacts as Record<string, string>,
    lifeCollectionTitle,
    languageObservations,
  };
}
