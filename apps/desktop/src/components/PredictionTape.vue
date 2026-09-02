<script setup lang="ts">
import type { Prediction } from "@reviewflow/domain";

defineProps<{ prediction: Prediction | null }>();

const segments = [
  { key: "very_low", label: "低位", tone: "quiet" },
  { key: "below_baseline", label: "偏低", tone: "soft" },
  { key: "baseline", label: "基线", tone: "core" },
  { key: "strong", label: "强势", tone: "bright" },
  { key: "breakout", label: "突破", tone: "signal" },
] as const;

const platformLabel = (platform: Prediction["platform"]): string =>
  platform === "xiaohongshu" ? "小红书" : platform === "douyin" ? "抖音" : "B 站";
</script>

<template>
  <section class="prediction-tape" aria-label="表现区间预测">
    <div class="tape-head">
      <div>
        <span class="eyebrow">Prediction tape</span>
        <h3>{{ prediction ? `${platformLabel(prediction.platform)} · 这条内容可能落在哪里` : "这条内容可能落在哪里" }}</h3>
      </div>
      <span class="confidence" :class="prediction?.confidence ?? 'low'">
        {{ prediction ? `${prediction.confidence} confidence` : "等待预测" }}
      </span>
    </div>
    <div class="tape-track">
      <div v-for="segment in segments" :key="segment.key" class="tape-segment" :class="segment.tone">
        <span>{{ segment.label }}</span>
        <strong>
          {{ Math.round((prediction?.bucketProbabilities.find((item) => item.bucket === segment.key)?.probability ?? 0) * 100) }}%
        </strong>
      </div>
    </div>
    <div class="tape-foot">
      <span>{{ prediction?.rationale[0] ?? "先完成评分，再生成基于账号样本的概率区间。" }}</span>
      <strong v-if="prediction?.ranges.views">
        播放中枢 {{ prediction.ranges.views.p50.toLocaleString() }}
      </strong>
    </div>
  </section>
</template>
