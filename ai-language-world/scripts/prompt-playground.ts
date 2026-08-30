// scripts/prompt-playground.ts
//
// 改prompt不想每次走"改代码 -> commit -> deploy -> 登录 -> 手动点"这套流程时用这个。
// 直接在终端里跟NPC聊天，改完 lib/context/buildContext.ts 存盘、重启这个脚本
// 就能看到新prompt的效果——不碰Next.js、不碰登录、不碰数据库，
// 就是单纯调 buildChatContext + callClaude 这两个函数。
//
// 用法：
//   npm run prompt              # 默认用第一个NPC
//   npm run prompt -- taisho    # 指定NPC id（mizuki / taisho）
//
// 运行时命令：
//   /stage 熟悉中          改relationship.stage，看不同关系阶段prompt效果
//   /facts {"喜欢":"猫"}   改relationship.known_facts（要是合法JSON）
//   /raw                   开关"打印system prompt + AI原始输出"，调试格式问题时开
//   /reset                 清空当前对话历史（NPC关系状态不清）
//   /quit                  退出
//
// 前提：本地要有.env.local（或.env），里面是ANTHROPIC_API_KEY等——
// 跟`npm run dev`用的是同一份，不用另外配置。

import fs from "fs";
import path from "path";
import readline from "readline";
import { getNpcConfig, listNpcIds } from "../lib/npc/registry";
import { buildChatContext } from "../lib/context/buildContext";
import { callClaude } from "../lib/claude/client";
import { extractWordChunks } from "../lib/chat/extractWordChunks";
import type { NpcRelationshipRow, ConversationTurnRow } from "../lib/db/types";

// Next.js会自动加载.env.local，但这个脚本是用tsx直接跑的、脱离Next.js的运行时，
// 所以要自己读一遍。写法很土（手动split每一行），但不想为了这一个脚本多引入
// dotenv这个依赖——一个能用的env文件解析，几行就够了。
function loadEnvFile(filename: string) {
  const filePath = path.resolve(process.cwd(), filename);
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

const npcIdArg = process.argv[2] || listNpcIds()[0];
const npc = getNpcConfig(npcIdArg);

let relationship: NpcRelationshipRow = {
  user_id: "playground",
  npc_id: npcIdArg,
  stage: "初识",
  known_facts: {},
  summary: "",
  updated_at: new Date().toISOString(),
};

let turns: ConversationTurnRow[] = [];
let showRaw = false;
let turnCounter = 0;

console.log(`\n=== Prompt Playground ===`);
console.log(`NPC: ${npc.displayName}（${npcIdArg}） | 可选：${listNpcIds().join(" / ")}`);
console.log(`relationship.stage = ${relationship.stage}`);
console.log(`命令：/stage <阶段>  /facts <JSON>  /raw  /reset  /quit`);
console.log(`直接输入文字 = 玩家发的消息\n`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function makeTurn(role: "user" | "npc", content: string): ConversationTurnRow {
  turnCounter++;
  return {
    id: `playground-${turnCounter}`,
    event_id: "playground",
    role,
    content,
    created_at: new Date().toISOString(),
  };
}

function ask() {
  rl.question("你> ", async (line) => {
    const text = line.trim();
    if (!text) return ask();

    if (text === "/quit") {
      rl.close();
      return;
    }
    if (text === "/reset") {
      turns = [];
      console.log("(对话历史已清空，relationship状态保留)\n");
      return ask();
    }
    if (text === "/raw") {
      showRaw = !showRaw;
      console.log(`(原始输出显示：${showRaw ? "开" : "关"})\n`);
      return ask();
    }
    if (text.startsWith("/stage ")) {
      relationship = { ...relationship, stage: text.slice("/stage ".length).trim() };
      console.log(`(stage改为: ${relationship.stage})\n`);
      return ask();
    }
    if (text.startsWith("/facts ")) {
      try {
        const parsed = JSON.parse(text.slice("/facts ".length));
        relationship = { ...relationship, known_facts: parsed };
        console.log(`(known_facts已更新: ${JSON.stringify(parsed)})\n`);
      } catch {
        console.log("(JSON解析失败，known_facts没变)\n");
      }
      return ask();
    }

    try {
      const { systemPrompt, messages } = buildChatContext(npc, relationship, turns, text);

      if (showRaw) {
        console.log("\n--- system prompt ---\n" + systemPrompt);
        console.log("\n--- messages (含本轮reinforcedMessage) ---");
        console.log(JSON.stringify(messages, null, 2));
      }

      const rawReply = await callClaude(systemPrompt, messages);

      if (showRaw) {
        console.log("\n--- AI原始输出（拆词块标记之前） ---\n" + rawReply);
      }

      const { reply, wordChunks } = extractWordChunks(rawReply);

      console.log(`\n${npc.displayName}> ${reply}`);
      if (wordChunks) {
        console.log(`  [词块]: ${wordChunks.join(" / ")}`);
      }
      console.log("");

      turns = [...turns, makeTurn("user", text), makeTurn("npc", reply)];
    } catch (err) {
      console.error("出错了：", err instanceof Error ? err.message : err);
    }

    ask();
  });
}

ask();
