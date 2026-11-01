import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// client.js 是给浏览器模块表用的：用一个最小 window 抓住 factory 再手动跑 apply，
// 这样不用真的开浏览器也能验证「注册了什么」。
let loaded
globalThis.window = {
  __ModuleLoader__: {
    load(module) {
      loaded = module
    },
  },
}

const react = {
  // 不渲染 DOM，只把元素树记下来，好在 node 里断言结构。
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useRef: () => ({}),
  // 和 React 一致：函数初始值当惰性初始化调用一次。
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
}
const require = (name) => (name === 'react' ? react : {})

await import('../client.js')

assert.ok(loaded, 'client.js 没有注册模块')
assert.equal(loaded.id, '@local/dsh-mobile-control')
assert.equal(typeof loaded.factory, 'function')

const mod = loaded.factory(require)
assert.deepEqual(mod.inject, ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'uiWorkspace'])
assert.equal(typeof mod.apply, 'function')

const registered = { locale: [], tabs: [], slots: [] }
const ctx = {
  locale: {
    bind: () => (key) => key,
    register: (ns, dicts) => {
      registered.locale.push({ ns, dicts })
      return () => {}
    },
  },
  effect: (fn) => {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  slots: {
    inject: (_owner, fn) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    register: (options, component) => {
      registered.slots.push({ options, component })
      return () => {}
    },
  },
  sidebarRightTabs: {
    register: (definition) => {
      registered.tabs.push(definition)
      return () => {}
    },
  },
  uiWorkspace: { openSession() {} },
}

mod.apply(ctx)

// 文案：中英 key 必须一致
assert.equal(registered.locale.length, 1)
const { ns, dicts } = registered.locale[0]
assert.equal(ns, 'mobileControl')
assert.deepEqual(Object.keys(dicts.zh).sort(), Object.keys(dicts.en).sort())

// 中文/英文对齐只能保证「两边一样缺」，下面这条才抓得到「用了但没定义的 key」——
// 那种情况 UI 会直接把 key 显示出来（比如 devices.title）。
{
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const used = new Set([...source.matchAll(/\bt\('([^']+)'\)/g)].map((match) => match[1]))
  const missing = [...used].filter((key) => !(key in dicts.zh))
  assert.deepEqual(missing, [], `UI 用到了未定义的文案 key: ${missing.join(', ')}`)
}

// tab type
assert.equal(registered.tabs.length, 1)
const tab = registered.tabs[0]
assert.equal(tab.id, '@local/dsh-mobile-control')
assert.equal(tab.kind, 'mobile')
assert.equal(tab.multiple, false)
assert.equal(tab.priority, 'builtin')
assert.equal(typeof tab.title(), 'string')
assert.equal(tab.guide.length, 1)
assert.equal(typeof tab.guide[0].title(), 'string')
assert.equal(typeof tab.guide[0].description(), 'string')
assert.equal(typeof tab.guide[0].icon, 'function')

// 两个 slot：本体 + 标题
assert.equal(registered.slots.length, 2)
const names = registered.slots.map((entry) => entry.options.name).sort()
assert.deepEqual(names, ['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title'])
for (const entry of registered.slots) {
  assert.equal(entry.options.key, '@local/dsh-mobile-control')
  assert.equal(typeof entry.component, 'function')
}

const body = registered.slots.find((entry) => entry.options.name === 'sidebar.right.pane.tab')
assert.deepEqual(body.options.inject('session-1'), { sessionId: 'session-1' })

// 浅渲染一次：state 还是 null（加载中）的那一帧，验证整棵树的结构没被括号写歪。
globalThis.__DSH_MOBILE_CONTROL__ = { base: '/mobile-control/test' }
const tree = body.component({ sessionId: 'session-1' })

const byClass = (node, className, found = []) => {
  if (Array.isArray(node)) {
    for (const child of node) byClass(child, className, found)
  } else if (node && typeof node === 'object') {
    const tokens = String(node.props?.className ?? '').split(/\s+/)
    if (tokens.includes(className)) found.push(node)
    byClass(node.children, className, found)
  }
  return found
}

assert.equal(tree.props.className, 'dmc-host')
const shell = byClass(tree, 'dmc-root')[0]
assert.ok(shell, '缺 dmc-root')
// 没认领设备时是独立的列表页，不是左右分栏
assert.equal(shell.props.className, 'dmc-root idle')
for (const name of ['dmc-main', 'dmc-foot', 'dmc-empty']) {
  assert.equal(byClass(shell, name).length, 1, `缺少 ${name}`)
}
// 加载态还没有设备列表，底栏只有「批量下发任务」这一级标题
assert.equal(byClass(shell, 'dmc-status').length, 0, '未认领页不该再有状态行')

// 宽布局的可拖动分隔条
const resizer = byClass(shell, 'dmc-resizer')[0]
assert.ok(resizer, '缺可拖动分隔条')
assert.equal(resizer.props.role, 'separator')
assert.equal(resizer.props['aria-orientation'], 'vertical')
assert.equal(resizer.props.tabIndex, 0)
for (const handler of ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onKeyDown']) {
  assert.equal(typeof resizer.props[handler], 'function', `分隔条缺 ${handler}`)
}
// 列宽由状态驱动，默认 280px（node 里没有 localStorage）
assert.match(shell.props.style.gridTemplateColumns, /7px 280px$/)

// 字体必须全部继承宿主：不许再出现等宽字族，表单控件要显式 inherit
const css = shell.children.find((child) => child.type === 'style').children[0]
assert.ok(!/monospace/.test(css), '不要再引入等宽字体')
assert.match(css, /\.dmc-root button,\.dmc-root input,\.dmc-root textarea\{font-family:inherit\}/)
// head 横跨、main 在左、foot 在右（grid 时）
const foot = byClass(shell, 'dmc-foot')[0]
const footClasses = foot.children.filter(Boolean).map((child) => child.props?.className)
// 未认领时底栏只有两级标题 + 下发表单，没有状态行
assert.deepEqual(footClasses, ['dmc-info', 'dmc-h2', 'dmc-form'])

// 检查器列：设备 / 系统 / 分辨率 / 连接 / 序列号 五行
assert.equal(byClass(shell, 'dmc-kv').length, 5, '检查器缺设备信息行')

// 批量表单：composer 形态（文本区 + 芯片栏 + 圆形发送键）
const formTree = byClass(shell, 'dmc-form')[0]
const composer = byClass(formTree, 'dmc-composer')[0]
assert.ok(composer, '批量表单缺 composer 卡片')
assert.equal(byClass(composer, 'dmc-composerBar').length, 1, 'composer 缺底部芯片栏')
const input = byClass(composer, 'dmc-composerInput')[0]
assert.equal(input?.type, 'textarea', 'composer 缺 textarea')
const send = byClass(composer, 'dmc-send')[0]
assert.ok(send, 'composer 缺发送键')
assert.equal(send.props['aria-label'] !== undefined, true, '发送键缺 aria-label')
// 设备选择是多选下拉，靠左排在 composer 芯片栏里（Picker 是组件，浅渲染只能看到 props）
const bar = byClass(composer, 'dmc-composerBar')[0]
const devicePick = bar.children.filter(Boolean).find((child) => typeof child.type === 'function')
assert.ok(devicePick, '设备选择没在 composer 芯片栏里')
assert.equal(devicePick.props.multiple, true, '设备选择应该是多选')
assert.ok(Array.isArray(devicePick.props.entries), '设备选择缺候选项')
assert.equal(byClass(shell, 'dmc-devicePick').length, 0, '不该再有内联设备列表')
assert.equal(byClass(shell, 'dmc-section').length, 0, '「批量下发」小标题应该换成大标题')

// 加载态不渲染画布，避免默认 300×150 的黑块
assert.equal(byClass(shell, 'dmc-canvas').length, 0)
assert.equal(byClass(shell, 'dmc-holder').length, 0)

// idle 页在宽布局里必须显式写回 display:flex —— 否则会被 .dmc-root 的 grid 拽成左右两列
assert.match(css, /\.dmc-root\.idle\{display:flex/, 'idle 页在宽布局里必须保持单栏')
// 宽度/留白必须在基础规则里：只写在容器查询里，窄一点就变成满宽、只剩 10px 内边距
assert.match(
  css,
  /\.dmc-root\.idle \.dmc-main\{[^}]*max-width:640px/,
  'idle 页的宽度约束必须在基础规则里',
)

console.log('ok client 注册：locale / tab type / body / title')
console.log('ok client 结构：main / foot(info,status,batch) / 字族继承')

