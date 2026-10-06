/**
 * 灯样存储（Vue 自带响应式 + localStorage，无 Pinia/Vuex）
 * 灯型库与工艺参数来自本地打包 src/data/lantern-types.json，断网可用。
 */
import { reactive, watch } from 'vue'
import type { CellMode, Lantern, RemainderRule } from './types'
import { CRAFT, coveringSpec, presetById, PRESETS } from './craft'
import { buildGeometry, effectiveHeight, r1 } from './geometry'
import { defaultLayerCells, layerPieceCount } from './cells'

const KEY = 'lantern-frame-lofting.v1'

interface StoreState {
  lanterns: Lantern[]
  ready: boolean
  storageError: string
}

export const state = reactive<StoreState>({ lanterns: [], ready: false, storageError: '' })

let suspendPersist = false
let timer: number | undefined

function makeId(): string {
  return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function r1v(v: number): number {
  return Math.round(v * 10) / 10
}

/** 依据灯型库预设新建灯样 */
export function createFromPreset(presetId: string): Lantern {
  const preset = presetById(presetId) || PRESETS[0]
  const p = preset.params
  const count = Math.max(1, Math.round(p.layerCount))
  const each = p.totalHeightMm / count
  const layers = Array.from({ length: count }, () => ({ heightMm: r1v(each), diameterMm: 0 }))
  // 保证分段高度之和 = 总高
  const sum = layers.reduce((s, x) => s + x.heightMm, 0)
  layers[layers.length - 1].heightMm = r1v(layers[layers.length - 1].heightMm + (p.totalHeightMm - sum))

  const now = new Date().toISOString()
  const lantern: Lantern = {
    id: makeId(),
    kind: preset.kind,
    name: preset.name,
    maxDiameterMm: p.maxDiameterMm,
    totalHeightMm: p.totalHeightMm,
    mouthDiameterMm: p.mouthDiameterMm,
    baseDiameterMm: p.baseDiameterMm,
    sides: p.sides,
    layers,
    mouthStyle: p.mouthStyle,
    bottomStyle: p.bottomStyle,
    smoothness: p.smoothness,
    ctrl1: p.ctrl1 ? { ...p.ctrl1 } : { x: 0.12, y: 0.3 },
    ctrl2: p.ctrl2 ? { ...p.ctrl2 } : { x: 0.85, y: 0.78 },
    divisions: p.divisions ?? CRAFT.defaultDivisions,
    covering: p.covering,
    seamAllowanceMm: CRAFT.defaultSeamAllowanceMm,
    lashAllowanceMm: CRAFT.defaultLashAllowanceMm,
    layerColors: [...p.layerColors],
    layerCells: [],
    cellsRevision: 1,
    voidedRevisions: [],
    color: p.color,
    batchCount: 20,
    wasteRatio: coveringSpec(p.covering).wasteRatio,
    pageSize: 'A4',
    overlapMm: CRAFT.defaultOverlapMm,
    createdAt: now,
    updatedAt: now
  }
  syncLayerDiameters(lantern)
  return lantern
}

/** 把轮廓算出的直径写回分段（数据模型 §7 中 layers[].diameterMm） */
export function syncLayerDiameters(l: Lantern) {
  const g = buildGeometry(l)
  l.layers.forEach((ly, i) => {
    const sec = g.sections[i + 1]
    if (sec) ly.diameterMm = r1(sec.radiusMm * 2)
  })
  l.totalHeightMm = r1(effectiveHeight(l))
  syncLayerCells(l)
}

/**
 * 保证 layerCells / layerColors 与层数、块数一致：
 * layerCells 是分格的唯一存档；layerColors 仅为兼容旧字段，由每层第 1 格颜色同步。
 */
export function syncLayerCells(l: Lantern) {
  if (!Array.isArray(l.layerCells)) l.layerCells = []
  const count = l.layers.length
  for (let i = 0; i < count; i++) {
    if (!l.layerCells[i]) l.layerCells[i] = defaultLayerCells(l, i)
    normalizeLayerCell(l, i)
  }
  if (l.layerCells.length > count) l.layerCells.length = count
  if (typeof l.cellsRevision !== 'number') l.cellsRevision = 1
  if (!Array.isArray(l.voidedRevisions)) l.voidedRevisions = []
  // 兼容字段回写：每层第 1 格颜色
  l.layerColors = l.layerCells.map((c, i) => c.cells[0]?.color || l.layerColors[i] || l.color)
}

/** 一层分格内部规整：格数夹取、colors 长度补齐（不替用户决定 custom 块数，保留原值供报错） */
function normalizeLayerCell(l: Lantern, i: number) {
  const spec = l.layerCells[i]
  if (!spec) return
  if (!['whole', 'perPiece', 'equal', 'custom'].includes(spec.mode)) spec.mode = 'whole'
  if (spec.remainder !== 'last' && spec.remainder !== 'extra') spec.remainder = 'last'
  const N = Math.max(1, layerPieceCount(l, i))
  const fallback = l.layerColors[i] || l.color
  const ensureColor = (idx: number) => {
    if (!spec.cells[idx]) spec.cells[idx] = { color: fallback, pieces: 0 }
    if (!spec.cells[idx].color) spec.cells[idx].color = fallback
    spec.cells[idx].pieces = Math.max(0, Math.round(spec.cells[idx].pieces) || 0)
  }
  if (spec.mode === 'whole') {
    spec.cellCount = 1
    spec.cells = [{ color: spec.cells[0]?.color || fallback, pieces: N }]
  } else if (spec.mode === 'perPiece') {
    spec.cellCount = N
    for (let k = 0; k < N; k++) ensureColor(k)
    spec.cells = spec.cells.slice(0, N).map((c) => ({ color: c.color, pieces: 1 }))
  } else if (spec.mode === 'equal') {
    spec.cellCount = Math.max(1, Math.min(N, Math.round(spec.cellCount) || 1))
    for (let k = 0; k < spec.cellCount; k++) ensureColor(k)
    spec.cells = spec.cells.slice(0, spec.cellCount)
  } else {
    for (let k = 0; k < spec.cells.length; k++) ensureColor(k)
    spec.cellCount = spec.cells.length
  }
  // 兼容字段即时同步：该层主色 = 第 1 格颜色（预览带等旧入口读它）
  if (spec.cells.length > 0) {
    const layerCount = l.layers.length
    if (!Array.isArray(l.layerColors) || l.layerColors.length < layerCount) {
      l.layerColors = Array.from({ length: layerCount }, (_, k) => l.layerColors?.[k] || l.color)
    }
    l.layerColors[i] = spec.cells[0].color
  }
}

/** 改一层分格方式；自动给出该方式下的初始格数与颜色（沿用旧颜色） */
export function setCellMode(l: Lantern, i: number, mode: CellMode) {
  const N = Math.max(1, layerPieceCount(l, i))
  const cur = l.layerCells[i] || defaultLayerCells(l, i)
  const oldColors = cur.cells.map((c) => c.color)
  const colorAt = (k: number) => oldColors[Math.min(k, oldColors.length - 1)] || l.layerColors[i] || l.color
  if (mode === 'whole') {
    l.layerCells[i] = { mode, cellCount: 1, remainder: cur.remainder, cells: [{ color: colorAt(0), pieces: N }] }
  } else if (mode === 'perPiece') {
    l.layerCells[i] = {
      mode,
      cellCount: N,
      remainder: cur.remainder,
      cells: Array.from({ length: N }, (_, k) => ({ color: colorAt(k), pieces: 1 }))
    }
  } else if (mode === 'equal') {
    const k = Math.max(1, Math.min(N, cur.mode === 'equal' ? cur.cellCount : Math.min(N, 4)))
    l.layerCells[i] = {
      mode,
      cellCount: k,
      remainder: cur.remainder,
      cells: Array.from({ length: k }, (_, idx) => ({ color: colorAt(idx), pieces: 0 }))
    }
  } else {
    const k = Math.max(1, Math.min(N, cur.mode === 'custom' ? cur.cells.length : Math.min(N, 2)))
    const base = Math.floor(N / k)
    const rem = N - base * k
    l.layerCells[i] = {
      mode,
      cellCount: k,
      remainder: cur.remainder,
      cells: Array.from({ length: k }, (_, idx) => ({ color: colorAt(idx), pieces: base + (idx === k - 1 ? rem : 0) }))
    }
  }
  normalizeLayerCell(l, i)
  bumpCellsRevision(l)
}

export function setCellCount(l: Lantern, i: number, count: number) {
  const spec = l.layerCells[i]
  if (!spec || spec.mode !== 'equal') return
  const N = Math.max(1, layerPieceCount(l, i))
  const k = Math.max(1, Math.min(N, Math.round(count) || 1))
  const oldColors = spec.cells.map((c) => c.color)
  spec.cellCount = k
  spec.cells = Array.from({ length: k }, (_, idx) => ({
    color: oldColors[idx] || oldColors[oldColors.length - 1] || l.layerColors[i] || l.color,
    pieces: 0
  }))
  normalizeLayerCell(l, i)
  bumpCellsRevision(l)
}

export function setRemainderRule(l: Lantern, i: number, remainder: RemainderRule) {
  const spec = l.layerCells[i]
  if (!spec) return
  spec.remainder = remainder
  bumpCellsRevision(l)
}

export function setCellColor(l: Lantern, i: number, cellIdx: number, color: string) {
  const spec = l.layerCells[i]
  if (!spec || !spec.cells[cellIdx]) return
  spec.cells[cellIdx].color = color
  normalizeLayerCell(l, i)
  bumpCellsRevision(l)
}

/** custom：改某格块数（0 允许，界面报「不能空着」，导出禁用） */
export function setCellPieces(l: Lantern, i: number, cellIdx: number, pieces: number) {
  const spec = l.layerCells[i]
  if (!spec || spec.mode !== 'custom' || !spec.cells[cellIdx]) return
  spec.cells[cellIdx].pieces = Math.max(0, Math.round(pieces) || 0)
  normalizeLayerCell(l, i)
  bumpCellsRevision(l)
}

export function addCustomCell(l: Lantern, i: number) {
  const spec = l.layerCells[i]
  const N = Math.max(1, layerPieceCount(l, i))
  if (!spec || spec.mode !== 'custom' || spec.cells.length >= N) return
  spec.cells.push({ color: l.color, pieces: 0 })
  normalizeLayerCell(l, i)
  bumpCellsRevision(l)
}

export function removeCustomCell(l: Lantern, i: number, cellIdx: number) {
  const spec = l.layerCells[i]
  if (!spec || spec.mode !== 'custom' || spec.cells.length <= 1) return
  spec.cells.splice(cellIdx, 1)
  normalizeLayerCell(l, i)
  bumpCellsRevision(l)
}

/** 分格（格数或颜色）改动后版本 +1；若已按旧版导出过，旧单自动过期 */
export function bumpCellsRevision(l: Lantern) {
  l.cellsRevision = (Math.max(1, Math.round(l.cellsRevision) || 1)) + 1
  l.updatedAt = new Date().toISOString()
}

/** 记录「已按当前版导出」（下载裁片清单/配色清单/备料单时调用） */
export function markCellsExported(l: Lantern) {
  syncLayerCells(l)
  l.exportedRevision = l.cellsRevision
  l.exportedAt = new Date().toISOString()
}

/** 已导出的单子是否已过期（分格版本比导出时新） */
export function cellsExportStale(l: Lantern): boolean {
  return typeof l.exportedRevision === 'number' && l.exportedRevision < l.cellsRevision
}

/**
 * 挑错的那一版已存档且已导出：把旧版分格与已发出单子/图纸作废重出。
 * 旧档分格版本记入 voidedRevisions 留痕；已裁好的布需重裁在界面与新单子上点明。
 */
export function voidExportedCells(l: Lantern, reason: string) {
  const rev = typeof l.exportedRevision === 'number' ? l.exportedRevision : l.cellsRevision - 1
  l.voidedRevisions.push({ revision: rev, reason: reason || '分法取舍选错，旧版作废', at: new Date().toISOString() })
  l.exportedRevision = undefined
  l.exportedAt = undefined
}

/** 分段高度均分（改总高/层数时调用） */
export function distributeLayers(l: Lantern) {
  const count = Math.max(1, Math.round(l.layers.length))
  const each = l.totalHeightMm / count
  l.layers = Array.from({ length: count }, () => ({ heightMm: r1v(each), diameterMm: 0 }))
  const sum = l.layers.reduce((s, x) => s + x.heightMm, 0)
  l.layers[count - 1].heightMm = r1v(l.layers[count - 1].heightMm + (l.totalHeightMm - sum))
  syncLayerCells(l)
  syncLayerDiameters(l)
}

export function addLantern(l: Lantern) {
  state.lanterns.unshift(l)
  return l
}

export function getLantern(id: string): Lantern | undefined {
  return state.lanterns.find((l) => l.id === id)
}

export function duplicateLantern(id: string): Lantern | undefined {
  const src = getLantern(id)
  if (!src) return undefined
  const copy: Lantern = JSON.parse(JSON.stringify(src))
  copy.id = makeId()
  copy.name = src.name + ' 副本'
  copy.createdAt = copy.updatedAt = new Date().toISOString()
  state.lanterns.unshift(copy)
  return copy
}

export function removeLantern(id: string) {
  const i = state.lanterns.findIndex((l) => l.id === id)
  if (i >= 0) state.lanterns.splice(i, 1)
}

function persistNow() {
  suspendPersist = true
  try {
    for (const l of state.lanterns) {
      syncLayerDiameters(l)
    }
    localStorage.setItem(KEY, JSON.stringify({ version: 2, lanterns: state.lanterns }))
    state.storageError = ''
  } catch (e) {
    state.storageError = e instanceof Error ? e.message : String(e)
  } finally {
    suspendPersist = false
  }
}

function schedulePersist() {
  if (timer !== undefined) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = undefined
    persistNow()
  }, 180)
}

/** 载入本地灯样；首次进入预置一个六角宫灯，便于立即放样 */
export function loadStore() {
  if (state.ready) return
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw) as { lanterns?: Lantern[] }
      if (Array.isArray(data.lanterns)) {
        // 旧档迁移：无 layerCells 的灯样按「整块一色」补建（沿用旧 layerColors）
        state.lanterns = data.lanterns
        for (const l of state.lanterns) {
          if (!Array.isArray(l.layerCells) || l.layerCells.length !== l.layers.length) {
            l.layerCells = l.layers.map((_, i) => defaultLayerCells(l, i))
            l.cellsRevision = 1
            l.voidedRevisions = Array.isArray(l.voidedRevisions) ? l.voidedRevisions : []
          }
          syncLayerCells(l)
        }
      }
    }
  } catch {
    state.storageError = '本地灯样数据损坏，已重置'
  }
  if (state.lanterns.length === 0) {
    state.lanterns.push(createFromPreset('hex-palace'))
  }
  state.ready = true
  watch(
    () => state.lanterns,
    () => {
      if (suspendPersist) return
      schedulePersist()
    },
    { deep: true }
  )
  persistNow()
}

export function useLanternStore() {
  return {
    state,
    createFromPreset,
    addLantern,
    getLantern,
    duplicateLantern,
    removeLantern,
    distributeLayers,
    syncLayerDiameters,
    syncLayerCells,
    setCellMode,
    setCellCount,
    setRemainderRule,
    setCellColor,
    setCellPieces,
    addCustomCell,
    removeCustomCell,
    bumpCellsRevision,
    markCellsExported,
    cellsExportStale,
    voidExportedCells
  }
}
