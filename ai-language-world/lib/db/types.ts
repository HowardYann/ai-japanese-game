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

/** Phase 7新增：场景开始时生成的"初始参考路径"，见
 *  lib/context/buildScenarioContext.ts。这不是必须走完的任务清单，
 *  只是给AI一个"接下来大概率会发生什么"的骨架——真正随对话演化的
 *  是 events.task_state 里的 stages（初始值是这里的拷贝，但可以被
 *  AI在每轮对话里覆写，见 TaskState 的注释）。 */
export interface TaskStage {
  id: string;
  label: string;
  /** true=主线节点（比如"结账"），false=可选节点（比如"决定要不要袋子"）。
   *  只是给AI生成Action Wheel时的参考权重，不是前端强制校验的字段。 */
  required: boolean;
}

export interface TaskGraph {
  mainGoal: string;
  stages: TaskStage[];
}

/** Phase 7新增：一场event当前实际生效的任务进度。
 *  stages 初始 = scenario.taskGraph.stages 的拷贝，但如果玩家的行为让
 *  这段经历走向了不同方向，AI可以在STATE更新里整体替换这个数组——
 *  taskGraph本身（存在scenario里）永远不变，代表"最初的设想"；
 *  task_state.stages 代表"实际正在发生的路径"，两者允许不一致。 */
export interface TaskState {
  stages: TaskStage[];
  completedStageIds: string[];
  currentStageId: string | null;
  /** 玩家临时岔开主线但会自然回归的小事，比如"确认能不能用Suica付款"。
   *  非null时，Action Wheel应该优先展示跟这件事相关的行动。 */
  activeSubTask: string | null;
  /** true表示这场对话已经不再按最初的taskGraph走——不是失败信号，
   *  只是给后续summary/人生收藏用的一个参考标记。 */
  diverged: boolean;
}

/** Phase 1新增：场景生成结果，见 lib/context/buildScenarioContext.ts 的 ScenarioResult。
 *  没有走场景生成流程的event（比如直接选NPC聊天）这一列是 null。
 *  Phase 6：suggestedNpcId 在 needsNewNpc=true 时是 null，此时看 newNpcDraft。
 *  Phase 7：taskGraph 在场景生成失败/解析不出合法stages时可能是 null——
 *  这种情况下这场event不启用Task State/Action Wheel，退回纯自由对话
 *  （不影响其它字段照常工作，是优雅降级，不是硬性依赖）。 */
export interface EventScenario {
  goal: string;
  participants: string;
  environment: string;
  possibleTasks: string[];
  suggestedNpcId: string | null;
  needsNewNpc: boolean;
  newNpcDraft: NewNpcDraft | null;
  taskGraph: TaskGraph | null;
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

/** Phase 7新增：Action Wheel的单个行动选项，见
 *  lib/chat/extractActions.ts 的 ActionItem。 */
export interface ActionItem {
  label: string;
  phrase: string;
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
  /** Phase 7新增：见 TaskState 注释。scenario.taskGraph为null，
   *  或者scenario本身为null（老流程/直接选NPC聊天）时，这一列也是null。 */
  task_state: TaskState | null;
  /** Phase 7新增：最近一条NPC消息对应的Action Wheel选项，用于刷新页面/
   *  续聊时也能展示当前可采取的行动，不需要玩家先发一条消息才看到按钮。
   *  每轮对话整体覆盖，不是追加历史。 */
  latest_actions: ActionItem[] | null;
  created_at: string;
}

export interface ConversationTurnRow {
  id: string;
  event_id: string;
  role: "user" | "npc";
  content: string;
  created_at: string;
}


export interface FeedbackRow {
  id: string;
  user_id: string | null;
  page_path: string;
  content: string;
  created_at: string;
}