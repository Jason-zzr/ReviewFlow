<script setup lang="ts">
import type { RubricVersion, ScoreCard } from "@reviewflow/domain";

defineProps<{ rubric: RubricVersion; scoreCard: ScoreCard | null; busy: boolean }>();
defineEmits<{ score: [] }>();
</script>

<template>
  <section class="score-ledger">
    <div class="ledger-summary">
      <div>
        <span class="eyebrow">Preflight score</span>
        <h3>发布前校准</h3>
      </div>
      <div class="score-orbit" :class="{ empty: !scoreCard }">
        <strong>{{ scoreCard?.composite.toFixed(1) ?? "—" }}</strong>
        <span>/ 10</span>
      </div>
    </div>
    <div class="dimension-list">
      <div v-for="dimension in rubric.dimensions" :key="dimension.code" class="dimension-row">
        <div>
          <code>{{ dimension.code }}</code>
          <span>{{ dimension.name }}</span>
        </div>
        <div class="score-dots" :aria-label="`${dimension.name}评分`">
          <i
            v-for="step in 5"
            :key="step"
            :class="{ active: step <= (scoreCard?.dimensions.find((item) => item.code === dimension.code)?.score ?? 0) }"
          />
        </div>
      </div>
    </div>
    <button class="primary-action" :disabled="busy" @click="$emit('score')">
      {{ busy ? "正在校准…" : scoreCard ? "重新评分" : "开始评分" }}
    </button>
  </section>
</template>

