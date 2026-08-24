// lib/npc/registry.ts
import type { NpcConfig } from "./types";
import type { NpcRow } from "../db/types";
import { mizuki } from "./data/mizuki";
import { taisho } from "./data/taisho";

const NPC_REGISTRY: Record<string, NpcConfig> = {
  mizuki,
  taisho,
};

// ---------- 静态内置NPC：同步函数，签名不变 ----------
// 注意：home-client.tsx 是客户端组件，直接同步调用这几个函数渲染NPC选择列表，
// 不能改成异步/接数据库——Phase 6加的动态NPC能力全部走下面新增的
// 异步函数，两边并存，不改动这几个已有调用方。

export function getNpcConfig(npcId: string): NpcConfig {
  const npc = NPC_REGISTRY[npcId];
  if (!npc) {
    throw new Error(`Unknown npcId: ${npcId}`);
  }
  return npc;
}

export function listNpcIds(): string[] {
  return Object.keys(NPC_REGISTRY);
}

/** 世界档案页用：容错版取displayName，NPC配置万一被删掉也不会让页面崩溃 */
export function getNpcDisplayName(npcId: string): string {
  return NPC_REGISTRY[npcId]?.displayName ?? npcId;
}

export function defaultParticipantsFor(npc: NpcConfig): string {
  return `${npc.persona.identity}${npc.displayName}（${npc.displayName}），${npc.persona.personality}`;
}

// ---------- Phase 6：玩家自建/场景涌现的动态NPC ----------
// 这几个函数都要求传userId，且只在服务端调用（event/start、chat、event/close等route）——
// 动态NPC的db查询天然要走owner_id过滤，不可能同步/不可能在客户端安全地做。

function toNpcConfig(row: NpcRow): NpcConfig {
  return {
    id: row.id,
    displayName: row.display_name,
    persona: {
      identity: row.identity,
      personality: row.personality,
      background: row.background,
      interests: row.interests,
      speechStyle: row.speech_style,
      correctionStyle: row.correction_style,
    },
    hidden: {},
    ownerId: row.owner_id,
    source: row.source,
  };
}

/** 静态registry查不到时才去查这个用户名下的动态NPC——
 *  npc_id现在可能是"mizuki"这种固定id，也可能是npcs表里的uuid。
 *  查不到/不是自己的会抛错，跟getOwnedNpc一致，由调用方决定怎么响应。 */
export async function getNpcConfigForUser(npcId: string, userId: string): Promise<NpcConfig> {
  const staticNpc = NPC_REGISTRY[npcId];
  if (staticNpc) return staticNpc;

  // 延迟require，避免给"只用得到静态NPC"的调用路径（比如prompt-playground.ts脚本）
  // 强行拉进supabase server client的依赖
  const { getOwnedNpc } = await import("../db/npcs");
  const row = await getOwnedNpc(npcId, userId);
  return toNpcConfig(row);
}

export async function getNpcDisplayNameForUser(npcId: string, userId: string): Promise<string> {
  const staticNpc = NPC_REGISTRY[npcId];
  if (staticNpc) return staticNpc.displayName;

  try {
    const { getOwnedNpc } = await import("../db/npcs");
    const row = await getOwnedNpc(npcId, userId);
    return row.display_name;
  } catch {
    return npcId;
  }
}