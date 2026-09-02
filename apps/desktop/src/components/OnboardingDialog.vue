<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  open: boolean;
  runtimeStatus: "starting" | "ready" | "missing" | "stopped";
}>();

const emit = defineEmits<{
  finish: [];
  navigate: [view: "settings" | "accounts" | "studio"];
}>();

const step = ref(0);
const steps = [
  {
    number: "01",
    title: "先留下发布前判断",
    body: "从一份主内容开始，评分和逐平台预测会记录版本与依据，发布后不会被改写。",
    action: "打开内容工作台",
    view: "studio" as const,
  },
  {
    number: "02",
    title: "模型密钥由你提供",
    body: "可接入 OpenAI-compatible API。API Key 使用 Windows DPAPI 加密，页面无法读取已保存值。",
    action: "检查模型设置",
    view: "settings" as const,
  },
  {
    number: "03",
    title: "账号只在本机登录",
    body: "小红书、抖音与 B 站凭证使用 DPAPI 保护；扫码、验证码和风控始终由你处理。",
    action: "查看平台账号",
    view: "accounts" as const,
  },
  {
    number: "04",
    title: "确认摘要，再执行发布",
    body: "ReviewFlow 只执行你确认过的不可变清单。发布后 72 小时进入数据回收和复盘。",
    action: "开始第一条内容",
    view: "studio" as const,
  },
];

const current = computed(() => steps[step.value] ?? steps[0]!);

const advance = (): void => {
  if (step.value < steps.length - 1) step.value += 1;
  else emit("finish");
};

const openCurrent = (): void => {
  emit("navigate", current.value.view);
};
</script>

<template>
  <div v-if="props.open" class="dialog-backdrop onboarding-backdrop" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
    <section class="onboarding-dialog">
      <div class="onboarding-brand">
        <div class="brand-mark"><i /><i /><i /></div>
        <span>ReviewFlow / first run</span>
      </div>
      <div class="onboarding-progress" aria-label="入门进度">
        <i v-for="(_, index) in steps" :key="index" :class="{ active: index <= step }" />
      </div>
      <span class="onboarding-number">{{ current.number }}</span>
      <h2 id="onboarding-title">{{ current.title }}</h2>
      <p>{{ current.body }}</p>
      <div v-if="props.runtimeStatus !== 'ready'" class="runtime-check" role="status">
        发布运行时状态：{{ props.runtimeStatus === 'starting' ? '正在启动' : props.runtimeStatus === 'missing' ? '安装包组件缺失' : '已停止' }}
      </div>
      <div class="onboarding-actions">
        <button class="text-action" @click="openCurrent">{{ current.action }}</button>
        <button class="primary-action" @click="advance">{{ step === steps.length - 1 ? "完成引导" : "下一步" }}</button>
      </div>
      <button class="onboarding-skip" @click="emit('finish')">跳过，稍后在设置中查看</button>
    </section>
  </div>
</template>
