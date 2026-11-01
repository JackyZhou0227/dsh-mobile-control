import { mkdir, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const ASSETS = [
  {
    file: 'scrcpy-server',
    version: 'v3.3.3',
    url: 'https://github.com/Genymobile/scrcpy/releases/download/v3.3.3/scrcpy-server-v3.3.3',
  },
  {
    file: 'yadb',
    version: 'v1.1.1',
    url: 'https://github.com/ysbing/YADB/releases/download/v1.1.1/yadb',
  },
]

const vendorDir = fileURLToPath(new URL('../vendor/', import.meta.url))

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function download(asset) {
  const target = `${vendorDir}${asset.file}`
  if (await exists(target)) {
    console.log(`[vendor] ${asset.file} 已存在，跳过`)
    return
  }
  console.log(`[vendor] 下载 ${asset.file} (${asset.version})…`)
  const response = await fetch(asset.url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`${asset.url} → HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  await writeFile(target, bytes)
  console.log(`[vendor] ${asset.file} ${bytes.length} 字节`)
}

await mkdir(vendorDir, { recursive: true })
for (const asset of ASSETS) await download(asset)

await writeFile(
  `${vendorDir}README.md`,
  [
    '# vendor',
    '',
    '本目录是运行时下载的第三方二进制，不入版本库。',
    '',
    '- `scrcpy-server` — scrcpy v3.3.3 服务端，Apache-2.0，https://github.com/Genymobile/scrcpy',
    '- `yadb` — YADB v1.1.1，用于向安卓注入非 ASCII 文字，https://github.com/ysbing/YADB',
    '',
    '重新下载：`node scripts/fetch-vendor.mjs`',
    '',
  ].join('\n'),
)
