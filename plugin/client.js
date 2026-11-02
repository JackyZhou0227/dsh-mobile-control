window.__ModuleLoader__.load({
  id: '@local/dsh-mobile-control',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'mobileControl'
    const ID = '@local/dsh-mobile-control'
    const KIND = 'mobile'

    const FLAG_CONFIG = 1
    const FLAG_KEY = 2
    const FLAG_META = 4
    const FLAG_IMAGE = 8

    const zh = {
      'type.label': '手机控制',
      'guide.title': '手机控制',
      'guide.description': '连接手机并实时投屏',
      rebooting: '插件已重新加载，刷新页面后再试。',
      'devices.empty': '没有检测到手机。插上 USB、打开 USB 调试并授权后重试。',
      claim: '认领',
      release: '解绑会话',
      'lease.hint': '这个会话的 agent 正在操作这台手机，直接让它做事就行。',
      refresh: '刷新',
      'state.loading': '读取设备信息…',
      'state.failed': '读取失败',
      'mirror.waiting': '正在连接投屏',
      'mirror.playing': '实时投屏',
      'mirror.retry': '投屏断开，正在重连',
      'mirror.failed': '投屏不可用',
      'mirror.retryAction': '重试',
      'mirror.sizeHint': '这是投屏流的尺寸（scrcpy 按 streamMaxSize 缩放），不是手机屏幕分辨率。',
      'batch.title': '批量下发任务',
      'devices.title': '设备',
      'batch.placeholder': '给选中的手机统一下发的任务，例如：打开设置，把屏幕亮度调到最高。',
      'batch.submit': '下发',
      'batch.running': '下发中…',
      'batch.empty': '至少选一台设备。',
      'batch.promptEmpty': '提示词不能为空。',
      'batch.result': '结果',
      'batch.open': '打开',
      'batch.failed': '失败',
      'batch.pick': '设备',
      'batch.selectAll': '全选',
      'batch.clearAll': '全不选',
      'opt.preset': '工作模式',
      'opt.permission': '权限',
      'opt.model': '模型',
      'opt.workspace': '工作区',
      'opt.addWorkspace': '添加工作区…',
      'preset.standard': '标准模式',
      'preset.ptc': 'PTC',
      'preset.minimal': '极简',
      'preset.cordis': 'Cordis',
      'preset.mobile-control': '手机操作',
      'perm.read-only': '只读',
      'perm.workspace-write': '工作区内修改',
      'perm.danger-full-access': '完全访问',
      'info.device': '设备',
      'info.os': '系统',
      'info.screen': '分辨率',
      'info.connection': '连接',
      'info.serial': '序列号',
      splitter: '拖动调整左右宽度',
      'idle.hint': '认领后这个会话的 agent 就能操作这台手机；一台手机同时只归一个会话。',
      'batch.plan': '将新建 {count} 个会话，每台设备一个，同时开始跑。',
      'claimed.me': '本会话在用',
      'claimed.free': '空闲',
      'claimed.other': '被占用',
      'claim.done': '已认领',
      'claim.taken': '已被占用',
      'claim.goto': '前往绑定会话',
      'claim.unavailable': '不可用',
    }

    const en = {
      'type.label': 'Mobile Control',
      'guide.title': 'Mobile Control',
      'guide.description': 'Connect a device and mirror it live',
      rebooting: 'Plugin reloaded. Refresh the page and try again.',
      'devices.empty': 'No devices found. Plug in USB, enable USB debugging, and authorize.',
      claim: 'Claim',
      release: 'Unbind session',
      'lease.hint': 'This session drives that phone — just tell the agent what to do.',
      refresh: 'Refresh',
      'state.loading': 'Reading devices…',
      'state.failed': 'Read failed',
      'mirror.waiting': 'Connecting mirror',
      'mirror.playing': 'Live mirror',
      'mirror.retry': 'Mirror dropped, reconnecting',
      'mirror.failed': 'Mirror unavailable',
      'mirror.retryAction': 'Retry',
      'mirror.sizeHint': 'This is the stream size (scrcpy scales by streamMaxSize), not the phone screen resolution.',
      'batch.title': 'Dispatch a task',
      'devices.title': 'Devices',
      'batch.placeholder': 'Task for the selected devices, e.g. open Settings and set brightness to max.',
      'batch.submit': 'Dispatch',
      'batch.running': 'Dispatching…',
      'batch.empty': 'Select at least one device.',
      'batch.promptEmpty': 'The prompt is empty.',
      'batch.result': 'Results',
      'batch.open': 'Open',
      'batch.failed': 'failed',
      'batch.pick': 'Devices',
      'batch.selectAll': 'Select all',
      'batch.clearAll': 'Clear all',
      'opt.preset': 'Agent preset',
      'opt.permission': 'Permission',
      'opt.model': 'Model',
      'opt.workspace': 'Workspace',
      'opt.addWorkspace': 'Add workspace…',
      'preset.standard': 'Standard',
      'preset.ptc': 'PTC',
      'preset.minimal': 'Minimal',
      'preset.cordis': 'Cordis',
      'preset.mobile-control': 'Phone ops',
      'perm.read-only': 'Read-only',
      'perm.workspace-write': 'Workspace write',
      'perm.danger-full-access': 'Full access',
      'info.device': 'Device',
      'info.os': 'OS',
      'info.screen': 'Screen',
      'info.connection': 'Link',
      'info.serial': 'Serial',
      splitter: 'Drag to resize panes',
      'idle.hint': 'Once claimed, this session drives that phone. One phone belongs to one session at a time.',
      'batch.plan': 'Creates {count} session(s), one per device, running together.',
      'claimed.me': 'in use here',
      'claimed.free': 'free',
      'claimed.other': 'taken',
      'claim.done': 'Claimed',
      'claim.taken': 'Taken',
      'claim.goto': 'Open session',
      'claim.unavailable': 'Unavailable',
    }

    // 除 --dmc-accent 外只用 host 的 alias token，主题切换会自动跟着变。
    // 注意：--dsw-alias-brand-primary 在 DSH 这套主题里是近黑的墨色，不是蓝色；
    // 蓝色取插件图标里的 #3B82FE，集中在这里一处，方便调。
    const CSS = `
.dmc-host{height:100%;min-height:0;container-type:inline-size}
.dmc-root{position:relative;--dmc-accent:#3B82FE;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:12px;line-height:1.5}
/* 表单控件不会自动继承字体，全部拉回宿主的字族，别再冒出一个系统 UI 字体。 */
.dmc-root button,.dmc-root input,.dmc-root textarea{font-family:inherit}
.dmc-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dmc-icon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dmc-icon:disabled{color:var(--dsw-alias-label-quaternary);cursor:default}
.dmc-main{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:10px;gap:8px;overflow:hidden}
/* ponytail: 画布靠 max-height:100% 收在 stage 里；stage 这条 vh 上限是兜底，防止槽位哪天不再给确定高度时投屏又撑满整屏。 */
.dmc-stage{flex:1 1 auto;min-height:0;max-height:calc(100vh - 220px);box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:6px;overflow:visible}
/* 只有一层：手机自己悬在页面上，圆角 + 落影做边界；外面不再套卡片和分界线。 */
.dmc-canvas{display:block;max-width:100%;max-height:100%;width:auto;height:auto;border-radius:16px;background:#000;box-shadow:0 1px 2px rgba(0,0,0,.12),0 10px 28px rgba(0,0,0,.18);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent),0 1px 2px rgba(0,0,0,.12),0 10px 28px rgba(0,0,0,.18)}
.dmc-canvas.off{display:none}
.dmc-holder{display:flex;flex-direction:column;align-items:center;gap:8px;padding:24px 16px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.dmc-holder strong{font-weight:500;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dmc-holder .dmc-sub{white-space:normal}
.dmc-spin{width:18px;height:18px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-secondary);animation:dmc-spin .9s linear infinite}
@keyframes dmc-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.dmc-spin{animation:none}}
.dmc-list{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:6px;overflow-y:auto}
.dmc-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.dmc-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dmc-col{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.dmc-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmc-sub{color:var(--dsw-alias-label-tertiary);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmc-btn{flex:none;height:24px;padding:0 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;cursor:pointer;white-space:nowrap}
.dmc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dmc-btn:disabled{color:var(--dsw-alias-label-quaternary);cursor:default}
/* 主操作（认领）用品牌色实心；其余按钮保持幽灵态，避免满屏彩色 */
.dmc-btn.primary{background:var(--dmc-accent);border-color:transparent;color:#fff}
.dmc-btn.primary:hover:not(:disabled){background:var(--dmc-accent);color:#fff;opacity:.9}
.dmc-btn.primary:disabled{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-quaternary)}
.dmc-empty{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--dsw-alias-label-tertiary);padding:24px 16px}
.dmc-notes{flex:none;color:var(--dsw-alias-label-quaternary);font-size:11px;white-space:pre-wrap}
.dmc-error{flex:none;color:var(--dsw-alias-state-error-primary);font-size:11px;white-space:pre-wrap}
.dmc-foot{flex:none;display:flex;flex-direction:column;gap:8px;padding:8px 12px 10px;border-top:.5px solid var(--dsw-alias-border-l3);max-height:42vh;overflow-y:auto}
.dmc-status{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dmc-statusText{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmc-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.dmc-dot.on{background:var(--dsw-alias-state-success-primary)}
.dmc-dot.warn{background:var(--dsw-alias-state-warn-primary)}
.dmc-dot.bad{background:var(--dsw-alias-state-error-primary)}
.dmc-info{display:none;flex-direction:column;gap:4px;padding-bottom:4px}
.dmc-kv{display:flex;gap:8px;font-size:11px;line-height:1.6}
.dmc-kv b{flex:none;width:40px;font-weight:400;color:var(--dsw-alias-label-quaternary)}
.dmc-kv span{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmc-h2{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary)}
/* 一级标题前的一小段品牌色，只做层次提示，不做装饰 */
.dmc-h2::before{content:'';flex:none;width:3px;height:12px;border-radius:2px;background:var(--dmc-accent);opacity:.85}
.dmc-h2>.dmc-icon{margin-left:auto}
.dmc-listWrap{display:flex;flex-direction:column;gap:8px;min-width:0}
.dmc-form{display:flex;flex-direction:column;gap:7px}
.dmc-results{display:flex;flex-direction:column;gap:4px}
/* 下发区照抄宿主 composer 的形态：一张圆角卡，文本区在上、可选芯片和发送键在下。 */
.dmc-composer{display:flex;flex-direction:column;gap:4px;padding:9px 9px 7px 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
.dmc-composer:focus-within{border-color:var(--dsw-alias-border-l2);border-color:color-mix(in srgb,var(--dmc-accent) 40%,var(--dsw-alias-border-l2))}
.dmc-composerInput{width:100%;min-height:44px;max-height:140px;box-sizing:border-box;resize:none;border:0;padding:2px 0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;outline:none}
.dmc-composerInput::placeholder{color:var(--dsw-alias-label-quaternary)}
.dmc-composerBar{display:flex;align-items:center;gap:2px;row-gap:4px;flex-wrap:wrap;min-width:0}
.dmc-picker{position:relative;display:inline-flex;flex:none;max-width:150px;min-width:0}
.dmc-chipBtn{display:inline-flex;align-items:center;gap:5px;position:relative;max-width:150px;height:24px;padding:0 20px 0 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
.dmc-chipBtn:hover,.dmc-chipBtn[aria-expanded='true']{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dmc-chipBtn>svg{flex:none;color:var(--dsw-alias-label-tertiary)}
.dmc-chipLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmc-chipBtn::after{content:'';position:absolute;right:7px;top:50%;width:4px;height:4px;border-right:1px solid currentColor;border-bottom:1px solid currentColor;opacity:.55;transform:translateY(-70%) rotate(45deg)}
/* 自绘下拉：原生 select 的展开层由系统画，CSS 完全够不着。 */
.dmc-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:20;min-width:168px;max-width:280px;max-height:240px;overflow-y:auto;padding:4px;background:var(--dsw-alias-bg-overlay);border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.18)}
.dmc-menu.up{top:auto;bottom:calc(100% + 6px)}
.dmc-menu.right{left:auto;right:0}
.dmc-option{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;height:28px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:28px;text-align:left;cursor:pointer}
.dmc-option:hover,.dmc-option.active{background:var(--dsw-alias-interactive-bg-hover)}
/* 选中项用极淡的品牌色底 + 品牌色勾，比纯灰更有"被选中"的感觉 */
.dmc-option.on,.dmc-option.on:hover{background:var(--dsw-alias-bg-layer-2);background:color-mix(in srgb,var(--dmc-accent) 12%,transparent)}
.dmc-option.on .dmc-optionCheck{color:var(--dmc-accent)}
.dmc-optionLabel{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmc-optionCheck{flex:none;display:inline-flex;color:var(--dsw-alias-label-secondary)}
.dmc-optionIcon{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary)}
.dmc-menuFoot{margin-top:4px;padding-top:4px;border-top:.5px solid var(--dsw-alias-border-l3)}
.dmc-menuHead{margin-bottom:4px;padding-bottom:4px;border-bottom:.5px solid var(--dsw-alias-border-l3)}
/* 菜单展开时放开底栏的滚动裁剪，否则向上翻的那一下会被切掉。 */
.dmc-root.picking .dmc-foot{overflow:visible}
.dmc-send{flex:none;margin-left:auto;width:26px;height:26px;border-radius:50%;border:0;display:inline-flex;align-items:center;justify-content:center;background:var(--dmc-accent);color:#fff;cursor:pointer}
.dmc-send:hover:not(:disabled){opacity:.86}
.dmc-send:disabled{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-quaternary);cursor:default}
.dmc-resizer{display:none}
/* 没认领设备时是「整页滚动的列表页」，不是列表在上、输入框钉在底部、中间空一大片。 */
/* 没认领设备时是「整页滚动的列表页」，不是列表在上、输入框钉在底部、中间空一大片。
   宽度和留白写在基础规则里：不依赖容器查询，任何宽度下都有边距和居中。 */
.dmc-root.idle{overflow-y:auto}
.dmc-root.idle .dmc-main{flex:0 0 auto;overflow:visible;width:100%;max-width:640px;margin:0 auto;padding:10px 12px 12px}
.dmc-root.idle .dmc-list{flex:0 0 auto;overflow:visible}
.dmc-root.idle .dmc-foot{flex:0 0 auto;overflow:visible;width:100%;max-width:640px;margin:0 auto;max-height:none;padding:10px 12px 12px;border-top:.5px solid var(--dsw-alias-border-l3)}
.dmc-hintText{color:var(--dsw-alias-label-quaternary);font-size:11px;line-height:1.6}
.dmc-release{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:2px;padding-top:8px;border-top:.5px solid var(--dsw-alias-border-l3)}
.dmc-release .dmc-hintText{flex:1 1 140px;min-width:0}
.dmc-badge{flex:none;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1.7}
.dmc-titleRow{display:flex;align-items:center;gap:6px;min-width:0}
/* 侧栏宽度和窗口宽度无关，只能问容器自己：够宽就把控制面板挪到右边一列，别让竖屏手机两边空着。 */
@container (min-width:620px){
  .dmc-root{display:grid;grid-template-rows:minmax(0,1fr)}
  .dmc-main{grid-area:1/1;padding:10px}
  .dmc-stage{max-height:100%}
  .dmc-resizer{grid-area:1/2;display:block;position:relative;cursor:col-resize;touch-action:none;background:transparent}
  .dmc-resizer::before{content:'';position:absolute;top:0;bottom:0;left:3px;width:1px;background:var(--dsw-alias-border-l3);transition:background .12s}
  .dmc-resizer:hover::before,.dmc-resizer.active::before{background:var(--dsw-alias-label-tertiary)}
  .dmc-resizer:focus-visible{outline:none}
  .dmc-resizer:focus-visible::before{background:var(--dmc-accent)}
  .dmc-foot{grid-area:1/3;max-height:none;padding:10px 12px;border-top:0}
  /* 已认领时右栏内容少：把「解绑会话」压到底部，上信息下动作，不留一块空白在中间。 */
  .dmc-root:not(.idle) .dmc-release{margin-top:auto}
  /* 侧栏窄的时候标题栏已经有「手机 · PESM10」，这块只在宽布局里当检查器用。 */
  .dmc-info{display:flex}
  /* 没认领设备时是另一张页面：单栏的设备列表 + 下发入口，不是左右分栏。 */
  /* 没认领设备时是另一张页面：单栏的设备列表 + 下发入口，不是左右分栏。
     必须显式写回 display——上面 .dmc-root 在宽布局里是 grid，不覆盖就被拽成左右两列。
     宽度/留白在基础规则里已经写好，这里只管别被 grid 接管。 */
  .dmc-root.idle{display:flex;flex-direction:column}
  .dmc-root.idle .dmc-resizer{display:none}
  .dmc-root.idle .dmc-info{display:none}
}
`

    function bootBase() {
      const boot = globalThis.__DSH_MOBILE_CONTROL__
      return typeof boot?.base === 'string' ? boot.base : ''
    }

    function concatBytes(a, b) {
      if (a.length === 0) return b
      const out = new Uint8Array(a.length + b.length)
      out.set(a)
      out.set(b, a.length)
      return out
    }

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    const PANE_KEY = 'dsh-mobile-control.paneWidth'
    const PANE_MIN = 220
    const PANE_FALLBACK_MAX = 520
    // 和 .dmc-menu 的 max-width 保持一致：用来判断往右还放不放得下。
    const MENU_WIDTH = 280

    function readPaneWidth() {
      try {
        const stored = Number(globalThis.localStorage?.getItem(PANE_KEY))
        return Number.isFinite(stored) && stored >= PANE_MIN ? stored : 280
      } catch {
        return 280
      }
    }

    function writePaneWidth(value) {
      try {
        globalThis.localStorage?.setItem(PANE_KEY, String(Math.round(value)))
      } catch {}
    }

    /** 右栏宽度的上限跟着容器走，别把投屏挤成一条缝。 */
    function clampPaneWidth(value, root) {
      const max =
        root && root.clientWidth > 480
          ? Math.max(PANE_MIN, root.clientWidth - 240)
          : PANE_FALLBACK_MAX
      return Math.min(Math.max(value, PANE_MIN), max)
    }

    /** 从 Annex-B 的 SPS 里拼出 avc1.PPCCLL；拼不出来就用最常见的基线档兜底。 */
    function codecString(config) {
      const hex = (value) => value.toString(16).padStart(2, '0')
      for (let index = 3; index + 3 < config.length; index += 1) {
        if (config[index] === 0x67 && config[index - 1] === 1 && config[index - 2] === 0) {
          return `avc1.${hex(config[index + 1])}${hex(config[index + 2])}${hex(config[index + 3])}`
        }
      }
      return 'avc1.42E01E'
    }

    /**
     * 一条投屏流：读 `u32 len | u8 flags | u32 seq | payload` 的封包，
     * H.264 走 WebCodecs，降级时的 JPEG 直接画。
     */
    function useMirror(canvasRef, url, setStatus) {
      useEffect(() => {
        if (!url) return undefined
        let cancelled = false
        let decoder = null
        let reader = null
        const controller = new AbortController()
        let configBytes = null
        let started = false
        let width = 0
        let height = 0

        const disposeDecoder = () => {
          try {
            decoder?.close()
          } catch {}
          decoder = null
        }

        const draw = (source) => {
          const canvas = canvasRef.current
          if (!canvas) return
          const w = source.displayWidth ?? source.width
          const hgt = source.displayHeight ?? source.height
          if (canvas.width !== w || canvas.height !== hgt) {
            canvas.width = w
            canvas.height = hgt
          }
          canvas.getContext('2d').drawImage(source, 0, 0)
          if (!started) {
            started = true
            setStatus({ phase: 'playing', width, height })
          }
        }

        const configure = () => {
          if (decoder || !configBytes) return
          const codec = codecString(configBytes)
          decoder = new VideoDecoder({
            output(frame) {
              draw(frame)
              frame.close()
            },
            error() {
              disposeDecoder()
            },
          })
          decoder.configure({ codec, avc: { format: 'annexb' }, optimizeForLatency: true })
        }

        const onFrame = (flags, seq, payload) => {
          if (flags & FLAG_META) {
            try {
              const meta = JSON.parse(new TextDecoder().decode(payload))
              if (meta.width) {
                width = meta.width
                height = meta.height
              }
            } catch {}
            return
          }
          if (flags & FLAG_IMAGE) {
            createImageBitmap(new Blob([payload], { type: 'image/jpeg' }))
              .then((bitmap) => {
                if (!cancelled) draw(bitmap)
                bitmap.close()
              })
              .catch(() => {})
            return
          }
          if (flags & FLAG_CONFIG) {
            configBytes = payload.slice()
            configure()
            return
          }
          configure()
          if (!decoder) return
          try {
            decoder.decode(
              new EncodedVideoChunk({
                type: flags & FLAG_KEY ? 'key' : 'delta',
                timestamp: seq * 1000,
                data: configBytes ? concatBytes(configBytes, payload) : payload,
              }),
            )
          } catch {}
        }

        const pump = async (streamUrl) => {
          const response = await fetch(streamUrl, { signal: controller.signal, cache: 'no-store' })
          if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
          reader = response.body.getReader()
          let buffer = new Uint8Array(0)
          for (;;) {
            const { value, done } = await reader.read()
            if (done) throw new Error('stream ended')
            buffer = concatBytes(buffer, value)
            for (;;) {
              if (buffer.length < 9) break
              const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
              const length = view.getUint32(0, true)
              if (buffer.length < 9 + length) break
              const flags = buffer[4]
              const seq = view.getUint32(5, true)
              const payload = buffer.slice(9, 9 + length)
              buffer = buffer.slice(9 + length)
              onFrame(flags, seq, payload)
            }
          }
        }

        const run = async () => {
          let attempt = 0
          while (!cancelled) {
            attempt += 1
            setStatus({ phase: attempt === 1 ? 'waiting' : 'retry' })
            try {
              await pump(attempt === 1 ? url : `${url}&restart=1`)
              return
            } catch (error) {
              if (cancelled) return
              disposeDecoder()
              configBytes = null
              if (attempt >= 4) {
                setStatus({ phase: 'failed', message: error?.message ?? String(error) })
                return
              }
              await sleep(1200)
            }
          }
        }

        run()

        return () => {
          cancelled = true
          controller.abort()
          try {
            reader?.cancel()
          } catch {}
          disposeDecoder()
        }
      }, [url, canvasRef, setStatus])
    }

    function RefreshIcon() {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M13 8a5 5 0 1 1-1.6-3.7M13 2.5V5h-2.5',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function SendIcon() {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M8 12.5V3.5M8 3.5 4 7.5M8 3.5l4 4',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function PhoneMini() {
      return h(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('rect', {
          x: 4.5,
          y: 1.5,
          width: 7,
          height: 13,
          rx: 1.6,
          stroke: 'currentColor',
          strokeWidth: 1.2,
        }),
      )
    }

    function ModeMini() {
      return h(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('rect', {
          x: 2.5,
          y: 4.5,
          width: 11,
          height: 8,
          rx: 2.5,
          stroke: 'currentColor',
          strokeWidth: 1.2,
        }),
        h('circle', { cx: 6, cy: 8.5, r: 0.9, fill: 'currentColor' }),
        h('circle', { cx: 10, cy: 8.5, r: 0.9, fill: 'currentColor' }),
      )
    }

    function ShieldMini() {
      return h(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M8 1.8 13 3.6v4.2c0 3-2.1 5.2-5 6.4-2.9-1.2-5-3.4-5-6.4V3.6L8 1.8Z',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
      )
    }

    function ModelMini() {
      return h(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M8 2.2 9.5 6.5 13.8 8 9.5 9.5 8 13.8 6.5 9.5 2.2 8 6.5 6.5Z',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
      )
    }

    function CheckMini() {
      return h(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M3 8.5 6.2 11.7 13 4.4',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function PlusMini() {
      return h(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M8 3.2v9.6M3.2 8h9.6',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
      )
    }

    function FolderMini() {
      return h(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M1.8 4.6c0-.8.6-1.4 1.4-1.4h2.6l1.4 1.6h5c.8 0 1.4.6 1.4 1.4v5.2c0 .8-.6 1.4-1.4 1.4H3.2c-.8 0-1.4-.6-1.4-1.4V4.6Z',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
      )
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      /** 预设/权限的显示名是前端本地化文案，宿主只给 id；查不到就退回 id，别显示成 `preset.standard`。 */
      const label = (prefix, id) => {
        if (!id) return ''
        const key = `${prefix}.${id}`
        const text = t(key)
        return text === key ? id : text
      }

      /** 直接用插件图标文件（宿主在 `<base>/icon.svg` 上发它），不再另画简化版。 */
      function BrandImage(props) {
        const size = props?.size ?? 13
        const base = bootBase()
        if (!base) return null
        return h('img', {
          src: `${base}/icon.svg`,
          width: size,
          height: size,
          alt: '',
          'aria-hidden': true,
          style: { display: 'block', width: `${size}px`, height: `${size}px` },
        })
      }

      function GuideIcon() {
        return h(BrandImage, { size: 20 })
      }

      function MobileTitle() {
        return h(
          'span',
          { style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } },
          h(BrandImage, { size: 13 }),
          h('span', null, t('type.label')),
        )
      }

      /**
       * 自绘下拉。宿主 composer 的芯片就是这种：无边框文字 + 图标 + ˅，展开是一个浮层列表。
       * 键盘（Enter/空格开、↑↓移动、Enter 选、Esc 关）和点击外部关闭都在这里补齐。
       * `multiple` 打开多选：行内勾选、点选不收起，配合 `values` + `onToggle`。
       */
      function Picker(props) {
        const {
          icon: Icon,
          title,
          value,
          values,
          entries,
          onChange,
          onToggle,
          onOpenChange,
          action,
          headAction,
          multiple,
          label: chipLabel,
        } = props
        const pickedValues = values ?? []
        const isPicked = (candidate) =>
          multiple ? pickedValues.includes(candidate) : candidate === value
        const display = multiple
          ? chipLabel ?? title
          : (entries.find((entry) => entry.value === value)?.label ?? title)
        const [open, setOpen] = useState(false)
        const [placement, setPlacement] = useState({ up: false, alignRight: false, maxHeight: 240 })
        const [active, setActive] = useState(0)
        const rootRef = useRef(null)

        const close = () => {
          setOpen(false)
          onOpenChange?.(false)
        }

        useEffect(() => {
          if (!open) return undefined
          const onPointerDown = (event) => {
            if (!rootRef.current?.contains(event.target)) close()
          }
          const onKeyDown = (event) => {
            if (event.key === 'Escape') close()
          }
          // 菜单不是 fixed 定位，滚动后就会错位，直接收起最省事。
          const onScroll = () => close()
          document.addEventListener('pointerdown', onPointerDown, true)
          document.addEventListener('keydown', onKeyDown)
          document.addEventListener('scroll', onScroll, true)
          globalThis.addEventListener('resize', onScroll)
          return () => {
            document.removeEventListener('pointerdown', onPointerDown, true)
            document.removeEventListener('keydown', onKeyDown)
            document.removeEventListener('scroll', onScroll, true)
            globalThis.removeEventListener('resize', onScroll)
          }
        }, [open])

        const openMenu = (event) => {
          const trigger = event.currentTarget
          const rect = trigger.getBoundingClientRect()
          const panel = trigger.closest('.dmc-root')?.getBoundingClientRect()
          const bounds = panel ?? {
            top: 0,
            bottom: globalThis.innerHeight,
            left: 0,
            right: globalThis.innerWidth,
          }
          const below = bounds.bottom - rect.bottom - 12
          const above = rect.top - bounds.top - 12
          // 下方放不下就翻到上方，并把高度收进可用空间——菜单永远落在面板内，不会被滚动容器裁。
          const up = below < 200 && above > below
          // chip 贴着右边缘时改成右对齐，否则菜单会向右溢出被面板裁掉。
          const rightSpace = bounds.right - rect.right
          const leftSpace = rect.left - bounds.left
          const alignRight = rightSpace < MENU_WIDTH && leftSpace > rightSpace
          setPlacement({
            up,
            alignRight,
            maxHeight: Math.max(120, Math.min(240, up ? above : below)),
          })
          setActive(Math.max(0, entries.findIndex((entry) => entry.value === value)))
          setOpen(true)
          onOpenChange?.(true)
        }

        const choose = (next) => {
          if (multiple) {
            onToggle?.(next)
            return
          }
          onChange(next)
          close()
        }

        const onKeyDown = (event) => {
          if (!open) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              openMenu(event)
            }
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((index) => Math.min(index + 1, entries.length - 1))
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((index) => Math.max(index - 1, 0))
            return
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            const picked = entries[active]
            if (picked) choose(picked.value)
          }
        }

        const actionRow = (item) =>
          h(
            'button',
            {
              type: 'button',
              className: 'dmc-option',
              tabIndex: -1,
              onClick: () => {
                // 全选这类开关不该收起菜单，选完还能继续细挑
                if (!item.keepOpen) close()
                item.onSelect()
              },
            },
            item.icon ? h('span', { className: 'dmc-optionIcon' }, h(item.icon)) : null,
            h('span', { className: 'dmc-optionLabel' }, item.label),
          )

        return h(
          'span',
          { className: 'dmc-picker', ref: rootRef },
          h(
            'button',
            {
              type: 'button',
              className: 'dmc-chipBtn',
              title,
              'aria-haspopup': 'listbox',
              'aria-expanded': open,
              onClick: (event) => (open ? close() : openMenu(event)),
              onKeyDown,
            },
            Icon ? h(Icon) : null,
            h('span', { className: 'dmc-chipLabel' }, display),
          ),
          open
            ? h(
                'div',
                {
                  className: `dmc-menu${placement.up ? ' up' : ''}${
                    placement.alignRight ? ' right' : ''
                  }`,
                  style: { maxHeight: placement.maxHeight },
                  role: 'listbox',
                  'aria-label': title,
                  'aria-multiselectable': multiple ? 'true' : undefined,
                },
                headAction
                  ? h('div', { className: 'dmc-menuHead' }, actionRow(headAction))
                  : null,
                entries.map((entry, index) =>
                  h(
                    'button',
                    {
                      key: entry.value,
                      type: 'button',
                      role: 'option',
                      tabIndex: -1,
                      'aria-selected': isPicked(entry.value),
                      className: `dmc-option${isPicked(entry.value) ? ' on' : ''}${
                        index === active ? ' active' : ''
                      }`,
                      onPointerEnter: () => setActive(index),
                      onClick: () => choose(entry.value),
                    },
                    h('span', { className: 'dmc-optionLabel' }, entry.label),
                    isPicked(entry.value)
                      ? h('span', { className: 'dmc-optionCheck' }, h(CheckMini))
                      : null,
                  ),
                ),
                action ? h('div', { className: 'dmc-menuFoot' }, actionRow(action)) : null,
              )
            : null,
        )
      }

      function MobileBody(props) {
        const sessionId = props.sessionId
        const base = bootBase()
        const [state, setState] = useState(null)
        const [error, setError] = useState('')
        const [mirror, setMirror] = useState({ phase: 'waiting' })
        const [selected, setSelected] = useState([])
        const [prompt, setPrompt] = useState('')
        const [dispatching, setDispatching] = useState(false)
        const [results, setResults] = useState([])
        const [retryKey, setRetryKey] = useState(0)
        const [paneWidth, setPaneWidth] = useState(readPaneWidth)
        const [dragging, setDragging] = useState(false)
        const [options, setOptions] = useState(null)
        const [preset, setPreset] = useState('')
        const [permission, setPermission] = useState('')
        const [modelPick, setModelPick] = useState('')
        const [workspaces, setWorkspaces] = useState([])
        const [workspace, setWorkspace] = useState('')
        const [picking, setPicking] = useState(false)
        const canvasRef = useRef(null)
        const rootRef = useRef(null)
        const dragRef = useRef(null)

        const startDrag = (event) => {
          event.preventDefault()
          dragRef.current = { startX: event.clientX, startWidth: paneWidth }
          setDragging(true)
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {}
        }

        const moveDrag = (event) => {
          const drag = dragRef.current
          if (!drag) return
          const delta = drag.startX - event.clientX
          setPaneWidth(clampPaneWidth(drag.startWidth + delta, rootRef.current))
        }

        const endDrag = (event) => {
          if (!dragRef.current) return
          dragRef.current = null
          setDragging(false)
          try {
            event.currentTarget.releasePointerCapture(event.pointerId)
          } catch {}
          writePaneWidth(paneWidth)
        }

        const nudgePane = (event) => {
          const step = event.key === 'ArrowLeft' ? 24 : event.key === 'ArrowRight' ? -24 : 0
          if (step === 0) return
          event.preventDefault()
          const next = clampPaneWidth(paneWidth + step, rootRef.current)
          setPaneWidth(next)
          writePaneWidth(next)
        }

        /** 工作区列表来自客户端控制器；读不到就不显示这个芯片。 */
        const readWorkspaces = () => {
          try {
            const source = ctx.get('workspaces')?.list
            const snapshot = typeof source?.getSnapshot === 'function' ? source.getSnapshot() : source
            return snapshot?.items ?? []
          } catch {
            return []
          }
        }

        const refresh = useCallback(async () => {
          if (!base) return
          try {
            const response = await fetch(
              `${base}/state?sessionId=${encodeURIComponent(sessionId ?? '')}`,
              { cache: 'no-store' },
            )
            // 插件重载会换 token，旧页面里的 base 就 404 了——提示刷新，而不是抛一个英文 404。
            if (response.status === 404) throw new Error(t('rebooting'))
            const data = await response.json()
            if (!data.ok) throw new Error(data.error ?? t('state.failed'))
            setState(data)
            setError('')
            const list = readWorkspaces()
            setWorkspaces(list)
            // 默认跟随发起会话所在的工作区；用户手动选过就不再覆盖。
            setWorkspace(
              (current) =>
                current || list.find((item) => item.sessionIds?.includes(sessionId))?.workspaceId || '',
            )
          } catch (cause) {
            setError(cause?.message ?? String(cause))
          }
        }, [base, sessionId, t])

        useEffect(() => {
          if (!base) return undefined
          refresh()
          const timer = setInterval(refresh, 3000)
          return () => clearInterval(timer)
        }, [base, refresh])

        // 预设 / 权限 / 模型只取一次：它们是部署配置，不会在面板开着的几十秒里变。
        useEffect(() => {
          if (!base) return undefined
          let alive = true
          fetch(`${base}/options`, { cache: 'no-store' })
            .then((response) => response.json())
            .then((data) => {
              if (!alive || !data.ok) return
              setOptions(data)
              setPreset(
                (current) =>
                  current ||
                  data.presets?.find((item) => item.id === 'mobile-control')?.id ||
                  data.presets?.find((item) => item.isDefault)?.id ||
                  data.presets?.[0]?.id ||
                  '',
              )
              setPermission(
                (current) =>
                  current ||
                  data.permissions?.defaultPreset ||
                  data.permissions?.options?.[0]?.value ||
                  '',
              )
              setModelPick((current) => {
                if (current) return current
                const model = data.models?.default
                return model ? `${model.provider}|${model.model}` : ''
              })
            })
            .catch(() => {})
          return () => {
            alive = false
          }
        }, [base])

        const lease = state?.lease ?? null
        const devices = state?.devices ?? []
        const device = devices.find((item) => item.id === lease) ?? null

        const streamUrl =
          base && lease
            ? `${base}/stream/${encodeURIComponent(lease)}?sessionId=${encodeURIComponent(
                sessionId ?? '',
              )}&k=${retryKey}${retryKey > 0 ? '&restart=1' : ''}`
            : ''
        useMirror(canvasRef, streamUrl, setMirror)

        const post = useCallback(
          async (path, body) => {
            const response = await fetch(`${base}${path}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            })
            const data = await response.json()
            if (!data.ok) throw new Error(data.error ?? t('state.failed'))
            return data
          },
          [base, t],
        )

        const claim = async (deviceId) => {
          try {
            await post('/claim', { deviceId, sessionId })
            await refresh()
          } catch (cause) {
            setError(cause?.message ?? String(cause))
          }
        }

        const release = async () => {
          try {
            await post('/release', { sessionId })
            await refresh()
          } catch (cause) {
            setError(cause?.message ?? String(cause))
          }
        }

        /**
         * 添加工作区。优先让宿主弹一个 owner 指向当前窗口的对话框——宿主自带的
         * directoryPicker 是无 owner 的原生窗口，会被 DSH 主窗口压在下面。
         * 宿主拿不到 Electron（纯 Web 部署）时退回 pickDirectory()。
         */
        const addWorkspace = async () => {
          try {
            const picked = await post('/pick-directory', {})
            const path =
              picked.electron === true ? picked.path : await ctx.uiWorkspace?.pickDirectory?.()
            if (!path) return
            const created = await ctx.get('workspaces')?.create?.({ path })
            if (!created?.workspaceId) return
            setWorkspaces((list) =>
              list.some((item) => item.workspaceId === created.workspaceId)
                ? list
                : [...list, created],
            )
            setWorkspace(created.workspaceId)
          } catch (cause) {
            setError(cause?.message ?? String(cause))
          }
        }

        const toggle = (deviceId) => {
          setSelected((current) =>
            current.includes(deviceId)
              ? current.filter((id) => id !== deviceId)
              : [...current, deviceId],
          )
        }

        const toggleAll = () => {
          setSelected((current) =>
            current.length === devices.length && devices.length > 0
              ? []
              : devices.map((item) => item.id),
          )
        }

        const osLabel = (item) =>
          item?.os
            ? `${item.os} ${item.osVersion ?? ''}`.trim()
            : String(item?.platform ?? '').toUpperCase()

        const deviceLine = (item) =>
          [
            item.brand,
            item.width && item.height ? `${item.width}×${item.height}` : '',
            item.connection ? item.connection.toUpperCase() : '',
          ]
            .filter(Boolean)
            .join(' · ')

        const kv = (name, value) =>
          h('div', { className: 'dmc-kv' }, h('b', null, name), h('span', null, value ?? '—'))

        const presetEntries = (options?.presets ?? []).map((item) => ({
          value: item.id,
          label: label('preset', item.id),
        }))
        const permissionEntries = (options?.permissions?.options ?? []).map((item) => ({
          value: item.value,
          label: label('perm', item.value),
        }))
        const modelGroups = options?.models?.groups ?? []
        const modelEntries = modelGroups.flatMap((group) =>
          group.models.map((model) => ({ value: `${group.id}|${model.id}`, label: model.name })),
        )
        const workspaceEntries = workspaces.map((item) => ({
          value: item.workspaceId,
          label: item.title || item.path,
        }))

        // 型号唯一时只显示型号；撞型号（两台同款）才补序列号后 4 位来区分。
        const deviceEntries = devices.map((item) => {
          const clash = devices.some((other) => other.id !== item.id && other.model === item.model)
          return { value: item.id, label: clash ? `${item.model} · ${item.id.slice(-4)}` : item.model }
        })

        const dispatch = async () => {
          if (selected.length === 0) {
            setError(t('batch.empty'))
            return
          }
          if (!prompt.trim()) {
            setError(t('batch.promptEmpty'))
            return
          }
          setDispatching(true)
          setError('')
          try {
            const [provider, modelId] = modelPick.split('|')
            const chosenWorkspace = workspaces.find((item) => item.workspaceId === workspace)
            const data = await post('/dispatch', {
              deviceIds: selected,
              prompt,
              sessionId,
              ...(chosenWorkspace
                ? { workspaceId: chosenWorkspace.workspaceId, workspacePath: chosenWorkspace.path }
                : {}),
              ...(preset ? { agentPreset: preset } : {}),
              ...(permission ? { permission } : {}),
              ...(provider && modelId ? { model: { provider, model: modelId } } : {}),
            })
            setResults(data.results ?? [])
            await refresh()
          } catch (cause) {
            setError(cause?.message ?? String(cause))
          } finally {
            setDispatching(false)
          }
        }

        if (!base) {
          return h(
            'div',
            { className: 'dmc-host' },
            h(
              'div',
              { className: 'dmc-root' },
              h('style', null, CSS),
              h('div', { className: 'dmc-empty' }, t('rebooting')),
            ),
          )
        }

        const dotClass =
          mirror.phase === 'playing'
            ? 'dmc-dot on'
            : mirror.phase === 'failed'
              ? 'dmc-dot bad'
              : 'dmc-dot warn'

        const statusText =
          mirror.phase === 'playing'
            ? `${t('mirror.playing')} · ${mirror.width || '—'}×${mirror.height || '—'}`
            : mirror.phase === 'retry'
              ? t('mirror.retry')
              : mirror.phase === 'failed'
                ? t('mirror.failed')
                : t('mirror.waiting')

        // 首帧到之前不显示画布：默认 300×150 的黑块会让人以为手机坏了。
        const stageHolder =
          mirror.phase === 'failed'
            ? h(
                'div',
                { className: 'dmc-holder' },
                h('strong', null, t('mirror.failed')),
                h('span', { className: 'dmc-sub' }, mirror.message ?? ''),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dmc-btn',
                    onClick: () => setRetryKey((value) => value + 1),
                  },
                  t('mirror.retryAction'),
                ),
              )
            : h(
                'div',
                { className: 'dmc-holder' },
                h('span', { className: 'dmc-spin' }),
                h('strong', null, mirror.phase === 'retry' ? t('mirror.retry') : t('mirror.waiting')),
                device ? h('span', { className: 'dmc-sub' }, `${device.model} · ${device.id}`) : null,
              )

        const body =
          state === null
            ? h('div', { className: 'dmc-empty' }, t('state.loading'))
            : lease && device
              ? h(
                  'div',
                  { className: 'dmc-stage' },
                  h('canvas', {
                    ref: canvasRef,
                    className: mirror.phase === 'playing' ? 'dmc-canvas' : 'dmc-canvas off',
                  }),
                  mirror.phase === 'playing' ? null : stageHolder,
                )
              : devices.length === 0
                ? h('div', { className: 'dmc-empty' }, t('devices.empty'))
                : h(
                    'div',
                    { className: 'dmc-listWrap' },
                    h(
                      'div',
                      { className: 'dmc-h2' },
                      h('span', null, t('devices.title')),
                      h('span', { className: 'dmc-sub' }, String(devices.length)),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dmc-icon',
                          onClick: refresh,
                          title: t('refresh'),
                          'aria-label': t('refresh'),
                        },
                        h(RefreshIcon),
                      ),
                    ),
                    h(
                      'div',
                      { className: 'dmc-list' },
                      devices.map((item) =>
                        h(
                          'div',
                          { key: item.id, className: 'dmc-row' },
                          h(
                            'div',
                            { className: 'dmc-col' },
                            h(
                              'div',
                              { className: 'dmc-titleRow' },
                              h('span', { className: 'dmc-name' }, item.model),
                              h('span', { className: 'dmc-badge' }, osLabel(item)),
                            ),
                            h('div', { className: 'dmc-sub' }, deviceLine(item) || '—'),
                            h(
                              'div',
                              { className: 'dmc-sub' },
                              `${item.id} · ${
                                item.claimedBy === 'free'
                                  ? t('claimed.free')
                                  : item.claimedBy === 'me'
                                    ? t('claimed.me')
                                    : t('claimed.other')
                              }${item.state === 'online' ? '' : ` · ${item.state}`}`,
                          ),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className:
                              item.state === 'online' && item.claimedBy === 'free'
                                ? 'dmc-btn primary'
                                : 'dmc-btn',
                            // 被别人占用时这颗按钮改成跳转：直接去那个会话里解绑更符合直觉
                            onClick: () => {
                              if (item.claimedBy === 'free') claim(item.id)
                              else if (item.holderSessionId) {
                                ctx.uiWorkspace.openSession(item.holderSessionId)
                              }
                            },
                            disabled: item.state !== 'online' || item.claimedBy === 'me',
                          },
                          item.state !== 'online'
                            ? t('claim.unavailable')
                            : item.claimedBy === 'me'
                              ? t('claim.done')
                              : item.claimedBy === 'free'
                                ? t('claim')
                                : t('claim.goto'),
                        ),
                      ),
                    ),
                  ),
                  )

        const shell = h(
          'div',
          {
            className: `dmc-root${lease ? '' : ' idle'}${picking ? ' picking' : ''}`,
            ref: rootRef,
            style: { gridTemplateColumns: `minmax(0,1fr) 7px ${paneWidth}px` },
          },
          h('style', null, CSS),

          h(
            'div',
            { className: 'dmc-main' },
            error ? h('div', { className: 'dmc-error' }, error) : null,
            body,
            !lease && state !== null && devices.length > 0
              ? h('div', { className: 'dmc-hintText' }, t('idle.hint'))
              : null,
            state?.errors?.length
              ? h(
                  'div',
                  { className: 'dmc-notes' },
                  state.errors.map((item) => `${item.platform}: ${item.message}`).join('\n'),
                )
              : null,
          ),

          h('div', {
            className: dragging ? 'dmc-resizer active' : 'dmc-resizer',
            role: 'separator',
            'aria-orientation': 'vertical',
            'aria-label': t('splitter'),
            tabIndex: 0,
            onPointerDown: startDrag,
            onPointerMove: moveDrag,
            onPointerUp: endDrag,
            onPointerCancel: endDrag,
            onKeyDown: nudgePane,
          }),

          h(
            'div',
            { className: 'dmc-foot' },
            h(
              'div',
              { className: 'dmc-info' },
              kv(t('info.device'), device?.model),
              kv(t('info.os'), device ? osLabel(device) : undefined),
              kv(
                t('info.screen'),
                device?.width && device?.height ? `${device.width}×${device.height}` : undefined,
              ),
              kv(t('info.connection'), device?.connection ? device.connection.toUpperCase() : undefined),
              kv(t('info.serial'), device?.id),
            ),
            lease
              ? h(
                  'div',
                  { className: 'dmc-status' },
                  h('span', { className: dotClass }),
                  h(
                    'span',
                    {
                      className: 'dmc-statusText',
                      title: mirror.phase === 'playing' ? t('mirror.sizeHint') : undefined,
                    },
                    statusText,
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dmc-icon',
                      onClick: refresh,
                      title: t('refresh'),
                      'aria-label': t('refresh'),
                    },
                    h(RefreshIcon),
                  ),
                )
              : null,

            lease
              ? h(
                  'div',
                  { className: 'dmc-release' },
                  h('div', { className: 'dmc-hintText' }, t('lease.hint')),
                  h(
                    'button',
                    { type: 'button', className: 'dmc-btn', onClick: release },
                    t('release'),
                  ),
                )
              : null,

            lease ? null : h('div', { className: 'dmc-h2' }, t('batch.title')),
            lease ? null : h(
              'div',
              { className: 'dmc-form' },
              h(
                'div',
                { className: 'dmc-composer' },
                h('textarea', {
                  className: 'dmc-composerInput',
                  value: prompt,
                  placeholder: t('batch.placeholder'),
                  onChange: (event) => setPrompt(event.target.value),
                }),
                h(
                  'div',
                  { className: 'dmc-composerBar' },
                  // 设备选择回到 composer 里，靠左和其他芯片并排
                  h(Picker, {
                    icon: PhoneMini,
                    title: t('batch.pick'),
                    label: `${selected.length}/${devices.length}`,
                    multiple: true,
                    values: selected,
                    entries: deviceEntries,
                    onToggle: toggle,
                    onOpenChange: setPicking,
                    headAction: {
                      label:
                        devices.length > 0 && selected.length === devices.length
                          ? t('batch.clearAll')
                          : t('batch.selectAll'),
                      onSelect: toggleAll,
                      keepOpen: true,
                    },
                  }),
                  workspaceEntries.length > 0
                    ? h(Picker, {
                        icon: FolderMini,
                        title: t('opt.workspace'),
                        value: workspace,
                        entries: workspaceEntries,
                        onChange: setWorkspace,
                        onOpenChange: setPicking,
                        action: {
                          label: t('opt.addWorkspace'),
                          onSelect: addWorkspace,
                          icon: PlusMini,
                        },
                      })
                    : null,
                  presetEntries.length > 0
                    ? h(Picker, {
                        icon: ModeMini,
                        title: t('opt.preset'),
                        value: preset,
                        entries: presetEntries,
                        onChange: setPreset,
                        onOpenChange: setPicking,
                      })
                    : null,
                  permissionEntries.length > 0
                    ? h(Picker, {
                        icon: ShieldMini,
                        title: t('opt.permission'),
                        value: permission,
                        entries: permissionEntries,
                        onChange: setPermission,
                        onOpenChange: setPicking,
                      })
                    : null,
                  modelEntries.length > 0
                    ? h(Picker, {
                        icon: ModelMini,
                        title: t('opt.model'),
                        value: modelPick,
                        entries: modelEntries,
                        onChange: setModelPick,
                        onOpenChange: setPicking,
                      })
                    : null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dmc-send',
                      onClick: dispatch,
                      disabled: dispatching,
                      title: t('batch.submit'),
                      'aria-label': t('batch.submit'),
                    },
                    h(SendIcon),
                  ),
                ),
              ),
              selected.length > 0
                ? h(
                    'div',
                    { className: 'dmc-hintText' },
                    t('batch.plan').replace('{count}', String(selected.length)),
                  )
                : null,
              results.length > 0
                ? h(
                    'div',
                    { className: 'dmc-results' },
                    h('div', { className: 'dmc-sub' }, t('batch.result')),
                    results.map((item) =>
                      h(
                        'div',
                        { key: item.deviceId, className: 'dmc-row' },
                        h(
                          'div',
                          { className: 'dmc-col' },
                          h('div', { className: 'dmc-name' }, item.deviceId),
                          h(
                            'div',
                            { className: 'dmc-sub' },
                            item.ok ? item.sessionId : `${t('batch.failed')}: ${item.error}`,
                          ),
                        ),
                        item.ok
                          ? h(
                              'button',
                              {
                                type: 'button',
                                className: 'dmc-btn',
                                onClick: () => ctx.uiWorkspace.openSession(item.sessionId),
                              },
                              t('batch.open'),
                            )
                          : null,
                      ),
                    ),
                  )
                : null,
            ),
          ),
        )
        return h('div', { className: 'dmc-host' }, shell)
      }

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mobile-control: copy')

      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: ID,
            kind: KIND,
            multiple: false,
            priority: 'builtin',
            title: () => t('type.label'),
            guide: [
              {
                id: 'device',
                order: 40,
                title: () => t('guide.title'),
                description: () => t('guide.description'),
                icon: GuideIcon,
              },
            ],
          }),
        'mobile-control: tab type',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.pane.tab',
                key: ID,
                locale: NS,
                inject: (sessionId) => ({ sessionId }),
              },
              MobileBody,
            ),
          ),
        'mobile-control: body',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab.title', () =>
            ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: ID }, MobileTitle),
          ),
        'mobile-control: title',
      )
    }

    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'uiWorkspace'],
      apply,
    }
  },
})
