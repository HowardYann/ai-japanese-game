import { createClient } from "../supabase/server";
import type { EventRow, ConversationTurnRow } from "./types";

export async function createEvent(
  userId: string,
  npcId: string
): Promise<EventRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .insert({ user_id: userId, npc_id: npcId })
    .select()
    .single();

  if (error) throw error;
  return data as EventRow;
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

export async function closeEvent(
  eventId: string,
  userId: string,
  summary: {
    text: string;
    lifeCollectionTitle?: string | null;
  }
): Promise<EventRow> {
  await getOwnedEvent(eventId, userId);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .update({
      summary: summary.text,
      life_collection_title: summary.lifeCollectionTitle ?? null,
    })
    .eq("id", eventId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw error;
  return data as EventRow;
}