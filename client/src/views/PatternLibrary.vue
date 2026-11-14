<template>
  <section class="view">
    <div class="page-heading">
      <div>
        <div class="eyebrow">LEARNED STRUCTURES</div>
        <h1>Thư viện mô hình</h1>
        <p>
          Dataset và ví dụ học cuốn chiếu; timeframe được giữ
          riêng.
        </p>
      </div>
      <RouterLink class="icon-button" to="/learning"
        >＋</RouterLink
      >
    </div>
    <div class="panel">
      <div class="panel-title">
        <span>DATASET</span
        ><span class="muted"
          >{{ store.datasets.length }} /
          {{ store.pages }} trang</span
        >
      </div>
      <div
        v-for="d in store.datasets"
        :key="d.id"
        class="dataset-row"
      >
        <span
          ><b>{{ d.name }}</b
          ><br /><small
            >{{ d.symbol }} · {{ d.timeframe }} ·
            {{ d.candle_count }} nến · {{ d.example_count }} ví
            dụ</small
          ></span
        ><RouterLink :to="`/learning?dataset=${d.id}`"
          >Mở dataset →</RouterLink
        >
      </div>
      <div v-if="!store.datasets.length" class="empty-row">
        Chưa có dữ liệu học.
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useLearningStore } from '../stores/learning';
const store = useLearningStore();
onMounted(() => store.load(1));
</script>
