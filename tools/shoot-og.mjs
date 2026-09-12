/**
 * 共有時に出る絵（1200×630）を焼く道具。
 *   node tools/shoot-og.mjs [URL]
 *
 * 版下を別に描くのではなく、実際のタイトル画面を撮る。
 *   1) 1440×900 で開き、撮るときだけ下のボタン（なまえ／はじめる／注記）を
 *      隠し、ロゴのぴょこぴょこを止める
 *   2) 上から少しだけ切って 1200×630 にする。題字・惹句・月の上の
 *      こすくまくん・刺さった剣が全部入る位置を選んである
 *
 * 1200×630 でそのまま開くと、月が迫り上がってこすくまくんが題字に
 * 隠れてしまう。だから高い画面で撮ってから切っている。
 *
 * 剣は世界のみんなが刺した実物なので、焼くたびに絵が変わる。
 *
 * 既定では本番URLを撮るので、手元の変更を映したいときは
 *   npm run dev の後に node tools/shoot-og.mjs http://localhost:3000
 *
 * 焼いた絵のハッシュを src/app/og-version.ts に書き出す。
 * SNSは og:image を URL 単位で覚えるので、これが変わらないと
 * 絵を差し替えても古いものが出続ける。
 */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = process.argv[2] ?? "https://kikiippatsu.kosukuma.com/";

/** 撮影する窓（CSS px）と拡大率 */
const SHOT = { w: 1440, h: 900, dpr: 1.5 };
/** 撮影のどこから切るか（CSS px。題字の上の余白） */
const CROP_TOP = 45;

const SHOOT_CSS = `
  /* 下のボタン類は絵に要らない */
  .title-bottom { display: none !important; }
  /* 題字は1文字ずつ跳ねるので、止めてから撮る */
  .logo-char { animation: none !important; opacity: 1 !important; transform: none !important; }
`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  args: [
    "--headless=new",
    "--hide-scrollbars",
    // 3Dの月を描かせる（ヘッドレスでもWebGLを動かす）
    "--use-gl=angle",
    "--enable-unsafe-swiftshader",
  ],
});
const tmp = await mkdtemp(path.join(tmpdir(), "kk-og-"));
const scenePng = path.join(tmp, "scene.png");

try {
  /* 1) タイトル画面を撮る */
  const page = await browser.newPage();
  await page.setViewport({ width: SHOT.w, height: SHOT.h, deviceScaleFactor: SHOT.dpr });
  await page.goto(SITE, { waitUntil: "networkidle0", timeout: 90000 });
  await page.addStyleTag({ content: SHOOT_CSS });
  await page.waitForSelector(".title-head", { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 7000)); // 月と剣が出そろうのを待つ
  await page.screenshot({ path: scenePng });

  /* 2) 上を少し落として 1200×630 に切る */
  const scale = 1200 / SHOT.w;
  const composeHtml = path.join(tmp, "compose.html");
  await writeFile(
    composeHtml,
    `<!doctype html><meta charset="utf-8"><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      #og { position: relative; width: 1200px; height: 630px; overflow: hidden; background: #0a0e2a; }
      img { position: absolute; left: 0; width: 1200px; top: ${-CROP_TOP * scale}px; }
    </style><div id="og"><img src="${pathToFileURL(scenePng).href}"></div>`,
    "utf8"
  );

  const og = await browser.newPage();
  await og.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await og.goto(pathToFileURL(composeHtml).href, { waitUntil: "networkidle0" });
  await og.waitForFunction(() => document.querySelector("img")?.complete === true);

  const out = path.join(ROOT, "public/og.png");
  await (await og.$("#og")).screenshot({ path: out });
  console.log(out);

  const version = createHash("sha256").update(await readFile(out)).digest("hex").slice(0, 8);
  const vfile = path.join(ROOT, "src/app/og-version.ts");
  await writeFile(
    vfile,
    `// tools/shoot-og.mjs が og.png を焼くたびに書き換える。手で触らない。\nexport const OG_VERSION = "${version}";\n`,
    "utf8"
  );
  console.log(`${vfile} (${version})`);
} finally {
  await browser.close();
  await rm(tmp, { recursive: true, force: true });
}
