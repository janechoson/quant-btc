<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useForecastStore } from '../stores/forecast';
import ComparisonChart from '../components/chart/ComparisonChart.vue';
import ReferenceChartModal from '../components/forecast/ReferenceChartModal.vue';
import type { Forecast } from '../types';

const store = useForecastStore();
const selected = ref<Forecast | null>(null);
const referenceOpen = ref(false);
const filter = ref('ALL');
const deletingId = ref<string | null>(null);
const historyError = ref('');
const summary = ref({ total: 0, completed: 0, monitoring: 0, directionalCorrect: 0 });
const rows = computed(() => store.history.filter(f => filter.value === 'ALL' || f.status === filter.value));
const fmt = (n: number) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function open(f: Forecast) {
  try { selected.value = await store.detail(f.id); }
  catch (error) { historyError.value = error instanceof Error ? error.message : 'Không tải được dự báo'; }
}
async function refresh() {
  historyError.value = '';
  try {
    const response = await fetch('/api/prediction-history/summary');
    if (!response.ok) throw new Error('Không tải được thống kê dự báo');
    const nextSummary = await response.json();
    await store.loadHistory();
    summary.value = nextSummary;
  } catch (error) { historyError.value = error instanceof Error ? error.message : 'Không tải được lịch sử dự đoán'; }
}
async function remove(f: Forecast) {
  const identity = `${f.timeframe} · ${f.horizon} nến · ${f.signal} · ${f.id.slice(0, 8)}`;
  if (!window.confirm(`Xóa vĩnh viễn dự báo ${identity}? Nến dự báo, nến thực và đánh giá liên quan cũng sẽ bị xóa.`)) return;
  deletingId.value = f.id;
  historyError.value = '';
  try {
    await store.deleteForecast(f.id);
    if (selected.value?.id === f.id) selected.value = null;
    await refresh();
  } catch (error) { historyError.value = error instanceof Error ? error.message : 'Không xóa được dự báo'; }
  finally { deletingId.value = null; }
}
onMounted(() => { void refresh(); });
</script>

<template>
  <section class="view">
    <div class="page-heading"><div><div class="eyebrow">FORWARD PERFORMANCE</div><h1>Lịch sử dự đoán</h1><p>Dự báo gốc và dữ liệu đánh giá được lưu riêng trong SQLite.</p></div><button class="icon-button" aria-label="Tải lại lịch sử" @click="refresh">⟳</button></div>
    <div class="metrics-grid"><div v-for="item in [['Tổng dự báo',summary.total],['Đã hoàn tất',summary.completed],['Đang theo dõi',summary.monitoring],['Đúng hướng',summary.completed?`${Math.round(summary.directionalCorrect/summary.completed*100)}%`:'—'] as const]" :key="item[0]" class="metric"><small>{{item[0]}}</small><b>{{item[1]}}</b></div></div>
    <p v-if="historyError" class="error-text history-error" role="alert">{{historyError}}</p>
    <div class="panel history-panel"><div class="panel-title"><span>TẤT CẢ DỰ BÁO</span><select v-model="filter" aria-label="Lọc trạng thái"><option value="ALL">Tất cả trạng thái</option><option>MONITORING</option><option>PARTIALLY_EVALUATED</option><option>COMPLETED</option><option>DATA_DELAYED</option></select></div>
      <div class="table-wrap"><table><thead><tr><th>THỜI ĐIỂM</th><th>KHUNG</th><th>HƯỚNG</th><th>GIÁ DỰ BÁO</th><th>GIÁ THỰC</th><th>TIẾN ĐỘ</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead><tbody>
        <tr v-for="f in rows" :key="f.id" class="click-row" @click="open(f)"><td>{{new Date(f.created_at).toLocaleString('vi-VN')}}</td><td>{{f.timeframe}} · {{f.horizon}}</td><td :class="f.signal.toLowerCase()">{{f.signal}}</td><td>{{f.predictedFinal?fmt(f.predictedFinal):'—'}}</td><td>{{f.actualFinal?fmt(f.actualFinal):'—'}}</td><td>{{f.progress}} / {{f.horizon}}</td><td><span class="status-pill" :class="{done:f.status==='COMPLETED'}">{{f.status}}</span></td><td><button class="delete-button" type="button" :aria-label="`Xóa dự báo ${f.id.slice(0,8)}`" :disabled="deletingId===f.id" @click.stop="remove(f)">{{deletingId===f.id?'Đang xóa…':'Xóa'}}</button></td></tr>
        <tr v-if="!rows.length"><td colspan="8" class="empty-row">Chưa có dự báo trong bộ lọc này.</td></tr>
      </tbody></table></div>
    </div>
    <div v-if="selected" class="panel detail"><div class="panel-title"><span>SO SÁNH DỰ BÁO · {{selected.id.slice(0,8)}}</span><button class="icon-button" aria-label="Đóng so sánh" @click="selected=null">×</button></div><h3>{{selected.timeframe}} · {{selected.signal}} · {{selected.status}} · {{selected.progress}}/{{selected.horizon}}</h3><ComparisonChart :forecast="selected"/><p v-if="selected.evaluation">Hướng: {{selected.evaluation.direction}} · Sai số giá cuối: {{fmt(selected.evaluation.priceError)}} · Điểm đường đi: {{selected.evaluation.pathScore.toFixed(1)}}/100</p><button class="reference-chart-button" type="button" @click="referenceOpen=true">📊 Chart tham chiếu</button></div>
    <ReferenceChartModal :open="referenceOpen" :forecast="selected" @close="referenceOpen=false"/>
  </section>
</template>
