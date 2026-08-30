// lib/furigana/tokenizer.ts
//
// 假名标注用kuromoji做日语分词+读音查询。这个库只能在Node运行时用
// （依赖文件系统读字典文件），所以只在API route里调用，绝不能进客户端bundle。
//
// 字典文件跟着kuromoji这个npm包一起发布，不需要额外下载/托管——
// 部署到Vercel时它是普通的node_modules依赖，会跟着一起打进部署包。
//
// 构建一次tokenizer大概要读几MB字典文件，有实际耗时（冷启动可能一两秒），
// 所以用模块级变量缓存这个Promise：同一个serverless实例热的时候只建一次，
// 后续请求直接复用，不是每次请求都重新build。

import path from "path";

// kuromoji没有官方TS类型包在这个项目里，用最小化的手写类型描述用到的部分就够，
// 不为了这一个依赖去引入完整的@types/kuromoji
interface KuromojiToken {
  surface_form: string;
  reading?: string; // 片假名读音；符号/未知词有时是"*"或undefined
}

interface KuromojiTokenizer {
  tokenize(text: string): KuromojiToken[];
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const kuromoji = require("kuromoji");

let tokenizerPromise: Promise<KuromojiTokenizer> | null = null;

export function getTokenizer(): Promise<KuromojiTokenizer> {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      kuromoji
        .builder({ dicPath: path.join(process.cwd(), "node_modules/kuromoji/dict") })
        .build((err: Error | null, tokenizer: KuromojiTokenizer) => {
          if (err) {
            // 构建失败别把这个失败的Promise缓存住，不然这个serverless实例
            // 剩下的生命周期里所有请求都会一直复用同一个失败结果
            tokenizerPromise = null;
            reject(err);
            return;
          }
          resolve(tokenizer);
        });
    });
  }
  return tokenizerPromise;
}
