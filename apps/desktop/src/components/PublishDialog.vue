<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { PublishManifest } from "@reviewflow/domain";

const props = defineProps<{
  open: boolean;
  manifest: PublishManifest | null;
  warnings: string[];
  liveEnabled: boolean;
  busy: boolean;
}>();
defineEmits<{ close: []; confirm: [] }>();

const confirmed = ref<Record<string, boolean>>({});
watch(
  () => [props.open, props.manifest?.digest] as const,
  () => { confirmed.value = {}; },
);
const allConfirmed = computed(() => Boolean(
  props.manifest?.variants.length
  && props.manifest.variants.every((variant) => confirmed.value[variant.id]),
));
</script>

<template>
  <div v-if="open" class="dialog-backdrop" @click.self="$emit('close')">
    <section class="publish-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-title">
      <div class="dialog-head">
        <div>
          <span class="eyebrow">Exact approval</span>
          <h2 id="publish-title">确认这一个发布清单</h2>
        </div>
        <button class="icon-button" aria-label="关闭" @click="$emit('close')">×</button>
      </div>
      <p class="dialog-copy">确认只对下列账号、素材、文案和时间生效。任何修改都会使本次摘要失效。</p>
      <div class="manifest-list">
        <article v-for="variant in manifest?.variants" :key="variant.id">
          <span>{{ variant.platform }}</span>
          <strong>{{ variant.accountId }}</strong>
          <p>{{ variant.title }}</p>
          <small>{{ variant.mediaPaths.length }} 个素材 · {{ variant.scheduledAt ? "平台定时" : "立即发布" }}</small>
          <label class="task-confirmation">
            <input v-model="confirmed[variant.id]" type="checkbox" />
            我已核对这个平台任务
          </label>
        </article>
      </div>
      <code class="digest">{{ manifest?.digest }}</code>
      <ul v-if="warnings.length" class="warning-list">
        <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
      </ul>
      <div v-else-if="!liveEnabled" class="dry-run-notice">安全预览模式：真实发布开关当前关闭。</div>
      <div class="dialog-actions">
        <button class="text-action" @click="$emit('close')">返回修改</button>
        <button class="primary-action danger" :disabled="busy || warnings.length > 0 || !allConfirmed" @click="$emit('confirm')">
          {{ busy ? "正在提交…" : liveEnabled ? "确认并发布" : "确认摘要（不发布）" }}
        </button>
      </div>
    </section>
  </div>
</template>
