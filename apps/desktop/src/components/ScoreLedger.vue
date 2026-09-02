<script setup lang="ts">
import type { RubricDimensionCode, RubricVersion, ScoreCard } from "@reviewflow/domain";

const props = defineProps<{ rubric: RubricVersion; scoreCard: ScoreCard | null; busy: boolean }>();
defineEmits<{ score: [] }>();

const assessmentFor = (code: RubricDimensionCode) =>
  props.scoreCard?.dimensions.find((item) => item.code === code);
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
    <div v-if="scoreCard" class="score-meta" :title="`公式 ID：${scoreCard.rubricVersionId}`">
      <strong>公式 v{{ rubric.version }} · {{ rubric.name }}</strong>
      <span>{{ scoreCard.model ?? "未记录模型" }} · {{ scoreCard.promptVersion ?? "未记录提示版本" }}</span>
    </div>
    <div class="dimension-list" :class="{ 'score-evidence-list': scoreCard }">
      <article v-for="dimension in rubric.dimensions" :key="dimension.code" class="dimension-row">
        <div class="dimension-row-head">
          <div>
            <code>{{ dimension.code }}</code>
            <span>{{ dimension.name }}</span>
          </div>
          <div class="dimension-score">
            <div class="score-dots" :aria-label="`${dimension.name}评分 ${assessmentFor(dimension.code)?.score ?? 0} / 5`">
              <i
                v-for="step in 5"
                :key="step"
                :class="{ active: step <= (assessmentFor(dimension.code)?.score ?? 0) }"
              />
            </div>
            <strong>{{ assessmentFor(dimension.code)?.score ?? 0 }}/5</strong>
          </div>
        </div>
        <div v-if="assessmentFor(dimension.code)" class="dimension-evidence">
          <p><strong>评分依据</strong>{{ assessmentFor(dimension.code)?.evidence }}</p>
          <p v-if="assessmentFor(dimension.code)?.suggestion"><strong>改进建议</strong>{{ assessmentFor(dimension.code)?.suggestion }}</p>
        </div>
      </article>
    </div>
    <button class="primary-action" :disabled="busy" @click="$emit('score')">
      {{ busy ? "正在校准…" : scoreCard ? "重新评分" : "开始评分" }}
    </button>
  </section>
</template>
