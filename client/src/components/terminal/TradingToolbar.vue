<template>
  <div class="toolbar">
    <div class="segmented">
      <button
        v-for="tf in ['15M', '1H', '4H', '1D'] as const"
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
        <option
          v-for="value in horizons"
          :key="value"
          :value="value"
        >
          {{ value }} nến (~{{
            formatForecastDuration(market.timeframe, value)
          }})
        </option>
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
import { formatForecastDuration } from '../../utils/forecast-duration';
const horizons = [5, 10, 20, 30, 40, 50] as const;
const market = useMarketStore(),
  forecast = useForecastStore(),
  horizon = ref<(typeof horizons)[number]>(10),
  emit = defineEmits<{ toggleVolume: [] }>();
</script>
