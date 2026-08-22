"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { listNpcIds, getNpcDisplayName } from "@/lib/npc/registry";
import type { EventScenario } from "@/lib/db/types";

// v1：先用几条写死的推荐场景跑通闭环，不接真实推荐算法（对照V2文档第5节，
// mock数据够用）。结构和 /api/scenario/generate 的返回一致，
// 所以可以直接复用同一个Preview屏幕，不用为"推荐"单独做一套UI。
const RECOMMENDED: { label: string; scenario: EventScenario }[] = [
  {
    label: "和瑞希去咖啡店聊聊最近看的电影",
    scenario: {
      goal: "自然地和日本人聊最近看的一部电影，并分享观后感与对方的兴趣点",
      participants: "IT公司行政瑞希（みずき），温暖健谈的东京本地人",
      environment: "在一家舒适的咖啡店里，背景有轻柔的音乐和淡淡的咖啡香，氛围轻松友好",
      possibleTasks: [
        "自我介绍并说明自己最近看了哪部电影",
        "描述电影的剧情、喜欢的角色或场景",
        "回答瑞希关于电影类型、导演或演员的追问",
        "询问瑞希最近看过的电影并进行对比讨论",
        "在对话结束时礼貌地表达期待下次交流的愿望",
      ],
      suggestedNpcId: "mizuki",
    },
  },
  {
    label: "下班路上去大将的定食屋，点一道没吃过的菜",
    scenario: {
      goal: "走进熟悉的定食屋，点一道之前没吃过的菜，并和老板聊几句",
      participants: "定食屋「なかむら」老板大将，看似话少但耐心温和",
      environment: "下町路地裏的小店，柜台只有5个座位，晚饭时间，店里有其他熟客",
      possibleTasks: [
        "问大将今天有什么推荐",
        "点一道没吃过的菜，简单描述自己的口味喜好",
        "回应大将随口的关心或追问",
        "结束用餐时自然地道别",
      ],
      suggestedNpcId: "taisho",
    },
  },
];

type Screen =
  | { name: "entry" }
  | { name: "generating" }
  | { name: "preview"; scenario: EventScenario; sourceLabel?: string }
  | { name: "starting" };

function isUnauthenticated(res: Response) {
  return res.status === 401;
}

export default function HomeClient() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ name: "entry" });
  const [freeInput, setFreeInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleGenerate() {
    const input = freeInput.trim();
    if (!input) return;

    setErrorMsg("");
    setScreen({ name: "generating" });

    try {
      const res = await fetch("/api/scenario/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      if (isUnauthenticated(res)) {
        router.push("/");
        return;
      }
      if (!res.ok) {
        setErrorMsg("场景生成失败了，可以换个说法再试一次。");
        setScreen({ name: "entry" });
        return;
      }
      const data = await res.json();
      setScreen({ name: "preview", scenario: data.scenario });
    } catch {
      setErrorMsg("网络出了点问题，场景没生成出来。");
      setScreen({ name: "entry" });
    }
  }

  function handlePickRecommended(item: { label: string; scenario: EventScenario }) {
    setErrorMsg("");
    setScreen({ name: "preview", scenario: item.scenario, sourceLabel: item.label });
  }

  // 浏览场景：v1先等于直接选NPC聊天，不带scenario——和现有chat页的select行为一致，
  // 只是入口挪到了这里
  async function handleBrowseNpc(npcId: string) {
    setErrorMsg("");
    setScreen({ name: "starting" });
    try {
      const res = await fetch("/api/event/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ npcId }),
      });
      if (isUnauthenticated(res)) {
        router.push("/");
        return;
      }
      if (!res.ok) {
        setErrorMsg("开始对话失败，请重试。");
        setScreen({ name: "entry" });
        return;
      }
      const data = await res.json();
      router.push(`/chat?eventId=${data.eventId}`);
    } catch {
      setErrorMsg("网络出了点问题，请重试。");
      setScreen({ name: "entry" });
    }
  }

  async function handleConfirmScenario(scenario: EventScenario, npcId: string) {
    setErrorMsg("");
    setScreen({ name: "starting" });
    try {
      const res = await fetch("/api/event/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ npcId, scenario }),
      });
      if (isUnauthenticated(res)) {
        router.push("/");
        return;
      }
      if (!res.ok) {
        setErrorMsg("开始体验失败，请重试。");
        setScreen({ name: "preview", scenario });
        return;
      }
      const data = await res.json();
      router.push(`/chat?eventId=${data.eventId}`);
    } catch {
      setErrorMsg("网络出了点问题，请重试。");
      setScreen({ name: "preview", scenario });
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">今天想做什么？</h1>
        <Link
          href="/world"
          className="rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-100"
        >
          世界档案
        </Link>
      </div>

      {errorMsg && (
        <p className="mb-4 rounded-md border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
          {errorMsg}
        </p>
      )}

      {screen.name === "entry" && (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-medium text-neutral-300">推荐给你</h2>
            <div className="space-y-3">
              {RECOMMENDED.map((item) => (
                <button
                  key={item.label}
                  onClick={() => handlePickRecommended(item)}
                  className="block w-full rounded-md border border-neutral-800 bg-neutral-900/60 p-4 text-left text-sm hover:border-neutral-600"
                >
                  <span className="text-neutral-100">{item.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium text-neutral-300">浏览场景</h2>
            <div className="space-y-3">
              {listNpcIds().map((npcId) => (
                <button
                  key={npcId}
                  onClick={() => handleBrowseNpc(npcId)}
                  className="block w-full rounded-md border border-neutral-800 bg-neutral-900/60 p-4 text-left text-sm hover:border-neutral-600"
                >
                  <span className="font-medium text-neutral-100">
                    去找 {getNpcDisplayName(npcId)} 聊聊
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium text-neutral-300">
              或者，你自己想体验什么？
            </h2>
            <div className="space-y-2">
              <textarea
                value={freeInput}
                onChange={(e) => setFreeInput(e.target.value)}
                placeholder="例如：去居酒屋点菜 / 和同事聊周末 / 第一次参加日本人的聚会……"
                rows={3}
                maxLength={300}
                className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
              <button
                onClick={handleGenerate}
                disabled={!freeInput.trim()}
                className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
              >
                开始体验
              </button>
            </div>
          </section>
        </div>
      )}

      {screen.name === "generating" && (
        <div className="flex min-h-[200px] items-center justify-center">
          <p className="text-sm text-neutral-500">正在把这句话变成一个场景…</p>
        </div>
      )}

      {screen.name === "preview" && (
        <ScenarioPreview
          scenario={screen.scenario}
          sourceLabel={screen.sourceLabel}
          onBack={() => setScreen({ name: "entry" })}
          onConfirm={(npcId) => handleConfirmScenario(screen.scenario, npcId)}
        />
      )}

      {screen.name === "starting" && (
        <div className="flex min-h-[200px] items-center justify-center">
          <p className="text-sm text-neutral-500">正在进入场景…</p>
        </div>
      )}
    </main>
  );
}

function ScenarioPreview({
  scenario,
  sourceLabel,
  onBack,
  onConfirm,
}: {
  scenario: EventScenario;
  sourceLabel?: string;
  onBack: () => void;
  onConfirm: (npcId: string) => void;
}) {
  // 玩家可以在预览页手动改成另一个NPC，不强制信任AI给的suggestedNpcId
  const [npcId, setNpcId] = useState(scenario.suggestedNpcId);

  return (
    <div className="space-y-4">
      {sourceLabel && <p className="text-sm text-neutral-500">{sourceLabel}</p>}

      <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-4">
        <p className="mb-3 text-sm text-neutral-100">{scenario.goal}</p>
        <p className="mb-1 text-xs text-neutral-500">场景</p>
        <p className="mb-3 text-sm text-neutral-300">{scenario.environment}</p>
        <p className="mb-1 text-xs text-neutral-500">你会遇到</p>
        <p className="text-sm text-neutral-300">{scenario.participants}</p>
      </div>

      <div className="rounded-md border border-neutral-800 p-4">
        <p className="mb-2 text-xs text-neutral-500">和谁一起体验这个场景</p>
        <div className="flex gap-2">
          {listNpcIds().map((id) => (
            <button
              key={id}
              onClick={() => setNpcId(id)}
              className={
                id === npcId
                  ? "rounded-md border border-neutral-100 bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900"
                  : "rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-100"
              }
            >
              {getNpcDisplayName(id)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => onConfirm(npcId)}
          className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900"
        >
          开始体验
        </button>
        <button
          onClick={onBack}
          className="rounded-md border border-neutral-800 px-4 py-2 text-sm text-neutral-400 hover:text-neutral-100"
        >
          换一个
        </button>
      </div>
    </div>
  );
}
