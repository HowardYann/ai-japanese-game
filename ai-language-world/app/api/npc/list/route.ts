// app/api/npc/list/route.ts
//
// Phase 6.1：home页"你认识的人"分区用——只返回这个用户当前"留着"的
// 动态NPC（status='active'），discarded的不出现（不代表删除，见 lib/db/npcs.ts 注释）。
//
// 只读接口，不做分页/排序参数——listActiveNpcsForUser本身按created_at倒序。

import { NextResponse } from "next/server";
import { requireUserId } from "../../../../lib/supabase/requireUserId";
import { listActiveNpcsForUser } from "../../../../lib/db/npcs";

export async function GET() {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  try {
    const rows = await listActiveNpcsForUser(userId);
    return NextResponse.json({
      npcs: rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        identity: row.identity,
        personality: row.personality,
        interests: row.interests,
        source: row.source,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    console.error("Failed to list npcs", err);
    return NextResponse.json({ error: "Failed to list npcs" }, { status: 500 });
  }
}