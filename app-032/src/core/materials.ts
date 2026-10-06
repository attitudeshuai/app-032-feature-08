/**
 * 材料统计与备料单（规格书 §4.6 / §5）
 * 备料按含余量长度；批量 = 单灯 × N × (1 + 损耗率)。
 */
import type { FrameMember, Lantern } from './types'
import { bodySurfaceArea, bodyVolume, r1, r3 } from './geometry'
import { buildFrame } from './frame'
import { buildPanels, panelCutArea, panelNetArea, type PanelResult } from './panels'
import { CRAFT, coveringSpec } from './craft'

/** 按格拆开的蒙面用量（一层一格一行；顶/底盖单列） */
export interface CellFabricRow {
  layerIndex: number
  cellIndex: number
  label: string
  color: string
  pieces: number
  /** 单块含缝份面积（m²，四位小数展示、合计按 mm² 累加） */
  perPieceM2: number
  /** 该格含缝份蒙面面积（m²，三位小数） */
  cutAreaM2: number
  /** 该格净面积（m²，三位小数） */
  netAreaM2: number
  /** 未舍入原始面积（mm²）：各格合计必须由原始值累加后再折三位，避免逐格舍入漂移 */
  cutAreaMm2Raw: number
  netAreaMm2Raw: number
  /** 是否顶/底盖（非圆周分格） */
  isCover: boolean
  reason: string
}

export interface SingleLightMaterials {
  /** 竹篾/铁丝备料总长（含绑扎余量，m） */
  frameM: number
  /** 全部构件净长（m） */
  frameRawM: number
  /** 蒙面面积（含缝份，m²） */
  coveringM2: number
  /** 蒙面净面积（不含缝份，m²） */
  coveringNetM2: number
  /** 扎线（m） */
  lashM: number
  /** 胶（g） */
  glueG: number
  /** 绑扎处数 */
  lashJoints: number
  /** 灯体体积（L） */
  volumeL: number
  /** LED 建议颗数（不做电气设计，仅数量建议） */
  ledCount: number
  /** 灯体表面积（m²） */
  surfaceM2: number
}

export interface BatchMaterials extends SingleLightMaterials {
  count: number
  wasteRatio: number
}

export function computeMaterials(l: Lantern): SingleLightMaterials {
  const frame = buildFrame(l)
  const panelRes = buildPanels(l)
  const cov = coveringSpec(l.covering)
  const divisions = Math.max(3, Math.round(l.divisions))

  const frameMm = frame.members.reduce((s, m: FrameMember) => s + m.lengthMm * m.qty, 0)
  const frameRawMm = frame.members.reduce((s, m: FrameMember) => s + m.rawLengthMm * m.qty, 0)
  const joints = frame.members.reduce((s, m: FrameMember) => s + m.qty * m.lashJoints, 0)
  const cutArea = panelRes.cutAreaMm2
  const volumeL = bodyVolume(frame.geometry) / 1_000_000
  const led = Math.max(CRAFT.led.min, Math.ceil(volumeL * CRAFT.led.perLiter))

  return {
    frameM: r3(frameMm / 1000),
    frameRawM: r3(frameRawMm / 1000),
    coveringM2: r3(cutArea / 1_000_000),
    coveringNetM2: r3(panelRes.netAreaMm2 / 1_000_000),
    lashM: r3(joints * CRAFT.lashPerJointM),
    glueG: r1((cutArea / 1_000_000) * cov.gluePerM2),
    lashJoints: joints,
    volumeL: r3(volumeL),
    ledCount: led,
    surfaceM2: r3(bodySurfaceArea(frame.geometry, divisions) / 1_000_000)
  }
}

/** 批量化：单灯 × N × (1 + 损耗率)；LED 按颗数 × N（不参与损耗率） */
export function computeBatch(single: SingleLightMaterials, count: number, wasteRatio: number): BatchMaterials {
  const k = count * (1 + wasteRatio)
  return {
    ...single,
    count,
    wasteRatio,
    frameM: r3(single.frameM * k),
    frameRawM: r3(single.frameRawM * k),
    coveringM2: r3(single.coveringM2 * k),
    coveringNetM2: r3(single.coveringNetM2 * k),
    lashM: r3(single.lashM * k),
    glueG: r1(single.glueG * k),
    volumeL: r3(single.volumeL * count),
    ledCount: single.ledCount * count,
    surfaceM2: r3(single.surfaceM2 * count)
  }
}

/**
 * 蒙面用量按格拆开计数（同一份分格的直接结果）：
 * 灯身每一层的每一格一行，顶/底盖各自一行（写明不按圆周分格的原因）。
 * 面积单位 m²，单块展示四位小数、合计保留三位小数；块数为整数。
 */
export function cellFabricRows(panelRes: PanelResult): CellFabricRow[] {
  const rows: CellFabricRow[] = []
  for (const p of panelRes.panels) {
    const cutMm2 = panelCutArea(p) * p.qty
    const netMm2 = panelNetArea(p) * p.qty
    const baseRow = {
      color: p.color,
      pieces: p.qty,
      perPieceM2: Math.round((panelCutArea(p) / 1e6) * 1e4) / 1e4,
      cutAreaM2: r3(cutMm2 / 1e6),
      netAreaM2: r3(netMm2 / 1e6),
      cutAreaMm2Raw: cutMm2,
      netAreaMm2Raw: netMm2
    }
    if (p.layerIndex < 0) {
      rows.push({
        layerIndex: -1,
        cellIndex: -1,
        label: p.label,
        ...baseRow,
        isCover: true,
        reason: '顶/底盖为整片裁切，不按圆周分格，取相邻层第 1 格颜色'
      })
      continue
    }
    rows.push({
      layerIndex: p.layerIndex,
      cellIndex: p.cellIndex,
      label: `第 ${p.layerIndex + 1} 层 · 第 ${p.cellIndex + 1} 格（块号 ${p.pieceFrom}–${p.pieceTo}）`,
      ...baseRow,
      isCover: false,
      reason: ''
    })
  }
  return rows
}

/** 各格蒙面面积合计（由未舍入 mm² 累加后折三位，与总量口径一致） */
export function cellFabricTotals(rows: CellFabricRow[]): { cutM2: number; netM2: number; pieces: number } {
  const cut = rows.reduce((s, r) => s + r.cutAreaMm2Raw, 0)
  const net = rows.reduce((s, r) => s + r.netAreaMm2Raw, 0)
  return {
    cutM2: r3(cut / 1e6),
    netM2: r3(net / 1e6),
    pieces: rows.reduce((s, r) => s + r.pieces, 0)
  }
}
