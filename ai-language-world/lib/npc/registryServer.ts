// lib/npc/registryServer.ts
//
// 服务端专用：静态registry查不到时，查这个用户名下的动态NPC。
// 这个文件绝对不能被任何 "use client" 组件（home-client.tsx、chat-client.tsx等）
// 直接或间接 import——哪怕是 await import() 动态引入也不行，因为 webpack 仍会把
// 目标模块解析进客户端构建图，next/headers 出现在客户端bundle里就会在build时报错：
// "You're importing a module that depends on next/headers... only available in
// Server Components"。
//
// 之前的做法是把这两个函数塞进 lib/npc/registry.ts 里、用 await import("../db/npcs")
// "延迟加载"，以为这样能避免污染客户端bundle——这个假设是错的：动态import只是切chunk，
// 不代表这条依赖链不会被客户端编译器看到。registry.ts 本身被 home-client.tsx/
// chat-client.tsx 引用，链路一旦存在就会被打包分析到。
//
// 拆成独立文件后，只有服务端route（event/start、event/close、chat等）import这个文件，
// registry.ts 保持纯同步、客户端安全。

import type { NpcConfig } from "./types";
import type { NpcRow } from "../db/types";
import { getNpcConfig as getStaticNpcConfig, getNpcDisplayName as getStaticNpcDisplayName, listNpcIds } from "./registry";
import { getOwnedNpc } from "../db/npcs";

const STATIC_NPC_IDS = new Set(listNpcIds());

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
    decided: row.decided,
  };
}

/** 静态registry查不到时才去查这个用户名下的动态NPC——
 *  npc_id现在可能是"mizuki"这种固定id，也可能是npcs表里的uuid。
 *  查不到/不是自己的会抛错，由调用方决定怎么响应。 */
export async function getNpcConfigForUser(npcId: string, userId: string): Promise<NpcConfig> {
  if (STATIC_NPC_IDS.has(npcId)) {
    return getStaticNpcConfig(npcId);
  }

  const row = await getOwnedNpc(npcId, userId);
  return toNpcConfig(row);
}

export async function getNpcDisplayNameForUser(npcId: string, userId: string): Promise<string> {
  if (STATIC_NPC_IDS.has(npcId)) {
    return getStaticNpcDisplayName(npcId);
  }

  try {
    const row = await getOwnedNpc(npcId, userId);
    return row.display_name;
  } catch {
    return npcId;
  }
}