<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PanelDiagram from '../components/PanelDiagram.vue'
import ChecksPanel from '../components/ChecksPanel.vue'
import {
  addCustomCell,
  cellsExportStale,
  getLantern,
  markCellsExported,
  removeCustomCell,
  setCellColor,
  setCellCount,
  setCellMode,
  setCellPieces,
  setRemainderRule,
  voidExportedCells
} from '../core/store'
import { computeAll } from '../core/checks'
import { DEFAULT_LOFT_OPTIONS } from '../core/paginate'
import { bodySurfaceArea } from '../core/geometry'
import { downloadText, panelsCsv } from '../core/exporter'
import { coveringSpec } from '../core/craft'
import { layerPieceCount, MODE_NAME } from '../core/cells'
import type { CellMode } from '../core/types'

const route = useRoute()
const router = useRouter()
const lantern = computed(() => getLantern(route.params.id as string))
const full = computed(() => {
  const l = lantern.value
  if (!l) return null
  return computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: l.pageSize, overlapMm: l.overlapMm })
})

const ratio = computed(() => {
  const l = lantern.value
  if (!l || !full.value) return 1
  const ref = bodySurfaceArea(full.value.frame.geometry, Math.max(3, Math.round(l.divisions)))
  return ref > 0 ? full.value.panels.netAreaMm2 / ref : 1
})

/** 每层分格（与裁片、图纸、备料、导出同一份权威结果） */
const layerRows = computed(() => {
  const l = lantern.value
  if (!l || !full.value) return []
  return full.value.panels.cells.layers.map((r, i) => ({
    res: r,
    spec: l.layerCells[i],
    height: l.layers[i]?.heightMm ?? 0,
    diameter: l.layers[i]?.diameterMm ?? 0,
    pieceN: layerPieceCount(l, i)
  }))
})

const cellsValid = computed(() => full.value?.panels.cells.valid ?? false)
const stale = computed(() => (lantern.value ? cellsExportStale(lantern.value) : false))

function modeLabel(m: CellMode): string {
  return MODE_NAME[m]
}

function onMode(i: number, e: Event) {
  const l = lantern.value
  if (!l) return
  setCellMode(l, i, (e.target as HTMLSelectElement).value as CellMode)
}

function exportCsv() {
  const l = lantern.value
  if (!l || !full.value || !cellsValid.value) return
  downloadText(`${l.name}-蒙面裁片与配色清单.csv`, panelsCsv(l, full.value.panels))
  markCellsExported(l)
}

function doVoid() {
  const l = lantern.value
  if (!l) return
  const reason = window.prompt(
    '把旧版分格与已发出的裁片清单/配色清单/图纸作废（已照旧配色裁好的布块需重裁）。请写一句作废原因：',
    '余数取舍选错（选成‘并进末格’，实际要‘余数单独成格’）'
  )
  if (reason === null) return
  voidExportedCells(l, reason)
}
</script>

<template>
  <div v-if="!lantern || !full" class="missing">找不到该灯样。<router-link to="/">返回</router-link></div>
  <div v-else class="panels-view">
    <section class="head">
      <div>
        <h2>蒙面裁片与缝份 · {{ lantern.name }}</h2>
        <p class="sub">
          蒙面 {{ coveringSpec(lantern.covering).name }} ·
          <b>缝份四边各 {{ lantern.seamAllowanceMm }}mm（已加进裁片尺寸）</b> ·
          实线 = 裁切线，绿色虚线 = 净样（折到背面的缝份线），裁片按格颜色填色，蓝色十字 = 对位标记
          <template v-if="lantern.kind === 'revolution'">
            · 旋转体按 <b>{{ lantern.divisions }} 等分</b>展开，每格块数由等分数分出
          </template>
        </p>
      </div>
      <div class="ops">
        <button :disabled="!cellsValid" :title="cellsValid ? '' : '分格校验未通过，先把各层块数对齐'" @click="exportCsv">
          导出裁片清单+配色清单 CSV
        </button>
        <button class="primary" @click="router.push(`/print/${lantern.id}?view=labels`)">打印裁片标签</button>
      </div>
    </section>

    <!-- 分格版本 / 过期作废提示 -->
    <section class="rev">
      <div class="rev-line">
        <span class="tag">分格第 {{ lantern.cellsRevision }} 版</span>
        <template v-if="lantern.exportedRevision">
          <span class="ok" v-if="!stale">已按第 {{ lantern.exportedRevision }} 版导出（{{ lantern.exportedAt }}），存档与单子同一版</span>
          <span class="bad" v-else>
            ⚠ 单子按第 {{ lantern.exportedRevision }} 版分格导出，存档已改到第 {{ lantern.cellsRevision }} 版：
            旧版存档分格、已发出的裁片清单/配色清单与裁片图<b>全部作废重出</b>，已照旧配色裁好的布块要<b>重裁</b>。
          </span>
        </template>
        <span v-else class="muted">尚未导出；改格数或颜色会让分格版本 +1</span>
      </div>
      <div v-if="lantern.voidedRevisions.length" class="void-list">
        <b>已作废留痕：</b>
        <span v-for="(v, i) in lantern.voidedRevisions" :key="i" class="void-item">
          第 {{ v.revision }} 版（{{ v.at }}）{{ v.reason }}；
        </span>
      </div>
      <button v-if="stale || lantern.exportedRevision" class="danger" @click="doVoid">登记本版作废并重出</button>
    </section>

    <section class="stats">
      <div class="stat"><span>裁片总块数</span><b>{{ full.panels.totalQty }}</b></div>
      <div class="stat"><span>裁片净面积</span><b>{{ (full.panels.netAreaMm2 / 1e6).toFixed(3) }} m²</b></div>
      <div class="stat"><span>含缝份裁片面积</span><b>{{ (full.panels.cutAreaMm2 / 1e6).toFixed(3) }} m²</b></div>
      <div class="stat"><span>灯体表面积</span><b>{{ full.materials.surfaceM2.toFixed(3) }} m²</b></div>
      <div class="stat"><span>净面积 / 表面积</span><b>{{ (ratio * 100).toFixed(2) }}%</b></div>
    </section>

    <!-- ============ 每层圆周分格编辑 ============ -->
    <section class="cell-editor">
      <h3>每层圆周分格（沿 1 号棱/0° 基准顺时针排格；改一处，裁片图/备料/三单全部跟着刷新）</h3>
      <div v-for="row in layerRows" :key="row.res.layerIndex" class="layer-block" :class="{ badblock: !!row.res.error }">
        <header class="lb-head">
          <div class="lb-title">
            第 {{ row.res.layerIndex + 1 }} 层
            <span class="muted">
              · 分段高 {{ row.height.toFixed(1) }}mm · 直径 {{ row.diameter.toFixed(1) }}mm ·
              本层裁片 <b>{{ row.pieceN }}</b> 块
            </span>
          </div>
          <div class="lb-mode">
            <label>分法</label>
            <select :value="row.res.mode" @change="onMode(row.res.layerIndex, $event)">
              <option value="whole">整块一色（1 格）</option>
              <option value="perPiece">一块一格（{{ row.pieceN }} 格，一块一色）</option>
              <option value="equal">按角度均分（填格数，除不尽二选一）</option>
              <option value="custom">几块一组（逐格填块数）</option>
            </select>
          </div>
        </header>

        <!-- 不可分格的层 -->
        <p v-if="!row.res.segmentable" class="reason">本层不按圆周分格：{{ row.res.reason }}</p>

        <template v-else>
          <div v-if="row.res.mode === 'equal'" class="equal-controls">
            <label>
              想分几格（≤ {{ row.pieceN }}）
              <input
                type="number"
                min="1"
                :max="row.pieceN"
                :value="row.spec.cellCount"
                @change="setCellCount(lantern!, row.res.layerIndex, Number(($event.target as HTMLInputElement).value))"
              />
            </label>
            <div class="rem-choices">
              <span>除不尽时余数归到哪（两条路必须认一条）：</span>
              <label :class="{ picked: row.spec.remainder === 'last' }">
                <input type="radio" :checked="row.spec.remainder === 'last'" @change="setRemainderRule(lantern!, row.res.layerIndex, 'last')" />
                并进最后一格 —— 格数不多不少、清单整齐；代价是有一格多 {{ row.res.remainderPieces }} 块
              </label>
              <label :class="{ picked: row.spec.remainder === 'extra' }">
                <input type="radio" :checked="row.spec.remainder === 'extra'" @change="setRemainderRule(lantern!, row.res.layerIndex, 'extra')" />
                余数单独成一格 —— 常规格每格 {{ row.res.quotient }} 块、装圈匀称；代价是多 1 格、清单多一行、下料易数错
              </label>
            </div>
          </div>

          <table class="cells-table">
            <thead>
              <tr>
                <th class="num">格</th>
                <th>颜色</th>
                <th class="num">块数</th>
                <th class="num">块号范围</th>
                <th class="num">占圆周</th>
                <th v-if="row.res.mode === 'custom'"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in row.res.cells" :key="c.index">
                <td class="num mono">{{ c.index + 1 }}</td>
                <td>
                  <input type="color" :value="c.color" @input="setCellColor(lantern!, row.res.layerIndex, c.index, ($event.target as HTMLInputElement).value)" />
                  <span class="mono hexc">{{ c.color }}</span>
                </td>
                <td class="num">
                  <input
                    v-if="row.res.mode === 'custom'"
                    class="pcs"
                    type="number"
                    min="0"
                    :max="row.pieceN"
                    :value="c.pieces"
                    @change="setCellPieces(lantern!, row.res.layerIndex, c.index, Number(($event.target as HTMLInputElement).value))"
                  />
                  <span v-else class="mono">{{ c.pieces }}</span>
                </td>
                <td class="num mono">{{ c.pieceFrom }}–{{ c.pieceTo }}</td>
                <td class="num mono">{{ c.angleDeg.toFixed(2) }}°</td>
                <td v-if="row.res.mode === 'custom'">
                  <button class="mini-btn" @click="removeCustomCell(lantern!, row.res.layerIndex, c.index)" :disabled="row.res.cells.length <= 1">删格</button>
                </td>
              </tr>
              <tr v-if="row.res.mode === 'custom'" class="add-row">
                <td colspan="6">
                  <button class="mini-btn" :disabled="row.res.cells.length >= row.pieceN" @click="addCustomCell(lantern!, row.res.layerIndex)">
                    + 加一格（不超过 {{ row.pieceN }} 格）
                  </button>
                </td>
              </tr>
              <tr class="sum-row" :class="{ mismatch: row.res.cells.reduce((a, c) => a + c.pieces, 0) !== row.pieceN }">
                <td colspan="2">各格块数加总（必须 = 本层 {{ row.pieceN }} 块）</td>
                <td class="num mono"><b>{{ row.res.cells.reduce((a, c) => a + c.pieces, 0) }}</b></td>
                <td class="num muted" colspan="3">共 {{ row.res.cells.length }} 格（格数 ≤ 块数 {{ row.pieceN }}）</td>
              </tr>
            </tbody>
          </table>

          <p class="rule-note">{{ row.res.ruleNote }}</p>
          <p v-if="row.res.error" class="error">✗ {{ row.res.error }}（该层分不匀，导出已禁用）</p>
        </template>
      </div>
    </section>

    <!-- ============ 按格拆开的裁片清单 ============ -->
    <div class="cards">
      <article v-for="p in full.panels.panels" :key="p.id" class="card">
        <header>
          <h3>
            <span class="dot" :style="{ background: p.color }" />
            {{ p.id }} · {{ p.label }}
          </h3>
          <span class="qty">× {{ p.qty }} 块</span>
        </header>
        <div class="diagram">
          <PanelDiagram :panel="p" />
        </div>
        <table class="dims">
          <tbody>
            <tr>
              <td>格 / 颜色</td>
              <td class="mono">
                <template v-if="p.layerIndex >= 0">第 {{ p.cellIndex + 1 }} 格 · 块号 {{ p.pieceFrom }}–{{ p.pieceTo }} · </template>{{ p.color }}
              </td>
            </tr>
            <tr>
              <td>展开净尺寸</td>
              <td class="mono">上 {{ p.rawWidthTopMm.toFixed(1) }} / 下 {{ p.rawWidthBottomMm.toFixed(1) }} × 高 {{ p.rawHeightMm.toFixed(1) }}</td>
            </tr>
            <tr class="cut">
              <td>裁切尺寸</td>
              <td class="mono">上 {{ p.widthTopMm.toFixed(1) }} / 下 {{ p.widthBottomMm.toFixed(1) }} × 高 {{ p.heightMm.toFixed(1) }}</td>
            </tr>
            <tr>
              <td>形状 / 缝份</td>
              <td class="mono">{{ p.label.includes('圆') ? '圆形/正多边形' : '梯形/矩形' }} · +{{ p.seamAllowanceMm }}×2</td>
            </tr>
          </tbody>
        </table>
        <p class="note">{{ p.note }}</p>
      </article>
    </div>

    <!-- ============ 按格配色清单 ============ -->
    <section class="palette">
      <h3>分层分格配色清单（与裁片清单、备料、存档同一套分格 · 第 {{ lantern.cellsRevision }} 版）</h3>
      <table>
        <thead>
          <tr>
            <th>层</th>
            <th>分法</th>
            <th class="num">格</th>
            <th>颜色</th>
            <th class="num">块数</th>
            <th class="num">块号范围</th>
            <th class="num">占圆周</th>
            <th class="num">分段高 (mm)</th>
            <th class="num">直径 (mm)</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in layerRows" :key="row.res.layerIndex">
            <tr v-if="!row.res.segmentable">
              <td class="mono">第 {{ row.res.layerIndex + 1 }} 层</td>
              <td colspan="8" class="reason">{{ row.res.reason }}</td>
            </tr>
            <template v-else>
              <tr v-for="c in row.res.cells" :key="c.index" :class="{ firstcell: c.index === 0 }">
                <td class="mono" v-if="c.index === 0" :rowspan="row.res.cells.length">第 {{ row.res.layerIndex + 1 }} 层</td>
                <td v-if="c.index === 0" :rowspan="row.res.cells.length">
                  {{ modeLabel(row.res.mode) }}<template v-if="row.res.mode === 'equal'">（{{ row.spec.remainder === 'last' ? '余数进末格' : '余数单成格' }}）</template>
                </td>
                <td class="num mono">{{ c.index + 1 }}</td>
                <td>
                  <span class="dot" :style="{ background: c.color }" />
                  <span class="mono">{{ c.color }}</span>
                </td>
                <td class="num mono">{{ c.pieces }}</td>
                <td class="num mono">{{ c.pieceFrom }}–{{ c.pieceTo }}</td>
                <td class="num mono">{{ c.angleDeg.toFixed(2) }}°</td>
                <td class="num mono" v-if="c.index === 0" :rowspan="row.res.cells.length">{{ row.height.toFixed(1) }}</td>
                <td class="num mono" v-if="c.index === 0" :rowspan="row.res.cells.length">{{ row.diameter.toFixed(1) }}</td>
              </tr>
            </template>
          </template>
          <template v-for="p in full.panels.panels.filter((x) => x.layerIndex < 0)" :key="p.id">
            <tr class="cover-row">
              <td class="mono">顶/底盖</td>
              <td>不分格（整片）</td>
              <td class="num">—</td>
              <td><span class="dot" :style="{ background: p.color }" /><span class="mono">{{ p.color }}</span></td>
              <td class="num mono">{{ p.qty }}</td>
              <td class="num muted" colspan="4">{{ p.note }}</td>
            </tr>
          </template>
        </tbody>
      </table>
    </section>

    <ChecksPanel
      :checks="full.checks.filter((c) => ['CHK-03', 'CHK-05', 'CHK-06', 'CHK-09'].includes(c.id))"
      :elapsed-ms="full.elapsedMs"
      title="裁片与分格自检"
    />
  </div>
</template>

<style scoped>
.panels-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
}

h2 {
  margin: 0 0 6px;
  font-size: 18px;
  color: #8f1c19;
  border-left: 4px solid var(--red);
  padding-left: 10px;
}

.sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-soft);
  max-width: 960px;
}

.ops {
  display: flex;
  gap: 8px;
}

button {
  font: inherit;
  cursor: pointer;
  border-radius: 6px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  padding: 6px 12px;
  font-size: 12.5px;
}

button:hover {
  border-color: var(--red);
  color: var(--red);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.primary {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
  font-weight: 600;
}

button.primary:hover {
  background: #9c1f1b;
  color: #fff;
}

button.danger {
  border-color: #b3241f;
  color: #b3241f;
  background: #fff;
  align-self: flex-start;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}

.stat {
  background: var(--surface);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
}

.stat span {
  font-size: 11px;
  color: var(--ink-soft);
}

.stat b {
  font-family: var(--mono);
  font-size: 15px;
}

.rev {
  background: #fff;
  border: 1px solid var(--line);
  border-left: 4px solid var(--gold, #b8891f);
  border-radius: 8px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
}

.tag {
  display: inline-block;
  background: #f6e3ba;
  color: #8f1c19;
  font-weight: 700;
  border-radius: 4px;
  padding: 1px 8px;
  margin-right: 8px;
}

.ok {
  color: var(--jade);
}

.bad {
  color: #b3241f;
}

.muted {
  color: var(--ink-soft);
}

.void-list {
  font-size: 12px;
  color: #6a5c52;
}

.void-item {
  margin-right: 6px;
}

.cell-editor {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 16px;
  box-shadow: var(--shadow);
}

.cell-editor h3 {
  margin: 0 0 10px;
  font-size: 14px;
}

.layer-block {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: #fff;
}

.layer-block.badblock {
  border-color: #e0a09a;
  background: #fdf4f3;
}

.lb-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.lb-title {
  font-weight: 700;
  color: #8f1c19;
}

.lb-mode select {
  font: inherit;
  font-size: 12.5px;
  padding: 4px 6px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
}

.equal-controls {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  align-items: flex-start;
  font-size: 12.5px;
  margin-bottom: 8px;
}

.equal-controls input[type='number'] {
  width: 64px;
  font-family: var(--mono);
  padding: 3px 6px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
}

.rem-choices {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rem-choices label {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px dashed transparent;
}

.rem-choices label.picked {
  background: #fdf3e2;
  border-color: #e8cfa4;
}

.cells-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  margin: 4px 0;
}

.cells-table th {
  text-align: left;
  font-weight: 500;
  color: var(--ink-soft);
  font-size: 11.5px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--line);
}

.cells-table td {
  padding: 4px 8px;
  border-bottom: 1px dashed var(--line);
}

.cells-table .num {
  text-align: right;
}

.cells-table input[type='color'] {
  width: 40px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--line-strong);
  border-radius: 4px;
}

.hexc {
  margin-left: 6px;
  font-size: 12px;
}

.pcs {
  width: 64px;
  font-family: var(--mono);
  padding: 2px 6px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
}

.add-row td {
  text-align: center;
}

.mini-btn {
  padding: 2px 10px;
  font-size: 12px;
}

.sum-row td {
  background: var(--surface-2);
  font-weight: 600;
}

.sum-row.mismatch {
  color: #b3241f;
}

.rule-note {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.6;
}

.reason {
  margin: 4px 0;
  font-size: 12.5px;
  color: #8a4b12;
}

.error {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: #b3241f;
  font-weight: 600;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 14px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: var(--shadow);
}

.card header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.card h3 {
  margin: 0;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid var(--line-strong);
}

.qty {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--red);
  background: #fbeae6;
  border-radius: 999px;
  padding: 2px 9px;
}

.diagram {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px;
}

.dims {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.dims td {
  padding: 3px 6px;
  border-bottom: 1px dashed var(--line);
}

.dims td:first-child {
  color: var(--ink-soft);
  width: 96px;
}

.dims tr.cut td {
  color: #8f1c19;
  font-weight: 600;
}

.mono {
  font-family: var(--mono);
}

.note {
  margin: 0;
  font-size: 11.5px;
  color: var(--ink-soft);
  line-height: 1.5;
}

.palette {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 16px;
  box-shadow: var(--shadow);
}

.palette h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.palette table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.palette th {
  text-align: left;
  color: var(--ink-soft);
  font-weight: 500;
  font-size: 11.5px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--line);
}

.palette td {
  padding: 5px 10px;
  border-bottom: 1px dashed var(--line);
}

.palette tr.cover-row td {
  background: #faf6ec;
}

.num {
  text-align: right;
}

.missing {
  padding: 40px;
  text-align: center;
}
</style>
