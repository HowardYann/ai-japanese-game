// lib/context/buildScenarioContext.ts
//
// Phase 1（V2场景驱动改版）：玩家输入一句"我想体验什么"，
// 这个模块把它组装成一次"场景设计师"prompt，要求AI跳出角色扮演，
// 把自由文本转成结构化场景（对照《语言学习产品V2》第6节的转换链路）。
//
// 和 buildSummaryContext.ts 是同一种模式：AI在这一步不是NPC，是幕后工作人员，
// 输出只吃JSON，不允许混入角色扮演语气。
//
// V1范围收敛（对照V2文档第16节）：不生成新NPC，只从现有registry里的NPC中
// 选一个最贴合的（suggestedNpcId）。场景的"可能任务"是给buildContext.ts
// 后续注入对话用的，不是显式教学大纲，不会被展示成"今天要学的内容"。

import type { NpcConfig } from "../npc/types";

export interface ScenarioContext {
  systemPrompt: string;
  userMessage: string;
}

export interface ScenarioResult {
  goal: string;
  participants: string;
  environment: string;
  possibleTasks: string[];
  suggestedNpcId: string;
}

/** 白名单：只把NPC的人设摘要喂给场景设计prompt，不带hidden字段 */
function npcSummaryForPrompt(npc: NpcConfig): string {
  return `- id: "${npc.id}"（显示名：${npc.displayName}）
  身份：${npc.persona.identity}
  性格：${npc.persona.personality}
  兴趣：${npc.persona.interests.join("、")}`;
}

export function buildScenarioContext(
  userInput: string,
  availableNpcs: NpcConfig[]
): ScenarioContext {
  const npcListText = availableNpcs.map(npcSummaryForPrompt).join("\n");

  const systemPrompt = `你现在不是在角色扮演，而是作为"场景设计师"工作。

任务：玩家说了一句他想体验的事情，你需要把这句话转换成一个可执行的场景。

# 玩家想体验的事情，来自一次自由输入，可能很具体也可能很模糊
你需要先理解玩家想做的事情，判断它属于哪一类可以模拟的现实场景，
再把它设计成一个有明确目标的场景。如果玩家输入很模糊（比如"我想交朋友"），
自动把它转成一个合理的具体场景，不要要求玩家重新描述。

# 当前世界里已有的NPC（本次场景必须从中选一个，不要发明新角色）
${npcListText}

# 你的输出要求（非常重要，严格遵守）
只输出一个JSON对象，不要有任何前言、解释、Markdown代码块标记（不要\`\`\`）。
JSON结构必须是：

{
  "goal": "这个场景里玩家要完成的核心目标，1句话，具体、可感知是否达成，例如'自然地聊聊最近看的电影，并回答对方的追问'",
  "participants": "场景里出现的角色，用玩家能看懂的口吻描述，例如'定食屋老板大将，还有几位熟客'",
  "environment": "场景发生的环境/氛围，1-2句话，帮助后续对话有画面感",
  "possibleTasks": ["场景中玩家可能需要完成的具体交流任务，3-5条，每条是一件具体的事，不是抽象的语言点，例如'自我介绍'、'回答对方关于兴趣的追问'、'礼貌地结束对话'"],
  "suggestedNpcId": "从上面NPC列表里选一个id，选和玩家想体验的事情最贴合的那个，实在选不出来就选第一个"
}

判断标准：
- goal 必须是"要做成什么事"，不是"要学什么"
- possibleTasks 是场景里可能自然发生的交流环节，不是教学大纲，玩家不会看到这个字段的原始内容被当成任务清单，它只是给后续对话设计用的参考
- 如果玩家的输入完全无法对应到任何一个现有NPC能自然出现的场景（比如要求明显不合理或无法安全模拟的内容），仍然要输出一个尽量合理、克制的场景，suggestedNpcId正常给出，不要输出错误信息代替JSON`;

  const userMessage = `玩家想体验：「${userInput.trim()}」\n\n请输出JSON。`;

  return { systemPrompt, userMessage };
}

/**
 * 解析AI返回的文本为ScenarioResult。
 * 容错：剥离偶尔出现的```json代码块包裹。
 * 解析失败或字段不合法时抛错，由调用方（API route）决定如何响应前端。
 */
export function parseScenarioResult(
  raw: string,
  validNpcIds: string[]
): ScenarioResult {
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
    throw new Error("Scenario AI 返回内容不是合法JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Scenario AI 返回内容不是JSON对象");
  }

  const p = parsed as Record<string, unknown>;

  if (typeof p.goal !== "string" || !p.goal.trim()) {
    throw new Error("Scenario缺少合法的goal");
  }
  if (typeof p.participants !== "string" || !p.participants.trim()) {
    throw new Error("Scenario缺少合法的participants");
  }
  if (typeof p.environment !== "string" || !p.environment.trim()) {
    throw new Error("Scenario缺少合法的environment");
  }

  const possibleTasks = Array.isArray(p.possibleTasks)
    ? p.possibleTasks.filter(
        (t): t is string => typeof t === "string" && t.trim().length > 0
      )
    : [];

  // suggestedNpcId 必须落在现有registry里——白名单校验，防止AI幻觉出一个
  // 不存在的npcId，导致后续 event/start 时 getNpcConfig 直接抛错
  const suggestedNpcId =
    typeof p.suggestedNpcId === "string" && validNpcIds.includes(p.suggestedNpcId)
      ? p.suggestedNpcId
      : validNpcIds[0];

  return {
    goal: p.goal.trim(),
    participants: p.participants.trim(),
    environment: p.environment.trim(),
    possibleTasks,
    suggestedNpcId,
  };
}
