import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ListOrdered,
  Play,
  Pause,
  StepForward,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  Save,
  Eraser,
  AlertTriangle,
  CheckCircle2,
  PenTool,
  Ghost,
  Flag,
} from 'lucide-react';
import { useWritingSystemStore } from '@/store/useWritingSystemStore';
import { ShapeRenderer } from '@/components/GlyphRenderer';
import {
  reviewFingerprint,
  describeDirection,
  isValidOrderPermutation,
  type Stroke,
} from '@/utils/strokeOrder';
import {
  resolveStrokeOrder,
  listReviewEntries,
  BASE_SHAPE_KEY,
  type ResolvedStrokeOrder,
} from '@/utils/strokeOrderReview';

const SPEEDS = [
  { label: '0.5×', ms: 1400 },
  { label: '1×', ms: 750 },
  { label: '2×', ms: 380 },
];

const STATUS_META: Record<
  ResolvedStrokeOrder['status'],
  { label: string; cls: string }
> = {
  auto: { label: '规则顺序', cls: 'bg-bronze-400/15 text-bronze-500 border-bronze-400/30' },
  manual: { label: '手工顺序', cls: 'bg-bronze-400/15 text-bronze-600 border-bronze-500/30' },
  stale: { label: '待复核', cls: 'bg-vermilion-500/10 text-vermilion-500 border-vermilion-500/30' },
  error: { label: '路径有误', cls: 'bg-vermilion-500/10 text-vermilion-500 border-vermilion-500/30' },
  empty: { label: '空字形', cls: 'bg-parchment-200/60 text-ink-300 border-parchment-300/50' },
};

export const StrokeOrderPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const radicals = useWritingSystemStore((s) => s.radicals);
  const stages = useWritingSystemStore((s) => s.stages);
  const strokeOrders = useWritingSystemStore((s) => s.strokeOrders);

  const radicalId = searchParams.get('radical');
  const stageParam = searchParams.get('stage');

  const radical = radicals.find((r) => r.id === radicalId) ?? radicals[0] ?? null;

  // 只列出实际有字形的阶段（基础形状 + 有变体的阶段）
  const stageTabs = useMemo(() => {
    if (!radical) return [];
    const tabs: { id: string | null; name: string; color?: string }[] = [
      { id: null, name: '基础形状' },
    ];
    for (const st of stages) {
      if (radical.variants.some((v) => v.stageId === st.id)) {
        tabs.push({ id: st.id, name: st.name, color: st.color });
      }
    }
    return tabs;
  }, [radical, stages]);

  const stageId =
    stageTabs.some((t) => t.id === stageParam) || (stageParam === null && stageTabs.length > 0)
      ? stageParam
      : stageTabs[0]?.id ?? null;

  const reviewEntries = useMemo(
    () => listReviewEntries(radicals, stages, strokeOrders),
    [radicals, stages, strokeOrders]
  );

  const reviewCountByRadical = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of reviewEntries) m.set(e.radical.id, (m.get(e.radical.id) ?? 0) + 1);
    return m;
  }, [reviewEntries]);

  const selectRef = (rid: string, sid: string | null) => {
    const params: Record<string, string> = { radical: rid };
    if (sid) params.stage = sid;
    setSearchParams(params);
  };

  const resolved = useMemo(
    () => (radical ? resolveStrokeOrder(radical, stageId, strokeOrders) : null),
    [radical, stageId, strokeOrders]
  );

  // 未保存的底稿顺序；切换字根/阶段、字形笔画数/状态/规则顺序在外部变化时，渲染期重置
  const resetKey = `${radical?.id ?? ''}:${stageId ?? BASE_SHAPE_KEY}:${resolved?.set.strokes.length ?? 0}:${resolved?.status ?? 'none'}:${JSON.stringify(resolved?.order ?? [])}`;
  const [draftState, setDraftState] = useState<{ key: string; draft: number[] }>({
    key: resetKey,
    draft: resolved?.order ?? [],
  });
  if (draftState.key !== resetKey) {
    setDraftState({ key: resetKey, draft: resolved?.order ?? [] });
  }
  const draft = draftState.draft;
  const setDraft: React.Dispatch<React.SetStateAction<number[]>> = (updater) =>
    setDraftState((prev) => ({
      key: prev.key,
      draft: typeof updater === 'function' ? (updater as (d: number[]) => number[])(prev.draft) : updater,
    }));

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-8 animate-fade-up">
        <h2 className="text-3xl font-kai text-ink-500 font-bold tracking-wider flex items-center gap-3">
          <ListOrdered className="text-vermilion-500" size={28} />
          笔顺台
        </h2>
        <p className="text-ink-300 font-song mt-2 text-sm">
          每条字形按子笔画拆解，依「外框先于内部 · 横先于竖 · 上先于下 · 左先于右 · 并列按起笔位置」排定唯一顺序；
          手工只改顺序，不动形状。规则或字形一改，旧顺序自动标为待复核。
        </p>
      </div>

      {radicals.length === 0 ? (
        <div className="bg-parchment-50 rounded-2xl p-16 text-center shadow-scroll border border-parchment-300/40">
          <div className="text-6xl mb-4 opacity-30">📜</div>
          <p className="font-kai text-xl text-ink-300 mb-2">尚无字根</p>
          <a
            href="#/editor/radical"
            className="mt-4 inline-block px-6 py-2 bg-vermilion-500/80 hover:bg-vermilion-500 text-parchment-50 rounded-lg font-kai transition-all"
          >
            去创建字根
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* 左：字根清单 */}
          <div className="xl:col-span-3 space-y-4">
            <div className="bg-parchment-50 rounded-2xl p-4 shadow-scroll border border-parchment-300/40">
              <h3 className="font-kai text-lg text-ink-500 font-bold mb-3 px-1">字根</h3>
              <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
                {radicals.map((r) => {
                  const cnt = reviewCountByRadical.get(r.id) ?? 0;
                  const active = r.id === radical?.id;
                  return (
                    <button
                      key={r.id}
                      onClick={() => selectRef(r.id, null)}
                      className={`w-full flex items-center gap-3 p-2 rounded-xl border transition-all text-left ${
                        active
                          ? 'bg-vermilion-500/10 border-vermilion-500/40'
                          : 'bg-parchment-100/40 border-transparent hover:bg-parchment-100/80'
                      }`}
                    >
                      <div className="w-10 h-10 shrink-0 rounded-lg bg-parchment-50 border border-parchment-300/30 flex items-center justify-center">
                        <ShapeRenderer svgPath={r.baseShape} size={34} strokeWidth={2} />
                      </div>
                      <span className="font-kai text-lg text-ink-500 flex-1">{r.name}</span>
                      {cnt > 0 && (
                        <span className="shrink-0 min-w-5 h-5 px-1 rounded-full bg-vermilion-500 text-parchment-50 text-[11px] font-kai flex items-center justify-center">
                          {cnt}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <ReviewPanel entries={reviewEntries} onJump={selectRef} />
          </div>

          {/* 中：回放台面 */}
          <div className="xl:col-span-6">
            {radical && resolved && (
              <StrokeWorkspace
                key={`${radical.id}:${stageId ?? BASE_SHAPE_KEY}`}
                radical={radical}
                stageId={stageId}
                stageTabs={stageTabs}
                resolved={resolved}
                draft={draft}
                setDraft={setDraft}
                onSelectStage={(sid) => selectRef(radical.id, sid)}
              />
            )}
          </div>

          {/* 右：笔顺清单 */}
          <div className="xl:col-span-3">
            {radical && resolved && (
              <StrokeListPanel
                radical={radical}
                stageId={stageId}
                resolved={resolved}
                draft={draft}
                setDraft={setDraft}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 待复核面板
// ---------------------------------------------------------------------------

const ReviewPanel: React.FC<{
  entries: ReturnType<typeof listReviewEntries>;
  onJump: (radicalId: string, stageId: string | null) => void;
}> = ({ entries, onJump }) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-parchment-50 rounded-2xl p-4 shadow-scroll border border-parchment-300/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between mb-2"
      >
        <h3 className="font-kai text-lg text-ink-500 font-bold flex items-center gap-2">
          <AlertTriangle size={17} className="text-vermilion-500" />
          待复核 / 出错
        </h3>
        <span
          className={`min-w-6 h-6 px-1.5 rounded-full text-[12px] font-kai flex items-center justify-center ${
            entries.length > 0 ? 'bg-vermilion-500 text-parchment-50' : 'bg-parchment-200 text-ink-300'
          }`}
        >
          {entries.length}
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
          {entries.length === 0 ? (
            <p className="text-xs text-ink-300 font-song px-1 py-2">
              所有手工顺序都与当前字形、规则一致。
            </p>
          ) : (
            entries.map((e) => (
              <button
                key={`${e.radical.id}:${e.stageId ?? BASE_SHAPE_KEY}`}
                onClick={() => onJump(e.radical.id, e.stageId)}
                className="w-full text-left p-2 rounded-lg bg-vermilion-500/5 hover:bg-vermilion-500/10 border border-vermilion-500/15 transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="font-kai text-base text-ink-500">{e.radical.name}</span>
                  <span className="text-[11px] font-song text-ink-300">
                    {e.stage ? e.stage.name : '基础形状'}
                  </span>
                  <span
                    className={`ml-auto text-[10px] px-1.5 py-0.5 rounded border font-kai ${
                      e.resolved.status === 'error'
                        ? 'bg-vermilion-500/10 text-vermilion-500 border-vermilion-500/30'
                        : 'bg-bronze-400/10 text-bronze-600 border-bronze-400/30'
                    }`}
                  >
                    {e.resolved.status === 'error' ? '路径有误' : '待复核'}
                  </span>
                </div>
                <p className="text-[11px] text-ink-300 font-song mt-1 line-clamp-2">
                  {e.resolved.reasons[0]}
                </p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 回放台面
// ---------------------------------------------------------------------------

interface StageTab {
  id: string | null;
  name: string;
  color?: string;
}

const StrokeWorkspace: React.FC<{
  radical: ReturnType<typeof useWritingSystemStore.getState>['radicals'][number];
  stageId: string | null;
  stageTabs: StageTab[];
  resolved: ResolvedStrokeOrder;
  draft: number[];
  setDraft: React.Dispatch<React.SetStateAction<number[]>>;
  onSelectStage: (stageId: string | null) => void;
}> = ({ radical, stageId, stageTabs, resolved, draft, setDraft, onSelectStage }) => {
  const saveStrokeOrder = useWritingSystemStore((s) => s.saveStrokeOrder);
  const clearStrokeOrder = useWritingSystemStore((s) => s.clearStrokeOrder);

  const { set: strokeSet, status, reasons } = resolved;
  const n = strokeSet.strokes.length;

  const [curIndex, setCurIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [showGhost, setShowGhost] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(resolved.order),
    [draft, resolved.order]
  );
  const draftMatchesAuto = JSON.stringify(draft) === JSON.stringify(resolved.autoOrder);
  const isValidCurrentDraft = isValidOrderPermutation(draft, n);

  // 起笔重合组数（容差与引擎一致，0.5 单位）
  const coincideCount = useMemo(() => {
    let groups = 0;
    const st = strokeSet.strokes;
    for (let i = 0; i < st.length; i++) {
      for (let j = i + 1; j < st.length; j++) {
        if (
          Math.abs(st[i].start.x - st[j].start.x) <= 0.5 &&
          Math.abs(st[i].start.y - st[j].start.y) <= 0.5
        ) {
          groups++;
        }
      }
    }
    return groups;
  }, [strokeSet]);

  useEffect(() => {
    if (!playing || n === 0) return;
    if (curIndex >= n - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setCurIndex((i) => Math.min(i + 1, n - 1)), SPEEDS[speedIdx].ms);
    return () => clearTimeout(t);
  }, [playing, curIndex, n, speedIdx]);

  // 笔数变化（外部编辑字形）时收敛播放位置
  useEffect(() => {
    setCurIndex((i) => Math.min(i, Math.max(0, n - 1)));
  }, [n]);

  const strokeBySource = (src: number) => strokeSet.strokes.find((s) => s.sourceIndex === src)!;

  const handleSave = () => {
    saveStrokeOrder(radical.id, stageId, draft, reviewFingerprint(strokeSet));
    setSavedMsg('笔顺已保存');
    setTimeout(() => setSavedMsg(''), 1800);
  };

  const handleRestoreAuto = () => {
    clearStrokeOrder(radical.id, stageId);
    setDraft(resolved.autoOrder);
    setCurIndex(0);
  };

  const editable = status !== 'empty' && status !== 'error';
  const meta = STATUS_META[status];

  return (
    <div className="space-y-4">
      {/* 阶段页签 */}
      <div className="flex items-center gap-2 flex-wrap">
        {stageTabs.map((t) => {
          const active = t.id === stageId;
          return (
            <button
              key={t.id ?? BASE_SHAPE_KEY}
              onClick={() => onSelectStage(t.id)}
              className={`px-4 py-2 rounded-xl font-kai text-sm border transition-all ${
                active
                  ? 'bg-ink-500 text-parchment-50 border-ink-500 shadow-scroll'
                  : 'bg-parchment-50 text-ink-400 border-parchment-300/50 hover:border-ink-300'
              }`}
              style={active && t.color ? { backgroundColor: t.color, borderColor: t.color } : undefined}
            >
              {t.name}
            </button>
          );
        })}
        <a
          href={`#/editor/radical?id=${radical.id}`}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-kai text-ink-300 hover:text-vermilion-500 border border-parchment-300/40 hover:border-vermilion-500/40 transition-all"
        >
          <PenTool size={13} />
          去改字形
        </a>
      </div>

      <div className="bg-parchment-50 rounded-2xl p-6 shadow-scroll border border-parchment-300/40">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-kai text-2xl text-ink-500 font-bold tracking-wider flex items-center gap-3">
              {radical.name}
              <span className="text-xs font-song text-ink-300">
                {stageTabs.find((t) => t.id === stageId)?.name ?? '基础形状'}
              </span>
            </h3>
          </div>
          <span className={`px-3 py-1 rounded-lg text-xs font-kai border ${meta.cls}`}>
            {meta.label}
          </span>
        </div>

        {/* 状态横幅 */}
        {(status === 'stale' || status === 'error' || status === 'empty') && (
          <div
            className={`mb-4 rounded-xl border p-3.5 text-sm font-song ${
              status === 'empty'
                ? 'bg-parchment-100/60 border-parchment-300/50 text-ink-300'
                : 'bg-vermilion-500/5 border-vermilion-500/25 text-ink-400'
            }`}
          >
            {status === 'stale' && (
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={17} className="text-vermilion-500 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-kai text-vermilion-500 mb-1">此顺序需要复核</p>
                  <ul className="space-y-0.5 list-disc list-inside text-[13px]">
                    {reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                  <div className="flex gap-2 mt-2.5 flex-wrap">
                    <button
                      onClick={handleSave}
                      disabled={!isValidCurrentDraft}
                      className="px-3 py-1.5 rounded-lg text-xs font-kai bg-vermilion-500 hover:bg-vermilion-600 text-parchment-50 transition-all disabled:opacity-40"
                    >
                      确认当前底稿并复核
                    </button>
                    {resolved.manualStillUsable && (
                      <button
                        onClick={() => setDraft(resolved.override!.order)}
                        className="px-3 py-1.5 rounded-lg text-xs font-kai bg-vermilion-500/10 hover:bg-vermilion-500/20 text-vermilion-500 transition-all"
                      >
                        以旧顺序为底稿修订
                      </button>
                    )}
                    <button
                      onClick={() => setDraft(resolved.autoOrder)}
                      className="px-3 py-1.5 rounded-lg text-xs font-kai bg-bronze-400/15 hover:bg-bronze-400/25 text-bronze-600 transition-all"
                    >
                      采用规则顺序
                    </button>
                    <button
                      onClick={handleRestoreAuto}
                      className="px-3 py-1.5 rounded-lg text-xs font-kai text-ink-300 hover:text-ink-500 hover:bg-parchment-200/60 transition-all"
                    >
                      清除旧顺序
                    </button>
                  </div>
                </div>
              </div>
            )}
            {status === 'error' && (
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={17} className="text-vermilion-500 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-kai text-vermilion-500 mb-1">
                    路径写错{strokeSet.strokes.length > 0 ? `，已抢救解析出 ${strokeSet.strokes.length} 笔` : '，无法解析出任何笔画'}
                  </p>
                  <ul className="space-y-0.5 list-disc list-inside text-[13px]">
                    {reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                  <p className="text-[12px] text-ink-300 mt-2">
                    修好路径前不能改笔顺（顺序依赖笔画身份）。
                  </p>
                </div>
              </div>
            )}
            {status === 'empty' && (
              <div className="flex items-center gap-2.5">
                <Ghost size={17} className="shrink-0" />
                <span>
                  空字形：还没有任何笔画，笔顺为空。请到
                  <a className="text-vermilion-500 underline mx-1" href={`#/editor/radical?id=${radical.id}`}>
                    字根编辑
                  </a>
                  画出形状后再来。
                </span>
              </div>
            )}
          </div>
        )}
        {status === 'manual' && !dirty && (
          <div className="mb-4 rounded-xl border border-bronze-400/25 bg-bronze-400/5 p-3 text-sm font-song text-bronze-600 flex items-center gap-2.5">
            <CheckCircle2 size={16} />
            使用创作者手工排定的顺序，与当前字形、规则一致。
          </div>
        )}
        {status === 'manual' && reasons.length > 0 && (
          <div className="mb-4 rounded-xl border border-vermilion-500/25 bg-vermilion-500/5 p-3 text-[13px] font-song text-ink-400 flex items-start gap-2.5">
            <AlertTriangle size={16} className="text-vermilion-500 mt-0.5 shrink-0" />
            <ul className="space-y-0.5 list-disc list-inside">
              {reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {coincideCount > 0 && (
          <div className="mb-4 rounded-xl border border-parchment-300/60 bg-parchment-100/60 p-3 text-[13px] font-song text-ink-300 flex items-center gap-2.5">
            <Flag size={15} className="text-bronze-500 shrink-0" />
            检测到 {coincideCount} 组起笔重合：并列时先按上→下、左→右排定，仍完全相同则按原始路径序，结果唯一可复现。
          </div>
        )}

        {/* 画布 */}
        <div className="relative mx-auto" style={{ maxWidth: 420 }}>
          <svg viewBox="0 0 100 100" className="w-full aspect-square bg-parchment-100/70 rounded-2xl border-2 border-dashed border-parchment-300/50 shadow-inner">
            <defs>
              <pattern id="stroke-grid" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#D9BE82" strokeWidth="0.25" opacity="0.5" />
              </pattern>
            </defs>
            <rect width="100" height="100" fill="url(#stroke-grid)" />
            <line x1="50" y1="5" x2="50" y2="95" stroke="#B23A29" strokeWidth="0.3" strokeDasharray="2 2" opacity="0.25" />
            <line x1="5" y1="50" x2="95" y2="50" stroke="#B23A29" strokeWidth="0.3" strokeDasharray="2 2" opacity="0.25" />

            {n === 0 && (
              <text x="50" y="52" textAnchor="middle" className="font-kai" fill="#9E8B75" fontSize="7">
                空
              </text>
            )}

            {draft.map((src, i) => {
              const s = strokeBySource(src);
              if (i > curIndex && !showGhost) return null;
              const isCurrent = i === curIndex;
              const written = i < curIndex;
              return (
                <g key={src}>
                  <path
                    d={s.raw}
                    fill="none"
                    stroke={
                      isCurrent ? '#B23A29' : written ? '#3E2723' : 'rgba(110,90,68,0.28)'
                    }
                    strokeWidth={isCurrent ? 3.4 : 2.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={
                      isCurrent
                        ? { animation: 'inkSpread 0.35s ease-out both' }
                        : undefined
                    }
                  />
                  {/* 起笔点与笔序徽标 */}
                  {isCurrent && (
                    <g>
                      <circle cx={s.start.x} cy={s.start.y} r="3.2" fill="#B23A29" />
                      <g transform={`translate(${clamp(s.start.x + 3.6, 6, 90)},${clamp(s.start.y - 4, 6, 94)})`}>
                        <rect x="-3.4" y="-3" width="6.8" height="6" rx="1.4" fill="#B23A29" />
                        <text textAnchor="middle" y="1.6" fontSize="4.6" fill="#FBF4E4" className="font-kai" fontWeight="700">
                          {i + 1}
                        </text>
                      </g>
                      <DirectionArrow stroke={s} />
                    </g>
                  )}
                  {written && (
                    <circle cx={s.start.x} cy={s.start.y} r="0.9" fill="#3E2723" opacity="0.55" />
                  )}
                </g>
              );
            })}
          </svg>

          {n > 0 && (
            <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-parchment-50/85 backdrop-blur-sm border border-parchment-300/30 text-xs font-kai text-ink-400">
              第 <span className="text-vermilion-500 font-bold">{Math.min(curIndex + 1, n)}</span> / {n} 笔
            </div>
          )}
        </div>

        {/* 播放控制 */}
        {n > 0 && (
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-center gap-2">
              <CtrlBtn
                title="回到首笔"
                onClick={() => {
                  setPlaying(false);
                  setCurIndex(0);
                }}
              >
                <RotateCcw size={17} />
              </CtrlBtn>
              <CtrlBtn
                title={playing ? '暂停' : '播放'}
                primary
                onClick={() => {
                  if (curIndex >= n - 1) setCurIndex(0);
                  setPlaying((v) => !v);
                }}
              >
                {playing ? <Pause size={19} /> : <Play size={19} />}
              </CtrlBtn>
              <CtrlBtn
                title="下一笔"
                onClick={() => {
                  setPlaying(false);
                  setCurIndex((i) => Math.min(i + 1, n - 1));
                }}
              >
                <StepForward size={17} />
              </CtrlBtn>
              <div className="w-px h-7 bg-parchment-300/60 mx-1.5" />
              {SPEEDS.map((sp, i) => (
                <button
                  key={sp.label}
                  onClick={() => setSpeedIdx(i)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-kai transition-all ${
                    speedIdx === i
                      ? 'bg-ink-500 text-parchment-50'
                      : 'text-ink-300 hover:bg-parchment-200/60'
                  }`}
                >
                  {sp.label}
                </button>
              ))}
              <div className="w-px h-7 bg-parchment-300/60 mx-1.5" />
              <button
                onClick={() => setShowGhost((v) => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-kai transition-all ${
                  showGhost ? 'bg-bronze-400/20 text-bronze-600' : 'text-ink-300 hover:bg-parchment-200/60'
                }`}
                title="以淡影显示尚未写到的笔画"
              >
                <Ghost size={14} />
                淡影
              </button>
            </div>

            {/* 进度条：可点选跳转笔序 */}
            <div className="flex items-center gap-1 max-w-md mx-auto">
              {draft.map((src, i) => (
                <button
                  key={src}
                  onClick={() => {
                    setPlaying(false);
                    setCurIndex(i);
                  }}
                  title={`第 ${i + 1} 笔`}
                  className={`h-2 flex-1 rounded-full transition-all ${
                    i <= curIndex ? 'bg-vermilion-500' : 'bg-parchment-300/60 hover:bg-parchment-400/60'
                  } ${i === curIndex ? 'ring-2 ring-vermilion-500/30' : ''}`}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 保存条 */}
      {editable && n > 0 && (
        <div className="bg-parchment-50 rounded-2xl px-5 py-4 shadow-scroll border border-parchment-300/40 flex items-center gap-3 flex-wrap">
          <p className="text-xs font-song text-ink-300 flex items-center gap-1.5">
            <Flag size={13} className="text-bronze-500" />
            手工调整只改变书写顺序；形状、笔画数（{n}）与开合状态都不会变。
          </p>
          <div className="ml-auto flex items-center gap-2">
            {savedMsg && (
              <span className="text-xs font-kai text-bronze-600 flex items-center gap-1">
                <CheckCircle2 size={14} />
                {savedMsg}
              </span>
            )}
            <button
              onClick={() => {
                setDraft(resolved.order);
                setCurIndex(0);
              }}
              disabled={!dirty}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-kai text-ink-400 hover:bg-parchment-200/60 disabled:opacity-40 transition-all border border-parchment-300/50"
            >
              <Eraser size={15} />
              撤销改动
            </button>
            <button
              onClick={handleRestoreAuto}
              disabled={draftMatchesAuto && status !== 'manual' && status !== 'stale'}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-kai text-ink-400 hover:bg-parchment-200/60 disabled:opacity-40 transition-all border border-parchment-300/50"
            >
              <RotateCcw size={15} />
              恢复规则顺序
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty}
              className="flex items-center gap-1.5 px-6 py-2 bg-vermilion-500 hover:bg-vermilion-600 disabled:opacity-40 disabled:hover:bg-vermilion-500 text-parchment-50 rounded-xl shadow-seal font-kai text-sm transition-all"
            >
              <Save size={16} />
              保存顺序
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const DirectionArrow: React.FC<{ stroke: Stroke }> = ({ stroke: s }) => {
  if (s.direction === '点') return null;
  // 在折线 70% 处沿切线画一个小箭头
  const pts = s.points;
  const target = Math.min(pts.length - 1, Math.floor(pts.length * 0.7));
  const p = pts[target];
  const q = pts[Math.min(pts.length - 1, target + 1)];
  const ang = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
  return (
    <g transform={`translate(${p.x},${p.y}) rotate(${ang})`}>
      <path d="M-2.6 -2.2 L2 0 L-2.6 2.2 Z" fill="#B23A29" opacity="0.9" />
    </g>
  );
};

const CtrlBtn: React.FC<{
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  primary?: boolean;
}> = ({ children, onClick, title, primary }) => (
  <button
    onClick={onClick}
    title={title}
    className={`w-11 h-11 rounded-full flex items-center justify-center transition-all border ${
      primary
        ? 'bg-vermilion-500 hover:bg-vermilion-600 text-parchment-50 border-vermilion-600/30 shadow-seal'
        : 'bg-parchment-100/70 hover:bg-parchment-200/70 text-ink-400 border-parchment-300/50'
    }`}
  >
    {children}
  </button>
);

// ---------------------------------------------------------------------------
// 右侧笔顺清单
// ---------------------------------------------------------------------------

const StrokeListPanel: React.FC<{
  radical: ReturnType<typeof useWritingSystemStore.getState>['radicals'][number];
  stageId: string | null;
  resolved: ResolvedStrokeOrder;
  draft: number[];
  setDraft: React.Dispatch<React.SetStateAction<number[]>>;
}> = ({ resolved, draft, setDraft }) => {
  const { set: strokeSet, status, autoOrder } = resolved;
  const editable = status !== 'empty' && status !== 'error';
  const dirty = JSON.stringify(draft) !== JSON.stringify(resolved.order);

  const moveAt = (displayIdx: number, dir: -1 | 1) => {
    const target = displayIdx + dir;
    if (target < 0 || target >= draft.length) return;
    setDraft((prev) => {
      const next = [...prev];
      [next[displayIdx], next[target]] = [next[target], next[displayIdx]];
      return next;
    });
  };

  return (
    <div className="bg-parchment-50 rounded-2xl p-4 shadow-scroll border border-parchment-300/40 xl:sticky xl:top-24">
      <h3 className="font-kai text-lg text-ink-500 font-bold mb-1 flex items-center justify-between">
        <span>笔画明细</span>
        <span className="text-xs font-song text-ink-300">{strokeSet.strokes.length} 笔</span>
      </h3>
      <p className="text-[11px] font-song text-ink-300 mb-3">
        {dirty ? '当前为未保存的底稿顺序' : '按当前生效顺序排列'}
        {editable && '，可用箭头调整笔序'}
      </p>

      {status === 'empty' ? (
        <p className="text-sm text-ink-300 font-song p-2">空字形，无笔画可列。</p>
      ) : (
        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
          {draft.map((src, i) => {
            const s = strokeSet.strokes.find((x) => x.sourceIndex === src)!;
            const autoPos = autoOrder.indexOf(src);
            return (
              <div
                key={src}
                className="rounded-xl border border-parchment-300/40 bg-parchment-100/40 p-2.5"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-vermilion-500 text-parchment-50 text-xs font-kai font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span className="font-kai text-sm text-ink-500">第 {i + 1} 笔</span>
                  <span className="ml-auto flex items-center gap-1">
                    {autoPos !== i && (
                      <span className="text-[10px] font-song text-bronze-600 mr-0.5" title={`规则顺序中为第 ${autoPos + 1} 笔`}>
                        规{autoPos + 1}
                      </span>
                    )}
                    {editable && (
                      <>
                        <button
                          onClick={() => moveAt(i, -1)}
                          disabled={i === 0}
                          title="上移一笔"
                          className="w-5 h-5 rounded flex items-center justify-center text-ink-300 hover:text-vermilion-500 hover:bg-parchment-200/70 disabled:opacity-25 transition-all"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => moveAt(i, 1)}
                          disabled={i === draft.length - 1}
                          title="下移一笔"
                          className="w-5 h-5 rounded flex items-center justify-center text-ink-300 hover:text-vermilion-500 hover:bg-parchment-200/70 disabled:opacity-25 transition-all"
                        >
                          <ChevronDown size={14} />
                        </button>
                      </>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <svg viewBox="0 0 100 100" className="w-10 h-10 shrink-0 rounded-lg bg-parchment-50 border border-parchment-300/30">
                    <path
                      d={s.raw}
                      fill="none"
                      stroke="#4A3828"
                      strokeWidth={5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <dl className="text-[11px] font-song text-ink-400 space-y-0.5 leading-tight">
                    <div>起 ({s.start.x.toFixed(1)}, {s.start.y.toFixed(1)}) → 终 ({s.end.x.toFixed(1)}, {s.end.y.toFixed(1)})</div>
                    <div className="text-ink-500 font-kai">{describeDirection(s)}</div>
                    <div>
                      {s.closed ? (
                        <span className="text-bronze-600">● 闭合（可作外框）</span>
                      ) : (
                        <span className="text-ink-300">○ 开放笔画</span>
                      )}
                    </div>
                  </dl>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-dashed border-parchment-300/60 text-[11px] font-song text-ink-300 space-y-1">
        <p>排序规则：外框 → 内部；横 → 竖；上 → 下；左 → 右；并列按起笔位置，再同则按原始路径序。</p>
        <p>同一条字形，无论解析多少次结果都相同。</p>
      </div>
    </div>
  );
};
