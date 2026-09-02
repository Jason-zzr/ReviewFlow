<script setup lang="ts">
import { computed } from "vue";
import type { MetricName, Prediction } from "@reviewflow/domain";

const props = defineProps<{ prediction: Prediction | null }>();

const segments = [
  { key: "very_low", label: "低位", tone: "quiet" },
  { key: "below_baseline", label: "偏低", tone: "soft" },
  { key: "baseline", label: "基线", tone: "core" },
  { key: "strong", label: "强势", tone: "bright" },
  { key: "breakout", label: "突破", tone: "signal" },
] as const;

const platformLabel = (platform: Prediction["platform"]): string =>
  platform === "xiaohongshu" ? "小红书" : platform === "douyin" ? "抖音" : "B 站";

const baselineLabel = (source: Prediction["baselineSource"]): string => ({
  account_history: "账号历史",
  benchmarks: "对标基线",
  cold_start: "冷启动先验",
})[source];

const metricDefinitions: Array<{ key: MetricName; label: string }> = [
  { key: "views", label: "播放 / 阅读" },
  { key: "likes", label: "点赞" },
  { key: "saves", label: "收藏" },
  { key: "comments", label: "评论" },
  { key: "shares", label: "分享" },
  { key: "followersGained", label: "涨粉" },
];

const visibleRanges = computed(() => metricDefinitions.flatMap((metric) => {
  const range = props.prediction?.ranges[metric.key];
  return range ? [{ ...metric, range }] : [];
}));
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
    <div v-if="prediction" class="prediction-meta">
      <strong>{{ baselineLabel(prediction.baselineSource) }} · {{ prediction.baselineSampleSize }} 条样本</strong>
      <span>{{ prediction.model }} · {{ prediction.promptVersion }}</span>
      <time :datetime="prediction.generatedAt">生成于 {{ new Date(prediction.generatedAt).toLocaleString() }}</time>
    </div>
    <div class="tape-track">
      <div v-for="segment in segments" :key="segment.key" class="tape-segment" :class="segment.tone">
        <span>{{ segment.label }}</span>
        <strong>
          {{ Math.round((prediction?.bucketProbabilities.find((item) => item.bucket === segment.key)?.probability ?? 0) * 100) }}%
        </strong>
      </div>
    </div>
    <div v-if="visibleRanges.length" class="prediction-range-grid" aria-label="各指标预测区间">
      <article v-for="item in visibleRanges" :key="item.key">
        <strong>{{ item.label }}</strong>
        <span><small>P10</small>{{ item.range.p10.toLocaleString() }}</span>
        <span><small>P50</small>{{ item.range.p50.toLocaleString() }}</span>
        <span><small>P90</small>{{ item.range.p90.toLocaleString() }}</span>
      </article>
    </div>
    <div class="tape-foot">
      <span>{{ prediction ? "区间用于记录发布前判断，不是结果承诺。" : "先完成评分，再生成基于账号样本的概率区间。" }}</span>
      <strong v-if="prediction?.ranges.views">
        播放中枢 {{ prediction.ranges.views.p50.toLocaleString() }}
      </strong>
    </div>
    <ul v-if="prediction" class="prediction-rationale" aria-label="预测依据">
      <li v-for="reason in prediction.rationale" :key="reason">{{ reason }}</li>
    </ul>
  </section>
</template>
