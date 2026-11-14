<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { createChart, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
import type { Candle, Timeframe } from '../../types';

const props = defineProps<{ inputCandles:Candle[]; continuationCandles:Candle[]; timeframe:Timeframe; continuationKind:'actual'|'forecast'; inputLabel:string; continuationLabel:string; uncertainty?:{time:number;low:number;high:number}[] }>();
const host=ref<HTMLDivElement>(),overlayWidth=ref(1),overlayHeight=ref(1),plotWidth=ref(1),splitX=ref<number|null>(null),inputStartX=ref<number|null>(null),futureEndX=ref<number|null>(null),bandPath=ref('');
let chart:IChartApi|undefined,actual:ISeriesApi<'Candlestick'>|undefined,future:ISeriesApi<'Candlestick'>|undefined,observer:ResizeObserver|undefined,initialized=false;
const toData=(c:Candle)=>({time:c.time as Time,open:c.open,high:c.high,low:c.low,close:c.close});
const combined=()=>[...props.inputCandles,...props.continuationCandles].sort((a,b)=>a.time-b.time);

function drawOverlay(){
  if(!chart||!future||!host.value)return;
  overlayWidth.value=host.value.clientWidth;overlayHeight.value=host.value.clientHeight;plotWidth.value=chart.timeScale().width();
  const scale=chart.timeScale(),firstInput=props.inputCandles[0],firstFuture=props.continuationCandles[0],lastFuture=props.continuationCandles.at(-1);
  inputStartX.value=firstInput?scale.timeToCoordinate(firstInput.time as Time):null;
  splitX.value=firstFuture?scale.timeToCoordinate(firstFuture.time as Time):null;
  futureEndX.value=lastFuture?scale.timeToCoordinate(lastFuture.time as Time):null;
  if(props.continuationKind!=='forecast'||!props.uncertainty?.length){bandPath.value='';return;}
  const upper=props.uncertainty.map(p=>({x:scale.timeToCoordinate(p.time as Time),y:future!.priceToCoordinate(p.high)}));
  const lower=props.uncertainty.map(p=>({x:scale.timeToCoordinate(p.time as Time),y:future!.priceToCoordinate(p.low)}));
  if(![...upper,...lower].every(p=>p.x!==null&&p.y!==null&&Number.isFinite(p.x)&&Number.isFinite(p.y))){bandPath.value='';return;}
  bandPath.value=`M ${upper.map(p=>`${p.x},${p.y}`).join(' L ')} L ${[...lower].reverse().map(p=>`${p.x},${p.y}`).join(' L ')} Z`;
}

function setData(){
  if(!actual||!future||!chart)return;
  const input=props.inputCandles,continuation=props.continuationCandles;
  actual.setData([...input,...(props.continuationKind==='actual'?continuation:[])].sort((a,b)=>a.time-b.time).map(toData));
  future.setData(props.continuationKind==='forecast'?continuation.map(c=>{const color=c.close>=c.open?'rgba(23,118,83,.58)':'rgba(164,60,52,.58)';return {...toData(c),color,borderColor:color,wickColor:color};}):[]);
  if(!initialized){chart.timeScale().fitContent();initialized=true;}
  requestAnimationFrame(drawOverlay);
}

onMounted(async()=>{
  if(!host.value)return;
  chart=createChart(host.value,{width:host.value.clientWidth,height:250,layout:{background:{color:'#FBF8F0'},textColor:'#675E50',fontFamily:'DM Mono, monospace'},grid:{vertLines:{color:'#E7DECF'},horzLines:{color:'#E7DECF'}},rightPriceScale:{borderColor:'#CEC7B6',scaleMargins:{top:.12,bottom:.1}},timeScale:{borderColor:'#CEC7B6',timeVisible:true,rightOffset:2},handleScroll:true,handleScale:true});
  actual=chart.addCandlestickSeries({upColor:'#177653',downColor:'#A43C34',borderVisible:false,wickUpColor:'#177653',wickDownColor:'#A43C34'});
  future=chart.addCandlestickSeries({upColor:'rgba(23,118,83,.58)',downColor:'rgba(164,60,52,.58)',borderUpColor:'rgba(23,118,83,.82)',borderDownColor:'rgba(164,60,52,.82)',wickUpColor:'rgba(23,118,83,.9)',wickDownColor:'rgba(164,60,52,.9)',priceLineVisible:false});
  chart.timeScale().subscribeVisibleLogicalRangeChange(drawOverlay);
  observer=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width;if(width){chart?.applyOptions({width});requestAnimationFrame(drawOverlay);}});observer.observe(host.value);
  await nextTick();setData();
});
watch(()=>[props.inputCandles,props.continuationCandles,props.uncertainty,props.timeframe],setData,{deep:false});
onBeforeUnmount(()=>{observer?.disconnect();chart?.timeScale().unsubscribeVisibleLogicalRangeChange(drawOverlay);chart?.remove();chart=undefined;});
</script>

<template>
  <div ref="host" class="reference-segment-chart">
    <svg class="reference-chart-overlay" :viewBox="`0 0 ${overlayWidth} ${overlayHeight}`" preserveAspectRatio="none" aria-hidden="true">
      <rect v-if="inputStartX!==null&&splitX!==null" :x="inputStartX" y="0" :width="Math.max(0,splitX-inputStartX)" :height="Math.max(0,overlayHeight-26)" fill="rgba(23,118,83,.075)"/>
      <rect v-if="splitX!==null" :x="splitX" y="0" :width="Math.max(0,plotWidth-splitX)" :height="Math.max(0,overlayHeight-26)" fill="rgba(139,32,32,.055)"/>
      <path v-if="bandPath" :d="bandPath" fill="rgba(139,32,32,.13)" stroke="rgba(139,32,32,.25)" stroke-width="1"/>
      <line v-if="splitX!==null" :x1="splitX" :x2="splitX" y1="25" :y2="Math.max(0,overlayHeight-26)" :stroke="continuationKind==='actual'?'#177653':'#8B2020'" stroke-width="1.5" stroke-dasharray="6 5"/>
      <line v-if="inputStartX!==null&&splitX!==null" :x1="inputStartX+6" :x2="splitX-6" y1="26" y2="26" stroke="#177653" stroke-width="1.5" marker-start="url(#ref-green-arrow)" marker-end="url(#ref-green-arrow)"/>
      <line v-if="splitX!==null&&futureEndX!==null" :x1="splitX+6" :x2="futureEndX+6" y1="47" y2="47" stroke="#8B45D0" stroke-width="1.5" marker-start="url(#ref-purple-arrow)" marker-end="url(#ref-purple-arrow)"/>
      <defs><marker id="ref-green-arrow" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto-start-reverse"><path d="M 7 0 L 0 3.5 L 7 7" fill="none" stroke="#177653" stroke-width="1.4"/></marker><marker id="ref-purple-arrow" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto-start-reverse"><path d="M 7 0 L 0 3.5 L 7 7" fill="none" stroke="#8B45D0" stroke-width="1.4"/></marker></defs>
    </svg>
    <span v-if="inputStartX!==null&&splitX!==null" class="reference-chart-label input" :style="{left:`${(inputStartX+splitX)/2}px`}">{{inputLabel}} ({{inputCandles.length}} nến)</span>
    <span v-if="splitX!==null&&futureEndX!==null" class="reference-chart-label continuation" :style="{left:`${(splitX+futureEndX)/2}px`,top:'31px'}">{{continuationLabel}} ({{continuationCandles.length}} nến)</span>
  </div>
</template>

<style scoped>
.reference-segment-chart{height:250px;min-width:0;position:relative;overflow:hidden;border:1px solid #E0D7C8;border-radius:9px;background:#FBF8F0}.reference-chart-overlay{position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none}.reference-chart-label{position:absolute;z-index:3;top:5px;transform:translateX(-50%);max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 9px;border-radius:6px;background:#177653;color:#fff;font-size:11px;font-weight:700;pointer-events:none}.reference-chart-label.continuation{background:#8B45D0}
</style>
