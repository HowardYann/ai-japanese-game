// lib/db/types.ts

export interface NpcRelationshipRow {
  user_id: string;
  npc_id: string;
  stage: string; // '初识' | '熟悉中' | ...
  known_facts: Record<string, unknown>; // 结构化字段，不是自由文本黑箱
  summary: string; // 每次对话结束后整体重新生成并覆盖，不是追加
  updated_at: string;
}

export interface EventRow {
  id: string;
  user_id: string;
  npc_id: string;
  summary: string | null;
  life_collection_title: string | null;
  created_at: string;
}

export interface ConversationTurnRow {
  id: string;
  event_id: string;
  role: "user" | "npc";
  content: string;
  created_at: string;
}
