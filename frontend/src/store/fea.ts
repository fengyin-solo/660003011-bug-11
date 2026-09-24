import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { FEAModel, FEAResult } from '../types';
import {
  solve as feaSolve,
  presetCantileverBeam,
  presetBridgeTruss,
  presetSimpleFrame,
  jetColormap,
} from '../utils/fea-solver';

export type HeatmapMode = 'stress' | 'strain' | 'force';

// 单一单位口径定义：求解器内部统一使用 SI（应力 Pa、应变无量纲、轴力 N），
// 所有界面（图例 / 底部状态栏 / 侧栏统计 / 单元详情）都只允许通过这份定义换算显示。
export interface HeatmapMetricSpec {
  label: string;    // 统计项名称
  unit: string;     // 显示单位
  scale: number;    // 原始 SI 值 -> 显示值的换算系数
  decimals: number; // 显示小数位数
  textClass: string; // 统计数值的 tailwind 颜色类
}

export const HEATMAP_METRICS: Record<HeatmapMode, HeatmapMetricSpec> = {
  stress: { label: '最大应力', unit: 'MPa', scale: 1 / 1e6, decimals: 2, textClass: 'text-red-400' },
  strain: { label: '最大应变', unit: '%', scale: 100, decimals: 4, textClass: 'text-sky-400' },
  force: { label: '最大轴力', unit: 'kN', scale: 1 / 1000, decimals: 2, textClass: 'text-amber-400' },
};

export const useFEAStore = defineStore('fea', () => {
  const model = ref<FEAModel>({ nodes: [], elements: [], loads: [] });
  const result = ref<FEAResult | null>(null);
  const selectedPreset = ref<string>('cantilever');
  const showDeformed = ref(false);
  const deformationScale = ref(10);
  const selectedElement = ref<number | null>(null);
  const heatmapMode = ref<HeatmapMode>('stress');

  // ─── Actions ──────────────────────────────────────────────────────────────
  function loadPreset(name: string) {
    selectedPreset.value = name;
    result.value = null;
    selectedElement.value = null;
    switch (name) {
      case 'cantilever':
        model.value = presetCantileverBeam();
        break;
      case 'bridge':
        model.value = presetBridgeTruss();
        break;
      case 'frame':
        model.value = presetSimpleFrame();
        break;
      default:
        model.value = presetCantileverBeam();
    }
  }

  function solve() {
    result.value = feaSolve(model.value);
  }

  function toggleDeformed() {
    showDeformed.value = !showDeformed.value;
  }

  function selectElement(id: number | null) {
    selectedElement.value = id;
  }

  function setHeatmapMode(mode: HeatmapMode) {
    heatmapMode.value = mode;
  }

  function addLoad(nodeId: number, fx: number, fy: number) {
    model.value.loads.push({ nodeId, fx, fy });
  }

  function toggleFixed(nodeId: number) {
    const node = model.value.nodes.find((n) => n.id === nodeId);
    if (node) node.fixed = !node.fixed;
  }

  // ─── Computed ─────────────────────────────────────────────────────────────
  const maxDisplacement = computed(() => {
    if (!result.value) return 0;
    return result.value.maxDisplacement;
  });

  // 唯一的取值口径：当前热力图模式下各单元绝对值（SI 原始值）。
  // 图例刻度、构件颜色、底部状态栏、侧栏统计都只能从这里取数。
  const heatmapRawValues = computed<number[]>(() => {
    if (!result.value) return [];
    switch (heatmapMode.value) {
      case 'stress':
        return result.value.stresses.map(Math.abs);
      case 'strain':
        return result.value.strains.map(Math.abs);
      case 'force':
        return model.value.elements.map((e) => Math.abs(e.force));
      default:
        return result.value.stresses.map(Math.abs);
    }
  });

  // 由同一次取值算出区间端点：颜色归一化与图例刻度共用 min/max。
  const heatmapStats = computed(() => {
    const spec = HEATMAP_METRICS[heatmapMode.value];
    const values = heatmapRawValues.value;
    const minRaw = values.length ? Math.min(...values) : 0;
    const maxRaw = values.length ? Math.max(...values) : 0;
    return {
      mode: heatmapMode.value,
      spec,
      min: minRaw * spec.scale,
      max: maxRaw * spec.scale,
    };
  });

  // 唯一的换算/格式化入口，保证三处读数逐字符一致。
  function formatHeatmapValue(displayValue: number): string {
    const { decimals, unit } = HEATMAP_METRICS[heatmapMode.value];
    return `${displayValue.toFixed(decimals)} ${unit}`;
  }

  const elementColors = computed(() => {
    const colors = new Map<number, string>();
    if (!result.value || model.value.elements.length === 0) {
      for (const el of model.value.elements) {
        colors.set(el.id, '#6b7280');
      }
      return colors;
    }

    // 与图例完全相同的一次取值、相同的 min/max 端点、相同的 jet 色阶规则。
    const values = heatmapRawValues.value;
    const min = Math.min(...values);
    const max = Math.max(...values);

    for (let i = 0; i < model.value.elements.length; i++) {
      colors.set(
        model.value.elements[i].id,
        jetColormap(values[i], min, max)
      );
    }
    return colors;
  });

  return {
    model,
    result,
    selectedPreset,
    showDeformed,
    deformationScale,
    selectedElement,
    heatmapMode,
    maxDisplacement,
    heatmapStats,
    heatmapRawValues,
    elementColors,
    formatHeatmapValue,
    loadPreset,
    solve,
    toggleDeformed,
    selectElement,
    setHeatmapMode,
    addLoad,
    toggleFixed,
  };
});
