<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChecksPanel from '../components/ChecksPanel.vue'
import { cellsExportStale, getLantern, markCellsExported, voidExportedCells } from '../core/store'
import { computeAll } from '../core/checks'
import { DEFAULT_LOFT_OPTIONS } from '../core/paginate'
import { downloadText, materialsCsv } from '../core/exporter'
import { coveringSpec, CRAFT } from '../core/craft'
import { cellFabricRows, cellFabricTotals } from '../core/materials'

const route = useRoute()
const router = useRouter()
const lantern = computed(() => getLantern(route.params.id as string))
const full = computed(() => {
  const l = lantern.value
  if (!l) return null
  return computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: l.pageSize, overlapMm: l.overlapMm })
})

const cov = computed(() => (lantern.value ? coveringSpec(lantern.value.covering) : null))

/** 蒙面用量按格拆开（来自同一份分格，与裁片清单/配色清单同源） */
const cellRows = computed(() => (full.value ? cellFabricRows(full.value.panels) : []))
const cellTotals = computed(() => cellFabricTotals(cellRows.value))
const batchK = computed(() => (full.value ? full.value.batch.count * (1 + full.value.batch.wasteRatio) : 1))
const stale = computed(() => (lantern.value ? cellsExportStale(lantern.value) : false))
const cellsValid = computed(() => full.value?.panels.cells.valid ?? false)

function exportCsv() {
  const l = lantern.value
  if (!l || !full.value || !cellsValid.value) return
  downloadText(`${l.name}-备料单.csv`, materialsCsv(l, full.value.materials, full.value.batch, cellRows.value))
  markCellsExported(l)
}

function doVoid() {
  const l = lantern.value
  if (!l) return
  const reason = window.prompt('把旧版分格与已发出的备料单/裁片清单/图纸作废（已照旧配色裁好的布块需重裁），请写作废原因：', '分法取舍选错，旧版作废')
  if (reason === null) return
  voidExportedCells(l, reason)
}
</script>

<template>
  <div v-if="!lantern || !full || !cov" class="missing">找不到该灯样。<router-link to="/">返回</router-link></div>
  <div v-else class="materials">
    <section class="head">
      <div>
        <h2>材料统计与备料单 · {{ lantern.name }}</h2>
        <p class="sub">
          竹篾按<b>含绑扎余量</b>长度备料；蒙面按<b>含缝份</b>的裁片面积备料；
          批量总量 = 单灯 × 数量 × (1 + 损耗率)。
        </p>
      </div>
      <div class="ops">
        <button :disabled="!cellsValid" @click="exportCsv">导出备料单 CSV</button>
        <button class="primary" @click="router.push(`/print/${lantern.id}?view=frame`)">打印备料 / 清单</button>
      </div>
    </section>

    <!-- 分格版本 / 作废 -->
    <section class="rev">
      <div>
        <span class="tag">分格第 {{ lantern.cellsRevision }} 版</span>
        <span v-if="stale" class="bad">
          ⚠ 备料单基于第 {{ lantern.exportedRevision }} 版分格，存档已是第 {{ lantern.cellsRevision }} 版：旧备料单、裁片清单与图纸作废重出，已照旧配色裁好的布块需重裁。
        </span>
        <span v-else-if="lantern.exportedRevision" class="ok">已按第 {{ lantern.exportedRevision }} 版导出（{{ lantern.exportedAt }}）</span>
        <span v-else class="muted">尚未导出；改格数或颜色版本 +1。</span>
        <button v-if="stale || lantern.exportedRevision" class="danger" @click="doVoid">登记作废并重出</button>
      </div>
      <div v-if="lantern.voidedRevisions.length" class="void-list">
        <b>已作废：</b>
        <span v-for="(v, i) in lantern.voidedRevisions" :key="i">第 {{ v.revision }} 版（{{ v.reason }}）；</span>
      </div>
    </section>

    <section class="batch">
      <div class="field">
        <label>批量数量（个）</label>
        <input v-model.number="lantern.batchCount" type="number" min="1" max="500" step="1" />
      </div>
      <div class="field">
        <label>损耗率 <em>{{ (lantern.wasteRatio * 100).toFixed(0) }}%</em></label>
        <input v-model.number="lantern.wasteRatio" type="range" min="0" max="0.2" step="0.01" />
      </div>
      <p class="formula mono">
        批量 = 单灯 × {{ Math.max(1, Math.round(lantern.batchCount)) }} × {{ (1 + lantern.wasteRatio).toFixed(2) }}
      </p>
    </section>

    <section class="tables">
      <table class="tally">
        <thead>
          <tr>
            <th>项目</th>
            <th class="num">单灯</th>
            <th class="num">批量 {{ full.batch.count }} 个（含损耗）</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>竹篾 / 铁丝（含绑扎余量）</td>
            <td class="num mono">{{ full.materials.frameM.toFixed(3) }} m</td>
            <td class="num mono strong">{{ full.batch.frameM.toFixed(3) }} m</td>
          </tr>
          <tr>
            <td>构件净长合计</td>
            <td class="num mono">{{ full.materials.frameRawM.toFixed(3) }} m</td>
            <td class="num mono">{{ full.batch.frameRawM.toFixed(3) }} m</td>
          </tr>
          <tr>
            <td>蒙面 {{ cov.name }}（含缝份）</td>
            <td class="num mono">{{ full.materials.coveringM2.toFixed(3) }} m²</td>
            <td class="num mono strong">{{ full.batch.coveringM2.toFixed(3) }} m²</td>
          </tr>
          <tr>
            <td>蒙面净面积（不含缝份）</td>
            <td class="num mono">{{ full.materials.coveringNetM2.toFixed(3) }} m²</td>
            <td class="num mono">{{ full.batch.coveringNetM2.toFixed(3) }} m²</td>
          </tr>
          <tr>
            <td>扎线（{{ full.materials.lashJoints }} 处绑扎 × {{ CRAFT.lashPerJointM }}m/处）</td>
            <td class="num mono">{{ full.materials.lashM.toFixed(3) }} m</td>
            <td class="num mono">{{ full.batch.lashM.toFixed(3) }} m</td>
          </tr>
          <tr>
            <td>胶（{{ cov.name }} {{ cov.gluePerM2 }}g/m²）</td>
            <td class="num mono">{{ full.materials.glueG.toFixed(1) }} g</td>
            <td class="num mono">{{ full.batch.glueG.toFixed(1) }} g</td>
          </tr>
          <tr class="led">
            <td>LED 灯珠建议</td>
            <td class="num mono">{{ full.materials.ledCount }} 颗</td>
            <td class="num mono">{{ full.batch.ledCount }} 颗</td>
          </tr>
        </tbody>
      </table>

      <div class="side">
        <div class="stat"><span>灯体体积</span><b>{{ full.materials.volumeL.toFixed(3) }} L</b></div>
        <div class="stat"><span>灯体表面积</span><b>{{ full.materials.surfaceM2.toFixed(3) }} m²</b></div>
        <div class="stat"><span>构件总根数</span><b>{{ full.frame.totalQty }}</b></div>
        <div class="stat"><span>裁片总块数</span><b>{{ full.panels.totalQty }}</b></div>
        <p class="rule">LED 建议规则：{{ CRAFT.led.rule }}</p>
      </div>
    </section>

    <section class="palette">
      <h3>蒙面用量按格拆开（与裁片清单、配色清单同一套分格 · 第 {{ lantern.cellsRevision }} 版）</h3>
      <p class="unit-note">面积单位 m²：单块四位小数、合计三位小数；块数为整数。批量 = 单灯 × {{ full.batch.count }} × (1+{{ (full.batch.wasteRatio * 100).toFixed(0) }}%)。</p>
      <table>
        <thead>
          <tr>
            <th>层 · 格</th>
            <th>颜色</th>
            <th class="num">块数</th>
            <th class="num">单块面积 (m²)</th>
            <th class="num">单灯蒙面 (m²)</th>
            <th class="num">批量蒙面 (m²)</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in cellRows" :key="i" :class="{ cover: r.isCover }">
            <td class="mono">{{ r.label }}</td>
            <td>
              <span class="dot" :style="{ background: r.color }" />
              <span class="mono">{{ r.color }}</span>
            </td>
            <td class="num mono">{{ r.pieces }}</td>
            <td class="num mono">{{ r.perPieceM2.toFixed(4) }}</td>
            <td class="num mono strong">{{ r.cutAreaM2.toFixed(3) }}</td>
            <td class="num mono strong">{{ (r.cutAreaM2 * batchK).toFixed(3) }}</td>
            <td class="muted">{{ r.reason }}</td>
          </tr>
          <tr class="sum-row">
            <td>各格合计（须 = 蒙面含缝份总量）</td>
            <td></td>
            <td class="num mono">{{ cellTotals.pieces }}</td>
            <td></td>
            <td class="num mono strong">{{ cellTotals.cutM2.toFixed(3) }}</td>
            <td class="num mono strong">{{ (cellTotals.cutM2 * batchK).toFixed(3) }}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </section>

    <ChecksPanel :checks="full.checks" :elapsed-ms="full.elapsedMs" title="全量验收自检（§10）" />
  </div>
</template>

<style scoped>
.materials {
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
  max-width: 900px;
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

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.danger {
  border-color: #b3241f;
  color: #b3241f;
  background: #fff;
  margin-left: 10px;
}

.rev {
  background: #fff;
  border: 1px solid var(--line);
  border-left: 4px solid var(--gold, #b8891f);
  border-radius: 8px;
  padding: 9px 14px;
  font-size: 12.5px;
  display: flex;
  flex-direction: column;
  gap: 4px;
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

.batch {
  display: flex;
  gap: 24px;
  align-items: flex-end;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 16px;
  box-shadow: var(--shadow);
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
}

label {
  font-size: 12px;
  color: var(--ink-soft);
}

label em {
  font-style: normal;
  font-family: var(--mono);
  color: var(--blue);
}

input[type='number'] {
  font: inherit;
  font-size: 13px;
  padding: 5px 8px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  width: 120px;
  font-family: var(--mono);
}

input[type='range'] {
  width: 180px;
  accent-color: var(--red);
}

.formula {
  margin: 0 0 4px auto;
  font-size: 13px;
  color: #8f1c19;
  background: #fbeae6;
  padding: 5px 12px;
  border-radius: 6px;
}

.tables {
  display: grid;
  grid-template-columns: 1fr minmax(240px, 300px);
  gap: 16px;
  align-items: start;
}

@media (max-width: 900px) {
  .tables {
    grid-template-columns: 1fr;
  }
}

.tally,
.palette table {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  font-size: 13px;
  box-shadow: var(--shadow);
}

.tally th,
.palette th {
  text-align: left;
  padding: 8px 14px;
  background: var(--surface-2);
  color: var(--ink-soft);
  font-weight: 500;
  font-size: 11.5px;
  border-bottom: 1px solid var(--line);
}

.tally td,
.palette td {
  padding: 8px 14px;
  border-bottom: 1px dashed var(--line);
}

.tally tr:last-child td,
.palette tr:last-child td {
  border-bottom: none;
}

tr.led td {
  background: #fff9ec;
}

.num {
  text-align: right;
}

.mono {
  font-family: var(--mono);
}

.strong {
  font-weight: 700;
  color: #8f1c19;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}

.stat {
  background: var(--surface);
  padding: 9px 14px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}

.stat span {
  font-size: 11.5px;
  color: var(--ink-soft);
}

.stat b {
  font-family: var(--mono);
  font-size: 14px;
}

.rule {
  margin: 0;
  background: var(--surface);
  padding: 10px 14px;
  font-size: 11.5px;
  color: var(--ink-soft);
}

.palette {
  box-shadow: var(--shadow);
  border-radius: 10px;
}

.palette h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.unit-note {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--ink-soft);
}

.palette tr.cover td {
  background: #faf6ec;
}

.palette tr.sum-row td {
  background: var(--surface-2);
  font-weight: 700;
}

.dot {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 3px;
  margin-right: 5px;
  border: 1px solid var(--line-strong);
}

.missing {
  padding: 40px;
  text-align: center;
}
</style>
