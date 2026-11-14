<script setup lang="ts">
import { computed } from 'vue';
import type { Forecast } from '../../types';
const props = defineProps<{ forecast: Forecast | null; error?: string }>();
const fmt = (value: number) => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const finalPrice = computed(() => props.forecast?.predictedCandles.at(-1)?.close ?? null);
const expectedMove = computed(() => props.forecast && finalPrice.value !== null ? (finalPrice.value / props.forecast.start_price - 1) * 100 : null);
</script>

<template>
  <aside class="forecast-summary panel">
    <div class="forecast-summary-title"><span>♧　Kết quả dự đoán</span><span class="muted">i</span></div>
    <template v-if="forecast">
      <div class="summary-meta">
        <div><span>Khung thời gian</span><b>{{forecast.timeframe}}</b></div>
        <div><span>Số nến dự đoán</span><b>{{forecast.horizon}}</b></div>
        <div><span>Mẫu lịch sử khớp</span><b>{{forecast.metadata.neighbors}} / {{forecast.metadata.historyExamples ?? forecast.metadata.neighbors}}</b></div>
        <div><span>Trạng thái</span><b class="status-pill">{{forecast.status}} · {{forecast.progress}}/{{forecast.horizon}}</b></div>
      </div>
      <section class="signal-block" :class="forecast.signal.toLowerCase()">
        <strong>{{forecast.signal==='LONG'?'↑':forecast.signal==='SHORT'?'↓':'↔'}}　{{forecast.signal}}</strong>
        <span v-if="expectedMove!==null">Đường đi kỳ vọng: {{expectedMove>=0?'+':''}}{{expectedMove.toFixed(2)}}%</span>
      </section>
      <div class="summary-levels">
        <div><span>Giá bắt đầu</span><b>{{fmt(forecast.start_price)}}</b></div>
        <div><span>Giá cuối dự báo</span><b>{{finalPrice===null?'—':fmt(finalPrice)}}</b></div>
        <template v-if="forecast.signal!=='NO TRADE'&&forecast.entry">
          <div><span>Entry</span><b>{{fmt(forecast.entry.low)}}<template v-if="forecast.entry.high!==forecast.entry.low"> – {{fmt(forecast.entry.high)}}</template></b></div>
          <div v-if="forecast.takeProfit"><span>Take Profit</span><b class="long">{{fmt(forecast.takeProfit)}}</b></div>
          <div v-if="forecast.stopLoss"><span>Stop Loss</span><b class="short">{{fmt(forecast.stopLoss)}}</b></div>
        </template>
        <div v-else class="no-trade-note">Các mẫu lịch sử không đồng thuận đủ để xác định Entry / TP / SL.</div>
      </div>
      <div class="quantile-note" v-if="forecast.metadata.quantiles">Dải q10–q90 là phân vị thực nghiệm có trọng số từ {{forecast.metadata.quantiles.sampleCount}} mẫu; chưa được hiệu chuẩn thành xác suất.</div>
      <div class="quantile-note" v-else>Dự báo đã lưu từ phiên bản thuật toán cũ; nến gốc được giữ nguyên.</div>
    </template>
    <div v-else class="forecast-empty"><b>{{error?'Chưa thể tạo dự báo':'Chưa có dự báo'}}</b><span>{{error||'Tạo dự báo để xem đường đi, phạm vi giá và trạng thái mẫu học.'}}</span></div>
  </aside>
</template>
