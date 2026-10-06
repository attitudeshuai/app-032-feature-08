/**
 * 圆周分格（蒙面层沿圆周分成若干格，每格各挑颜色与块数）
 *
 * 这是全应用「同一套分格」的唯一来源（single source of truth）：
 *   蒙面裁片页每格块数与颜色、裁片图每块填色、备料/批量按格蒙面面积、
 *   三份导出单子的裁片清单与配色清单、本机存档 layerCells，
 *   都由 resolveLayerCells / buildCellResolution 的同一次计算得出。
 *
 * 分法（格数 K 与本层裁片块数 N 对不上时哪条路能用）：
 *   - whole     整块一色：K=1，全层一个色（旧行为）。整除。
 *   - perPiece  一块一格：K=N，一块一色绕圈换色。永远整除。
 *   - equal     按角度均分：想要 K 格、每格角度相同（360°/K）。
 *               N ÷ K 除不尽时只有两条路，必须二选一并认下代价：
 *                 remainder='last'  余数并进最后一格：格数不多不少、配色清单整齐，
 *                                   代价是最后一格块数比别的格多；
 *                 remainder='extra' 余数单独成一格：各常规格块数一样、绕圈装上去匀称，
 *                                   代价是格数比原定多一格、清单多一行、下料容易数错。
 *               除得尽（r=0）时两种取舍结果一致。
 *   - custom    几块一组：逐格填块数；各格块数加起来必须正好 = N，且 K ≤ N。
 *
 * 除不尽的那一块（或几块）归到哪一格、以哪个为准：
 *   一律沿圆周从「本层 1 号棱（棱柱）/ 0° 基准（旋转体）」起顺时针依次排满，
 *   余数一律落在圈尾（last: 并进末格；extra: 单独成末格），不做四舍五入。
 *
 * 旋转体按等分数展开时每格块数同样由等分数 N 分出，除不尽也按上面两条走。
 */
import type {
  CellColorSpec,
  CellMode,
  Lantern,
  LayerCellsSpec,
  RemainderRule
} from './types'

/** 一层分好的一格（权威结果） */
export interface ResolvedCell {
  /** 格序号，0 起，沿圆周顺时针 */
  index: number
  color: string
  /** 该格块数（整数）；custom 校验失败时可能为 0（空格，见 error） */
  pieces: number
  /** 覆盖块号范围（1 起，含两端）；pieces=0 时 from>to */
  pieceFrom: number
  pieceTo: number
  /** 该格占圆周角度（度） */
  angleDeg: number
}

export interface ResolvedLayerCells {
  layerIndex: number
  mode: CellMode
  remainder: RemainderRule
  /** 本层裁片总块数（整数） */
  pieceCount: number
  /** 想要的格数（equal 的 K；实际格数可能因 extra 多一格） */
  wantedCellCount: number
  cells: ResolvedCell[]
  /** N ÷ K 的商与余数（whole/perPiece 整除时 rem=0） */
  quotient: number
  remainderPieces: number
  exact: boolean
  /** 校验错误（空字符串表示通过）；有错时不得导出 */
  error: string
  /** 采用分法的说明（哪种分法能用、余数归到哪、以哪个为准） */
  ruleNote: string
  /** 该层是否可按圆周分格（多面体/顶底盖不可） */
  segmentable: boolean
  /** 不可分格或未分到格时写明原因 */
  reason: string
}

export interface CellResolution {
  layers: ResolvedLayerCells[]
  /** 是否全部层都通过校验（无空格、块数合计守恒、格数不超块数） */
  valid: boolean
  /** 各层块数合计 = 裁片总数 等总校验说明 */
  errors: string[]
}

/** 该灯种的某层裁片有多少块：棱柱/方灯 = 棱数；旋转体 = 母线等分数；多面体不分层 */
export function layerPieceCount(l: Lantern, layerIndex: number): number {
  if (l.kind === 'polyhedron') return 0
  if (layerIndex < 0 || layerIndex >= l.layers.length) return 0
  return l.kind === 'prism' || l.kind === 'box'
    ? Math.max(3, Math.round(l.sides))
    : Math.max(3, Math.round(l.divisions))
}

export function layerSegmentable(l: Lantern, layerIndex: number): boolean {
  return l.kind !== 'polyhedron' && layerIndex >= 0 && layerIndex < l.layers.length
}

function fallbackColor(l: Lantern, layerIndex: number): string {
  return l.layerColors[layerIndex] || l.color
}

/** 新建一层的默认分格（整块一色，沿用旧层色） */
export function defaultLayerCells(l: Lantern, layerIndex: number): LayerCellsSpec {
  const color = fallbackColor(l, layerIndex)
  return {
    mode: 'whole',
    cellCount: 1,
    remainder: 'last',
    cells: [{ color, pieces: layerPieceCount(l, layerIndex) || 0 }]
  }
}

/** 颜色列表按层裁片块数兜底补齐 */
function normalizeCellColors(spec: LayerCellsSpec, count: number, fallback: string): CellColorSpec[] {
  const out: CellColorSpec[] = []
  for (let i = 0; i < count; i++) {
    const c = spec.cells[i]
    out.push({ color: c?.color || fallback, pieces: Math.max(0, Math.round(c?.pieces ?? 0)) })
  }
  return out
}

const MODE_NAME: Record<CellMode, string> = {
  whole: '整块一色',
  perPiece: '一块一格',
  equal: '按角度均分',
  custom: '几块一组'
}

/** 由存档里的一层分格规格，算出权威的每格块数/颜色/块号范围 */
export function resolveLayerCells(l: Lantern, layerIndex: number, spec?: LayerCellsSpec): ResolvedLayerCells {
  const N = layerPieceCount(l, layerIndex)
  const segmentable = layerSegmentable(l, layerIndex)
  const base: ResolvedLayerCells = {
    layerIndex,
    mode: 'whole',
    remainder: spec?.remainder || 'last',
    pieceCount: N,
    wantedCellCount: 1,
    cells: [],
    quotient: N,
    remainderPieces: 0,
    exact: true,
    error: '',
    ruleNote: '',
    segmentable,
    reason: ''
  }
  if (!segmentable) {
    base.reason =
      l.kind === 'polyhedron'
        ? '多面体为整体三角蒙面（顶/底不封盖），不按圆周分格，颜色走主色'
        : `第 ${layerIndex + 1} 层不存在，不参与圆周分格`
    base.cells = []
    return base
  }

  const s: LayerCellsSpec = spec || defaultLayerCells(l, layerIndex)
  const fallback = fallbackColor(l, layerIndex)
  base.mode = s.mode
  base.remainder = s.remainder

  let piecesArr: number[]
  let wantedK: number
  let note: string

  switch (s.mode) {
    case 'whole':
      wantedK = 1
      piecesArr = [N]
      note = `整块一色：第 ${layerIndex + 1} 层 ${N} 块裁片同属 1 格、一个颜色（不绕圈换色）。`
      break
    case 'perPiece':
      wantedK = N
      piecesArr = Array.from({ length: N }, () => 1)
      note = `一块一格：第 ${layerIndex + 1} 层 ${N} 块裁片各成 1 格、共 ${N} 格，一格一块、沿圆周逐块换色，天然整除无余数。`
      break
    case 'equal': {
      wantedK = Math.max(1, Math.min(N, Math.round(s.cellCount) || 1))
      const q = Math.floor(N / wantedK)
      const r = N - q * wantedK
      base.quotient = q
      base.remainderPieces = r
      base.exact = r === 0
      if (r === 0) {
        piecesArr = Array.from({ length: wantedK }, () => q)
        note = `按角度均分：${N} 块 ÷ ${wantedK} 格 = 每格 ${q} 块，除得尽；每格角度 ${(360 / wantedK).toFixed(2)}°。`
      } else if (s.remainder === 'last') {
        piecesArr = Array.from({ length: wantedK }, (_, i) => (i === wantedK - 1 ? q + r : q))
        note =
          `按角度均分：${N} 块 ÷ ${wantedK} 格，每格 ${q} 块余 ${r} 块；余数并进最后一格（格数仍为 ${wantedK}、配色清单整齐，` +
          `代价是第 ${wantedK} 格有 ${q + r} 块、比别的格多 ${r} 块）。每格角度按 ${(360 / wantedK).toFixed(2)}° 排，末格实际跨 ${(360 / wantedK) * (q + r) / q}°。`
      } else {
        piecesArr = [...Array.from({ length: wantedK }, () => q), r]
        note =
          `按角度均分：${N} 块 ÷ ${wantedK} 格，每格 ${q} 块余 ${r} 块；余数单独成一格（共 ${wantedK + 1} 格，各常规格都是 ${q} 块、绕圈装上去匀称，` +
          `代价是格数比原定多 1 格、配色清单多一行，下料时容易数错；末格只有 ${r} 块）。`
      }
      break
    }
    case 'custom': {
      wantedK = Math.max(0, s.cells.length)
      const colors = normalizeCellColors(s, wantedK, fallback)
      piecesArr = colors.map((c) => c.pieces)
      const sum = piecesArr.reduce((a, b) => a + b, 0)
      base.quotient = wantedK ? Math.floor(N / wantedK) : 0
      base.remainderPieces = wantedK ? N - base.quotient * wantedK : 0
      base.exact = sum === N
      if (wantedK === 0) {
        base.error = '一格都没分到：custom 分法至少要 1 格'
      } else if (wantedK > N) {
        base.error = `格数 ${wantedK} 超过本层裁片块数 ${N}（格数不能超过块数）`
      } else if (sum !== N) {
        const empties = piecesArr.map((p, i) => (p <= 0 ? i + 1 : 0)).filter(Boolean)
        base.error =
          `各格块数合计 ${sum} 与本层裁片总数 ${N} 不相等（差 ${N - sum} 块），分不匀` +
          (empties.length ? `；第 ${empties.join('、')} 格一块都没分到，不能空着` : '')
      }
      note =
        sum === N && wantedK <= N
          ? `几块一组：手工指定 ${wantedK} 格各 ${piecesArr.join('、')} 块，合计 ${sum} = 本层 ${N} 块。`
          : `几块一组：手工指定格数与块数；当前合计 ${sum} 块，必须与本层 ${N} 块完全相等才可用。`
      break
    }
  }

  const colorCount = piecesArr.length
  const colors = normalizeCellColors(s, colorCount, fallback)
  let cursor = 0
  const cells: ResolvedCell[] = piecesArr.map((p, i) => {
    const from = p > 0 ? cursor + 1 : cursor
    const to = p > 0 ? cursor + p : cursor
    cursor += p
    return {
      index: i,
      color: colors[i].color,
      pieces: p,
      pieceFrom: from,
      pieceTo: to,
      angleDeg: N > 0 ? (360 * p) / N : 0
    }
  })

  const sum = piecesArr.reduce((a, b) => a + b, 0)
  let error = base.error
  if (!error && sum !== N) error = `各格块数合计 ${sum} ≠ 本层裁片总数 ${N}`
  if (!error && piecesArr.length > N) error = `格数 ${piecesArr.length} 超过本层块数 ${N}`
  const empties = cells.map((c) => (c.pieces <= 0 ? c.index + 1 : 0)).filter(Boolean)
  if (!error && empties.length) error = `第 ${empties.join('、')} 格一块都没分到，不能空着`

  return {
    ...base,
    wantedCellCount: wantedK,
    cells,
    error,
    ruleNote:
      note +
      (s.mode !== 'whole'
        ? ` 排格基准：从本层 1 号棱（棱柱/方灯）或 0° 基准（旋转体）起顺时针依次排满，余数一律落在圈尾，以该基准为第 1 块，不做四舍五入。`
        : '')
  }
}

/** 整灯分层分格（唯一一次计算，所有界面/导出共用） */
export function buildCellResolution(l: Lantern): CellResolution {
  const layers = l.layers.map((_, i) => resolveLayerCells(l, i, l.layerCells[i]))
  const errors: string[] = []
  layers.forEach((r) => {
    if (!r.segmentable && r.reason) errors.push(`第 ${r.layerIndex + 1} 层：${r.reason}`)
    if (r.error) errors.push(`第 ${r.layerIndex + 1} 层：${r.error}`)
  })
  // 块数合计守恒（每层内部已校验；这里再汇总一次，错误信息点明处所为「分格存档」）
  layers.forEach((r) => {
    const sum = r.cells.reduce((a, c) => a + c.pieces, 0)
    if (r.segmentable && sum !== r.pieceCount) {
      errors.push(`本机存档第 ${r.layerIndex + 1} 层分格：各格块数合计 ${sum} ≠ 裁片总数 ${r.pieceCount}`)
    }
  })
  return { layers, valid: layers.every((r) => !r.error), errors }
}

/** 某层主色（第 1 格颜色），用于顶/底盖与预览等不按格展示的地方 */
export function layerPrimaryColor(l: Lantern, layerIndex: number): string {
  const r = resolveLayerCells(l, layerIndex, l.layerCells[layerIndex])
  return r.cells[0]?.color || fallbackColor(l, layerIndex)
}

export { MODE_NAME }
