<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import TradingToolbar from '../components/terminal/TradingToolbar.vue';
import ForecastSignal from '../components/terminal/ForecastSignal.vue';
import TradingChart from '../components/chart/TradingChart.vue';
import { useMarketStore } from '../stores/market';
import { useForecastStore } from '../stores/forecast';
import type { Candle } from '../types';

const market = useMarketStore();
const forecast = useForecastStore();
const showVolume = ref(true);
const showUncertainty = ref(true);
const hover = ref<Candle | null>(null);
const current = computed(() => forecast.current?.timeframe === market.timeframe ? forecast.current : null);
const last = computed(() => market.candles.at(-1));
const display = computed(() => hover.value || last.value);
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
watch(() => market.timeframe, () => { forecast.current = null; hover.value = null; });
onMounted(() => { if (!market.candles.length) void market.load(); });
</script>

<template>
  <section class="view">
    <TradingToolbar @toggle-volume="showVolume=!showVolume"/>
    <div class="terminal-grid">
      <div class="chart-card">
        <div class="chart-heading"><div><b>BTC/USDT · <span>{{market.timeframe}}</span> · Binance</b><span v-if="display" class="ohlc">O {{fmt(display.open)}}　H {{fmt(display.high)}}　L {{fmt(display.low)}}　C {{fmt(display.close)}}</span></div><span class="data-source" :class="current?.signal.toLowerCase()"><i/>{{current?`${current.signal} · ${current.progress}/${current.horizon} nến · ${current.status}`:market.error||'Dữ liệu Binance · nến đã đóng'}}</span></div>
        <TradingChart :candles="market.candles" :forecast="current" :timeframe="market.timeframe" :volume-visible="showVolume" :uncertainty-visible="showUncertainty" @ohlc="hover=$event"/>
        <div class="chart-legend"><span><i class="legend-box actual"/>Nến thực</span><span><i class="legend-box forecast"/>Nến dự báo (mờ)</span><button class="legend-toggle" :aria-pressed="showUncertainty" @click="showUncertainty=!showUncertainty"><i class="legend-band"/>{{showUncertainty?'Ẩn':'Hiện'}} vùng bất định</button><span><i class="legend-line"/>MA20</span><span><i class="legend-line ma50"/>MA50</span></div>
      </div>
      <ForecastSignal :forecast="current" :error="forecast.error"/>
    </div>
  </section>
</template>
