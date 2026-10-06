/**
 * 材料统计与备料单（规格书 §4.6 / §5）
 * 备料按含余量长度；批量 = 单灯 × N × (1 + 损耗率)。
 */
import type { FrameMember, Lantern, Panel } from './types'
import { bodySurfaceArea, bodyVolume, r1, r3 } from './geometry'
import { buildFrame } from './frame'
import { buildPanels, panelCutArea } from './panels'
import { computeLayerPlans, type SegmentFabricRow } from './segments'
import { CRAFT, coveringSpec } from './craft'

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
 * 蒙面用量按格拆开（单灯）：每一层每一格一行，顶/底盖各一行（整片、不参与分格），
 * 面积含缝份。与裁片清单同源 —— 直接由 buildPanels 的裁片（已按格拆分）汇总，
 * 批量行 = 单格面积 × 数量 × (1 + 损耗率)，展示统一折 m² 留三位小数。
 */
export function segmentFabricRows(l: Lantern, panels?: Panel[]): SegmentFabricRow[] {
  const list = panels ?? buildPanels(l).panels
  const plans = computeLayerPlans(l)
  const rows: SegmentFabricRow[] = []
  for (const plan of plans) {
    if (plan.panelCount <= 0) continue
    for (let s = 0; s < plan.actual; s++) {
      const p = list.find((x) => x.layerIndex === plan.layerIndex && (x.segmentIndex ?? 0) === s)
      rows.push({
        layerIndex: plan.layerIndex,
        segmentIndex: s,
        segmentCount: plan.actual,
        color: plan.colors[s],
        qty: plan.counts[s],
        from: plan.starts[s] + 1,
        to: plan.starts[s] + plan.counts[s],
        methodLabel: plan.methodLabel,
        areaMm2: p ? panelCutArea(p) * p.qty : 0
      })
    }
  }
  // 顶/底盖：整片一行，不参与圆周分格
  for (const p of list.filter((x) => x.layerIndex < 0)) {
    rows.push({
      layerIndex: -1,
      segmentIndex: 0,
      segmentCount: 1,
      color: p.color,
      qty: p.qty,
      from: 1,
      to: p.qty,
      methodLabel: `${p.label} · 整片（不分格）`,
      areaMm2: panelCutArea(p) * p.qty
    })
  }
  return rows
}
