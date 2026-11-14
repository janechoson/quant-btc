<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import ReferenceSegmentChart from './ReferenceSegmentChart.vue';
import type { Forecast } from '../../types';

const props=defineProps<{open:boolean;forecast:Forecast|null}>();
const emit=defineEmits<{close:[]}>();
const reference=computed(()=>props.forecast?.referenceChart||null);
const inputCount=computed(()=>Math.min(props.forecast?.metadata.inputWindow||24,props.forecast?.inputCandles.length||0));
const currentInput=computed(()=>props.forecast?.inputCandles.slice(-inputCount.value)||[]);
const dateTime=(time:number)=>new Date(time*1000).toLocaleString('vi-VN',{dateStyle:'short',timeStyle:'short'});
const predictionTime=computed(()=>props.forecast?.createdAt||props.forecast?.created_at||'');
let previousOverflow='';
function onKey(event:KeyboardEvent){if(props.open&&event.key==='Escape')emit('close');}
watch(()=>props.open,open=>{if(typeof document==='undefined')return;if(open){previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';}else document.body.style.overflow=previousOverflow;},{immediate:true});
if(typeof document!=='undefined')document.addEventListener('keydown',onKey);
onBeforeUnmount(()=>{if(typeof document!=='undefined'){document.removeEventListener('keydown',onKey);document.body.style.overflow=previousOverflow;}});
</script>

<template>
  <Teleport to="body">
    <div v-if="open&&forecast" class="reference-modal-backdrop" @click.self="emit('close')">
      <section class="reference-modal" role="dialog" aria-modal="true" aria-labelledby="reference-modal-title">
        <header class="reference-modal-header"><h2 id="reference-modal-title">📊 Chart tham chiếu</h2><button class="reference-modal-close" aria-label="Đóng chart tham chiếu" @click="emit('close')">×</button></header>
        <div class="reference-modal-meta"><span><b>BTC/USDT · {{forecast.timeframe}}</b></span><span>Dự đoán lúc: {{predictionTime?new Date(predictionTime).toLocaleString('vi-VN'):'—'}}</span><span>Horizon: {{forecast.horizon}} nến</span><span>Dữ liệu đầu vào: {{inputCount}} nến</span><span v-if="reference">Mẫu tham chiếu: {{dateTime(reference.referenceStartTime)}} → {{dateTime(reference.referenceEndTime)}}</span></div>
        <div class="reference-modal-content">
          <section class="reference-chart-section">
            <div class="reference-section-heading"><h3>◷　Chart tham chiếu (lịch sử)</h3><span v-if="reference">Match #1 · Đóng góp {{(reference.matchWeight*100).toFixed(1)}}%</span></div>
            <ReferenceSegmentChart v-if="reference" :input-candles="reference.inputCandles" :continuation-candles="reference.continuationCandles" :timeframe="reference.timeframe" continuation-kind="actual" input-label="Đoạn tham chiếu" continuation-label="Diễn biến thực tế"/>
            <div v-else class="reference-unavailable">Không có dữ liệu chart tham chiếu cho dự đoán này.</div>
          </section>
          <section class="reference-chart-section">
            <div class="reference-section-heading"><h3>◉　Chart hiện tại (dự đoán)</h3></div>
            <ReferenceSegmentChart v-if="currentInput.length&&forecast.predictedCandles.length" :input-candles="currentInput" :continuation-candles="forecast.predictedCandles" :timeframe="forecast.timeframe" continuation-kind="forecast" input-label="Dữ liệu đầu vào" continuation-label="Dự đoán" :uncertainty="forecast.uncertainty"/>
            <div v-else class="reference-unavailable">Không đủ dữ liệu chart đã lưu cho dự đoán này.</div>
          </section>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.reference-modal-backdrop{position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(33,29,24,.42);backdrop-filter:blur(2px)}.reference-modal{width:min(90vw,1400px);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;border:1px solid #BFB5A4;border-radius:16px;background:#FBF8F0;box-shadow:0 22px 80px rgba(31,25,18,.3);color:#2B2924}.reference-modal-header{height:62px;flex:0 0 62px;display:flex;align-items:center;justify-content:space-between;padding:0 22px;border-bottom:1px solid #DED5C7}.reference-modal-header h2{margin:0;font-size:20px;letter-spacing:-.3px}.reference-modal-close{width:38px;height:38px;border:0;border-radius:8px;background:transparent;color:#2B2924;font-size:28px;cursor:pointer}.reference-modal-close:hover{background:#EFE5D2}.reference-modal-meta{display:flex;flex-wrap:wrap;gap:10px 22px;padding:13px 22px;border-bottom:1px solid #E7DECF;font-size:12px}.reference-modal-meta>span{padding-right:18px;border-right:1px solid #D8CFC1}.reference-modal-meta>span:last-child{border:0}.reference-modal-content{overflow:auto;padding:12px 16px 16px;display:grid;gap:12px}.reference-chart-section{padding:10px;border:1px solid #E0D7C8;border-radius:12px;background:#FCFAF5}.reference-section-heading{min-height:30px;display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 4px 8px}.reference-section-heading h3{margin:0;font-size:15px}.reference-section-heading>span{padding:6px 10px;border-radius:7px;background:#E5F1E9;color:#176644;font-size:11px;font-weight:600}.reference-unavailable{min-height:110px;display:grid;place-items:center;border:1px dashed #CEC7B6;border-radius:9px;background:#F5EFE2;color:#675E50;font-size:13px;text-align:center;padding:18px}
@media(max-width:700px){.reference-modal-backdrop{padding:8px;align-items:flex-start}.reference-modal{width:100%;max-height:calc(100dvh - 16px);margin-top:8px;border-radius:12px}.reference-modal-header{height:52px;flex-basis:52px;padding:0 13px}.reference-modal-header h2{font-size:17px}.reference-modal-meta{gap:7px 12px;padding:10px 13px;font-size:10px}.reference-modal-meta>span{padding-right:10px}.reference-modal-content{padding:9px;gap:9px}.reference-chart-section{padding:7px}.reference-section-heading{align-items:flex-start}.reference-section-heading h3{font-size:12px}.reference-section-heading>span{font-size:9px;padding:5px 7px}.reference-modal :deep(.reference-segment-chart){height:220px}.reference-modal :deep(.reference-chart-label){font-size:8px;max-width:43%;padding:3px 5px}}
</style>
