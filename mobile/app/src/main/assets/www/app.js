// ============================================================================
// app.js
// 골프 헤드 잔상 동영상 & 스냅샷 스튜디오 메인 컨트롤러
// ============================================================================

import {
  clamp,
  KEY_MOMENTS,
  MOMENT_COLORS,
  measurements,
  calculateTempo,
  smoothSamples,
  estimateClubPosition,
  detectClubHeadMotionPeak,
  detectAddressGolfClub,
  regularizeSwingWithAddressClub,
  applyPinnedClubHeadOverrides,
  detectSwingMoments,
  evaluateSwingPhase
} from './swing-engine.js?v=20261019_06';
import {
  buildDemoSwingDataset,
  createAddressClubTemplate
} from './demo-generator.js?v=20261019_06';
import {
  findNearestSample,
  renderCompositeFrame,
  exportStrobeSnapshot,
  exportSequencePanorama,
  exportAfterimageVideo,
  seekVideoSafely
} from './renderer-exporter.js?v=20261019_06';
import {
  DEFAULT_SHOT_TRACER_OPTIONS,
  SHOT_TRACER_PRESETS,
  SHOT_PIN_POINTS_META,
  getPinnedWorkSummaryForTarget,
  classifyTrajectoryLabel,
  classifyShotShapeLabel,
  applyShotShapeOptionToMetrics,
  autoCalibrateShotTracerFromVideo,
  syncShotGeometryFromMetrics,
  recalculateMetricsFromGeometry,
  estimateShotMetricsFromVideoTrack,
  solveApexFromClickedMidpoint,
  applyUserPinnedBallPoint
} from './shot-tracer-engine.js?v=20261019_06';
import {
  DEFAULT_STABILIZATION_OPTIONS,
  extractStabilizationFeatureMap,
  computeEffectiveStabilizationOffset,
  recomputeSamplesStabilization,
  recomputeSamplesStabilizationAsync,
  alignFrameToReferenceGround
} from './video-stabilizer.js?v=20261017_03';
import {
  saveWorkRecordToArchive,
  listArchivedWorkRecords,
  getArchivedWorkRecordById,
  renameArchivedWorkRecord,
  deleteArchivedWorkRecord,
  clearAllArchivedWorkRecords
} from './project-archive.js?v=20261017_03';

const $ = id => document.getElementById(id);

export const DEFAULT_RENDER_OPTIONS = Object.freeze({
  trailScope: 'full', // 지속 시간 궤도 유지 (선명한 궤적)
  trailDurationSec: 1.80, // 1.80s
  showClubRibbon: false, // 보조 궤적 컬러 선 해제
  ribbonWidth: 3, // 3px
  showStrobeGhosts: true, // 실제 골프채 샤프트·헤드 잔상 체크
  showShaftGlint: true, // 샤프트 빛반사 (( 원형 궤적 체크
  strobeStep: 2, // 2프레임 간격
  ghostOpacity: 0.85, // 85%
  gripFade: 0.50, // 50%
  showHandPath: true, // 그립(손목) 궤적 점선 체크
  showSwingPlane: true, // 어드레스 스윙 플레인 체크
  showSkeleton: false, // 관절 스켈레톤 해제
  showAngles: true, // 관절 각도 수치 표시 체크
  showHud: true
});

export function createDefaultStabilizationState() {
  return {
    ...DEFAULT_STABILIZATION_OPTIONS,
    groundPinMode: false,
    groundAnchorPoint: { ...DEFAULT_STABILIZATION_OPTIONS.groundAnchorPoint },
    golferAnchorPoint: { ...DEFAULT_STABILIZATION_OPTIONS.golferAnchorPoint },
    customKeyframes: []
  };
}

export function createDefaultShotTracerState(enabled = false) {
  return {
    ...DEFAULT_SHOT_TRACER_OPTIONS,
    enabled: Boolean(enabled),
    pinnedPointsStore: {},
    pinnedHistory: [],
    hoverNormPoint: null,
    originPoint: { ...DEFAULT_SHOT_TRACER_OPTIONS.originPoint },
    midPoint1: { ...DEFAULT_SHOT_TRACER_OPTIONS.midPoint1 },
    midPoint2: { ...DEFAULT_SHOT_TRACER_OPTIONS.midPoint2 },
    midPoint3: { ...DEFAULT_SHOT_TRACER_OPTIONS.midPoint3 },
    midPoint4: { ...DEFAULT_SHOT_TRACER_OPTIONS.midPoint4 },
    trackedWaypoints: [...(DEFAULT_SHOT_TRACER_OPTIONS.trackedWaypoints || [])],
    apexPoint: { ...DEFAULT_SHOT_TRACER_OPTIONS.apexPoint },
    landingPoint: { ...DEFAULT_SHOT_TRACER_OPTIONS.landingPoint },
    rollEndPoint: { ...DEFAULT_SHOT_TRACER_OPTIONS.rollEndPoint }
  };
}

export const appState = {
  studioMode: 'afterimage', // 'afterimage' (측면/정면 클럽 잔상) | 'shot-tracer' (후방 공 궤적 샷 트레이서)
  sourceMode: 'demo', // 'demo' | 'video'
  demoPreset: 'driver-fo', // 'driver-fo' | 'iron-dtl' | 'shot-tracer-dtl'
  videoElement: null,
  videoReady: false,
  videoFileName: '내장 프로 스윙 시뮬레이션 (Driver Face-On 60fps)',
  uploadedVideoFile: null,
  videoObjectUrl: null,
  videoFileSignature: null,
  modeWorkspaces: {
    afterimage: null,
    'shot-tracer': null
  },
  activeArchiveId: null,
  activeArchiveTitle: '',
  archiveFilterMode: 'all',
  archiveSearchQuery: '',
  selectedArchiveId: null,
  archivedRecordsCache: [],
  hand: 'right',
  fps: 60,
  duration: 3.2,
  currentTime: 1.78, // 초기 진입 시 임팩트 순간의 극적인 클럽 헤드 잔상을 바로 표시
  clipStartTime: 0.00,
  clipEndTime: 3.20,
  clipPreset: 'all',
  playing: false,
  playingClipOnly: false,
  playbackSpeed: 0.5,
  exportSpeedFactor: 0.5,
  canvasWidth: 1280,
  canvasHeight: 720,
  viewportZoom: 1.0,
  lastHoverNormX: 0.588,
  lastHoverNormY: 0.819,
  wasZoomPanDrag: false,
  manualPinMode: false,
  busy: false,
  samples: [],
  keyMoments: [],
  addressClub: null,
  selectedPhaseKey: 'impact',
  renderOptions: { ...DEFAULT_RENDER_OPTIONS },
  stabilizationOptions: createDefaultStabilizationState(),
  shotTracerOptions: createDefaultShotTracerState(false)
};

let rafId = null;
let lastFrameTimestamp = 0;
let poseLandmarkerInstance = null;

// ============================================================================
// 0.5초 이상 소요 작업 감지 및 최상단(Top Layer) 전면 애니메이션 컨트롤러
// ============================================================================

const busyOverlayState = {
  activeDepth: 0,
  visible: false,
  thresholdTimerId: null,
  elapsedIntervalId: null,
  startedAt: 0,
  shownAt: 0,
  title: '데이터 처리 및 화면 갱신 중입니다...',
  sub: '잠시만 기다려 주세요. 스윙 궤적 및 영상 프레임을 실시간 처리하고 있습니다.',
  stepText: '실시간 연산 및 캔버스 동기화 진행 중',
  progressPct: null
};

function yieldToBrowserFrame() {
  return new Promise(resolve => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible' && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function syncBusyOverlayDOM() {
  const overlay = $('globalBusyOverlay');
  if (!overlay) return;

  const titleEl = $('busyOverlayTitle');
  const subEl = $('busyOverlaySub');
  const stepEl = $('busyOverlayStepText');
  const pctEl = $('busyOverlayPctText');
  const fillEl = $('busyOverlayProgressFill');
  const elapsedEl = $('busyOverlayElapsed');

  if (titleEl && busyOverlayState.title) {
    titleEl.textContent = busyOverlayState.title;
  }
  if (subEl && busyOverlayState.sub) {
    subEl.textContent = busyOverlayState.sub;
  }
  if (stepEl && busyOverlayState.stepText) {
    stepEl.textContent = busyOverlayState.stepText;
  }
  if (elapsedEl) {
    const sec = Math.max(0.1, (performance.now() - busyOverlayState.startedAt) / 1000);
    elapsedEl.textContent = `${sec.toFixed(1)}s`;
  }
  if (fillEl && pctEl) {
    if (Number.isFinite(busyOverlayState.progressPct)) {
      const clampedPct = clamp(Math.round(busyOverlayState.progressPct), 0, 100);
      fillEl.classList.remove('is-indeterminate');
      fillEl.style.width = `${Math.max(3, clampedPct)}%`;
      pctEl.textContent = `${clampedPct}%`;
    } else {
      fillEl.classList.add('is-indeterminate');
      fillEl.style.width = '';
      pctEl.textContent = '처리 중';
    }
  }
}

function showGlobalBusyOverlayNow() {
  const overlay = $('globalBusyOverlay');
  if (!overlay) return;

  syncBusyOverlayDOM();
  overlay.hidden = false;
  try {
    if (typeof overlay.showPopover === 'function') {
      overlay.showPopover();
    }
  } catch {
    // 이미 열려 있거나 미지원 환경인 경우 무시
  }

  if (!busyOverlayState.visible) {
    busyOverlayState.visible = true;
    busyOverlayState.shownAt = performance.now();
  }

  if (!busyOverlayState.elapsedIntervalId) {
    busyOverlayState.elapsedIntervalId = setInterval(() => {
      if (!busyOverlayState.visible) return;
      const elapsedEl = $('busyOverlayElapsed');
      if (elapsedEl) {
        const sec = Math.max(0.1, (performance.now() - busyOverlayState.startedAt) / 1000);
        elapsedEl.textContent = `${sec.toFixed(1)}s`;
      }
    }, 100);
  }
}

function hideGlobalBusyOverlayNow() {
  if (busyOverlayState.thresholdTimerId) {
    clearTimeout(busyOverlayState.thresholdTimerId);
    busyOverlayState.thresholdTimerId = null;
  }
  if (busyOverlayState.elapsedIntervalId) {
    clearInterval(busyOverlayState.elapsedIntervalId);
    busyOverlayState.elapsedIntervalId = null;
  }
  busyOverlayState.visible = false;
  const overlay = $('globalBusyOverlay');
  if (!overlay) return;
  try {
    if (typeof overlay.hidePopover === 'function') {
      overlay.hidePopover();
    }
  } catch {
    // hidePopover 예외 무시
  }
  overlay.hidden = true;
}

function updateGlobalBusyOverlay(patch = {}) {
  if (patch.title !== undefined) busyOverlayState.title = patch.title;
  if (patch.sub !== undefined) busyOverlayState.sub = patch.sub;
  if (patch.stepText !== undefined) busyOverlayState.stepText = patch.stepText;
  if (patch.progressPct !== undefined) busyOverlayState.progressPct = patch.progressPct;
  if (busyOverlayState.visible) {
    syncBusyOverlayDOM();
  }
}

/**
 * 모든 작업을 감싸서 0.5초(기본 420ms 임계치 또는 대용량 작업 즉시 표시) 이상 걸릴 경우
 * 화면 제일 앞(Top Layer)에 데이터 처리 및 화면 갱신 애니메이션을 표시하고 메인 스레드 멈춤을 방지합니다.
 */
async function runWithBusyOverlay(options = {}, taskFn) {
  const {
    title = '데이터 처리 및 화면 갱신 중입니다...',
    sub = '잠시만 기다려 주세요. 스윙 궤적 및 영상 프레임을 실시간 처리하고 있습니다.',
    stepText = '실시간 연산 및 캔버스 동기화 진행 중',
    thresholdMs = 420,
    immediate = false,
    progressPct = null
  } = options;

  const isOuterTask = busyOverlayState.activeDepth === 0;
  busyOverlayState.activeDepth++;

  if (isOuterTask) {
    busyOverlayState.startedAt = performance.now();
    busyOverlayState.title = title;
    busyOverlayState.sub = sub;
    busyOverlayState.stepText = stepText;
    busyOverlayState.progressPct = progressPct;

    if (immediate || thresholdMs <= 0) {
      showGlobalBusyOverlayNow();
      await yieldToBrowserFrame();
    } else {
      if (busyOverlayState.thresholdTimerId) {
        clearTimeout(busyOverlayState.thresholdTimerId);
      }
      busyOverlayState.thresholdTimerId = setTimeout(() => {
        busyOverlayState.thresholdTimerId = null;
        if (busyOverlayState.activeDepth > 0) {
          showGlobalBusyOverlayNow();
        }
      }, thresholdMs);
    }
  } else {
    updateGlobalBusyOverlay({ title, sub, stepText, progressPct });
  }

  const reportProgress = (pct, nextStepText, nextSubText) => {
    const patch = {};
    if (pct !== undefined) patch.progressPct = pct;
    if (nextStepText !== undefined) patch.stepText = nextStepText;
    if (nextSubText !== undefined) patch.sub = nextSubText;
    updateGlobalBusyOverlay(patch);
  };
  reportProgress.setProgress = reportProgress;
  reportProgress.reportProgress = reportProgress;

  try {
    return await taskFn(reportProgress);
  } finally {
    busyOverlayState.activeDepth = Math.max(0, busyOverlayState.activeDepth - 1);
    if (busyOverlayState.activeDepth === 0) {
      if (busyOverlayState.thresholdTimerId) {
        clearTimeout(busyOverlayState.thresholdTimerId);
        busyOverlayState.thresholdTimerId = null;
      }
      if (busyOverlayState.visible) {
        updateGlobalBusyOverlay({
          progressPct: 100,
          stepText: '화면 갱신 완료 · 렌더링 동기화 중'
        });
        const shownElapsed = performance.now() - busyOverlayState.shownAt;
        const remainMinDisplay = Math.max(40, 260 - shownElapsed);
        await new Promise(r => setTimeout(r, remainMinDisplay));
        await yieldToBrowserFrame();
      }
      hideGlobalBusyOverlayNow();
    }
  }
}

// ============================================================================
// 초기화 및 이벤트 바인딩
// ============================================================================

function syncRenderOptionsUI() {
  const opts = appState.renderOptions;

  if ($('selectPlaybackSpeed')) $('selectPlaybackSpeed').value = String(appState.playbackSpeed);
  if ($('selectExportSpeed')) $('selectExportSpeed').value = String(appState.exportSpeedFactor);
  if ($('selectTrailScope')) $('selectTrailScope').value = opts.trailScope;

  if ($('rangeTrailDuration')) $('rangeTrailDuration').value = String(opts.trailDurationSec);
  if ($('valTrailDuration')) $('valTrailDuration').textContent = `${opts.trailDurationSec.toFixed(2)}s`;

  if ($('rangeRibbonWidth')) $('rangeRibbonWidth').value = String(opts.ribbonWidth);
  if ($('valRibbonWidth')) $('valRibbonWidth').textContent = `${opts.ribbonWidth}px`;

  if ($('rangeStrobeStep')) $('rangeStrobeStep').value = String(opts.strobeStep);
  if ($('valStrobeStep')) $('valStrobeStep').textContent = `${opts.strobeStep}프레임 간격`;

  if ($('rangeGhostOpacity')) $('rangeGhostOpacity').value = String(opts.ghostOpacity);
  if ($('valGhostOpacity')) $('valGhostOpacity').textContent = `${Math.round(opts.ghostOpacity * 100)}%`;

  if ($('rangeGripFade')) $('rangeGripFade').value = String(opts.gripFade);
  if ($('valGripFade')) {
    const pct = Math.round(opts.gripFade * 100);
    $('valGripFade').textContent = pct >= 95 ? `${pct}% (중앙부터 표시)` : (pct <= 2 ? `${pct}% (전체 표시)` : `${pct}%`);
  }

  if ($('chkStrobeGhosts')) $('chkStrobeGhosts').checked = Boolean(opts.showStrobeGhosts);
  if ($('chkShaftGlint')) $('chkShaftGlint').checked = Boolean(opts.showShaftGlint);
  if ($('chkClubRibbon')) $('chkClubRibbon').checked = Boolean(opts.showClubRibbon);
  if ($('chkHandPath')) $('chkHandPath').checked = Boolean(opts.showHandPath);
  if ($('chkSwingPlane')) $('chkSwingPlane').checked = Boolean(opts.showSwingPlane);
  if ($('chkSkeleton')) $('chkSkeleton').checked = Boolean(opts.showSkeleton);
  if ($('chkAngles')) $('chkAngles').checked = Boolean(opts.showAngles);
}

function syncShotTracerUI() {
  const st = appState.shotTracerOptions;
  if (!st) return;

  const isRealTail = (st.trajectoryMode || 'real-tail') !== 'simulation';
  const carryVal = Number(st.carryMeters || 0);
  const rollVal = Number(st.rollMeters || 0);
  const totalMeters = carryVal + rollVal;
  const apexVal = Number(st.apexMeters || 0);
  const launchVal = Number(st.launchAngleDeg || 13.6);
  const sideVal = Number(st.sideCurveMeters || 0);
  const speedVal = Number(st.ballSpeedMps || 60.4);
  const flightDurVal = Number(st.flightDurationSec || 2.35);

  const trajClass = classifyTrajectoryLabel(launchVal, apexVal);
  const shapeClass = classifyShotShapeLabel(sideVal, st.launchDirectionDeg, st.shotShapeType);
  const mph = Math.round(speedVal * 2.23694);

  if ($('badgeShotTotalReadout')) {
    $('badgeShotTotalReadout').textContent = `최종 ${totalMeters.toFixed(1)} m`;
  }
  if ($('selectTrajectoryMode')) {
    $('selectTrajectoryMode').value = st.trajectoryMode || 'real-tail';
  }

  // 공 궤적 산출 방식(실제 공 궤적 추종 vs 표준 탄도 시뮬레이션)에 따라 하위 항목 유기적 표시/숨김
  const autoBox = $('autoReadoutShotBox');
  const simWrap = $('simulationManualControlsWrap');
  if (autoBox) autoBox.hidden = !isRealTail;
  if (simWrap) simWrap.hidden = false;

  document.querySelectorAll('[data-real-tail-only="true"]').forEach(el => {
    el.hidden = !isRealTail;
  });
  if ($('labelCanvasShotPin')) {
    $('labelCanvasShotPin').textContent = isRealTail
      ? '캔버스 클릭으로 공 위치 미세 보정 (보정 시 높이·거리 자동 재계산)'
      : '캔버스 클릭으로 시뮬레이션 기준점 보정 (출발점·APEX·탄착·런 위치 지정)';
  }

  if ($('readoutAutoStatusBadge')) {
    if (st.autoReadoutSource === 'manual-edited') {
      $('readoutAutoStatusBadge').textContent = '사용자 직접 보정 적용됨';
    } else if (st.autoReadoutSource === 'canvas-calibrated') {
      $('readoutAutoStatusBadge').textContent = '캔버스 궤적 기반 자동 계측';
    } else {
      const fCount = Number(st.detectedFrameCount || st.trackedWaypoints?.length || 4);
      $('readoutAutoStatusBadge').textContent = `연속 ${fCount}프레임 공 추적 완료`;
    }
  }
  if ($('readoutAutoApex')) {
    $('readoutAutoApex').textContent = `${apexVal.toFixed(1)} m`;
  }
  if ($('readoutAutoCarry')) {
    $('readoutAutoCarry').textContent = `${carryVal.toFixed(1)} m`;
  }
  if ($('readoutAutoTotal')) {
    $('readoutAutoTotal').textContent = `${totalMeters.toFixed(1)} m (+${rollVal.toFixed(1)}m)`;
  }
  if ($('readoutAutoLaunch')) {
    $('readoutAutoLaunch').textContent = `${launchVal.toFixed(1)}° (${shapeClass.nameKo})`;
  }
  if ($('readoutAutoChainText')) {
    const p0 = st.originPoint || { x: 0.588, y: 0.819 };
    const wps = (Array.isArray(st.trackedWaypoints) && st.trackedWaypoints.length >= 2)
      ? st.trackedWaypoints
      : [st.midPoint1, st.midPoint2, st.midPoint3, st.midPoint4].filter(Boolean);
    const chainStr = wps
      .slice(0, 4)
      .map((w, idx) => `F+${idx + 1}(${(w.x * 100).toFixed(1)}%, ${(w.y * 100).toFixed(1)}%)`)
      .join(' → ');
    $('readoutAutoChainText').textContent = `프레임별 공 위치 추적: 출발(${(p0.x * 100).toFixed(1)}%, ${(p0.y * 100).toFixed(1)}%) → ${chainStr}`;
  }

  if ($('selectShotShapeType')) {
    $('selectShotShapeType').value = st.shotShapeType || 'auto';
  }
  if ($('selectShotTracerPreset') && st.shotPreset) {
    $('selectShotTracerPreset').value = st.shotPreset;
  }
  if ($('selectTraceStyle')) {
    $('selectTraceStyle').value = st.traceStyle || 'tube';
  }
  if ($('rangeShotLineWidth')) $('rangeShotLineWidth').value = String(st.lineWidth);
  if ($('valShotLineWidth')) $('valShotLineWidth').textContent = `${st.lineWidth}px`;

  // 직접 입력창(Number Input) 및 슬라이더 동기화
  if ($('inputCarryMeters') && document.activeElement !== $('inputCarryMeters')) {
    $('inputCarryMeters').value = carryVal.toFixed(1);
  }
  if ($('inputRollMeters') && document.activeElement !== $('inputRollMeters')) {
    $('inputRollMeters').value = rollVal.toFixed(1);
  }
  if ($('inputTotalMeters') && document.activeElement !== $('inputTotalMeters')) {
    $('inputTotalMeters').value = totalMeters.toFixed(1);
  }
  if ($('inputApexMeters') && document.activeElement !== $('inputApexMeters')) {
    $('inputApexMeters').value = apexVal.toFixed(1);
  }
  if ($('inputLaunchAngle') && document.activeElement !== $('inputLaunchAngle')) {
    $('inputLaunchAngle').value = launchVal.toFixed(1);
  }
  if ($('inputSideCurve') && document.activeElement !== $('inputSideCurve')) {
    $('inputSideCurve').value = sideVal.toFixed(1);
  }

  if ($('rangeApexMeters')) $('rangeApexMeters').value = String(apexVal);
  if ($('valApexMeters')) $('valApexMeters').textContent = `${apexVal.toFixed(1)} m`;

  if ($('rangeCarryMeters')) $('rangeCarryMeters').value = String(carryVal);
  if ($('valCarryMeters')) $('valCarryMeters').textContent = `${carryVal.toFixed(1)} m`;

  if ($('rangeRollMeters')) $('rangeRollMeters').value = String(rollVal);
  if ($('valRollMeters')) {
    $('valRollMeters').textContent = `+${rollVal.toFixed(1)} m (총 ${totalMeters.toFixed(1)} m)`;
  }

  if ($('rangeLaunchAngle')) $('rangeLaunchAngle').value = String(launchVal);
  if ($('valLaunchAngle')) {
    $('valLaunchAngle').textContent = `${launchVal.toFixed(1)}° (${trajClass.labelKo.split(' (')[0]})`;
  }

  if ($('rangeSideCurve')) $('rangeSideCurve').value = String(sideVal);
  if ($('valSideCurve')) $('valSideCurve').textContent = shapeClass.shortKo;

  if ($('rangeBallSpeed')) $('rangeBallSpeed').value = String(speedVal);
  if ($('valBallSpeed')) {
    $('valBallSpeed').textContent = `${speedVal.toFixed(1)} m/s (${mph} mph)`;
  }

  if ($('rangeFlightDuration')) $('rangeFlightDuration').value = String(flightDurVal);
  if ($('valFlightDuration')) {
    $('valFlightDuration').textContent = `${flightDurVal.toFixed(2)}s`;
  }

  if ($('chkShowApexBubble')) $('chkShowApexBubble').checked = Boolean(st.showApexBubble);
  if ($('chkShowLandingMarker')) $('chkShowLandingMarker').checked = Boolean(st.showLandingMarker);
  if ($('chkShowTrajectoryHud')) $('chkShowTrajectoryHud').checked = Boolean(st.showTrajectoryHud);
  if ($('chkShowGroundShadow')) $('chkShowGroundShadow').checked = Boolean(st.showGroundShadow);

  document.querySelectorAll('.color-swatch-btn').forEach(btn => {
    const active = btn.dataset.traceColor === st.traceColor;
    btn.classList.toggle('is-selected', active);
    if (active && $('valTraceColorName') && btn.dataset.colorLabel) {
      $('valTraceColorName').textContent = btn.dataset.colorLabel;
    }
  });

  const store = st.pinnedPointsStore || {};
  const pinObjMap = {
    origin: store.origin?.pinned ? store.origin : st.originPoint,
    mid1: store.mid1?.pinned ? store.mid1 : st.midPoint1,
    mid2: store.mid2?.pinned ? store.mid2 : st.midPoint2,
    mid3: store.mid3?.pinned ? store.mid3 : st.midPoint3,
    apex: store.apex?.pinned ? store.apex : st.apexPoint,
    landing: store.landing?.pinned ? store.landing : st.landingPoint,
    roll: store.roll?.pinned ? store.roll : st.rollEndPoint
  };

  const impMomentForPin = (appState.keyMoments || []).find(m => m.key === 'impact');
  const impTForPin = impMomentForPin ? impMomentForPin.time : (appState.duration * 0.42);
  const summary = getPinnedWorkSummaryForTarget(
    st,
    st.pinTargetMode || st.lastPinnedKey,
    impTForPin,
    appState.fps || 30
  );
  const allPinnedSafe = summary.allPinnedList || summary.userPinnedEntries || [];
  const prevPinSafe = summary.immediatePrevPin || summary.immediatePrevEntry || null;

  document.querySelectorAll('.btn-shot-pin').forEach(btn => {
    const key = btn.dataset.shotPin;
    btn.classList.toggle('is-active', key === st.pinTargetMode);
    if (key === 'frame-ball') {
      btn.classList.toggle('is-pinned-done', allPinnedSafe.length > 0);
      if (btn.dataset.baseLabel) {
        btn.textContent = prevPinSafe
          ? `${btn.dataset.baseLabel} [직전: ${prevPinSafe.shortLabel} F${prevPinSafe.pinnedFrame} · ${(prevPinSafe.x * 100).toFixed(1)}%,${(prevPinSafe.y * 100).toFixed(1)}%]`
          : btn.dataset.baseLabel;
      }
      return;
    }
    const ptObj = pinObjMap[key];
    const isPinned = Boolean(ptObj?.pinned);
    btn.classList.toggle('is-pinned-done', isPinned);
    if (btn.dataset.baseLabel) {
      btn.textContent = (isPinned && ptObj.pinnedFrame)
        ? `${btn.dataset.baseLabel} [F${ptObj.pinnedFrame} · ${(ptObj.x * 100).toFixed(1)}%,${(ptObj.y * 100).toFixed(1)}%]`
        : btn.dataset.baseLabel;
    }
  });

  const curFrame = Math.max(1, Math.round(appState.currentTime * appState.fps) + 1);
  if ($('badgeCurrentPinFrame')) {
    $('badgeCurrentPinFrame').textContent = `현재 멈춘 프레임: F${curFrame} (${appState.currentTime.toFixed(2)}s)`;
  }
  if ($('btnPinPauseToggle')) {
    $('btnPinPauseToggle').textContent = appState.playing ? '영상 멈춤' : '재생/멈춤';
  }

  const quickOriginBtn = $('btnQuickShotPinOrigin');
  if (quickOriginBtn) {
    const isOriginActive = st.pinTargetMode === 'origin';
    quickOriginBtn.setAttribute('aria-pressed', String(isOriginActive));
    quickOriginBtn.textContent = isOriginActive ? '출발점 클릭 대기 중...' : '공 출발점 위치 지정';
  }

  renderShotPinRealtimeStatusPanel(st, summary, curFrame);

  if (appState.studioMode === 'shot-tracer') {
    renderShotFlightStepsStrip();
  }
}

const REALTIME_PIN_STORAGE_KEY = 'golfSwing_realtimePinnedPoints_v1';

/**
 * 프레임 위치 조정 후 공 위치를 지정할 때마다 해당 지점의 프레임 번호·시간·공 좌표(X, Y)를
 * 앱 상태, 탭 워크스페이스, 그리고 브라우저 localStorage에 실시간으로 즉시 저장합니다.
 */
function persistRealtimePinnedPointsState(stOpts = appState.shotTracerOptions) {
  if (!stOpts) return;
  try {
    const videoKey = appState.videoFileSignature || appState.videoFileName || appState.demoPreset || 'default';
    let allSaved = {};
    const raw = localStorage.getItem(REALTIME_PIN_STORAGE_KEY);
    if (raw) {
      allSaved = JSON.parse(raw) || {};
    }
    allSaved[videoKey] = {
      updatedAt: new Date().toISOString(),
      lastPinnedKey: stOpts.lastPinnedKey || null,
      lastPinnedFrame: stOpts.lastPinnedFrame || null,
      lastPinnedTime: stOpts.lastPinnedTime ?? null,
      pinnedPointsStore: { ...(stOpts.pinnedPointsStore || {}) },
      pinnedHistory: Array.isArray(stOpts.pinnedHistory) ? [...stOpts.pinnedHistory] : [],
      originPoint: stOpts.originPoint ? { ...stOpts.originPoint } : null,
      midPoint1: stOpts.midPoint1 ? { ...stOpts.midPoint1 } : null,
      midPoint2: stOpts.midPoint2 ? { ...stOpts.midPoint2 } : null,
      midPoint3: stOpts.midPoint3 ? { ...stOpts.midPoint3 } : null,
      apexPoint: stOpts.apexPoint ? { ...stOpts.apexPoint } : null,
      landingPoint: stOpts.landingPoint ? { ...stOpts.landingPoint } : null,
      rollEndPoint: stOpts.rollEndPoint ? { ...stOpts.rollEndPoint } : null
    };
    localStorage.setItem(REALTIME_PIN_STORAGE_KEY, JSON.stringify(allSaved));
  } catch {
    // 스토리지 제한 예외 무시
  }
  saveModeWorkspaceSnapshot('shot-tracer');
}

/**
 * 각각의 지점 버튼(.btn-shot-pin)을 누르거나 공 위치를 지정했을 때,
 * 직전 작업까지의 지정한 프레임(F## · 0.00s)과 공 위치(X%, Y%)를 #shotPinRealtimeStatusBox에 즉시 표시합니다.
 */
function renderShotPinRealtimeStatusPanel(st, summary, curFrame) {
  const boxEl = $('shotPinRealtimeStatusBox');
  const titleEl = $('shotPinRealtimeTitle');
  const badgeEl = $('shotPinRealtimeSaveBadge');
  const prevCardEl = $('shotPinImmediatePrevCard');
  const chainListEl = $('shotPinChainList');
  if (!boxEl || !prevCardEl || !chainListEl) return;

  const activeTarget = st.pinTargetMode || null;
  const allPinned = summary.allPinnedList || summary.userPinnedEntries || [];
  const upToPins = summary.upToTargetPins || summary.upToPreviousEntries || [];
  const prevPin = summary.immediatePrevPin || summary.immediatePrevEntry || null;
  const targetMeta = summary.targetMeta || summary.targetEntry || null;

  boxEl.classList.toggle('has-active-target', Boolean(activeTarget));

  if (titleEl) {
    titleEl.textContent = activeTarget
      ? `[${targetMeta ? targetMeta.label : '현재 프레임 공 위치 자동 연결'}] 선택됨 — 직전 작업까지의 지정 프레임·위치`
      : '직전 작업까지 지정한 프레임 · 공 위치 현황';
  }

  if (badgeEl) {
    if (allPinned.length > 0) {
      badgeEl.textContent = `실시간 위치 저장됨 (${allPinned.length}개 지점)`;
      badgeEl.classList.add('is-saved');
    } else {
      badgeEl.textContent = '실시간 위치 저장 대기';
      badgeEl.classList.remove('is-saved');
    }
  }

  prevCardEl.replaceChildren();
  prevCardEl.classList.toggle('is-highlighted', Boolean(prevPin || targetMeta));

  if (targetMeta) {
    const targetRow = document.createElement('div');
    targetRow.className = 'shot-pin-prev-main';

    const targetLabelSpan = document.createElement('span');
    targetLabelSpan.className = 'shot-pin-prev-label';
    const stateTag = targetMeta.hasExplicitTime
      ? '[선택 지점 · 지정 시점 이동됨] '
      : (targetMeta.pinned ? '[선택 지점 · 기준 시점 이동됨] ' : '[선택 지점 · 예상 시점 이동됨] ');
    targetLabelSpan.textContent = `${stateTag}${targetMeta.label} — F${targetMeta.pinnedFrame} (${Number(targetMeta.pinnedTime || 0).toFixed(2)}s) · X ${(targetMeta.x * 100).toFixed(1)}%, Y ${(targetMeta.y * 100).toFixed(1)}%`;
    targetRow.appendChild(targetLabelSpan);

    if (Number.isFinite(targetMeta.pinnedTime)) {
      const syncTargetBtn = document.createElement('button');
      syncTargetBtn.type = 'button';
      syncTargetBtn.className = 'btn-jump-prev-frame';
      syncTargetBtn.textContent = `선택 지점 프레임(F${targetMeta.pinnedFrame}) 이동`;
      syncTargetBtn.title = `선택한 [${targetMeta.label}]의 시점 F${targetMeta.pinnedFrame} (${Number(targetMeta.pinnedTime).toFixed(2)}s)로 영상 타임라인을 즉시 이동합니다`;
      syncTargetBtn.onclick = () => {
        stopPlayback();
        void seekToTime(Number(targetMeta.pinnedTime));
        setStatusMessage(
          `[${targetMeta.label}] 시점 F${targetMeta.pinnedFrame} (${Number(targetMeta.pinnedTime).toFixed(2)}s) · 위치 (X ${(targetMeta.x * 100).toFixed(1)}%, Y ${(targetMeta.y * 100).toFixed(1)}%)로 타임라인을 이동했습니다.`
        );
      };
      targetRow.appendChild(syncTargetBtn);
    }
    prevCardEl.appendChild(targetRow);
  }

  if (prevPin) {
    const mainRow = document.createElement('div');
    mainRow.className = 'shot-pin-prev-main';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'shot-pin-prev-label';
    const relationPrefix = activeTarget
      ? `[${targetMeta ? targetMeta.shortLabel : '자동연결'}의 직전 작업 지점] `
      : '[가장 최근 지정 지점] ';
    labelSpan.textContent = `${relationPrefix}${prevPin.label}`;
    mainRow.appendChild(labelSpan);

    if (Number.isFinite(prevPin.pinnedTime)) {
      const jumpBtn = document.createElement('button');
      jumpBtn.type = 'button';
      jumpBtn.className = 'btn-jump-prev-frame';
      jumpBtn.textContent = `직전 지정 프레임(F${prevPin.pinnedFrame}) 보기`;
      jumpBtn.title = `직전 작업에서 지정한 프레임 F${prevPin.pinnedFrame} (${Number(prevPin.pinnedTime).toFixed(2)}s)로 이동하여 공 위치를 확인합니다`;
      jumpBtn.onclick = () => {
        stopPlayback();
        void seekToTime(Number(prevPin.pinnedTime));
        setStatusMessage(
          `직전 작업 지점 [${prevPin.label}]을 지정했던 프레임 F${prevPin.pinnedFrame} (${Number(prevPin.pinnedTime).toFixed(2)}s) · 위치 (X ${(prevPin.x * 100).toFixed(1)}%, Y ${(prevPin.y * 100).toFixed(1)}%)를 표시합니다.`
        );
      };
      mainRow.appendChild(jumpBtn);
    }

    const metricsRow = document.createElement('div');
    metricsRow.className = 'shot-pin-prev-metrics';

    const framePill = document.createElement('span');
    framePill.className = 'shot-pin-metric-pill';
    framePill.textContent = `직전 프레임: F${prevPin.pinnedFrame} (${Number(prevPin.pinnedTime || 0).toFixed(2)}s)`;

    const posPill = document.createElement('span');
    posPill.className = 'shot-pin-metric-pill';
    posPill.textContent = `직전 위치: X ${(prevPin.x * 100).toFixed(1)}%, Y ${(prevPin.y * 100).toFixed(1)}%`;

    const curDiffPill = document.createElement('span');
    curDiffPill.className = 'shot-pin-metric-pill';
    const frameDelta = curFrame - Number(prevPin.pinnedFrame || curFrame);
    const deltaSign = frameDelta > 0 ? `+${frameDelta}` : String(frameDelta);
    curDiffPill.textContent = `현재 멈춘 프레임: F${curFrame} (${appState.currentTime.toFixed(2)}s · 직전 대비 ${deltaSign}프레임)`;

    metricsRow.append(framePill, posPill, curDiffPill);
    prevCardEl.append(mainRow, metricsRow);
  } else if (!targetMeta) {
    const emptySpan = document.createElement('span');
    emptySpan.className = 'shot-pin-prev-empty';
    emptySpan.textContent = activeTarget
      ? `현재 [${targetMeta ? targetMeta.label : '공 위치 자동 연결'}] 버튼이 선택되었습니다. 아직 직전 작업으로 지정된 지점이 없으므로 현재 멈춘 프레임(F${curFrame} · ${appState.currentTime.toFixed(2)}s)에서 화면 위 공을 클릭해 첫 위치를 지정하세요.`
      : '프레임을 조정한 뒤 각 지점 버튼을 누르고 공 위치를 클릭하면 해당 프레임과 좌표가 실시간 저장되며, 각 지점 버튼을 누를 때마다 해당 시점으로 타임라인이 이동하고 직전 작업까지의 위치를 함께 보여줍니다.';
    prevCardEl.appendChild(emptySpan);
  }

  chainListEl.replaceChildren();
  const chipItems = activeTarget
    ? (upToPins.length > 0 ? upToPins : allPinned)
    : allPinned;

  for (const item of chipItems) {
    const chip = document.createElement('button');
    chip.type = 'button';
    const isPrevFocus = Boolean(prevPin && item.key === prevPin.key);
    const isCurrentTarget = Boolean(activeTarget && item.key === activeTarget);
    chip.className = `shot-pin-chain-chip${isPrevFocus ? ' is-prev-focus' : ''}${isCurrentTarget ? ' is-current-target' : ''}`;
    const tagPrefix = isCurrentTarget
      ? '[선택됨] '
      : (isPrevFocus ? '[직전] ' : (item.pinned ? '[지정됨] ' : '[기준] '));
    chip.textContent = `${tagPrefix}${item.shortLabel}: F${item.pinnedFrame}(${Number(item.pinnedTime || 0).toFixed(2)}s) · X ${(item.x * 100).toFixed(1)}%, Y ${(item.y * 100).toFixed(1)}%`;
    chip.title = `클릭 시 [${item.label}] 지점 선택 및 프레임 F${item.pinnedFrame} (${Number(item.pinnedTime || 0).toFixed(2)}s)로 타임라인 이동`;
    chip.onclick = () => {
      if (Number.isFinite(item.pinnedTime)) {
        stopPlayback();
        appState.shotTracerOptions.pinTargetMode = item.key;
        $('stageCanvas').style.cursor = 'crosshair';
        void seekToTime(Number(item.pinnedTime));
        setStatusMessage(
          `[${item.label}] 선택 및 프레임 F${item.pinnedFrame} (${Number(item.pinnedTime).toFixed(2)}s) · 위치 (X ${(item.x * 100).toFixed(1)}%, Y ${(item.y * 100).toFixed(1)}%)로 타임라인을 이동했습니다.`
        );
      }
    };
    chainListEl.appendChild(chip);
  }
}

function setTopMenuOpen(isOpen) {
  const open = Boolean(isOpen);
  const toggleBtn = $('btnTopMenuToggle');
  const panel = $('topMenuDropdownPanel');
  const backdrop = $('topMenuBackdrop');
  const sectionsWrap = $('topMenuSectionsWrap') || panel?.querySelector('.top-menu-sections-wrap');
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', String(open));
  }
  if (panel) {
    panel.hidden = !open;
  }
  if (backdrop) {
    backdrop.hidden = !open;
  }
  document.documentElement.classList.toggle('is-top-menu-open', open);
  document.body.classList.toggle('is-top-menu-open', open);
  if (open && sectionsWrap) {
    requestAnimationFrame(() => {
      try {
        sectionsWrap.focus({ preventScroll: true });
      } catch {
        // 포커스 옵션 미지원 브라우저 무시
      }
    });
  }
}

function syncModeVisibilityUI() {
  const isShot = appState.studioMode === 'shot-tracer';

  const btnAfter = $('btnModeAfterimage');
  const btnShot = $('btnModeShotTracer');
  if (btnAfter) {
    btnAfter.classList.toggle('is-active', !isShot);
    btnAfter.setAttribute('aria-selected', String(!isShot));
  }
  if (btnShot) {
    btnShot.classList.toggle('is-active', isShot);
    btnShot.setAttribute('aria-selected', String(isShot));
  }

  const quickAfter = $('btnQuickModeAfterimage');
  const quickShot = $('btnQuickModeShotTracer');
  if (quickAfter) {
    quickAfter.classList.toggle('is-active', !isShot);
    quickAfter.setAttribute('aria-pressed', String(!isShot));
  }
  if (quickShot) {
    quickShot.classList.toggle('is-active', isShot);
    quickShot.setAttribute('aria-pressed', String(isShot));
  }

  const stateBadgeAfter = $('stateBadgeModeAfterimage');
  const stateBadgeShot = $('stateBadgeModeShotTracer');
  if (stateBadgeAfter) {
    stateBadgeAfter.textContent = !isShot ? '현재 화면' : '화면 이동';
  }
  if (stateBadgeShot) {
    stateBadgeShot.textContent = isShot ? '현재 화면' : '화면 이동';
  }

  const topModePill = $('btnTopCurrentMode');
  const topModeText = $('topCurrentModeText');
  if (topModePill) {
    topModePill.classList.toggle('is-shot-mode', isShot);
  }
  if (topModeText) {
    topModeText.textContent = isShot ? '후방 공 궤적 트레이서' : '스윙 클럽 잔상 분석';
  }

  // 선택한 영상분석 탭(afterimage vs shot-tracer)에 해당하는 UI 섹션·버튼·셀렉트 옵션만 유기적으로 표시하고 나머지는 숨김 처리
  document.querySelectorAll('[data-mode-only]').forEach(el => {
    const target = el.getAttribute('data-mode-only');
    const shouldShow = (isShot && target === 'shot-tracer') || (!isShot && target === 'afterimage');
    el.hidden = !shouldShow;
    if (el.tagName === 'OPTION') {
      el.disabled = !shouldShow;
    }
  });

  // 상단 액션 버튼 문구도 현재 분석 탭에 맞게 유기적으로 변경
  const btnStrobeSnap = $('btnExportStrobeSnapshot');
  if (btnStrobeSnap) {
    btnStrobeSnap.textContent = isShot ? '공 궤적 스냅샷 (PNG)' : '클럽 잔상 스냅샷 (PNG)';
  }
  const btnVideoExport = $('btnExportAfterimageVideo');
  if (btnVideoExport && !appState.busy) {
    btnVideoExport.textContent = isShot ? '공 궤적 동영상 다운로드' : '클럽 잔상 동영상 다운로드';
  }
  const btnQuickVideoOut = $('btnQuickExportVideoOutside');
  if (btnQuickVideoOut && !appState.busy) {
    btnQuickVideoOut.textContent = isShot ? '공 궤적 영상 저장' : '동영상 저장';
  }

  // 데모 모드일 때 상단 프리셋 셀렉트 박스 값도 현재 탭에 맞는 항목으로 동기화
  const demoSel = $('selectDemoPreset');
  if (demoSel && appState.sourceMode === 'demo') {
    if (isShot) {
      demoSel.value = 'shot-tracer-dtl';
    } else if (demoSel.value === 'shot-tracer-dtl') {
      demoSel.value = appState.demoPreset === 'iron-dtl' ? 'iron-dtl' : 'driver-fo';
    }
  }

  // CLIP 구간 프리셋 셀렉트 박스에서 숨겨진 반대 탭 옵션이 선택되어 있으면 현재 탭 기본값으로 자동 전환
  const clipPresetSel = $('selectClipPreset');
  if (clipPresetSel) {
    const selectedOpt = clipPresetSel.options[clipPresetSel.selectedIndex];
    if (selectedOpt && selectedOpt.hidden) {
      applyClipPreset('all');
    }
  }
}

function getVideoFileSignature(file) {
  if (!file) return null;
  return `${file.name || 'video'}__${file.size || 0}__${file.lastModified || 0}`;
}

function formatModeFileDisplayLabel(mode, fileName, sourceMode, width, height, autoViewInfo = null) {
  const cleanName = String(fileName || '').replace(/^\[[^\]]+\]\s*/, '');
  if (sourceMode === 'video') {
    const viewInfo = autoViewInfo || appState?.autoDetectedViewInfo || null;
    const prefix = viewInfo
      ? (mode === 'shot-tracer' ? '[자동판독: 후면 → 공 궤적]' : '[자동판독: 측면 → 클럽 잔상]')
      : (mode === 'shot-tracer' ? '[공 궤적 전용 영상]' : '[클럽 잔상 전용 영상]');
    return `${prefix} ${cleanName} (${width || 1280}×${height || 720})`;
  }
  const demoPrefix = mode === 'shot-tracer' ? '[공 궤적 전용 영상]' : '[클럽 잔상 전용 영상]';
  return `${demoPrefix} ${cleanName}`;
}

function buildDefaultModeWorkspace(mode, hand = 'right') {
  const isShot = mode === 'shot-tracer';
  const effectivePreset = isShot ? 'iron-dtl' : 'driver-fo';
  const demoPresetVal = isShot ? 'shot-tracer-dtl' : 'driver-fo';
  const dataset = buildDemoSwingDataset(effectivePreset, 60, 3.2, hand);
  const canvasWidth = 1280;
  const canvasHeight = 720;

  const addrMoment = dataset.keyMoments.find(m => m.key === 'address');
  const addrSample = findNearestSample(dataset.samples, addrMoment ? addrMoment.time : 0.45) || dataset.samples[0];
  const addressClub = createAddressClubTemplate(
    addrSample,
    canvasWidth,
    canvasHeight,
    {
      clubType: isShot ? 'iron' : 'driver',
      hand
    }
  );

  const shotTracerOptions = createDefaultShotTracerState(isShot);
  const finishMoment = dataset.keyMoments.find(m => m.key === 'finish');
  const impMoment = dataset.keyMoments.find(m => m.key === 'impact');
  const impT = impMoment ? impMoment.time : (dataset.duration * 0.42);
  const flightSpan = Number(shotTracerOptions.flightDurationSec || 2.35) + Number(shotTracerOptions.rollDurationSec || 0.62);

  const initialTime = isShot
    ? clamp(impT + flightSpan + 0.12, 0.5, Math.max(0.5, dataset.duration - 0.08))
    : (finishMoment ? finishMoment.time : 2.62);

  const rawFileName = isShot
    ? '내장 후방(DTL) 공 궤적 시뮬레이션 (Driver 212m · 60fps)'
    : '내장 프로 스윙 시뮬레이션 (Driver 정면 뷰 60fps)';

  return {
    studioMode: isShot ? 'shot-tracer' : 'afterimage',
    sourceMode: 'demo',
    demoPreset: demoPresetVal,
    videoReady: false,
    videoFileName: rawFileName,
    uploadedVideoFile: null,
    videoObjectUrl: null,
    videoFileSignature: null,
    autoDetectedViewInfo: null,
    activeArchiveId: null,
    activeArchiveTitle: '',
    hand,
    fps: dataset.fps,
    duration: dataset.duration,
    currentTime: initialTime,
    clipStartTime: 0,
    clipEndTime: dataset.duration,
    clipPreset: 'all',
    playbackSpeed: 0.5,
    exportSpeedFactor: 0.5,
    canvasWidth,
    canvasHeight,
    viewportZoom: 1.0,
    samples: dataset.samples,
    keyMoments: dataset.keyMoments,
    addressClub,
    selectedPhaseKey: 'finish',
    renderOptions: { ...DEFAULT_RENDER_OPTIONS },
    stabilizationOptions: createDefaultStabilizationState(),
    shotTracerOptions
  };
}

function saveModeWorkspaceSnapshot(mode = appState.studioMode) {
  if (!mode) return;
  if (!appState.modeWorkspaces) {
    appState.modeWorkspaces = { afterimage: null, 'shot-tracer': null };
  }
  appState.modeWorkspaces[mode] = {
    studioMode: mode,
    sourceMode: appState.sourceMode,
    demoPreset: appState.demoPreset,
    videoReady: Boolean(appState.videoReady),
    videoFileName: appState.videoFileName,
    uploadedVideoFile: appState.uploadedVideoFile || null,
    videoObjectUrl: appState.videoObjectUrl || null,
    videoFileSignature: appState.videoFileSignature || null,
    autoDetectedViewInfo: appState.autoDetectedViewInfo ? { ...appState.autoDetectedViewInfo } : null,
    activeArchiveId: appState.activeArchiveId || null,
    activeArchiveTitle: appState.activeArchiveTitle || '',
    hand: appState.hand || 'right',
    fps: appState.fps || 60,
    duration: appState.duration || 3.2,
    currentTime: appState.currentTime ?? 1.78,
    clipStartTime: appState.clipStartTime ?? 0,
    clipEndTime: appState.clipEndTime ?? (appState.duration || 3.2),
    clipPreset: appState.clipPreset || 'all',
    playbackSpeed: appState.playbackSpeed ?? 0.5,
    exportSpeedFactor: appState.exportSpeedFactor ?? 0.5,
    canvasWidth: appState.canvasWidth || 1280,
    canvasHeight: appState.canvasHeight || 720,
    viewportZoom: appState.viewportZoom || 1.0,
    samples: appState.samples || [],
    keyMoments: appState.keyMoments || [],
    addressClub: appState.addressClub || null,
    selectedPhaseKey: appState.selectedPhaseKey || 'finish',
    renderOptions: { ...appState.renderOptions },
    stabilizationOptions: {
      ...appState.stabilizationOptions,
      groundPinMode: false,
      groundAnchorPoint: { ...(appState.stabilizationOptions?.groundAnchorPoint || DEFAULT_STABILIZATION_OPTIONS.groundAnchorPoint) },
      golferAnchorPoint: { ...(appState.stabilizationOptions?.golferAnchorPoint || DEFAULT_STABILIZATION_OPTIONS.golferAnchorPoint) },
      customKeyframes: Array.isArray(appState.stabilizationOptions?.customKeyframes)
        ? appState.stabilizationOptions.customKeyframes.map(k => ({ ...k }))
        : []
    },
    shotTracerOptions: {
      ...appState.shotTracerOptions,
      enabled: mode === 'shot-tracer',
      pinTargetMode: null,
      hoverNormPoint: null,
      pinnedPointsStore: { ...(appState.shotTracerOptions?.pinnedPointsStore || {}) },
      pinnedHistory: Array.isArray(appState.shotTracerOptions?.pinnedHistory)
        ? appState.shotTracerOptions.pinnedHistory.map(h => ({ ...h }))
        : [],
      originPoint: { ...(appState.shotTracerOptions?.originPoint || DEFAULT_SHOT_TRACER_OPTIONS.originPoint) },
      midPoint1: { ...(appState.shotTracerOptions?.midPoint1 || DEFAULT_SHOT_TRACER_OPTIONS.midPoint1) },
      midPoint2: { ...(appState.shotTracerOptions?.midPoint2 || DEFAULT_SHOT_TRACER_OPTIONS.midPoint2) },
      midPoint3: { ...(appState.shotTracerOptions?.midPoint3 || DEFAULT_SHOT_TRACER_OPTIONS.midPoint3) },
      midPoint4: { ...(appState.shotTracerOptions?.midPoint4 || DEFAULT_SHOT_TRACER_OPTIONS.midPoint4) },
      trackedWaypoints: Array.isArray(appState.shotTracerOptions?.trackedWaypoints)
        ? appState.shotTracerOptions.trackedWaypoints.map(w => ({ ...w }))
        : [],
      apexPoint: { ...(appState.shotTracerOptions?.apexPoint || DEFAULT_SHOT_TRACER_OPTIONS.apexPoint) },
      landingPoint: { ...(appState.shotTracerOptions?.landingPoint || DEFAULT_SHOT_TRACER_OPTIONS.landingPoint) },
      rollEndPoint: { ...(appState.shotTracerOptions?.rollEndPoint || DEFAULT_SHOT_TRACER_OPTIONS.rollEndPoint) }
    }
  };
}

async function restoreModeWorkspace(targetMode) {
  const mode = targetMode === 'shot-tracer' ? 'shot-tracer' : 'afterimage';
  if (!appState.modeWorkspaces?.[mode]) {
    appState.modeWorkspaces[mode] = buildDefaultModeWorkspace(mode, appState.hand || 'right');
  }
  const ws = appState.modeWorkspaces[mode];

  appState.studioMode = mode;
  appState.sourceMode = ws.sourceMode || 'demo';
  appState.demoPreset = ws.demoPreset || (mode === 'shot-tracer' ? 'shot-tracer-dtl' : 'driver-fo');
  appState.videoReady = Boolean(ws.sourceMode === 'video' && ws.videoObjectUrl);
  appState.videoFileName = ws.videoFileName;
  appState.uploadedVideoFile = ws.uploadedVideoFile || null;
  appState.videoObjectUrl = ws.videoObjectUrl || null;
  appState.videoFileSignature = ws.videoFileSignature || null;
  appState.autoDetectedViewInfo = ws.autoDetectedViewInfo ? { ...ws.autoDetectedViewInfo } : null;
  appState.activeArchiveId = ws.activeArchiveId || null;
  appState.activeArchiveTitle = ws.activeArchiveTitle || '';
  appState.hand = ws.hand || 'right';
  appState.fps = ws.fps || 60;
  appState.duration = ws.duration || 3.2;
  appState.currentTime = clamp(Number(ws.currentTime ?? 1.78), 0, appState.duration);
  appState.clipStartTime = ws.clipStartTime ?? 0;
  appState.clipEndTime = ws.clipEndTime ?? appState.duration;
  appState.clipPreset = ws.clipPreset || 'all';
  appState.playbackSpeed = ws.playbackSpeed ?? 0.5;
  appState.exportSpeedFactor = ws.exportSpeedFactor ?? 0.5;
  appState.canvasWidth = ws.canvasWidth || 1280;
  appState.canvasHeight = ws.canvasHeight || 720;
  appState.samples = ws.samples || [];
  appState.keyMoments = ws.keyMoments || [];
  appState.addressClub = ws.addressClub || null;
  appState.selectedPhaseKey = ws.selectedPhaseKey || 'finish';
  appState.renderOptions = { ...DEFAULT_RENDER_OPTIONS, ...(ws.renderOptions || {}) };
  appState.stabilizationOptions = {
    ...createDefaultStabilizationState(),
    ...(ws.stabilizationOptions || {}),
    groundPinMode: false
  };
  appState.shotTracerOptions = {
    ...createDefaultShotTracerState(mode === 'shot-tracer'),
    ...(ws.shotTracerOptions || {}),
    enabled: mode === 'shot-tracer',
    pinTargetMode: null
  };
  appState.manualPinMode = false;

  const fileInputEl = $('videoFileInput');
  if (fileInputEl) {
    fileInputEl.value = '';
  }

  const mainCanvas = $('stageCanvas');
  if (mainCanvas) {
    mainCanvas.width = appState.canvasWidth;
    mainCanvas.height = appState.canvasHeight;
    mainCanvas.style.cursor = 'default';
  }
  const studioLayoutEl = $('studioLayout');
  if (studioLayoutEl) {
    studioLayoutEl.classList.toggle('is-portrait-video', appState.canvasHeight > appState.canvasWidth);
  }
  if ($('btnToggleManualPin')) {
    $('btnToggleManualPin').setAttribute('aria-pressed', 'false');
    $('btnToggleManualPin').textContent = '헤드 위치 수동 보정';
  }
  if ($('selectHandedness')) {
    $('selectHandedness').value = appState.hand;
  }

  // 해당 탭 전용 비디오 엘리먼트 소스 전환 (탭마다 서로 다른 별개의 동영상 디코더 상태 유지)
  const video = appState.videoElement;
  if (video) {
    if (appState.sourceMode === 'video' && appState.videoObjectUrl) {
      if (video.src !== appState.videoObjectUrl) {
        await new Promise(resolve => {
          const onDone = () => {
            video.removeEventListener('loadedmetadata', onDone);
            video.removeEventListener('error', onDone);
            resolve();
          };
          video.addEventListener('loadedmetadata', onDone);
          video.addEventListener('error', onDone);
          video.src = appState.videoObjectUrl;
          video.load();
        });
      }
      appState.videoReady = true;
      await seekVideoSafely(video, appState.currentTime);
    } else {
      try {
        video.pause();
      } catch {
        // 일시정지 예외 무시
      }
      appState.videoReady = false;
    }
  }

  if ($('activeFileLabel')) {
    $('activeFileLabel').textContent = formatModeFileDisplayLabel(
      mode,
      appState.videoFileName,
      appState.sourceMode,
      appState.canvasWidth,
      appState.canvasHeight,
      appState.autoDetectedViewInfo
    );
  }
  if ($('timelineRange')) {
    $('timelineRange').max = String(appState.duration);
    $('timelineRange').value = String(appState.currentTime);
  }

  setViewportZoom(ws.viewportZoom || 1.0);
  syncModeVisibilityUI();
  syncRenderOptionsUI();
  syncShotTracerUI();
  syncStabilizationUI();
  syncClipRangeUI(true);
  syncActiveArchiveBannerUI();

  renderMainStage();
  if (mode === 'shot-tracer') {
    renderShotFlightStepsStrip();
  } else {
    await renderPhaseFilmstrip();
    updateMetricsAndCoachingUI();
  }
}

function switchStudioMode(targetMode) {
  stopPlayback();
  const nextMode = targetMode === 'shot-tracer' ? 'shot-tracer' : 'afterimage';
  const prevMode = appState.studioMode;

  // 현재 탭의 동영상·궤적·구간 편집 상태를 해당 탭 전용 워크스페이스에 보존
  if (prevMode) {
    saveModeWorkspaceSnapshot(prevMode);
  }

  const isShot = nextMode === 'shot-tracer';
  void runWithBusyOverlay(
    {
      title: isShot
        ? '후방 공 궤적 전용 동영상 세션으로 전환 및 화면 갱신 중...'
        : '스윙 클럽 잔상 분석 전용 동영상 세션으로 전환 및 화면 갱신 중...',
      stepText: '탭별 독립 동영상 디코더 및 궤적 워크스페이스 전환 중',
      thresholdMs: 380
    },
    async () => {
      await restoreModeWorkspace(nextMode);
      const modeDesc = isShot
        ? `후방 공 궤적 샷 트레이서 전용 동영상 세션으로 전환했습니다 (${appState.videoFileName}). 클럽 잔상 탭의 동영상과 완전히 분리되어 독립 작업됩니다.`
        : `스윙 클럽 잔상 분석 전용 동영상 세션으로 전환했습니다 (${appState.videoFileName}). 공 궤적 탭의 동영상과 완전히 분리되어 독립 작업됩니다.`;
      setStatusMessage(modeDesc);
    }
  );
}

function applyShotTracerPreset(presetKey) {
  const preset = SHOT_TRACER_PRESETS[presetKey];
  if (!preset) return;
  const keepRealPoints = appState.sourceMode === 'video' && (appState.shotTracerOptions.trajectoryMode || 'real-tail') !== 'simulation';
  appState.shotTracerOptions = syncShotGeometryFromMetrics({
    ...appState.shotTracerOptions,
    shotPreset: presetKey,
    shotShapeType: preset.shotShapeType || appState.shotTracerOptions.shotShapeType || 'auto',
    carryMeters: preset.carryMeters,
    rollMeters: preset.rollMeters,
    apexMeters: preset.apexMeters,
    launchAngleDeg: preset.launchAngleDeg,
    launchDirectionDeg: preset.launchDirectionDeg ?? 0,
    ballSpeedMps: preset.ballSpeedMps,
    backspinRpm: preset.backspinRpm,
    sideCurveMeters: preset.sideCurveMeters,
    flightDurationSec: preset.flightDurationSec,
    rollDurationSec: preset.rollDurationSec,
    autoReadoutSource: 'manual-edited',
    manualApexPinned: false,
    manualLandingPinned: false,
    originPoint: keepRealPoints ? appState.shotTracerOptions.originPoint : { ...preset.originPoint },
    apexPoint: { ...preset.apexPoint },
    landingPoint: { ...preset.landingPoint },
    rollEndPoint: { ...preset.rollEndPoint }
  });
  syncShotTracerUI();
  renderMainStage();
  if (appState.studioMode === 'shot-tracer') {
    renderShotFlightStepsStrip();
  } else {
    void renderPhaseFilmstrip();
  }
}

function syncViewportZoomUI() {
  const z = Number(appState.viewportZoom || 1);
  const pct = Math.round(z * 100);
  if ($('zoomReadoutBadge')) {
    $('zoomReadoutBadge').textContent = `${pct}%`;
  }
  if ($('rangeViewportZoom') && document.activeElement !== $('rangeViewportZoom')) {
    $('rangeViewportZoom').value = String(z);
  }
  document.querySelectorAll('.btn-zoom-preset').forEach(btn => {
    const presetVal = Number(btn.dataset.zoomPreset || 1);
    btn.classList.toggle('is-active', Math.abs(z - presetVal) < 0.04);
  });
  if ($('zoomCursorHint')) {
    const hx = Math.round((appState.lastHoverNormX ?? 0.5) * 100);
    const hy = Math.round((appState.lastHoverNormY ?? 0.5) * 100);
    $('zoomCursorHint').textContent = z > 1.01
      ? `기준점(${hx}%, ${hy}%) ${pct}% 확대 중 · 좌우·상하 스크롤바 또는 드래그로 이동 후 공 위치 클릭`
      : '마우스 휠: 커서 위치 기준 확대/축소 · 확대 시 좌우·상하 스크롤 생성';
  }
}

function setViewportZoom(rawZoom, anchorClientX = null, anchorClientY = null) {
  const scrollEl = $('stageZoomScroll');
  const contentEl = $('stageZoomContent');
  const canvasEl = $('stageCanvas');
  if (!scrollEl || !contentEl || !canvasEl) return;

  const nextZoom = clamp(Math.round(Number(rawZoom || 1) * 20) / 20, 1.0, 5.0);
  const scrollRect = scrollEl.getBoundingClientRect();
  const canvasRectBefore = canvasEl.getBoundingClientRect();

  // 확대 기준점(u, v) 및 뷰포트 내 마우스 상대 좌표(Mx, My) 산출
  let u = Number.isFinite(appState.lastHoverNormX) ? appState.lastHoverNormX : 0.5;
  let v = Number.isFinite(appState.lastHoverNormY) ? appState.lastHoverNormY : 0.5;
  let Mx = scrollRect.width * 0.5;
  let My = scrollRect.height * 0.5;

  if (Number.isFinite(anchorClientX) && Number.isFinite(anchorClientY)) {
    u = clamp((anchorClientX - canvasRectBefore.left) / Math.max(1, canvasRectBefore.width), 0, 1);
    v = clamp((anchorClientY - canvasRectBefore.top) / Math.max(1, canvasRectBefore.height), 0, 1);
    Mx = clamp(anchorClientX - scrollRect.left, 0, scrollRect.width);
    My = clamp(anchorClientY - scrollRect.top, 0, scrollRect.height);
    appState.lastHoverNormX = u;
    appState.lastHoverNormY = v;
  } else if (canvasRectBefore.width > 0 && canvasRectBefore.height > 0) {
    const ptClientX = canvasRectBefore.left + u * canvasRectBefore.width;
    const ptClientY = canvasRectBefore.top + v * canvasRectBefore.height;
    if (
      ptClientX >= scrollRect.left &&
      ptClientX <= scrollRect.right &&
      ptClientY >= scrollRect.top &&
      ptClientY <= scrollRect.bottom
    ) {
      Mx = ptClientX - scrollRect.left;
      My = ptClientY - scrollRect.top;
    }
  }

  // 현재 고정된 패널 크기(#stageZoomScroll) 안에서 100% 기준 캔버스 표시 크기(baseW, baseH) 산출
  const isFs = isStageFullscreenActive();
  const pad = isFs ? 0 : 4;
  const availW = Math.max(80, (scrollEl.clientWidth || 320) - pad);
  const availH = Math.max(80, (scrollEl.clientHeight || 280) - pad);
  const aspect = Math.max(1, canvasEl.width || 1280) / Math.max(1, canvasEl.height || 720);
  let baseW = availW;
  let baseH = baseW / aspect;
  if (baseH > availH) {
    baseH = availH;
    baseW = baseH * aspect;
  }

  appState.viewportZoom = nextZoom;

  if (nextZoom <= 1.001) {
    canvasEl.classList.remove('is-zoomed');
    scrollEl.classList.remove('is-zoomed-scroll');
    // 100% 기본 화면에서는 가로·세로 어느 쪽도 잘리거나 스크롤이 생기지 않고 영상 전체가 한눈에 들어오도록 크기 고정
    canvasEl.style.width = `${Math.max(1, Math.floor(baseW))}px`;
    canvasEl.style.height = `${Math.max(1, Math.floor(baseH))}px`;
    contentEl.style.width = '100%';
    contentEl.style.height = '100%';
    scrollEl.scrollLeft = 0;
    scrollEl.scrollTop = 0;
  } else {
    const zoomedW = Math.round(baseW * nextZoom);
    const zoomedH = Math.round(baseH * nextZoom);
    canvasEl.classList.add('is-zoomed');
    scrollEl.classList.add('is-zoomed-scroll');
    canvasEl.style.width = `${zoomedW}px`;
    canvasEl.style.height = `${zoomedH}px`;
    contentEl.style.width = `${Math.max(scrollEl.clientWidth, zoomedW + 8)}px`;
    contentEl.style.height = `${Math.max(scrollEl.clientHeight, zoomedH + 8)}px`;

    // 마우스가 있던 영상 좌표(u, v)가 확대 후에도 정확히 마우스 커서 위치(Mx, My)에 오도록 좌우·상하 스크롤 위치 조정
    const cOffsetLeft = canvasEl.offsetLeft;
    const cOffsetTop = canvasEl.offsetTop;
    scrollEl.scrollLeft = Math.max(0, Math.round(cOffsetLeft + u * zoomedW - Mx));
    scrollEl.scrollTop = Math.max(0, Math.round(cOffsetTop + v * zoomedH - My));
  }

  const isPinning = Boolean(
    appState.manualPinMode ||
    appState.stabilizationOptions?.groundPinMode ||
    (appState.studioMode === 'shot-tracer' && appState.shotTracerOptions?.pinTargetMode)
  );
  canvasEl.style.cursor = isPinning ? 'crosshair' : (nextZoom > 1.001 ? 'grab' : 'default');
  syncViewportZoomUI();
}

function isStageFullscreenActive() {
  const vp = $('stageViewport');
  if (!vp) return false;
  return Boolean(vp.classList.contains('is-stage-fullscreen') || document.fullscreenElement === vp);
}

function syncStageFullscreenUI() {
  const active = isStageFullscreenActive();
  const topBar = $('stageFullscreenTopBar');
  const bottomBar = $('stageFullscreenBottomBar');
  if (topBar) topBar.hidden = !active;
  if (bottomBar) bottomBar.hidden = !active;

  if ($('fsStageTitleLabel')) {
    const modeLabel = appState.studioMode === 'shot-tracer' ? '후방 공 궤적' : '클럽 잔상 분석';
    const cleanFile = String(appState.videoFileName || '스윙 영상').replace(/^\[[^\]]+\]\s*/, '');
    $('fsStageTitleLabel').textContent = `전체화면 재생 · [${modeLabel}] ${cleanFile}`;
  }
  if ($('selectFsPlaybackSpeed')) {
    $('selectFsPlaybackSpeed').value = String(appState.playbackSpeed || 0.5);
  }
  if ($('fsTimelineRange')) {
    $('fsTimelineRange').max = String(appState.duration || 3.2);
    $('fsTimelineRange').value = String(appState.currentTime || 0);
  }
  if ($('fsTimeReadout')) {
    const curFrame = Math.max(1, Math.round((appState.currentTime || 0) * (appState.fps || 30)) + 1);
    const totalFrames = Math.max(1, Math.round((appState.duration || 3.2) * (appState.fps || 30)));
    $('fsTimeReadout').textContent = `${(appState.currentTime || 0).toFixed(2)}s / ${(appState.duration || 3.2).toFixed(2)}s (F${curFrame}/${totalFrames})`;
  }
  if ($('btnFsPlayPause')) {
    $('btnFsPlayPause').textContent = appState.playing ? '일시정지' : '재생';
    $('btnFsPlayPause').setAttribute('aria-pressed', String(Boolean(appState.playing)));
  }
}

function enterStageFullscreen(autoPlay = true) {
  const vp = $('stageViewport');
  if (!vp) return;
  setTopMenuOpen(false);
  vp.classList.add('is-stage-fullscreen');
  document.documentElement.classList.add('is-stage-fullscreen-lock');
  document.body.classList.add('is-stage-fullscreen-lock');

  try {
    if (window.AndroidNativeBridge && typeof window.AndroidNativeBridge.setImmersiveFullscreen === 'function') {
      window.AndroidNativeBridge.setImmersiveFullscreen(true);
    } else if (vp.requestFullscreen && !document.fullscreenElement) {
      vp.requestFullscreen().catch(() => {});
    }
  } catch {
    // 전체화면 API 미지원 환경은 고정 레이어(is-stage-fullscreen)로 동작
  }

  syncStageFullscreenUI();
  setViewportZoom(1.0);
  requestAnimationFrame(() => {
    setViewportZoom(1.0);
    renderMainStage();
  });
  setTimeout(() => {
    setViewportZoom(1.0);
    renderMainStage();
  }, 90);

  if (autoPlay && !appState.playing) {
    startPlayback(false);
  }
  syncStageFullscreenUI();
}

function exitStageFullscreen() {
  const vp = $('stageViewport');
  if (!vp) return;
  vp.classList.remove('is-stage-fullscreen');
  document.documentElement.classList.remove('is-stage-fullscreen-lock');
  document.body.classList.remove('is-stage-fullscreen-lock');

  try {
    if (window.AndroidNativeBridge && typeof window.AndroidNativeBridge.setImmersiveFullscreen === 'function') {
      window.AndroidNativeBridge.setImmersiveFullscreen(false);
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  } catch {
    // 무시
  }

  syncStageFullscreenUI();
  setViewportZoom(1.0);
  requestAnimationFrame(() => {
    setViewportZoom(1.0);
    renderMainStage();
  });
  setTimeout(() => {
    setViewportZoom(1.0);
    renderMainStage();
  }, 70);
}

function toggleStageFullscreen(autoPlay = true) {
  if (isStageFullscreenActive()) {
    exitStageFullscreen();
  } else {
    enterStageFullscreen(autoPlay);
  }
}

window.isStageFullscreenActive = isStageFullscreenActive;
window.exitStageFullscreen = exitStageFullscreen;

function extractGolferStanceAnchorFromPoints(points) {
  if (!Array.isArray(points) || points.length < 29) {
    return { x: 0.34, y: 0.72 };
  }
  const lKnee = points[25];
  const rKnee = points[26];
  const lAnkle = points[27];
  const rAnkle = points[28];
  const validPts = [lKnee, rKnee, lAnkle, rAnkle].filter(
    p => p && Number.isFinite(p.x) && Number.isFinite(p.y)
  );
  if (validPts.length === 0) return { x: 0.34, y: 0.72 };
  const avgX = validPts.reduce((acc, p) => acc + p.x, 0) / validPts.length;
  const avgY = validPts.reduce((acc, p) => acc + p.y, 0) / validPts.length;
  return {
    x: Number(clamp(avgX, 0.12, 0.78).toFixed(4)),
    y: Number(clamp(avgY, 0.45, 0.88).toFixed(4))
  };
}

function syncStabilizationUI() {
  const stab = appState.stabilizationOptions || DEFAULT_STABILIZATION_OPTIONS;
  const modeSel = $('selectStabCropMode');
  const badge = $('badgeStabReadout');
  const pinGroundBtn = $('btnPinGroundStay');
  const nudgeOut = $('valStabManualY');

  const cropMode = stab.enabled === false ? 'off' : (stab.cropMode || 'crop-matte');
  if (modeSel) {
    modeSel.value = cropMode;
  }

  const manualYPct = Math.round(Number(stab.manualOffsetY || 0) * -100);
  if (nudgeOut) {
    nudgeOut.textContent = `${manualYPct > 0 ? '+' : ''}${manualYPct}%`;
  }

  if (pinGroundBtn) {
    pinGroundBtn.setAttribute('aria-pressed', String(Boolean(stab.groundPinMode)));
    pinGroundBtn.textContent = stab.groundPinMode
      ? '지면·발 클릭 대기중 (캔버스 클릭)'
      : '지면·발 고정점 클릭 맞추기';
  }

  if (badge) {
    const isOff = cropMode === 'off';
    badge.classList.toggle('is-off', isOff);
    if (isOff) {
      badge.textContent = '고정 꺼짐 (원본 영상)';
    } else if (appState.sourceMode === 'video') {
      const refFrame = Math.max(1, Math.round(Number(stab.referenceTime || 0.45) * (appState.fps || 30)) + 1);
      const maxShiftPct = (Math.max(Number(stab.maxDetectedShiftY || 0), Number(stab.maxDetectedShiftX || 0)) * 100).toFixed(1);
      const kfCount = Array.isArray(stab.customKeyframes) ? stab.customKeyframes.length : 0;
      const kfSuffix = kfCount > 0 ? ` · 수동고정 ${kfCount}점` : '';
      badge.textContent = `기준 F${refFrame} 고정 (흔들림 ±${maxShiftPct}% 보정${kfSuffix})`;
    } else {
      badge.textContent = cropMode === 'auto-zoom' ? '고정 ON (자동 줌인)' : '고정 ON (위·아래 잘림 고정)';
    }
  }
}

function syncActiveArchiveBannerUI() {
  const banner = $('activeArchiveEditBanner');
  const titleEl = $('activeArchiveTitleText');
  const saveBtn = $('btnSaveWorkState');
  if (appState.activeArchiveId) {
    if (banner) banner.hidden = false;
    if (titleEl) titleEl.textContent = appState.activeArchiveTitle || '저장된 작업';
    if (saveBtn) saveBtn.textContent = '수정 작업 저장';
  } else {
    if (banner) banner.hidden = true;
    if (titleEl) titleEl.textContent = '-';
    if (saveBtn) saveBtn.textContent = '작업 내용 저장';
  }
}

async function refreshArchiveCountBadge() {
  try {
    const items = await listArchivedWorkRecords();
    appState.archivedRecordsCache = items;
    const countEl = $('badgeArchiveCount');
    if (countEl) countEl.textContent = String(items.length);
    const topCountEl = $('badgeArchiveCountTop');
    if (topCountEl) {
      topCountEl.textContent = String(items.length);
      topCountEl.hidden = items.length <= 0;
    }
    const subEl = $('archiveHeaderSubCount');
    if (subEl) {
      subEl.textContent = `총 ${items.length}건 보관 중 (작업 저장 및 동영상·스냅샷 추출 시 자동 보관됨)`;
    }
    return items;
  } catch {
    return [];
  }
}

function initStudio() {
  appState.videoElement = $('hiddenVideo');
  appState.renderOptions = { ...DEFAULT_RENDER_OPTIONS };
  appState.modeWorkspaces = {
    afterimage: buildDefaultModeWorkspace('afterimage', 'right'),
    'shot-tracer': buildDefaultModeWorkspace('shot-tracer', 'right')
  };
  syncModeVisibilityUI();
  syncRenderOptionsUI();
  syncShotTracerUI();
  syncViewportZoomUI();
  syncStabilizationUI();
  syncActiveArchiveBannerUI();
  bindControls();
  loadDemoPreset('driver-fo');
  void refreshArchiveCountBadge();
}

function loadDemoPreset(preset, keepArchiveLink = false) {
  stopPlayback();
  const isShotDemo = preset === 'shot-tracer-dtl';
  const effectivePreset = isShotDemo ? 'iron-dtl' : preset;
  const targetMode = isShotDemo ? 'shot-tracer' : 'afterimage';

  // 만약 데모 프리셋 선택으로 인해 탭이 바뀌어야 하는 경우 현재 탭 상태를 먼저 보존
  if (appState.studioMode && appState.studioMode !== targetMode) {
    saveModeWorkspaceSnapshot(appState.studioMode);
    appState.studioMode = targetMode;
  }

  if (appState.videoObjectUrl) {
    URL.revokeObjectURL(appState.videoObjectUrl);
    appState.videoObjectUrl = null;
  }
  appState.videoFileSignature = null;
  appState.sourceMode = 'demo';
  appState.demoPreset = preset;
  appState.videoReady = false;
  appState.uploadedVideoFile = null;
  if (!keepArchiveLink) {
    appState.activeArchiveId = null;
    appState.activeArchiveTitle = '';
    syncActiveArchiveBannerUI();
  }
  appState.canvasWidth = 1280;
  appState.canvasHeight = 720;
  const mainCanvas = $('stageCanvas');
  if (mainCanvas) {
    mainCanvas.width = appState.canvasWidth;
    mainCanvas.height = appState.canvasHeight;
  }
  const studioLayoutEl = $('studioLayout');
  if (studioLayoutEl) {
    studioLayoutEl.classList.remove('is-portrait-video');
  }
  setViewportZoom(1.0);
  appState.stabilizationOptions = createDefaultStabilizationState();
  syncStabilizationUI();

  appState.videoFileName = isShotDemo
    ? '내장 후방(DTL) 공 궤적 시뮬레이션 (Driver 212m · 60fps)'
    : (effectivePreset === 'iron-dtl'
      ? '내장 프로 스윙 시뮬레이션 (Iron DTL 측면 뷰 60fps)'
      : '내장 프로 스윙 시뮬레이션 (Driver 정면 뷰 60fps)');

  const dataset = buildDemoSwingDataset(effectivePreset, 60, 3.2, appState.hand);
  appState.samples = dataset.samples;
  appState.keyMoments = dataset.keyMoments;
  appState.fps = dataset.fps;
  appState.duration = dataset.duration;
  appState.clipStartTime = 0;
  appState.clipEndTime = dataset.duration;
  appState.clipPreset = 'all';

  // 어드레스(Address) 시점의 골프채 샤프트·헤드를 인식하여 고정 템플릿(addressClub)으로 생성
  const addrMoment = appState.keyMoments.find(m => m.key === 'address');
  const addrSample = findNearestSample(appState.samples, addrMoment ? addrMoment.time : 0.45) || appState.samples[0];
  appState.addressClub = createAddressClubTemplate(
    addrSample,
    appState.canvasWidth,
    appState.canvasHeight,
    {
      clubType: effectivePreset === 'iron-dtl' ? 'iron' : 'driver',
      hand: appState.hand
    }
  );

  const finishMoment = appState.keyMoments.find(m => m.key === 'finish');
  const impMoment = appState.keyMoments.find(m => m.key === 'impact');
  const impT = impMoment ? impMoment.time : (appState.duration * 0.42);
  const flightSpan = Number(appState.shotTracerOptions.flightDurationSec || 2.35) + Number(appState.shotTracerOptions.rollDurationSec || 0.62);

  appState.currentTime = appState.studioMode === 'shot-tracer'
    ? clamp(impT + flightSpan + 0.12, 0.5, Math.max(0.5, appState.duration - 0.08))
    : (finishMoment ? finishMoment.time : 2.62);
  appState.selectedPhaseKey = 'finish';

  $('activeFileLabel').textContent = formatModeFileDisplayLabel(
    appState.studioMode,
    appState.videoFileName,
    'demo',
    appState.canvasWidth,
    appState.canvasHeight
  );
  $('timelineRange').max = String(appState.duration);
  $('timelineRange').value = String(appState.currentTime);
  syncModeVisibilityUI();
  syncClipRangeUI(true);

  saveModeWorkspaceSnapshot(appState.studioMode);

  if (appState.studioMode === 'shot-tracer') {
    renderMainStage();
    renderShotFlightStepsStrip();
  } else {
    setStatusMessage('오른손잡이 기준 스윙 궤도 정합 완료 (백스윙 탑 이후 다운스윙~피니시 잔상 표시)');
    renderMainStage();
    void renderPhaseFilmstrip();
    updateMetricsAndCoachingUI();
  }
}

// ============================================================================
// 사용자 실제 비디오 파일 업로드 및 AI 스윙/헤드 궤적 분석 (탭별 독립 동영상 세션)
// ============================================================================

/**
 * 업로드된 스윙 동영상이 [측면(정면 Face-On)] 촬영인지 [후면(후방 DTL)] 촬영인지 자동 판독하여
 * 해당하는 작업 모드([스윙 클럽 잔상 분석: afterimage] vs [후방 공 궤적: shot-tracer])를 결정합니다.
 */
function classifySwingVideoCameraAngleAndMode({
  fileName = '',
  samples = [],
  keyMoments = [],
  shotTracerOptions = {},
  canvasWidth = 1280,
  canvasHeight = 720
}) {
  let rearDtlScore = 0; // 양수(+)면 후면(후방 공 궤적), 음수(-)면 측면(스윙 클럽 잔상 분석)
  const reasons = [];

  const cleanFileName = String(fileName || '').toLowerCase();
  const rearNameRegex = /(후면|후방|뒤에서|뒤쪽|dtl|down[-_\s]?the[-_\s]?line|rear|back[-_\s]?view|shot[-_\s]?tracer|트레이서|탄도|구질|티샷|드라이버샷|비거리|페어웨이|필드샷)/i;
  const sideNameRegex = /(측면|정면|옆에서|옆모습|face[-_\s]?on|front[-_\s]?view|side[-_\s]?view|\bfo\b|잔상|시퀀스|스윙폼|스윙분석|아이언정면)/i;

  if (rearNameRegex.test(cleanFileName)) {
    rearDtlScore += 32;
    reasons.push('파일명 후면·샷 키워드');
  } else if (sideNameRegex.test(cleanFileName)) {
    rearDtlScore -= 32;
    reasons.push('파일명 측면·잔상 키워드');
  }

  const momentsMap = Object.fromEntries((keyMoments || []).map(m => [m.key, m.time]));
  const addrTime = momentsMap.address ?? 0.45;
  const impTime = momentsMap.impact ?? ((samples[samples.length - 1]?.time || 3.0) * 0.45);

  // 1) MediaPipe 실제 포즈 관절 기하학 분석 (어드레스 어깨·골반·발목 폭, Z축 깊이차, 전방 팔 뻗음, 좌우 스윙 대칭성)
  const realPoseSamples = (samples || []).filter(
    s => s && s.hasRealPose && Array.isArray(s.points) && s.points.length >= 29
  );

  if (realPoseSamples.length >= 4) {
    const addrPoseWindow = realPoseSamples.filter(s => s.time <= Math.max(addrTime + 0.35, 0.85));
    const earlyList = addrPoseWindow.length >= 2 ? addrPoseWindow : realPoseSamples.slice(0, Math.min(8, realPoseSamples.length));

    const shoulderRatios = [];
    const stanceRatios = [];
    const depthZRatios = [];
    const handReachRatios = [];
    const spineLeanXRatios = [];
    const hipCentersX = [];

    for (const s of earlyList) {
      const p11 = s.points[11];
      const p12 = s.points[12];
      const p15 = s.points[15];
      const p16 = s.points[16];
      const p23 = s.points[23];
      const p24 = s.points[24];
      const p27 = s.points[27];
      const p28 = s.points[28];
      if (!p11 || !p12 || !p23 || !p24) continue;

      const midShX = (p11.x + p12.x) * 0.5;
      const midShY = (p11.y + p12.y) * 0.5;
      const midHipX = (p23.x + p24.x) * 0.5;
      const midHipY = (p23.y + p24.y) * 0.5;
      const torsoH = Math.max(0.11, Math.abs(midHipY - midShY));

      const shW = Math.abs(p11.x - p12.x);
      const hipW = Math.abs(p23.x - p24.x);
      shoulderRatios.push(shW / torsoH);
      hipCentersX.push(midHipX);

      if (p27 && p28 && Number.isFinite(p27.x) && Number.isFinite(p28.x)) {
        stanceRatios.push(Math.abs(p27.x - p28.x) / torsoH);
      } else {
        stanceRatios.push((hipW * 1.35) / torsoH);
      }

      const zSpan = Math.abs((p11.z || 0) - (p12.z || 0)) + Math.abs((p23.z || 0) - (p24.z || 0));
      const xSpan = Math.max(0.05, shW + hipW);
      depthZRatios.push(zSpan / xSpan);

      if (p15 && p16) {
        const wristX = (p15.x + p16.x) * 0.5;
        const bodyX = (midShX + midHipX) * 0.5;
        handReachRatios.push(Math.abs(wristX - bodyX) / torsoH);
      }
      spineLeanXRatios.push(Math.abs(midShX - midHipX) / torsoH);
    }

    const medianOf = arr => {
      if (!arr.length) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * 0.5)];
    };

    const medShoulderRatio = medianOf(shoulderRatios);
    const medStanceRatio = medianOf(stanceRatios);
    const medDepthZRatio = medianOf(depthZRatios);
    const medHandReach = medianOf(handReachRatios);
    const medSpineLeanX = medianOf(spineLeanXRatios);
    const refHipX = medianOf(hipCentersX) || 0.45;

    // 어드레스 시 어깨 폭 및 스탠스 폭 판별:
    // 후면(DTL)은 카메라 시선과 어깨·양발이 나란히 정렬되어 좌우 폭이 좁게 중첩됨
    // 측면(Face-On)은 카메라를 정면으로 마주 보므로 어깨 폭과 양발 스탠스 폭이 넓게 펼쳐짐
    if (medShoulderRatio < 0.43 && medStanceRatio < 0.47) {
      rearDtlScore += 28;
      reasons.push('어드레스 어깨·스탠스 중첩(후면 구도)');
    } else if (medShoulderRatio >= 0.51 || medStanceRatio >= 0.58) {
      rearDtlScore -= 30;
      reasons.push('어드레스 넓은 어깨·스탠스 폭(측면 구도)');
    }

    // 3D Z축 깊이차 대비 수평 폭 비율 판별
    if (medDepthZRatio >= 0.88) {
      rearDtlScore += 16;
    } else if (medDepthZRatio > 0 && medDepthZRatio <= 0.55) {
      rearDtlScore -= 16;
    }

    // 어드레스 시 몸통 중심선 대비 양손 그립의 전방 뻗음 및 척추 전경 기울기 판별:
    // 후면(DTL)은 상체를 숙여 몸 앞쪽으로 팔을 뻗어 어드레스하므로 수평 이격량이 큼
    // 측면(Face-On)은 양손이 양쪽 허벅지/골반 중앙 아래에 위치하여 수평 이격량이 작음
    if (medHandReach >= 0.26 || medSpineLeanX >= 0.16) {
      rearDtlScore += 20;
      reasons.push('전방 어드레스 팔 뻗음·척추 전경');
    } else if (medHandReach <= 0.18 && medSpineLeanX <= 0.11) {
      rearDtlScore -= 22;
      reasons.push('정면 중앙 그립·수직 정렬');
    }

    // 전체 스윙 구간에서 골반 중심(refHipX) 기준 양손(grip)의 좌·우 이동 대칭성 판별:
    // 측면(Face-On)은 백스윙(우측)부터 팔로우스루(좌측)까지 몸통 양쪽으로 넓게 대칭 회전함
    let minWristX = 1;
    let maxWristX = 0;
    for (const s of realPoseSamples) {
      const gx = s.grip?.x ?? ((s.points[15]?.x + s.points[16]?.x) * 0.5);
      if (Number.isFinite(gx)) {
        if (gx < minWristX) minWristX = gx;
        if (gx > maxWristX) maxWristX = gx;
      }
    }
    const leftSpan = Math.max(0, refHipX - minWristX);
    const rightSpan = Math.max(0, maxWristX - refHipX);
    const maxSpan = Math.max(leftSpan, rightSpan, 0.08);
    const minSpan = Math.min(leftSpan, rightSpan);
    const bilateralRatio = minSpan / maxSpan;

    if (bilateralRatio >= 0.42 && minSpan >= 0.11 && (leftSpan + rightSpan) >= 0.28) {
      rearDtlScore -= 20;
      reasons.push('좌우 양방향 넓은 스윙 원호(측면)');
    } else if (bilateralRatio <= 0.26 && maxSpan >= 0.12) {
      rearDtlScore += 14;
      reasons.push('단측 타깃 라인 스윙 평면(후면)');
    }
  }

  // 2) 임팩트 직후 다중 프레임 상승 공 비행 궤적 및 티박스·페어웨이 검출 신호 분석
  const trackedCount = Number(shotTracerOptions?.rawTrackedWaypointsCount || 0);
  const hasRealBallTrack = Boolean(shotTracerOptions?.hasRealBallTrack && trackedCount >= 2);
  const ballDetected = Boolean(shotTracerOptions?.ballDirectlyDetected);
  const ballScore = Number(shotTracerOptions?.ballConfidenceScore || 0);
  const fairwayDetected = Boolean(shotTracerOptions?.fairwayDirectlyDetected);

  if (hasRealBallTrack && trackedCount >= 3) {
    rearDtlScore += 34;
    reasons.push(`임팩트 직후 연속 ${trackedCount}프레임 상승 공 비행 포착`);
  } else if (hasRealBallTrack && trackedCount === 2) {
    rearDtlScore += 18;
    reasons.push('임팩트 직후 상승 공 비행 포인트 감지');
  }

  if (ballDetected && fairwayDetected) {
    rearDtlScore += 18;
    reasons.push('전방 티박스 골프공 및 원거리 페어웨이 검출');
  } else if (ballDetected && ballScore >= 255) {
    rearDtlScore += 10;
  } else if (!ballDetected && !fairwayDetected && !hasRealBallTrack) {
    rearDtlScore -= 16;
  }

  // 3) 픽셀 모션 에너지 분포 및 배경 구도 분석 (MediaPipe 오프라인 환경에서도 100% 동작)
  const addrSample = findNearestSample(samples, addrTime) || samples[0];
  const golferAnchorX = extractGolferStanceAnchorFromPoints(addrSample?.points)?.x ?? 0.38;
  const motionXs = [];
  for (const s of samples || []) {
    if (s?.motionCand && Number.isFinite(s.motionCand.x) && (s.motionCand.confidence ?? 0) >= 0.25) {
      motionXs.push(s.motionCand.x);
    }
  }
  if (motionXs.length >= 6) {
    const sortedM = [...motionXs].sort((a, b) => a - b);
    const p10 = sortedM[Math.floor(sortedM.length * 0.10)];
    const p90 = sortedM[Math.floor(sortedM.length * 0.90)];
    const motionSpanX = p90 - p10;
    const leftM = sortedM.filter(x => x < golferAnchorX - 0.06).length;
    const rightM = sortedM.filter(x => x > golferAnchorX + 0.06).length;
    const symM = Math.min(leftM, rightM) / Math.max(1, Math.max(leftM, rightM));

    if (motionSpanX >= 0.36 && symM >= 0.42 && !hasRealBallTrack) {
      rearDtlScore -= 18;
      if (!reasons.some(r => r.includes('원호'))) {
        reasons.push('화면 좌우 대칭 클럽 회전 모션(측면)');
      }
    } else if (symM <= 0.28 && rightM > leftM * 2.2) {
      rearDtlScore += 12;
    }
  }

  // 세로형(Portrait) 구도이면서 티박스 공 또는 상승 공 궤적이 잡힌 경우 후방 DTL 가산점
  if (canvasHeight > canvasWidth * 1.05 && (hasRealBallTrack || (ballDetected && fairwayDetected))) {
    rearDtlScore += 10;
  }

  const isRearDtl = rearDtlScore >= 6;
  const targetStudioMode = isRearDtl ? 'shot-tracer' : 'afterimage';
  const confidencePct = clamp(Math.round(68 + Math.min(30, Math.abs(rearDtlScore) * 0.55)), 68, 99);
  const defaultReason = isRearDtl
    ? '후방 스탠스 정렬 및 전방 타깃 공 비행 구도 확인'
    : '측면 와이드 스윙 아크 및 정면 스탠스 정렬 확인';

  return {
    detectedView: isRearDtl ? 'rear-dtl' : 'side-face-on',
    targetStudioMode,
    viewLabelKo: isRearDtl ? '후면(후방 DTL) 촬영 영상' : '측면(정면) 촬영 영상',
    modeLabelKo: isRearDtl ? '후방 공 궤적 (샷 트레이서)' : '스윙 클럽 잔상 분석',
    confidencePct,
    score: rearDtlScore,
    reasonSummaryKo: reasons.length > 0 ? reasons.slice(0, 2).join(' · ') : defaultReason
  };
}

async function handleVideoFileUpload(file) {
  if (!file) return;
  stopPlayback();

  const initialModeBeforeUpload = appState.studioMode === 'shot-tracer' ? 'shot-tracer' : 'afterimage';
  saveModeWorkspaceSnapshot(initialModeBeforeUpload);
  const prevWorkspaceBackup = appState.modeWorkspaces?.[initialModeBeforeUpload]
    ? { ...appState.modeWorkspaces[initialModeBeforeUpload] }
    : null;

  const incomingSig = getVideoFileSignature(file);

  await runWithBusyOverlay(
    {
      title: '스윙 동영상 촬영 각도(측면/후면) 자동 판독 및 분석 중...',
      sub: `${file.name} 영상이 측면(클럽 잔상 분석)인지 후면(후방 공 궤적)인지 자동 판별하여 맞춤 작업을 진행합니다.`,
      stepText: '비디오 디코더 초기화 및 촬영 구도 판독 준비 중',
      immediate: true,
      progressPct: 2
    },
    async reportProgress => {
      appState.busy = true;
      appState.uploadedVideoFile = file;
      appState.videoFileSignature = incomingSig;
      appState.autoDetectedViewInfo = null;
      appState.activeArchiveId = null;
      appState.activeArchiveTitle = '';
      syncActiveArchiveBannerUI();
      setStatusMessage(`동영상 촬영 각도(측면/후면) 자동 판독 및 로드 중: ${file.name}`);

      const url = URL.createObjectURL(file);
      appState.videoObjectUrl = url;
      const video = appState.videoElement;

      try {
        await new Promise((resolve, reject) => {
          const onLoaded = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            reject(new Error('지원되지 않는 비디오 형식이거나 디코딩할 수 없습니다.'));
          };
          const cleanup = () => {
            video.removeEventListener('loadedmetadata', onLoaded);
            video.removeEventListener('error', onError);
          };
          video.addEventListener('loadedmetadata', onLoaded);
          video.addEventListener('error', onError);
          video.src = url;
          video.load();
        });

        appState.sourceMode = 'video';
        appState.videoReady = true;
        appState.videoFileName = file.name;
        appState.duration = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(video.duration, 12.0) : 3.2;
        appState.canvasWidth = video.videoWidth || 1280;
        appState.canvasHeight = video.videoHeight || 720;

        const mainCanvas = $('stageCanvas');
        mainCanvas.width = appState.canvasWidth;
        mainCanvas.height = appState.canvasHeight;

        const studioLayoutEl = $('studioLayout');
        if (studioLayoutEl) {
          studioLayoutEl.classList.toggle('is-portrait-video', appState.canvasHeight > appState.canvasWidth);
        }
        setViewportZoom(1.0);
        $('timelineRange').max = String(appState.duration);

        await analyzeUploadedVideo(reportProgress);

        // 자동 판독되어 결정된 최종 모드(afterimage vs shot-tracer) 워크스페이스 반영 및 이전 탭 작업 보호
        const finalMode = appState.studioMode === 'shot-tracer' ? 'shot-tracer' : 'afterimage';
        const otherMode = finalMode === 'shot-tracer' ? 'afterimage' : 'shot-tracer';

        if (finalMode !== initialModeBeforeUpload && prevWorkspaceBackup) {
          // 기존에 보고 있던 탭이 새 동영상과 다른 모드로 판독된 경우, 기존 탭의 이전 작업 상태를 그대로 보존
          if (prevWorkspaceBackup.videoFileSignature === incomingSig) {
            if (prevWorkspaceBackup.videoObjectUrl && prevWorkspaceBackup.videoObjectUrl !== url) {
              try {
                URL.revokeObjectURL(prevWorkspaceBackup.videoObjectUrl);
              } catch {
                // URL 해제 예외 무시
              }
            }
            appState.modeWorkspaces[initialModeBeforeUpload] = buildDefaultModeWorkspace(
              initialModeBeforeUpload,
              appState.hand || 'right'
            );
          } else {
            appState.modeWorkspaces[initialModeBeforeUpload] = prevWorkspaceBackup;
          }

          const oldTargetUrl = appState.modeWorkspaces?.[finalMode]?.videoObjectUrl;
          if (oldTargetUrl && oldTargetUrl !== url && oldTargetUrl !== prevWorkspaceBackup.videoObjectUrl) {
            try {
              URL.revokeObjectURL(oldTargetUrl);
            } catch {
              // URL 해제 예외 무시
            }
          }
        } else if (prevWorkspaceBackup?.videoObjectUrl && prevWorkspaceBackup.videoObjectUrl !== url) {
          const otherWsUrl = appState.modeWorkspaces?.[otherMode]?.videoObjectUrl;
          if (prevWorkspaceBackup.videoObjectUrl !== otherWsUrl) {
            try {
              URL.revokeObjectURL(prevWorkspaceBackup.videoObjectUrl);
            } catch {
              // URL 해제 예외 무시
            }
          }
        }

        // 반대편 탭에 동일 파일이 열려 있었다면 중복 방지를 위해 기본 데모 워크스페이스로 정리
        if (appState.modeWorkspaces?.[otherMode]?.videoFileSignature === incomingSig) {
          const dupUrl = appState.modeWorkspaces[otherMode].videoObjectUrl;
          if (dupUrl && dupUrl !== url) {
            try {
              URL.revokeObjectURL(dupUrl);
            } catch {
              // URL 해제 예외 무시
            }
          }
          appState.modeWorkspaces[otherMode] = buildDefaultModeWorkspace(otherMode, appState.hand || 'right');
        }

        saveModeWorkspaceSnapshot(finalMode);
      } catch (err) {
        setStatusMessage(`오류: ${err.message}`);
      } finally {
        if ($('videoFileInput')) $('videoFileInput').value = '';
        appState.busy = false;
      }
    }
  );
}

async function ensurePoseLandmarker() {
  if (poseLandmarkerInstance) return poseLandmarkerInstance;
  try {
    const visionModule = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
    const { FilesetResolver, PoseLandmarker } = visionModule;
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
    const modelUrl = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
    try {
      poseLandmarkerInstance = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelUrl,
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numPoses: 1
      });
    } catch {
      poseLandmarkerInstance = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelUrl,
          delegate: 'CPU'
        },
        runningMode: 'VIDEO',
        numPoses: 1
      });
    }
    return poseLandmarkerInstance;
  } catch {
    return null;
  }
}

/**
 * 연속된 두 비디오 프레임(currImageData, prevImageData)에서
 * 골퍼 스윙 영역(golferMotion), 하단 타격·볼 출발 영역(strikeMotion), 상단 피니시 영역(upperMotion)의
 * 실제 픽셀 모션 에너지를 추출합니다.
 */
function computeFrameRegionalMotion(currData, prevData, width, height) {
  if (!currData || !prevData || currData.length !== prevData.length) {
    return { golferMotion: 0, strikeMotion: 0, upperMotion: 0 };
  }
  const stepX = Math.max(3, Math.round(width / 120));
  const stepY = Math.max(3, Math.round(height / 120));

  let golferSum = 0;
  let golferCnt = 0;
  let strikeSum = 0;
  let strikeCnt = 0;
  let upperSum = 0;
  let upperCnt = 0;

  const yStart = Math.floor(height * 0.14);
  const yEnd = Math.ceil(height * 0.88);
  const xStart = Math.floor(width * 0.16);
  const xEnd = Math.ceil(width * 0.82);

  for (let y = yStart; y < yEnd; y += stepY) {
    const ny = y / height;
    for (let x = xStart; x < xEnd; x += stepX) {
      const nx = x / width;
      const idx = (y * width + x) * 4;
      const cLum = (currData[idx] + currData[idx + 1] + currData[idx + 2]) * 0.3333;
      const pLum = (prevData[idx] + prevData[idx + 1] + prevData[idx + 2]) * 0.3333;
      const diff = Math.abs(cLum - pLum);
      const activeDiff = diff > 10 ? diff : diff * 0.25;

      golferSum += activeDiff;
      golferCnt++;

      // 하단 타격 및 볼 발사 존 (다운스윙 클럽헤드 통과 및 임팩트 직후 공 이륙 구역)
      if (nx >= 0.32 && nx <= 0.76 && ny >= 0.50 && ny <= 0.87) {
        const fastBoost = diff > 22 ? diff * 1.65 : activeDiff;
        strikeSum += fastBoost;
        strikeCnt++;
      }

      // 상단 백스윙 탑 · 팔로우스루 · 피니시 존
      if (nx >= 0.18 && nx <= 0.68 && ny >= 0.14 && ny <= 0.48) {
        upperSum += activeDiff;
        upperCnt++;
      }
    }
  }

  return {
    golferMotion: golferCnt > 0 ? golferSum / golferCnt : 0,
    strikeMotion: strikeCnt > 0 ? strikeSum / strikeCnt : 0,
    upperMotion: upperCnt > 0 ? upperSum / upperCnt : 0
  };
}

/**
 * 실제 동영상 프레임들의 픽셀 모션 에너지 프로파일을 분석하여,
 * 촬영 시간이 긴 영상(예: 스윙은 2.6초에 끝나고 5.2초까지 공 비행을 찍은 영상)에서도
 * 스윙이 끝난 뒤(피니시 이후)를 임팩트로 착각하지 않고 실제 타격 시점(impactTime)과 피니시(finishTime)를 정확히 산출합니다.
 */
function estimateSwingTimingFromVideoPixels(rawSamples, duration) {
  const n = rawSamples?.length || 0;
  if (n < 8) {
    const imp = clamp(duration * 0.35, 0.55, Math.max(0.8, duration - 0.7));
    return {
      addressTime: Number(Math.max(0.15, imp - 0.95).toFixed(3)),
      topTime: Number(Math.max(0.35, imp - 0.30).toFixed(3)),
      impactTime: Number(imp.toFixed(3)),
      finishTime: Number(Math.min(duration - 0.15, imp + 0.68).toFixed(3))
    };
  }

  const smooth3 = arr =>
    arr.map((v, i) => {
      const a = arr[Math.max(0, i - 1)];
      const b = v;
      const c = arr[Math.min(arr.length - 1, i + 1)];
      return a * 0.25 + b * 0.50 + c * 0.25;
    });

  const gSeries = smooth3(rawSamples.map(s => s.videoMotion || 0));
  const stSeries = smooth3(rawSamples.map(s => s.strikeMotion || 0));
  const upSeries = smooth3(rawSamples.map(s => s.upperMotion || 0));
  const mcSeries = rawSamples.map(s => (s.motionCand?.confidence || 0) * (s.motionCand?.motionEnergy || 12));

  // 스윙이 촬영된 실제 구간 탐색:
  // 후방(DTL) 샷 영상은 임팩트 후 공이 날아가는 모습을 2~3초간 계속 촬영하므로,
  // 실제 임팩트는 항상 영상 초·중반(최대 duration * 0.52 또는 2.35초 이내)의 다운스윙 타격 피크에서 발생함
  const minImpTime = Math.max(0.45, Math.min(0.85, duration * 0.15));
  const maxImpTime = duration >= 4.2
    ? Math.min(2.35, duration * 0.45)
    : Math.min(duration - 0.48, duration * 0.58);

  let bestImpIdx = Math.floor(n * 0.35);
  let bestScore = -Infinity;

  for (let i = 2; i < n - 3; i++) {
    const t = rawSamples[i].time;
    if (t < minImpTime || t > maxImpTime) continue;

    // 1) 현재 프레임 전후의 타격 존(strikeMotion) + 전신 스윙 모션 피크
    const localStrike = Math.max(stSeries[i], stSeries[i - 1] * 0.92, stSeries[i + 1] * 0.92);
    const localGolfer = Math.max(gSeries[i], gSeries[i + 1]);
    const localMc = Math.max(mcSeries[i], mcSeries[i - 1] * 0.85);

    // 2) 직전 백스윙 구간(t - 0.80s ~ t - 0.15s)의 스윙 준비 모션 존재 여부
    let backSum = 0;
    let backCnt = 0;
    for (let k = i - 2; k >= 1; k--) {
      const dt = t - rawSamples[k].time;
      if (dt < 0.12) continue;
      if (dt > 0.82) break;
      backSum += gSeries[k] + upSeries[k] * 0.6;
      backCnt++;
    }
    const backAvg = backCnt > 0 ? backSum / backCnt : 0;

    // 3) 직후 팔로우스루 구간(t + 0.04s ~ t + 0.48s)의 상단 스윙 모션
    let follSum = 0;
    let follCnt = 0;
    for (let k = i + 1; k < n; k++) {
      const dt = rawSamples[k].time - t;
      if (dt < 0.03) continue;
      if (dt > 0.48) break;
      follSum += gSeries[k] + upSeries[k] * 0.85;
      follCnt++;
    }
    const follAvg = follCnt > 0 ? follSum / follCnt : 0;

    // 4) 피니시 홀드 구간(t + 0.68s ~ t + 1.35s)에서 스윙 동작이 마무리되어 모션이 잦아드는지 확인
    let postFinSum = 0;
    let postFinCnt = 0;
    for (let k = i + 3; k < n; k++) {
      const dt = rawSamples[k].time - t;
      if (dt < 0.68) continue;
      if (dt > 1.38) break;
      postFinSum += gSeries[k] + stSeries[k] * 0.5;
      postFinCnt++;
    }
    const postFinAvg = postFinCnt > 0 ? postFinSum / postFinCnt : localGolfer * 0.5;
    const finishCalmBonus = Math.max(0, (localGolfer + localStrike * 0.5) - postFinAvg * 1.15);

    // 골퍼가 실제로 가장 많이 스윙하는 시점(1.1s ~ 2.05s) 가중치
    const naturalTimingBonus = Math.max(0, 1.0 - Math.abs(t - Math.min(1.78, duration * 0.35)) / 1.1) * 4.5;

    const score =
      localStrike * 2.25 +
      localGolfer * 1.35 +
      localMc * 0.15 +
      backAvg * 0.65 +
      follAvg * 0.85 +
      finishCalmBonus * 0.95 +
      naturalTimingBonus;

    if (score > bestScore) {
      bestScore = score;
      bestImpIdx = i;
    }
  }

  const impactTime = rawSamples[bestImpIdx]?.time ?? clamp(duration * 0.35, 0.55, 2.10);

  // 백스윙 탑(topTime): 임팩트 직전 0.18s ~ 0.42s 구간에서 전환점(국소 모션 골짜기 또는 표준 0.28s 전) 탐색
  let topTime = Math.max(0.30, impactTime - 0.28);
  let minTransMotion = Infinity;
  for (let k = bestImpIdx - 2; k >= 1; k--) {
    const dt = impactTime - rawSamples[k].time;
    if (dt < 0.18) continue;
    if (dt > 0.42) break;
    const mVal = stSeries[k] * 0.7 + gSeries[k] * 0.3;
    if (mVal < minTransMotion) {
      minTransMotion = mVal;
      topTime = rawSamples[k].time;
    }
  }

  // 어드레스(addressTime): 백스윙 탑 이전 0.55s ~ 1.15s 구간에서 정지 상태 직후 시점
  let addressTime = Math.max(0.12, topTime - 0.82);
  for (let k = bestImpIdx - 4; k >= 0; k--) {
    const dt = topTime - rawSamples[k].time;
    if (dt < 0.48) continue;
    if (dt > 1.15) break;
    if (gSeries[k] <= gSeries[bestImpIdx] * 0.28) {
      addressTime = rawSamples[k].time;
      break;
    }
  }

  // 피니시(finishTime): 임팩트 직후 0.52s ~ 0.92s 구간에서 팔로우스루가 마무리되는 시점
  const finishTime = clamp(impactTime + 0.72, impactTime + 0.45, Math.max(impactTime + 0.48, duration - 0.12));

  return {
    addressTime: Number(addressTime.toFixed(3)),
    topTime: Number(topTime.toFixed(3)),
    impactTime: Number(impactTime.toFixed(3)),
    finishTime: Number(finishTime.toFixed(3))
  };
}

const fallbackDemoCache = {};

function buildFallbackKinematicPose(time, duration, hand, videoTiming = null) {
  const safeHand = hand === 'left' ? 'left' : 'right';
  if (!fallbackDemoCache[safeHand]) {
    fallbackDemoCache[safeHand] = buildDemoSwingDataset('driver-fo', 60, 3.2, safeHand);
  }
  const demo = fallbackDemoCache[safeHand];

  let normT;
  if (videoTiming && Number.isFinite(videoTiming.impactTime)) {
    // 실제 영상에서 감지된 스윙 타이밍(address -> top -> impact -> finish)에 맞춰
    // 내장 키네마틱 모델의 시간축(0.45 -> 1.45 -> 1.78 -> 2.62)을 정밀 매핑하여
    // 긴 영상(예: 5.22초)에서도 스윙 종료 후 뒤늦게 임팩트가 발생하는 현상을 원천 방지합니다.
    const tAddr = videoTiming.addressTime;
    const tTop = videoTiming.topTime;
    const tImp = videoTiming.impactTime;
    const tFin = videoTiming.finishTime;

    if (time <= tAddr) {
      normT = clamp((time / Math.max(0.05, tAddr)) * 0.45, 0, 0.45);
    } else if (time <= tTop) {
      const u = (time - tAddr) / Math.max(0.05, tTop - tAddr);
      normT = 0.45 + clamp(u, 0, 1) * (1.45 - 0.45);
    } else if (time <= tImp) {
      const u = (time - tTop) / Math.max(0.05, tImp - tTop);
      normT = 1.45 + clamp(u, 0, 1) * (1.78 - 1.45);
    } else if (time <= tFin) {
      const u = (time - tImp) / Math.max(0.05, tFin - tImp);
      normT = 1.78 + clamp(u, 0, 1) * (2.62 - 1.78);
    } else {
      const u = (time - tFin) / Math.max(0.10, duration - tFin);
      normT = 2.62 + clamp(u, 0, 1) * (3.20 - 2.62);
    }
  } else {
    normT = clamp((time / Math.max(0.5, duration)) * 3.2, 0, 3.2);
  }

  return findNearestSample(demo.samples, normT) || demo.samples[0];
}

async function analyzeUploadedVideo(reportProgress = () => {}) {
  const video = appState.videoElement;
  if (!video || !appState.videoReady) return;

  appState.busy = true;
  const progressWrap = $('analysisProgressWrap');
  const progressBar = $('analysisProgressBar');
  progressWrap.hidden = false;
  progressBar.value = 4;

  const prepMsg = '1/2단계: 영상 흔들림 감지 및 스윙한 사람·지면 위치 고정(Stay Lock) 전처리 준비 중...';
  setStatusMessage(prepMsg);
  reportProgress(4, 'AI 비전 엔진 초기화 및 프레임 스캔 준비 중', prepMsg);
  const landmarker = await ensurePoseLandmarker();

  const scanFps = 30;
  appState.fps = scanFps;
  const duration = Math.min(appState.duration, 12.0);
  const totalSteps = Math.max(24, Math.min(320, Math.round(duration * scanFps)));

  const procCanvas = document.createElement('canvas');
  const scale = Math.min(1, 960 / Math.max(video.videoWidth || 960, video.videoHeight || 540));
  procCanvas.width = Math.max(320, Math.round((video.videoWidth || 960) * scale));
  procCanvas.height = Math.max(180, Math.round((video.videoHeight || 540) * scale));
  const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });

  // [1단계] 전체 프레임 디코딩 및 지면·골퍼 스탠스 특징 맵 추출 -> 흔들림 제거된 고정 프레임(frameCanvas) 선(先)생성
  const rawSamples = [];
  let lastYield = performance.now();
  for (let i = 0; i <= totalSteps; i++) {
    const t = Number(((i / totalSteps) * duration).toFixed(3));
    await seekVideoSafely(video, t);
    procCtx.drawImage(video, 0, 0, procCanvas.width, procCanvas.height);
    const rawImgData = procCtx.getImageData(0, 0, procCanvas.width, procCanvas.height).data;
    const stabMap = extractStabilizationFeatureMap(rawImgData, procCanvas.width, procCanvas.height);

    const rawFrameSnap = document.createElement('canvas');
    rawFrameSnap.width = procCanvas.width;
    rawFrameSnap.height = procCanvas.height;
    rawFrameSnap.getContext('2d').drawImage(procCanvas, 0, 0);

    const stabFrameSnap = document.createElement('canvas');
    stabFrameSnap.width = procCanvas.width;
    stabFrameSnap.height = procCanvas.height;

    rawSamples.push({
      time: t,
      stabMap,
      stabOffset: { dx: 0, dy: 0 },
      rawFrameCanvas: rawFrameSnap,
      frameCanvas: stabFrameSnap
    });

    const pct = Math.round(((i + 1) / (totalSteps + 1)) * 40);
    progressBar.value = pct;
    const stepMsg = `1/2단계: 지면·사람 위치 고정용 프레임 스캔 중... (${i + 1}/${totalSteps + 1} 프레임, ${pct}%)`;
    setStatusMessage(stepMsg);
    reportProgress(pct, `1/2단계: 프레임 디코딩 및 지면 특징 추출 (${i + 1}/${totalSteps + 1})`, stepMsg);
    if (performance.now() - lastYield > 28) {
      await new Promise(r => setTimeout(r, 0));
      lastYield = performance.now();
    }
  }

  // 초기 기준 프레임(어드레스~임팩트 구간)을 기준으로 모든 프레임의 상하·좌우 흔들림을 먼저 고정하여 frameCanvas에 베이크
  const initialRefTime = Number((duration * 0.34).toFixed(3));
  appState.stabilizationOptions = {
    ...DEFAULT_STABILIZATION_OPTIONS,
    ...appState.stabilizationOptions,
    enabled: appState.stabilizationOptions?.cropMode !== 'off',
    cropMode: appState.stabilizationOptions?.cropMode || 'crop-matte',
    referenceTime: initialRefTime,
    manualOffsetX: 0,
    manualOffsetY: 0,
    groundPinMode: false,
    customKeyframes: []
  };
  const preStabSummary = await recomputeSamplesStabilizationAsync(
    rawSamples,
    appState.stabilizationOptions,
    stabPct => {
      const totalPct = 40 + Math.round(stabPct * 0.12);
      progressBar.value = totalPct;
      reportProgress(totalPct, `1/2단계: 전체 프레임 카메라 흔들림 역변환 및 고정 중 (${stabPct}%)`);
    },
    true
  );
  appState.stabilizationOptions.maxDetectedShiftX = preStabSummary.maxShiftX;
  appState.stabilizationOptions.maxDetectedShiftY = preStabSummary.maxShiftY;

  // [2단계] 사람과 지면 위치가 변하지 않게 고정된 동영상 프레임(frameCanvas) 위에서 포즈·실제 픽셀 모션·클럽 헤드·공 궤적 분석 수행
  let prevImageData = null;
  lastYield = performance.now();
  for (let i = 0; i < rawSamples.length; i++) {
    const sampleItem = rawSamples[i];
    const t = sampleItem.time;
    const fixedCanvas = sampleItem.frameCanvas;
    const fixedCtx = fixedCanvas.getContext('2d', { willReadFrequently: true });
    const currImageData = fixedCtx.getImageData(0, 0, fixedCanvas.width, fixedCanvas.height).data;

    const regionalMotion = prevImageData
      ? computeFrameRegionalMotion(currImageData, prevImageData, fixedCanvas.width, fixedCanvas.height)
      : { golferMotion: 0, strikeMotion: 0, upperMotion: 0 };

    let posePoints = null;
    if (landmarker) {
      try {
        const res = landmarker.detectForVideo(fixedCanvas, Math.round(t * 1000) + i);
        if (res?.landmarks?.[0]) {
          posePoints = res.landmarks[0].map(p => ({
            x: p.x,
            y: p.y,
            z: p.z ?? 0,
            visibility: p.visibility ?? 0.9
          }));
        }
      } catch {
        posePoints = null;
      }
    }

    const tempGrip = posePoints?.[15] && posePoints?.[16]
      ? {
          x: (posePoints[15].x + posePoints[16].x) * 0.5,
          y: (posePoints[15].y + posePoints[16].y) * 0.5
        }
      : { x: 0.42, y: 0.62 };

    const motionCand = prevImageData
      ? detectClubHeadMotionPeak(currImageData, prevImageData, fixedCanvas.width, fixedCanvas.height, tempGrip)
      : null;

    sampleItem.hasRealPose = Boolean(posePoints);
    sampleItem.rawDetectedPoints = posePoints;
    sampleItem.videoMotion = regionalMotion.golferMotion;
    sampleItem.strikeMotion = regionalMotion.strikeMotion;
    sampleItem.upperMotion = regionalMotion.upperMotion;
    sampleItem.motionCand = motionCand || null;

    prevImageData = currImageData;
    const pct = 52 + Math.round(((i + 1) / rawSamples.length) * 36);
    progressBar.value = pct;
    const step2Msg = `2/2단계: 촬영 각도(측면/후면) 및 클럽·포즈·공 궤적 정밀 판독 중... (${i + 1}/${rawSamples.length} 프레임, ${pct}%)`;
    setStatusMessage(step2Msg);
    reportProgress(pct, `2/2단계: 촬영 각도 및 클럽·공 궤적 판독 중 (${i + 1}/${rawSamples.length})`, step2Msg);

    if (performance.now() - lastYield > 26) {
      await new Promise(r => setTimeout(r, 0));
      lastYield = performance.now();
    }
  }

  // 실제 영상 픽셀 모션 에너지로부터 본 스윙 타이밍(어드레스 -> 탑 -> 임팩트 -> 피니시) 추출
  const videoMotionTiming = estimateSwingTimingFromVideoPixels(rawSamples, duration);

  for (let i = 0; i < rawSamples.length; i++) {
    const sampleItem = rawSamples[i];
    const t = sampleItem.time;
    const prevSample = i > 0 ? rawSamples[i - 1] : null;
    const fallbackSynth = buildFallbackKinematicPose(t, duration, appState.hand, videoMotionTiming);
    const activePoints = sampleItem.rawDetectedPoints || fallbackSynth.points;

    const { grip, clubHead } = estimateClubPosition(
      activePoints,
      prevSample,
      t,
      duration,
      appState.hand,
      sampleItem.motionCand
    );

    let clubSpeed = 0;
    if (prevSample?.clubHead && clubHead) {
      const dt = Math.max(0.01, t - prevSample.time);
      const dist = Math.hypot(clubHead.x - prevSample.clubHead.x, clubHead.y - prevSample.clubHead.y);
      clubSpeed = Math.min(125, Math.round((dist / dt) * 28.5));
    }

    sampleItem.videoTimingHint = videoMotionTiming;
    sampleItem.points = activePoints;
    sampleItem.grip = grip || fallbackSynth.grip;
    sampleItem.clubHead = clubHead || fallbackSynth.clubHead;
    sampleItem.clubHeadBase = { ...(clubHead || fallbackSynth.clubHead) };
    sampleItem.clubSpeed = clubSpeed;
  }

  reportProgress(89, '스윙 7단계 구간 검출 및 어드레스 클럽 정합 중...');
  await new Promise(r => setTimeout(r, 0));

  appState.samples = smoothSamples(rawSamples);
  appState.keyMoments = detectSwingMoments(appState.samples, 0, duration);

  // 어드레스(Address) 시점 프레임에서 골프채(샤프트·헤드) 및 헤드 앞쪽 실제 골프공 위치를 인식하고,
  // 인식된 어드레스 골프채를 기준으로 전체 스윙 궤도를 매끄러운 원호로 정합
  const addrMoment = appState.keyMoments.find(m => m.key === 'address');
  const addrSample = findNearestSample(appState.samples, addrMoment ? addrMoment.time : 0.45) || appState.samples[0];

  if (addrSample?.frameCanvas && addrSample?.grip) {
    try {
      const fCtx = addrSample.frameCanvas.getContext('2d');
      const addrImgData = fCtx.getImageData(0, 0, addrSample.frameCanvas.width, addrSample.frameCanvas.height).data;
      const detectedAddrClub = detectAddressGolfClub(
        addrImgData,
        addrSample.frameCanvas.width,
        addrSample.frameCanvas.height,
        addrSample.grip,
        0.22,
        appState.hand,
        addrSample.points
      );
      if (detectedAddrClub.grip) {
        addrSample.grip = detectedAddrClub.grip;
      }
      addrSample.clubHead = detectedAddrClub.clubHead;
      addrSample.clubHeadBase = { ...detectedAddrClub.clubHead };
      addrSample.ballPoint = detectedAddrClub.ballPoint;
    } catch {
      // 픽셀 접근 제한 시 기존 어드레스 클럽 추정치 유지
    }
  }

  appState.addressClub = createAddressClubTemplate(
    addrSample,
    appState.canvasWidth,
    appState.canvasHeight,
    {
      clubType: 'driver',
      hand: appState.hand
    }
  );

  appState.samples = regularizeSwingWithAddressClub(
    appState.samples,
    appState.keyMoments,
    appState.addressClub,
    appState.hand
  );

  reportProgress(91, '촬영 각도(측면 vs 후면) 및 공 비행 궤적 자동 판독 중...');
  await new Promise(r => setTimeout(r, 0));

  appState.shotTracerOptions = autoCalibrateShotTracerFromVideo(
    appState.samples,
    appState.keyMoments,
    appState.shotTracerOptions
  );
  if (Number.isFinite(appState.shotTracerOptions.calibratedImpactTime)) {
    const impM = appState.keyMoments.find(m => m.key === 'impact');
    if (impM && impM.source !== 'marked') {
      impM.time = Number(appState.shotTracerOptions.calibratedImpactTime.toFixed(3));
    }
  }

  // [핵심] 동영상이 측면(Face-On)인지 후면(DTL)인지 자동 판단하여 잔상분석(afterimage) 또는 후방 공 궤적(shot-tracer) 모드로 자동 전환!
  const autoViewDecision = classifySwingVideoCameraAngleAndMode({
    fileName: appState.videoFileName,
    samples: appState.samples,
    keyMoments: appState.keyMoments,
    shotTracerOptions: appState.shotTracerOptions,
    canvasWidth: appState.canvasWidth,
    canvasHeight: appState.canvasHeight
  });

  appState.autoDetectedViewInfo = autoViewDecision;
  appState.studioMode = autoViewDecision.targetStudioMode;
  appState.shotTracerOptions.enabled = autoViewDecision.targetStudioMode === 'shot-tracer';

  updateGlobalBusyOverlay({
    title: `[자동 판독 완료: ${autoViewDecision.viewLabelKo}]`,
    sub: `${autoViewDecision.reasonSummaryKo} (신뢰도 ${autoViewDecision.confidencePct}%) → [${autoViewDecision.modeLabelKo}] 모드로 자동 진행합니다.`
  });
  reportProgress(
    93,
    `자동 판독: ${autoViewDecision.viewLabelKo} → [${autoViewDecision.modeLabelKo}] 모드 전환`
  );

  // 검출된 실제 임팩트(공 출발 프레임), 공 출발 위치, 스윙한 사람의 서 있는 하체 위치를 기준으로
  // 지면·사람 위치 고정을 한 번 더 정밀 재정합하여 출발 프레임과 이후 프레임의 높이를 일치시킴
  const calibratedImp = appState.keyMoments.find(m => m.key === 'impact');
  const refImpTime = calibratedImp ? calibratedImp.time : initialRefTime;
  const refImpSample = findNearestSample(appState.samples, refImpTime) || addrSample;
  const detectedOriginPt = appState.shotTracerOptions?.originPoint || { x: 0.48, y: 0.78 };
  appState.stabilizationOptions.referenceTime = Number(refImpTime.toFixed(3));
  appState.stabilizationOptions.groundAnchorPoint = {
    x: clamp(detectedOriginPt.x, 0.15, 0.85),
    y: clamp(detectedOriginPt.y + 0.015, 0.48, 0.90)
  };
  appState.stabilizationOptions.golferAnchorPoint = extractGolferStanceAnchorFromPoints(refImpSample?.points);

  const finalStabSummary = await recomputeSamplesStabilizationAsync(
    appState.samples,
    appState.stabilizationOptions,
    stabPct => {
      const totalPct = 93 + Math.round(stabPct * 0.06);
      progressBar.value = totalPct;
      reportProgress(totalPct, `임팩트 지면·사람 높이 최종 고정 반영 중 (${stabPct}%)`);
    },
    true
  );
  appState.stabilizationOptions.maxDetectedShiftX = finalStabSummary.maxShiftX;
  appState.stabilizationOptions.maxDetectedShiftY = finalStabSummary.maxShiftY;

  if ($('activeFileLabel')) {
    $('activeFileLabel').textContent = formatModeFileDisplayLabel(
      appState.studioMode,
      appState.videoFileName,
      'video',
      appState.canvasWidth,
      appState.canvasHeight,
      autoViewDecision
    );
  }

  syncModeVisibilityUI();
  syncRenderOptionsUI();
  syncStabilizationUI();
  syncShotTracerUI();

  const fin = appState.keyMoments.find(m => m.key === 'finish') || appState.keyMoments.find(m => m.key === 'impact');
  const imp = appState.keyMoments.find(m => m.key === 'impact');
  const impT = imp ? imp.time : duration * 0.35;
  const flightSpan = Number(appState.shotTracerOptions.flightDurationSec || 1.55) + Number(appState.shotTracerOptions.rollDurationSec || 0.48);

  appState.currentTime = appState.studioMode === 'shot-tracer'
    ? clamp(impT + flightSpan + 0.12, 0.5, Math.max(0.5, appState.duration - 0.08))
    : (fin ? fin.time : duration * 0.82);
  appState.selectedPhaseKey = fin ? fin.key : 'finish';
  appState.clipStartTime = 0;
  appState.clipEndTime = appState.duration;
  appState.clipPreset = 'all';
  $('timelineRange').value = String(appState.currentTime);
  syncClipRangeUI(true);

  await seekVideoSafely(video, appState.currentTime);
  progressWrap.hidden = true;
  appState.busy = false;
  const stRes = appState.shotTracerOptions;
  const totM = (Number(stRes.carryMeters || 0) + Number(stRes.rollMeters || 0)).toFixed(1);
  const shiftPct = (Math.max(finalStabSummary.maxShiftY, finalStabSummary.maxShiftX) * 100).toFixed(1);
  setStatusMessage(
    appState.studioMode === 'shot-tracer'
      ? `[자동 판독: ${autoViewDecision.viewLabelKo} (${autoViewDecision.confidencePct}%) → 후방 공 궤적 모드 진행] ${autoViewDecision.reasonSummaryKo} · 임팩트 ${impT.toFixed(2)}s · 캐리 ${Number(stRes.carryMeters).toFixed(1)}m (총 ${totM}m)`
      : `[자동 판독: ${autoViewDecision.viewLabelKo} (${autoViewDecision.confidencePct}%) → 스윙 클럽 잔상 분석 진행] ${autoViewDecision.reasonSummaryKo} · 지면 고정(±${shiftPct}% 흔들림 보정) 완료`
  );

  renderMainStage();
  if (appState.studioMode === 'shot-tracer') {
    renderShotFlightStepsStrip();
  } else {
    await renderPhaseFilmstrip();
  }
  updateMetricsAndCoachingUI();
}

// ============================================================================
// 타임라인 구간(CLIP 시작~종료) 동기화 및 빠른 구간 프리셋 적용
// ============================================================================

function syncClipRangeUI(updatePresetSelect = false) {
  const dur = Math.max(0.2, Number(appState.duration || 3.2));
  const minSpan = Math.min(0.10, dur * 0.25);

  let s = clamp(Number(appState.clipStartTime ?? 0), 0, Math.max(0, dur - minSpan));
  let e = clamp(Number(appState.clipEndTime ?? dur), s + minSpan, dur);
  appState.clipStartTime = Number(s.toFixed(2));
  appState.clipEndTime = Number(e.toFixed(2));

  const rStart = $('rangeClipStart');
  const rEnd = $('rangeClipEnd');
  const iStart = $('inputClipStart');
  const iEnd = $('inputClipEnd');
  const fill = $('clipRangeFill');
  const readout = $('clipDurationReadout');
  const btnClipExport = $('btnExportClipVideo');
  const presetSel = $('selectClipPreset');

  if (rStart) {
    rStart.max = String(dur);
    rStart.value = String(appState.clipStartTime);
  }
  if (rEnd) {
    rEnd.max = String(dur);
    rEnd.value = String(appState.clipEndTime);
  }
  if (iStart) {
    iStart.max = String(Math.max(0, dur - minSpan).toFixed(2));
    iStart.value = appState.clipStartTime.toFixed(2);
  }
  if (iEnd) {
    iEnd.max = String(dur.toFixed(2));
    iEnd.value = appState.clipEndTime.toFixed(2);
  }
  if (fill) {
    const leftPct = clamp((appState.clipStartTime / dur) * 100, 0, 100);
    const rightPct = clamp((appState.clipEndTime / dur) * 100, leftPct, 100);
    fill.style.left = `${leftPct.toFixed(2)}%`;
    fill.style.width = `${Math.max(0.5, rightPct - leftPct).toFixed(2)}%`;
  }
  const span = Math.max(0, appState.clipEndTime - appState.clipStartTime);
  if (readout) {
    readout.textContent = `구간 ${appState.clipStartTime.toFixed(2)}s ~ ${appState.clipEndTime.toFixed(2)}s (${span.toFixed(2)}s)`;
  }
  if (btnClipExport && !appState.busy) {
    btnClipExport.textContent = `선택 구간 동영상 저장 (${appState.clipStartTime.toFixed(2)}s~${appState.clipEndTime.toFixed(2)}s)`;
  }
  if (updatePresetSelect && presetSel) {
    presetSel.value = appState.clipPreset || 'all';
  }
}

function applyClipPreset(presetKey) {
  const dur = Math.max(0.2, Number(appState.duration || 3.2));
  const momentsMap = Object.fromEntries((appState.keyMoments || []).map(m => [m.key, m.time]));
  const addr = momentsMap.address ?? 0.45;
  const top = momentsMap.top ?? 1.45;
  const impact = momentsMap.impact ?? (dur * 0.42);
  const follow = momentsMap.follow ?? 2.15;
  const finish = momentsMap.finish ?? dur * 0.85;
  const flightDur = Number(appState.shotTracerOptions?.flightDurationSec || 2.35);
  const rollDur = Number(appState.shotTracerOptions?.rollDurationSec || 0.62);

  appState.clipPreset = presetKey;
  if (presetKey === 'all') {
    appState.clipStartTime = 0;
    appState.clipEndTime = dur;
  } else if (presetKey === 'full-swing') {
    appState.clipStartTime = Math.max(0, addr - 0.12);
    appState.clipEndTime = Math.min(dur, finish + 0.25);
  } else if (presetKey === 'backswing') {
    appState.clipStartTime = Math.max(0, addr - 0.08);
    appState.clipEndTime = Math.min(dur, top + 0.08);
  } else if (presetKey === 'down-impact') {
    appState.clipStartTime = Math.max(0, top - 0.06);
    appState.clipEndTime = Math.min(dur, follow + 0.12);
  } else if (presetKey === 'down-finish') {
    appState.clipStartTime = Math.max(0, top - 0.06);
    appState.clipEndTime = Math.min(dur, finish + 0.25);
  } else if (presetKey === 'shot-flight') {
    appState.clipStartTime = Math.max(0, impact - 0.16);
    appState.clipEndTime = Math.min(dur, impact + flightDur + rollDur + 0.18);
  } else if (presetKey === 'shot-full') {
    appState.clipStartTime = Math.max(0, addr - 0.12);
    appState.clipEndTime = Math.min(dur, impact + flightDur + rollDur + 0.22);
  }

  syncClipRangeUI(true);
}

// ============================================================================
// 메인 캔버스 렌더링 및 재생 루프
// ============================================================================

function renderMainStage() {
  const canvas = $('stageCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  renderCompositeFrame(ctx, canvas.width, canvas.height, appState, appState.currentTime);

  const curFrame = Math.max(1, Math.round(appState.currentTime * appState.fps) + 1);
  const totalFrames = Math.max(1, Math.round(appState.duration * appState.fps));
  const timeText = `${appState.currentTime.toFixed(2)}s / ${appState.duration.toFixed(2)}s (F${curFrame}/${totalFrames})`;
  $('timeReadout').textContent = timeText;
  if ($('fsTimeReadout')) {
    $('fsTimeReadout').textContent = timeText;
  }
  if ($('fsTimelineRange') && document.activeElement !== $('fsTimelineRange')) {
    $('fsTimelineRange').max = String(appState.duration);
    $('fsTimelineRange').value = String(appState.currentTime);
  }
  if ($('badgeCurrentPinFrame')) {
    $('badgeCurrentPinFrame').textContent = `${appState.playing ? '재생 프레임' : '현재 멈춘 프레임'}: F${curFrame} (${appState.currentTime.toFixed(2)}s)`;
  }
}

function startPlayback(clipOnly = false) {
  if (appState.playing) return;
  appState.playing = true;
  appState.playingClipOnly = Boolean(clipOnly);
  if (appState.shotTracerOptions) {
    appState.shotTracerOptions.calibrationPreviewActive = false;
  }

  $('btnPlayPause').textContent = '일시정지';
  $('btnPlayPause').setAttribute('aria-pressed', 'true');
  if ($('btnFsPlayPause')) {
    $('btnFsPlayPause').textContent = '일시정지';
    $('btnFsPlayPause').setAttribute('aria-pressed', 'true');
  }
  if ($('btnPinPauseToggle')) {
    $('btnPinPauseToggle').textContent = '영상 멈춤';
  }
  const clipPlayBtn = $('btnPlayClipRange');
  if (clipPlayBtn) {
    clipPlayBtn.textContent = clipOnly ? '구간 정지' : '선택 구간 재생';
    clipPlayBtn.setAttribute('aria-pressed', String(Boolean(clipOnly)));
  }

  const playStartBound = clipOnly ? appState.clipStartTime : 0;
  const playEndBound = clipOnly ? appState.clipEndTime : appState.duration;

  if (clipOnly) {
    if (appState.currentTime < playStartBound || appState.currentTime >= playEndBound - 0.03) {
      appState.currentTime = playStartBound;
    }
  } else {
    const finishMoment = appState.keyMoments.find(m => m.key === 'finish');
    const impMoment = appState.keyMoments.find(m => m.key === 'impact');
    let resetThreshold;
    if (appState.studioMode === 'shot-tracer') {
      const impT = Number(appState.shotTracerOptions?.calibratedImpactTime ?? impMoment?.time ?? (appState.duration * 0.35));
      const flightSpan = Number(appState.shotTracerOptions?.flightDurationSec || 2.35) + Number(appState.shotTracerOptions?.rollDurationSec || 0.45);
      resetThreshold = Math.min(impT + flightSpan - 0.04, appState.duration - 0.05);
    } else {
      resetThreshold = finishMoment
        ? Math.min(finishMoment.time - 0.03, appState.duration - 0.05)
        : appState.duration - 0.05;
    }

    if (appState.currentTime >= resetThreshold) {
      appState.currentTime = 0;
    }
  }

  if (appState.sourceMode === 'video' && appState.videoElement && appState.videoReady) {
    const video = appState.videoElement;
    try {
      video.currentTime = appState.currentTime;
      video.playbackRate = clamp(appState.playbackSpeed, 0.1, 2.0);
      void video.play().catch(() => {});
    } catch {
      // 브라우저 정책으로 자동 재생 지연 시 tick 루프에서 프레임 동기화 수행
    }
  }

  lastFrameTimestamp = performance.now();

  const tick = now => {
    if (!appState.playing) return;
    const dt = Math.min(0.08, (now - lastFrameTimestamp) / 1000);
    lastFrameTimestamp = now;
    const activeEndBound = appState.playingClipOnly ? appState.clipEndTime : appState.duration;

    if (appState.sourceMode === 'video' && appState.videoElement && appState.videoReady) {
      const video = appState.videoElement;
      if (!video.paused && !video.ended && !video.seeking) {
        // 실제 비디오 하드웨어 디코더가 재생 중일 때는 비디오 클럭과 완벽히 동기화
        appState.currentTime = video.currentTime;
      } else {
        // 초저속(0.1x 등) 또는 시크 대기 중일 때는 타이머로 전진하며 비동기 시크 병목 없이 프레임 캔버스와 연동
        appState.currentTime += dt * appState.playbackSpeed;
        if (!video.seeking && Math.abs(video.currentTime - appState.currentTime) > 0.07) {
          try {
            video.currentTime = clamp(appState.currentTime, 0, activeEndBound);
          } catch {
            // 시크 예외 무시
          }
        }
      }
      if (video.ended || appState.currentTime >= activeEndBound - 0.01) {
        appState.currentTime = activeEndBound;
        stopPlayback();
      }
    } else {
      appState.currentTime += dt * appState.playbackSpeed;
      if (appState.currentTime >= activeEndBound) {
        appState.currentTime = activeEndBound;
        stopPlayback();
      }
    }

    $('timelineRange').value = String(appState.currentTime);
    if ($('fsTimelineRange')) {
      $('fsTimelineRange').value = String(appState.currentTime);
    }

    renderMainStage();
    updateMetricsAndCoachingUI();

    if (appState.playing) {
      rafId = requestAnimationFrame(tick);
    }
  };

  rafId = requestAnimationFrame(tick);
}

function stopPlayback() {
  appState.playing = false;
  appState.playingClipOnly = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (appState.videoElement && !appState.videoElement.paused) {
    try {
      appState.videoElement.pause();
    } catch {
      // 일시정지 예외 무시
    }
  }
  const btn = $('btnPlayPause');
  if (btn) {
    btn.textContent = '재생';
    btn.setAttribute('aria-pressed', 'false');
  }
  if ($('btnFsPlayPause')) {
    $('btnFsPlayPause').textContent = '재생';
    $('btnFsPlayPause').setAttribute('aria-pressed', 'false');
  }
  if ($('btnPinPauseToggle')) {
    $('btnPinPauseToggle').textContent = '재생/멈춤';
  }
  const clipPlayBtn = $('btnPlayClipRange');
  if (clipPlayBtn) {
    clipPlayBtn.textContent = '선택 구간 재생';
    clipPlayBtn.setAttribute('aria-pressed', 'false');
  }
}

async function seekToTime(targetTime) {
  appState.currentTime = clamp(targetTime, 0, appState.duration);
  $('timelineRange').value = String(appState.currentTime);
  if ($('fsTimelineRange')) {
    $('fsTimelineRange').value = String(appState.currentTime);
  }
  if (appState.sourceMode === 'video' && appState.videoElement && appState.videoReady) {
    await seekVideoSafely(appState.videoElement, appState.currentTime);
  }
  if (appState.studioMode === 'shot-tracer' && !appState.playing) {
    syncShotTracerUI();
  }
  renderMainStage();
  updateMetricsAndCoachingUI();
  highlightActiveFilmstripCard();
}

// ============================================================================
// 7단계 스윙 시퀀스 필름스트립 렌더링
// ============================================================================

async function renderPhaseFilmstrip() {
  const container = $('phaseFilmstrip');
  if (!container) return;

  await runWithBusyOverlay(
    {
      title: '7단계 스윙 시퀀스 데이터 처리 및 화면 갱신 중...',
      stepText: '구간별 클럽 헤드 잔상 썸네일 렌더링 중',
      thresholdMs: 380
    },
    async reportProgress => {
      container.replaceChildren();
      const moments = appState.keyMoments || [];
      let lastYield = performance.now();

      for (let i = 0; i < moments.length; i++) {
        const m = moments[i];
        const card = document.createElement('article');
        card.className = `phase-card${m.key === appState.selectedPhaseKey ? ' is-selected' : ''}`;
        card.dataset.phaseKey = m.key;

        const header = document.createElement('div');
        header.className = 'phase-card-header';
        header.innerHTML = `
          <span class="phase-step-num" style="border-color:${MOMENT_COLORS[m.key]}">0${i + 1}</span>
          <strong class="phase-step-name">${m.labelKo}</strong>
          <span class="phase-step-time">${m.time.toFixed(2)}s</span>
        `;

        const thumbWrap = document.createElement('button');
        thumbWrap.type = 'button';
        thumbWrap.className = 'phase-thumb-btn';
        thumbWrap.setAttribute('aria-label', `${m.labelKo} 프레임으로 이동 (${m.time.toFixed(2)}초)`);

        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = 320;
        thumbCanvas.height = 180;
        thumbWrap.appendChild(thumbCanvas);

        thumbWrap.onclick = () => {
          stopPlayback();
          appState.selectedPhaseKey = m.key;
          void seekToTime(m.time);
        };

        const footer = document.createElement('div');
        footer.className = 'phase-card-footer';
        const setBtn = document.createElement('button');
        setBtn.type = 'button';
        setBtn.className = 'btn-GhostSmall';
        setBtn.textContent = '현재 프레임으로 지정';
        setBtn.onclick = e => {
          e.stopPropagation();
          m.time = Number(appState.currentTime.toFixed(3));
          m.source = 'marked';
          appState.selectedPhaseKey = m.key;
          void renderPhaseFilmstrip();
          renderMainStage();
          updateMetricsAndCoachingUI();
          setStatusMessage(`${m.labelKo} 시점을 ${m.time.toFixed(2)}초 프레임으로 업데이트했습니다.`);
        };
        footer.appendChild(setBtn);

        card.append(header, thumbWrap, footer);
        container.appendChild(card);

        if (performance.now() - lastYield > 26) {
          reportProgress(
            Math.round(((i + 0.5) / Math.max(1, moments.length)) * 95),
            `7단계 스윙 시퀀스 렌더링 중 (${i + 1}/${moments.length} · ${m.labelKo})`
          );
          await new Promise(r => setTimeout(r, 0));
          lastYield = performance.now();
        }

        // 썸네일 캔버스 렌더링 (해당 구간까지의 누적 클럽 헤드 잔상 포함)
        if (appState.sourceMode === 'video' && appState.videoElement && appState.videoReady) {
          await seekVideoSafely(appState.videoElement, m.time);
        }
        const tCtx = thumbCanvas.getContext('2d');
        renderCompositeFrame(tCtx, thumbCanvas.width, thumbCanvas.height, appState, m.time, {
          ...appState.renderOptions,
          showAngles: false,
          showHud: false
        });
      }

      if (appState.sourceMode === 'video' && appState.videoElement && appState.videoReady) {
        await seekVideoSafely(appState.videoElement, appState.currentTime);
      }
    }
  );
}

function renderShotFlightStepsStrip() {
  const container = $('shotFlightStepsStrip');
  if (!container) return;
  container.replaceChildren();

  const dur = Math.max(0.5, Number(appState.duration || 3.2));
  const impMoment = (appState.keyMoments || []).find(m => m.key === 'impact');
  const impT = impMoment ? impMoment.time : dur * 0.42;
  const st = appState.shotTracerOptions || {};
  const flightDur = Number(st.flightDurationSec || 2.35);
  const rollDur = Number(st.rollDurationSec || 0.62);
  const apexM = Number(st.apexMeters || 27.5);
  const carryM = Number(st.carryMeters || 198.5);
  const rollM = Number(st.rollMeters || 13.5);
  const totalM = carryM + rollM;
  const launchDeg = Number(st.launchAngleDeg || 13.8);
  const shapeInfo = classifyShotShapeLabel(st.sideCurveMeters ?? -4.5, st.launchDirectionDeg ?? 0, st.shotShapeType || 'auto');

  const steps = [
    {
      key: 'origin',
      num: '01',
      title: '임팩트 · 공 출발',
      time: clamp(impT, 0, dur),
      meta: `발사각 ${launchDeg.toFixed(1)}° · 볼스피드 ${Number(st.ballSpeedMps || 63.5).toFixed(1)}m/s`
    },
    {
      key: 'climb',
      num: '02',
      title: '초기 상승 추적',
      time: clamp(impT + Math.min(0.28, flightDur * 0.16), 0, dur),
      meta: `구질 ${shapeInfo.nameKo} · 상승 포물선 구간`
    },
    {
      key: 'apex',
      num: '03',
      title: '최고점 APEX 도달',
      time: clamp(impT + flightDur * 0.54, 0, dur),
      meta: `최고 높이 APEX ${apexM.toFixed(1)} m`
    },
    {
      key: 'landing',
      num: '04',
      title: '페어웨이 탄착 (캐리)',
      time: clamp(impT + flightDur, 0, dur),
      meta: `탄착 캐리 거리 ${carryM.toFixed(1)} m`
    },
    {
      key: 'roll-end',
      num: '05',
      title: '최종 정지 (런 포함)',
      time: clamp(impT + flightDur + rollDur, 0, Math.max(0.2, dur - 0.04)),
      meta: `런 +${rollM.toFixed(1)}m · 최종 ${totalM.toFixed(1)} m`
    }
  ];

  let nearestKey = steps[0].key;
  let minDiff = Infinity;
  for (const s of steps) {
    const diff = Math.abs(appState.currentTime - s.time);
    if (diff < minDiff) {
      minDiff = diff;
      nearestKey = s.key;
    }
  }

  for (const s of steps) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `shot-step-card${s.key === nearestKey ? ' is-selected' : ''}`;
    btn.dataset.shotStepKey = s.key;
    btn.dataset.shotStepTime = String(s.time);
    btn.innerHTML = `
      <div class="shot-step-head">
        <span class="shot-step-badge">${s.num}</span>
        <span class="shot-step-time">${s.time.toFixed(2)}s</span>
      </div>
      <strong class="shot-step-title">${s.title}</strong>
      <span class="shot-step-meta">${s.meta}</span>
    `;
    btn.onclick = () => {
      stopPlayback();
      void seekToTime(s.time);
      setStatusMessage(`[${s.title}] 시점(${s.time.toFixed(2)}s)으로 이동했습니다.`);
    };
    container.appendChild(btn);
  }
}

function highlightActiveFilmstripCard() {
  const cards = document.querySelectorAll('.phase-card');
  cards.forEach(c => {
    c.classList.toggle('is-selected', c.dataset.phaseKey === appState.selectedPhaseKey);
  });

  const shotCards = document.querySelectorAll('.shot-step-card');
  if (shotCards.length > 0) {
    let bestCard = null;
    let minDiff = Infinity;
    shotCards.forEach(c => {
      const t = Number(c.dataset.shotStepTime || 0);
      const d = Math.abs(appState.currentTime - t);
      if (d < minDiff) {
        minDiff = d;
        bestCard = c;
      }
    });
    shotCards.forEach(c => {
      c.classList.toggle('is-selected', c === bestCard);
    });
  }
}

// ============================================================================
// 우측 측정 지표 및 AI 스윙 진단 패널 업데이트
// ============================================================================

function updateMetricsAndCoachingUI() {
  const sample = findNearestSample(appState.samples, appState.currentTime);
  if (!sample) return;

  const meas = measurements(sample.points, appState.canvasWidth, appState.canvasHeight, appState.hand);
  const momentsMap = Object.fromEntries((appState.keyMoments || []).map(m => [m.key, m.time]));
  const tempoInfo = calculateTempo(momentsMap);

  const addrSample = findNearestSample(appState.samples, momentsMap.address ?? 0.45);
  const addrMeas = addrSample
    ? measurements(addrSample.points, appState.canvasWidth, appState.canvasHeight, appState.hand)
    : null;

  $('metricTempo').textContent = tempoInfo ? `${tempoInfo.ratio.toFixed(2)} : 1` : '—';
  $('metricTempoSub').textContent = tempoInfo
    ? `백스윙 ${tempoInfo.backswingSec.toFixed(2)}s / 다운스윙 ${tempoInfo.downswingSec.toFixed(2)}s`
    : '어드레스·탑·임팩트 기준';

  $('metricClubSpeed').textContent = sample.clubSpeed ? `${sample.clubSpeed} mph` : '—';
  $('metricLeadElbow').textContent = Number.isFinite(meas.elbow) ? `${Math.round(meas.elbow)}°` : '—';
  $('metricSpineLean').textContent = Number.isFinite(meas.lean) ? `${Math.round(meas.lean)}°` : '—';
  $('metricLeadKnee').textContent = Number.isFinite(meas.knee) ? `${Math.round(meas.knee)}°` : '—';
  $('metricWristCock').textContent = Number.isFinite(meas.wrist) ? `${Math.round(meas.wrist)}°` : '—';

  // 가장 가까운 스윙 구간 판별 후 코칭 메시지 출력
  let nearestPhase = appState.keyMoments?.[0];
  let minD = Infinity;
  for (const m of appState.keyMoments || []) {
    const d = Math.abs(appState.currentTime - m.time);
    if (d < minD) {
      minD = d;
      nearestPhase = m;
    }
  }
  const activeKey = nearestPhase?.key || 'impact';
  appState.selectedPhaseKey = activeKey;
  highlightActiveFilmstripCard();

  const feedbackItems = evaluateSwingPhase(activeKey, meas, addrMeas, tempoInfo);
  const listEl = $('coachingFeedbackList');
  if (listEl) {
    listEl.replaceChildren();
    for (const item of feedbackItems) {
      const li = document.createElement('li');
      li.className = `coaching-item status-${item.status}`;
      li.innerHTML = `
        <div class="coaching-item-head">
          <span class="coaching-badge">${item.status === 'good' ? '양호' : '점검'}</span>
          <strong>${item.title}</strong>
        </div>
        <p>${item.detail}</p>
      `;
      listEl.appendChild(li);
    }
  }
}

function setStatusMessage(msg) {
  const el = $('statusBannerText');
  if (el) el.textContent = msg;
  if (busyOverlayState.activeDepth > 0 && msg) {
    updateGlobalBusyOverlay({ sub: msg });
  }
}

// ============================================================================
// UI 컨트롤 및 클럽 헤드 수동 핀 고정 바인딩
// ============================================================================

function bindControls() {
  // 상단 접이식(Collapsible) 전체 메뉴 아이콘 토글 및 외부 영역 클릭·ESC 닫기 바인딩
  const toggleTopMenu = () => {
    const panel = $('topMenuDropdownPanel');
    const isCurrentlyOpen = panel && !panel.hidden;
    setTopMenuOpen(!isCurrentlyOpen);
  };

  let topMenuTouchStartY = 0;
  let topMenuTouchStartX = 0;
  let topMenuTouchStartScrollTop = 0;
  let topMenuLastTouchY = 0;
  let topMenuLastTouchTime = 0;
  let topMenuVelocityY = 0;
  let topMenuInertiaRafId = 0;
  let wasMenuTouchScroll = false;

  const stopTopMenuInertia = () => {
    if (topMenuInertiaRafId) {
      cancelAnimationFrame(topMenuInertiaRafId);
      topMenuInertiaRafId = 0;
    }
  };

  if ($('btnTopMenuToggle')) {
    $('btnTopMenuToggle').onclick = e => {
      e.stopPropagation();
      stopTopMenuInertia();
      toggleTopMenu();
    };
  }
  if ($('btnTopCurrentMode')) {
    $('btnTopCurrentMode').onclick = e => {
      e.stopPropagation();
      stopTopMenuInertia();
      toggleTopMenu();
    };
  }
  if ($('btnCloseTopMenu')) {
    $('btnCloseTopMenu').onclick = () => {
      stopTopMenuInertia();
      setTopMenuOpen(false);
    };
  }
  if ($('topMenuBackdrop')) {
    $('topMenuBackdrop').onclick = () => {
      if (wasMenuTouchScroll) {
        wasMenuTouchScroll = false;
        return;
      }
      stopTopMenuInertia();
      setTopMenuOpen(false);
    };
  }

  // 메뉴창이 열려 있는 동안 스크롤(마우스 휠 / 모바일 터치 드래그) 시 뒤쪽 영상이나 배경 페이지가 스크롤되지 않고
  // 항상 메뉴 팝업(#topMenuSectionsWrap)만 스크롤되도록 캡처 단계에서 직접 구동
  window.addEventListener(
    'wheel',
    e => {
      const panel = $('topMenuDropdownPanel');
      if (!panel || panel.hidden) return;
      stopTopMenuInertia();
      e.preventDefault();
      e.stopPropagation();
      const sectionsWrap = $('topMenuSectionsWrap') || panel.querySelector('.top-menu-sections-wrap');
      if (!sectionsWrap) return;
      const deltaPx = e.deltaMode === 1
        ? e.deltaY * 28
        : (e.deltaMode === 2 ? e.deltaY * 260 : e.deltaY);
      sectionsWrap.scrollTop += deltaPx;
    },
    { passive: false, capture: true }
  );

  window.addEventListener(
    'touchstart',
    e => {
      const panel = $('topMenuDropdownPanel');
      if (!panel || panel.hidden || !e.touches?.length) return;
      stopTopMenuInertia();
      const sectionsWrap = $('topMenuSectionsWrap') || panel.querySelector('.top-menu-sections-wrap');
      topMenuTouchStartY = e.touches[0].clientY;
      topMenuTouchStartX = e.touches[0].clientX;
      topMenuLastTouchY = topMenuTouchStartY;
      topMenuLastTouchTime = performance.now();
      topMenuVelocityY = 0;
      topMenuTouchStartScrollTop = sectionsWrap ? sectionsWrap.scrollTop : 0;
      wasMenuTouchScroll = false;
    },
    { passive: true, capture: true }
  );

  window.addEventListener(
    'touchmove',
    e => {
      const panel = $('topMenuDropdownPanel');
      if (!panel || panel.hidden || !e.touches?.length) return;
      const sectionsWrap = $('topMenuSectionsWrap') || panel.querySelector('.top-menu-sections-wrap');
      const curY = e.touches[0].clientY;
      const curX = e.touches[0].clientX;
      const dy = topMenuTouchStartY - curY;
      const dx = topMenuTouchStartX - curX;

      if (Math.abs(dy) > 4 || Math.abs(dx) > 4 || wasMenuTouchScroll) {
        wasMenuTouchScroll = true;
        e.preventDefault();
        e.stopPropagation();
        if (sectionsWrap) {
          sectionsWrap.scrollTop = topMenuTouchStartScrollTop + dy;
        }
        const now = performance.now();
        const dt = Math.max(1, now - topMenuLastTouchTime);
        const stepDy = topMenuLastTouchY - curY;
        topMenuVelocityY = topMenuVelocityY * 0.35 + (stepDy / dt) * 0.65;
        topMenuLastTouchY = curY;
        topMenuLastTouchTime = now;
      }
    },
    { passive: false, capture: true }
  );

  window.addEventListener(
    'touchend',
    () => {
      const panel = $('topMenuDropdownPanel');
      if (!panel || panel.hidden || !wasMenuTouchScroll) return;
      const sectionsWrap = $('topMenuSectionsWrap') || panel.querySelector('.top-menu-sections-wrap');
      if (sectionsWrap && Math.abs(topMenuVelocityY) > 0.12) {
        let v = topMenuVelocityY * 16;
        const stepInertia = () => {
          if (!sectionsWrap || panel.hidden || Math.abs(v) < 0.45) {
            topMenuInertiaRafId = 0;
            return;
          }
          const prevTop = sectionsWrap.scrollTop;
          sectionsWrap.scrollTop += v;
          if (Math.abs(sectionsWrap.scrollTop - prevTop) < 0.2) {
            topMenuInertiaRafId = 0;
            return;
          }
          v *= 0.91;
          topMenuInertiaRafId = requestAnimationFrame(stepInertia);
        };
        topMenuInertiaRafId = requestAnimationFrame(stepInertia);
      }
      setTimeout(() => {
        wasMenuTouchScroll = false;
      }, 80);
    },
    { passive: true, capture: true }
  );

  window.addEventListener(
    'click',
    e => {
      const panel = $('topMenuDropdownPanel');
      if (!panel || panel.hidden) return;
      if (wasMenuTouchScroll) {
        e.preventDefault();
        e.stopPropagation();
        wasMenuTouchScroll = false;
      }
    },
    true
  );

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const panel = $('topMenuDropdownPanel');
      if (panel && !panel.hidden) {
        setTopMenuOpen(false);
        return;
      }
      if (isStageFullscreenActive()) {
        exitStageFullscreen();
      }
    }
  });

  // 스튜디오 분석 모드 전환 (스윙 클럽 잔상 분석 vs 후방 공 궤적 샷 트레이서)
  const btnModeAfter = $('btnModeAfterimage');
  const btnModeShot = $('btnModeShotTracer');
  if (btnModeAfter) {
    btnModeAfter.onclick = () => {
      setTopMenuOpen(false);
      switchStudioMode('afterimage');
    };
  }
  if (btnModeShot) {
    btnModeShot.onclick = () => {
      setTopMenuOpen(false);
      switchStudioMode('shot-tracer');
    };
  }
  if ($('btnQuickModeAfterimage')) {
    $('btnQuickModeAfterimage').onclick = () => {
      setTopMenuOpen(false);
      switchStudioMode('afterimage');
    };
  }
  if ($('btnQuickModeShotTracer')) {
    $('btnQuickModeShotTracer').onclick = () => {
      setTopMenuOpen(false);
      switchStudioMode('shot-tracer');
    };
  }

  // 상단 영상 패널 분할 방식 전환 (+1 분할 [2분할·최적 기본값] vs +2 분할 [3분할·비교 테스트])
  const btnSplitOne = $('btnSplitPlusOne');
  const btnSplitTwo = $('btnSplitPlusTwo');
  const setHeroSplitMode = isPlusTwo => {
    const layoutEl = $('studioLayout');
    if (layoutEl) {
      layoutEl.classList.toggle('is-split-plus-two', Boolean(isPlusTwo));
    }
    if (btnSplitOne) {
      btnSplitOne.classList.toggle('is-active', !isPlusTwo);
      btnSplitOne.setAttribute('aria-pressed', String(!isPlusTwo));
    }
    if (btnSplitTwo) {
      btnSplitTwo.classList.toggle('is-active', Boolean(isPlusTwo));
      btnSplitTwo.setAttribute('aria-pressed', String(Boolean(isPlusTwo)));
    }
    setStatusMessage(
      isPlusTwo
        ? '상단 영상 패널 +2 분할(3분할 비교 모드): 영상 뷰포트 | 위치 보정·실시간 지표 | 구간 영상추출 편집을 3열로 나란히 배치했습니다.'
        : '상단 영상 패널 +1 분할(2분할 최적 모드): 영상 뷰포트 | 영상 직결 조작 독(보정+구간추출)으로 배치하고 하단에 와이드 시퀀스를 펼쳐 시인성과 조작 동선을 최적화했습니다.'
    );
  };
  if (btnSplitOne) btnSplitOne.onclick = () => setHeroSplitMode(false);
  if (btnSplitTwo) btnSplitTwo.onclick = () => setHeroSplitMode(true);

  // 파일 업로드 및 데모 프리셋 전환
  $('btnUploadVideo').onclick = () => {
    setTopMenuOpen(false);
    $('videoFileInput').click();
  };
  if ($('btnQuickUploadVideo')) {
    $('btnQuickUploadVideo').onclick = () => {
      setTopMenuOpen(false);
      $('videoFileInput').click();
    };
  }
  $('videoFileInput').onchange = e => {
    const file = e.target.files?.[0];
    if (file) void handleVideoFileUpload(file);
  };

  $('selectDemoPreset').onchange = e => {
    const val = e.target.value;
    setTopMenuOpen(false);
    if (val === 'driver-fo' || val === 'iron-dtl' || val === 'shot-tracer-dtl') {
      loadDemoPreset(val);
    }
  };

  // 드래그 앤 드롭 비디오 로드
  const stageWrap = $('stageViewport');
  stageWrap.addEventListener('dragover', e => {
    e.preventDefault();
    stageWrap.classList.add('is-dragover');
  });
  stageWrap.addEventListener('dragleave', () => stageWrap.classList.remove('is-dragover'));
  stageWrap.addEventListener('drop', e => {
    e.preventDefault();
    stageWrap.classList.remove('is-dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleVideoFileUpload(file);
  });

  // 영상 미리보기 화면 전용 마우스 위치 기준 확대/축소 및 좌우·상하 스크롤 컨트롤
  const zoomScrollEl = $('stageZoomScroll');
  const canvasElForZoom = $('stageCanvas');

  stageWrap.addEventListener('mousemove', e => {
    if (!canvasElForZoom) return;
    const cRect = canvasElForZoom.getBoundingClientRect();
    if (
      cRect.width > 0 &&
      cRect.height > 0 &&
      e.clientX >= cRect.left &&
      e.clientX <= cRect.right &&
      e.clientY >= cRect.top &&
      e.clientY <= cRect.bottom
    ) {
      appState.lastHoverNormX = clamp((e.clientX - cRect.left) / cRect.width, 0, 1);
      appState.lastHoverNormY = clamp((e.clientY - cRect.top) / cRect.height, 0, 1);
      if (appState.viewportZoom > 1.01) {
        syncViewportZoomUI();
      }
      if (appState.studioMode === 'shot-tracer' && appState.shotTracerOptions?.pinTargetMode) {
        appState.shotTracerOptions.hoverNormPoint = {
          x: Number(appState.lastHoverNormX.toFixed(4)),
          y: Number(appState.lastHoverNormY.toFixed(4))
        };
        if (!appState.playing) {
          renderMainStage();
        }
      }
    }
  });

  stageWrap.addEventListener('mouseleave', () => {
    if (appState.shotTracerOptions?.hoverNormPoint) {
      appState.shotTracerOptions.hoverNormPoint = null;
      if (appState.studioMode === 'shot-tracer' && !appState.playing) {
        renderMainStage();
      }
    }
  });

  stageWrap.addEventListener(
    'wheel',
    e => {
      // Shift+휠은 좌우 스크롤을 허용하고, 일반 마우스 휠은 커서가 위치한 지점을 기준으로 미리보기 화면만 확대/축소
      if (e.shiftKey && appState.viewportZoom > 1.01) return;
      e.preventDefault();
      const step = e.deltaY < 0 ? 0.25 : -0.25;
      const nextZoom = clamp((appState.viewportZoom || 1) + step, 1.0, 5.0);
      setViewportZoom(nextZoom, e.clientX, e.clientY);
    },
    { passive: false }
  );

  // 확대 상태에서 마우스 드래그로 좌우·상하 이동 지원 (클릭과 드래그를 구분하여 공 위치 지정 클릭과 충돌 방지)
  if (zoomScrollEl) {
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartScrollL = 0;
    let panStartScrollT = 0;

    zoomScrollEl.addEventListener('mousedown', e => {
      if (e.button !== 0 || (appState.viewportZoom || 1) <= 1.01) return;
      isPanning = true;
      appState.wasZoomPanDrag = false;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartScrollL = zoomScrollEl.scrollLeft;
      panStartScrollT = zoomScrollEl.scrollTop;
    });

    window.addEventListener('mousemove', e => {
      if (!isPanning) return;
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      if (Math.hypot(dx, dy) > 5) {
        appState.wasZoomPanDrag = true;
        zoomScrollEl.scrollLeft = panStartScrollL - dx;
        zoomScrollEl.scrollTop = panStartScrollT - dy;
      }
    });

    window.addEventListener('mouseup', () => {
      if (!isPanning) return;
      isPanning = false;
      if (appState.wasZoomPanDrag) {
        setTimeout(() => {
          appState.wasZoomPanDrag = false;
        }, 60);
      }
    });
  }

  if ($('btnZoomIn')) {
    $('btnZoomIn').onclick = () => {
      setViewportZoom(clamp((appState.viewportZoom || 1) + 0.25, 1.0, 5.0));
    };
  }
  if ($('btnZoomOut')) {
    $('btnZoomOut').onclick = () => {
      setViewportZoom(clamp((appState.viewportZoom || 1) - 0.25, 1.0, 5.0));
    };
  }
  if ($('rangeViewportZoom')) {
    $('rangeViewportZoom').oninput = e => {
      setViewportZoom(Number(e.target.value || 1));
    };
  }
  document.querySelectorAll('.btn-zoom-preset').forEach(btn => {
    btn.onclick = () => {
      const targetZ = Number(btn.dataset.zoomPreset || 1);
      setViewportZoom(targetZ);
    };
  });

  // 지면·사람 위치 고정(Stay Lock) 화면 제어 바 이벤트 바인딩 (0.5초 이상 소요 시 최상단 애니메이션 표시)
  const applyStabilizationChange = (statusMsg, forceProfile = false) =>
    runWithBusyOverlay(
      {
        title: '지면·사람 고정(Stay) 프레임 화면 갱신 중',
        sub: statusMsg || '전체 동영상 프레임의 지면·사람 기준선 정합을 재계산하고 있습니다...',
        stepText: '프레임 정합 적용 중...'
      },
      async ({ setProgress }) => {
        if (appState.sourceMode === 'video' && appState.samples.length > 0) {
          const summary = await recomputeSamplesStabilizationAsync(
            appState.samples,
            appState.stabilizationOptions,
            {
              forceProfileRecompute: forceProfile,
              onProgress: (pct, stepLabel) => {
                setProgress(pct, stepLabel);
              }
            }
          );
          appState.stabilizationOptions.maxDetectedShiftX = summary.maxShiftX;
          appState.stabilizationOptions.maxDetectedShiftY = summary.maxShiftY;
        }
        syncStabilizationUI();
        renderMainStage();
        if (appState.studioMode === 'shot-tracer') {
          renderShotFlightStepsStrip();
        } else {
          await renderPhaseFilmstrip();
        }
        if (statusMsg) setStatusMessage(statusMsg);
      }
    );

  if ($('selectStabCropMode')) {
    $('selectStabCropMode').onchange = e => {
      const val = e.target.value || 'crop-matte';
      appState.stabilizationOptions.cropMode = val;
      appState.stabilizationOptions.enabled = val !== 'off';
      const modeNameMap = {
        'crop-matte': '위·아래 잘림 고정 모드: 영상 위·아래가 일부 잘리더라도 스윙한 사람과 지면 위치를 100% 그대로 스테이(Stay)합니다.',
        'auto-zoom': '자동 줌인 고정 모드: 잘린 상하 여백이 보이지 않도록 미세 줌인하여 사람과 지면을 고정합니다.',
        off: '지면·사람 위치 고정을 해제하고 원본 비디오 프레임을 표시합니다.'
      };
      void applyStabilizationChange(modeNameMap[val], false);
    };
  }

  if ($('btnSetStabRefFrame')) {
    $('btnSetStabRefFrame').onclick = () => {
      stopPlayback();
      const curT = Number(appState.currentTime.toFixed(3));
      const curFrame = Math.max(1, Math.round(curT * (appState.fps || 30)) + 1);
      const curSample = findNearestSample(appState.samples, curT);
      appState.stabilizationOptions.enabled = true;
      if (appState.stabilizationOptions.cropMode === 'off') {
        appState.stabilizationOptions.cropMode = 'crop-matte';
      }
      appState.stabilizationOptions.referenceTime = curT;
      if (curSample?.points) {
        appState.stabilizationOptions.golferAnchorPoint = extractGolferStanceAnchorFromPoints(curSample.points);
      }
      if (appState.shotTracerOptions?.originPoint) {
        const oPt = appState.shotTracerOptions.originPoint;
        appState.stabilizationOptions.groundAnchorPoint = {
          x: clamp(oPt.x, 0.15, 0.85),
          y: clamp(oPt.y + 0.015, 0.45, 0.92)
        };
      }
      void applyStabilizationChange(
        `현재 프레임(F${curFrame} · ${curT.toFixed(2)}s)의 스윙한 사람과 지면 높이를 전체 동영상의 고정 기준(Stay) 위치로 설정했습니다.`,
        true
      );
    };
  }

  if ($('btnPinGroundStay')) {
    $('btnPinGroundStay').onclick = () => {
      stopPlayback();
      const nextMode = !appState.stabilizationOptions.groundPinMode;
      appState.stabilizationOptions.groundPinMode = nextMode;
      if (nextMode) {
        appState.manualPinMode = false;
        if (appState.shotTracerOptions) appState.shotTracerOptions.pinTargetMode = null;
        syncShotTracerUI();
      }
      $('stageCanvas').style.cursor = nextMode
        ? 'crosshair'
        : ((appState.viewportZoom || 1) > 1.01 ? 'grab' : 'default');
      syncStabilizationUI();
      renderMainStage();
      const curFrame = Math.max(1, Math.round(appState.currentTime * (appState.fps || 30)) + 1);
      setStatusMessage(
        nextMode
          ? `현재 프레임(F${curFrame}) 화면에서 실제 지면(티매트)이나 발 위치를 클릭하면 기준 지면 고정선 높이에 맞춰 화면이 즉시 고정됩니다.`
          : '지면·발 고정점 클릭 맞추기 모드를 종료했습니다.'
      );
    };
  }

  if ($('btnStabShiftUp')) {
    $('btnStabShiftUp').onclick = () => {
      appState.stabilizationOptions.enabled = true;
      if (appState.stabilizationOptions.cropMode === 'off') {
        appState.stabilizationOptions.cropMode = 'crop-matte';
      }
      // 화면을 위로 올리려면 effOffset.dy를 증가(shiftY = -effOffset.dy * height < 0)
      appState.stabilizationOptions.manualOffsetY = clamp(
        Number((Number(appState.stabilizationOptions.manualOffsetY || 0) + 0.01).toFixed(3)),
        -0.22,
        0.22
      );
      void applyStabilizationChange('지면·사람 고정 화면 높이를 위로 1% 미세 조정했습니다.', false);
    };
  }

  if ($('btnStabShiftDown')) {
    $('btnStabShiftDown').onclick = () => {
      appState.stabilizationOptions.enabled = true;
      if (appState.stabilizationOptions.cropMode === 'off') {
        appState.stabilizationOptions.cropMode = 'crop-matte';
      }
      appState.stabilizationOptions.manualOffsetY = clamp(
        Number((Number(appState.stabilizationOptions.manualOffsetY || 0) - 0.01).toFixed(3)),
        -0.22,
        0.22
      );
      void applyStabilizationChange('지면·사람 고정 화면 높이를 아래로 1% 미세 조정했습니다.', false);
    };
  }

  if ($('btnResetStabLock')) {
    $('btnResetStabLock').onclick = () => {
      appState.stabilizationOptions.groundPinMode = false;
      appState.stabilizationOptions.manualOffsetX = 0;
      appState.stabilizationOptions.manualOffsetY = 0;
      appState.stabilizationOptions.customKeyframes = [];
      appState.stabilizationOptions.enabled = true;
      appState.stabilizationOptions.cropMode = 'crop-matte';
      void applyStabilizationChange('수동 지면 고정 보정치를 초기화하고 자동 지면·사람 고정 상태로 복원했습니다.', false);
    };
  }

  // 재생 및 프레임 이동 (기본 컨트롤 + 전체화면 컨트롤 동기화)
  const applyPlaybackSpeedChange = nextSpeed => {
    appState.playbackSpeed = Number(nextSpeed) || 0.5;
    if ($('selectPlaybackSpeed') && $('selectPlaybackSpeed').value !== String(appState.playbackSpeed)) {
      $('selectPlaybackSpeed').value = String(appState.playbackSpeed);
    }
    if ($('selectFsPlaybackSpeed') && $('selectFsPlaybackSpeed').value !== String(appState.playbackSpeed)) {
      $('selectFsPlaybackSpeed').value = String(appState.playbackSpeed);
    }
    if (appState.sourceMode === 'video' && appState.videoElement && appState.videoReady) {
      try {
        appState.videoElement.playbackRate = clamp(appState.playbackSpeed, 0.1, 2.0);
      } catch {
        // playbackRate 범위 예외 무시
      }
    }
  };

  $('btnPlayPause').onclick = () => {
    if (appState.playing) stopPlayback();
    else startPlayback();
  };

  $('btnPrevFrame').onclick = () => {
    stopPlayback();
    void seekToTime(appState.currentTime - 1 / appState.fps);
  };

  $('btnNextFrame').onclick = () => {
    stopPlayback();
    void seekToTime(appState.currentTime + 1 / appState.fps);
  };

  $('btnJumpImpact').onclick = () => {
    stopPlayback();
    const imp = appState.keyMoments.find(m => m.key === 'impact');
    if (imp) void seekToTime(imp.time);
  };

  $('timelineRange').oninput = e => {
    stopPlayback();
    void seekToTime(Number(e.target.value));
  };

  $('selectPlaybackSpeed').onchange = e => {
    applyPlaybackSpeedChange(e.target.value);
  };

  // 전체화면 재생 진입 / 종료 / 컨트롤 바인딩
  if ($('btnStageFullscreenOverlay')) {
    $('btnStageFullscreenOverlay').onclick = e => {
      e.stopPropagation();
      enterStageFullscreen(true);
    };
  }
  if ($('btnFullscreenPlay')) {
    $('btnFullscreenPlay').onclick = () => {
      enterStageFullscreen(true);
    };
  }
  if ($('btnExitStageFullscreenTop')) {
    $('btnExitStageFullscreenTop').onclick = e => {
      e.stopPropagation();
      exitStageFullscreen();
    };
  }
  if ($('btnExitStageFullscreenBottom')) {
    $('btnExitStageFullscreenBottom').onclick = e => {
      e.stopPropagation();
      exitStageFullscreen();
    };
  }
  if ($('btnFsPlayPause')) {
    $('btnFsPlayPause').onclick = () => {
      if (appState.playing) stopPlayback();
      else startPlayback();
    };
  }
  if ($('btnFsPrevFrame')) {
    $('btnFsPrevFrame').onclick = () => {
      stopPlayback();
      void seekToTime(appState.currentTime - 1 / appState.fps);
    };
  }
  if ($('btnFsNextFrame')) {
    $('btnFsNextFrame').onclick = () => {
      stopPlayback();
      void seekToTime(appState.currentTime + 1 / appState.fps);
    };
  }
  if ($('btnFsJumpImpact')) {
    $('btnFsJumpImpact').onclick = () => {
      stopPlayback();
      const imp = appState.keyMoments.find(m => m.key === 'impact');
      if (imp) void seekToTime(imp.time);
    };
  }
  if ($('fsTimelineRange')) {
    $('fsTimelineRange').oninput = e => {
      stopPlayback();
      void seekToTime(Number(e.target.value));
    };
  }
  if ($('selectFsPlaybackSpeed')) {
    $('selectFsPlaybackSpeed').onchange = e => {
      applyPlaybackSpeedChange(e.target.value);
    };
  }

  document.addEventListener('fullscreenchange', () => {
    const vp = $('stageViewport');
    if (!document.fullscreenElement && vp?.classList.contains('is-stage-fullscreen')) {
      // 브라우저 네이티브 풀스크린이 ESC/제스처로 종료된 경우 전체화면 클래스 동기 해제
      exitStageFullscreen();
    } else {
      syncStageFullscreenUI();
      setViewportZoom(appState.viewportZoom || 1.0);
    }
  });

  // 뷰포트 크기 변경(세로/가로 영상 전환, 기기 회전, 전체화면 전환 등) 시 100% 줌 상태에서 스크롤 없이 전체 영상이 꽉 차도록 실시간 맞춤
  let lastObservedScrollW = 0;
  let lastObservedScrollH = 0;
  const refitStageOnResize = () => {
    const sEl = $('stageZoomScroll');
    if (!sEl) return;
    const cw = sEl.clientWidth;
    const ch = sEl.clientHeight;
    if (cw > 0 && ch > 0 && (Math.abs(cw - lastObservedScrollW) >= 1 || Math.abs(ch - lastObservedScrollH) >= 1)) {
      lastObservedScrollW = cw;
      lastObservedScrollH = ch;
      setViewportZoom(appState.viewportZoom || 1.0);
    }
  };
  window.addEventListener('resize', refitStageOnResize);
  if (typeof ResizeObserver !== 'undefined' && $('stageZoomScroll')) {
    const stageResizeObserver = new ResizeObserver(() => {
      refitStageOnResize();
    });
    stageResizeObserver.observe($('stageZoomScroll'));
  }

  // 클럽 헤드 위치 수동 보정 토글 및 캔버스 클릭 핸들러 (샷 트레이서 4점 보정과 통합)
  const pinBtn = $('btnToggleManualPin');
  pinBtn.onclick = () => {
    appState.manualPinMode = !appState.manualPinMode;
    if (appState.manualPinMode) {
      appState.shotTracerOptions.pinTargetMode = null;
      appState.stabilizationOptions.groundPinMode = false;
      syncShotTracerUI();
      syncStabilizationUI();
    }
    pinBtn.setAttribute('aria-pressed', String(appState.manualPinMode));
    pinBtn.textContent = appState.manualPinMode ? '헤드 수동 보정 켜짐 (캔버스 클릭)' : '헤드 위치 수동 보정';
    $('stageCanvas').style.cursor = appState.manualPinMode
      ? 'crosshair'
      : ((appState.viewportZoom || 1) > 1.01 ? 'grab' : 'default');
    setStatusMessage(
      appState.manualPinMode
        ? '캔버스 위에서 실제 클럽 헤드 끝단을 클릭하면 궤적이 즉시 재보간됩니다.'
        : '클럽 헤드 수동 보정 모드를 종료했습니다.'
    );
  };

  $('btnResetPins').onclick = () =>
    runWithBusyOverlay(
      {
        title: '클럽 헤드 궤적 초기화 및 화면 갱신 중',
        sub: '수동 보정된 클럽 헤드 좌표를 초기 자동 분석 궤적으로 복원하고 있습니다...',
        stepText: '궤적 복원 중...'
      },
      async () => {
        appState.samples = appState.samples.map(s => ({
          ...s,
          clubHead: s.clubHeadBase ? { ...s.clubHeadBase, pinned: false } : s.clubHead
        }));
        renderMainStage();
        await renderPhaseFilmstrip();
        setStatusMessage('수동 보정된 클럽 헤드 좌표를 초기 자동 분석 궤적으로 복원했습니다.');
      }
    );

  $('stageCanvas').addEventListener('click', async e => {
    if (appState.wasZoomPanDrag) {
      appState.wasZoomPanDrag = false;
      return;
    }
    const rect = $('stageCanvas').getBoundingClientRect();
    const normX = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0.005, 0.995);
    const normY = clamp((e.clientY - rect.top) / Math.max(1, rect.height), 0.005, 0.995);

    // 0) 지면·발 고정점 클릭 맞추기 모드일 때: 클릭한 지면/발 위치를 기준 지면 높이에 즉시 정합
    if (appState.stabilizationOptions?.groundPinMode) {
      stopPlayback();
      const stab = appState.stabilizationOptions;
      stab.enabled = true;
      if (stab.cropMode === 'off') stab.cropMode = 'crop-matte';

      const curT = Number(appState.currentTime.toFixed(3));
      const refT = Number(stab.referenceTime ?? 0.45);
      const curFrame = Math.max(1, Math.round(curT * (appState.fps || 30)) + 1);

      if (Math.abs(curT - refT) <= 0.04) {
        // 기준 프레임 근처에서 클릭한 경우 기준 지면 위치를 새 클릭 좌표로 갱신
        stab.groundAnchorPoint = { x: Number(normX.toFixed(4)), y: Number(normY.toFixed(4)) };
        await applyStabilizationChange(
          `기준 프레임(F${curFrame})의 지면·스탠스 고정 기준점을 (${(normX * 100).toFixed(0)}%, ${(normY * 100).toFixed(0)}%)로 설정했습니다.`,
          true
        );
      } else {
        // 흔들린 프레임(예: F82~F84)에서 실제 지면/발 위치를 클릭한 경우:
        // 현재 렌더링된 화면에서 클릭한 지점(normX, normY)이 기준 지면선(groundAnchorPoint) 위치로 이동하도록 오프셋 보정
        const gAnchor = stab.groundAnchorPoint || { x: 0.48, y: 0.78 };
        const deltaDx = normX - gAnchor.x;
        const deltaDy = normY - gAnchor.y;

        const kfs = Array.isArray(stab.customKeyframes) ? [...stab.customKeyframes] : [];
        const existIdx = kfs.findIndex(k => Math.abs(k.time - curT) < 0.035);
        if (existIdx >= 0) {
          kfs[existIdx] = {
            time: curT,
            dx: clamp(Number((kfs[existIdx].dx + deltaDx).toFixed(4)), -0.26, 0.26),
            dy: clamp(Number((kfs[existIdx].dy + deltaDy).toFixed(4)), -0.30, 0.30)
          };
        } else {
          kfs.push({
            time: curT,
            dx: clamp(Number(deltaDx.toFixed(4)), -0.26, 0.26),
            dy: clamp(Number(deltaDy.toFixed(4)), -0.30, 0.30)
          });
        }
        stab.customKeyframes = kfs;
        await applyStabilizationChange(
          `프레임 F${curFrame} (${curT.toFixed(2)}s)의 지면·사람 높이를 기준 프레임 지면선에 맞춰 고정(Stay)했습니다.`,
          false
        );
      }
      return;
    }

    // 1) 샷 트레이서 공 위치(현재 멈춘 프레임 공 위치 / 출발점 / 중간점 1~3 / 최고점 / 탄착지점 / 최종런) 수동 지정 모드일 때
    const shotPinTarget = appState.shotTracerOptions?.pinTargetMode;
    if (appState.studioMode === 'shot-tracer' && shotPinTarget) {
      stopPlayback();
      const pt = { x: Number(normX.toFixed(4)), y: Number(normY.toFixed(4)) };
      const impMoment = appState.keyMoments.find(m => m.key === 'impact');
      const impT = impMoment ? impMoment.time : (appState.duration * 0.42);
      const curFrame = Math.max(1, Math.round(appState.currentTime * appState.fps) + 1);

      // 만약 사용자가 중간점(mid1 또는 mid2)을 이전 프레임에서 이미 찍은 뒤, 영상을 다음 프레임으로 이동시켜
      // 더 높은 위치의 공을 연속해서 클릭한 경우 자동으로 다음 중간점(mid2, mid3)으로 이어서 배정
      let targetToApply = shotPinTarget;
      if (shotPinTarget === 'mid1' && appState.shotTracerOptions.midPoint1?.pinned) {
        const prevT = appState.shotTracerOptions.midPoint1.pinnedTime ?? -99;
        if (appState.currentTime > prevT + 0.024 && pt.y < appState.shotTracerOptions.midPoint1.y - 0.015) {
          targetToApply = 'mid2';
          appState.shotTracerOptions.pinTargetMode = 'mid2';
        }
      } else if (shotPinTarget === 'mid2' && appState.shotTracerOptions.midPoint2?.pinned) {
        const prevT = appState.shotTracerOptions.midPoint2.pinnedTime ?? -99;
        if (appState.currentTime > prevT + 0.024 && pt.y < appState.shotTracerOptions.midPoint2.y - 0.015) {
          targetToApply = 'mid3';
          appState.shotTracerOptions.pinTargetMode = 'mid3';
        }
      }

      appState.shotTracerOptions = applyUserPinnedBallPoint(
        appState.shotTracerOptions,
        targetToApply,
        pt,
        appState.currentTime,
        impT,
        appState.duration,
        appState.fps
      );

      // 프레임 위치 조정 후 공 위치를 지정하는 즉시 실시간으로 해당 프레임 번호·시간과 좌표를 저장
      persistRealtimePinnedPointsState(appState.shotTracerOptions);

      const pinnedKey = appState.shotTracerOptions.lastPinnedKey || targetToApply;
      let stabLinkedNote = '';

      await runWithBusyOverlay(
        {
          title: '공 위치 지정 및 탄도·지면 고정 화면 갱신 중',
          sub: `프레임 F${curFrame} 공 위치 실시간 저장 및 궤적 곡선을 갱신하고 있습니다...`,
          stepText: '탄도 곡선 및 프레임 정합 계산 중...'
        },
        async ({ setProgress }) => {
          // 사용자가 공 출발점(origin) 또는 중간점(mid1~3, frame-ball)을 지정하면,
          // 해당 공 위치·지면·사람이 서 있는 위치를 기준으로 영상 흔들림 고정(Stay Lock)을 자동 연동·갱신
          if (appState.sourceMode === 'video' && appState.samples.length > 0 && appState.stabilizationOptions?.enabled) {
            const stab = appState.stabilizationOptions;
            const curSample = findNearestSample(appState.samples, appState.currentTime);
            if (pinnedKey === 'origin') {
              stab.referenceTime = Number(appState.currentTime.toFixed(3));
              stab.groundAnchorPoint = {
                x: clamp(pt.x, 0.15, 0.85),
                y: clamp(pt.y + 0.015, 0.45, 0.92)
              };
              if (curSample?.points) {
                stab.golferAnchorPoint = extractGolferStanceAnchorFromPoints(curSample.points);
              }
              const summary = await recomputeSamplesStabilizationAsync(appState.samples, stab, {
                forceProfileRecompute: true,
                onProgress: (pct, stepLabel) => setProgress(pct, stepLabel)
              });
              stab.maxDetectedShiftX = summary.maxShiftX;
              stab.maxDetectedShiftY = summary.maxShiftY;
              syncStabilizationUI();
              stabLinkedNote = ` · F${curFrame} 출발 프레임 기준 사람·지면 위치 스테이(Stay) 고정 완료`;
            } else if (pinnedKey === 'mid1' || pinnedKey === 'mid2' || pinnedKey === 'mid3') {
              const refAlign = alignFrameToReferenceGround(
                appState.samples,
                stab.referenceTime ?? impT,
                appState.currentTime,
                stab
              );
              if (refAlign && curSample) {
                curSample.stabOffset = { dx: refAlign.dx, dy: refAlign.dy };
                const summary = await recomputeSamplesStabilizationAsync(appState.samples, stab, {
                  forceProfileRecompute: false,
                  onProgress: (pct, stepLabel) => setProgress(pct, stepLabel)
                });
                stab.maxDetectedShiftX = summary.maxShiftX;
                stab.maxDetectedShiftY = summary.maxShiftY;
                syncStabilizationUI();
                stabLinkedNote = ' · 출발 프레임 대비 사람·지면 높이 고정 유지';
              }
            }
          }

          persistRealtimePinnedPointsState(appState.shotTracerOptions);
          syncShotTracerUI();
          renderMainStage();
          await renderPhaseFilmstrip();
        }
      );

      const keyLabelMap = {
        origin: '1. 출발점(공)',
        mid1: '2. 중간점 1 (초반)',
        mid2: '3. 중간점 2 (중반)',
        mid3: '4. 중간점 3 (상승)',
        apex: '5. 최고점(APEX)',
        landing: '6. 탄착지점(캐리)',
        roll: '7. 최종지점(런)'
      };

      setStatusMessage(
        `[실시간 위치 저장 완료] 현재 멈춘 프레임(F${curFrame} · ${appState.currentTime.toFixed(2)}s)에서 [${keyLabelMap[pinnedKey] || pinnedKey}] 공 위치를 (X ${(normX * 100).toFixed(1)}%, Y ${(normY * 100).toFixed(1)}%)로 실시간 저장하고 탄도 곡선으로 연결했습니다${stabLinkedNote}.`
      );
      return;
    }

    // 2) 클럽 헤드 수동 핀 보정 모드일 때 (비활성 상태에서 전체화면 재생 중이면 화면 터치로 재생/일시정지 토글)
    if (!appState.manualPinMode) {
      if (isStageFullscreenActive()) {
        if (appState.playing) stopPlayback();
        else startPlayback();
      }
      return;
    }
    const sample = findNearestSample(appState.samples, appState.currentTime);
    if (!sample) return;

    await runWithBusyOverlay(
      {
        title: '클럽 헤드 수동 위치 고정 및 궤적 보간 중',
        sub: `현재 프레임(${appState.currentTime.toFixed(2)}s) 클럽 헤드 위치를 반영하고 있습니다...`,
        stepText: '스플라인 궤적 재보간 중...'
      },
      async () => {
        sample.clubHead = {
          ...sample.clubHead,
          x: normX,
          y: normY,
          pinned: true
        };

        appState.samples = applyPinnedClubHeadOverrides(appState.samples);
        renderMainStage();
        await renderPhaseFilmstrip();
        setStatusMessage(`현재 프레임(${appState.currentTime.toFixed(2)}s)의 클럽 헤드 위치를 수동 고정하고 주변 스플라인 아크를 재보간했습니다.`);
      }
    );
  });

  // 후방 공 궤적 샷 트레이서(Shot Tracer) 전용 컨트롤 바인딩
  if ($('selectTrajectoryMode')) {
    $('selectTrajectoryMode').onchange = e => {
      const nextMode = e.target.value;
      appState.shotTracerOptions.trajectoryMode = nextMode;
      if (nextMode === 'real-tail') {
        const autoMetrics = estimateShotMetricsFromVideoTrack(
          appState.shotTracerOptions.originPoint,
          {
            midPoint1: appState.shotTracerOptions.midPoint1,
            midPoint2: appState.shotTracerOptions.midPoint2,
            midPoint3: appState.shotTracerOptions.midPoint3,
            midPoint4: appState.shotTracerOptions.midPoint4,
            waypoints: appState.shotTracerOptions.trackedWaypoints
          },
          appState.shotTracerOptions.fairwayAnchor,
          appState.samples
        );
        appState.shotTracerOptions = {
          ...appState.shotTracerOptions,
          ...autoMetrics,
          autoReadoutSource: 'video-auto'
        };
      } else {
        appState.shotTracerOptions = syncShotGeometryFromMetrics(appState.shotTracerOptions);
      }
      syncShotTracerUI();
      renderMainStage();
      void renderPhaseFilmstrip();
      setStatusMessage(
        nextMode === 'real-tail'
          ? `실제 공 궤적 추종 모드: 영상 속 프레임별 공 위치 변화를 판독하여 APEX(${appState.shotTracerOptions.apexMeters.toFixed(1)}m)·캐리(${appState.shotTracerOptions.carryMeters.toFixed(1)}m)를 자동 등록하고 공 꼬리에 밀착해 그립니다.`
          : '표준 탄도 시뮬레이션 모드: 프리셋 및 수동 슬라이더 수치 기반으로 방송용 표준 탄도 아크를 그립니다.'
      );
    };
  }

  const shotShapeSel = $('selectShotShapeType');
  if (shotShapeSel) {
    shotShapeSel.onchange = e => {
      const shapeCode = e.target.value || 'auto';
      if (shapeCode === 'auto' && appState.sourceMode === 'video') {
        const autoMetrics = estimateShotMetricsFromVideoTrack(
          appState.shotTracerOptions.originPoint,
          {
            midPoint1: appState.shotTracerOptions.midPoint1,
            midPoint2: appState.shotTracerOptions.midPoint2,
            midPoint3: appState.shotTracerOptions.midPoint3,
            midPoint4: appState.shotTracerOptions.midPoint4,
            waypoints: appState.shotTracerOptions.trackedWaypoints
          },
          appState.shotTracerOptions.fairwayAnchor,
          appState.samples
        );
        appState.shotTracerOptions = {
          ...appState.shotTracerOptions,
          ...autoMetrics,
          shotShapeType: 'auto',
          autoReadoutSource: 'video-auto'
        };
      } else {
        appState.shotTracerOptions = applyShotShapeOptionToMetrics(appState.shotTracerOptions, shapeCode);
        appState.shotTracerOptions.autoReadoutSource = 'manual-edited';
      }
      syncShotTracerUI();
      renderMainStage();
      void renderPhaseFilmstrip();
      const shapeInfo = classifyShotShapeLabel(
        appState.shotTracerOptions.sideCurveMeters,
        appState.shotTracerOptions.launchDirectionDeg,
        appState.shotTracerOptions.shotShapeType
      );
      setStatusMessage(`구질을 [${shapeInfo.labelKo}]로 설정하여 낙하 방향·곡률 및 영상 내 샷 정보를 즉시 반영했습니다.`);
    };
  }

  if ($('btnReapplyVideoAutoMetrics')) {
    $('btnReapplyVideoAutoMetrics').onclick = () =>
      runWithBusyOverlay(
        {
          title: '영상 판독 자동 계측 데이터 복원 중',
          sub: '영상 속 공 궤적 좌표를 기반으로 구질·비거리·APEX 높이를 재계산하고 있습니다...',
          stepText: '자동 계측 수치 산출 중...'
        },
        async () => {
          if (appState.sourceMode === 'video') {
            appState.shotTracerOptions = autoCalibrateShotTracerFromVideo(
              appState.samples,
              appState.keyMoments,
              { ...appState.shotTracerOptions, shotShapeType: 'auto' }
            );
          } else {
            applyShotTracerPreset(appState.shotTracerOptions.shotPreset || 'driver-draw');
          }
          syncShotTracerUI();
          renderMainStage();
          await renderPhaseFilmstrip();
          setStatusMessage('영상 판독 자동 계측 데이터로 구질·비거리·APEX 높이를 복원했습니다.');
        }
      );
  }

  const shotPresetSel = $('selectShotTracerPreset');
  if (shotPresetSel) {
    shotPresetSel.onchange = e => {
      applyShotTracerPreset(e.target.value);
      setStatusMessage(`샷 트레이서 클럽·구질 프리셋을 변경하여 영상 내 샷 정보에 반영했습니다.`);
    };
  }

  document.querySelectorAll('.color-swatch-btn').forEach(btn => {
    btn.onclick = () => {
      const color = btn.dataset.traceColor || '#DC2626';
      appState.shotTracerOptions.traceColor = color;
      if (color.startsWith('#') && $('inputCustomTraceColor')) {
        $('inputCustomTraceColor').value = color;
      }
      syncShotTracerUI();
      renderMainStage();
      void renderPhaseFilmstrip();
    };
  });

  const customColorInput = $('inputCustomTraceColor');
  if (customColorInput) {
    customColorInput.oninput = e => {
      appState.shotTracerOptions.traceColor = e.target.value;
      if ($('valTraceColorName')) $('valTraceColorName').textContent = `직접선택 (${e.target.value.toUpperCase()})`;
      syncShotTracerUI();
      renderMainStage();
    };
  }

  if ($('selectTraceStyle')) {
    $('selectTraceStyle').onchange = e => {
      appState.shotTracerOptions.traceStyle = e.target.value;
      renderMainStage();
      void renderPhaseFilmstrip();
    };
  }

  if ($('rangeShotLineWidth')) {
    $('rangeShotLineWidth').oninput = e => {
      appState.shotTracerOptions.lineWidth = Number(e.target.value);
      syncShotTracerUI();
      renderMainStage();
    };
  }

  const applyManualMetricUpdate = (key, rawVal) => {
    const val = Number(rawVal);
    if (!Number.isFinite(val)) return;
    appState.shotTracerOptions[key] = val;
    appState.shotTracerOptions.autoReadoutSource = 'manual-edited';
    if (key === 'sideCurveMeters') {
      // 좌우 휨 폭을 직접 조절하면 해당 휨 폭에 맞춰 구질 라벨이 자동 갱신되도록 설정
      appState.shotTracerOptions.shotShapeType = 'auto';
    }
    if (key === 'apexMeters') {
      appState.shotTracerOptions.manualApexPinned = false;
    }
    if (key === 'carryMeters' || key === 'sideCurveMeters') {
      appState.shotTracerOptions.manualLandingPinned = false;
    }
    appState.shotTracerOptions = syncShotGeometryFromMetrics(appState.shotTracerOptions);

    // 체공 시간을 늘렸을 때 현재 타임라인이 탄착 시점 이전에 머물러 있으면 탄착 완료 시점으로 맞춰 궤적 전체를 바로 확인 가능하게 함
    if (key === 'flightDurationSec' && !appState.playing) {
      const impMoment = appState.keyMoments.find(m => m.key === 'impact');
      const impT = impMoment ? impMoment.time : (appState.duration * 0.42);
      const neededT = clamp(
        impT + Number(appState.shotTracerOptions.flightDurationSec || 2.35) + Number(appState.shotTracerOptions.rollDurationSec || 0.62) + 0.08,
        0.5,
        Math.max(0.5, appState.duration - 0.05)
      );
      if (appState.currentTime > impT + 0.5) {
        appState.currentTime = neededT;
        if ($('timelineRange')) $('timelineRange').value = String(appState.currentTime);
      }
    }

    syncShotTracerUI();
    renderMainStage();
  };

  const bindShotMetricSlider = (id, key) => {
    const el = $(id);
    if (!el) return;
    el.oninput = e => applyManualMetricUpdate(key, e.target.value);
  };

  bindShotMetricSlider('rangeApexMeters', 'apexMeters');
  bindShotMetricSlider('rangeCarryMeters', 'carryMeters');
  bindShotMetricSlider('rangeRollMeters', 'rollMeters');
  bindShotMetricSlider('rangeLaunchAngle', 'launchAngleDeg');
  bindShotMetricSlider('rangeSideCurve', 'sideCurveMeters');
  bindShotMetricSlider('rangeBallSpeed', 'ballSpeedMps');
  bindShotMetricSlider('rangeFlightDuration', 'flightDurationSec');

  const bindShotMetricNumberInput = (id, key, minVal, maxVal) => {
    const el = $(id);
    if (!el) return;
    const handler = e => {
      const v = Number(e.target.value);
      if (!Number.isFinite(v)) return;
      applyManualMetricUpdate(key, clamp(v, minVal, maxVal));
    };
    el.oninput = handler;
    el.onchange = handler;
  };

  bindShotMetricNumberInput('inputCarryMeters', 'carryMeters', 20, 340);
  bindShotMetricNumberInput('inputRollMeters', 'rollMeters', 0, 80);
  bindShotMetricNumberInput('inputApexMeters', 'apexMeters', 2, 65);
  bindShotMetricNumberInput('inputLaunchAngle', 'launchAngleDeg', 3, 38);
  bindShotMetricNumberInput('inputSideCurve', 'sideCurveMeters', -35, 35);

  const totalInputEl = $('inputTotalMeters');
  if (totalInputEl) {
    const handleTotalEdit = e => {
      const targetTotal = Number(e.target.value);
      if (!Number.isFinite(targetTotal) || targetTotal < 20) return;
      const clampedTotal = clamp(targetTotal, 25, 380);
      const curCarry = Number(appState.shotTracerOptions.carryMeters || 198.5);
      if (clampedTotal >= curCarry && clampedTotal - curCarry <= 55) {
        appState.shotTracerOptions.rollMeters = Number((clampedTotal - curCarry).toFixed(1));
      } else {
        const nextCarry = Number((clampedTotal * 0.935).toFixed(1));
        appState.shotTracerOptions.carryMeters = nextCarry;
        appState.shotTracerOptions.rollMeters = Number(Math.max(0, clampedTotal - nextCarry).toFixed(1));
      }
      appState.shotTracerOptions.autoReadoutSource = 'manual-edited';
      appState.shotTracerOptions.manualLandingPinned = false;
      appState.shotTracerOptions = syncShotGeometryFromMetrics(appState.shotTracerOptions);
      syncShotTracerUI();
      renderMainStage();
    };
    totalInputEl.oninput = handleTotalEdit;
    totalInputEl.onchange = handleTotalEdit;
  }

  if ($('btnPinPrevFrame')) {
    $('btnPinPrevFrame').onclick = () => {
      stopPlayback();
      const step = 1 / Math.max(15, appState.fps || 30);
      void seekToTime(clamp(appState.currentTime - step, 0, appState.duration));
    };
  }
  if ($('btnPinNextFrame')) {
    $('btnPinNextFrame').onclick = () => {
      stopPlayback();
      const step = 1 / Math.max(15, appState.fps || 30);
      void seekToTime(clamp(appState.currentTime + step, 0, appState.duration));
    };
  }
  if ($('btnPinPauseToggle')) {
    $('btnPinPauseToggle').onclick = () => {
      if (appState.playing) {
        stopPlayback();
        syncShotTracerUI();
        renderMainStage();
        const curFrame = Math.max(1, Math.round(appState.currentTime * appState.fps) + 1);
        setStatusMessage(`영상을 F${curFrame} (${appState.currentTime.toFixed(2)}s) 프레임에서 멈췄습니다. 화면 속 공 위치를 클릭해 지정하세요.`);
      } else {
        startPlayback(false);
      }
    };
  }

  document.querySelectorAll('.btn-shot-pin').forEach(btn => {
    btn.onclick = async () => {
      const target = btn.dataset.shotPin;
      const current = appState.shotTracerOptions.pinTargetMode;
      const safeFps = appState.fps || 30;
      const impMomentForPin = (appState.keyMoments || []).find(m => m.key === 'impact');
      const impTForPin = impMomentForPin ? impMomentForPin.time : (appState.duration * 0.42);

      // 클릭한 지점(target)의 지정 시점 또는 예상 시점 계산
      const preSummary = getPinnedWorkSummaryForTarget(
        appState.shotTracerOptions,
        target,
        impTForPin,
        safeFps
      );
      const targetEntry = preSummary.targetEntry || preSummary.targetMeta || null;
      const hasTargetTime = Boolean(
        target !== 'frame-ball' &&
        targetEntry &&
        Number.isFinite(targetEntry.pinnedTime)
      );
      const seekTargetTime = hasTargetTime
        ? clamp(Number(targetEntry.pinnedTime), 0, appState.duration || 10)
        : appState.currentTime;

      // 이미 선택된 지점 버튼이더라도 현재 타임라인 시점이 해당 지점 시점과 다르면 토글 해제 대신 해당 시점으로 타임라인 이동
      const isAlreadyAtTargetTime = !hasTargetTime ||
        Math.abs(appState.currentTime - seekTargetTime) <= (0.55 / safeFps);
      const nextTarget = (current === target && isAlreadyAtTargetTime) ? null : target;

      appState.shotTracerOptions.pinTargetMode = nextTarget;
      appState.shotTracerOptions.hoverNormPoint = null;
      appState.manualPinMode = false;
      if (nextTarget && appState.stabilizationOptions) {
        appState.stabilizationOptions.groundPinMode = false;
        syncStabilizationUI();
      }
      $('stageCanvas').style.cursor = nextTarget
        ? 'crosshair'
        : ((appState.viewportZoom || 1) > 1.01 ? 'grab' : 'default');

      if (nextTarget) {
        stopPlayback();
        if (hasTargetTime) {
          await seekToTime(seekTargetTime);
        } else {
          syncShotTracerUI();
          renderMainStage();
        }
      } else {
        syncShotTracerUI();
        renderMainStage();
      }

      if (nextTarget) {
        if ($('detailsShotPinHistory')) {
          $('detailsShotPinHistory').open = true;
        }
        const curFrame = Math.max(1, Math.round(appState.currentTime * safeFps) + 1);
        const labelText = btn.dataset.baseLabel || btn.textContent;
        const summary = getPinnedWorkSummaryForTarget(
          appState.shotTracerOptions,
          nextTarget,
          impTForPin,
          safeFps
        );
        const curTargetMeta = summary.targetEntry || summary.targetMeta || null;
        const prevPin = summary.immediatePrevPin || summary.immediatePrevEntry || null;
        const upToList = summary.upToTargetPins || summary.upToPreviousEntries || [];
        const allList = summary.allPinnedList || summary.userPinnedEntries || [];

        const targetMovedText = curTargetMeta
          ? `타임라인 이동: F${curTargetMeta.pinnedFrame} (${Number(curTargetMeta.pinnedTime || appState.currentTime).toFixed(2)}s) · 위치 (X ${(curTargetMeta.x * 100).toFixed(1)}%, Y ${(curTargetMeta.y * 100).toFixed(1)}%)`
          : `현재 프레임: F${curFrame} (${appState.currentTime.toFixed(2)}s)`;

        if (prevPin) {
          const chainText = (upToList.length > 0 ? upToList : allList)
            .map(p => `${p.shortLabel}[F${p.pinnedFrame}·(${(p.x * 100).toFixed(1)}%,${(p.y * 100).toFixed(1)}%)]`)
            .join(' → ');
          setStatusMessage(
            `[${labelText}] 선택됨 (${targetMovedText}) — 직전 작업 지점: ${prevPin.label} [F${prevPin.pinnedFrame} · (${(prevPin.x * 100).toFixed(1)}%, ${(prevPin.y * 100).toFixed(1)}%)] · 누적: ${chainText}`
          );
        } else {
          setStatusMessage(
            `[${labelText}] 선택됨 (${targetMovedText}) — 화면 위 공 위치를 클릭하면 해당 프레임과 좌표가 실시간 저장됩니다.`
          );
        }
      } else {
        setStatusMessage('궤적 포인트 수동 위치 지정 모드를 종료했습니다.');
      }
    };
  });

  const handleResetShotPins = () =>
    runWithBusyOverlay(
      {
        title: '공 궤적 포인트 초기화 및 화면 갱신 중',
        sub: '공 출발점·중간점 1~3·APEX·탄착지점 좌표를 초기 자동 검출 궤적으로 복원하고 있습니다...',
        stepText: '궤적 포인트 초기화 중...'
      },
      async () => {
        appState.shotTracerOptions.pinTargetMode = null;
        appState.shotTracerOptions.hoverNormPoint = null;
        appState.shotTracerOptions.pinnedPointsStore = {};
        appState.shotTracerOptions.pinnedHistory = [];
        appState.shotTracerOptions.lastPinnedKey = null;
        appState.shotTracerOptions.lastPinnedFrame = null;
        appState.shotTracerOptions.lastPinnedTime = null;
        appState.shotTracerOptions.manualApexPinned = false;
        appState.shotTracerOptions.manualLandingPinned = false;
        appState.shotTracerOptions.calibrationPreviewActive = false;
        if (appState.shotTracerOptions.originPoint) appState.shotTracerOptions.originPoint.pinned = false;
        if (appState.shotTracerOptions.midPoint1) appState.shotTracerOptions.midPoint1.pinned = false;
        if (appState.shotTracerOptions.midPoint2) appState.shotTracerOptions.midPoint2.pinned = false;
        if (appState.shotTracerOptions.midPoint3) appState.shotTracerOptions.midPoint3.pinned = false;
        if (appState.shotTracerOptions.apexPoint) appState.shotTracerOptions.apexPoint.pinned = false;
        if (appState.shotTracerOptions.landingPoint) appState.shotTracerOptions.landingPoint.pinned = false;
        if (appState.shotTracerOptions.rollEndPoint) appState.shotTracerOptions.rollEndPoint.pinned = false;
        $('stageCanvas').style.cursor = 'default';
        if (appState.sourceMode === 'video') {
          if (appState.samples?.length >= 10) {
            appState.keyMoments = detectSwingMoments(appState.samples, 0, appState.duration);
          }
          appState.shotTracerOptions = autoCalibrateShotTracerFromVideo(
            appState.samples,
            appState.keyMoments,
            appState.shotTracerOptions
          );
          if (Number.isFinite(appState.shotTracerOptions.calibratedImpactTime)) {
            const impM = appState.keyMoments.find(m => m.key === 'impact');
            if (impM) impM.time = Number(appState.shotTracerOptions.calibratedImpactTime.toFixed(3));
            if (appState.stabilizationOptions) {
              appState.stabilizationOptions.referenceTime = Number(appState.shotTracerOptions.calibratedImpactTime.toFixed(3));
              syncStabilizationUI();
            }
          }
        } else {
          applyShotTracerPreset(appState.shotTracerOptions.shotPreset || 'driver-draw');
        }
        persistRealtimePinnedPointsState(appState.shotTracerOptions);
        syncShotTracerUI();
        renderMainStage();
        setStatusMessage('공 출발점·중간점 1~3·APEX·탄착지점 좌표와 직전 작업 기록을 초기 자동 검출 궤적으로 복원했습니다.');
      }
    );

  if ($('btnResetShotTracerPins')) {
    $('btnResetShotTracerPins').onclick = () => void handleResetShotPins();
  }
  if ($('btnQuickResetShotPins')) {
    $('btnQuickResetShotPins').onclick = () => void handleResetShotPins();
  }

  const quickOriginPinBtn = $('btnQuickShotPinOrigin');
  if (quickOriginPinBtn) {
    quickOriginPinBtn.onclick = () => {
      const originPinBtn = document.querySelector('.btn-shot-pin[data-shot-pin="origin"]');
      if (originPinBtn) {
        originPinBtn.click();
      }
    };
  }

  const bindShotCheck = (id, key) => {
    const el = $(id);
    if (!el) return;
    el.onchange = e => {
      appState.shotTracerOptions[key] = e.target.checked;
      renderMainStage();
      if (appState.studioMode === 'shot-tracer') {
        renderShotFlightStepsStrip();
      } else {
        void renderPhaseFilmstrip();
      }
    };
  };

  bindShotCheck('chkShowApexBubble', 'showApexBubble');
  bindShotCheck('chkShowLandingMarker', 'showLandingMarker');
  bindShotCheck('chkShowTrajectoryHud', 'showTrajectoryHud');
  bindShotCheck('chkShowGroundShadow', 'showGroundShadow');

  // 우측 잔상 옵션 컨트롤 바인딩
  $('selectTrailScope').onchange = e => {
    appState.renderOptions.trailScope = e.target.value;
    renderMainStage();
  };

  $('rangeTrailDuration').oninput = e => {
    const v = Number(e.target.value);
    appState.renderOptions.trailDurationSec = v;
    if (appState.renderOptions.trailScope === 'all-swing') {
      appState.renderOptions.trailScope = 'full';
      const scopeSel = $('selectTrailScope');
      if (scopeSel) scopeSel.value = 'full';
    }
    $('valTrailDuration').textContent = `${v.toFixed(2)}s`;
    renderMainStage();
  };

  $('rangeRibbonWidth').oninput = e => {
    const v = Number(e.target.value);
    appState.renderOptions.ribbonWidth = v;
    $('valRibbonWidth').textContent = `${v}px`;
    // 보조 궤적·빛반사 선이 모두 꺼져 있을 때 슬라이더를 조작하면 자동으로 빛반사 궤적을 켜서 변화를 즉시 확인할 수 있게 함
    if (!appState.renderOptions.showShaftGlint && !appState.renderOptions.showClubRibbon) {
      appState.renderOptions.showShaftGlint = true;
      const glintChk = $('chkShaftGlint');
      if (glintChk) glintChk.checked = true;
    }
    renderMainStage();
  };

  $('rangeStrobeStep').oninput = e => {
    const v = Number(e.target.value);
    appState.renderOptions.strobeStep = v;
    $('valStrobeStep').textContent = `${v}프레임 간격`;
    renderMainStage();
  };

  $('rangeGhostOpacity').oninput = e => {
    const v = Number(e.target.value);
    appState.renderOptions.ghostOpacity = v;
    $('valGhostOpacity').textContent = `${Math.round(v * 100)}%`;
    renderMainStage();
  };

  const rangeGripFadeEl = $('rangeGripFade');
  if (rangeGripFadeEl) {
    rangeGripFadeEl.oninput = e => {
      const v = Number(e.target.value);
      appState.renderOptions.gripFade = v;
      const pct = Math.round(v * 100);
      if (pct >= 95) {
        $('valGripFade').textContent = `${pct}% (중앙부터 표시)`;
      } else if (pct <= 2) {
        $('valGripFade').textContent = `${pct}% (전체 표시)`;
      } else {
        $('valGripFade').textContent = `${pct}%`;
      }
      renderMainStage();
    };
  }

  const bindCheckbox = (id, optKey) => {
    const el = $(id);
    if (!el) return;
    el.onchange = e => {
      appState.renderOptions[optKey] = e.target.checked;
      renderMainStage();
      void renderPhaseFilmstrip();
    };
  };

  bindCheckbox('chkClubRibbon', 'showClubRibbon');
  bindCheckbox('chkShaftGlint', 'showShaftGlint');
  bindCheckbox('chkStrobeGhosts', 'showStrobeGhosts');
  bindCheckbox('chkHandPath', 'showHandPath');
  bindCheckbox('chkSwingPlane', 'showSwingPlane');
  bindCheckbox('chkSkeleton', 'showSkeleton');
  bindCheckbox('chkAngles', 'showAngles');

  $('selectHandedness').onchange = e => {
    appState.hand = e.target.value;
    void runWithBusyOverlay(
      {
        title: '스윙 타석 방향(오른손/왼손) 전환 및 궤적 재계산 중',
        sub: '선택한 타석 방향에 맞춰 어드레스 클럽 템플릿과 스윙 아크를 갱신하고 있습니다...',
        stepText: '클럽 궤적 재정규화 중...'
      },
      async () => {
        if (appState.sourceMode === 'demo') {
          loadDemoPreset(appState.demoPreset);
        } else {
          const addrMoment = appState.keyMoments.find(m => m.key === 'address');
          const addrSample = findNearestSample(appState.samples, addrMoment ? addrMoment.time : 0.45) || appState.samples[0];
          appState.addressClub = createAddressClubTemplate(
            addrSample,
            appState.canvasWidth,
            appState.canvasHeight,
            { clubType: 'driver', hand: appState.hand }
          );
          appState.samples = regularizeSwingWithAddressClub(
            appState.samples,
            appState.keyMoments,
            appState.addressClub,
            appState.hand
          );
          renderMainStage();
          await renderPhaseFilmstrip();
          updateMetricsAndCoachingUI();
        }
      }
    );
  };

  // 타임라인 구간(CLIP 시작~종료) 설정 컨트롤 바인딩
  const rClipStart = $('rangeClipStart');
  const rClipEnd = $('rangeClipEnd');
  const iClipStart = $('inputClipStart');
  const iClipEnd = $('inputClipEnd');
  const presetClipSel = $('selectClipPreset');
  const btnMarkStart = $('btnSetClipStart');
  const btnMarkEnd = $('btnSetClipEnd');
  const btnPlayClip = $('btnPlayClipRange');
  const exportSpeedSel = $('selectExportSpeed');
  const btnExportClip = $('btnExportClipVideo');

  if (rClipStart) {
    rClipStart.oninput = e => {
      stopPlayback();
      const maxStart = Math.max(0, appState.clipEndTime - 0.10);
      appState.clipStartTime = clamp(Number(e.target.value), 0, maxStart);
      appState.clipPreset = 'custom';
      syncClipRangeUI(true);
      void seekToTime(appState.clipStartTime);
    };
  }

  if (rClipEnd) {
    rClipEnd.oninput = e => {
      stopPlayback();
      const minEnd = Math.min(appState.duration, appState.clipStartTime + 0.10);
      appState.clipEndTime = clamp(Number(e.target.value), minEnd, appState.duration);
      appState.clipPreset = 'custom';
      syncClipRangeUI(true);
      void seekToTime(appState.clipEndTime);
    };
  }

  if (iClipStart) {
    iClipStart.onchange = e => {
      stopPlayback();
      const val = Number(e.target.value);
      if (Number.isFinite(val)) {
        appState.clipStartTime = clamp(val, 0, Math.max(0, appState.clipEndTime - 0.10));
        appState.clipPreset = 'custom';
        syncClipRangeUI(true);
        void seekToTime(appState.clipStartTime);
      }
    };
  }

  if (iClipEnd) {
    iClipEnd.onchange = e => {
      stopPlayback();
      const val = Number(e.target.value);
      if (Number.isFinite(val)) {
        appState.clipEndTime = clamp(val, Math.min(appState.duration, appState.clipStartTime + 0.10), appState.duration);
        appState.clipPreset = 'custom';
        syncClipRangeUI(true);
        void seekToTime(appState.clipEndTime);
      }
    };
  }

  if (btnMarkStart) {
    btnMarkStart.onclick = () => {
      stopPlayback();
      appState.clipStartTime = Number(appState.currentTime.toFixed(2));
      if (appState.clipEndTime <= appState.clipStartTime + 0.10) {
        appState.clipEndTime = clamp(appState.clipStartTime + 0.50, 0.10, appState.duration);
      }
      appState.clipPreset = 'custom';
      syncClipRangeUI(true);
      setStatusMessage(`동영상 구간 시작점을 현재 타임라인 위치(${appState.clipStartTime.toFixed(2)}s)로 설정했습니다.`);
    };
  }

  if (btnMarkEnd) {
    btnMarkEnd.onclick = () => {
      stopPlayback();
      appState.clipEndTime = Number(Math.max(0.10, appState.currentTime).toFixed(2));
      if (appState.clipStartTime >= appState.clipEndTime - 0.10) {
        appState.clipStartTime = clamp(appState.clipEndTime - 0.50, 0, Math.max(0, appState.duration - 0.10));
      }
      appState.clipPreset = 'custom';
      syncClipRangeUI(true);
      setStatusMessage(`동영상 구간 종료점을 현재 타임라인 위치(${appState.clipEndTime.toFixed(2)}s)로 설정했습니다.`);
    };
  }

  if (presetClipSel) {
    presetClipSel.onchange = e => {
      stopPlayback();
      const val = e.target.value;
      applyClipPreset(val);
      void seekToTime(appState.clipStartTime);
      setStatusMessage(`동영상 저장 구간을 [${appState.clipStartTime.toFixed(2)}s ~ ${appState.clipEndTime.toFixed(2)}s]로 설정했습니다.`);
    };
  }

  if (btnPlayClip) {
    btnPlayClip.onclick = () => {
      if (appState.playing) {
        stopPlayback();
      } else {
        startPlayback(true);
      }
    };
  }

  if (exportSpeedSel) {
    exportSpeedSel.onchange = e => {
      appState.exportSpeedFactor = clamp(Number(e.target.value) || 0.5, 0.1, 2.0);
    };
  }

  // 타임라인 선택 구간 동영상 인코딩 및 다운로드 실행 함수 (보관함 자동 저장 및 0.5초 최상단 오버레이 포함)
  const handleExportTimelineClipVideo = async () => {
    if (appState.busy) return;
    stopPlayback();
    appState.busy = true;

    const topBtn = $('btnExportAfterimageVideo');
    const clipBtn = $('btnExportClipVideo');
    const origTopText = topBtn ? topBtn.textContent : '헤드 잔상 동영상 다운로드';
    const progressWrap = $('analysisProgressWrap');
    const progressBar = $('analysisProgressBar');
    if (progressWrap) progressWrap.hidden = false;
    if (progressBar) progressBar.value = 0;

    const sSec = appState.clipStartTime.toFixed(2);
    const eSec = appState.clipEndTime.toFixed(2);

    await runWithBusyOverlay(
      {
        title: '선택 구간 동영상 인코딩 및 화면 처리 중',
        sub: `타임라인 구간(${sSec}s ~ ${eSec}s) 동영상을 프레임별로 합성하고 있습니다...`,
        stepText: '비디오 스트림 인코딩 준비 중...',
        progress: 2
      },
      async ({ setProgress }) => {
        try {
          setStatusMessage(`선택 구간(${sSec}s ~ ${eSec}s) 골프채 잔상 동영상 인코딩 준비 중...`);
          const result = await exportAfterimageVideo(
            appState,
            (pct, simTime) => {
              const msg = `구간 동영상 렌더링 중 (${pct}%)`;
              if (topBtn) topBtn.textContent = msg;
              if (clipBtn) clipBtn.textContent = `${msg} [${simTime.toFixed(2)}s]`;
              if (progressBar) progressBar.value = pct;
              setProgress(
                Math.min(93, Math.max(2, pct)),
                `프레임 인코딩 ${pct}% (${simTime.toFixed(2)}s)`
              );
              setStatusMessage(`타임라인 구간(${sSec}s ~ ${eSec}s) 동영상 인코딩 진행 중... ${pct}% (${simTime.toFixed(2)}s)`);
            },
            {
              startTime: appState.clipStartTime,
              endTime: appState.clipEndTime,
              speedFactor: appState.exportSpeedFactor
            }
          );

          // 추출된 동영상 결과물 및 현재 편집 상태를 작업 보관함에 자동 저장
          try {
            setProgress(95, '작업 보관함 자동 등록 중...');
            const savedRec = await saveWorkRecordToArchive(appState, {
              existingId: appState.activeArchiveId || null,
              customTitle: appState.activeArchiveTitle || '',
              saveType: 'video-export',
              outputMediaType: 'video',
              outputBlob: result.blob || null,
              outputFilename: result.filename,
              stageCanvas: $('stageCanvas'),
              onProgress: (p, st) => {
                setProgress(94 + Math.round(p * 0.06), st);
              }
            });
            appState.activeArchiveId = savedRec.id;
            appState.activeArchiveTitle = savedRec.title;
            syncActiveArchiveBannerUI();
            await refreshArchiveCountBadge();
          } catch {
            // 보관함 자동 저장 실패 시에도 다운로드 미리보기는 정상 진행
          }

          showVideoPreviewModal(
            `구간 잔상 동영상 (${result.startTime.toFixed(2)}s ~ ${result.endTime.toFixed(2)}s · ${result.speedFactor}x)`,
            result.url,
            result.filename
          );
          setStatusMessage(`타임라인 구간(${sSec}s ~ ${eSec}s) 동영상(${result.filename}) 다운로드 및 [저장된 작업 조회] 보관함 등록이 완료되었습니다.`);
        } catch (err) {
          setStatusMessage(`동영상 내보내기 오류: ${err.message}`);
        } finally {
          if (progressWrap) progressWrap.hidden = true;
          if (topBtn) topBtn.textContent = origTopText;
          appState.busy = false;
          syncClipRangeUI();
          renderMainStage();
        }
      }
    );
  };

  $('btnExportAfterimageVideo').onclick = () => {
    setTopMenuOpen(false);
    void handleExportTimelineClipVideo();
  };
  if ($('btnQuickExportVideoOutside')) {
    $('btnQuickExportVideoOutside').onclick = () => {
      setTopMenuOpen(false);
      void handleExportTimelineClipVideo();
    };
  }
  if (btnExportClip) {
    btnExportClip.onclick = handleExportTimelineClipVideo;
  }

  const handleSaveCurrentTimelineSnapshot = async () => {
    if (appState.busy) return;
    setTopMenuOpen(false);
    stopPlayback();
    const curSec = appState.currentTime.toFixed(2);
    const curFrame = Math.round(appState.currentTime * appState.fps);

    await runWithBusyOverlay(
      {
        title: '타임라인 고해상도 스냅샷(PNG) 생성 중',
        sub: `타임라인 ${curSec}s (F${curFrame}) 궤적 및 지면 고정 화면을 합성하고 있습니다...`,
        stepText: '캔버스 스냅샷 합성 중...',
        progress: 12
      },
      async ({ setProgress }) => {
        setStatusMessage(`타임라인 현재 상태(${curSec}s / F${curFrame}) 스냅샷(PNG) 생성 중...`);
        const dataUrl = await exportStrobeSnapshot(appState, (pct, stepLabel) => {
          setProgress(Math.round(pct * 0.72), stepLabel);
        });

        try {
          setProgress(78, '작업 보관함에 스냅샷 등록 중...');
          const savedRec = await saveWorkRecordToArchive(appState, {
            existingId: appState.activeArchiveId || null,
            customTitle: appState.activeArchiveTitle || '',
            saveType: 'snapshot-strobe',
            outputMediaType: 'image',
            outputDataUrl: dataUrl,
            outputFilename: `golf-swing-snapshot-F${curFrame}.png`,
            stageCanvas: $('stageCanvas'),
            onProgress: (p, st) => {
              setProgress(76 + Math.round(p * 0.24), st);
            }
          });
          appState.activeArchiveId = savedRec.id;
          appState.activeArchiveTitle = savedRec.title;
          syncActiveArchiveBannerUI();
          await refreshArchiveCountBadge();
        } catch {
          // 보관함 저장 예외 무시
        }

        showSnapshotPreviewModal(`타임라인 스냅샷 (${curSec}s / F${curFrame})`, dataUrl);
        setStatusMessage(`타임라인 ${curSec}s (F${curFrame}) 스냅샷(PNG) 저장 및 [저장된 작업 조회] 보관함 등록이 완료되었습니다.`);
        renderMainStage();
      }
    );
  };

  $('btnExportStrobeSnapshot').onclick = handleSaveCurrentTimelineSnapshot;
  const btnSaveCurrent = $('btnSaveCurrentSnapshot');
  if (btnSaveCurrent) {
    btnSaveCurrent.onclick = handleSaveCurrentTimelineSnapshot;
  }

  $('btnExportPanoramaSnapshot').onclick = async () => {
    if (appState.busy) return;
    setTopMenuOpen(false);
    stopPlayback();

    await runWithBusyOverlay(
      {
        title: '7단계 스윙 시퀀스 파노라마 스냅샷 합성 중',
        sub: '7개 핵심 스윙 단계 프레임과 클럽·탄도 지표를 고해상도 파노라마로 합성하고 있습니다...',
        stepText: '파노라마 캔버스 준비 중...',
        progress: 8
      },
      async ({ setProgress }) => {
        setStatusMessage('7단계 스윙 시퀀스 파노라마 스냅샷(PNG) 합성 중...');
        const dataUrl = await exportSequencePanorama(appState, (pct, stepLabel) => {
          setProgress(Math.round(pct * 0.8), stepLabel);
        });

        try {
          setProgress(84, '작업 보관함에 파노라마 등록 중...');
          const savedRec = await saveWorkRecordToArchive(appState, {
            existingId: appState.activeArchiveId || null,
            customTitle: appState.activeArchiveTitle || '',
            saveType: 'snapshot-panorama',
            outputMediaType: 'image',
            outputDataUrl: dataUrl,
            outputFilename: 'golf-swing-7stage-panorama.png',
            stageCanvas: $('stageCanvas'),
            onProgress: (p, st) => {
              setProgress(82 + Math.round(p * 0.18), st);
            }
          });
          appState.activeArchiveId = savedRec.id;
          appState.activeArchiveTitle = savedRec.title;
          syncActiveArchiveBannerUI();
          await refreshArchiveCountBadge();
        } catch {
          // 보관함 저장 예외 무시
        }

        showSnapshotPreviewModal('7단계 스윙 시퀀스 & 헤드 잔상 파노라마 스냅샷', dataUrl);
        setStatusMessage('7단계 스윙 시퀀스 파노라마 스냅샷(PNG) 다운로드 및 [저장된 작업 조회] 보관함 등록이 완료되었습니다.');
        renderMainStage();
      }
    );
  };

  $('btnCloseModal').onclick = () => {
    const vid = $('modalPreviewVideo');
    if (vid) {
      vid.pause();
    }
    $('snapshotModal').close();
  };

  if ($('btnModalOpenArchive')) {
    $('btnModalOpenArchive').onclick = () => {
      const vid = $('modalPreviewVideo');
      if (vid) vid.pause();
      $('snapshotModal').close();
      void openSavedArchiveModal(appState.activeArchiveId);
    };
  }

  // 작업 내용 저장 / 저장된 작업 조회·편집 보관함 컨트롤 바인딩
  if ($('btnSaveWorkState')) {
    $('btnSaveWorkState').onclick = () => {
      setTopMenuOpen(false);
      void saveCurrentStudioWork(false);
    };
  }
  if ($('btnQuickSaveWorkOutside')) {
    $('btnQuickSaveWorkOutside').onclick = () => {
      setTopMenuOpen(false);
      void saveCurrentStudioWork(false);
    };
  }
  if ($('btnOverwriteArchiveWork')) {
    $('btnOverwriteArchiveWork').onclick = () => {
      void saveCurrentStudioWork(false);
    };
  }
  if ($('btnDetachArchiveWork')) {
    $('btnDetachArchiveWork').onclick = () => {
      appState.activeArchiveId = null;
      appState.activeArchiveTitle = '';
      syncActiveArchiveBannerUI();
      setStatusMessage('불러온 작업과의 덮어쓰기 연결을 해제했습니다. 이제 [작업 내용 저장] 시 새 항목으로 보관됩니다.');
    };
  }
  if ($('btnOpenSavedArchive')) {
    $('btnOpenSavedArchive').onclick = () => {
      setTopMenuOpen(false);
      stopPlayback();
      void openSavedArchiveModal(appState.activeArchiveId);
    };
  }
  if ($('btnCloseArchiveModal')) {
    $('btnCloseArchiveModal').onclick = () => {
      closeSavedArchiveModal();
    };
  }
  if ($('btnArchiveSaveCurrentNew')) {
    $('btnArchiveSaveCurrentNew').onclick = async () => {
      await saveCurrentStudioWork(true);
      await renderArchiveModalUI(appState.activeArchiveId);
    };
  }
  if ($('btnEmptyStateSaveNow')) {
    $('btnEmptyStateSaveNow').onclick = async () => {
      await saveCurrentStudioWork(true);
      await renderArchiveModalUI(appState.activeArchiveId);
    };
  }
  if ($('btnArchiveClearAll')) {
    $('btnArchiveClearAll').onclick = async () => {
      if (!appState.archivedRecordsCache.length) return;
      if (!window.confirm('보관함에 저장된 모든 작업 내역을 삭제하시겠습니까?')) return;
      await runWithBusyOverlay(
        {
          title: '저장된 작업 보관함 전체 비우기 처리 중',
          sub: '보관함에 저장된 모든 작업 내역과 미디어 데이터를 삭제하고 있습니다...',
          stepText: 'IndexedDB 저장소 정리 중...'
        },
        async () => {
          await clearAllArchivedWorkRecords();
          appState.activeArchiveId = null;
          appState.activeArchiveTitle = '';
          appState.selectedArchiveId = null;
          syncActiveArchiveBannerUI();
          await renderArchiveModalUI(null);
          setStatusMessage('저장된 작업 보관함의 모든 항목을 비웠습니다.');
        }
      );
    };
  }

  document.querySelectorAll('.btn-archive-filter').forEach(btn => {
    btn.onclick = () => {
      appState.archiveFilterMode = btn.dataset.archiveFilter || 'all';
      document.querySelectorAll('.btn-archive-filter').forEach(b => {
        b.classList.toggle('is-active', b === btn);
      });
      void renderArchiveModalUI(appState.selectedArchiveId);
    };
  });

  if ($('inputArchiveSearch')) {
    $('inputArchiveSearch').oninput = e => {
      appState.archiveSearchQuery = (e.target.value || '').trim().toLowerCase();
      void renderArchiveModalUI(appState.selectedArchiveId);
    };
  }

  if ($('btnSaveArchiveTitle')) {
    $('btnSaveArchiveTitle').onclick = async () => {
      const selId = appState.selectedArchiveId;
      const newTitle = $('inputArchiveDetailTitle')?.value?.trim();
      if (!selId || !newTitle) return;
      await renameArchivedWorkRecord(selId, newTitle);
      if (appState.activeArchiveId === selId) {
        appState.activeArchiveTitle = newTitle;
        syncActiveArchiveBannerUI();
      }
      await renderArchiveModalUI(selId);
      setStatusMessage(`저장된 작업의 제목을 [${newTitle}]로 변경했습니다.`);
    };
  }

  if ($('btnLoadSelectedToStudio')) {
    $('btnLoadSelectedToStudio').onclick = () => {
      if (appState.selectedArchiveId) {
        void loadArchivedWorkIntoStudio(appState.selectedArchiveId);
      }
    };
  }

  if ($('btnDownloadSelectedMedia')) {
    $('btnDownloadSelectedMedia').onclick = async () => {
      const selId = appState.selectedArchiveId;
      if (!selId) return;
      const rec = await getArchivedWorkRecordById(selId);
      if (!rec) return;
      await downloadArchivedRecordSnapshot(rec);
    };
  }

  if ($('btnDownloadArchiveVideo')) {
    $('btnDownloadArchiveVideo').onclick = async () => {
      const selId = appState.selectedArchiveId;
      if (!selId) return;
      const rec = await getArchivedWorkRecordById(selId);
      if (!rec) return;
      await downloadOrEncodeArchivedRecordVideo(rec);
    };
  }

  if ($('btnDeleteSelectedArchive')) {
    $('btnDeleteSelectedArchive').onclick = async () => {
      const selId = appState.selectedArchiveId;
      if (!selId) return;
      await handleDeleteArchiveItem(selId);
    };
  }

  // 결과 조회 화면(#archiveDetailPane) 전용 실시간 재생 컨트롤 바인딩
  if ($('archivePreviewStage')) {
    $('archivePreviewStage').onclick = e => {
      if (e.target.tagName === 'VIDEO' && !$('archivePreviewVideo')?.hidden) return;
      toggleArchivePreviewPlayback();
    };
  }

  if ($('btnArchivePlayPause')) {
    $('btnArchivePlayPause').onclick = () => {
      toggleArchivePreviewPlayback();
    };
  }

  if ($('btnArchiveRestart')) {
    $('btnArchiveRestart').onclick = () => {
      const startT = archivePlayerState.clipStartTime || 0;
      void seekArchivePreviewToTime(startT, true);
    };
  }

  if ($('btnArchiveJumpImpact')) {
    $('btnArchiveJumpImpact').onclick = () => {
      stopArchivePreviewPlayback();
      void seekArchivePreviewToTime(archivePlayerState.impactTime || 1.35, false);
    };
  }

  if ($('rangeArchiveScrub')) {
    $('rangeArchiveScrub').oninput = e => {
      stopArchivePreviewPlayback();
      void seekArchivePreviewToTime(Number(e.target.value || 0), false);
    };
  }

  if ($('selectArchiveSpeed')) {
    $('selectArchiveSpeed').onchange = e => {
      const spd = clamp(Number(e.target.value || 0.5), 0.1, 2.0);
      archivePlayerState.playbackSpeed = spd;
      const srcVid = $('archiveSourceVideo');
      if (srcVid && !srcVid.paused) {
        try {
          srcVid.playbackRate = spd;
        } catch {
          // 배속 설정 예외 무시
        }
      }
      const outVid = $('archivePreviewVideo');
      if (outVid && !outVid.hidden) {
        try {
          outVid.playbackRate = spd;
        } catch {
          // 배속 설정 예외 무시
        }
      }
    };
  }

  // 키보드 단축키 지원 (좌/우 화살표 프레임 이동, Space 재생/일시정지, [ 시작점, ] 종료점, S 현재 화면 스냅샷 저장)
  window.addEventListener('keydown', e => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if ($('savedArchiveModal')?.open) {
      if (e.key === ' ') {
        e.preventDefault();
        toggleArchivePreviewPlayback();
      }
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      $('btnPlayPause').click();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      $('btnPrevFrame').click();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      $('btnNextFrame').click();
    } else if (e.key === '[') {
      e.preventDefault();
      if (btnMarkStart) btnMarkStart.click();
    } else if (e.key === ']') {
      e.preventDefault();
      if (btnMarkEnd) btnMarkEnd.click();
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      void handleSaveCurrentTimelineSnapshot();
    }
  });
}

// ============================================================================
// 작업 보관함(Archive) 저장 · 실시간 결과 영상 재생 · 편집장으로 불러오기 · 삭제 구현부
// ============================================================================

let activeArchivePreviewObjectUrl = null;
let activeArchiveSourceVideoUrl = null;

const archivePlayerState = {
  rafId: null,
  playing: false,
  lastTickAt: 0,
  mode: 'none', // 'canvas' | 'video' | 'image' | 'none'
  currentTime: 0,
  duration: 3.2,
  clipStartTime: 0,
  clipEndTime: 3.2,
  playbackSpeed: 0.5,
  fps: 30,
  impactTime: 1.35,
  recordId: null,
  renderState: null
};

function revokeArchivePreviewUrl() {
  stopArchivePreviewPlayback();
  if (activeArchivePreviewObjectUrl) {
    try {
      URL.revokeObjectURL(activeArchivePreviewObjectUrl);
    } catch {
      // URL 해제 예외 무시
    }
    activeArchivePreviewObjectUrl = null;
  }
  if (activeArchiveSourceVideoUrl) {
    try {
      URL.revokeObjectURL(activeArchiveSourceVideoUrl);
    } catch {
      // URL 해제 예외 무시
    }
    activeArchiveSourceVideoUrl = null;
  }
  const srcVid = $('archiveSourceVideo');
  if (srcVid) {
    try {
      srcVid.pause();
      srcVid.removeAttribute('src');
    } catch {
      // 비디오 정리 예외 무시
    }
  }
}

function syncArchivePlayerControlsUI() {
  const playBtn = $('btnArchivePlayPause');
  const scrubEl = $('rangeArchiveScrub');
  const badgeEl = $('archiveTimeBadge');
  const speedSel = $('selectArchiveSpeed');

  if (playBtn) {
    playBtn.textContent = archivePlayerState.playing ? '일시정지' : '결과 재생';
  }
  const dur = Math.max(0.1, Number(archivePlayerState.duration || 3.2));
  const cur = clamp(Number(archivePlayerState.currentTime || 0), 0, dur);
  const fps = Math.max(15, Number(archivePlayerState.fps || 30));
  const frameNum = Math.max(1, Math.round(cur * fps) + 1);

  if (scrubEl) {
    scrubEl.max = String(dur.toFixed(2));
    if (document.activeElement !== scrubEl) {
      scrubEl.value = String(cur.toFixed(3));
    }
  }
  if (badgeEl) {
    badgeEl.textContent = `${cur.toFixed(2)}s / ${dur.toFixed(2)}s (F${frameNum})`;
  }
  if (speedSel && document.activeElement !== speedSel) {
    speedSel.value = String(archivePlayerState.playbackSpeed || 0.5);
  }
}

function renderArchiveCompositeCanvasFrame() {
  const canvas = $('archivePreviewCanvas');
  const rState = archivePlayerState.renderState;
  if (!canvas || !rState) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width || rState.canvasWidth || 1280;
  const h = canvas.height || rState.canvasHeight || 720;

  renderCompositeFrame(ctx, w, h, rState, archivePlayerState.currentTime, {
    ...(rState.renderOptions || {}),
    shotTracerOverride: {
      ...(rState.shotTracerOptions || {}),
      pinTargetMode: null,
      calibrationPreviewActive: false
    }
  });
}

function stopArchivePreviewPlayback() {
  archivePlayerState.playing = false;
  if (archivePlayerState.rafId) {
    cancelAnimationFrame(archivePlayerState.rafId);
    archivePlayerState.rafId = null;
  }
  const srcVid = $('archiveSourceVideo');
  if (srcVid && !srcVid.paused) {
    try {
      srcVid.pause();
    } catch {
      // 일시정지 예외 무시
    }
  }
  const outVid = $('archivePreviewVideo');
  if (outVid && !outVid.paused) {
    try {
      outVid.pause();
    } catch {
      // 일시정지 예외 무시
    }
  }
  syncArchivePlayerControlsUI();
}

async function seekArchivePreviewToTime(targetTime, resumePlayAfter = false) {
  const dur = Math.max(0.1, Number(archivePlayerState.duration || 3.2));
  const clamped = clamp(Number(targetTime || 0), 0, dur);
  archivePlayerState.currentTime = clamped;

  if (archivePlayerState.mode === 'video') {
    const outVid = $('archivePreviewVideo');
    if (outVid) {
      outVid.currentTime = clamped;
      if (resumePlayAfter) {
        startArchivePreviewPlayback();
      } else {
        syncArchivePlayerControlsUI();
      }
    }
    return;
  }

  if (archivePlayerState.mode === 'canvas' && archivePlayerState.renderState) {
    const rState = archivePlayerState.renderState;
    rState.currentTime = clamped;
    if (rState.sourceMode === 'video' && rState.videoElement && rState.videoReady) {
      await seekVideoSafely(rState.videoElement, clamped);
    }
    renderArchiveCompositeCanvasFrame();
    syncArchivePlayerControlsUI();
    if (resumePlayAfter) {
      startArchivePreviewPlayback();
    }
  }
}

function startArchivePreviewPlayback() {
  if (archivePlayerState.mode === 'none' || archivePlayerState.mode === 'image') return;

  if (archivePlayerState.mode === 'video') {
    const outVid = $('archivePreviewVideo');
    if (!outVid) return;
    archivePlayerState.playing = true;
    try {
      outVid.playbackRate = clamp(archivePlayerState.playbackSpeed || 0.5, 0.1, 2.0);
    } catch {
      // 배속 설정 예외 무시
    }
    void outVid.play().catch(() => {});
    const tickVideo = () => {
      if (!archivePlayerState.playing || archivePlayerState.mode !== 'video') return;
      archivePlayerState.currentTime = Number(outVid.currentTime || 0);
      archivePlayerState.duration = Number.isFinite(outVid.duration) && outVid.duration > 0
        ? outVid.duration
        : archivePlayerState.duration;
      syncArchivePlayerControlsUI();
      archivePlayerState.rafId = requestAnimationFrame(tickVideo);
    };
    if (archivePlayerState.rafId) cancelAnimationFrame(archivePlayerState.rafId);
    archivePlayerState.rafId = requestAnimationFrame(tickVideo);
    syncArchivePlayerControlsUI();
    return;
  }

  if (archivePlayerState.mode === 'canvas' && archivePlayerState.renderState) {
    const rState = archivePlayerState.renderState;
    const minT = clamp(Number(archivePlayerState.clipStartTime || 0), 0, archivePlayerState.duration);
    const maxT = clamp(
      Number(archivePlayerState.clipEndTime || archivePlayerState.duration),
      minT + 0.15,
      archivePlayerState.duration
    );

    if (archivePlayerState.currentTime >= maxT - 0.03 || archivePlayerState.currentTime < minT) {
      archivePlayerState.currentTime = minT;
    }

    archivePlayerState.playing = true;
    archivePlayerState.lastTickAt = performance.now();

    const srcVid = rState.videoElement;
    if (rState.sourceMode === 'video' && srcVid && rState.videoReady) {
      try {
        srcVid.playbackRate = clamp(archivePlayerState.playbackSpeed || 0.5, 0.1, 2.0);
        if (Math.abs(srcVid.currentTime - archivePlayerState.currentTime) > 0.08) {
          srcVid.currentTime = archivePlayerState.currentTime;
        }
        void srcVid.play().catch(() => {});
      } catch {
        // 비디오 재생 예외 무시
      }
    }

    const tickCanvas = now => {
      if (!archivePlayerState.playing || archivePlayerState.mode !== 'canvas') return;
      const dt = Math.min(0.065, Math.max(0, (now - archivePlayerState.lastTickAt) / 1000));
      archivePlayerState.lastTickAt = now;

      if (rState.sourceMode === 'video' && srcVid && rState.videoReady && !srcVid.paused) {
        archivePlayerState.currentTime = srcVid.currentTime;
        if (archivePlayerState.currentTime >= maxT - 0.02 || srcVid.ended) {
          srcVid.currentTime = minT;
          archivePlayerState.currentTime = minT;
          void srcVid.play().catch(() => {});
        }
      } else {
        archivePlayerState.currentTime += dt * (archivePlayerState.playbackSpeed || 0.5);
        if (archivePlayerState.currentTime >= maxT) {
          archivePlayerState.currentTime = minT;
          if (rState.sourceMode === 'video' && srcVid && rState.videoReady) {
            srcVid.currentTime = minT;
          }
        }
      }

      rState.currentTime = archivePlayerState.currentTime;
      renderArchiveCompositeCanvasFrame();
      syncArchivePlayerControlsUI();
      archivePlayerState.rafId = requestAnimationFrame(tickCanvas);
    };

    if (archivePlayerState.rafId) cancelAnimationFrame(archivePlayerState.rafId);
    archivePlayerState.rafId = requestAnimationFrame(tickCanvas);
    syncArchivePlayerControlsUI();
  }
}

function toggleArchivePreviewPlayback() {
  if (archivePlayerState.playing) {
    stopArchivePreviewPlayback();
  } else {
    startArchivePreviewPlayback();
  }
}

/**
 * 저장된 shotTracerOptions 객체에서 수동 지정되었거나 영상 보정된 지점(출발점·중간점·APEX·탄착·런)의
 * 프레임 번호(pinnedFrame)와 시간(pinnedTime)을 pinnedPointsStore에 일관되게 동기화합니다.
 */
function hydrateShotTracerPinnedStore(stOpts, keyMoments = [], fps = 30) {
  if (!stOpts) return stOpts;
  const safeFps = Math.max(15, Number(fps || 30));
  const impMoment = (keyMoments || []).find(m => m.key === 'impact');
  const impT = Number.isFinite(stOpts.calibratedImpactTime)
    ? Number(stOpts.calibratedImpactTime)
    : (impMoment ? Number(impMoment.time) : 1.35);
  const flightDur = Number(stOpts.flightDurationSec || 2.35);
  const rollDur = Number(stOpts.rollDurationSec || 0.45);

  const store = { ...(stOpts.pinnedPointsStore || {}) };
  for (const meta of SHOT_PIN_POINTS_META) {
    const pt = stOpts[meta.prop];
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;

    const isPinned = Boolean(
      pt.pinned ||
      store[meta.key]?.pinned ||
      (meta.key === 'apex' && stOpts.manualApexPinned) ||
      (meta.key === 'landing' && stOpts.manualLandingPinned) ||
      ((meta.key === 'origin' || meta.key === 'mid1' || meta.key === 'mid2') && stOpts.calibratedFromVideo)
    );
    if (!isPinned) continue;

    let estTime = impT;
    if (meta.key === 'origin') estTime = impT;
    else if (meta.key === 'mid1') estTime = impT + Number(pt.timeOffset || 0.035);
    else if (meta.key === 'mid2') estTime = impT + Number(pt.timeOffset || 0.070);
    else if (meta.key === 'mid3') estTime = impT + Number(pt.timeOffset || 0.105);
    else if (meta.key === 'apex') estTime = impT + flightDur * 0.46;
    else if (meta.key === 'landing') estTime = impT + flightDur;
    else if (meta.key === 'roll') estTime = impT + flightDur + rollDur;

    const pTime = Number(
      (Number.isFinite(pt.pinnedTime ?? store[meta.key]?.pinnedTime)
        ? Number(pt.pinnedTime ?? store[meta.key]?.pinnedTime)
        : estTime
      ).toFixed(3)
    );
    const pFrame = Number.isFinite(pt.pinnedFrame ?? store[meta.key]?.pinnedFrame)
      ? Number(pt.pinnedFrame ?? store[meta.key]?.pinnedFrame)
      : Math.max(1, Math.round(pTime * safeFps) + 1);

    const mergedPt = {
      ...pt,
      x: Number(pt.x.toFixed(4)),
      y: Number(pt.y.toFixed(4)),
      pinned: true,
      pinnedTime: pTime,
      pinnedFrame: pFrame
    };
    stOpts[meta.prop] = mergedPt;
    store[meta.key] = {
      key: meta.key,
      label: meta.label,
      shortLabel: meta.shortLabel,
      stepNum: meta.stepNum,
      x: mergedPt.x,
      y: mergedPt.y,
      pinned: true,
      pinnedTime: pTime,
      pinnedFrame: pFrame,
      updatedAt: store[meta.key]?.updatedAt || Date.now()
    };
  }
  stOpts.pinnedPointsStore = store;
  if (!stOpts.lastPinnedKey) {
    const keysOrder = ['roll', 'landing', 'apex', 'mid3', 'mid2', 'mid1', 'origin'];
    stOpts.lastPinnedKey = keysOrder.find(k => store[k]?.pinned) || null;
  }
  return stOpts;
}

async function saveCurrentStudioWork(forceNew = false) {
  if (appState.busy) return;
  stopPlayback();
  renderMainStage();

  const isOverwrite = !forceNew && Boolean(appState.activeArchiveId);
  await runWithBusyOverlay(
    {
      title: isOverwrite ? '수정된 작업 내용 덮어쓰기 저장 중' : '현재 스튜디오 작업 내용 보관함 저장 중',
      sub: '원본 영상 데이터·탄도 궤적·비거리 수치·지면 고정 설정을 보관함에 기록하고 있습니다...',
      stepText: '작업 데이터 직렬화 중...',
      progress: 8
    },
    async ({ setProgress }) => {
      try {
        if (appState.studioMode === 'shot-tracer' && appState.shotTracerOptions) {
          hydrateShotTracerPinnedStore(appState.shotTracerOptions, appState.keyMoments, appState.fps);
          persistRealtimePinnedPointsState(appState.shotTracerOptions);
        }
        const saved = await saveWorkRecordToArchive(appState, {
          existingId: isOverwrite ? appState.activeArchiveId : null,
          customTitle: isOverwrite ? appState.activeArchiveTitle : '',
          saveType: 'manual-project',
          outputMediaType: 'project',
          stageCanvas: $('stageCanvas'),
          onProgress: (pct, stepLabel) => {
            setProgress(pct, stepLabel);
          }
        });
        appState.activeArchiveId = saved.id;
        appState.activeArchiveTitle = saved.title;
        appState.selectedArchiveId = saved.id;
        syncActiveArchiveBannerUI();
        await refreshArchiveCountBadge();

        setStatusMessage(
          isOverwrite
            ? `[${saved.title}] 항목에 수정된 궤적·수치·화면 고정 설정을 덮어쓰기 저장했습니다. [저장된 작업 조회]에서 언제든 재생 및 확인할 수 있습니다.`
            : `현재 작업([${saved.title}])을 보관함에 저장했습니다. [저장된 작업 조회]에서 결과 영상을 재생하거나 다시 불러와 이어서 편집할 수 있습니다.`
        );
      } catch (err) {
        setStatusMessage(`작업 저장 오류: ${err.message}`);
      }
    }
  );
}

async function openSavedArchiveModal(preferredSelectId = null) {
  const modal = $('savedArchiveModal');
  if (!modal) return;
  await runWithBusyOverlay(
    {
      title: '저장된 작업 보관함 목록 조회 중',
      sub: '보관함에 저장된 스윙 잔상 및 공 궤적 작업 내역을 불러오고 있습니다...',
      stepText: '보관함 데이터베이스 조회 중...'
    },
    async () => {
      if (!modal.open) {
        modal.showModal();
      }
      await renderArchiveModalUI(preferredSelectId || appState.selectedArchiveId);
    }
  );
}

function closeSavedArchiveModal() {
  stopArchivePreviewPlayback();
  revokeArchivePreviewUrl();
  const modal = $('savedArchiveModal');
  if (modal?.open) modal.close();
}

function formatKoreanTimestamp(isoStr) {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return isoStr;
  }
}

async function renderArchiveModalUI(selectId = null) {
  const allItems = await refreshArchiveCountBadge();
  const filterMode = appState.archiveFilterMode || 'all';
  const q = (appState.archiveSearchQuery || '').trim().toLowerCase();

  const filtered = allItems.filter(item => {
    if (filterMode !== 'all' && item.studioMode !== filterMode) return false;
    if (q) {
      const hay = `${item.title || ''} ${item.videoFileName || ''} ${item.summaryMetrics?.shotShapeLabel || ''} ${item.saveTypeLabel || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const listEl = $('archiveRecordList');
  const emptyEl = $('archiveEmptyState');
  if (!listEl || !emptyEl) return;

  listEl.replaceChildren();

  if (filtered.length === 0) {
    emptyEl.hidden = false;
    appState.selectedArchiveId = null;
    renderArchiveDetailPane(null);
    return;
  }

  emptyEl.hidden = true;
  const activeSelId = filtered.some(it => it.id === selectId)
    ? selectId
    : filtered[0].id;
  appState.selectedArchiveId = activeSelId;

  for (const item of filtered) {
    const li = document.createElement('li');
    li.className = `archive-record-card${item.id === activeSelId ? ' is-selected' : ''}`;
    li.dataset.archiveId = item.id;

    const isShot = item.studioMode === 'shot-tracer';
    const sm = item.summaryMetrics || {};
    const metricsSummary = isShot
      ? `구질: ${sm.shotShapeShort || '드로우'} · 탄착(캐리) ${Number(sm.carryMeters || 0).toFixed(1)}m · 최종 ${Number(sm.totalMeters || 0).toFixed(1)}m · APEX ${Number(sm.apexMeters || 0).toFixed(1)}m`
      : `스윙 템포 ${sm.tempoRatio || '3.00:1'} · 헤드스피드 ${sm.clubSpeedMph || 105}mph · 구간 ${sm.clipRangeText || '0.00s~3.20s'}`;

    li.innerHTML = `
      <div class="archive-thumb-box">
        ${item.thumbnailDataUrl ? `<img src="${item.thumbnailDataUrl}" alt="${item.title} 썸네일">` : '<span style="color:#94A3B8;font-size:11px;">미리보기</span>'}
      </div>
      <div class="archive-card-body">
        <div class="archive-card-badges">
          <span class="archive-badge-mode ${isShot ? 'is-shot' : 'is-swing'}">${isShot ? '후방 공 궤적' : '스윙 클럽 잔상'}</span>
          <span class="archive-badge-type">${item.saveTypeLabel || '편집 작업본'}</span>
          <span class="archive-card-time">${formatKoreanTimestamp(item.updatedAt)}</span>
        </div>
        <strong class="archive-card-title">${item.title || '이름 없는 작업'}</strong>
        <span class="archive-card-metrics">${metricsSummary}</span>
        <div class="archive-card-actions">
          <button type="button" class="btn-archive-card-load" data-act="load">편집장으로 불러와 수정</button>
          <button type="button" class="btn-transport" style="height:25px;padding:0 8px;font-size:11px;" data-act="view">결과 재생·상세조회</button>
          <button type="button" class="btn-archive-card-del" data-act="delete">삭제</button>
        </div>
      </div>
    `;

    li.onclick = e => {
      const actBtn = e.target.closest('button[data-act]');
      if (actBtn) {
        e.stopPropagation();
        const act = actBtn.dataset.act;
        if (act === 'load') {
          void loadArchivedWorkIntoStudio(item.id);
        } else if (act === 'delete') {
          void handleDeleteArchiveItem(item.id);
        } else {
          if (appState.selectedArchiveId === item.id) {
            startArchivePreviewPlayback();
          } else {
            appState.selectedArchiveId = item.id;
            void renderArchiveModalUI(item.id);
          }
        }
        return;
      }
      if (appState.selectedArchiveId !== item.id) {
        appState.selectedArchiveId = item.id;
        void renderArchiveModalUI(item.id);
      } else {
        toggleArchivePreviewPlayback();
      }
    };

    listEl.appendChild(li);
  }

  const selectedObj = filtered.find(it => it.id === activeSelId) || null;
  renderArchiveDetailPane(selectedObj);
}

function renderArchiveDetailPane(record) {
  const emptyPane = $('archiveDetailEmpty');
  const contentPane = $('archiveDetailContent');
  const previewCanvas = $('archivePreviewCanvas');
  const previewImg = $('archivePreviewImg');
  const previewVid = $('archivePreviewVideo');
  const playerBar = $('archivePlayerBar');
  const titleInput = $('inputArchiveDetailTitle');
  const metaGrid = $('archiveDetailMetaGrid');

  revokeArchivePreviewUrl();
  archivePlayerState.mode = 'none';
  archivePlayerState.recordId = record?.id || null;
  archivePlayerState.renderState = null;

  if (previewCanvas) {
    previewCanvas.hidden = true;
  }
  if (previewVid) {
    previewVid.pause();
    previewVid.hidden = true;
    previewVid.removeAttribute('src');
  }
  if (previewImg) {
    previewImg.hidden = true;
    previewImg.removeAttribute('src');
  }
  if (playerBar) {
    playerBar.hidden = true;
  }

  if (!record) {
    if (emptyPane) emptyPane.hidden = false;
    if (contentPane) contentPane.hidden = true;
    return;
  }

  if (emptyPane) emptyPane.hidden = true;
  if (contentPane) contentPane.hidden = false;
  if (titleInput) titleInput.value = record.title || '';

  const snap = record.studioSnapshot || null;
  const dur = Math.max(0.2, Number(snap?.duration || 3.2));
  const fps = Math.max(15, Number(snap?.fps || 30));
  const clipStart = clamp(Number(snap?.clipStartTime ?? 0), 0, dur - 0.1);
  const clipEnd = clamp(Number(snap?.clipEndTime ?? dur), clipStart + 0.1, dur);
  const impMoment = (snap?.keyMoments || []).find(m => m.key === 'impact');
  const impTime = Number.isFinite(snap?.shotTracerOptions?.calibratedImpactTime)
    ? Number(snap.shotTracerOptions.calibratedImpactTime)
    : (impMoment ? Number(impMoment.time) : dur * 0.42);

  archivePlayerState.duration = dur;
  archivePlayerState.fps = fps;
  archivePlayerState.clipStartTime = clipStart;
  archivePlayerState.clipEndTime = clipEnd;
  archivePlayerState.currentTime = clipStart;
  archivePlayerState.playbackSpeed = clamp(Number(snap?.playbackSpeed || 0.5), 0.25, 1.0);
  archivePlayerState.impactTime = impTime;

  // 1) 이미 인코딩된 동영상 파일(video-export)이 있는 경우 비디오 플레이어로 즉시 재생
  if (record.outputMediaType === 'video' && record.outputBlob) {
    activeArchivePreviewObjectUrl = URL.createObjectURL(record.outputBlob);
    archivePlayerState.mode = 'video';
    if (previewVid) {
      previewVid.hidden = false;
      previewVid.src = activeArchivePreviewObjectUrl;
      previewVid.currentTime = 0;
    }
    if (playerBar) playerBar.hidden = false;
    startArchivePreviewPlayback();
  } else if (snap && previewCanvas && record.saveType !== 'snapshot-panorama') {
    // 2) 편집 작업본(project) 또는 타임라인 스냅샷인 경우:
    // 보관된 원본 비디오(videoBlob)와 궤적·잔상·지면고정 스냅샷을 결합해 결과 조회 화면에서 실시간 합성 영상 재생!
    archivePlayerState.mode = 'canvas';
    previewCanvas.hidden = false;
    if (playerBar) playerBar.hidden = false;

    const cW = Number(snap.canvasWidth || 1280);
    const cH = Number(snap.canvasHeight || 720);
    previewCanvas.width = cW;
    previewCanvas.height = cH;

    // 메타데이터 로드 전 첫 프레임으로 썸네일을 먼저 그려 빈 화면 깜빡임 방지
    const thumbSrc = record.thumbnailDataUrl || record.outputDataUrl || '';
    if (thumbSrc) {
      const tmpImg = new Image();
      tmpImg.onload = () => {
        if (!archivePlayerState.renderState?.videoReady && archivePlayerState.recordId === record.id) {
          previewCanvas.getContext('2d').drawImage(tmpImg, 0, 0, cW, cH);
        }
      };
      tmpImg.src = thumbSrc;
    }

    const srcVid = $('archiveSourceVideo');
    const isVideoMode = record.sourceMode === 'video' && Boolean(record.videoBlob) && Boolean(srcVid);
    let samplesForPreview = Array.isArray(snap.serializedSamples)
      ? snap.serializedSamples.map(s => ({ ...s }))
      : [];

    let keyMomentsForPreview = Array.isArray(snap.keyMoments) && snap.keyMoments.length > 0
      ? JSON.parse(JSON.stringify(snap.keyMoments))
      : [];
    let addressClubForPreview = snap.addressClub ? JSON.parse(JSON.stringify(snap.addressClub)) : null;

    if (!isVideoMode && samplesForPreview.length === 0) {
      const effectivePreset = record.demoPreset === 'shot-tracer-dtl' ? 'iron-dtl' : (record.demoPreset || 'driver-fo');
      const demoData = buildDemoSwingDataset(effectivePreset, fps, dur, snap.hand || 'right');
      samplesForPreview = demoData.samples;
      if (!keyMomentsForPreview.length) keyMomentsForPreview = demoData.keyMoments;
      if (!addressClubForPreview) {
        addressClubForPreview = createAddressClubTemplate(samplesForPreview[0], cW, cH, {
          clubType: effectivePreset === 'iron-dtl' ? 'iron' : 'driver',
          hand: snap.hand || 'right'
        });
      }
    }

    const previewRenderState = {
      studioMode: record.studioMode || 'afterimage',
      sourceMode: isVideoMode ? 'video' : 'demo',
      demoPreset: record.demoPreset || 'driver-fo',
      videoElement: isVideoMode ? srcVid : null,
      videoReady: false,
      hand: snap.hand || 'right',
      fps,
      duration: dur,
      currentTime: clipStart,
      clipStartTime: clipStart,
      clipEndTime: clipEnd,
      canvasWidth: cW,
      canvasHeight: cH,
      samples: samplesForPreview,
      keyMoments: keyMomentsForPreview,
      addressClub: addressClubForPreview,
      renderOptions: {
        ...DEFAULT_RENDER_OPTIONS,
        ...(snap.renderOptions || {})
      },
      stabilizationOptions: {
        ...DEFAULT_STABILIZATION_OPTIONS,
        ...(snap.stabilizationOptions || {}),
        groundPinMode: false
      },
      shotTracerOptions: {
        ...DEFAULT_SHOT_TRACER_OPTIONS,
        ...(snap.shotTracerOptions || {}),
        enabled: (record.studioMode || 'afterimage') === 'shot-tracer',
        pinTargetMode: null,
        calibrationPreviewActive: false
      }
    };

    recomputeSamplesStabilization(previewRenderState.samples, previewRenderState.stabilizationOptions);
    archivePlayerState.renderState = previewRenderState;
    syncArchivePlayerControlsUI();

    if (isVideoMode) {
      activeArchiveSourceVideoUrl = URL.createObjectURL(record.videoBlob);
      const targetRecId = record.id;
      const onLoaded = () => {
        srcVid.removeEventListener('loadedmetadata', onLoaded);
        if (archivePlayerState.recordId !== targetRecId) return;
        previewRenderState.videoReady = true;
        srcVid.currentTime = clipStart;
        renderArchiveCompositeCanvasFrame();
        startArchivePreviewPlayback();
      };
      srcVid.addEventListener('loadedmetadata', onLoaded);
      srcVid.src = activeArchiveSourceVideoUrl;
      srcVid.load();
    } else {
      renderArchiveCompositeCanvasFrame();
      startArchivePreviewPlayback();
    }
  } else {
    // 3) 파노라마 정지 이미지 등인 경우
    archivePlayerState.mode = 'image';
    const imgSrc = record.outputDataUrl || record.thumbnailDataUrl || '';
    if (previewImg && imgSrc) {
      previewImg.hidden = false;
      previewImg.src = imgSrc;
    }
  }

  if (metaGrid) {
    const isShot = record.studioMode === 'shot-tracer';
    const sm = record.summaryMetrics || {};
    const cells = isShot
      ? [
          { label: '분석 모드 / 저장 유형', value: `${sm.studioModeLabel || '후방 공 궤적'} (${record.saveTypeLabel || '작업본'})` },
          { label: '판독·설정 구질', value: sm.shotShapeLabel || '드로우 (Draw)' },
          { label: '탄착 거리 (CARRY)', value: `${Number(sm.carryMeters || 0).toFixed(1)} m` },
          { label: '최종 거리 (런 포함)', value: `${Number(sm.totalMeters || 0).toFixed(1)} m (+런 ${Number(sm.rollMeters || 0).toFixed(1)}m)` },
          { label: '최고점 높이 (APEX) / 발사각', value: `${Number(sm.apexMeters || 0).toFixed(1)} m / ${Number(sm.launchAngleDeg || 0).toFixed(1)}°` },
          { label: '원본 영상 / 저장 일시', value: `${record.videoFileName || '데모 시뮬레이션'} (${formatKoreanTimestamp(record.updatedAt)})` }
        ]
      : [
          { label: '분석 모드 / 저장 유형', value: `${sm.studioModeLabel || '스윙 클럽 잔상'} (${record.saveTypeLabel || '작업본'})` },
          { label: '스윙 템포 비율', value: sm.tempoRatio || '3.00 : 1' },
          { label: '추정 클럽 헤드 스피드', value: `${sm.clubSpeedMph || 105} mph` },
          { label: '타임라인 추출 구간', value: sm.clipRangeText || '0.00s ~ 3.20s' },
          { label: '원본 영상 파일', value: record.videoFileName || '데모 시뮬레이션' },
          { label: '마지막 저장 일시', value: formatKoreanTimestamp(record.updatedAt) }
        ];

    metaGrid.innerHTML = cells
      .map(
        c => `
        <div class="archive-meta-cell">
          <span>${c.label}</span>
          <strong>${c.value}</strong>
        </div>`
      )
      .join('');
  }
}

async function downloadArchivedRecordSnapshot(record) {
  if (!record) return;
  const previewCanvas = $('archivePreviewCanvas');
  if (archivePlayerState.mode === 'canvas' && previewCanvas && !previewCanvas.hidden) {
    renderArchiveCompositeCanvasFrame();
    const dataUrl = previewCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${(record.title || 'golf-swing-snapshot').replace(/\s+/g, '_')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatusMessage(`결과 조회 화면의 고해상도 스냅샷(${a.download})을 다운로드했습니다.`);
    return;
  }
  const dataUrl = record.outputDataUrl || record.thumbnailDataUrl;
  if (!dataUrl) return;
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = record.outputFilename || `${(record.title || 'golf-swing-snapshot').replace(/\s+/g, '_')}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setStatusMessage(`보관함에서 스냅샷 이미지(${a.download})를 다운로드했습니다.`);
}

async function downloadOrEncodeArchivedRecordVideo(record) {
  if (!record) return;
  if (record.outputMediaType === 'video' && record.outputBlob) {
    const url = URL.createObjectURL(record.outputBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = record.outputFilename || `${(record.title || 'golf-swing').replace(/\s+/g, '_')}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setStatusMessage(`보관함에서 동영상 결과물(${a.download})을 다운로드했습니다.`);
    return;
  }

  if (archivePlayerState.mode === 'canvas' && archivePlayerState.renderState) {
    stopArchivePreviewPlayback();
    const rState = archivePlayerState.renderState;
    await runWithBusyOverlay(
      {
        title: '보관함 작업 결과 동영상 인코딩 중',
        sub: `[${record.title}] 항목의 궤적·잔상 합성 동영상을 생성하여 다운로드합니다...`,
        stepText: '비디오 프레임 합성 인코딩 중...',
        immediate: true,
        progressPct: 5
      },
      async ({ setProgress }) => {
        try {
          const result = await exportAfterimageVideo(
            rState,
            (pct, simTime) => {
              setProgress(Math.min(98, Math.max(4, pct)), `동영상 인코딩 ${pct}% (${simTime.toFixed(2)}s)`);
            },
            {
              startTime: archivePlayerState.clipStartTime,
              endTime: archivePlayerState.clipEndTime,
              speedFactor: archivePlayerState.playbackSpeed || 0.5
            }
          );
          setStatusMessage(`[${record.title}] 결과 동영상(${result.filename}) 다운로드를 완료했습니다.`);
        } catch (err) {
          setStatusMessage(`결과 동영상 생성 오류: ${err.message}`);
        }
      }
    );
  }
}

async function handleDeleteArchiveItem(id) {
  const rec = await getArchivedWorkRecordById(id);
  if (!rec) return;
  if (!window.confirm(`[${rec.title}] 저장 항목을 삭제하시겠습니까?`)) return;

  await runWithBusyOverlay(
    {
      title: '저장된 작업 항목 삭제 처리 중',
      sub: `[${rec.title}] 항목을 보관함에서 삭제하고 목록을 갱신하고 있습니다...`,
      stepText: '보관함 항목 삭제 중...'
    },
    async () => {
      await deleteArchivedWorkRecord(id);
      if (appState.activeArchiveId === id) {
        appState.activeArchiveId = null;
        appState.activeArchiveTitle = '';
        syncActiveArchiveBannerUI();
      }
      if (appState.selectedArchiveId === id) {
        appState.selectedArchiveId = null;
      }
      await renderArchiveModalUI(null);
      setStatusMessage(`저장된 작업([${rec.title}])을 삭제했습니다.`);
    }
  );
}

/**
 * 보관함에 저장된 작업 항목을 편집장(메인 스튜디오)으로 그대로 불러와서 이어서 편집할 수 있게 복원합니다.
 */
async function loadArchivedWorkIntoStudio(recordId) {
  const record = await getArchivedWorkRecordById(recordId);
  if (!record || !record.studioSnapshot) {
    setStatusMessage('저장된 작업 데이터를 불러올 수 없습니다.');
    return;
  }

  closeSavedArchiveModal();
  stopPlayback();
  saveModeWorkspaceSnapshot(appState.studioMode);
  appState.busy = true;

  const snap = record.studioSnapshot;
  const targetMode = record.studioMode || 'afterimage';
  const progressWrap = $('analysisProgressWrap');
  const progressBar = $('analysisProgressBar');

  await runWithBusyOverlay(
    {
      title: '저장된 작업을 편집장으로 불러오는 중',
      sub: `[${record.title}]의 원본 영상 프레임·지정 공 위치·비거리·지면 고정 설정을 복원하고 있습니다...`,
      stepText: '원본 미디어 및 궤적 데이터 복원 준비 중...',
      immediate: true,
      progressPct: 10
    },
    async ({ setProgress }) => {
      try {
        setStatusMessage(`저장된 작업([${record.title}])을 편집장으로 불러오는 중...`);

        // 1) 원본 비디오가 보관되어 있는 실제 비디오 작업본 복원
        if (record.sourceMode === 'video' && record.videoBlob) {
          if (progressWrap) progressWrap.hidden = false;
          if (progressBar) progressBar.value = 18;
          setProgress(18, '보관된 원본 비디오 스트림 디코딩 중...');

          const prevModeUrl = appState.modeWorkspaces?.[targetMode]?.videoObjectUrl;
          const otherModeKey = targetMode === 'shot-tracer' ? 'afterimage' : 'shot-tracer';
          const otherModeUrl = appState.modeWorkspaces?.[otherModeKey]?.videoObjectUrl;
          if (prevModeUrl && prevModeUrl !== otherModeUrl) {
            try {
              URL.revokeObjectURL(prevModeUrl);
            } catch {
              // URL 해제 예외 무시
            }
          }

          appState.uploadedVideoFile = record.videoBlob;
          const video = appState.videoElement;
          const url = URL.createObjectURL(record.videoBlob);
          appState.videoObjectUrl = url;
          appState.videoFileSignature = getVideoFileSignature(record.videoBlob) || `archive::${record.id}`;

          await new Promise((resolve, reject) => {
            const onLoaded = () => {
              cleanup();
              resolve();
            };
            const onError = () => {
              cleanup();
              reject(new Error('보관된 원본 비디오를 디코딩할 수 없습니다.'));
            };
            const cleanup = () => {
              video.removeEventListener('loadedmetadata', onLoaded);
              video.removeEventListener('error', onError);
            };
            video.addEventListener('loadedmetadata', onLoaded);
            video.addEventListener('error', onError);
            video.src = url;
            video.load();
          });

          appState.sourceMode = 'video';
          appState.videoReady = true;
          appState.videoFileName = record.videoFileName || '복원된 스윙 비디오';
          appState.canvasWidth = snap.canvasWidth || video.videoWidth || 1280;
          appState.canvasHeight = snap.canvasHeight || video.videoHeight || 720;

          const mainCanvas = $('stageCanvas');
          if (mainCanvas) {
            mainCanvas.width = appState.canvasWidth;
            mainCanvas.height = appState.canvasHeight;
          }
          const studioLayoutEl = $('studioLayout');
          if (studioLayoutEl) {
            studioLayoutEl.classList.toggle('is-portrait-video', appState.canvasHeight > appState.canvasWidth);
          }
          setViewportZoom(1.0);

          const scale = Math.min(1, 960 / Math.max(video.videoWidth || 960, video.videoHeight || 540));
          const procW = Math.max(320, Math.round((video.videoWidth || 960) * scale));
          const procH = Math.max(180, Math.round((video.videoHeight || 540) * scale));
          const procCanvas = document.createElement('canvas');
          procCanvas.width = procW;
          procCanvas.height = procH;
          const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });

          const savedSamples = Array.isArray(snap.serializedSamples) ? snap.serializedSamples : [];
          const momentTimes = (snap.keyMoments || []).map(m => Number(m.time || 0));

          // 후방 공 궤적(shot-tracer) 모드는 메인 비디오에서 직접 프레임을 렌더링하고 stabMap이 이미 보관되어 있으므로,
          // 핵심 모먼트 프레임만 즉시 캡처하여 0.3초 내에 편집장 복원을 완료합니다.
          const restoredSamples = [];
          let lastRestoreYieldAt = performance.now();

          for (let i = 0; i < savedSamples.length; i++) {
            const s = savedSamples[i];
            const isKeyFrame = momentTimes.some(mt => Math.abs(mt - s.time) <= 0.045);
            const needFrameSnap = targetMode === 'afterimage' || isKeyFrame || !s.stabMap;

            let rawSnap = null;
            let stabSnap = null;
            let stabMap = s.stabMap || null;

            if (needFrameSnap) {
              await seekVideoSafely(video, s.time);
              procCtx.drawImage(video, 0, 0, procW, procH);

              rawSnap = document.createElement('canvas');
              rawSnap.width = procW;
              rawSnap.height = procH;
              rawSnap.getContext('2d').drawImage(procCanvas, 0, 0);

              stabSnap = document.createElement('canvas');
              stabSnap.width = procW;
              stabSnap.height = procH;

              if (!stabMap) {
                const imgData = procCtx.getImageData(0, 0, procW, procH).data;
                stabMap = extractStabilizationFeatureMap(imgData, procW, procH);
              }
            }

            restoredSamples.push({
              ...s,
              stabMap,
              rawFrameCanvas: rawSnap,
              frameCanvas: stabSnap
            });

            if (performance.now() - lastRestoreYieldAt >= 26) {
              const pct = 20 + Math.round(((i + 1) / Math.max(1, savedSamples.length)) * 58);
              if (progressBar) progressBar.value = pct;
              setProgress(pct, `작업 프레임 및 궤적 복원 중 (${i + 1}/${savedSamples.length})`);
              await yieldToBrowserFrame();
              lastRestoreYieldAt = performance.now();
            }
          }

          appState.samples = restoredSamples;
        } else {
          // 2) 데모 프리셋 기반 작업본 복원
          appState.studioMode = targetMode;
          loadDemoPreset(record.demoPreset || (targetMode === 'shot-tracer' ? 'shot-tracer-dtl' : 'driver-fo'), true);
          if (Array.isArray(snap.serializedSamples) && snap.serializedSamples.length > 0) {
            appState.samples = snap.serializedSamples.map(s => ({ ...s }));
          }
        }

        // 3) 저장 당시의 모든 스튜디오 옵션·궤적 포인트 핀·구질/거리 수치·지면 고정·타임라인 구간 복원
        appState.hand = snap.hand || 'right';
        appState.fps = snap.fps || 30;
        appState.duration = snap.duration || 3.2;
        appState.currentTime = clamp(Number(snap.currentTime ?? 1.78), 0, appState.duration);
        appState.clipStartTime = Number(snap.clipStartTime ?? 0);
        appState.clipEndTime = Number(snap.clipEndTime ?? appState.duration);
        appState.clipPreset = snap.clipPreset || 'custom';
        appState.playbackSpeed = Number(snap.playbackSpeed ?? 0.5);
        appState.exportSpeedFactor = Number(snap.exportSpeedFactor ?? 0.5);
        appState.selectedPhaseKey = snap.selectedPhaseKey || 'impact';

        if (Array.isArray(snap.keyMoments) && snap.keyMoments.length > 0) {
          appState.keyMoments = JSON.parse(JSON.stringify(snap.keyMoments));
          const impM = appState.keyMoments.find(m => m.key === 'impact');
          if (impM && impM.source !== 'marked' && appState.duration >= 3.8 && impM.time > appState.duration * 0.50 && appState.samples.length > 4) {
            appState.keyMoments = detectSwingMoments(appState.samples, 0, appState.duration);
          }
        }
        const repairedImpMoment = appState.keyMoments.find(m => m.key === 'impact');
        if (snap.addressClub) {
          appState.addressClub = JSON.parse(JSON.stringify(snap.addressClub));
        }
        if (snap.renderOptions) {
          appState.renderOptions = {
            ...DEFAULT_RENDER_OPTIONS,
            ...JSON.parse(JSON.stringify(snap.renderOptions))
          };
        }
        if (snap.stabilizationOptions) {
          appState.stabilizationOptions = {
            ...DEFAULT_STABILIZATION_OPTIONS,
            ...JSON.parse(JSON.stringify(snap.stabilizationOptions)),
            groundPinMode: false
          };
          if (repairedImpMoment && appState.duration >= 3.8 && Number(appState.stabilizationOptions.referenceTime) > appState.duration * 0.52) {
            appState.stabilizationOptions.referenceTime = Number(repairedImpMoment.time.toFixed(3));
          }
        }
        if (snap.shotTracerOptions) {
          const restoredShotOpts = {
            ...DEFAULT_SHOT_TRACER_OPTIONS,
            ...JSON.parse(JSON.stringify(snap.shotTracerOptions)),
            enabled: targetMode === 'shot-tracer',
            pinTargetMode: null,
            calibrationPreviewActive: true
          };
          if (repairedImpMoment && !restoredShotOpts.originPoint?.pinned && Number(restoredShotOpts.calibratedImpactTime) > appState.duration * 0.50) {
            restoredShotOpts.calibratedImpactTime = Number(repairedImpMoment.time.toFixed(3));
          }
          appState.shotTracerOptions = hydrateShotTracerPinnedStore(
            restoredShotOpts,
            appState.keyMoments,
            appState.fps
          );
          persistRealtimePinnedPointsState(appState.shotTracerOptions);
        }

        if (appState.sourceMode === 'video' && appState.samples.length > 0) {
          setProgress(86, '지면·사람 위치 고정(Stay) 프레임 복원 중...');
          const stabSum = await recomputeSamplesStabilizationAsync(
            appState.samples,
            appState.stabilizationOptions,
            (p, st) => {
              setProgress(84 + Math.round(p * 0.14), st);
            },
            false
          );
          appState.stabilizationOptions.maxDetectedShiftX = stabSum.maxShiftX;
          appState.stabilizationOptions.maxDetectedShiftY = stabSum.maxShiftY;
          await seekVideoSafely(appState.videoElement, appState.currentTime);
        }

        appState.studioMode = targetMode;
        appState.activeArchiveId = record.id;
        appState.activeArchiveTitle = record.title;
        saveModeWorkspaceSnapshot(targetMode);

        $('activeFileLabel').textContent = formatModeFileDisplayLabel(
          targetMode,
          appState.videoFileName,
          appState.sourceMode,
          appState.canvasWidth,
          appState.canvasHeight
        );
        $('timelineRange').max = String(appState.duration);
        $('timelineRange').value = String(appState.currentTime);
        if ($('selectHandedness')) $('selectHandedness').value = appState.hand;
        if ($('selectPlaybackSpeed')) $('selectPlaybackSpeed').value = String(appState.playbackSpeed);
        if ($('selectExportSpeed')) $('selectExportSpeed').value = String(appState.exportSpeedFactor);

        syncModeVisibilityUI();
        syncRenderOptionsUI();
        syncShotTracerUI();
        syncStabilizationUI();
        syncClipRangeUI(true);
        syncActiveArchiveBannerUI();

        renderMainStage();
        if (appState.studioMode === 'shot-tracer') {
          renderShotFlightStepsStrip();
        } else {
          await renderPhaseFilmstrip();
        }
        updateMetricsAndCoachingUI();

        setStatusMessage(
          `저장된 작업([${record.title}])을 편집장으로 불러왔습니다. 지정된 공 위치·탄도 궤적·비거리·지면 고정을 이어서 수정한 뒤 [수정 작업 저장]을 누르세요.`
        );
      } catch (err) {
        setStatusMessage(`작업 불러오기 오류: ${err.message}`);
      } finally {
        if (progressWrap) progressWrap.hidden = true;
        appState.busy = false;
      }
    }
  );
}

function showSnapshotPreviewModal(title, dataUrl) {
  const modal = $('snapshotModal');
  if (!modal) return;
  const img = $('modalPreviewImg');
  const vid = $('modalPreviewVideo');
  const dl = $('modalDownloadLink');

  $('modalTitle').textContent = title;
  if (vid) {
    vid.pause();
    vid.hidden = true;
  }
  if (img) {
    img.hidden = false;
    img.src = dataUrl;
  }
  if (dl) {
    dl.textContent = '이미지 다시 저장 (PNG)';
    dl.href = dataUrl;
    dl.download = `${title.replace(/\s+/g, '_')}.png`;
  }
  if (!modal.open) modal.showModal();
}

function showVideoPreviewModal(title, videoUrl, filename) {
  const modal = $('snapshotModal');
  if (!modal) return;
  const img = $('modalPreviewImg');
  const vid = $('modalPreviewVideo');
  const dl = $('modalDownloadLink');

  $('modalTitle').textContent = title;
  if (img) {
    img.hidden = true;
  }
  if (vid) {
    vid.hidden = false;
    vid.src = videoUrl;
    vid.currentTime = 0;
    void vid.play().catch(() => {});
  }
  if (dl) {
    dl.textContent = '동영상 파일 다시 저장';
    dl.href = videoUrl;
    dl.download = filename || 'golf-swing-clip.webm';
  }
  if (!modal.open) modal.showModal();
}

window.addEventListener('DOMContentLoaded', initStudio);

