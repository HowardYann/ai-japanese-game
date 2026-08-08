// app/api/event/start/route.ts
//
// 玩家点击"去找瑞希聊天"时，前端先调这个接口拿到 eventId，
// 再用这个 eventId 去调 /api/chat 发消息。

import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "../../../../lib/supabase/requireUserId";
import { getNpcConfig } from "../../../../lib/npc/registry";
import { createEvent } from "../../../../lib/db/events";
import { getOrCreateRelationship } from "../../../../lib/db/npcRelationships";

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const npcId = body?.npcId;
  if (!npcId || typeof npcId !== "string") {
    return NextResponse.json({ error: "npcId is required" }, { status: 400 });
  }

  try {
    // 校验npcId合法（不存在会抛错）
    getNpcConfig(npcId);
  } catch {
    return NextResponse.json({ error: "Unknown npcId" }, { status: 400 });
  }

  try {
    // 确保关系记录存在（首次见面自动初始化）
    await getOrCreateRelationship(userId, npcId);
    const event = await createEvent(userId, npcId);

    return NextResponse.json({ eventId: event.id, npcId });
  } catch (err) {
    console.error("Failed to start event", err);
    return NextResponse.json(
      { error: "Failed to start event" },
      { status: 500 }
    );
  }
}
