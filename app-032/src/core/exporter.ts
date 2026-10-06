/** 导出：构件清单 / 裁片清单 / 配色清单 / 备料单（CSV，本地生成，无外部请求） */
import type { FrameMember, Lantern, Panel } from './types'
import type { BatchMaterials, CellFabricRow, SingleLightMaterials } from './materials'
import { cellFabricTotals } from './materials'
import type { PanelResult } from './panels'
import { coveringSpec } from './craft'
import { MODE_NAME } from './cells'

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

/** 分格版本戳：裁片清单/配色清单/备料单三单同一版号，对不上即说明单子过期须作废重出 */
function revisionStamp(l: Lantern): string {
  return `分格版本 第 ${l.cellsRevision} 版 · 生成 ${new Date().toLocaleString()}`
}

function staleWarn(l: Lantern): string[] {
  if (typeof l.exportedRevision === 'number' && l.exportedRevision < l.cellsRevision) {
    return [
      `⚠ 本单基于第 ${l.exportedRevision} 版分格，当前存档已是第 ${l.cellsRevision} 版：旧版存档、已发出单子与图纸均已作废，请按本单重出，已照旧配色裁好的布块需重裁`
    ]
  }
  return []
}

function staleRows(l: Lantern): (string | number)[][] {
  return staleWarn(l).map((w): (string | number)[] => [w])
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

export function panelsCsv(l: Lantern, panelRes: PanelResult): string {
  const panels = panelRes.panels
  const rows: (string | number)[][] = [
    [`蒙面裁片清单 · ${l.name}`],
    [revisionStamp(l)],
    [`蒙面 ${coveringSpec(l.covering).name} / 缝份 每边 ${l.seamAllowanceMm}mm（已含在裁片尺寸内）/ 块数为整数 / 单位 mm`],
    ...staleRows(l),
    [],
    [
      '裁片编号', '名称（层·格）', '形状', '颜色(HEX)', '层', '格', '本格块数',
      '块号范围', '本层块数', '净上宽(mm)', '净下宽(mm)', '净高(mm)',
      '裁切上宽(mm)', '裁切下宽(mm)', '裁切高(mm)', '半径/对边(mm)', '对位标记数'
    ]
  ]
  for (const p of panels) {
    rows.push([
      p.id,
      p.label,
      shapeName(p.shape),
      p.color,
      p.layerIndex >= 0 ? p.layerIndex + 1 : '盖',
      p.cellIndex >= 0 ? p.cellIndex + 1 : '—',
      p.qty,
      p.pieceFrom && p.pieceTo ? `${p.pieceFrom}-${p.pieceTo}` : '—',
      p.layerPieceCount,
      p.rawWidthTopMm.toFixed(1),
      p.rawWidthBottomMm.toFixed(1),
      p.rawHeightMm.toFixed(1),
      p.widthTopMm.toFixed(1),
      p.widthBottomMm.toFixed(1),
      p.heightMm.toFixed(1),
      p.radiusMm ? p.radiusMm.toFixed(1) : '—',
      p.marksMm.length
    ])
  }
  // 合计守恒行（按格拆开后再加总，必须与裁片总数相等）
  const qtySum = panels.reduce((s, p) => s + p.qty, 0)
  rows.push([])
  rows.push(['合计块数（各格加总，须 = 裁片总块数）', '', '', '', '', '', qtySum, '', panelRes.totalQty])

  // ---- 配色清单（同一份分格，每格一行） ----
  rows.push([])
  rows.push(['配色清单（圆周分格，与裁片清单同一版、同一套分格）'])
  rows.push([
    '层', '分格方式', '格序', '颜色(HEX)', '块数', '块号范围', '占圆周角度(°)', '分法 / 余数归属说明'
  ])
  panelRes.cells.layers.forEach((r) => {
    if (!r.segmentable) {
      rows.push([r.layerIndex + 1, '不分格', '—', l.color, 0, '—', '—', r.reason])
      return
    }
    r.cells.forEach((c) => {
      rows.push([
        r.layerIndex + 1,
        MODE_NAME[r.mode] + (r.mode === 'equal' ? `（${r.remainder === 'last' ? '余数并进末格' : '余数单独成格'}）` : ''),
        c.index + 1,
        c.color,
        c.pieces,
        `${c.pieceFrom}-${c.pieceTo}`,
        c.angleDeg.toFixed(2),
        c.index === 0 ? r.ruleNote : ''
      ])
    })
  })
  // 顶/底盖
  panels
    .filter((p) => p.layerIndex < 0)
    .forEach((p) => {
      rows.push(['顶/底盖', '不分格', p.label, p.color, p.qty, '1', '—', p.note || ''])
    })
  rows.push([])
  rows.push(['说明', '排格一律从本层 1 号棱（棱柱/方灯）或 0° 基准（旋转体）起顺时针依次排满，余数落在圈尾，以该基准为第 1 块，不做四舍五入。'])
  return toCsv(rows)
}

export function materialsCsv(
  l: Lantern,
  single: SingleLightMaterials,
  batch: BatchMaterials,
  cellRows: CellFabricRow[]
): string {
  const cov = coveringSpec(l.covering)
  const k = batch.count * (1 + batch.wasteRatio)
  const rows: (string | number)[][] = [
    [`备料单 · ${l.name}`],
    [revisionStamp(l)],
    [`单位 mm·m²·m·g；面积保留三位小数，块数为整数`],
    ...staleRows(l),
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
    ['灯体表面积', single.surfaceM2.toFixed(3), 'm²', batch.surfaceM2.toFixed(3)],
    [],
    ['蒙面用量按格拆开（与裁片清单、配色清单同一版分格；单灯面积 m² 三位小数，批量 = 单灯 × ' + batch.count + ' × (1+' + (batch.wasteRatio * 100).toFixed(0) + '%)）'],
    ['层·格', '颜色(HEX)', '块数', '单块面积(m²)', '单灯蒙面(m²)', `批量蒙面(m²)`]
  ]
  for (const r of cellRows) {
    rows.push([
      r.label,
      r.color,
      r.pieces,
      r.perPieceM2.toFixed(4),
      r.cutAreaM2.toFixed(3),
      (r.cutAreaM2 * k).toFixed(3)
    ])
  }
  const sumCut = cellFabricTotals(cellRows)
  rows.push([
    '各格合计（由未舍入面积累加后折三位，须 = 上面「蒙面（含缝份）」）',
    '',
    sumCut.pieces,
    '',
    sumCut.cutM2.toFixed(3),
    (sumCut.cutM2 * k).toFixed(3)
  ])
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
