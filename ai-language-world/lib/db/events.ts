import { createClient } from "../supabase/server";
import type {
  EventRow,
  ConversationTurnRow,
  EventScenario,
  EventFeedback,
  TaskGraph,
  TaskState,
  ActionItem,
} from "./types";

/** Phase 7新增：event创建时，如果scenario带了taskGraph，把它的stages拷贝一份
 *  当作task_state的初始值（当前进度全部未完成，从第一个stage开始）。
 *  没有taskGraph（老流程、纯自由对话、或AI这次没生成出合法stages）时返回null——
 *  这场event就不启用Task State/Action Wheel，不影响其它功能。 */
function initialTaskState(taskGraph: TaskGraph | null | undefined): TaskState | null {
  if (!taskGraph || taskGraph.stages.length === 0) return null;
  return {
    stages: taskGraph.stages,
    completedStageIds: [],
    currentStageId: taskGraph.stages[0].id,
    activeSubTask: null,
    diverged: false,
  };
}
/** 查这个玩家和这个NPC之间，有没有还没关档的event（summary为null）。
 *  用于避免"开始新体验"时又造一个新的待续对话。 */
export async function getOpenEventForNpc(
  userId: string,
  npcId: string
): Promise<EventRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .eq("npc_id", npcId)
    .is("summary", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as EventRow | null;
}

export async function createEvent(
  userId: string,
  npcId: string,
  scenario?: EventScenario | null
): Promise<EventRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .insert({
      user_id: userId,
      npc_id: npcId,
      scenario: scenario ?? null,
      task_state: initialTaskState(scenario?.taskGraph),
    })
    .select()
    .single();

  if (error) throw error;
  return data as EventRow;
}

/** Phase 7新增：每轮对话（包括开场白那一轮）后，把这一轮的task_state和
 *  Action Wheel选项一起写回去——两者总是同时产生、同时使用，合并成一次
 *  更新，不拆成两次单独的DB调用。
 *  taskState/latestActions为null时代表这场event没启用Task State，
 *  正常情况调用方不会在这种event上调这个函数，但调了也只是写成null。 */
export async function updateTaskProgress(
  eventId: string,
  userId: string,
  update: { taskState: TaskState | null; latestActions: ActionItem[] | null }
): Promise<void> {
  await getOwnedEvent(eventId, userId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("events")
    .update({ task_state: update.taskState, latest_actions: update.latestActions })
    .eq("id", eventId)
    .eq("user_id", userId);

  if (error) throw error;
}

/** 世界档案页用：拿这个用户所有事件（时间线用）。安全纪律#1：手动带user_id过滤。 */
export async function listEventsForUser(userId: string): Promise<EventRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as EventRow[];
}

export async function getOwnedEvent(
  eventId: string,
  userId: string
): Promise<EventRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("EVENT_NOT_FOUND_OR_NOT_OWNED");
  return data as EventRow;
}

export async function getTurnsForEvent(
  eventId: string,
  userId: string
): Promise<ConversationTurnRow[]> {
  await getOwnedEvent(eventId, userId);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversation_turns")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ConversationTurnRow[];
}

export async function appendTurn(
  eventId: string,
  userId: string,
  role: "user" | "npc",
  content: string
): Promise<ConversationTurnRow> {
  await getOwnedEvent(eventId, userId);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversation_turns")
    .insert({ event_id: eventId, role, content })
    .select()
    .single();

  if (error) throw error;
  return data as ConversationTurnRow;
}

/**
 * 关档时清空这场事件的原始逐字对话。
 * 设计取舍：summary/relationship已经把这次经历浓缩记录下来了，
 * 原始文本从关档那一刻起就是纯冗余——不长期留存，
 * 一是控制存储量随用户量增长的速度，二是尊重玩家隐私（不留永久聊天记录）。
 * 只在事件还"进行中"（未关档）时才需要turns：当context给AI用、或支持续聊。
 */
export async function deleteTurnsForEvent(
  eventId: string,
  userId: string
): Promise<void> {
  await getOwnedEvent(eventId, userId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("conversation_turns")
    .delete()
    .eq("event_id", eventId);

  if (error) throw error;
}

export async function closeEvent(
  eventId: string,
  userId: string,
  summary: {
    text: string;
    lifeCollectionTitle?: string | null;
    languageObservations?: unknown[];
    feedback?: EventFeedback | null;
  }
): Promise<EventRow> {
  await getOwnedEvent(eventId, userId);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .update({
      summary: summary.text,
      life_collection_title: summary.lifeCollectionTitle ?? null,
      language_observations: summary.languageObservations ?? [],
      feedback: summary.feedback ?? null,
    })
    .eq("id", eventId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw error;
  return data as EventRow;
}
