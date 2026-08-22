// app/api/event/start/route.ts
//
// 玩家点击"去找瑞希聊天"时，前端先调这个接口拿到 eventId，
// 再用这个 eventId 去调 /api/chat 发消息。
//
// Phase 1改动：body可以多带一个可选的 scenario 对象——来自
// /api/scenario/generate 的返回结果，玩家在Scenario Preview页确认后，
// 连同（可能被玩家手动改过的）npcId一起传进来。scenario本身不再重新
// 校验内容合法性（信任它是刚从我们自己的生成接口原样传回来的），
// 但npcId仍然照旧走getNpcConfig白名单校验，不因为多了scenario就放松。

import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "../../../../lib/supabase/requireUserId";
import { getNpcConfig } from "../../../../lib/npc/registry";
import { createEvent } from "../../../../lib/db/events";
import { getOrCreateRelationship } from "../../../../lib/db/npcRelationships";
import type { EventScenario } from "../../../../lib/db/types";

function isValidScenario(s: unknown): s is EventScenario {
  if (typeof s !== "object" || s === null) return false;
  const obj = s as Record<string, unknown>;
  return (
    typeof obj.goal === "string" &&
    typeof obj.participants === "string" &&
    typeof obj.environment === "string" &&
    Array.isArray(obj.possibleTasks) &&
    typeof obj.suggestedNpcId === "string"
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
  const npcId = body?.npcId;
  const scenarioInput = body?.scenario;

  if (!npcId || typeof npcId !== "string") {
    return NextResponse.json({ error: "npcId is required" }, { status: 400 });
  }

  try {
    // 校验npcId合法（不存在会抛错）
    getNpcConfig(npcId);
  } catch {
    return NextResponse.json({ error: "Unknown npcId" }, { status: 400 });
  }

  // scenario是可选的——老的"直接选NPC聊天"流程不带这个字段，行为不变
  let scenario: EventScenario | null = null;
  if (scenarioInput !== undefined && scenarioInput !== null) {
    if (!isValidScenario(scenarioInput)) {
      return NextResponse.json({ error: "Invalid scenario payload" }, { status: 400 });
    }
    scenario = scenarioInput;
  }

  try {
    // 确保关系记录存在（首次见面自动初始化）
    await getOrCreateRelationship(userId, npcId);
    const event = await createEvent(userId, npcId, scenario);

    return NextResponse.json({ eventId: event.id, npcId });
  } catch (err) {
    console.error("Failed to start event", err);
    return NextResponse.json(
      { error: "Failed to start event" },
      { status: 500 }
    );
  }
}
