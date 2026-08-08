import { createClient } from "../supabase/server";
import type { NpcRelationshipRow } from "./types";

export async function getRelationship(
  userId: string,
  npcId: string
): Promise<NpcRelationshipRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("npc_relationships")
    .select("user_id, npc_id, stage, known_facts, summary, updated_at")
    .eq("user_id", userId)
    .eq("npc_id", npcId)
    .maybeSingle();

  if (error) throw error;
  return data as NpcRelationshipRow | null;
}

export async function createInitialRelationship(
  userId: string,
  npcId: string
): Promise<NpcRelationshipRow> {
  const supabase = await createClient();
  const initial: Omit<NpcRelationshipRow, "updated_at"> = {
    user_id: userId,
    npc_id: npcId,
    stage: "初识",
    known_facts: {},
    summary: "",
  };

  const { data, error } = await supabase
    .from("npc_relationships")
    .insert(initial)
    .select()
    .single();

  if (error) throw error;
  return data as NpcRelationshipRow;
}

/** 世界档案页用：拿这个用户所有NPC关系记录。安全纪律#1：手动带user_id过滤。 */
export async function listRelationshipsForUser(
  userId: string
): Promise<NpcRelationshipRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("npc_relationships")
    .select("user_id, npc_id, stage, known_facts, summary, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as NpcRelationshipRow[];
}

export async function getOrCreateRelationship(
  userId: string,
  npcId: string
): Promise<NpcRelationshipRow> {
  const existing = await getRelationship(userId, npcId);
  if (existing) return existing;
  return createInitialRelationship(userId, npcId);
}

export async function updateRelationshipSummary(
  userId: string,
  npcId: string,
  update: {
    stage?: string;
    knownFacts?: Record<string, unknown>;
    summary: string;
  }
): Promise<NpcRelationshipRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("npc_relationships")
    .update({
      ...(update.stage ? { stage: update.stage } : {}),
      ...(update.knownFacts ? { known_facts: update.knownFacts } : {}),
      summary: update.summary,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("npc_id", npcId)
    .select()
    .single();

  if (error) throw error;
  return data as NpcRelationshipRow;
}