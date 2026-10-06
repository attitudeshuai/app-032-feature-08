/**
 * 圆周分格（每层绕圈分几格、每格一个颜色）—— 全应用唯一分格来源。
 *
 * 蒙面裁片页的格数与颜色、裁片图填色、备料/批量按格面积、三份导出单子
 * （裁片清单 / 配色清单 / 备料单）以及本机存档，全部由这里的 SegmentPlan 算出；
 * 改一次格数或颜色，各处跟着同一份方案刷新。
 *
 * 块数除不尽时只有两条路（存进方案的 remainder 字段，二选一并认下代价）：
 *  - merge-last：余数并入最后一格 —— 格数不多不少、配色清单整齐；
 *    代价是最后一格的块数比别的格多。
 *  - extra：余数单独成一格 —— 每格块数一样、绕圈匀称；
 *    代价是格数比指定的多一格、清单多一行，下料时容易数错。
 */
import type { Lantern, RemainderMode } from './types'

export interface SegmentPlan {
  layerIndex: number
  /** 该层裁片总块数（棱柱/方灯 = 棱数；旋转体 = 母线等分数） */
  panelCount: number
  /** 用户指定的格数（已夹到 1 ~ panelCount） */
  requested: number
  /** 实际格数（余数单独成格时 = requested + 1） */
  actual: number
  /** 每格块数（长度 = actual，合计 = panelCount） */
  counts: number[]
  /** 每格起始块序号（0 起，绕圈） */
  starts: number[]
  /** 每格颜色（长度 = actual，缺色已回落到层色） */
  colors: string[]
  /** 每格块数基准 ⌊panelCount / requested⌋ */
  base: number
  /** 余数块数（0 = 整除） */
  remainder: number
  /** 余数取舍 */
  remainderMode: RemainderMode
  /** 分法：single 未分格 / one-each 一块一色 / grouped 几块一组 / even 按角度均分（带余数） */
  method: 'single' | 'one-each' | 'grouped' | 'even'
  /** 分法一句话说明 */
  methodLabel: string
  /** 余数归属 / 未分格原因（以哪个为准写死在这里） */
  note: string
  /** 选中那条路的代价（整除时为空串） */
  cost: string
  /** 输入被夹取时的提示（如格数超过块数） */
  clampNote: string
}

/** 每一层绕一圈的裁片块数：棱柱/方灯 = 棱数；旋转体 = 母线等分数；多面体无分层裁片 */
export function layerPanelCount(l: Lantern): number {
  if (l.kind === 'polyhedron') return 0
  if (l.kind === 'prism' || l.kind === 'box') return Math.max(3, Math.round(l.sides))
  return Math.max(3, Math.round(l.divisions))
}

/** 计算一层的分格方案（唯一入口；N 由灯型与等分数推出，不在界面另存一份） */
export function computeLayerPlan(l: Lantern, layerIndex: number): SegmentPlan {
  const N = layerPanelCount(l)
  const layerColor = l.layerColors[layerIndex] || l.color
  const setting = l.layerSegments?.[layerIndex] ?? null

  let clampNote = ''
  let requested = Math.round(setting?.count ?? 1)
  if (!Number.isFinite(requested) || requested < 1) {
    if (setting) clampNote = '格数至少为 1，已按 1（未分格）计'
    requested = 1
  }
  if (N > 0 && requested > N) {
    clampNote = `格数不能超过这一层的块数 ${N}，已按 ${N} 计（一块一色）`
    requested = N
  }

  const remainderMode: RemainderMode = setting?.remainder === 'extra' ? 'extra' : 'merge-last'
  const base = N > 0 ? Math.floor(N / requested) : 0
  const remainder = N > 0 ? N % requested : 0

  let actual = requested
  let counts: number[]
  if (N <= 0 || requested <= 1) {
    actual = 1
    counts = [Math.max(0, N)]
  } else if (remainder === 0) {
    counts = Array.from({ length: requested }, () => base)
  } else if (remainderMode === 'extra') {
    actual = requested + 1
    counts = [...Array.from({ length: requested }, () => base), remainder]
  } else {
    counts = [...Array.from({ length: requested - 1 }, () => base), base + remainder]
  }

  const starts: number[] = []
  let acc = 0
  for (const c of counts) {
    starts.push(acc)
    acc += c
  }

  const colors = Array.from({ length: actual }, (_, s) => {
    if (actual <= 1) return layerColor
    return setting?.colors?.[s] || layerColor
  })

  let method: SegmentPlan['method']
  let methodLabel: string
  let note: string
  let cost = ''
  if (actual <= 1) {
    method = 'single'
    methodLabel = '未分格 · 整层一色'
    note = `未分格原因：这一层没有设置圆周分格（格数 1），整层 ${N} 块沿用层配色 ${layerColor}；要绕圈换色请把格数调到 2 以上`
  } else if (requested === N) {
    method = 'one-each'
    methodLabel = `一块一色 × ${N} 格`
    note = `格数 = 块数 ${N}，每块一格、绕圈一一对应，无余数`
  } else if (remainder === 0) {
    method = 'grouped'
    methodLabel = `${base} 块一组 × ${requested} 格`
    note = `整除：${N} ÷ ${requested} = 每格 ${base} 块，无余数`
  } else {
    method = 'even'
    if (remainderMode === 'extra') {
      methodLabel = `按角度均分 ${requested} 格 + 余数格`
      note = `除不尽：${N} ÷ ${requested} = 每格 ${base} 块余 ${remainder} 块；余 ${remainder} 块单独成第 ${actual} 格（绕圈最后 ${remainder} 块归它），各格块数以本方案为准`
      cost = `代价：格数比指定的 ${requested} 多 1 格（实际 ${actual} 格）、配色清单多一行，下料时容易数错；换来每格块数一样（${base} 块）、绕圈装上去匀称`
    } else {
      methodLabel = `按角度均分 ${requested} 格（余数并末格）`
      note = `除不尽：${N} ÷ ${requested} = 每格 ${base} 块余 ${remainder} 块；余 ${remainder} 块并入最后一格（第 ${actual} 格 ${base}+${remainder}=${base + remainder} 块，其余每格 ${base} 块），各格块数以本方案为准`
      cost = `代价：最后一格（第 ${actual} 格）块数比别的格多 ${remainder}；换来格数不多不少（${requested} 格）、配色清单整齐`
    }
  }

  return {
    layerIndex,
    panelCount: N,
    requested,
    actual,
    counts,
    starts,
    colors,
    base,
    remainder,
    remainderMode,
    method,
    methodLabel,
    note,
    cost,
    clampNote
  }
}

/** 全部层的分格方案（与 l.layers 对齐） */
export function computeLayerPlans(l: Lantern): SegmentPlan[] {
  return l.layers.map((_, i) => computeLayerPlan(l, i))
}

/** 绕圈块序号区间：单块显示「4」，多块显示「4–6」（1 起） */
export function fmtBlockRange(from: number, to: number): string {
  return from === to ? `${from}` : `${from}–${to}`
}

/** 分格用量行：蒙面面积按格拆开（单灯，面积 mm² 原始值，展示时折 m² 留三位小数） */
export interface SegmentFabricRow {
  layerIndex: number
  segmentIndex: number
  segmentCount: number
  color: string
  /** 该格块数（整数） */
  qty: number
  /** 绕圈块序号（1 起） */
  from: number
  to: number
  methodLabel: string
  /** 单灯该格蒙面面积（含缝份，mm²） */
  areaMm2: number
}
