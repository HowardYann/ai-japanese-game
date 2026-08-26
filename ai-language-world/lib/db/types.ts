// lib/db/types.ts

export interface NpcRelationshipRow {
  user_id: string;
  npc_id: string;
  stage: string; // '初识' | '熟悉中' | ...
  known_facts: Record<string, unknown>; // 结构化字段，不是自由文本黑箱
  summary: string; // 每次对话结束后整体重新生成并覆盖，不是追加
  updated_at: string;
}

/** Phase 6新增：场景设计师判断"现有NPC都不合适"时，顺手生成的一份新角色草案。
 *  只在 needsNewNpc 为 true 时非null。字段和 NpcPersona 保持一致，
 *  但这里不直接 import NpcPersona 类型，避免 db/types.ts 反向依赖 npc/types.ts。 */
export interface NewNpcDraft {
  displayName: string;
  identity: string;
  personality: string;
  background: string;
  interests: string[];
  speechStyle: string;
  correctionStyle: string;
}

/** Phase 1新增：场景生成结果，见 lib/context/buildScenarioContext.ts 的 ScenarioResult。
 *  没有走场景生成流程的event（比如直接选NPC聊天）这一列是 null。
 *  Phase 6：suggestedNpcId 在 needsNewNpc=true 时是 null，此时看 newNpcDraft。 */
export interface EventScenario {
  goal: string;
  participants: string;
  environment: string;
  possibleTasks: string[];
  suggestedNpcId: string | null;
  needsNewNpc: boolean;
  newNpcDraft: NewNpcDraft | null;
}

/** Phase 6新增：npcs表一行——玩家自己创建、或对话场景中AI生成的NPC。
 *  status='discarded' 的行不会出现在任何"当前可聊"的列表里，但数据不删，
 *  留作以后可能恢复/统计用。 */
export interface NpcRow {
  id: string;
  owner_id: string;
  display_name: string;
  identity: string;
  personality: string;
  background: string;
  interests: string[];
  speech_style: string;
  correction_style: string;
  source: "created" | "emergent";
  status: "active" | "discarded";
  /** 'created'路径插入时=true；'emergent'路径插入时=false，
   *  玩家在对话结束后选"留下/不留了"之后由 setNpcStatus 置为 true。 */
  decided: boolean;
  created_at: string;
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