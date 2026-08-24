// lib/db/npcs.ts
//
// Phase 6：玩家自建 / 场景中AI生成的NPC。跟 events.ts 一样的纪律——
// 每个查询手动带 owner_id 过滤，虽然RLS也会兜底，但两层防御不冲突。
//
// 这些NPC只有创建者自己能聊到（RLS: owner_id = auth.uid()），不做公共目录。
// status='discarded' 不代表删除，只是"不再出现在玩家能看到的列表里"，
// 数据本身留着，理由见 supabase/schema.sql 里 npcs 表的注释。

import { createClient } from "../supabase/server";
import type { NpcRow } from "./types";
import type { NpcPersona } from "../npc/types";

export async function createNpc(
  userId: string,
  displayName: string,
  persona: NpcPersona,
  source: "created" | "emergent"
): Promise<NpcRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("npcs")
    .insert({
      owner_id: userId,
      display_name: displayName,
      identity: persona.identity,
      personality: persona.personality,
      background: persona.background,
      interests: persona.interests,
      speech_style: persona.speechStyle,
      correction_style: persona.correctionStyle,
      source,
      status: "active",
    })
    .select()
    .single();

  if (error) throw error;
  return data as NpcRow;
}

/** 按id+owner查一个NPC，查不到或不是自己的一律当"不存在"处理，不区分这两种情况——
 *  跟 events.ts 的 getOwnedEvent 是同一个防止越权枚举的考虑。 */
export async function getOwnedNpc(npcId: string, userId: string): Promise<NpcRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("npcs")
    .select("*")
    .eq("id", npcId)
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("NPC_NOT_FOUND_OR_NOT_OWNED");
  return data as NpcRow;
}

/** world/home页用：这个用户当前"留着"的自建NPC列表，discarded的不出现。 */
export async function listActiveNpcsForUser(userId: string): Promise<NpcRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("npcs")
    .select("*")
    .eq("owner_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as NpcRow[];
}

/** "收进人物列表" / "算了不留了" 都是这一次update——见product讨论里
 *  "涌现路径默认插入时就是active，不选择收藏=改成discarded"的设计。 */
export async function setNpcStatus(
  npcId: string,
  userId: string,
  status: "active" | "discarded"
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("npcs")
    .update({ status })
    .eq("id", npcId)
    .eq("owner_id", userId);

  if (error) throw error;
}
