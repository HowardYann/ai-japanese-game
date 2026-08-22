// lib/db/types.ts

export interface NpcRelationshipRow {
  user_id: string;
  npc_id: string;
  stage: string; // '初识' | '熟悉中' | ...
  known_facts: Record<string, unknown>; // 结构化字段，不是自由文本黑箱
  summary: string; // 每次对话结束后整体重新生成并覆盖，不是追加
  updated_at: string;
}

/** Phase 1新增：场景生成结果，见 lib/context/buildScenarioContext.ts 的 ScenarioResult。
 *  没有走场景生成流程的event（比如直接选NPC聊天）这一列是 null。 */
export interface EventScenario {
  goal: string;
  participants: string;
  environment: string;
  possibleTasks: string[];
  suggestedNpcId: string;
}

/** Phase 5新增：结束时的三段式反馈，见 buildSummaryContext.ts 的 SummaryResult。
 *  走了降级兜底路径的event，这一列是 null。 */
export interface EventFeedback {
  achievements: string[];
  struggles: string[];
  nextStepSuggestion: string;
}

export interface EventRow {
  id: string;
  user_id: string;
  npc_id: string;
  summary: string | null;
  life_collection_title: string | null;
  language_observations: unknown[];
  scenario: EventScenario | null;
  feedback: EventFeedback | null;
  created_at: string;
}

export interface ConversationTurnRow {
  id: string;
  event_id: string;
  role: "user" | "npc";
  content: string;
  created_at: string;
}
