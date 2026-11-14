<template>
  <div class="toolbar">
    <div class="segmented">
      <button
        v-for="tf in ['1H', '4H', '1D'] as const"
        :key="tf"
        class="tf"
        :class="{ active: market.timeframe === tf }"
        @click="market.setTimeframe(tf)"
      >
        {{ tf }}
      </button>
    </div>
    <div class="toolbar-spacer" />
    <label class="horizon-select"
      >Dự đoán:
      <select v-model.number="horizon">
        <option :value="5">5 nến (~5 giờ)</option>
        <option :value="10">10 nến (~10 giờ)</option>
        <option :value="20">20 nến (~20 giờ)</option>
        <option :value="30">30 nến (~30 giờ)</option>
      </select></label
    ><button
      class="predict-button"
      :disabled="forecast.loading"
      @click="forecast.predict(horizon)"
    >
      {{
        forecast.loading ? 'Đang phân tích…' : '✦　Dự đoán'
      }}</button
    ><button
      class="icon-button"
      title="Tải lại"
      @click="market.load"
    >
      ⟲
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useMarketStore } from '../../stores/market';
import { useForecastStore } from '../../stores/forecast';
const market = useMarketStore(),
  forecast = useForecastStore(),
  horizon = ref(10),
  emit = defineEmits<{ toggleVolume: [] }>();
</script>
