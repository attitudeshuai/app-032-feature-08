<script setup lang="ts">
/** 圆周分格示意图：一圈 = 一层，每个扇区 = 一块裁片，按格填色；块序号 1 起、从正上方顺时针绕圈 */
import { computed } from 'vue'
import type { SegmentPlan } from '../core/segments'

const props = defineProps<{ plan: SegmentPlan }>()

const CX = 50
const CY = 50
const R_OUT = 37
const R_IN = 21
const R_LABEL = 44.5

function pt(r: number, a: number): string {
  return `${(CX + r * Math.cos(a)).toFixed(2)},${(CY + r * Math.sin(a)).toFixed(2)}`
}

/** 扇环（一块裁片）：从 a0 到 a1（弧度，0 = 正右，顺时针为正） */
function annular(a0: number, a1: number): string {
  return `M ${pt(R_OUT, a0)} A ${R_OUT} ${R_OUT} 0 0 1 ${pt(R_OUT, a1)} L ${pt(R_IN, a1)} A ${R_IN} ${R_IN} 0 0 0 ${pt(R_IN, a0)} Z`
}

const slots = computed(() => {
  const p = props.plan
  const N = Math.max(1, p.panelCount)
  const out: { d: string; color: string; title: string }[] = []
  for (let s = 0; s < p.actual; s++) {
    for (let j = 0; j < p.counts[s]; j++) {
      const idx = p.starts[s] + j
      const a0 = -Math.PI / 2 + (2 * Math.PI * idx) / N
      const a1 = -Math.PI / 2 + (2 * Math.PI * (idx + 1)) / N
      out.push({
        d: annular(a0, a1),
        color: p.colors[s],
        title: `第 ${idx + 1} 块 · 第 ${s + 1} 格（${p.colors[s]}）`
      })
    }
  }
  return out
})

/** 格界刻度与格号（标在每格中角上） */
const segMarks = computed(() => {
  const p = props.plan
  const N = Math.max(1, p.panelCount)
  return p.starts.map((st, s) => {
    const mid = -Math.PI / 2 + (2 * Math.PI * (st + p.counts[s] / 2)) / N
    return {
      n: s + 1,
      x: CX + R_LABEL * Math.cos(mid),
      y: CY + R_LABEL * Math.sin(mid),
      color: p.colors[s]
    }
  })
})
</script>

<template>
  <svg class="ring" viewBox="0 0 100 100" role="img" :aria-label="`第 ${plan.layerIndex + 1} 层分格示意图`">
    <g v-for="(s, i) in slots" :key="i">
      <path :d="s.d" :fill="s.color" fill-opacity="0.82" stroke="#fff" stroke-width="0.7">
        <title>{{ s.title }}</title>
      </path>
    </g>
    <circle :cx="CX" :cy="CY" :r="R_IN - 1.2" fill="#fff" stroke="var(--line-strong, #b9a88f)" stroke-width="0.4" />
    <text :x="CX" :y="CY - 1.5" text-anchor="middle" class="ctr">{{ plan.panelCount }} 块</text>
    <text :x="CX" :y="CY + 5.5" text-anchor="middle" class="ctr sub">{{ plan.actual }} 格</text>
    <text
      v-for="m in segMarks"
      :key="m.n"
      :x="m.x"
      :y="m.y"
      text-anchor="middle"
      dominant-baseline="middle"
      class="seg-no"
    >
      {{ m.n }}
    </text>
  </svg>
</template>

<style scoped>
.ring {
  width: 100%;
  height: auto;
  display: block;
}

.ctr {
  font-size: 7.5px;
  font-weight: 700;
  fill: var(--ink, #2b2320);
  font-family: var(--mono, monospace);
}

.ctr.sub {
  font-size: 6px;
  font-weight: 500;
  fill: var(--ink-soft, #6a5c52);
}

.seg-no {
  font-size: 7px;
  font-weight: 700;
  fill: var(--ink, #2b2320);
  font-family: var(--mono, monospace);
}
</style>
