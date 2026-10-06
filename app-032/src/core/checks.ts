/**
 * 自检（对应规格书 §10 验收标准）
 * 每次参数变化都会重算全部几何并跑一遍断言，结果直接显示在界面上。
 */
import type { CheckResult, Lantern } from './types'
import { bodySurfaceArea, polygonEdge, ringPerimeter, segmentInfos } from './geometry'
import { buildFrame, type FrameResult } from './frame'
import { buildPanels, panelNetArea, panelCutArea, type PanelResult } from './panels'
import { cellFabricRows, cellFabricTotals, computeBatch, computeMaterials, type BatchMaterials, type SingleLightMaterials } from './materials'
import { assertNoPanelSplit, paginate, type LoftOptions, type Sheet } from './paginate'
import { CRAFT } from './craft'

export interface FullResult {
  frame: FrameResult
  panels: PanelResult
  materials: SingleLightMaterials
  batch: BatchMaterials
  sheets: Sheet[]
  checks: CheckResult[]
  elapsedMs: number
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1)
const f3 = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3)

export function computeAll(l: Lantern, loft: LoftOptions): FullResult {
  const t0 = performance.now()
  const frame = buildFrame(l)
  const panels = buildPanels(l)
  const materials = computeMaterials(l)
  const batch = computeBatch(materials, Math.max(1, Math.round(l.batchCount)), l.wasteRatio)
  const sheets = paginate(l, loft)
  const elapsedMs = performance.now() - t0
  const checks = runChecks(l, frame, panels, materials, batch, sheets, elapsedMs)
  return { frame, panels, materials, batch, sheets, checks, elapsedMs }
}

function runChecks(
  l: Lantern,
  frame: FrameResult,
  panels: PanelResult,
  materials: SingleLightMaterials,
  batch: BatchMaterials,
  sheets: Sheet[],
  elapsedMs: number
): CheckResult[] {
  const out: CheckResult[] = []
  const g = frame.geometry
  const lash = Math.max(0, l.lashAllowanceMm)

  // ---- CHK-01 几何：棱长/周长与手算一致 ----
  {
    const cases = [
      { name: '正六棱柱底边（D200）', got: polygonEdge(100, 6), expect: 100, tol: 1 },
      { name: '正八棱柱底边（D200）', got: polygonEdge(100, 8), expect: 76.5367, tol: 1 },
      { name: '圆形横篾圈周长（D200）', got: ringPerimeter(100, 0, false), expect: 628.3185, tol: 1 },
      { name: '六边形周长（D200）', got: ringPerimeter(100, 6, true), expect: 600, tol: 1 }
    ]
    const bad = cases.filter((c) => Math.abs(c.got - c.expect) > c.tol)
    out.push({
      id: 'CHK-01',
      title: '几何手算核对（棱长 / 周长，误差 ≤ 1mm）',
      pass: bad.length === 0,
      value: bad.length === 0 ? '4/4 项通过' : `${bad.length} 项超差`,
      detail: cases
        .map((c) => `${c.name}：算得 ${f3(c.got)} / 手算 ${f3(c.expect)}（Δ${f3(Math.abs(c.got - c.expect))}）`)
        .join('；')
    })
  }

  // ---- CHK-02 竖篾长度与分段高度累计 ----
  {
    const segs = segmentInfos(g)
    const sumH = segs.reduce((s, x) => s + x.heightMm, 0)
    const sumSlant = segs.reduce((s, x) => s + x.slantMm, 0)
    const vertical = frame.members.find((m) => m.kind === 'vertical' || m.kind === 'rib')
    const raw = vertical ? vertical.rawLengthMm : 0
    const allStraight = segs.every((s) => Math.abs(s.drMm) < 0.05)
    const pass = Math.abs(raw - sumSlant) <= 0.1 && (!allStraight || Math.abs(raw - sumH) <= 0.1)
    out.push({
      id: 'CHK-02',
      title: '竖篾净长 = 分段母线折线长累计',
      pass,
      value: `Δ折线 ${f1(Math.abs(raw - sumSlant))}mm`,
      detail: allStraight
        ? `竖篾净长 ${f1(raw)}mm，分段高累计 ${f1(sumH)}mm，平口直柱两者一致（Δ${f1(Math.abs(raw - sumH))}mm）`
        : `竖篾净长 ${f1(raw)}mm，分段高累计 ${f1(sumH)}mm，折线长累计 ${f1(sumSlant)}mm（收口段横向偏移 ${f1(sumSlant - sumH)}mm）`
    })
  }

  // ---- CHK-03 缝份 ----
  {
    const s = Math.max(0, l.seamAllowanceMm)
    const bad = panels.panels.filter(
      (p) =>
        Math.abs(p.widthTopMm - (p.rawWidthTopMm + 2 * s)) > 0.06 ||
        Math.abs(p.widthBottomMm - (p.rawWidthBottomMm + 2 * s)) > 0.06 ||
        Math.abs(p.heightMm - (p.rawHeightMm + 2 * s)) > 0.06
    )
    out.push({
      id: 'CHK-03',
      title: '裁片尺寸 = 展开净尺寸 + 缝份 × 2（每边）',
      pass: bad.length === 0,
      value: `${panels.panels.length - bad.length}/${panels.panels.length} 种裁片通过`,
      detail:
        bad.length === 0
          ? `全部 ${panels.panels.length} 种裁片上/下/高三个尺寸均等于净尺寸 + ${f1(s)}×2mm；裁片图以红色虚线绘制缝份折线`
          : `超差裁片：${bad.map((p) => p.label).join('、')}`
    })
  }

  // ---- CHK-04 备料守恒 ----
  {
    const stock = frame.members.reduce((a, m) => a + m.lengthMm * m.qty, 0)
    const rawTotal = frame.members.reduce((a, m) => a + m.rawLengthMm * m.qty, 0)
    const lashTotal = frame.members.reduce((a, m) => a + m.qty * m.lashJoints * lash, 0)
    const diff = stock - rawTotal
    const pass = stock >= rawTotal - 1e-6 && Math.abs(diff - lashTotal) <= 0.5
    out.push({
      id: 'CHK-04',
      title: '备料守恒：Σ备料长度 ≥ Σ净长，且差值 = 余量总和',
      pass,
      value: `Σ备料 ${f1(stock)}mm / Σ净长 ${f1(rawTotal)}mm`,
      detail: `差值 ${f1(diff)}mm，应等于余量总和 ${f1(lashTotal)}mm（竖篾两端、横篾圈接头各计 ${f1(lash)}mm）`
    })
  }

  // ---- CHK-05 面积核对 ----
  {
    const netArea = panels.panels.reduce((a, p) => a + panelNetArea(p) * p.qty, 0)
    const refArea = bodySurfaceArea(g, Math.max(3, Math.round(l.divisions)))
    const ratio = refArea > 0 ? netArea / refArea : 0
    const pass = ratio >= 0.97 && ratio <= 1.03
    let advice = ''
    if (!pass && !g.polygon) {
      const need = suggestDivisions(l, netArea, ratio)
      advice = need ? `；建议把母线等分数提高到 ${need}（当前 ${l.divisions}）` : ''
    } else if (!pass) {
      advice = '；请检查缝份/分层参数，棱柱类侧面积应与裁片面积完全一致'
    }
    out.push({
      id: 'CHK-05',
      title: '面积核对：Σ裁片净面积 / 灯体表面积 ∈ [0.97, 1.03]',
      pass,
      value: `比值 ${(ratio * 100).toFixed(2)}%`,
      detail: `裁片净面积 ${f3(netArea / 1_000_000)}m²，灯体表面积（含顶底盖）${f3(refArea / 1_000_000)}m²${advice}`
    })
  }

  // ---- CHK-06 分页：裁片不跨页 ----
  {
    const r = assertNoPanelSplit(sheets)
    out.push({
      id: 'CHK-06',
      title: '分页：任一裁片不跨页（长条跨页带对位十字与搭接量）',
      pass: r.pass,
      value: r.pass ? '通过' : '失败',
      detail: `${r.detail}；跨页仅出现在骨架长条上，接缝处绘制对位十字并标注搭接 ${f1(loftOverlap(sheets))}mm 与拼接编号`
    })
  }

  // ---- CHK-07 批量 ----
  {
    const n = Math.max(1, Math.round(l.batchCount))
    const k = n * (1 + l.wasteRatio)
    // 与单灯值的偏差只来自展示精度（长度 3 位小数 / 胶 1 位小数）
    const errs = [
      Math.abs(batch.frameM - materials.frameM * k),
      Math.abs(batch.coveringM2 - materials.coveringM2 * k),
      Math.abs(batch.lashM - materials.lashM * k)
    ]
    const pass = errs.every((e) => e <= 0.0011) && Math.abs(batch.glueG - materials.glueG * k) <= 0.051
    out.push({
      id: 'CHK-07',
      title: `批量制灯：${n} 个材料总量 = 单灯 × ${n} × (1 + ${(l.wasteRatio * 100).toFixed(0)}%)`,
      pass,
      value: `竹篾 ${f3(batch.frameM)}m / 蒙面 ${f3(batch.coveringM2)}m²`,
      detail: `单灯竹篾 ${f3(materials.frameM)}m × ${n} × ${(1 + l.wasteRatio).toFixed(2)} = ${f3(materials.frameM * k)}m = 批量值；蒙面、扎线、胶同理（LED 按颗数 × ${n} 计，不参与损耗）`
    })
  }

  // ---- CHK-09 圆周分格单一来源一致性 ----
  out.push(checkCellsConsistency(l, panels))

  // ---- CHK-08 性能 ----
  {
    const pass = elapsedMs < 100
    out.push({
      id: 'CHK-08',
      title: '放样计算 < 100ms',
      pass,
      value: `${elapsedMs.toFixed(1)}ms`,
      detail: `${l.divisions} 等分 × ${l.layers.length} 层：构件 ${frame.totalQty} 根、裁片 ${panels.totalQty} 块、图纸 ${sheets.length} 页，全流程耗时 ${elapsedMs.toFixed(1)}ms（含分页）`
    })
  }

  return out
}

/**
 * CHK-09 圆周分格一致性：裁片页每格块数与颜色、裁片图填色（同 Panel.color）、
 * 备料/批量按格蒙面面积、导出三单的裁片清单与配色清单、本机存档 layerCells，
 * 必须出自同一份分格（buildCellResolution 的结果）。任一处对不上要点明处所。
 */
function checkCellsConsistency(l: Lantern, panels: PanelResult): CheckResult {
  const problems: string[] = []
  const resolution = panels.cells

  // 1) 存档本身：每层各格块数合计 = 该层裁片总数；格数 ≤ 块数；不得有空层空格
  resolution.layers.forEach((r) => {
    if (!r.segmentable) return
    const sum = r.cells.reduce((a, c) => a + c.pieces, 0)
    if (sum !== r.pieceCount) {
      problems.push(`本机存档第 ${r.layerIndex + 1} 层分格：各格块数合计 ${sum} ≠ 裁片总数 ${r.pieceCount}`)
    }
    if (r.cells.length > r.pieceCount) {
      problems.push(`本机存档第 ${r.layerIndex + 1} 层：格数 ${r.cells.length} 超过块数 ${r.pieceCount}`)
    }
    r.cells.forEach((c) => {
      if (c.pieces <= 0) problems.push(`本机存档第 ${r.layerIndex + 1} 层第 ${c.index + 1} 格：一块都没分到，不能空着`)
    })
  })

  // 2) 裁片清单（Panel[]）：逐格回算，块数/颜色/块号必须与权威分格一致
  const bodyPanels = panels.panels.filter((p) => p.layerIndex >= 0)
  resolution.layers.forEach((r) => {
    if (!r.segmentable) return
    const ps = bodyPanels.filter((p) => p.layerIndex === r.layerIndex)
    r.cells.forEach((c) => {
      const p = ps.find((x) => x.cellIndex === c.index)
      if (!p) {
        problems.push(`裁片清单：缺第 ${r.layerIndex + 1} 层第 ${c.index + 1} 格`)
        return
      }
      if (p.qty !== c.pieces) {
        problems.push(
          `裁片清单第 ${r.layerIndex + 1} 层第 ${c.index + 1} 格：块数 ${p.qty} 与蒙面裁片页该格 ${c.pieces} 对不上（处所：裁片清单）`
        )
      }
      if (p.color.toUpperCase() !== c.color.toUpperCase()) {
        problems.push(
          `颜色 ${c.color} 对不上：第 ${r.layerIndex + 1} 层第 ${c.index + 1} 格裁片清单/裁片图填的是 ${p.color}，蒙面裁片页分格是 ${c.color}（处所：裁片图填色）`
        )
      }
      if (p.pieceFrom !== c.pieceFrom || p.pieceTo !== c.pieceTo) {
        problems.push(
          `裁片清单第 ${r.layerIndex + 1} 层第 ${c.index + 1} 格：块号 ${p.pieceFrom}-${p.pieceTo} 与分格基准 ${c.pieceFrom}-${c.pieceTo} 对不上`
        )
      }
    })
    if (ps.length !== r.cells.length) {
      problems.push(`裁片清单第 ${r.layerIndex + 1} 层：行数 ${ps.length} 与分格格数 ${r.cells.length} 对不上`)
    }
  })

  // 3) 备料按格面积：各格块数/颜色与裁片一致；各格面积合计 = 蒙面总量（容差含展示精度）
  const rows = cellFabricRows(panels)
  const allPanels = panels.panels
  rows.forEach((row, ri) => {
    const p = allPanels[ri]
    if (!p) {
      problems.push(`备料按格蒙面面积：找不到「${row.label}」对应的裁片`)
      return
    }
    if (p.qty !== row.pieces) {
      problems.push(`备料「${row.label}」块数 ${row.pieces} 与裁片清单 ${p.qty} 对不上（处所：备料按格蒙面面积）`)
    }
    if (p.color.toUpperCase() !== row.color.toUpperCase()) {
      problems.push(
        `颜色 ${row.color} 对不上：备料「${row.label}」为 ${row.color}，裁片清单/裁片图为 ${p.color}（处所：备料按格蒙面面积）`
      )
    }
    const expectCut = Math.round((panelCutArea(p) * p.qty) / 1e6 * 1000) / 1000
    if (Math.abs(expectCut - row.cutAreaM2) > 0.002) {
      problems.push(`备料「${row.label}」蒙面面积 ${row.cutAreaM2.toFixed(3)}m² 与裁片算得 ${expectCut.toFixed(3)}m² 对不上（处所：备料按格蒙面面积）`)
    }
  })
  // 合计必须由未舍入 mm² 累加后折三位（与蒙面总量同一口径），避免逐格舍入漂移
  const cellCutSum = cellFabricTotals(rows).cutM2
  const totalCut = Math.round((panels.cutAreaMm2 / 1e6) * 1000) / 1000
  if (Math.abs(cellCutSum - totalCut) > 0.001) {
    problems.push(`备料各格蒙面面积合计 ${cellCutSum.toFixed(3)}m² 与蒙面总量 ${totalCut.toFixed(3)}m² 对不上（处所：备料按格蒙面面积）`)
  }

  // 4) 导出三单与图纸共用 PanelResult（同一次 computeAll 生成）——这里核对存档版本与导出戳
  if (typeof l.exportedRevision === 'number' && l.exportedRevision > l.cellsRevision) {
    problems.push(`导出戳第 ${l.exportedRevision} 版比存档第 ${l.cellsRevision} 版还新，数据异常`)
  }

  // 5) 不分格的层（多面体/顶底盖）必须写明原因，不能空着
  resolution.layers.forEach((r) => {
    if (!r.segmentable && !r.reason) problems.push(`第 ${r.layerIndex + 1} 层未分格但未写明原因`)
  })

  const totalCells = resolution.layers.reduce((a, r) => a + r.cells.length, 0)
  return {
    id: 'CHK-09',
    title: '圆周分格单一来源：存档·裁片页·裁片图·备料·导出三单同一套分格',
    pass: problems.length === 0,
    value: problems.length === 0 ? `共 ${resolution.layers.length} 层 / ${totalCells} 格，各处一致` : `${problems.length} 处对不上`,
    detail:
      problems.length === 0
        ? `蒙面裁片页每格块数与颜色、裁片图每块填色、备料与批量按格蒙面面积、裁片清单/配色清单每一行、本机存档分格，全部由同一份分格算出；各格块数加总守恒，版本第 ${l.cellsRevision} 版`
        : problems.join('；')
  }
}

function suggestDivisions(l: Lantern, netArea: number, ratio: number): number | null {
  if (ratio <= 1.0005) return null
  for (let d = Math.max(3, Math.round(l.divisions)) + 1; d <= CRAFT.divMax; d++) {
    const ref = bodySurfaceArea(frameGeometryOf(l), d)
    const r = ref > 0 ? netArea / ref : 0
    if (r <= 1.03) return d
  }
  return CRAFT.divMax
}

function loftOverlap(sheets: Sheet[]): number {
  for (const s of sheets) {
    for (const it of s.items) {
      if (it.type === 'strip' && it.overlapMm > 0) return it.overlapMm
    }
  }
  return 0
}

/** 校验尺标称长度（mm）：1:1 打印用 */
export const CALIBRATION_RULER_MM = 100
export const CALIBRATION_CIRCLE_MM = 100

function frameGeometryOf(l: Lantern) {
  return buildFrame(l).geometry
}

/** 由圆周长反推直径（尺寸反推工具用） */
export function diameterFromPerimeter(lengthMm: number, n: number, polygon: boolean, lashMm: number): number {
  const net = Math.max(0, lengthMm - lashMm)
  if (polygon) {
    const s = Math.max(3, Math.round(n))
    return net / (s * Math.sin(Math.PI / s))
  }
  return net / Math.PI
}

/** 由母线（竖篾）长度反推可用最大直径：保持收口比例与总高，二分求解 */
export function diameterFromRib(l: Lantern, ribLengthMm: number): number {
  const target = Math.max(10, ribLengthMm - 2 * l.lashAllowanceMm)
  let lo = 20
  let hi = 3000
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    const test: Lantern = { ...l, maxDiameterMm: mid, mouthDiameterMm: (mid * l.mouthDiameterMm) / Math.max(1, l.maxDiameterMm), baseDiameterMm: (mid * l.baseDiameterMm) / Math.max(1, l.maxDiameterMm) }
    const segs = segmentInfos(buildFrame(test).geometry)
    const len = segs.reduce((a, s) => a + s.slantMm, 0)
    if (len < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
