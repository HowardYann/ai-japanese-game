// lib/npc/registry.ts
import type { NpcConfig } from "./types";
import { mizuki } from "./data/mizuki";
import { taisho } from "./data/taisho";

const NPC_REGISTRY: Record<string, NpcConfig> = {
  mizuki,
  taisho,
};

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