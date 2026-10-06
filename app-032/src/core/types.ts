/** 花灯放样数据模型（对齐规格书 §7，并补充放样所需的展开参数） */

export type LanternKind = 'prism' | 'revolution' | 'polyhedron' | 'box'
export type MouthStyle = 'flat' | 'taper' | 'gourd'
export type Covering = 'xuan' | 'silk' | 'parchment'
export type PageSize = 'A4' | 'A3'
export type PanelShape = 'trapezoid' | 'rectangle' | 'sector' | 'circle' | 'triangle'
export type MemberKind = 'vertical' | 'ring' | 'mouth_ring' | 'base_ring' | 'rib' | 'spoke'

/** 圆周分格方式：整块一色 / 一块一格 / 按角度均分 / 自定义各组块数 */
export type CellMode = 'whole' | 'perPiece' | 'equal' | 'custom'
/** 除不尽时余数的去处：并进最后一格（格数不多不少）/ 余数单独成一格（各常规格块数相同） */
export type RemainderRule = 'last' | 'extra'

export interface Point2 {
  x: number
  y: number
}

/** 分段（层）：高度为准，直径为轮廓派生结果 */
export interface LayerSpec {
  heightMm: number
  diameterMm: number
}

/** 分格颜色条目 */
export interface CellColorSpec {
  color: string
  /** custom 方式下该格分得的裁片块数；其它方式由算法填入，编辑界面只读 */
  pieces: number
}

/** 一层的圆周分格（沿圆周顺序排格，第 1 格从该层 1 号棱/0° 基准起，顺时针） */
export interface LayerCellsSpec {
  mode: CellMode
  /** equal 方式下想分的格数（whole=1、perPiece=块数 N、custom=cells.length） */
  cellCount: number
  /** 除不尽时余数的去处（whole/perPiece 整除时无影响） */
  remainder: RemainderRule
  /** 各格颜色（custom 时 pieces 为手工块数）；长度不足按主色补齐 */
  cells: CellColorSpec[]
}

/** 作废留痕 */
export interface VoidedRevision {
  revision: number
  reason: string
  at: string
}

export interface Lantern {
  id: string
  kind: LanternKind
  name: string
  /** 最大直径（灯体最粗处） */
  maxDiameterMm: number
  /** 总高（= 各分段高度之和） */
  totalHeightMm: number
  /** 收口直径（上口） */
  mouthDiameterMm: number
  /** 底口直径（下口） */
  baseDiameterMm: number
  /** 棱数（prism/box）；旋转体时作为竖篾（母线篾）根数 */
  sides: number
  /** 分段高度与直径 */
  layers: LayerSpec[]
  /** 上收口方式 */
  mouthStyle: MouthStyle
  /** 下收口方式 */
  bottomStyle: MouthStyle
  /** 收口曲线强度 0~1 */
  smoothness: number
  /** 葫芦/花瓶形贝塞尔控制点（归一化：x 为半径插值比例，y 为肩部区间比例） */
  ctrl1: Point2
  ctrl2: Point2
  /** 旋转体母线等分数（默认 24，可调） */
  divisions: number
  /** 蒙面类型 */
  covering: Covering
  /** 缝份（mm，四边各加） */
  seamAllowanceMm: number
  /** 绑扎余量（mm，每端） */
  lashAllowanceMm: number
  /** 每层配色（长度 = layers.length，可短于层数则回落到主色）
   *  兼容字段：现由 layerCells 派生同步（每层第 1 格颜色），新代码请使用 layerCells */
  layerColors: string[]
  /** 每层圆周分格（长度 = layers.length；多面体/顶盖底盖不按圆周分格）。
   *  这是「同一套分格」在本机存档里的唯一源，裁片/图纸/备料/导出全部由它算出 */
  layerCells: LayerCellsSpec[]
  /** 分格版本（每次分格的格数或颜色改动都 +1）；用于识别已导出单子是否过期 */
  cellsRevision: number
  /** 已按哪一版分格导出过（裁片清单/配色清单/备料单） */
  exportedRevision?: number
  exportedAt?: string
  /** 已作废的分格版本（挑错后旧档/旧单/旧图纸作废留痕） */
  voidedRevisions: VoidedRevision[]
  /** 主色 */
  color: string
  /** 批量制灯数量 */
  batchCount: number
  /** 损耗率 0~0.2 */
  wasteRatio: number
  /** 1:1 打印纸张 */
  pageSize: PageSize
  /** 长条图跨页搭接量（mm） */
  overlapMm: number
  createdAt: string
  updatedAt: string
}

export interface FrameMember {
  id: string
  kind: MemberKind
  /** 名称，如「竖篾」「第 3 层横篾」「收口圈」 */
  label: string
  /** 截取长度（已含绑扎余量） */
  lengthMm: number
  /** 净长（不含余量） */
  rawLengthMm: number
  /** 建议弯曲半径（圆形圈 / 收口段） */
  bendRadiusMm?: number
  /** 折角（多边形圈的转角，度） */
  bendAngleDeg?: number
  /** 数量 */
  qty: number
  /** 分组：所属层或类别 */
  group: string
  /** 每根含几处绑扎余量 */
  lashJoints: number
  note?: string
}

export interface PanelMark {
  x: number
  y: number
  label: string
}

export interface Panel {
  id: string
  label: string
  shape: PanelShape
  /** 裁片下宽（已含缝份） */
  widthBottomMm: number
  /** 裁片上宽（已含缝份） */
  widthTopMm: number
  /** 裁片高（已含缝份） */
  heightMm: number
  seamAllowanceMm: number
  marksMm: PanelMark[]
  qty: number
  /** 展开净尺寸（不含缝份） */
  rawWidthTopMm: number
  rawWidthBottomMm: number
  rawHeightMm: number
  /** 圆形/正多边形裁片半径（净，不含缝份） */
  radiusMm?: number
  /** 正多边形边数（顶/底盖为多边形时） */
  polySides?: number
  /** 对应灯体层的索引（-1 表示顶/底盖） */
  layerIndex: number
  /** 圆周分格序号（0 起；顶/底盖为 -1） */
  cellIndex: number
  /** 该格在本层的分格方式 */
  cellMode: CellMode
  /** 本层该格覆盖的块序号范围（1 起，绕圈排列） */
  pieceFrom: number
  pieceTo: number
  /** 本层裁片总块数 */
  layerPieceCount: number
  color: string
  note?: string
}

export interface MaterialTally {
  /** 备料竹篾/铁丝总长（m，含绑扎余量与损耗） */
  frameM: number
  /** 蒙面面积（m²，含缝份与损耗） */
  coveringM2: number
  /** 损耗率 */
  wasteRatio: number
  /** 扎线（m） */
  lashM: number
  /** 胶（g） */
  glueG: number
  /** LED 灯珠建议数量 */
  ledCount?: number
}

/** 构件与裁片的自检结果（对应规格书 §10） */
export interface CheckResult {
  id: string
  title: string
  pass: boolean
  detail: string
  /** 相关数值，便于界面展示 */
  value?: string
}
