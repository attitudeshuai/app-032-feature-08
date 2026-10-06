<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PanelDiagram from '../components/PanelDiagram.vue'
import SegmentRing from '../components/SegmentRing.vue'
import ChecksPanel from '../components/ChecksPanel.vue'
import { getLantern } from '../core/store'
import { computeAll } from '../core/checks'
import { DEFAULT_LOFT_OPTIONS } from '../core/paginate'
import { bodySurfaceArea } from '../core/geometry'
import { downloadText, panelsCsv, paletteCsv, shapeName } from '../core/exporter'
import { coveringSpec } from '../core/craft'
import { computeLayerPlans, fmtBlockRange, layerPanelCount } from '../core/segments'
import type { Lantern, LayerSegmentSetting, RemainderMode } from '../core/types'

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

/** 分格方案：本页格数/颜色、裁片图填色、导出单子、本机存档都从这同一份算出来 */
const plans = computed(() => (lantern.value ? computeLayerPlans(lantern.value) : []))
const panelCount = computed(() => (lantern.value ? layerPanelCount(lantern.value) : 0))
const segmentable = computed(() => !!lantern.value && lantern.value.kind !== 'polyhedron')

/** 配色清单行：每一层每一格一行 */
const palette = computed(() => {
  const l = lantern.value
  if (!l) return []
  const rows: {
    key: string
    layer: number
    seg: number
    segCount: number
    color: string
    qty: number
    range: string
    method: string
    note: string
  }[] = []
  for (const plan of plans.value) {
    if (plan.panelCount <= 0) continue
    for (let s = 0; s < plan.actual; s++) {
      rows.push({
        key: `${plan.layerIndex}-${s}`,
        layer: plan.layerIndex + 1,
        seg: s + 1,
        segCount: plan.actual,
        color: plan.colors[s],
        qty: plan.counts[s],
        range: fmtBlockRange(plan.starts[s] + 1, plan.starts[s] + plan.counts[s]),
        method: plan.methodLabel,
        note: s === 0 ? [plan.note, plan.cost].filter(Boolean).join('；') : ''
      })
    }
  }
  return rows
})

// ---- 分格编辑（直接写进灯样，本机存档随之刷新） ----
function ensureSetting(l: Lantern, i: number): LayerSegmentSetting {
  if (!l.layerSegments) l.layerSegments = []
  while (l.layerSegments.length < l.layers.length) l.layerSegments.push(null)
  let s = l.layerSegments[i]
  if (!s) {
    s = { count: 1, colors: [l.layerColors[i] || l.color], remainder: 'merge-last' }
    l.layerSegments[i] = s
  }
  return s
}

function segCountOf(i: number): number {
  const l = lantern.value
  if (!l) return 1
  return l.layerSegments?.[i]?.count ?? 1
}

function setCount(i: number, e: Event) {
  const l = lantern.value
  if (!l) return
  const n = panelCount.value
  const v = Math.max(1, Math.min(n, Math.round(Number((e.target as HTMLInputElement).value) || 1)))
  const s = ensureSetting(l, i)
  s.count = v
  // 颜色槽补齐（余数单独成格时实际格数 = count + 1）
  const layerColor = l.layerColors[i] || l.color
  while (s.colors.length < v + 1) s.colors.push(layerColor)
}

function setRemainder(i: number, mode: RemainderMode) {
  const l = lantern.value
  if (!l) return
  ensureSetting(l, i).remainder = mode
}

function setSegColor(i: number, sIdx: number, e: Event) {
  const l = lantern.value
  if (!l) return
  const v = (e.target as HTMLInputElement).value
  if (plans.value[i]?.actual <= 1) {
    // 未分格：这一色就是层配色，与设计页同一处
    l.layerColors[i] = v
    return
  }
  const s = ensureSetting(l, i)
  while (s.colors.length <= sIdx) s.colors.push(l.layerColors[i] || l.color)
  s.colors[sIdx] = v
}

function exportCsv() {
  const l = lantern.value
  if (!l || !full.value) return
  downloadText(`${l.name}-蒙面裁片清单.csv`, panelsCsv(l, full.value.panels.panels))
}

function exportPalette() {
  const l = lantern.value
  if (!l) return
  downloadText(`${l.name}-配色清单.csv`, paletteCsv(l, plans.value))
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
          实线 = 裁切线，绿色虚线 = 净样（折到背面的缝份线），蓝色十字 = 对位标记 ·
          裁片图按格填色（填充色 = 该格颜色）
          <template v-if="lantern.kind === 'revolution'">
            · 旋转体按 <b>{{ lantern.divisions }} 等分</b>近似展开，每格块数由等分数分出
          </template>
        </p>
      </div>
      <div class="ops">
        <button @click="exportCsv">导出裁片清单 CSV</button>
        <button @click="exportPalette">导出配色清单 CSV</button>
        <button class="primary" @click="router.push(`/print/${lantern.id}?view=labels`)">打印裁片标签</button>
      </div>
    </section>

    <section class="stats">
      <div class="stat"><span>裁片总块数</span><b>{{ full.panels.totalQty }}</b></div>
      <div class="stat"><span>裁片净面积</span><b>{{ (full.panels.netAreaMm2 / 1e6).toFixed(3) }} m²</b></div>
      <div class="stat"><span>含缝份裁片面积</span><b>{{ (full.panels.cutAreaMm2 / 1e6).toFixed(3) }} m²</b></div>
      <div class="stat"><span>灯体表面积</span><b>{{ full.materials.surfaceM2.toFixed(3) }} m²</b></div>
      <div class="stat"><span>净面积 / 表面积</span><b>{{ (ratio * 100).toFixed(2) }}%</b></div>
    </section>

    <!-- ============ 圆周分格配色（每一层绕圈分格） ============ -->
    <section v-if="segmentable" class="seg-editor">
      <h3>圆周分格配色（每一层绕圈分格，每格一个颜色）</h3>
      <p class="seg-warn">
        ⚠ 格数与颜色<b>实时写入本机存档</b>，裁片清单、配色清单、备料按格面积与 1:1 图纸全部由同一份分格算出、随之刷新；
        <b>一旦改动，此前导出的单子与图纸即作废需重出，已照旧配色裁好的布要重裁。</b>
        块数除不尽时只能二选一：余数并入最后一格（格数不多不少、清单整齐，代价是有一格块数偏多），
        或余数单独成一格（每格块数一样、绕圈匀称，代价是格数多一格、清单多一行、下料易数错）。
      </p>

      <div v-for="(plan, i) in plans" :key="i" class="seg-layer">
        <div class="seg-ring">
          <SegmentRing :plan="plan" />
        </div>
        <div class="seg-body">
          <header>
            <b>第 {{ i + 1 }} 层</b>
            <span class="mono">共 {{ plan.panelCount }} 块 · {{ plan.methodLabel }}</span>
            <span v-if="plan.clampNote" class="clamp">⚠ {{ plan.clampNote }}</span>
          </header>

          <div class="seg-controls">
            <label class="fld">
              格数（1 = 未分格，最多 {{ plan.panelCount }} 格）
              <input
                type="number"
                min="1"
                :max="plan.panelCount"
                step="1"
                :value="segCountOf(i)"
                @change="setCount(i, $event)"
              />
            </label>

            <div v-if="plan.remainder > 0 && plan.requested > 1" class="remainder">
              <span class="rlabel">余 {{ plan.remainder }} 块（{{ plan.panelCount }} ÷ {{ plan.requested }} = 每格 {{ plan.base }} 块），取舍二选一：</span>
              <label>
                <input
                  type="radio"
                  :name="`rem-${i}`"
                  :checked="plan.remainderMode === 'merge-last'"
                  @change="setRemainder(i, 'merge-last')"
                />
                并入最后一格 —— 格数不多不少、清单整齐；<em>代价：最后一格 {{ plan.base + plan.remainder }} 块，比别的格多 {{ plan.remainder }} 块</em>
              </label>
              <label>
                <input
                  type="radio"
                  :name="`rem-${i}`"
                  :checked="plan.remainderMode === 'extra'"
                  @change="setRemainder(i, 'extra')"
                />
                余数单独成一格 —— 每格 {{ plan.base }} 块、绕圈匀称；<em>代价：实际 {{ plan.requested + 1 }} 格（多 1 格）、清单多一行、下料易数错</em>
              </label>
            </div>
          </div>

          <div class="seg-colors">
            <div v-for="s in plan.actual" :key="s" class="seg-color">
              <input
                type="color"
                :value="plan.colors[s - 1]"
                @change="setSegColor(i, s - 1, $event)"
              />
              <span class="mono">
                第 {{ s }} 格 · {{ plan.counts[s - 1] }} 块（{{
                  fmtBlockRange(plan.starts[s - 1] + 1, plan.starts[s - 1] + plan.counts[s - 1])
                }}）
              </span>
            </div>
          </div>

          <p class="seg-note">{{ plan.note }}<template v-if="plan.cost">；{{ plan.cost }}</template></p>
        </div>
      </div>
    </section>
    <section v-else class="seg-editor">
      <h3>圆周分格配色</h3>
      <p class="seg-note">多面体灯为整体三角侧片（不分层、不绕圈分格），整灯一种蒙面色，在「设计」页配色处修改。</p>
    </section>

    <div class="cards">
      <article v-for="p in full.panels.panels" :key="p.id" class="card">
        <header>
          <h3>
            <span class="dot" :style="{ background: p.color }" />
            {{ p.label }}
          </h3>
          <span class="qty">× {{ p.qty }} 块</span>
        </header>
        <div class="diagram">
          <PanelDiagram :panel="p" />
        </div>
        <table class="dims">
          <tbody>
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
              <td class="mono">{{ shapeName(p.shape) }} · +{{ p.seamAllowanceMm }}×2</td>
            </tr>
            <tr v-if="p.radiusMm">
              <td>净半径</td>
              <td class="mono">{{ p.radiusMm.toFixed(1) }}mm</td>
            </tr>
            <tr v-if="p.layerIndex >= 0">
              <td>层 / 格</td>
              <td class="mono">
                第 {{ p.layerIndex + 1 }} 层 · 第 {{ (p.segmentIndex ?? 0) + 1 }}/{{ p.segmentCount ?? 1 }} 格 ·
                绕圈第 {{ fmtBlockRange(p.segmentFrom ?? 1, p.segmentTo ?? p.qty) }} 块
              </td>
            </tr>
          </tbody>
        </table>
        <p class="note">{{ p.note }}</p>
        <details>
          <summary>对位标记（{{ p.marksMm.length }} 处）</summary>
          <ol>
            <li v-for="(m, i) in p.marksMm" :key="i">
              <b>{{ i + 1 }}</b> {{ m.label }}：x={{ m.x.toFixed(1) }} y={{ m.y.toFixed(1) }} mm
            </li>
          </ol>
        </details>
      </article>
    </div>

    <section class="palette">
      <h3>配色清单（圆周分格，每一层每一格一行；块数为整数）</h3>
      <table>
        <thead>
          <tr>
            <th>层</th>
            <th>格</th>
            <th>颜色</th>
            <th class="num">该格块数</th>
            <th class="num">绕圈块序号</th>
            <th>分法 / 余数取舍</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in palette" :key="r.key">
            <td class="mono">第 {{ r.layer }} 层</td>
            <td class="mono">第 {{ r.seg }}/{{ r.segCount }} 格</td>
            <td>
              <span class="dot" :style="{ background: r.color }" />
              <span class="mono">{{ r.color }}</span>
            </td>
            <td class="num mono">{{ r.qty }} 块</td>
            <td class="num mono">{{ r.range }}</td>
            <td class="method">
              {{ r.method }}
              <small v-if="r.note">{{ r.note }}</small>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <ChecksPanel
      :checks="full.checks.filter((c) => ['CHK-03', 'CHK-05', 'CHK-06', 'CHK-09'].includes(c.id))"
      :elapsed-ms="full.elapsedMs"
      title="裁片、分格与分页自检"
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
  max-width: 900px;
}

.ops {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
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

/* ---------- 圆周分格编辑器 ---------- */
.seg-editor {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 16px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.seg-editor h3 {
  margin: 0;
  font-size: 14px;
}

.seg-warn {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #8a4b12;
  background: #fdf3e2;
  border: 1px solid #e8cfa4;
  border-radius: 6px;
  padding: 8px 10px;
}

.seg-layer {
  display: grid;
  grid-template-columns: 150px 1fr;
  gap: 14px;
  border-top: 1px dashed var(--line);
  padding-top: 12px;
}

@media (max-width: 720px) {
  .seg-layer {
    grid-template-columns: 1fr;
  }
}

.seg-ring {
  max-width: 150px;
}

.seg-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.seg-body header {
  display: flex;
  gap: 10px;
  align-items: baseline;
  flex-wrap: wrap;
  font-size: 13px;
}

.clamp {
  color: var(--red);
  font-size: 12px;
}

.seg-controls {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  align-items: flex-start;
}

.fld {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--ink-soft);
}

.fld input {
  font: inherit;
  font-family: var(--mono);
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  width: 90px;
  background: #fff;
}

.remainder {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  background: var(--surface-2);
  border: 1px dashed var(--line-strong);
  border-radius: 8px;
  padding: 8px 10px;
  max-width: 640px;
}

.remainder .rlabel {
  color: var(--ink);
  font-weight: 600;
}

.remainder label {
  display: flex;
  gap: 6px;
  align-items: baseline;
  color: var(--ink-soft);
  cursor: pointer;
}

.remainder em {
  font-style: normal;
  color: #8a4b12;
}

.seg-colors {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.seg-color {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-soft);
}

.seg-color input[type='color'] {
  width: 40px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  background: #fff;
}

.seg-note {
  margin: 0;
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.6;
}

/* ---------- 裁片卡片 ---------- */
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
  font-size: 14px;
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
  font-size: 12px;
  color: var(--ink-soft);
}

details {
  font-size: 12px;
  color: var(--ink-soft);
}

summary {
  cursor: pointer;
}

ol {
  margin: 6px 0 0;
  padding-left: 18px;
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
  padding: 6px 10px;
  border-bottom: 1px dashed var(--line);
  vertical-align: top;
}

.num {
  text-align: right;
}

.method {
  font-size: 12px;
}

.method small {
  display: block;
  color: var(--ink-soft);
  margin-top: 2px;
  line-height: 1.5;
}

.missing {
  padding: 40px;
  text-align: center;
}
</style>
