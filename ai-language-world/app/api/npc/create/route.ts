// app/api/npc/create/route.ts
//
// Phase 6：独立创建NPC入口，第2步。玩家在预览页确认（可能编辑过）persona后，
// 这里是真正的持久化关卡——不管上一步/generate那次审核过没过，这里都要重新过一次，
// 因为玩家可能在预览页把内容改成了别的东西，上一次的审核结果不能代表这一次要存的内容。

import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "../../../../lib/supabase/requireUserId";
import { createNpc } from "../../../../lib/db/npcs";
import { enforcePersonaSafety, PersonaRejectedError } from "../../../../lib/npc/enforcePersonaSafety";
import type { NpcPersona } from "../../../../lib/npc/types";

function isValidPersona(p: unknown): p is NpcPersona {
  if (typeof p !== "object" || p === null) return false;
  const obj = p as Record<string, unknown>;
  return (
    typeof obj.identity === "string" &&
    typeof obj.personality === "string" &&
    typeof obj.background === "string" &&
    Array.isArray(obj.interests) &&
    typeof obj.speechStyle === "string" &&
    typeof obj.correctionStyle === "string"
  );
}

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const displayName = body?.displayName;
  const persona = body?.persona;
  // rawInput：玩家最初的自由输入，纯粹是给审核/留底提供上下文，不参与生成逻辑
  const rawInput = typeof body?.rawInput === "string" ? body.rawInput : "";

  if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
    return NextResponse.json({ error: "displayName is required" }, { status: 400 });
  }
  if (!isValidPersona(persona)) {
    return NextResponse.json({ error: "Invalid persona payload" }, { status: 400 });
  }

  try {
    await enforcePersonaSafety({ userId, rawInput, displayName, persona });

    const npc = await createNpc(userId, displayName.trim(), persona, "created");
    return NextResponse.json({ npcId: npc.id });
  } catch (err) {
    if (err instanceof PersonaRejectedError) {
      return NextResponse.json(
        { error: "这个人设暂时无法创建，换个描述试试" },
        { status: 422 }
      );
    }
    console.error("NPC creation failed", err);
    return NextResponse.json({ error: "NPC creation failed" }, { status: 500 });
  }
}
