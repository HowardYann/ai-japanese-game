// app/api/npc/status/route.ts
//
// Phase 6.1：对话结束后，涌现出的新角色（source==='emergent' && decided===false）
// 玩家要么"留下"（status: 'active'，以后能在/home的"你认识的人"分区、/world档案里看到），
// 要么"不留了"（status: 'discarded'，不再出现在任何列表里，但数据不删）。
//
// 不管选哪个，setNpcStatus都会把decided一起置true——"决定"这个动作本身
// 不区分选了哪一边，见 lib/db/npcs.ts 里的注释。
//
// 归属权校验交给 setNpcStatus 的 owner_id 过滤（连带RLS兜底）：
// 不是自己的npcId会静默update到0行，不会报错也不会影响别人的数据，
// 跟 events.ts 系列"查不到就当不存在"的纪律不完全一样，但效果上一样安全。

import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "../../../../lib/supabase/requireUserId";
import { setNpcStatus } from "../../../../lib/db/npcs";

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const npcId = body?.npcId;
  const status = body?.status;

  if (!npcId || typeof npcId !== "string") {
    return NextResponse.json({ error: "npcId is required" }, { status: 400 });
  }
  if (status !== "active" && status !== "discarded") {
    return NextResponse.json(
      { error: "status must be 'active' or 'discarded'" },
      { status: 400 }
    );
  }

  try {
    await setNpcStatus(npcId, userId, status);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update npc status", err);
    return NextResponse.json({ error: "Failed to update npc status" }, { status: 500 });
  }
}