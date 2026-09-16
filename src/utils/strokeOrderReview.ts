/**
 * 笔顺复核：把 store 里的原始数据（字根、阶段、手工覆盖）换算成
 * 台面可直接使用的「有效顺序 + 状态」。全部是纯函数，便于复用与测试。
 */
import type { Radical, HistoricalStage, StrokeOrderMap, StrokeOrderOverride } from '@/types';
import {
  parseStrokeSet,
  reviewFingerprint,
  isValidOrderPermutation,
  STROKE_RULE_VERSION,
  type StrokeSet,
} from './strokeOrder';

/** stageId 为 null 时表示字根的基础形状。 */
export const BASE_SHAPE_KEY = '__base__';

export const strokeOrderKey = (radicalId: string, stageId: string | null): string =>
  `${radicalId}:${stageId ?? BASE_SHAPE_KEY}`;

export type StrokeOrderStatus =
  | 'empty' // 空字形：没有任何笔画
  | 'error' // 路径写错：解析有问题，列出原因
  | 'auto' // 规则自动顺序，未经手工修改
  | 'manual' // 手工顺序且与当前规则/字形一致
  | 'stale'; // 曾保存手工顺序，但规则或字形已改 → 待复核

export interface ResolvedStrokeOrder {
  radicalId: string;
  stageId: string | null;
  svgPath: string;
  set: StrokeSet;
  /** 台面应实际采用的笔顺（sourceIndex 序列） */
  order: number[];
  /** 规则自动算出的笔顺 */
  autoOrder: number[];
  status: StrokeOrderStatus;
  override?: StrokeOrderOverride;
  /** 待复核 / 出错时的人话原因 */
  reasons: string[];
  /** 是否存在一份「仍可用」的手工顺序（stale 但排列仍合法时保留旧序待确认） */
  manualStillUsable: boolean;
}

/** 取某字根在某阶段要用于笔顺的路径；无该阶段变体时回退到基础形状。 */
export function shapePathForRef(radical: Radical, stageId: string | null): string {
  if (stageId) {
    const v = radical.variants.find((x) => x.stageId === stageId);
    if (v) return v.svgPath;
  }
  return radical.baseShape;
}

function staleReasons(override: StrokeOrderOverride, set: StrokeSet, permutationValid: boolean): string[] {
  const reasons: string[] = [];
  if (!permutationValid) {
    reasons.push(
      `字形已改变：保存时有 ${override.order.length} 笔，当前解析出 ${set.strokes.length} 笔，旧顺序无法对应。`
    );
  }
  const savedVersion = Number((override.fingerprint.match(/^v(\d+)\|/)?.[1]) ?? 0);
  if (savedVersion < STROKE_RULE_VERSION) {
    reasons.push(`笔顺规则已更新（规则版本 ${savedVersion} → ${STROKE_RULE_VERSION}）。`);
  }
  const shapeChanged =
    permutationValid && override.fingerprint.split('|').slice(1).join('|') !== reviewFingerprint(set).split('|').slice(1).join('|');
  if (shapeChanged) {
    reasons.push('字形笔画的起笔位置或开合状态已改变，规则顺序可能不同。');
  }
  if (reasons.length === 0) reasons.push('规则或字形发生变化，请复核手工顺序。');
  return reasons;
}

export function resolveStrokeOrder(
  radical: Radical,
  stageId: string | null,
  overrides: StrokeOrderMap
): ResolvedStrokeOrder {
  const svgPath = shapePathForRef(radical, stageId);
  const set = parseStrokeSet(svgPath);
  const autoOrder = set.order;
  const override = overrides[strokeOrderKey(radical.id, stageId)];
  const reasons: string[] = set.issues.map((i) => i.message);

  if (set.isEmpty) {
    return {
      radicalId: radical.id,
      stageId,
      svgPath,
      set,
      order: [],
      autoOrder: [],
      status: 'empty',
      reasons: ['此字形为空，没有可排的笔画。'],
      manualStillUsable: false,
    };
  }

  const permutationValid = override
    ? isValidOrderPermutation(override.order, set.strokes.length)
    : false;
  const fingerprintOk = override ? override.fingerprint === reviewFingerprint(set) : false;

  let status: StrokeOrderStatus;
  let order = autoOrder;
  let manualStillUsable = false;

  if (override && permutationValid) {
    order = override.order;
    manualStillUsable = true;
    status = fingerprintOk ? 'manual' : 'stale';
  } else if (override) {
    // 有覆盖但排列已不合法（笔画数对不上）→ 退回规则顺序并要求复核
    status = 'stale';
  } else {
    status = set.issues.length > 0 ? 'error' : 'auto';
  }

  if (status === 'stale') {
    reasons.push(...staleReasons(override!, set, permutationValid));
  }

  return {
    radicalId: radical.id,
    stageId,
    svgPath,
    set,
    order,
    autoOrder,
    status,
    override,
    reasons,
    manualStillUsable,
  };
}

export interface StaleEntry {
  radical: Radical;
  stage: HistoricalStage | null; // null = 基础形状
  stageId: string | null;
  resolved: ResolvedStrokeOrder;
}

/**
 * 列出全部待复核 / 出错的字形：规则一改（版本变化）会使所有手工项进入待复核；
 * 某字根字形一改，受影响的阶段项也会在此列出。
 */
export function listReviewEntries(
  radicals: Radical[],
  stages: HistoricalStage[],
  overrides: StrokeOrderMap,
  include: { stale: boolean; error: boolean } = { stale: true, error: true }
): StaleEntry[] {
  const out: StaleEntry[] = [];
  for (const radical of radicals) {
    const consider = (stageId: string | null) => {
      const resolved = resolveStrokeOrder(radical, stageId, overrides);
      if (
        (include.stale && resolved.status === 'stale') ||
        (include.error && resolved.status === 'error')
      ) {
        out.push({
          radical,
          stage: stageId ? stages.find((s) => s.id === stageId) ?? null : null,
          stageId,
          resolved,
        });
      }
    };
    consider(null);
    radical.variants.forEach((v) => consider(v.stageId));
  }
  return out;
}

/** 该字根下受影响的阶段数（用于列表角标）。 */
export function staleCountForRadical(
  radical: Radical,
  stages: HistoricalStage[],
  overrides: StrokeOrderMap
): number {
  return listReviewEntries([radical], stages, overrides).length;
}
