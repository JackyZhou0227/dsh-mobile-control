import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 插件自带的二进制（scrcpy-server / yadb），由 scripts/fetch-vendor.mjs 下载。 */
export function vendorPath(name) {
  return fileURLToPath(new URL(`../vendor/${name}`, import.meta.url))
}

/** 需要某个 vendor 文件时，缺失就给出可操作的报错而不是 ENOENT。 */
export function requireVendor(name) {
  const path = vendorPath(name)
  if (!existsSync(path)) {
    throw new Error(
      `缺少 ${name}。请在插件目录执行 \`node scripts/fetch-vendor.mjs\` 下载该文件后重试。`,
    )
  }
  return path
}
