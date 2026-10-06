/** 导出：构件清单 / 裁片清单 / 配色清单 / 备料单（CSV，本地生成，无外部请求） */
import type { FrameMember, Lantern, Panel } from './types'
import type { BatchMaterials, SingleLightMaterials } from './materials'
import type { SegmentFabricRow, SegmentPlan } from './segments'
import { fmtBlockRange } from './segments'
import { coveringSpec } from './craft'

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: (string | number)[][]): string {
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function membersCsv(l: Lantern, members: FrameMember[]): string {
  const rows: (string | number)[][] = [
    [`花灯构件清单 · ${l.name}`],
    [`最大直径 ${l.maxDiameterMm}mm / 总高 ${l.totalHeightMm}mm / 绑扎余量 每端 ${l.lashAllowanceMm}mm / 生成 ${new Date().toLocaleString()}`],
    [],
    ['构件名称', '类别', '分组', '净长(mm)', '截取长度(mm,含余量)', '余量处数', '数量', '总截取长度(mm)', '弯曲半径(mm)', '折角(°)', '备注']
  ]
  for (const m of members) {
    rows.push([
      m.label,
      kindName(m.kind),
      m.group,
      m.rawLengthMm.toFixed(1),
      m.lengthMm.toFixed(1),
      m.lashJoints,
      m.qty,
      (m.lengthMm * m.qty).toFixed(1),
      m.bendRadiusMm ? m.bendRadiusMm.toFixed(1) : '—',
      m.bendAngleDeg ? m.bendAngleDeg.toFixed(1) : '—',
      m.note || ''
    ])
  }
  const stock = members.reduce((s, m) => s + m.lengthMm * m.qty, 0)
  const raw = members.reduce((s, m) => s + m.rawLengthMm * m.qty, 0)
  rows.push([])
  rows.push(['合计', '', '', raw.toFixed(1), '', '', members.reduce((s, m) => s + m.qty, 0), stock.toFixed(1), '', '', `备料 ${(stock / 1000).toFixed(3)}m`])
  return toCsv(rows)
}

export function panelsCsv(l: Lantern, panels: Panel[]): string {
  const rows: (string | number)[][] = [
    [`蒙面裁片清单 · ${l.name}`],
    [`蒙面 ${coveringSpec(l.covering).name} / 缝份 每边 ${l.seamAllowanceMm}mm（已含在裁片尺寸内）/ 尺寸单位 mm（1 位小数），块数为整数 / 生成 ${new Date().toLocaleString()}`],
    [],
    ['裁片编号', '名称', '层', '格', '颜色', '绕圈块序号', '形状', '净上宽(mm)', '净下宽(mm)', '净高(mm)', '裁切上宽(mm)', '裁切下宽(mm)', '裁切高(mm)', '半径/对边(mm)', '数量(块)', '对位标记数']
  ]
  for (const p of panels) {
    rows.push([
      p.id,
      p.label,
      p.layerIndex >= 0 ? `第 ${p.layerIndex + 1} 层` : '顶/底盖',
      p.layerIndex >= 0 ? `第 ${(p.segmentIndex ?? 0) + 1}/${p.segmentCount ?? 1} 格` : '—',
      p.color,
      p.layerIndex >= 0 ? fmtBlockRange(p.segmentFrom ?? 1, p.segmentTo ?? p.qty) : '—',
      shapeName(p.shape),
      p.rawWidthTopMm.toFixed(1),
      p.rawWidthBottomMm.toFixed(1),
      p.rawHeightMm.toFixed(1),
      p.widthTopMm.toFixed(1),
      p.widthBottomMm.toFixed(1),
      p.heightMm.toFixed(1),
      p.radiusMm ? p.radiusMm.toFixed(1) : '—',
      p.qty,
      p.marksMm.length
    ])
  }
  return toCsv(rows)
}

/** 配色清单：每一层每一格一行，与裁片清单、备料单由同一份分格方案算出 */
export function paletteCsv(l: Lantern, plans: SegmentPlan[]): string {
  const rows: (string | number)[][] = [
    [`配色清单（圆周分格） · ${l.name}`],
    [`块数为整数，绕圈块序号从 1 起 / 各格块数合计 = 该层裁片总数 / 生成 ${new Date().toLocaleString()}`],
    [],
    ['层', '格', '颜色', '该格块数(块)', '绕圈块序号', '分法', '余数取舍与说明']
  ]
  for (const plan of plans) {
    if (plan.panelCount <= 0) continue
    for (let s = 0; s < plan.actual; s++) {
      rows.push([
        `第 ${plan.layerIndex + 1} 层`,
        `第 ${s + 1}/${plan.actual} 格`,
        plan.colors[s],
        plan.counts[s],
        fmtBlockRange(plan.starts[s] + 1, plan.starts[s] + plan.counts[s]),
        plan.methodLabel,
        s === 0 ? [plan.note, plan.cost].filter(Boolean).join('；') : ''
      ])
    }
    rows.push([
      `第 ${plan.layerIndex + 1} 层合计`,
      `${plan.actual} 格`,
      '',
      plan.panelCount,
      `1–${plan.panelCount}`,
      '',
      `各格块数合计 ${plan.counts.reduce((a, b) => a + b, 0)} = 该层裁片总数 ${plan.panelCount}`
    ])
  }
  return toCsv(rows)
}

export function materialsCsv(
  l: Lantern,
  single: SingleLightMaterials,
  batch: BatchMaterials,
  segmentRows?: SegmentFabricRow[]
): string {
  const cov = coveringSpec(l.covering)
  const rows: (string | number)[][] = [
    [`备料单 · ${l.name}`],
    [`生成 ${new Date().toLocaleString()} / 单位 mm·m²·m·g；面积折平方米留三位小数，块数为整数`],
    [],
    ['项目', '单灯用量', '单位', `批量 ${batch.count} 个（含 ${(batch.wasteRatio * 100).toFixed(0)}% 损耗）`],
    ['竹篾/铁丝（含绑扎余量）', single.frameM.toFixed(3), 'm', batch.frameM.toFixed(3)],
    ['竹篾构件净长', single.frameRawM.toFixed(3), 'm', batch.frameRawM.toFixed(3)],
    [`蒙面（${cov.name}，含缝份）`, single.coveringM2.toFixed(3), 'm²', batch.coveringM2.toFixed(3)],
    ['蒙面净面积（不含缝份）', single.coveringNetM2.toFixed(3), 'm²', batch.coveringNetM2.toFixed(3)],
    ['扎线', single.lashM.toFixed(3), 'm', batch.lashM.toFixed(3)],
    ['胶', single.glueG.toFixed(1), 'g', batch.glueG.toFixed(1)],
    ['LED 灯珠建议', single.ledCount, '颗', batch.ledCount],
    [],
    ['灯体体积', single.volumeL.toFixed(3), 'L', batch.volumeL.toFixed(3)],
    ['灯体表面积', single.surfaceM2.toFixed(3), 'm²', batch.surfaceM2.toFixed(3)]
  ]
  if (segmentRows && segmentRows.length) {
    const k = batch.count * (1 + batch.wasteRatio)
    rows.push([])
    rows.push([`分格蒙面用量（按格拆开，与裁片清单/配色清单同一份分格；面积含缝份，m² 留三位小数）`])
    rows.push(['层', '格', '颜色', '块数(块)', '绕圈块序号', '单灯面积(m²)', `批量面积(m²) ×${batch.count}含损耗`])
    for (const r of segmentRows) {
      rows.push([
        r.layerIndex >= 0 ? `第 ${r.layerIndex + 1} 层` : '顶/底盖',
        r.layerIndex >= 0 ? `第 ${r.segmentIndex + 1}/${r.segmentCount} 格` : '整片',
        r.color,
        r.qty,
        r.layerIndex >= 0 ? fmtBlockRange(r.from, r.to) : '—',
        (r.areaMm2 / 1e6).toFixed(3),
        ((r.areaMm2 / 1e6) * k).toFixed(3)
      ])
    }
    rows.push(['合计', '', '', segmentRows.reduce((a, r) => a + r.qty, 0), '', single.coveringM2.toFixed(3), batch.coveringM2.toFixed(3)])
    rows.push(['注：按格行为单格面积 × 批量系数，合计行以蒙面总量为准（分格行各自保留三位小数，求和可能有 ±0.001 的舍入差）'])
  }
  return toCsv(rows)
}

export function kindName(k: FrameMember['kind']): string {
  const map: Record<FrameMember['kind'], string> = {
    vertical: '竖篾',
    ring: '横篾',
    mouth_ring: '收口圈',
    base_ring: '底盘圈',
    rib: '母线篾',
    spoke: '辐条/中轴'
  }
  return map[k]
}

export function shapeName(s: Panel['shape']): string {
  const map: Record<Panel['shape'], string> = {
    trapezoid: '梯形',
    rectangle: '矩形',
    sector: '扇形',
    circle: '圆形/正多边形',
    triangle: '三角形'
  }
  return map[s]
}
