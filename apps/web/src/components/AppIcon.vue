<script setup lang="ts">
/**
 * 图标：内联 SVG，避免引入图标库（体积与离线都要考虑）。
 * 统一 1.7 描边、24 视口，颜色跟随 currentColor。
 */
const props = withDefaults(
  defineProps<{
    name: keyof typeof PATHS;
    size?: number;
  }>(),
  { size: 18 },
);

const PATHS = {
  overview:
    'M4 4h6v6H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 14h6v6H4z',
  program: 'M4 6h10M4 12h10M4 18h6M17 14l2 2 3-4',
  calendar: 'M4 7h16M7 3v4M17 3v4M5 7h14v13H5zM9 11h2M13 11h2M9 15h2M13 15h2',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16.5 16.5 21 21',
  compare: 'M4 5h6v14H4zM14 5h6v14h-6zM12 3v18',
  settings:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L6 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5a7 7 0 0 0 .1-1z',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  undo: 'M9 7 4 12l5 5M4 12h9a6 6 0 0 1 6 6',
  redo: 'M15 7l5 5-5 5M20 12h-9a6 6 0 0 0-6 6',
  download: 'M12 4v10M8 10l4 4 4-4M5 19h14',
  logout: 'M15 4h4v16h-4M11 8l-4 4 4 4M7 12h9',
  alert: 'M12 4 3 20h18L12 4zM12 10v4M12 17v.5',
  check: 'M5 12l4 4L19 6',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  book: 'M4 5h7v15H4zM13 5h7v15h-7z',
  layers: 'M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  copy: 'M8 8h10v12H8zM6 16H4V4h10v2',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 8v.5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  filter: 'M4 5h16l-6 7v6l-4 2v-8z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
} as const;
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="PATHS[props.name]" />
  </svg>
</template>
