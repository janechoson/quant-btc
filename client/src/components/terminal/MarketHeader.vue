<script setup lang="ts">
import { computed } from 'vue';
import { useMarketStore } from '../../stores/market';
const market = useMarketStore();
const fallbackPrice = computed(() => market.confirmedCandles.at(-1)?.close ?? null);
const price = computed(() => market.liveTicker?.lastPrice ?? fallbackPrice.value);
const statusLabel = computed(() => {
  if (market.tickerSource === 'rest') return 'REST dự phòng';
  if (market.streamStatus === 'CONNECTED' && market.tickerSource !== 'websocket') return 'Chờ ticker';
  return ({ CONNECTING: 'Đang kết nối', CONNECTED: 'LIVE', RECONNECTING: 'Đang kết nối lại', DISCONNECTED: 'Mất kết nối', STALE: 'Dữ liệu cũ' } as const)[market.streamStatus];
});
const statusClass = computed(() => market.tickerSource === 'rest' ? 'rest' : market.streamStatus === 'CONNECTED' && market.tickerSource !== 'websocket' ? 'connecting' : market.streamStatus.toLowerCase());
const updatedAt = computed(() => market.lastUpdateAt ? new Date(market.lastUpdateAt).toLocaleTimeString('vi-VN', { hour12: false }) : '—');
const fmt = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
</script>

<template>
  <header class="topbar">
    <div class="pair"><span class="coin">₿</span><strong>BTC/USDT</strong><span class="caret">⌄</span></div>
    <div class="price-block">
      <strong>{{ fmt(price) }}</strong>
      <span v-if="market.liveTicker" :class="market.liveTicker.priceChangePercent >= 0 ? 'green' : 'red'">{{ market.liveTicker.priceChangePercent >= 0 ? '+' : '' }}{{ market.liveTicker.priceChangePercent.toFixed(2) }}%</span>
      <small class="quote-status" :class="statusClass"><i/>{{ statusLabel }} · cập nhật {{ updatedAt }}<template v-if="!market.liveTicker"> · giá đóng nến cuối</template></small>
    </div>
    <div class="market-stat"><small>24h High</small><b>{{ fmt(market.liveTicker?.high24h) }}</b></div>
    <div class="market-stat"><small>24h Low</small><b>{{ fmt(market.liveTicker?.low24h) }}</b></div>
    <div class="market-stat"><small>24h Vol</small><b>{{ market.liveTicker ? `${market.liveTicker.volume24h.toLocaleString('en-US', { maximumFractionDigits: 2 })} BTC` : '—' }}</b></div>
    <div class="top-spacer"/><RouterLink class="learning-chip" to="/learning"><span>✳</span> Pattern Learning</RouterLink><button class="mode-chip"><span class="live-dot"/> Demo <span>⌄</span></button>
  </header>
</template>
