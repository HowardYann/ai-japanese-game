// app/api/furigana/route.ts
//
// 纯文本转换接口：{ text } -> { html }，html是带<ruby>注音标签的片段。
// 不碰数据库、不碰AI——只是本地分词+查读音，所以延迟主要来自kuromoji
// 冷启动建字典（见 lib/furigana/tokenizer.ts 的缓存说明）。
//
// 跟其他API一样要求登录：这个接口本身不返回敏感数据，但保持"未登录一律401"
// 这个统一规则，比每个新接口都重新判断一次"要不要开放匿名访问"更省心。

import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "../../../lib/supabase/requireUserId";
import { getTokenizer } from "../../../lib/furigana/tokenizer";
import { tokensToRubyHtml } from "../../../lib/furigana/toRubyHtml";

export async function POST(req: NextRequest) {
  try {
    await requireUserId();
  } catch {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const text = body?.text;

  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const tokenizer = await getTokenizer();
    const tokens = tokenizer.tokenize(text);
    const html = tokensToRubyHtml(tokens);
    return NextResponse.json({ html });
  } catch (err) {
    console.error("Furigana conversion failed", err);
    return NextResponse.json({ error: "Furigana conversion failed" }, { status: 500 });
  }
}
