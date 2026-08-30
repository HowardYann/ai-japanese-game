// lib/db/moderationFlags.ts
//
// Phase 6：NPC生成审核未通过时的留底记录。
// 故意不提供任何"查自己的flag"的函数——npc_moderation_flags这张表
// 在schema.sql里没有给authenticated角色开select policy，玩家自己的会话
// 查不到这张表任何一行，这里也不写这类函数，避免以后有人顺手加个页面
// 把这个记录展示出来。审核记录只通过邮件通知 + Supabase Dashboard人工查看。

import { createClient } from "../supabase/server";

export async function insertModerationFlag(params: {
  userId: string;
  rawInput: string;
  displayName: string;
  persona: Record<string, unknown>;
  reasons: string[];
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("npc_moderation_flags").insert({
    user_id: params.userId,
    raw_input: params.rawInput,
    display_name: params.displayName,
    persona: params.persona,
    reasons: params.reasons,
  });

  if (error) throw error;
}
