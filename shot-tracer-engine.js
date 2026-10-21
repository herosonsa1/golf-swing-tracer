/**
 * shot-tracer-engine.js
 * REA 역공학(GolfBallTracer / Shot Tracer / Toptracer 아키텍처 분석) 기반
 * 후방(Down-the-Line) 골프공 궤적(Shot Tracer), 공기역학 탄도(Trajectory),
 * APEX 최고점 말풍선, 탄착지점 캐리(Carry, m) 및 런 포함 최종거리(Total, m) 렌더링 엔진
 */

import { clamp } from './swing-engine.js?v=20261020_01';

// ============================================================================
// 1. 궤적 색상 팔레트 및 기본 설정값 (DEFAULT_SHOT_TRACER_OPTIONS)
// ============================================================================

export const SHOT_TRACE_COLOR_PALETTE = [
  { id: 'red', labelKo: '투어 레드 (기본)', hex: '#DC2626', coreHex: '#FFF1F2', glowRgba: 'rgba(220, 38, 38, 0.52)' },
  { id: 'orange', labelKo: '프로트레이서 오렌지', hex: '#EA580C', coreHex: '#FFF7ED', glowRgba: 'rgba(234, 88, 12, 0.52)' },
  { id: 'cyan', labelKo: '스카이 시안 블루', hex: '#0284C7', coreHex: '#F0F9FF', glowRgba: 'rgba(2, 132, 199, 0.52)' },
  { id: 'emerald', labelKo: '에메랄드 그린', hex: '#059669', coreHex: '#ECFDF5', glowRgba: 'rgba(5, 150, 105, 0.50)' },
  { id: 'gold', labelKo: '로열 앰버 골드', hex: '#D97706', coreHex: '#FFFBEB', glowRgba: 'rgba(217, 119, 6, 0.50)' },
  { id: 'violet', labelKo: '바이올렛 퍼플', hex: '#7C3AED', coreHex: '#F5F3FF', glowRgba: 'rgba(124, 58, 237, 0.50)' },
  { id: 'white', labelKo: '클래식 TV 화이트', hex: '#F8FAFC', coreHex: '#FFFFFF', glowRgba: 'rgba(15, 23, 42, 0.45)' },
  { id: 'gradient', labelKo: '속도 그라데이션 (레드→골드→블루)', hex: 'gradient', coreHex: '#FFFFFF', glowRgba: 'rgba(220, 38, 38, 0.48)' }
];

export const SHOT_TRACER_PRESETS = {
  'driver-draw': {
    labelKo: '드라이버 드로우 (캐리 198.5m / 총 212m)',
    clubName: 'Driver (10.5°)',
    shotShapeType: 'draw',
    carryMeters: 198.5,
    rollMeters: 13.5,
    apexMeters: 24.5,
    launchAngleDeg: 13.6,
    launchDirectionDeg: -3.5,
    ballSpeedMps: 60.4,
    backspinRpm: 2480,
    sideCurveMeters: -5.2,
    flightDurationSec: 2.70,
    rollDurationSec: 0.45,
    originPoint: { x: 0.588, y: 0.819 },
    apexPoint: { x: 0.385, y: 0.385 },
    landingPoint: { x: 0.285, y: 0.688 },
    rollEndPoint: { x: 0.262, y: 0.682 }
  },
  'driver-straight': {
    labelKo: '드라이버 스트레이트 (캐리 192m / 총 205m)',
    clubName: 'Driver (9.5°)',
    shotShapeType: 'straight',
    carryMeters: 192.0,
    rollMeters: 13.0,
    apexMeters: 23.8,
    launchAngleDeg: 13.0,
    launchDirectionDeg: 0.0,
    ballSpeedMps: 59.5,
    backspinRpm: 2550,
    sideCurveMeters: 0.0,
    flightDurationSec: 2.66,
    rollDurationSec: 0.44,
    originPoint: { x: 0.588, y: 0.819 },
    apexPoint: { x: 0.445, y: 0.390 },
    landingPoint: { x: 0.365, y: 0.688 },
    rollEndPoint: { x: 0.348, y: 0.682 }
  },
  'driver-fade': {
    labelKo: '드라이버 페이드 (캐리 188m / 총 198.5m)',
    clubName: 'Driver (10.5°)',
    shotShapeType: 'fade',
    carryMeters: 188.0,
    rollMeters: 10.5,
    apexMeters: 25.6,
    launchAngleDeg: 14.2,
    launchDirectionDeg: 2.4,
    ballSpeedMps: 58.8,
    backspinRpm: 2890,
    sideCurveMeters: 5.4,
    flightDurationSec: 2.74,
    rollDurationSec: 0.40,
    originPoint: { x: 0.588, y: 0.819 },
    apexPoint: { x: 0.655, y: 0.382 },
    landingPoint: { x: 0.750, y: 0.688 },
    rollEndPoint: { x: 0.768, y: 0.682 }
  },
  'driver-pull': {
    labelKo: '드라이버 풀 (캐리 194m / 총 207m)',
    clubName: 'Driver (10.5°)',
    shotShapeType: 'pull',
    carryMeters: 194.0,
    rollMeters: 13.0,
    apexMeters: 23.5,
    launchAngleDeg: 12.8,
    launchDirectionDeg: -6.2,
    ballSpeedMps: 59.8,
    backspinRpm: 2520,
    sideCurveMeters: -3.2,
    flightDurationSec: 2.66,
    rollDurationSec: 0.44,
    originPoint: { x: 0.588, y: 0.819 },
    apexPoint: { x: 0.395, y: 0.392 },
    landingPoint: { x: 0.280, y: 0.688 },
    rollEndPoint: { x: 0.262, y: 0.682 }
  },
  'driver-push': {
    labelKo: '드라이버 푸쉬 (캐리 190m / 총 202.5m)',
    clubName: 'Driver (10.5°)',
    shotShapeType: 'push',
    carryMeters: 190.0,
    rollMeters: 12.5,
    apexMeters: 24.2,
    launchAngleDeg: 13.4,
    launchDirectionDeg: 6.2,
    ballSpeedMps: 59.2,
    backspinRpm: 2610,
    sideCurveMeters: 3.2,
    flightDurationSec: 2.68,
    rollDurationSec: 0.42,
    originPoint: { x: 0.588, y: 0.819 },
    apexPoint: { x: 0.650, y: 0.388 },
    landingPoint: { x: 0.735, y: 0.688 },
    rollEndPoint: { x: 0.752, y: 0.682 }
  },
  'driver-hook': {
    labelKo: '드라이버 훅 (캐리 182m / 총 198m)',
    clubName: 'Driver (10.5°)',
    shotShapeType: 'hook',
    carryMeters: 182.0,
    rollMeters: 16.0,
    apexMeters: 21.0,
    launchAngleDeg: 11.4,
    launchDirectionDeg: -5.5,
    ballSpeedMps: 58.5,
    backspinRpm: 2150,
    sideCurveMeters: -12.5,
    flightDurationSec: 2.52,
    rollDurationSec: 0.52,
    originPoint: { x: 0.588, y: 0.819 },
    apexPoint: { x: 0.355, y: 0.408 },
    landingPoint: { x: 0.215, y: 0.690 },
    rollEndPoint: { x: 0.188, y: 0.684 }
  },
  'driver-slice': {
    labelKo: '드라이버 슬라이스 (캐리 174m / 총 182.5m)',
    clubName: 'Driver (10.5°)',
    shotShapeType: 'slice',
    carryMeters: 174.0,
    rollMeters: 8.5,
    apexMeters: 26.8,
    launchAngleDeg: 15.2,
    launchDirectionDeg: 4.5,
    ballSpeedMps: 57.4,
    backspinRpm: 3420,
    sideCurveMeters: 12.5,
    flightDurationSec: 2.78,
    rollDurationSec: 0.35,
    originPoint: { x: 0.588, y: 0.819 },
    apexPoint: { x: 0.675, y: 0.378 },
    landingPoint: { x: 0.810, y: 0.690 },
    rollEndPoint: { x: 0.828, y: 0.684 }
  },
  'iron-7': {
    labelKo: '7번 아이언 (캐리 142m / 총 148.5m)',
    clubName: '7-Iron (32°)',
    shotShapeType: 'draw',
    carryMeters: 142.0,
    rollMeters: 6.5,
    apexMeters: 26.5,
    launchAngleDeg: 18.8,
    launchDirectionDeg: -2.2,
    ballSpeedMps: 50.8,
    backspinRpm: 6250,
    sideCurveMeters: -2.8,
    flightDurationSec: 2.60,
    rollDurationSec: 0.30,
    originPoint: { x: 0.588, y: 0.819 },
    apexPoint: { x: 0.415, y: 0.368 },
    landingPoint: { x: 0.335, y: 0.695 },
    rollEndPoint: { x: 0.322, y: 0.690 }
  },
  'stinger': {
    labelKo: '로우 스팅어 펀치샷 (캐리 172m / 총 190.5m)',
    clubName: '2-Iron / Stinger',
    shotShapeType: 'draw',
    carryMeters: 172.0,
    rollMeters: 18.5,
    apexMeters: 14.5,
    launchAngleDeg: 8.8,
    launchDirectionDeg: -2.8,
    ballSpeedMps: 58.2,
    backspinRpm: 3100,
    sideCurveMeters: -3.5,
    flightDurationSec: 2.30,
    rollDurationSec: 0.58,
    originPoint: { x: 0.588, y: 0.819 },
    apexPoint: { x: 0.410, y: 0.445 },
    landingPoint: { x: 0.320, y: 0.690 },
    rollEndPoint: { x: 0.292, y: 0.683 }
  }
};

export const DEFAULT_SHOT_TRACER_OPTIONS = Object.freeze({
  enabled: false, // studioMode === 'shot-tracer' 일 때 자동 활성화
  trajectoryMode: 'real-tail', // 'real-tail' (실제 공 궤적 추종·영상 자동 판독) | 'simulation' (그럴싸한 방송용 표준 탄도 아크)
  shotPreset: 'driver-draw',
  shotShapeType: 'auto', // 'auto' | 'straight' | 'draw' | 'fade' | 'pull' | 'push' | 'hook' | 'slice'
  detectedShotShape: 'draw',
  terrainSlopeMode: 'auto', // 'auto' | 'flat' | 'downhill-mild' | 'downhill' | 'downhill-steep' | 'uphill-mild' | 'uphill' | 'uphill-steep'
  detectedTerrainSlope: 'flat', // 'flat' | 'downhill' | 'uphill'
  elevationDeltaMeters: 0.0, // 음수(-m): 내리막, 양수(+m): 오르막, 0: 평지
  detectedElevationDeltaMeters: 0.0,
  launchDirectionDeg: -4.2, // 초기 좌우 출발각 (음수: 좌측 Pull 방향, 양수: 우측 Push 방향)
  traceColor: '#DC2626', // 기본 빨간색 궤적
  customColorHex: '#DC2626',
  traceStyle: 'tube', // 'tube' | 'beam' | 'strobe-ball' | 'ribbon'
  lineWidth: 6,
  glowIntensity: 0.75,
  carryMeters: 198.5,
  rollMeters: 13.5,
  apexMeters: 24.5,
  launchAngleDeg: 13.6,
  ballSpeedMps: 60.4,
  backspinRpm: 2540,
  sideCurveMeters: -5.2,
  flightDurationSec: 2.70,
  rollDurationSec: 0.45,
  perspectiveKz: 21.8,
  calibratedImpactTime: null,
  manualImpactLocked: false,
  autoReadoutSource: 'video-auto', // 'video-auto' | 'manual-edited' | 'canvas-calibrated' | 'preset-sim'
  detectedFrameCount: 4,
  showApexBubble: true,
  showLandingMarker: true,
  showTrajectoryHud: true,
  showGroundShadow: true,
  showClubAfterimageInTracer: false,
  originPoint: { x: 0.588, y: 0.819 },
  midPoint1: { x: 0.525, y: 0.625, timeOffset: 0.035 },
  midPoint2: { x: 0.481, y: 0.502, timeOffset: 0.070 },
  midPoint3: { x: 0.443, y: 0.435, timeOffset: 0.105 },
  midPoint4: { x: 0.415, y: 0.402, timeOffset: 0.140 },
  trackedWaypoints: [
    { x: 0.525, y: 0.625, timeOffset: 0.035 },
    { x: 0.481, y: 0.502, timeOffset: 0.070 },
    { x: 0.443, y: 0.435, timeOffset: 0.105 },
    { x: 0.415, y: 0.402, timeOffset: 0.140 }
  ],
  apexPoint: { x: 0.385, y: 0.385 },
  landingPoint: { x: 0.335, y: 0.688 },
  rollEndPoint: { x: 0.312, y: 0.682 },
  manualApexPinned: false,
  manualLandingPinned: false,
  pinTargetMode: null, // null | 'frame-ball' | 'origin' | 'mid1' | 'mid2' | 'mid3' | 'apex' | 'landing' | 'roll'
  pinnedPointsStore: {}, // 프레임 위치 조정 후 공 위치 지정 시 실시간 저장되는 지점별 { key, x, y, pinnedFrame, pinnedTime, pinned, updatedAt }
  pinnedHistory: [], // 작업 순서대로 누적 기록되는 실시간 지정 이력
  hoverNormPoint: null // 지점 버튼 활성화 상태에서 마우스 커서 위치 미리보기 좌표
});

export const SHOT_PIN_POINTS_META = Object.freeze([
  { key: 'origin', prop: 'originPoint', stepNum: 1, label: '1. 출발점(공)', shortLabel: '1.출발점', color: '#059669' },
  { key: 'mid1', prop: 'midPoint1', stepNum: 2, label: '2. 중간점 1 (초반)', shortLabel: '2.중간점1', color: '#EA580C', realTailOnly: true },
  { key: 'mid2', prop: 'midPoint2', stepNum: 3, label: '3. 중간점 2 (중반)', shortLabel: '3.중간점2', color: '#D97706', realTailOnly: true },
  { key: 'mid3', prop: 'midPoint3', stepNum: 4, label: '4. 중간점 3 (상승)', shortLabel: '4.중간점3', color: '#0D9488', realTailOnly: true },
  { key: 'apex', prop: 'apexPoint', stepNum: 5, label: '5. 최고점(APEX)', shortLabel: '5.최고점', color: '#DC2626' },
  { key: 'landing', prop: 'landingPoint', stepNum: 6, label: '6. 탄착지점(캐리)', shortLabel: '6.탄착지점', color: '#2563EB' },
  { key: 'roll', prop: 'rollEndPoint', stepNum: 7, label: '7. 최종지점(런)', shortLabel: '7.최종지점', color: '#7C3AED' }
]);

/**
 * 현재 shotTracerOptions 내에 실시간 저장된 지점별 프레임(pinnedFrame, pinnedTime)과 공 위치(x, y)를
 * 누락 없이 조회하고, 특정 지점 버튼(targetKey)을 눌렀을 때
 * "직전 작업까지의 지정한 프레임과 위치" 목록 및 바로 직전 작업 지점을 반환합니다.
 */
export function getPinnedWorkSummaryForTarget(opts = {}, targetKey = null, impactTime = 1.72, fps = 30) {
  const safeFps = Math.max(15, Number(fps || 30));
  const impT = Number.isFinite(opts.calibratedImpactTime) ? opts.calibratedImpactTime : Number(impactTime || 1.72);
  const flightDur = Number(opts.flightDurationSec || 2.70);
  const rollDur = Number(opts.rollDurationSec || 0.45);
  const isRealTail = (opts.trajectoryMode || 'real-tail') !== 'simulation';
  const store = opts.pinnedPointsStore || {};

  const activeMetaList = SHOT_PIN_POINTS_META.filter(m => isRealTail || !m.realTailOnly);

  const allEntries = activeMetaList.map(meta => {
    const ptObj = opts[meta.prop] || {};
    const savedObj = store[meta.key] || null;
    const isPinned = Boolean(
      ptObj.pinned ||
      savedObj?.pinned ||
      (meta.key === 'apex' && opts.manualApexPinned) ||
      (meta.key === 'landing' && opts.manualLandingPinned)
    );

    const x = Number(
      (savedObj?.pinned && Number.isFinite(savedObj.x) ? savedObj.x : (ptObj.x ?? 0.5)).toFixed(4)
    );
    const y = Number(
      (savedObj?.pinned && Number.isFinite(savedObj.y) ? savedObj.y : (ptObj.y ?? 0.5)).toFixed(4)
    );

    let estTime = impT;
    if (meta.key === 'origin') {
      estTime = impT;
    } else if (meta.key === 'mid1' || meta.key === 'mid2' || meta.key === 'mid3') {
      const defOffset = meta.key === 'mid1' ? 0.035 : (meta.key === 'mid2' ? 0.070 : 0.105);
      estTime = impT + Number(ptObj.timeOffset || defOffset);
    } else if (meta.key === 'apex') {
      estTime = impT + flightDur * 0.58;
    } else if (meta.key === 'landing') {
      estTime = impT + flightDur;
    } else if (meta.key === 'roll') {
      estTime = impT + flightDur + rollDur;
    }

    const explicitTime = savedObj?.pinnedTime ?? ptObj.pinnedTime;
    const hasExplicitTime = isPinned && Number.isFinite(explicitTime);
    const rawTime = hasExplicitTime ? Number(explicitTime) : Number(estTime);
    const pinnedTime = Number(Math.max(0, rawTime).toFixed(3));
    const explicitFrame = savedObj?.pinnedFrame ?? ptObj.pinnedFrame;
    const pinnedFrame = (isPinned && Number.isFinite(explicitFrame))
      ? Number(explicitFrame)
      : Math.max(1, Math.round(pinnedTime * safeFps) + 1);

    return {
      key: meta.key,
      prop: meta.prop,
      stepNum: meta.stepNum,
      label: meta.label,
      shortLabel: meta.shortLabel,
      color: meta.color,
      x,
      y,
      xPct: (x * 100).toFixed(1),
      yPct: (y * 100).toFixed(1),
      pinned: isPinned,
      hasExplicitTime,
      pinnedFrame,
      pinnedTime,
      updatedAt: savedObj?.updatedAt || ptObj.updatedAt || 0
    };
  });

  // 아직 수동 지정되지 않은 지점(예: 4.중간점3, 5.최고점 등)의 예상 시점을 앞뒤 수동 지정 프레임 사이에 자연스럽게 배치
  for (let i = 0; i < allEntries.length; i++) {
    const entry = allEntries[i];
    if (entry.hasExplicitTime) continue;

    let prevExp = null;
    for (let p = i - 1; p >= 0; p--) {
      if (allEntries[p].pinned) {
        prevExp = allEntries[p];
        break;
      }
    }
    let nextExp = null;
    for (let n = i + 1; n < allEntries.length; n++) {
      if (allEntries[n].pinned) {
        nextExp = allEntries[n];
        break;
      }
    }

    let refinedTime = entry.pinnedTime;
    const frameStepSec = 2 / safeFps;
    if (entry.key === 'mid1' || entry.key === 'mid2' || entry.key === 'mid3') {
      if (prevExp) {
        refinedTime = prevExp.pinnedTime + frameStepSec;
        if (nextExp && refinedTime >= nextExp.pinnedTime) {
          refinedTime = (prevExp.pinnedTime + nextExp.pinnedTime) * 0.5;
        }
      }
    } else if (entry.key === 'apex') {
      if (prevExp && nextExp && nextExp.pinnedTime > prevExp.pinnedTime) {
        refinedTime = prevExp.pinnedTime + (nextExp.pinnedTime - prevExp.pinnedTime) * 0.45;
      } else if (prevExp) {
        refinedTime = Math.max( refinedTime, prevExp.pinnedTime + 0.45 );
      }
    } else if (entry.key === 'landing') {
      if (prevExp) {
        refinedTime = Math.max(refinedTime, prevExp.pinnedTime + 0.65);
      }
    } else if (entry.key === 'roll') {
      if (prevExp) {
        refinedTime = prevExp.pinnedTime + Math.min(rollDur, 0.35);
      }
    }

    entry.pinnedTime = Number(Math.max(0, refinedTime).toFixed(3));
    entry.pinnedFrame = Math.max(1, Math.round(entry.pinnedTime * safeFps) + 1);
  }

  const userPinnedEntries = allEntries.filter(e => e.pinned);
  const targetEntry = allEntries.find(e => e.key === targetKey) || null;

  let upToPreviousEntries = [];
  if (targetEntry) {
    if (userPinnedEntries.length > 0) {
      upToPreviousEntries = userPinnedEntries;
    } else {
      upToPreviousEntries = allEntries.filter(e => e.stepNum <= targetEntry.stepNum);
      if (upToPreviousEntries.length === 0 && allEntries.length > 0) {
        upToPreviousEntries = [allEntries[0]];
      }
    }
  } else {
    upToPreviousEntries = userPinnedEntries.length > 0 ? userPinnedEntries : [allEntries[0]].filter(Boolean);
  }

  // 바로 직전 작업 지점(immediatePrevEntry) 결정:
  // targetEntry 직전 단계 중 가장 마지막에 지정된 지점 또는 opts.lastPinnedKey 지점
  let immediatePrevEntry = null;
  if (targetEntry) {
    const strictlyBeforePinned = userPinnedEntries.filter(e => e.stepNum < targetEntry.stepNum);
    if (strictlyBeforePinned.length > 0) {
      immediatePrevEntry = strictlyBeforePinned[strictlyBeforePinned.length - 1];
    }
  }
  if (!immediatePrevEntry && opts.lastPinnedKey) {
    immediatePrevEntry = allEntries.find(e => e.key === opts.lastPinnedKey && e.key !== targetKey) || null;
  }
  if (!immediatePrevEntry && userPinnedEntries.length > 0) {
    immediatePrevEntry = userPinnedEntries.filter(e => e.key !== targetKey).at(-1) || userPinnedEntries.at(-1);
  }
  if (!immediatePrevEntry && targetEntry) {
    const prevByOrder = allEntries.filter(e => e.stepNum < targetEntry.stepNum);
    immediatePrevEntry = prevByOrder.at(-1) || allEntries[0] || null;
  }

  // 지점 버튼이 눌렸을 때는 수동 핀 여부와 관계없이 직전 단계 지점을 보여주되,
  // 평상시(targetKey === null)에는 실제로 사용자가 수동 지정한 지점이 있을 때만 직전 작업 지점으로 반환
  const effectiveImmediatePrev = targetKey
    ? immediatePrevEntry
    : (userPinnedEntries.length > 0 ? (immediatePrevEntry || userPinnedEntries.at(-1)) : null);

  const effectiveUpToPins = targetKey
    ? upToPreviousEntries
    : userPinnedEntries;

  return {
    allEntries,
    userPinnedEntries,
    upToPreviousEntries,
    immediatePrevEntry: effectiveImmediatePrev,
    targetEntry,
    // 호환 별칭 (app.js 및 캔버스 HUD 렌더러 연동용)
    allPinnedList: userPinnedEntries,
    upToTargetPins: effectiveUpToPins,
    immediatePrevPin: effectiveImmediatePrev,
    targetMeta: targetEntry
  };
}

// ============================================================================
// 2. 탄도(Trajectory) 및 7대 구질(스트레이트·드로우·페이드·풀·푸쉬·훅·슬라이스) 분류기
// ============================================================================

export function classifyTrajectoryLabel(launchAngleDeg, apexMeters) {
  const deg = Number(launchAngleDeg || 13.6);
  const apex = Number(apexMeters || 24.5);
  if (deg < 9.8 || apex < 16.0) {
    return { code: 'low', labelKo: '저탄도 스팅어 (Low Piercing)', badgeColor: '#0284C7' };
  }
  if (deg <= 13.2 && apex <= 24.0) {
    return { code: 'mid', labelKo: '표준 중탄도 (Mid Trajectory)', badgeColor: '#059669' };
  }
  if (deg <= 16.2 && apex <= 30.5) {
    return { code: 'mid-high', labelKo: '중고탄도 (Mid-High Launch)', badgeColor: '#DC2626' };
  }
  return { code: 'high', labelKo: '고탄도 (High Towering)', badgeColor: '#7C3AED' };
}

/**
 * 좌우 스핀 휘어짐(sideCurveMeters), 초기 출발 방향각(launchDirectionDeg), 사용자 지정 구질(shotShapeType)을
 * 종합하여 7가지 표준 골프 구질(스트레이트, 드로우, 페이드, 풀, 푸쉬, 훅, 슬라이스)을 판독합니다.
 */
export function classifyShotShapeLabel(sideCurveMeters, launchDirectionDeg = 0, shotShapeType = 'auto') {
  const c = Number(sideCurveMeters || 0);
  const dir = Number(launchDirectionDeg || 0);
  let resolvedType = (shotShapeType && shotShapeType !== 'auto') ? shotShapeType : null;

  if (!resolvedType) {
    // 1) 강한 좌/우 스핀 휨 (훅 / 슬라이스)
    if (c <= -9.0 || (dir <= -3.5 && c <= -5.2)) {
      resolvedType = 'hook';
    } else if (c >= 9.0 || (dir >= 3.5 && c >= 5.2)) {
      resolvedType = 'slice';
    }
    // 2) 좌/우 완만한 스핀 휨 (드로우 / 페이드)
    else if (c <= -2.4) {
      resolvedType = 'draw';
    } else if (c >= 2.4) {
      resolvedType = 'fade';
    }
    // 3) 휘어짐은 적으나 초기 출발 각도가 좌/우로 크게 쏠린 구질 (풀 / 푸쉬)
    else if (dir <= -3.0) {
      resolvedType = 'pull';
    } else if (dir >= 3.0) {
      resolvedType = 'push';
    }
    // 4) 중앙 출발 및 직진 비행 (스트레이트)
    else {
      resolvedType = 'straight';
    }
  }

  switch (resolvedType) {
    case 'hook': {
      const val = (c < -1 ? c : -11.0).toFixed(1);
      return {
        code: 'hook',
        nameKo: '훅',
        labelKo: `훅 (Hook ${val}m)`,
        shortKo: `훅 (${val}m)`
      };
    }
    case 'slice': {
      const val = (c > 1 ? c : 11.0).toFixed(1);
      return {
        code: 'slice',
        nameKo: '슬라이스',
        labelKo: `슬라이스 (Slice +${val}m)`,
        shortKo: `슬라이스 (+${val}m)`
      };
    }
    case 'draw': {
      const val = (c < -0.5 ? c : -4.8).toFixed(1);
      return {
        code: 'draw',
        nameKo: '드로우',
        labelKo: `드로우 (Draw ${val}m)`,
        shortKo: `드로우 (${val}m)`
      };
    }
    case 'fade': {
      const val = (c > 0.5 ? c : 4.8).toFixed(1);
      return {
        code: 'fade',
        nameKo: '페이드',
        labelKo: `페이드 (Fade +${val}m)`,
        shortKo: `페이드 (+${val}m)`
      };
    }
    case 'pull': {
      const val = (Math.abs(dir) >= 1.5 ? -Math.abs(dir) : -5.5).toFixed(1);
      return {
        code: 'pull',
        nameKo: '풀',
        labelKo: `풀 (Pull 좌측 ${val}°)`,
        shortKo: `풀 (좌측 ${val}°)`
      };
    }
    case 'push': {
      const val = (Math.abs(dir) >= 1.5 ? Math.abs(dir) : 5.5).toFixed(1);
      return {
        code: 'push',
        nameKo: '푸쉬',
        labelKo: `푸쉬 (Push 우측 +${val}°)`,
        shortKo: `푸쉬 (우측 +${val}°)`
      };
    }
    case 'straight':
    default: {
      const val = `${c >= 0 ? '+' : ''}${c.toFixed(1)}m`;
      return {
        code: 'straight',
        nameKo: '스트레이트',
        labelKo: `스트레이트 (Straight ${val})`,
        shortKo: `스트레이트 (${val})`
      };
    }
  }
}

/**
 * 사용자가 드롭다운에서 7가지 구질 중 하나를 직접 선택했을 때
 * 해당 구질에 맞는 좌우 휘어짐(sideCurveMeters)과 출발 방향각(launchDirectionDeg) 및 낙하 궤적을 설정합니다.
 */
export function applyShotShapeOptionToMetrics(opts, shapeCode) {
  const next = { ...opts, shotShapeType: shapeCode };
  if (shapeCode === 'auto') {
    next.sideCurveMeters = Number(opts.detectedSideCurveMeters ?? opts.sideCurveMeters ?? -5.2);
    next.launchDirectionDeg = Number(opts.detectedLaunchDirectionDeg ?? opts.launchDirectionDeg ?? -4.2);
  } else if (shapeCode === 'straight') {
    next.sideCurveMeters = 0.0;
    next.launchDirectionDeg = 0.0;
  } else if (shapeCode === 'draw') {
    next.sideCurveMeters = (opts.sideCurveMeters <= -2.2 && opts.sideCurveMeters > -9.0) ? opts.sideCurveMeters : -5.2;
    next.launchDirectionDeg = clamp(Number(opts.launchDirectionDeg || -1.5), -3.5, 2.5);
  } else if (shapeCode === 'fade') {
    next.sideCurveMeters = (opts.sideCurveMeters >= 2.2 && opts.sideCurveMeters < 9.0) ? opts.sideCurveMeters : 5.2;
    next.launchDirectionDeg = clamp(Number(opts.launchDirectionDeg || 1.5), -2.5, 3.5);
  } else if (shapeCode === 'pull') {
    next.sideCurveMeters = -1.4;
    next.launchDirectionDeg = -6.2;
  } else if (shapeCode === 'push') {
    next.sideCurveMeters = 1.4;
    next.launchDirectionDeg = 6.2;
  } else if (shapeCode === 'hook') {
    next.sideCurveMeters = opts.sideCurveMeters <= -9.5 ? opts.sideCurveMeters : -12.5;
    next.launchDirectionDeg = -4.8;
  } else if (shapeCode === 'slice') {
    next.sideCurveMeters = opts.sideCurveMeters >= 9.5 ? opts.sideCurveMeters : 12.5;
    next.launchDirectionDeg = 4.8;
  }
  next.manualApexPinned = false;
  next.manualLandingPinned = false;
  next.autoReadoutSource = shapeCode === 'auto' ? 'video-auto' : 'user-edited';
  return syncShotGeometryFromMetrics(next);
}

/**
 * 코스 지형 경사(오르막 / 평지 / 내리막) 및 고도차(elevationDeltaMeters, m)를 분류하여
 * 한국어 라벨, 배지 색상, 캐리/런 보정 계수, 화면 탄착 Y 오프셋을 반환합니다.
 */
export function classifyTerrainSlopeInfo(elevationDeltaMeters = 0, terrainSlopeMode = 'auto', detectedSlope = 'flat') {
  const modePresetElevMap = {
    flat: 0.0,
    'downhill-mild': -5.5,
    downhill: -10.5,
    'downhill-steep': -16.5,
    'uphill-mild': 5.5,
    uphill: 10.5,
    'uphill-steep': 16.5
  };

  const elevM = (terrainSlopeMode && terrainSlopeMode !== 'auto' && Number.isFinite(modePresetElevMap[terrainSlopeMode]))
    ? modePresetElevMap[terrainSlopeMode]
    : clamp(Number(elevationDeltaMeters || 0), -25.0, 25.0);

  let slopeType = 'flat';
  if (elevM <= -3.0 || (terrainSlopeMode === 'auto' && detectedSlope === 'downhill' && elevM <= -2.0)) {
    slopeType = 'downhill';
  } else if (elevM >= 3.0 || (terrainSlopeMode === 'auto' && detectedSlope === 'uphill' && elevM >= 2.0)) {
    slopeType = 'uphill';
  }

  const signStr = elevM > 0.05 ? `+${elevM.toFixed(1)}m` : `${elevM.toFixed(1)}m`;

  if (slopeType === 'downhill') {
    const isSteep = elevM <= -13.0;
    const nameKo = isSteep ? '급내리막' : '내리막';
    return {
      slopeType: 'downhill',
      code: isSteep ? 'downhill-steep' : (elevM <= -7.5 ? 'downhill' : 'downhill-mild'),
      elevationDeltaMeters: Number(elevM.toFixed(1)),
      nameKo,
      shortKo: `${nameKo} ${signStr}`,
      labelKo: `${nameKo} (${signStr})`,
      badgeColor: '#0284C7',
      carryDeltaMeters: Number((-elevM * 0.88).toFixed(1)),
      rollMultiplier: clamp(1 - elevM / 28, 1.05, 1.48)
    };
  }

  if (slopeType === 'uphill') {
    const isSteep = elevM >= 13.0;
    const nameKo = isSteep ? '급오르막' : '오르막';
    return {
      slopeType: 'uphill',
      code: isSteep ? 'uphill-steep' : (elevM >= 7.5 ? 'uphill' : 'uphill-mild'),
      elevationDeltaMeters: Number(elevM.toFixed(1)),
      nameKo,
      shortKo: `${nameKo} ${signStr}`,
      labelKo: `${nameKo} (${signStr})`,
      badgeColor: '#D97706',
      carryDeltaMeters: Number((-elevM * 0.88).toFixed(1)),
      rollMultiplier: clamp(1 - elevM / 28, 0.52, 0.95)
    };
  }

  return {
    slopeType: 'flat',
    code: 'flat',
    elevationDeltaMeters: Number(elevM.toFixed(1)),
    nameKo: '평지',
    shortKo: `평지 ${Math.abs(elevM) < 0.5 ? '0.0m' : signStr}`,
    labelKo: `평지 (${Math.abs(elevM) < 0.5 ? '0.0m' : signStr})`,
    badgeColor: '#059669',
    carryDeltaMeters: 0.0,
    rollMultiplier: 1.0
  };
}

/**
 * 사용자가 코스 지형 경사(자동 판독 / 평지 / 내리막 / 오르막)를 선택했을 때
 * 고도차(elevationDeltaMeters)에 맞춰 캐리 거리, 런 거리, 체공 시간 및 탄착 지점 고도(landingPoint.y)를 즉시 동기화합니다.
 */
export function applyTerrainSlopeOptionToMetrics(opts, slopeMode = 'auto') {
  const prevElev = Number(opts.elevationDeltaMeters ?? 0);
  const baseFlatCarry = Number.isFinite(opts.baseFlatCarryMeters)
    ? Number(opts.baseFlatCarryMeters)
    : clamp(Number(opts.carryMeters ?? 196.0) + prevElev * 0.88, 75.0, 260.0);
  const prevRollMult = clamp(1 - prevElev / 28, 0.52, 1.48);
  const baseFlatRoll = Number.isFinite(opts.baseFlatRollMeters)
    ? Number(opts.baseFlatRollMeters)
    : clamp(Number(opts.rollMeters ?? 13.5) / prevRollMult, 3.0, 25.0);

  const detElev = Number(opts.detectedElevationDeltaMeters ?? opts.fairwayAnchor?.elevationDeltaMeters ?? 0);
  const detSlope = opts.detectedTerrainSlope || opts.fairwayAnchor?.terrainSlopeType || 'flat';

  const slopeInfo = slopeMode === 'auto'
    ? classifyTerrainSlopeInfo(detElev, 'auto', detSlope)
    : classifyTerrainSlopeInfo(0, slopeMode, detSlope);

  const nextElev = slopeInfo.elevationDeltaMeters;
  const nextCarry = Number(clamp(baseFlatCarry - nextElev * 0.88, 70.0, 275.0).toFixed(1));
  const nextRoll = Number(clamp(baseFlatRoll * slopeInfo.rollMultiplier, 2.0, 34.0).toFixed(1));
  const nextFlightDur = Number(clamp(2.45 + (nextCarry / 220) * 0.45 - nextElev * 0.015, 2.05, 3.35).toFixed(2));
  const nextRollDur = Number(clamp(0.38 + (nextRoll / 20) * 0.18, 0.25, 0.72).toFixed(2));

  const next = {
    ...opts,
    terrainSlopeMode: slopeMode,
    elevationDeltaMeters: nextElev,
    baseFlatCarryMeters: Number(baseFlatCarry.toFixed(1)),
    baseFlatRollMeters: Number(baseFlatRoll.toFixed(1)),
    carryMeters: nextCarry,
    rollMeters: nextRoll,
    flightDurationSec: nextFlightDur,
    rollDurationSec: nextRollDur,
    manualLandingPinned: false,
    autoReadoutSource: slopeMode === 'auto' ? 'video-auto' : 'manual-edited'
  };

  return syncShotGeometryFromMetrics(next);
}

// ============================================================================
// 3. 업로드된 후방(DTL) 스윙 영상에서 공 출발점·다중 비행 프레임·최고점·탄착지점 및 물리 데이터 자동 판독
// ============================================================================

export function detectBallAndFairwayFromAddressFrame(
  frameCanvas,
  addrSample,
  hand = 'right',
  extraSamples = [],
  overrideOrigin = null
) {
  if (!frameCanvas || typeof frameCanvas.getContext !== 'function') return null;
  const width = frameCanvas.width;
  const height = frameCanvas.height;
  if (!width || !height) return null;

  let imageData;
  try {
    imageData = frameCanvas.getContext('2d').getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }

  const extraImageDataList = [];
  if (Array.isArray(extraSamples)) {
    for (const s of extraSamples) {
      const c = s?.frameCanvas;
      if (c && c !== frameCanvas && c.width === width && c.height === height && typeof c.getContext === 'function') {
        try {
          extraImageDataList.push(c.getContext('2d').getImageData(0, 0, width, height).data);
        } catch {
          // ignore
        }
      }
    }
  }

  const dirSign = hand === 'left' ? -1 : 1;
  const isPortrait = height > width * 1.05;
  const grip = addrSample?.grip || { x: 0.39, y: 0.715 };

  // 1) 어드레스 프레임 타석 매트 전방 영역에서 클럽헤드 및 그 바로 앞쪽 실제 골프공(originPoint) 검출
  const xMinNorm = dirSign > 0
    ? clamp(Math.max(0.43, (grip.x ?? 0.39) + 0.07), 0.42, 0.72)
    : clamp(Math.min(0.22, (grip.x ?? 0.61) - 0.28), 0.12, 0.45);
  const xMaxNorm = dirSign > 0
    ? clamp(Math.max(xMinNorm + 0.14, (grip.x ?? 0.39) + 0.28), 0.54, 0.82)
    : clamp(Math.min(0.57, (grip.x ?? 0.61) - 0.07), 0.28, 0.58);
  const yMinNorm = clamp((grip.y ?? 0.715) + 0.03, 0.62, 0.80);
  const yMaxNorm = clamp((grip.y ?? 0.715) + 0.20, yMinNorm + 0.06, 0.92);

  const ringDistX = Math.max(6, Math.round(width * 0.025));
  const ringDistY = Math.max(6, Math.round(height * 0.015));

  const x0 = Math.max(ringDistX + 2, Math.floor(width * xMinNorm));
  const x1 = Math.min(width - ringDistX - 2, Math.ceil(width * xMaxNorm));
  const y0 = Math.max(ringDistY + 2, Math.floor(height * yMinNorm));
  const y1 = Math.min(height - ringDistY - 2, Math.ceil(height * yMaxNorm));

  let bestScore = -1;
  let peakXNorm = null;
  let peakYNorm = null;

  for (let y = y0; y <= y1; y += 2) {
    for (let x = x0; x <= x1; x += 2) {
      const idx = (y * width + x) * 4;
      const r = imageData[idx];
      const g = imageData[idx + 1];
      const b = imageData[idx + 2];
      const lum = (r + g + b) / 3;
      if (lum < 125) continue;

      const chroma = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
      if (chroma > 45) continue;

      const idxL = (y * width + (x - ringDistX)) * 4;
      const idxR = (y * width + (x + ringDistX)) * 4;
      const idxU = ((y - ringDistY) * width + x) * 4;
      const idxD = ((y + ringDistY) * width + x) * 4;

      const lumL = (imageData[idxL] + imageData[idxL + 1] + imageData[idxL + 2]) / 3;
      const lumR = (imageData[idxR] + imageData[idxR + 1] + imageData[idxR + 2]) / 3;
      const lumU = (imageData[idxU] + imageData[idxU + 1] + imageData[idxU + 2]) / 3;
      const lumD = (imageData[idxD] + imageData[idxD + 1] + imageData[idxD + 2]) / 3;

      // 흰색 골프화(위쪽에 밝은 바지/다리가 이어짐)를 배제하기 위해 상하좌우 중 최소 3방향 이상이 주변보다 어두운 잔디 매트여야 함
      const neighborThr = Math.min(172, lum - 16);
      const darkNeighbors = (lumL < neighborThr ? 1 : 0) + (lumR < neighborThr ? 1 : 0) + (lumU < neighborThr ? 1 : 0) + (lumD < neighborThr ? 1 : 0);
      if (darkNeighbors < 3) continue;

      const bgR = (imageData[idxL] + imageData[idxR] + imageData[idxU] + imageData[idxD]) * 0.25;
      const bgG = (imageData[idxL + 1] + imageData[idxR + 1] + imageData[idxU + 1] + imageData[idxD + 1]) * 0.25;
      const bgB = (imageData[idxL + 2] + imageData[idxR + 2] + imageData[idxU + 2] + imageData[idxD + 2]) * 0.25;
      const bgLum = (bgR + bgG + bgB) / 3;
      if (bgLum > 168) continue;

      const localContrast = lum - bgLum;
      if (localContrast < 22) continue;

      const greenExcess = Math.max(0, (bgG - bgR) + (bgG - bgB));
      if (greenExcess < 10) continue;

      const relContrast = (localContrast / Math.max(35, bgLum * 0.75)) * 55;
      const score = (lum - chroma) * 0.75 + localContrast * 0.8 + relContrast + greenExcess * 0.85;
      if (score > bestScore) {
        bestScore = score;
        peakXNorm = x / width;
        peakYNorm = y / height;
      }
    }
  }

  let ballOrigin = null;
  if (bestScore > 185 && peakXNorm !== null && peakYNorm !== null) {
    const radX = Math.max(4, Math.round(width * 0.022));
    const radY = Math.max(4, Math.round(height * 0.016));
    const cxPx = Math.round(peakXNorm * width);
    const cyPx = Math.round(peakYNorm * height);

    let sumX = 0;
    let sumY = 0;
    let sumW = 0;
    let minClusterX = peakXNorm;
    let maxClusterX = peakXNorm;

    for (let yy = Math.max(2, cyPx - radY); yy <= Math.min(height - 3, cyPx + radY); yy++) {
      for (let xx = Math.max(2, cxPx - radX); xx <= Math.min(width - 3, cxPx + radX); xx++) {
        const idx = (yy * width + xx) * 4;
        const r = imageData[idx];
        const g = imageData[idx + 1];
        const b = imageData[idx + 2];
        const lum = (r + g + b) / 3;
        const chroma = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
        if (lum >= 130 && chroma <= 44) {
          const nx = xx / width;
          const ny = yy / height;
          const w = Math.max(1, lum - 120);
          sumX += nx * w;
          sumY += ny * w;
          sumW += w;
          if (nx < minClusterX) minClusterX = nx;
          if (nx > maxClusterX) maxClusterX = nx;
        }
      }
    }

    const centroidX = sumW > 0 ? sumX / sumW : peakXNorm;
    const centroidY = sumW > 0 ? sumY / sumW : peakYNorm;
    const clusterSpanX = maxClusterX - minClusterX;
    const frontEdgeX = dirSign > 0 ? maxClusterX : minClusterX;

    // 골프채 끝 헤드 바로 앞쪽에 위치한 실제 골프공 좌표 산출
    const ballX = clusterSpanX >= 0.010
      ? (dirSign > 0 ? Math.max(centroidX + 0.014, frontEdgeX + 0.004) : Math.min(centroidX - 0.014, frontEdgeX - 0.004))
      : centroidX + dirSign * 0.003;
    const ballY = centroidY - 0.003;

    ballOrigin = {
      x: Number(clamp(ballX, 0.15, 0.85).toFixed(3)),
      y: Number(clamp(ballY, 0.55, 0.92).toFixed(3))
    };
  }

  const effectiveOrigin = overrideOrigin
    || ballOrigin
    || (addrSample?.ballPoint && addrSample.ballPoint.x >= 0.42 ? addrSample.ballPoint : null)
    || { x: 0.588, y: 0.819 };

  // 2) [산림-잔디 경계선(Tree-to-Grass Horizon), 열린 잔디 땅(Open Fairway Ground) 및 오르막/평지/내리막 경사 정밀 판독]
  // - 하늘 하단 경계(skyBottomY)와 깎인 잔디 카펫 점수(carpetScore = grassRatio - darkCavityRatio * 0.82)를 결합하여
  //   오르막 홀(잔디가 y=0.51~0.60까지 솟아오름), 평지 홀(y=0.64~0.67), 내리막 홀(골짜기 페어웨이 y=0.68~0.73) 모두에서
  //   산/나무 숲과 실제 잔디 지면의 경계(treeLineY)를 정확히 분리하고 홀의 고도차(elevationDeltaMeters)를 자동 판독합니다.
  const xScanMin = 0.14;
  const xScanMax = clamp(effectiveOrigin.x - 0.04, 0.44, 0.64);
  const numBins = 12;

  // 2-A) 하늘-산 능선 경계(skyBottomY) 검출
  let skyBottomY = isPortrait ? 0.46 : 0.36;
  const sx0 = Math.max(2, Math.floor(xScanMin * width));
  const sx1 = Math.min(width - 3, Math.ceil(xScanMax * width));
  for (let ny = 0.16; ny <= 0.58; ny += 0.015) {
    const ry0 = Math.max(2, Math.floor(ny * height));
    const ry1 = Math.min(height - 3, Math.ceil((ny + 0.015) * height));
    let skyPixels = 0;
    let totalPixels = 0;
    for (let py = ry0; py <= ry1; py += 2) {
      for (let px = sx0; px <= sx1; px += 3) {
        const idx = (py * width + px) * 4;
        const r = imageData[idx];
        const g = imageData[idx + 1];
        const b = imageData[idx + 2];
        const lum = (r + g + b) / 3;
        totalPixels++;
        if (lum >= 145 && b >= r - 12 && (g - b) < 18) {
          skyPixels++;
        }
      }
    }
    if (totalPixels > 0 && (skyPixels / totalPixels) >= 0.35) {
      skyBottomY = Number((ny + 0.015).toFixed(3));
    }
  }

  // 2-B) 깎인 페어웨이 잔디 픽셀 vs 산림 그림자 공동(Dark Canopy Cavity) 픽셀 판별
  const isMowedGrassPixel = (r, g, b) => {
    const lum = (r + g + b) / 3;
    return (
      g > r &&
      r > b &&
      (g - b) >= 18 &&
      (r - b) >= 10 &&
      (g - r) >= 4 &&
      lum >= 52 &&
      lum <= 218
    );
  };
  const isDarkCanopyCavity = (r, g, b) => {
    const lum = (r + g + b) / 3;
    return lum < 62 || ((r - b) < 8 && lum < 88);
  };

  // 오르막 홀에서도 솟아오른 잔디면(y ≈ 0.50~0.60)을 놓치지 않도록 skyBottomY 바로 아래부터 스캔
  const yStartNorm = clamp(skyBottomY + 0.02, isPortrait ? 0.38 : 0.30, 0.56);
  const yEndNorm = clamp(effectiveOrigin.y - 0.065, isPortrait ? 0.68 : 0.56, isPortrait ? 0.80 : 0.68);

  const rowInfos = [];
  for (let ny = yStartNorm; ny <= yEndNorm + 1e-6; ny += 0.01) {
    const ry0 = Math.max(2, Math.floor(ny * height));
    const ry1 = Math.min(height - 3, Math.ceil((ny + 0.015) * height));
    const colGrassRatios = new Array(numBins).fill(0);
    const colCarpetScores = new Array(numBins).fill(0);

    for (let bIdx = 0; bIdx < numBins; bIdx++) {
      const bx0Norm = xScanMin + ((xScanMax - xScanMin) * bIdx) / numBins;
      const bx1Norm = xScanMin + ((xScanMax - xScanMin) * (bIdx + 1)) / numBins;
      const bx0 = Math.max(2, Math.floor(bx0Norm * width));
      const bx1 = Math.min(width - 3, Math.ceil(bx1Norm * width));

      let grassCount = 0;
      let darkCavityCount = 0;
      let totalCount = 0;
      for (let py = ry0; py <= ry1; py += 2) {
        for (let px = bx0; px <= bx1; px += 2) {
          const idx = (py * width + px) * 4;
          const r = imageData[idx];
          const g = imageData[idx + 1];
          const b = imageData[idx + 2];
          totalCount++;
          if (isMowedGrassPixel(r, g, b)) {
            grassCount++;
          }
          if (isDarkCanopyCavity(r, g, b)) {
            darkCavityCount++;
          }
        }
      }
      const gRatio = totalCount > 0 ? grassCount / totalCount : 0;
      const dRatio = totalCount > 0 ? darkCavityCount / totalCount : 0;
      colGrassRatios[bIdx] = gRatio;
      colCarpetScores[bIdx] = Math.max(0, gRatio - dRatio * 0.82);
    }

    let best4Grass = 0;
    let best4Carpet = 0;
    for (let i = 0; i <= numBins - 4; i++) {
      const avgG = (colGrassRatios[i] + colGrassRatios[i + 1] + colGrassRatios[i + 2] + colGrassRatios[i + 3]) * 0.25;
      const avgC = (colCarpetScores[i] + colCarpetScores[i + 1] + colCarpetScores[i + 2] + colCarpetScores[i + 3]) * 0.25;
      if (avgG > best4Grass) best4Grass = avgG;
      if (avgC > best4Carpet) best4Carpet = avgC;
    }
    const meanGrass = colGrassRatios.reduce((a, v) => a + v, 0) / numBins;
    rowInfos.push({ ny: Number(ny.toFixed(3)), meanGrass, best4Bin: best4Grass, best4Carpet });
  }

  // 산/나무 숲이 끝나고 깎인 잔디 카펫이 시작되는 경계선(treeLineY) 검출 (오르막·평지·내리막 전 지형 대응)
  const minValidTreeY = Math.max(skyBottomY + 0.025, isPortrait ? 0.44 : 0.34);
  let treeLineY = null;
  for (let i = 0; i < rowInfos.length - 1; i++) {
    if (
      rowInfos[i].ny >= minValidTreeY &&
      rowInfos[i].best4Carpet >= 0.44 &&
      rowInfos[i].best4Bin >= 0.50 &&
      rowInfos[i + 1].best4Carpet >= 0.42
    ) {
      treeLineY = rowInfos[i].ny;
      break;
    }
  }
  if (treeLineY === null) {
    const validRows = rowInfos.filter(r => r.ny >= minValidTreeY);
    let peakRow = null;
    for (const r of validRows) {
      if (!peakRow || r.best4Carpet > peakRow.best4Carpet) peakRow = r;
    }
    if (peakRow && peakRow.best4Carpet >= 0.22) {
      treeLineY = Math.max(minValidTreeY, peakRow.ny - 0.012);
    } else {
      treeLineY = clamp(
        effectiveOrigin.y - (isPortrait ? 0.175 : 0.22),
        minValidTreeY,
        effectiveOrigin.y - 0.130
      );
    }
  }

  // 2-C) treeLineY 아래 잔디 대역에서 골퍼 몸통/다리에 가려지지 않은 가장 넓은 열린 잔디 회랑(bestOpenX) 탐색
  const corridorY0 = Math.max(2, Math.floor(clamp(treeLineY + 0.018, 0.35, effectiveOrigin.y - 0.11) * height));
  const corridorY1 = Math.min(height - 3, Math.ceil(clamp(treeLineY + 0.075, treeLineY + 0.035, effectiveOrigin.y - 0.085) * height));
  const maxCandX = Math.min(0.58, Math.max(0.28, effectiveOrigin.x - 0.08));

  let bestOpenX = clamp(effectiveOrigin.x - (isPortrait ? 0.25 : 0.18), 0.24, 0.52);
  let bestCorridorScore = -999;

  for (let nx = 0.18; nx <= maxCandX + 1e-6; nx += 0.02) {
    const gx0 = Math.max(2, Math.floor(nx * width));
    const gx1 = Math.min(width - 3, Math.ceil((nx + 0.10) * width));
    let grassPixels = 0;
    let darkObstaclePixels = 0;
    let count = 0;

    for (let py = corridorY0; py <= corridorY1; py += 2) {
      for (let px = gx0; px <= gx1; px += 2) {
        const idx = (py * width + px) * 4;
        const r = imageData[idx];
        const g = imageData[idx + 1];
        const b = imageData[idx + 2];
        const lum = (r + g + b) / 3;
        count++;

        let isGrassHere = isMowedGrassPixel(r, g, b);
        let isDarkObstacleHere = lum < 58;

        for (const extraData of extraImageDataList) {
          const er = extraData[idx];
          const eg = extraData[idx + 1];
          const eb = extraData[idx + 2];
          const elum = (er + eg + eb) / 3;
          if (elum < 58 || (eg - eb) < 12) {
            isDarkObstacleHere = true;
          }
          if (!isMowedGrassPixel(er, eg, eb)) {
            isGrassHere = false;
          }
        }

        if (isGrassHere) grassPixels++;
        if (isDarkObstacleHere) darkObstaclePixels++;
      }
    }

    const grassRatio = count > 0 ? grassPixels / count : 0;
    const darkRatio = count > 0 ? darkObstaclePixels / count : 0;
    const centerX = nx + 0.05;
    const distFromOrigin = effectiveOrigin.x - centerX;
    const distPref = 1.0 - Math.abs(distFromOrigin - (isPortrait ? 0.26 : 0.18)) * 1.15;
    const score = grassRatio * 2.2 - darkRatio * 2.6 + distPref * 0.35;

    if (score > bestCorridorScore) {
      bestCorridorScore = score;
      bestOpenX = centerX;
    }
  }

  // 2-D) [오르막(Uphill) / 평지(Flat) / 내리막(Downhill) 지형 경사 및 고도차(elevationDeltaMeters) 자동 판독]
  // 지표 1: fairwaySpanY = origin.y - treeLineY (오르막은 잔디 경사면이 카메라를 마주 보며 넓게 펼쳐짐, 내리막은 원근 압축으로 좁음)
  // 지표 2: mountainRatio = (treeLineY - skyBottomY) / fairwaySpanY (내리막은 골짜기 건너 산줄기가 두껍고, 오르막은 잔디 언덕이 산을 가림)
  // 지표 3: cliffStep = 전경 티박스와 원거리 페어웨이 사이의 명도·색상 단차 (내리막 절벽 티샷에서 단차가 크게 발생)
  const samplePatchStats = (xcNorm, ycNorm, hwNorm = 0.04, hhNorm = 0.018) => {
    const px0 = Math.max(2, Math.floor((xcNorm - hwNorm) * width));
    const px1 = Math.min(width - 3, Math.ceil((xcNorm + hwNorm) * width));
    const py0 = Math.max(2, Math.floor((ycNorm - hhNorm) * height));
    const py1 = Math.min(height - 3, Math.ceil((ycNorm + hhNorm) * height));
    let sumLum = 0;
    let sumGr = 0;
    let cnt = 0;
    for (let py = py0; py <= py1; py += 2) {
      for (let px = px0; px <= px1; px += 2) {
        const idx = (py * width + px) * 4;
        const r = imageData[idx];
        const g = imageData[idx + 1];
        const b = imageData[idx + 2];
        sumLum += (r + g + b) / 3;
        sumGr += (g - r);
        cnt++;
      }
    }
    return cnt > 0
      ? { lum: sumLum / cnt, gr: sumGr / cnt }
      : { lum: 120, gr: 15 };
  };

  const farPatch = samplePatchStats(bestOpenX, clamp(treeLineY + 0.032, 0.38, effectiveOrigin.y - 0.11));
  const nearPatch = samplePatchStats(
    clamp(bestOpenX + 0.04, 0.24, effectiveOrigin.x - 0.04),
    clamp(effectiveOrigin.y - 0.042, treeLineY + 0.07, 0.88)
  );
  const cliffStep = Math.abs(nearPatch.lum - farPatch.lum) * 0.22 + Math.abs(nearPatch.gr - farPatch.gr) * 0.45;

  const fairwaySpanY = Math.max(0.08, effectiveOrigin.y - treeLineY);
  const neutralSpanY = isPortrait ? 0.182 : 0.220;
  const mountainSpanY = Math.max(0.02, treeLineY - skyBottomY);
  const mountainRatio = mountainSpanY / fairwaySpanY;

  const spanTerm = ((fairwaySpanY - neutralSpanY) / 0.032) * 8.5;
  const mtnTerm = ((0.64 - mountainRatio) / 0.35) * 6.0;
  const cliffDropPenalty = Math.max(0, cliffStep - 8.2) * 0.68;

  let rawElevM = spanTerm + mtnTerm - cliffDropPenalty;
  // 연속된 평탄 잔디(cliffStep 낮음, fairwaySpanY 및 mountainRatio 중립 범위)는 평지(0m 부근)로 안정화
  if (
    cliffStep <= 7.5 &&
    Math.abs(fairwaySpanY - neutralSpanY) <= 0.018 &&
    mountainRatio >= 0.42 &&
    mountainRatio <= 0.82
  ) {
    rawElevM *= 0.25;
  }

  const elevationDeltaMeters = Number(clamp(rawElevM, -22.0, 20.0).toFixed(1));
  const slopeClass = classifyTerrainSlopeInfo(elevationDeltaMeters, 'auto');
  const terrainSlopeType = slopeClass.slopeType; // 'uphill' | 'flat' | 'downhill'

  // 2-E) 판독된 지형 경사(uphill / flat / downhill)에 맞춘 동적 잔디 탄착 구간([minGrassY, maxGrassY]) 및 탄착 고도(landingY) 산출
  let minGrassY;
  let maxGrassY;
  let landingY;

  if (terrainSlopeType === 'uphill') {
    // 오르막 홀: 잔디 페어웨이가 화면 위쪽(y ≈ 0.50~0.62)까지 솟아오르므로 솟아오른 오르막 잔디 사면에 정확히 탄착
    minGrassY = Number(
      clamp(treeLineY + 0.020, isPortrait ? 0.480 : 0.380, effectiveOrigin.y - 0.145).toFixed(3)
    );
    maxGrassY = Number(
      clamp(treeLineY + 0.082, minGrassY + 0.026, effectiveOrigin.y - 0.105).toFixed(3)
    );
    landingY = Number(clamp(treeLineY + 0.040, minGrassY, maxGrassY).toFixed(3));
  } else if (terrainSlopeType === 'downhill') {
    // 내리막 홀: 높은 티박스에서 아래 골짜기 페어웨이(treeLineY 아래)를 내려다보므로 골짜기 잔디면에 정확히 탄착
    minGrassY = Number(
      clamp(treeLineY + 0.018, isPortrait ? 0.655 : 0.530, effectiveOrigin.y - 0.112).toFixed(3)
    );
    maxGrassY = Number(
      clamp(treeLineY + 0.052, minGrassY + 0.020, effectiveOrigin.y - 0.088).toFixed(3)
    );
    landingY = Number(clamp(treeLineY + 0.028, minGrassY, maxGrassY).toFixed(3));
  } else {
    // 평지 홀: 산림 경계선(treeLineY) 아래의 평탄한 잔디 페어웨이에 안착
    minGrassY = Number(
      clamp(treeLineY + 0.022, isPortrait ? 0.640 : 0.520, effectiveOrigin.y - 0.125).toFixed(3)
    );
    maxGrassY = Number(
      clamp(treeLineY + 0.060, minGrassY + 0.022, effectiveOrigin.y - 0.095).toFixed(3)
    );
    landingY = Number(clamp(treeLineY + 0.034, minGrassY, maxGrassY).toFixed(3));
  }

  const fairwayAnchor = {
    x: Number(clamp(bestOpenX, 0.22, 0.58).toFixed(3)),
    y: landingY,
    treeLineY: Number(treeLineY.toFixed(3)),
    skyBottomY: Number(skyBottomY.toFixed(3)),
    minGrassY,
    maxGrassY,
    terrainSlopeType,
    elevationDeltaMeters,
    fairwaySpanY: Number(fairwaySpanY.toFixed(3)),
    mountainRatio: Number(mountainRatio.toFixed(2)),
    cliffStep: Number(cliffStep.toFixed(1)),
    isPortrait
  };

  return {
    originPoint: effectiveOrigin,
    fairwayAnchor,
    terrainSlopeType,
    elevationDeltaMeters,
    ballDirectlyDetected: Boolean(ballOrigin),
    ballConfidenceScore: Number(Math.max(0, bestScore).toFixed(1)),
    fairwayDirectlyDetected: bestCorridorScore > 0.35,
    fairwayWeight: Number((Math.max(0, bestCorridorScore) * 100).toFixed(1))
  };
}

/**
 * [4단계 정밀 임팩트-궤적 동기화 엔진 (0-Frame Error Sync)]
 * 1) 우측 배경(하늘/나무) 카메라 흔들림 모션을 차감한 순수 골퍼 스윙 에너지 버스트(burstStart) 탐색
 * 2) 햇빛 티박스와 나무 그늘 티박스 모두에서 동일하게 동작하는 상대 명암비 기반 녹색 잔디 고립 소형 점(Compact Green-Surrounded Dot) 맵 생성
 * 3) [Address ∩ Backswing \ Post-Finish] 3단계 시간차 분리로 흰색 드라이버 헤드(테이크어웨이 시 먼저 이탈)와 고정 티 마커(피니시 후에도 잔류)를
 *    100% 배제하고 순수 골프공 좌표(originPoint) 확정
 * 4) 확정된 순수 골프공 좌표의 시간축 신호에서 단일 프레임 스텝-클리프(Step-Cliff)를 검출하여,
 *    임팩트 전에 궤적이 먼저 그려지거나 스윙이 끝난 뒤 늦게 출발하는 현상을 원천 차단합니다.
 */
export function detectExactTeeBallAndImpactFromFrames(samples, keyMoments = [], fallbackOrigin = null) {
  const frameSamples = (samples || []).filter(
    s => s && s.frameCanvas && typeof s.frameCanvas.getContext === 'function'
  );
  if (frameSamples.length < 8) return null;

  const n = frameSamples.length;
  const srcW = frameSamples[0].frameCanvas.width || 180;
  const srcH = frameSamples[0].frameCanvas.height || 320;
  const isPortrait = srcH >= srcW;
  const targetW = isPortrait ? 180 : 320;
  const targetH = isPortrait ? 320 : 180;

  let workCanvas = null;
  let workCtx = null;
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    workCanvas = document.createElement('canvas');
    workCanvas.width = targetW;
    workCanvas.height = targetH;
    workCtx = workCanvas.getContext('2d', { willReadFrequently: true });
  }

  const sw = workCtx ? targetW : srcW;
  const sh = workCtx ? targetH : srcH;

  const medianOf = arr => {
    if (!arr || !arr.length) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return (sorted.length & 1) ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
  };

  const percentileOf = (arr, q) => {
    if (!arr || !arr.length) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const pos = clamp((sorted.length - 1) * q, 0, sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] * (hi - pos) + sorted[hi] * (pos - lo);
  };

  const readFrameRgba = canvas => {
    try {
      if (workCtx) {
        workCtx.drawImage(canvas, 0, 0, sw, sh);
        return workCtx.getImageData(0, 0, sw, sh).data;
      }
      return canvas.getContext('2d').getImageData(0, 0, sw, sh).data;
    } catch {
      return null;
    }
  };

  // 티박스 탐색 그리드 설정 (중단~하단 티박스 y 0.65..0.93까지 포괄하여 카메라 앵글이 높은 티샷 공 위치 y≈0.72도 완벽 검출)
  const rRing = Math.max(3, Math.round(sw * 0.022));
  const rDiag = Math.max(2, Math.round(rRing * 0.75));
  const ringOffsets = [
    [-rRing, 0], [rRing, 0], [0, -rRing], [0, rRing],
    [-rDiag, -rDiag], [rDiag, -rDiag], [-rDiag, rDiag], [rDiag, rDiag]
  ];

  const x0 = Math.max(rRing + 2, Math.floor(sw * 0.50));
  const x1 = Math.min(sw - rRing - 2, Math.ceil(sw * 0.80));
  const y0 = Math.max(rRing + 2, Math.floor(sh * 0.65));
  const y1 = Math.min(sh - rRing - 2, Math.ceil(sh * 0.93));
  const step = Math.max(2, Math.round(sw / 90));
  const gw = Math.max(1, Math.floor((x1 - x0) / step) + 1);
  const gh = Math.max(1, Math.floor((y1 - y0) / step) + 1);

  const swingEnergy = new Float32Array(n);
  const strikeEnergy = new Float32Array(n);
  const bgPanSeries = new Float32Array(n);
  const rawMaps = new Array(n);
  const pooledMaps = new Array(n);

  // 배경 흔들림(bgMed) 샘플링 영역: 구름 없는 파란 하늘(y < 0.36)에서는 카메라가 흔들려도 픽셀 차분이 0이 되어
  // 후반부 카메라 패닝이 스윙 버스트로 오인되므로, 텍스처가 존재하는 우측 중단~하단 산림·잔디(y 0.36..0.88)만 샘플링
  const bgX0 = Math.floor(sw * 0.72);
  const bgX1 = Math.floor(sw * 0.96);
  const bgY0 = Math.floor(sh * 0.36);
  const bgY1 = Math.floor(sh * 0.88);
  const bgStep = Math.max(3, Math.round(sw / 45));

  const gfX0 = Math.floor(sw * 0.16);
  const gfX1 = Math.floor(sw * 0.64);
  const gfY0 = Math.floor(sh * 0.16);
  const gfY1 = Math.floor(sh * 0.84);
  const upY0 = Math.floor(sh * 0.14);
  const upY1 = Math.floor(sh * 0.46);
  const stX0 = Math.floor(sw * 0.35);
  const stX1 = Math.floor(sw * 0.78);
  const stY0 = Math.floor(sh * 0.52);
  const stY1 = Math.floor(sh * 0.88);
  const motStep = Math.max(2, Math.round(sw / 60));

  let prevGray = null;
  const ringW = new Float32Array(8);
  const ringG = new Float32Array(8);

  for (let i = 0; i < n; i++) {
    const data = readFrameRgba(frameSamples[i].frameCanvas);
    if (!data) {
      rawMaps[i] = new Float32Array(gh * gw);
      pooledMaps[i] = new Float32Array(gh * gw);
      continue;
    }

    const gray = new Float32Array(sw * sh);
    for (let p = 0, len = sw * sh; p < len; p++) {
      const idx = p * 4;
      gray[p] = (data[idx] + data[idx + 1] + data[idx + 2]) * 0.3333333;
    }

    if (prevGray) {
      const bgDiffs = [];
      const bgAllDiffs = [];
      for (let py = bgY0; py < bgY1; py += bgStep) {
        const rowOff = py * sw;
        for (let px = bgX0; px < bgX1; px += bgStep) {
          const dVal = Math.abs(gray[rowOff + px] - prevGray[rowOff + px]);
          bgAllDiffs.push(dVal);
          // 공간 텍스처 기울기가 있는 픽셀만 골라내어 평탄한 하늘/단색 영역에 의한 bgMed=0 왜곡 방지
          const gxGrad = Math.abs(gray[rowOff + Math.min(sw - 1, px + 2)] - gray[rowOff + Math.max(0, px - 2)]);
          const gyGrad = Math.abs(gray[Math.min(sh - 1, py + 2) * sw + px] - gray[Math.max(0, py - 2) * sw + px]);
          if (gxGrad + gyGrad >= 3.0) {
            bgDiffs.push(dVal);
          }
        }
      }
      const rawBgMed = bgDiffs.length >= 6 ? medianOf(bgDiffs) : percentileOf(bgAllDiffs, 0.70);
      const bgMed = rawBgMed * 1.25;
      bgPanSeries[i] = rawBgMed;

      let gfSum = 0, gfCnt = 0;
      let upSum = 0, upCnt = 0;
      let stSum = 0, stCnt = 0;

      for (let py = upY0; py < stY1; py += motStep) {
        const rowOff = py * sw;
        for (let px = gfX0; px < stX1; px += motStep) {
          const d = Math.max(0, Math.abs(gray[rowOff + px] - prevGray[rowOff + px]) - bgMed);
          if (px >= gfX0 && px < gfX1 && py >= gfY0 && py < gfY1) {
            gfSum += d;
            gfCnt++;
          }
          if (px >= gfX0 && px < gfX1 && py >= upY0 && py < upY1) {
            upSum += d;
            upCnt++;
          }
          if (px >= stX0 && px < stX1 && py >= stY0 && py < stY1) {
            stSum += d;
            stCnt++;
          }
        }
      }

      const gfM = gfCnt > 0 ? gfSum / gfCnt : 0;
      const upM = upCnt > 0 ? upSum / upCnt : 0;
      const stM = stCnt > 0 ? stSum / stCnt : 0;
      // 카메라 전체가 패닝(rawBgMed > 3.5)될 때 배경 숲 흔들림이 스윙 에너지로 둔갑하는 현상 억제
      const panSuppress = rawBgMed > 3.5 ? 1 / (1 + (rawBgMed - 3.5) * 0.45) : 1.0;
      swingEnergy[i] = (gfM + upM * 1.2 + stM * 0.8) * panSuppress;
      strikeEnergy[i] = stM * panSuppress;
    }
    prevGray = gray;

    // 티박스 소형 녹색 잔디 고립 점(Compact Green-Surrounded Dot) 특징 추출
    const rawGrid = new Float32Array(gh * gw);
    for (let gy = 0; gy < gh; gy++) {
      const py = y0 + gy * step;
      for (let gx = 0; gx < gw; gx++) {
        const px = x0 + gx * step;
        const cIdx = (py * sw + px) * 4;
        const r = data[cIdx];
        const g = data[cIdx + 1];
        const b = data[cIdx + 2];
        const lum = (r + g + b) * 0.3333333;
        const chroma = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
        const white = lum - chroma * 0.6;
        if (white < 65) continue;

        for (let d = 0; d < 8; d++) {
          const ry = py + ringOffsets[d][1];
          const rx = px + ringOffsets[d][0];
          const rIdx = (ry * sw + rx) * 4;
          const rr = data[rIdx];
          const rg = data[rIdx + 1];
          const rb = data[rIdx + 2];
          ringW[d] = (rr + rg + rb) * 0.3333333;
          ringG[d] = (rg - rr) + (rg - rb);
        }
        ringW.sort();
        ringG.sort();

        const bgMed = 0.5 * (ringW[3] + ringW[4]);
        const bgP75 = 0.5 * (ringW[5] + ringW[6]);
        const grnMed = 0.5 * (ringG[3] + ringG[4]);
        const diffMed = white - bgMed;

        if (diffMed < 14 || grnMed < 8 || bgP75 >= white - 6) continue;

        const relContrast = (diffMed / Math.max(35, bgMed * 0.75)) * 65;
        const bigPen = Math.max(0, bgP75 - bgMed - 16) * 1.8;
        const score = Math.min(
          120,
          Math.max(0, relContrast + diffMed * 0.45 + Math.min(25, grnMed * 0.6) - bigPen)
        );
        rawGrid[gy * gw + gx] = score;
      }
    }
    rawMaps[i] = rawGrid;

    // 5x5 로컬 최댓값 풀링 (카메라 미세 흔들림 ±2% 허용)
    const pooledGrid = new Float32Array(gh * gw);
    for (let gy = 0; gy < gh; gy++) {
      const dy0 = Math.max(0, gy - 2);
      const dy1 = Math.min(gh - 1, gy + 2);
      for (let gx = 0; gx < gw; gx++) {
        const dx0 = Math.max(0, gx - 2);
        const dx1 = Math.min(gw - 1, gx + 2);
        let maxVal = 0;
        for (let yy = dy0; yy <= dy1; yy++) {
          const rOff = yy * gw;
          for (let xx = dx0; xx <= dx1; xx++) {
            const v = rawGrid[rOff + xx];
            if (v > maxVal) maxVal = v;
          }
        }
        pooledGrid[gy * gw + gx] = maxVal;
      }
    }
    pooledMaps[i] = pooledGrid;
  }

  // [1단계] 액티브 스윙 에너지 버스트(burstStart) 탐색
  const smoothE = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = swingEnergy[Math.max(0, i - 1)];
    const b = swingEnergy[i];
    const c = swingEnergy[Math.min(n - 1, i + 1)];
    smoothE[i] = a * 0.25 + b * 0.50 + c * 0.25;
  }

  const startTime = frameSamples[0].time ?? 0;
  const endTime = frameSamples[n - 1].time ?? 3.2;
  const totalDur = Math.max(0.5, endTime - startTime);
  const minBurst = startTime + Math.max(0.20, Math.min(0.45, totalDur * 0.10));
  // 4.2초 이상 긴 영상은 후반부(2.5초 이후)가 공 비행 및 카메라 패닝 구간이므로 스윙 버스트 시작 탐색을 전반부(<=2.15초)로 엄격히 제한
  const maxBurst = totalDur >= 4.2
    ? startTime + Math.min(2.15, totalDur * 0.44)
    : startTime + Math.min(2.48, Math.max(1.2, totalDur * 0.65));

  let burstStart = startTime + Math.min(1.5, totalDur * 0.30);
  let bestBurstAvg = -Infinity;
  for (let i = 0; i < n; i++) {
    const t0 = frameSamples[i].time;
    if (t0 < minBurst || t0 > maxBurst) continue;
    let sum = 0;
    let cnt = 0;
    for (let k = i; k < n; k++) {
      const dt = frameSamples[k].time - t0;
      if (dt > 0.85) break;
      sum += smoothE[k];
      cnt++;
    }
    if (cnt >= 3) {
      // 초반에 실제 스윙이 먼저 일어나는 특성을 반영하여 극후반부 프레임에 미세 시간 감쇠 부여
      const earlyBias = 1.0 - Math.max(0, (t0 - startTime) / Math.max(2.0, totalDur)) * 0.12;
      const avg = (sum / cnt) * earlyBias;
      if (avg > bestBurstAvg) {
        bestBurstAvg = avg;
        burstStart = t0;
      }
    }
  }

  // [3단계] 3단계 시간차 분리 (Address ∩ Backswing \ Post-Finish)로 클럽 헤드와 티 마커 배제 후 순수 골프공 확정
  const estBsStart = Math.max(startTime + 0.22, burstStart - 0.45);
  const estBsEnd = burstStart + 0.15;
  const estPostStart = Math.min(endTime - 0.20, burstStart + 0.75);
  const estPostEnd = Math.min(endTime - 0.04, burstStart + 1.65);

  let addrIndices = [];
  let bsIndices = [];
  let postIndices = [];
  for (let i = 0; i < n; i++) {
    const t = frameSamples[i].time;
    if (t >= startTime + 0.08 && t <= Math.max(startTime + 0.28, estBsStart - 0.10)) {
      addrIndices.push(i);
    }
    if (t >= estBsStart && t <= estBsEnd) {
      bsIndices.push(i);
    }
    if (t >= estPostStart && t <= estPostEnd) {
      postIndices.push(i);
    }
  }
  if (addrIndices.length < 2) addrIndices = [0, 1, 2, Math.min(n - 1, 3)];
  if (bsIndices.length < 2) {
    const midIdx = Math.max(2, Math.floor(n * 0.28));
    bsIndices = [midIdx - 1, midIdx, Math.min(n - 1, midIdx + 1)];
  }
  if (postIndices.length < 2) {
    postIndices = [Math.max(0, n - 4), Math.max(0, n - 3), Math.max(0, n - 2)];
  }

  let bestCellIdx = 0;
  let bestPresenceScore = -Infinity;
  const hasFallbackOrigin = Boolean(fallbackOrigin && Number.isFinite(fallbackOrigin.x) && Number.isFinite(fallbackOrigin.y));

  for (let cell = 0, totalCells = gh * gw; cell < totalCells; cell++) {
    const cellGy = Math.floor(cell / gw);
    const cellGx = cell % gw;
    const cellNormX = (x0 + cellGx * step) / sw;
    const cellNormY = (y0 + cellGy * step) / sh;
    // y < 0.74 상단에서는 골퍼의 손/그립(x < 0.56) 오검출을 방지
    if (cellNormY < 0.74 && cellNormX < 0.56) continue;

    const addrVals = addrIndices.map(f => pooledMaps[f][cell]);
    const bsVals = bsIndices.map(f => pooledMaps[f][cell]);
    const postVals = postIndices.map(f => pooledMaps[f][cell]);
    const bsRawVals = bsIndices.map(f => rawMaps[f][cell]);

    const addrMed = medianOf(addrVals);
    const bsMed = medianOf(bsVals);
    const postMed = medianOf(postVals);
    const postP80 = percentileOf(postVals, 0.80);
    const bsRawMed = medianOf(bsRawVals);

    let fallbackBonus = 0;
    if (hasFallbackOrigin) {
      const dist = Math.hypot(cellNormX - fallbackOrigin.x, cellNormY - fallbackOrigin.y);
      if (dist <= 0.08) {
        fallbackBonus = (1 - dist / 0.08) * 14;
      }
    }

    // 5x5 풀링 평탄부 내에서는 실제 공 중심 픽셀(bsRawMed)이 가장 높은 정확한 중심 좌표를 선택
    const presenceScore = (Math.min(addrMed, bsMed) * 1.3 + bsMed * 0.9 + bsRawMed * 0.15 + fallbackBonus) - (postMed * 1.8 + postP80 * 1.0);
    if (presenceScore > bestPresenceScore) {
      bestPresenceScore = presenceScore;
      bestCellIdx = cell;
    }
  }

  const bestGy = Math.floor(bestCellIdx / gw);
  const bestGx = bestCellIdx % gw;
  const detectedOrigin = (bestPresenceScore >= 28)
    ? {
        x: Number(clamp((x0 + bestGx * step) / sw, 0.15, 0.85).toFixed(3)),
        y: Number(clamp((y0 + bestGy * step) / sh, 0.55, 0.93).toFixed(3))
      }
    : (fallbackOrigin || { x: 0.588, y: 0.819 });

  // 만약 bestPresenceScore < 28이어서 fallbackOrigin을 사용하는 경우, bestCellIdx도 fallbackOrigin에 가장 가까운 그리드 셀로 맞춤
  if (bestPresenceScore < 28 && hasFallbackOrigin) {
    const fGx = clamp(Math.round((fallbackOrigin.x * sw - x0) / step), 0, gw - 1);
    const fGy = clamp(Math.round((fallbackOrigin.y * sh - y0) / step), 0, gh - 1);
    bestCellIdx = fGy * gw + fGx;
  }

  // [4단계] 순수 골프공 좌표의 시간축 1D 신호에서 단일 프레임 스텝-클리프(Step-Cliff) 검출
  const ts = frameSamples.map((_, i) => pooledMaps[i][bestCellIdx]);
  const beforeVals = [];
  for (let i = 0; i < n; i++) {
    const t = frameSamples[i].time;
    if (t >= startTime + 0.12 && t <= burstStart) {
      beforeVals.push(ts[i]);
    }
  }
  const beforeMed = Math.max(25, medianOf(beforeVals));

  let bestK = -1;
  let bestCliffScore = -Infinity;
  const maxImpactSearchTime = totalDur >= 4.2
    ? Math.min(startTime + 2.48, burstStart + 0.72)
    : burstStart + 0.72;

  for (let k = 1; k < n - 2; k++) {
    const tk = frameSamples[k].time;
    if (tk < estBsStart || tk > maxImpactSearchTime) continue;

    const pre = medianOf(ts.slice(Math.max(0, k - 5), k + 1));
    const curr = ts[k];
    const post = medianOf(ts.slice(k + 1, Math.min(n, k + 16)));
    const next1 = ts[k + 1];
    const next2 = ts[Math.min(n - 1, k + 2)];

    // 타격 직전 프레임(k)까지는 공이 티 위에 실제로 존재해야 함 (테이크어웨이 클럽 이탈 오인 원천 차단)
    if (curr < beforeMed * 0.55 || pre < beforeMed * 0.65) continue;

    const drop = pre - post;
    const immDrop = curr - (next1 * 0.65 + next2 * 0.35);
    const cScore = drop * 1.6 + immDrop * 1.2 - post * 1.2;

    if (cScore > bestCliffScore) {
      bestCliffScore = cScore;
      bestK = k;
    }
  }

  // 만약 공이 가려져 Step-Cliff를 찾지 못한 예외 상황에서는 burstStart 직후 타격 모션 피크 프레임 선택
  if (bestK < 0 || bestCliffScore < 18) {
    let maxStrikeScore = -Infinity;
    let strikeK = -1;
    for (let k = 1; k < n - 2; k++) {
      const tk = frameSamples[k].time;
      if (tk < burstStart - 0.05 || tk > Math.min(maxImpactSearchTime, burstStart + 0.58)) continue;
      const sScore = strikeEnergy[k] * 1.8 + smoothE[k];
      if (sScore > maxStrikeScore) {
        maxStrikeScore = sScore;
        strikeK = k;
      }
    }
    if (strikeK >= 0) bestK = strikeK;
  }

  if (bestK < 0) {
    bestK = Math.max(1, Math.min(n - 2, Math.floor(n * (totalDur >= 4.2 ? 0.33 : 0.36))));
  }

  const exactImpactTime = Number(frameSamples[bestK].time.toFixed(3));
  return {
    originPoint: detectedOrigin,
    impactTime: exactImpactTime,
    impactFrameIndex: bestK,
    burstStart: Number(burstStart.toFixed(3)),
    ballPresenceScore: Number(bestPresenceScore.toFixed(1)),
    cliffScore: Number(bestCliffScore.toFixed(1)),
    confident: Boolean(bestPresenceScore >= 28 && bestCliffScore >= 32)
  };
}

/**
 * 검출된 실제 타격 시각(exactImpactTime) 및 스윙 버스트 시작점(burstStart)에 맞춰
 * 7단계 스윙 시퀀스(address, backswing, top, downswing, impact, follow, finish) 타임스탬프를
 * 역전이나 어긋남 없이 일관되게 동기화합니다.
 */
export function reconcileKeyMomentsWithExactImpact(keyMoments, exactImpactTime, burstStart = null, samples = [], forceReconcile = false) {
  if (!Array.isArray(keyMoments) || !keyMoments.length || !Number.isFinite(exactImpactTime)) {
    return keyMoments;
  }

  const startTime = samples?.[0]?.time ?? 0;
  const endTime = samples?.[samples.length - 1]?.time ?? Math.max(3.2, exactImpactTime + 1.0);
  const byKey = Object.fromEntries(keyMoments.map(m => [m.key, m]));

  if (!forceReconcile && byKey.impact?.source === 'marked') {
    return keyMoments;
  }

  const estTop = Number.isFinite(burstStart) && (exactImpactTime - burstStart >= 0.14 && exactImpactTime - burstStart <= 0.55)
    ? clamp(burstStart + (exactImpactTime - burstStart) * 0.25, exactImpactTime - 0.42, exactImpactTime - 0.18)
    : clamp(exactImpactTime - 0.28, startTime + 0.15, Math.max(startTime + 0.15, exactImpactTime - 0.16));

  const curTop = byKey.top?.time;
  const topTime = (!forceReconcile && Number.isFinite(curTop) && exactImpactTime - curTop >= 0.15 && exactImpactTime - curTop <= 0.48)
    ? curTop
    : Number(estTop.toFixed(3));

  const curAddr = byKey.address?.time;
  const addrTime = (!forceReconcile && Number.isFinite(curAddr) && topTime - curAddr >= 0.42 && topTime - curAddr <= 1.25)
    ? curAddr
    : Number(clamp(topTime - 0.80, startTime + 0.08, Math.max(startTime + 0.12, topTime - 0.35)).toFixed(3));

  const curFin = byKey.finish?.time;
  const finTime = (!forceReconcile && Number.isFinite(curFin) && curFin - exactImpactTime >= 0.42 && curFin - exactImpactTime <= 1.25)
    ? curFin
    : Number(clamp(exactImpactTime + 0.72, exactImpactTime + 0.35, Math.max(exactImpactTime + 0.38, endTime - 0.08)).toFixed(3));

  const targetTimes = {
    address: addrTime,
    backswing: Number((addrTime + (topTime - addrTime) * 0.46).toFixed(3)),
    top: topTime,
    downswing: Number((topTime + (exactImpactTime - topTime) * 0.52).toFixed(3)),
    impact: Number(exactImpactTime.toFixed(3)),
    follow: Number((exactImpactTime + (finTime - exactImpactTime) * 0.36).toFixed(3)),
    finish: finTime
  };

  for (const m of keyMoments) {
    if ((forceReconcile || m.source !== 'marked') && Number.isFinite(targetTimes[m.key])) {
      m.time = targetTimes[m.key];
    }
  }
  return keyMoments;
}

/**
 * 티(originPoint) 위의 골프공이 실제로 타격되어 사라지는 프레임 전환(Ball Disappearance on Tee)과
 * 액티브 스윙 버스트 앵커링을 결합하여 실제 타격 순간을 정밀 검출합니다.
 */
export function detectVisualBallLaunchImpactTime(samples, keyMoments, originPoint) {
  if (!samples || samples.length < 6) return null;

  // 최우선: 4단계 정밀 티 볼 & 스텝-클리프 동기화 엔진 호출
  const exactSync = detectExactTeeBallAndImpactFromFrames(samples, keyMoments, originPoint);
  if (exactSync && Number.isFinite(exactSync.impactTime)) {
    return exactSync.impactTime;
  }

  const momentsMap = Object.fromEntries((keyMoments || []).map(m => [m.key, m.time]));
  const totalDur = Math.max(0.5, (samples[samples.length - 1]?.time ?? 3.0) - (samples[0]?.time ?? 0));
  const rawTopTime = momentsMap.top;
  const rawImpTime = momentsMap.impact;
  const rawFinTime = momentsMap.finish;

  // 샘플 내 손 높이(grip.y)에서 [백스윙 탑 -> 임팩트 최저점 -> 피니시 최고점] 구조 재확인
  let handValleyTime = null;
  let boundedTopTime = Number.isFinite(rawTopTime) ? rawTopTime : totalDur * 0.28;
  let boundedFinTime = Number.isFinite(rawFinTime) ? rawFinTime : totalDur * 0.68;

  if (boundedFinTime <= boundedTopTime + 0.16) {
    boundedTopTime = totalDur * 0.25;
    boundedFinTime = totalDur * 0.66;
  }

  let maxHandY = -Infinity;
  for (const s of samples) {
    const gy = s.grip?.y ?? s.hand?.y;
    if (s.time >= boundedTopTime + 0.06 && s.time <= boundedFinTime - 0.08 && Number.isFinite(gy)) {
      if (gy > maxHandY) {
        maxHandY = gy;
        handValleyTime = s.time;
      }
    }
  }

  const safeMaxImpactTime = Math.max(boundedTopTime + 0.12, boundedFinTime - 0.12);
  let anchorImpTime = Number.isFinite(rawImpTime) ? rawImpTime : (handValleyTime ?? (boundedTopTime + 0.26));
  if (anchorImpTime > safeMaxImpactTime || anchorImpTime < boundedTopTime + 0.05) {
    anchorImpTime = handValleyTime ?? clamp((boundedTopTime + boundedFinTime) * 0.46, boundedTopTime + 0.12, safeMaxImpactTime);
  }
  return Number(anchorImpTime.toFixed(3));
}

/**
 * 임팩트 전후 다중 프레임들(samples)에서 프레임 간 밝기 차분(Temporal Difference),
 * 어드레스 정적 배경 차분, 8방향 점광원 고립 필터 및 다중 프레임 공선성 상승 체인 탐색(Multi-Frame Collinear Rising Chain Search)을
 * 수행하여 실제 날아가는 골프공의 프레임별 위치 변화 체인(P1 -> P2 -> P3 -> P4)을 정확히 검출합니다.
 */
export function detectRealFlyingBallWaypoints(samples, keyMoments, originPoint, addrSample = null, exactImpactOverride = null) {
  if (!samples || samples.length < 4) return null;

  const momentsMap = Object.fromEntries((keyMoments || []).map(m => [m.key, m.time]));
  const visualImpTime = Number.isFinite(exactImpactOverride)
    ? exactImpactOverride
    : detectVisualBallLaunchImpactTime(samples, keyMoments, originPoint);
  const estImpTime = visualImpTime ?? momentsMap.impact ?? 1.75;

  const windowSamples = samples.filter(
    s => s.frameCanvas && s.time >= estImpTime - 0.08 && s.time <= estImpTime + 0.46
  );
  if (windowSamples.length < 3) return null;

  const getImgData = canvas => {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    try {
      return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    } catch {
      return null;
    }
  };

  const addrData = getImgData(addrSample?.frameCanvas || windowSamples[0]?.frameCanvas);
  const frameCandidatesList = [];

  for (let i = 1; i < windowSamples.length; i++) {
    const currSample = windowSamples[i];
    const prevSample = windowSamples[i - 1];
    const width = currSample.frameCanvas.width;
    const height = currSample.frameCanvas.height;
    const currData = getImgData(currSample.frameCanvas);
    const prevData = getImgData(prevSample.frameCanvas);
    if (!currData || !prevData) {
      frameCandidatesList.push({ sampleIdx: i, time: currSample.time, candidates: [] });
      continue;
    }

    const ringR = Math.max(4, Math.round(width * 0.015));
    const dirs = [
      [-ringR, 0], [ringR, 0], [0, -ringR], [0, ringR],
      [-ringR, -ringR], [ringR, -ringR], [-ringR, ringR], [ringR, ringR]
    ];

    const yMinNorm = 0.16;
    const yMaxNorm = clamp(originPoint.y - 0.055, 0.35, 0.78);
    const xMinNorm = clamp(originPoint.x - 0.255, 0.18, 0.65);
    const xMaxNorm = clamp(originPoint.x + 0.18, xMinNorm + 0.08, 0.86);

    const x0 = Math.max(ringR + 2, Math.floor(width * xMinNorm));
    const x1 = Math.min(width - ringR - 2, Math.ceil(width * xMaxNorm));
    const y0 = Math.max(ringR + 2, Math.floor(height * yMinNorm));
    const y1 = Math.min(height - ringR - 2, Math.ceil(height * yMaxNorm));

    const rawHits = [];

    for (let y = y0; y <= y1; y++) {
      const ny = y / height;
      for (let x = x0; x <= x1; x++) {
        const nx = x / width;

        // 골퍼 신체(흰색 상의/팔토시/장갑) 및 좌측 팔로우스루 클럽헤드 영역 배제
        if (nx < originPoint.x - 0.135 && ny > 0.575) continue;
        if (nx < originPoint.x - 0.245 && ny > 0.48) continue;

        const idx = (y * width + x) * 4;
        const r = currData[idx];
        const g = currData[idx + 1];
        const b = currData[idx + 2];
        const lum = (r + g + b) / 3;
        if (lum < 138) continue;

        const chroma = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
        if (chroma > 46) continue;

        const lumPrev = (prevData[idx] + prevData[idx + 1] + prevData[idx + 2]) / 3;
        const diffPrev = lum - lumPrev;
        if (diffPrev < 24) continue;

        if (ny > 0.52 && addrData && addrData.length === currData.length) {
          const lumAddr = (addrData[idx] + addrData[idx + 1] + addrData[idx + 2]) / 3;
          if (lum - lumAddr < 20) continue;
        }

        let ringSum = 0;
        let isolatedDirs = 0;
        let redArtifact = false;
        for (let d = 0; d < 8; d++) {
          const rx = x + dirs[d][0];
          const ry = y + dirs[d][1];
          const rIdx = (ry * width + rx) * 4;
          const rr = currData[rIdx];
          const rg = currData[rIdx + 1];
          const rb = currData[rIdx + 2];
          if (rr - rg > 75 && rr - rb > 75) {
            redArtifact = true;
            break;
          }
          const rLum = (rr + rg + rb) / 3;
          ringSum += rLum;
          if (lum - rLum >= 15) isolatedDirs++;
        }
        if (redArtifact) continue;
        // 하단 인접 영역(y + ringR*2)에도 인공 궤적 선이 있는지 확인
        const belowY = Math.min(height - 2, y + ringR * 2);
        const bIdx = (belowY * width + x) * 4;
        if (currData[bIdx] - currData[bIdx + 1] > 80 && currData[bIdx] - currData[bIdx + 2] > 80) continue;

        // 산 능선/구름 경계(y < 0.50)에 진입한 고공 골프공은 상단 구름과 인접할 수 있으므로 6방향 고립까지 허용하되 밝기 차분을 엄격히 요구
        const minDirs = (ny < 0.50 && lum >= 210 && diffPrev >= 30) ? 6 : 7;
        if (isolatedDirs < minDirs) continue;

        const bgLum = ringSum / 8;
        const contrast = lum - bgLum;
        if (contrast < 22) continue;

        const score = diffPrev * 1.25 + contrast * 1.45 + (isolatedDirs === 8 ? 25 : 0);
        if (score >= 112) {
          rawHits.push({ nx, ny, px: x, py: y, score, lum, diffPrev, contrast });
        }
      }
    }

    // 비최대 억제(NMS)로 프레임당 상위 16개 독립 점광원 후보 추출 및 서브픽셀 무게중심 보정
    rawHits.sort((a, b) => b.score - a.score);
    const peaks = [];
    for (const hit of rawHits) {
      if (peaks.some(p => Math.hypot(p.nx - hit.nx, p.ny - hit.ny) < 0.022)) continue;

      let sumX = 0;
      let sumY = 0;
      let sumW = 0;
      for (let yy = Math.max(1, hit.py - 2); yy <= Math.min(height - 2, hit.py + 2); yy++) {
        for (let xx = Math.max(1, hit.px - 2); xx <= Math.min(width - 2, hit.px + 2); xx++) {
          const cIdx = (yy * width + xx) * 4;
          const cLum = (currData[cIdx] + currData[cIdx + 1] + currData[cIdx + 2]) / 3;
          const pLum = (prevData[cIdx] + prevData[cIdx + 1] + prevData[cIdx + 2]) / 3;
          const w = Math.max(0, cLum - pLum - 12);
          if (w > 0) {
            sumX += (xx / width) * w;
            sumY += (yy / height) * w;
            sumW += w;
          }
        }
      }

      peaks.push({
        x: sumW > 0 ? sumX / sumW : hit.nx,
        y: sumW > 0 ? sumY / sumW : hit.ny,
        score: hit.score,
        lum: hit.lum,
        diff: hit.diffPrev,
        contrast: hit.contrast,
        time: currSample.time,
        prevTime: prevSample.time,
        sampleIdx: i
      });
      if (peaks.length >= 16) break;
    }

    frameCandidatesList.push({
      sampleIdx: i,
      time: currSample.time,
      prevTime: prevSample.time,
      candidates: peaks
    });
  }

  // 다중 프레임 공선성 상승 체인 탐색 (originPoint -> P1 -> P2 -> P3 -> P4)
  let bestChain = null;
  let bestChainMetric = -Infinity;

  for (let fIdx = 0; fIdx < frameCandidatesList.length; fIdx++) {
    const firstFrame = frameCandidatesList[fIdx];
    const minFirstTime = Number.isFinite(exactImpactOverride)
      ? estImpTime + 0.010
      : estImpTime - 0.06;
    if (firstFrame.time < minFirstTime || firstFrame.time > estImpTime + 0.14) continue;

    for (const cand1 of firstFrame.candidates) {
      if (cand1.score < 210) continue;
      const dx1 = cand1.x - originPoint.x;
      const dy1 = cand1.y - originPoint.y;
      const dist1 = Math.hypot(dx1, dy1);
      // 첫 발사 프레임은 티(originPoint)에서 위쪽으로 의미 있게 상승해야 함
      if (dy1 > -0.055 || dy1 < -0.28 || Math.abs(dx1) > 0.22 || dist1 < 0.065) continue;

      // 재귀적/반복적으로 후속 프레임에서 공선성 상승 후보 연결
      const buildChainFrom = (currentChain, lastFramePos, prevStepVec, prevStepDist) => {
        const len = currentChain.length;
        const sumScore = currentChain.reduce((acc, c) => acc + c.score, 0);
        const timingBonus = Math.max(0, 140 - Math.abs(firstFrame.prevTime - estImpTime) * 750);
        const chainMetric = sumScore + len * 480 + timingBonus;

        if (chainMetric > bestChainMetric) {
          bestChainMetric = chainMetric;
          const anchorImp = Number.isFinite(exactImpactOverride)
            ? (Math.abs(firstFrame.prevTime - exactImpactOverride) <= 0.038 ? firstFrame.prevTime : exactImpactOverride)
            : firstFrame.prevTime;
          bestChain = {
            trueImpactTime: anchorImp,
            waypoints: currentChain.map(c => ({
              x: Number(c.x.toFixed(4)),
              y: Number(c.y.toFixed(4)),
              timeOffset: Math.max(0.020, Number((c.time - anchorImp).toFixed(3))),
              score: Number(c.score.toFixed(1))
            }))
          };
        }

        if (len >= 5) return;

        // 다음 1~2 프레임 내에서 연결 가능한 공 위치 탐색
        for (let stepGap = 1; stepGap <= 2; stepGap++) {
          const nextFIdx = lastFramePos + stepGap;
          if (nextFIdx >= frameCandidatesList.length) continue;
          const nextFrame = frameCandidatesList[nextFIdx];
          const lastPt = currentChain[currentChain.length - 1];

          for (const candNext of nextFrame.candidates) {
            const vx = candNext.x - lastPt.x;
            const vy = candNext.y - lastPt.y;
            const stepDist = Math.hypot(vx, vy);

            // 상승 지속 조건 및 원근 감속 범위 검증
            if (vy > -0.018 || vy < -0.20 * stepGap) continue;
            if (stepDist < 0.022 || stepDist > prevStepDist * 1.18 * stepGap) continue;
            // 수평 진행 방향이 중간에 갑자기 역전되지 않도록 보장
            if (Math.abs(dx1) > 0.02 && vx * dx1 < -0.005) continue;

            // 방향 일관성(Collinearity): 직전 이동 벡터와의 내적 코사인 검증 (cos >= 0.90)
            const cosTheta = (vx * prevStepVec.x + vy * prevStepVec.y) / (stepDist * Math.hypot(prevStepVec.x, prevStepVec.y) + 1e-6);
            if (cosTheta < 0.90) continue;

            buildChainFrom(
              [...currentChain, { ...candNext, score: candNext.score + cosTheta * 65 }],
              nextFIdx,
              { x: vx, y: vy },
              stepDist / stepGap
            );
          }
        }
      };

      buildChainFrom([cand1], fIdx, { x: dx1, y: dy1 }, dist1);
    }
  }

  if (!bestChain || !bestChain.waypoints.length) return null;

  const rawWps = bestChain.waypoints;
  const trueImpactTime = bestChain.trueImpactTime;

  // 검출된 실제 첫 비행 프레임 직전 시각으로 임팩트 시점 동기화
  const impMomentObj = (keyMoments || []).find(m => m.key === 'impact');
  if (impMomentObj && impMomentObj.source !== 'marked' && Math.abs(trueImpactTime - impMomentObj.time) <= 0.25) {
    impMomentObj.time = Number(trueImpactTime.toFixed(3));
  }

  // 검출된 프레임 위치들(rawWps)에 물리적 중력 감속 포물선을 피팅하여
  // 직각 꺾임이나 지그재그가 전혀 없는 원만한 단일 탄도 아크 중간점(midPoint1~4) 산출
  const p0 = originPoint;
  const etaSamples = [0.28, 0.48, 0.66, 0.80];
  const ctrlRatioClimb = 0.54;

  let sumWeight = 0;
  let sumApexX = 0;
  let sumApexY = 0;

  for (let i = 0; i < Math.min(rawWps.length, 4); i++) {
    const wp = rawWps[i];
    const eta = etaSamples[i];
    const fy = 1 - Math.pow(1 - eta, 2);
    const fx = 2 * ctrlRatioClimb * eta * (1 - eta) + eta * eta;
    const estAy = clamp(p0.y - Math.max(0.05, p0.y - wp.y) / fy, 0.12, p0.y - 0.22);
    const estAx = clamp(p0.x + (wp.x - p0.x) / fx, 0.14, 0.86);
    const w = (wp.score || 250) * (i === 0 ? 1.35 : 1.0);
    sumApexX += estAx * w;
    sumApexY += estAy * w;
    sumWeight += w;
  }

  const fittedApex = {
    x: sumWeight > 0 ? sumApexX / sumWeight : clamp(p0.x - 0.28, 0.14, 0.86),
    y: sumWeight > 0 ? sumApexY / sumWeight : clamp(p0.y - 0.42, 0.14, 0.52)
  };
  if (Math.abs(fittedApex.x - p0.x) < 0.075) {
    const dirSign = (rawWps[0].x - p0.x) < 0 ? -1 : 1;
    fittedApex.x = clamp(p0.x + dirSign * 0.095, 0.14, 0.86);
  }

  const baseStepSec = clamp(Number(rawWps[0]?.timeOffset || 0.035), 0.024, 0.055);
  const reg = computeRegularizedMidpoints(p0, fittedApex, baseStepSec, ctrlRatioClimb);

  return {
    trueImpactTime: Number(trueImpactTime.toFixed(3)),
    detectedCount: rawWps.length,
    rawWaypoints: rawWps,
    waypoints: reg.waypoints,
    midPoint1: reg.midPoint1,
    midPoint2: reg.midPoint2,
    midPoint3: reg.midPoint3,
    midPoint4: reg.midPoint4
  };
}

/**
 * 출발점(p0), 사용자가 프레임별로 지정한 중간점들(pinnedMids), 최고점(pApex)을
 * 하나의 매끄럽고 유연한 탄도 곡선(단조 에르미트/베지어 블렌딩 스플라인)으로 연결하는 보간 함수를 생성합니다.
 * - 지정된 공 위치가 0~1개인 경우: 그 공 위치를 오차 0.00px로 정확히 통과하는 단일 2차 베지어 중력 포물선 생성
 * - 지정된 공 위치가 2개 이상인 경우: 모든 지정 공 위치를 정확히 통과하면서 정점(APEX)에서 수평 접선(dy/deta = 0)을 이루는
 *   유연 탄도 3차 에르미트 스플라인(Monotone Ballistic Hermite Spline) 생성
 */
export function createFlexibleClimbInterpolator(p0, pinnedMids = [], pApex, apexM = 24.5, ctrlRatioClimb = 0.54) {
  const x0 = Number(p0?.x ?? 0.592);
  const y0 = Number(p0?.y ?? 0.819);
  const xA = Number(pApex?.x ?? 0.308);
  const yA = Number(pApex?.y ?? 0.392);

  const validPinned = (pinnedMids || [])
    .filter(m => m && Number.isFinite(m.x) && Number.isFinite(m.y))
    .map(m => {
      const spanY = Math.max(0.06, y0 - yA);
      const ratioY = clamp((m.y - yA) / spanY, 0.01, 0.98);
      const etaFromY = clamp(1 - Math.sqrt(ratioY), 0.10, 0.92);
      const eta = Number.isFinite(m.eta) ? clamp(m.eta, 0.08, 0.94) : etaFromY;
      return { ...m, eta };
    })
    .sort((a, b) => a.eta - b.eta);

  // 1) 수동 고정된 중간점이 없거나 1개인 경우: 클릭 지점을 100% 정확히 지나는 단일 2차 베지어 탄도 포물선
  if (validPinned.length <= 1) {
    let xCtrl = x0 + ctrlRatioClimb * (xA - x0);
    let yPower = 2.0;

    if (validPinned.length === 1) {
      const mp = validPinned[0];
      const etaK = clamp(mp.eta, 0.10, 0.90);
      const omK = 1 - etaK;
      const denom = Math.max(0.04, 2 * etaK * omK);
      // mp.x를 오차 없이 정확히 통과하는 제어점 xCtrl 역산
      const exactCtrlX = (mp.x - omK * omK * x0 - etaK * etaK * xA) / denom;
      // 제어점이 과도하게 벗어나 직각 꺾임을 만들지 않도록 유연한 탄도 범위 내에서 허용
      const minX = Math.min(x0, xA, mp.x) - 0.08;
      const maxX = Math.max(x0, xA, mp.x) + 0.08;
      xCtrl = clamp(exactCtrlX, minX, maxX);

      // mp.y를 정확히 통과하도록 지수 yPower 미세 보정
      const ratioY = clamp((mp.y - yA) / Math.max(0.05, y0 - yA), 0.01, 0.98);
      yPower = clamp(Math.log(ratioY) / Math.log(omK), 1.35, 2.85);
    }

    return (etaRaw) => {
      const eta = clamp(etaRaw, 0, 1);
      const om = 1 - eta;
      const x = om * om * x0 + 2 * eta * om * xCtrl + eta * eta * xA;
      const yFactor = Math.pow(om, yPower);
      const y = yA + (y0 - yA) * yFactor;
      return {
        x: clamp(x, 0.02, 0.98),
        y: clamp(y, 0.02, 0.96),
        heightMeters: apexM * clamp(1 - yFactor, 0, 1)
      };
    };
  }

  // 2) 수동 고정된 중간점이 2개 이상인 경우: 모든 지정 공 위치를 유연하게 하나의 선으로 잇는 탄도 에르미트 스플라인
  const knots = [
    { eta: 0.0, x: x0, y: y0 },
    ...validPinned.map((m, idx) => ({
      eta: clamp(m.eta, 0.08 + idx * 0.06, 0.92 - (validPinned.length - 1 - idx) * 0.05),
      x: Number(m.x),
      y: Number(m.y)
    })),
    { eta: 1.0, x: xA, y: yA }
  ];

  // eta 단조 증가 보장
  for (let i = 1; i < knots.length - 1; i++) {
    knots[i].eta = clamp(knots[i].eta, knots[i - 1].eta + 0.06, 0.94 - (knots.length - 2 - i) * 0.05);
  }

  const n = knots.length;
  const dx = new Array(n - 1);
  const dy = new Array(n - 1);
  const h = new Array(n - 1);

  for (let i = 0; i < n - 1; i++) {
    h[i] = Math.max(0.02, knots[i + 1].eta - knots[i].eta);
    dx[i] = (knots[i + 1].x - knots[i].x) / h[i];
    dy[i] = (knots[i + 1].y - knots[i].y) / h[i];
  }

  const mx = new Array(n);
  const my = new Array(n);

  for (let i = 1; i < n - 1; i++) {
    mx[i] = (h[i] * dx[i - 1] + h[i - 1] * dx[i]) / (h[i - 1] + h[i]);
    // 상승 구간 단조성(Fritsch-Carlson) 보장: 정점 도달 전 위아래로 출렁이지 않게 접선 보정
    if (dy[i - 1] * dy[i] <= 0) {
      my[i] = 0;
    } else {
      my[i] = (h[i] * dy[i - 1] + h[i - 1] * dy[i]) / (h[i - 1] + h[i]);
    }
  }

  // 시작점(출발점) 자연 발사 접선 및 정점(APEX) 수평 접선(my = 0) 부여
  mx[0] = 1.35 * dx[0] - 0.35 * mx[1];
  my[0] = 1.35 * dy[0] - 0.35 * my[1];
  mx[n - 1] = 0.75 * dx[n - 2] + 0.25 * mx[n - 2];
  my[n - 1] = 0; // 정점에서는 수직 속도 0 (완만한 돔 정점)

  return (etaRaw) => {
    const eta = clamp(etaRaw, 0, 1);
    let seg = 0;
    for (let i = 0; i < n - 1; i++) {
      if (eta <= knots[i + 1].eta + 1e-6 || i === n - 2) {
        seg = i;
        break;
      }
    }
    const k0 = knots[seg];
    const k1 = knots[seg + 1];
    const segH = h[seg];
    const t = clamp((eta - k0.eta) / segH, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;

    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    const x = h00 * k0.x + h10 * segH * mx[seg] + h01 * k1.x + h11 * segH * mx[seg + 1];
    const y = h00 * k0.y + h10 * segH * my[seg] + h01 * k1.y + h11 * segH * my[seg + 1];
    const heightRatio = clamp((y0 - y) / Math.max(0.05, y0 - yA), 0, 1);

    return {
      x: clamp(x, 0.02, 0.98),
      y: clamp(y, 0.02, 0.96),
      heightMeters: apexM * heightRatio
    };
  };
}

/**
 * 출발점(p0)에서 최고점(pApex)까지 이어지는 탄도 곡선 위에
 * 중간점 1·2·3·4를 배치하되, 사용자가 직접 지정(pinned: true)한 중간점의 좌표와 프레임 시각은 그대로 보존하고
 * 나머지 중간점들이 지정된 공 위치와 하나의 유연한 곡선으로 이어지도록 정렬합니다.
 */
export function computeRegularizedMidpoints(p0, pApex, baseStepSec = 0.035, ctrlRatioClimb = 0.54, existingMids = null) {
  const x0 = Number(p0?.x ?? 0.592);
  const y0 = Number(p0?.y ?? 0.819);
  const xA = Number(pApex?.x ?? 0.308);
  const yA = Number(pApex?.y ?? 0.392);
  const dt = clamp(Number(baseStepSec || 0.035), 0.022, 0.250);

  const store = existingMids?.pinnedPointsStore || {};
  const resolveMidSource = (propName, storeKey, idx) => {
    const direct = existingMids?.[propName];
    const saved = store[storeKey];
    if (direct?.pinned && Number.isFinite(direct.x) && Number.isFinite(direct.y)) {
      return {
        ...saved,
        ...direct,
        pinned: true,
        key: storeKey,
        idx
      };
    }
    if (saved?.pinned && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      return {
        ...(direct || {}),
        ...saved,
        pinned: true,
        key: storeKey,
        idx
      };
    }
    return direct ? { ...direct, key: storeKey, idx } : null;
  };

  const rawMids = [
    resolveMidSource('midPoint1', 'mid1', 0),
    resolveMidSource('midPoint2', 'mid2', 1),
    resolveMidSource('midPoint3', 'mid3', 2)
  ];

  const spanY = Math.max(0.06, y0 - yA);
  const pinnedList = rawMids
    .filter(m => m && m.pinned && Number.isFinite(m.x) && Number.isFinite(m.y))
    .map(m => {
      const ratioY = clamp((m.y - yA) / spanY, 0.01, 0.98);
      const eta = clamp(1 - Math.sqrt(ratioY), 0.12, 0.90);
      return { ...m, eta };
    });

  // 기본 eta 배열 [0.28, 0.50, 0.72, 0.85]를 고정된 중간점의 eta에 맞춰 유연하게 재배치
  const etas = [0.28, 0.50, 0.72, 0.85];
  for (const pm of pinnedList) {
    etas[pm.idx] = pm.eta;
  }

  if (pinnedList.length > 0) {
    if (rawMids[0]?.pinned && !rawMids[1]?.pinned && !rawMids[2]?.pinned) {
      etas[1] = clamp(etas[0] + (1 - etas[0]) * 0.36, etas[0] + 0.08, 0.78);
      etas[2] = clamp(etas[0] + (1 - etas[0]) * 0.68, etas[1] + 0.08, 0.90);
    } else if (!rawMids[0]?.pinned && rawMids[1]?.pinned && !rawMids[2]?.pinned) {
      etas[0] = clamp(etas[1] * 0.52, 0.12, etas[1] - 0.06);
      etas[2] = clamp(etas[1] + (1 - etas[1]) * 0.52, etas[1] + 0.08, 0.90);
    } else if (!rawMids[0]?.pinned && !rawMids[1]?.pinned && rawMids[2]?.pinned) {
      etas[0] = clamp(etas[2] * 0.36, 0.10, etas[2] - 0.14);
      etas[1] = clamp(etas[2] * 0.68, etas[0] + 0.06, etas[2] - 0.06);
    } else if (rawMids[0]?.pinned && rawMids[1]?.pinned && !rawMids[2]?.pinned) {
      etas[1] = Math.max(etas[0] + 0.06, etas[1]);
      etas[2] = clamp(etas[1] + (1 - etas[1]) * 0.55, etas[1] + 0.06, 0.92);
    } else if (rawMids[0]?.pinned && !rawMids[1]?.pinned && rawMids[2]?.pinned) {
      etas[2] = Math.max(etas[0] + 0.12, etas[2]);
      etas[1] = Number(((etas[0] + etas[2]) * 0.5).toFixed(3));
    } else if (!rawMids[0]?.pinned && rawMids[1]?.pinned && rawMids[2]?.pinned) {
      etas[2] = Math.max(etas[1] + 0.06, etas[2]);
      etas[0] = clamp(etas[1] * 0.52, 0.10, etas[1] - 0.06);
    } else if (rawMids[0]?.pinned && rawMids[1]?.pinned && rawMids[2]?.pinned) {
      etas[1] = Math.max(etas[0] + 0.04, etas[1]);
      etas[2] = Math.max(etas[1] + 0.04, etas[2]);
    }
    etas[3] = clamp(etas[2] + (1 - etas[2]) * 0.55, etas[2] + 0.04, 0.96);
  }

  const climbInterp = createFlexibleClimbInterpolator(
    { x: x0, y: y0 },
    pinnedList.map(pm => ({ ...pm, eta: etas[pm.idx] })),
    { x: xA, y: yA },
    24.5,
    ctrlRatioClimb
  );

  // 시간 오프셋(timeOffset) 역시 사용자가 멈춘 프레임 시각(pinnedTime / timeOffset)에 비례하도록 동기화
  let refEta = 0.28;
  let refTimeOffset = dt;
  if (pinnedList.length > 0) {
    const lastPinned = pinnedList[pinnedList.length - 1];
    refEta = Math.max(0.15, etas[lastPinned.idx]);
    refTimeOffset = Math.max(0.025, Number(lastPinned.timeOffset || (dt * (lastPinned.idx + 1))));
  }

  const pts = etas.map((eta, idx) => {
    const existing = idx < 3 ? rawMids[idx] : null;
    if (existing?.pinned && Number.isFinite(existing.x) && Number.isFinite(existing.y)) {
      return {
        x: Number(clamp(existing.x, 0.02, 0.98).toFixed(3)),
        y: Number(clamp(existing.y, 0.02, 0.96).toFixed(3)),
        timeOffset: Number(Math.max(0.020, Number(existing.timeOffset || (refTimeOffset * (eta / refEta)))).toFixed(3)),
        pinned: true,
        pinnedTime: existing.pinnedTime,
        pinnedFrame: existing.pinnedFrame,
        eta: Number(eta.toFixed(3))
      };
    }

    const sampled = climbInterp(eta);
    const computedOffset = refTimeOffset * (eta / refEta);
    return {
      x: Number(sampled.x.toFixed(3)),
      y: Number(sampled.y.toFixed(3)),
      timeOffset: Number(Math.max(0.020 * (idx + 1), computedOffset).toFixed(3)),
      pinned: false,
      eta: Number(eta.toFixed(3))
    };
  });

  // 시간 오프셋 단조 증가 보장 (t1 < t2 < t3 < t4)
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].timeOffset <= pts[i - 1].timeOffset + 0.015) {
      pts[i].timeOffset = Number((pts[i - 1].timeOffset + 0.022).toFixed(3));
    }
  }

  return {
    midPoint1: pts[0],
    midPoint2: pts[1],
    midPoint3: pts[2],
    midPoint4: pts[3],
    waypoints: pts
  };
}

/**
 * 사용자가 캔버스에서 중간점 1·2·3 중 하나를 클릭했을 때,
 * 출발점(p0)과 클릭한 중간점(clickedPt)을 정확히 통과하는 완만한 포물선의 정점(apexPoint)을 역산합니다.
 */
export function solveApexFromClickedMidpoint(p0, clickedPt, midIndex = 1, ctrlRatioClimb = 0.54) {
  const x0 = Number(p0?.x ?? 0.592);
  const y0 = Number(p0?.y ?? 0.819);
  const cx = Number(clickedPt?.x ?? 0.45);
  const cy = Number(clickedPt?.y ?? 0.45);

  // 클릭한 공의 화면 높이에 따라 자연스러운 정점 상승 여백을 부여하여 정점이 천장에 붙지 않도록 조절
  const baseEtas = [0.32, 0.52, 0.72, 0.84];
  const baseEta = baseEtas[clamp(midIndex - 1, 0, 3)];
  const highAltitudeBoost = Math.max(0, 0.46 - cy) * 0.48;
  const eta = clamp(baseEta + highAltitudeBoost, 0.26, 0.84);

  const fy = 1 - Math.pow(1 - eta, 2);
  const dyUp = Math.max(0.045, y0 - cy);
  const rawApexY = y0 - dyUp / fy;
  const apexY = clamp(rawApexY, 0.08, Math.min(cy - 0.042, y0 - 0.15));

  // 실제 결정된 apexY 기준으로 클릭 지점의 정확한 유효 eta를 다시 계산하여 X축 궤적이 100% 일치하게 함
  const effectiveRatioY = clamp((cy - apexY) / Math.max(0.06, y0 - apexY), 0.02, 0.96);
  const effectiveEta = clamp(1 - Math.sqrt(effectiveRatioY), 0.18, 0.88);
  const fx = 2 * ctrlRatioClimb * effectiveEta * (1 - effectiveEta) + effectiveEta * effectiveEta;

  let rawApexX = x0 + (cx - x0) / Math.max(0.15, fx);
  const apexX = clamp(rawApexX, 0.08, 0.92);

  return {
    x: Number(apexX.toFixed(3)),
    y: Number(apexY.toFixed(3))
  };
}

/**
 * 사용자가 영상을 멈춘 현재 프레임(currentTime)에서 특정 공 위치(출발점, 중간점 1~3, 최고점, 탄착지점, 최종런, 또는 자동 프레임 공 위치)를
 * 클릭해 지정했을 때 호출됩니다.
 * 1) 현재 멈춘 프레임의 시간(currentTime)과 프레임 번호(pinnedFrame), 클릭한 공 좌표(clickedPt)를 pinnedPointsStore 및 pinnedHistory에 실시간 기록합니다.
 * 2) 이전에 지정한 다른 지점들의 프레임과 좌표도 절대 해제되지 않고 그대로 보존됩니다.
 * 3) 기존 공 위치 -> 현재 지정한 공 위치 -> 그 다음 공 위치(및 APEX·탄착지점)가 S자 꺾임이나 단절 없이
 *    실제 공이 날아갈 수 있는 하나의 유연한 탄도 곡선으로 연결되도록 주변 제어점을 유기적으로 재정렬합니다.
 */
export function applyUserPinnedBallPoint(
  opts,
  targetKey,
  clickedPt,
  currentTime = 1.80,
  impactTime = 1.72,
  videoDuration = 3.20,
  fps = 30
) {
  const prevStore = { ...(opts.pinnedPointsStore || {}) };
  const prevHistory = Array.isArray(opts.pinnedHistory) ? [...opts.pinnedHistory] : [];

  const next = {
    ...opts,
    pinnedPointsStore: prevStore,
    pinnedHistory: prevHistory,
    originPoint: { ...(opts.originPoint || { x: 0.592, y: 0.819 }), ...(prevStore.origin || {}) },
    midPoint1: opts.midPoint1 || prevStore.mid1 ? { ...(opts.midPoint1 || {}), ...(prevStore.mid1 || {}) } : null,
    midPoint2: opts.midPoint2 || prevStore.mid2 ? { ...(opts.midPoint2 || {}), ...(prevStore.mid2 || {}) } : null,
    midPoint3: opts.midPoint3 || prevStore.mid3 ? { ...(opts.midPoint3 || {}), ...(prevStore.mid3 || {}) } : null,
    midPoint4: opts.midPoint4 ? { ...opts.midPoint4 } : null,
    apexPoint: { ...(opts.apexPoint || { x: 0.385, y: 0.385 }), ...(prevStore.apex || {}) },
    landingPoint: { ...(opts.landingPoint || { x: 0.335, y: 0.688 }), ...(prevStore.landing || {}) },
    rollEndPoint: { ...(opts.rollEndPoint || { x: 0.312, y: 0.682 }), ...(prevStore.roll || {}) }
  };

  const pt = {
    x: Number(clamp(clickedPt.x, 0.02, 0.98).toFixed(3)),
    y: Number(clamp(clickedPt.y, 0.02, 0.96).toFixed(3))
  };
  const frameTime = Number(clamp(currentTime, 0, Math.max(0.5, videoDuration)).toFixed(3));
  const frameNo = Math.max(1, Math.round(frameTime * (fps || 30)) + 1);

  // 'frame-ball' (현재 멈춘 프레임 공 위치 자동 매칭) 또는 중간점 연속 프레임 클릭 시 적절한 타깃 키 결정
  let resolvedKey = targetKey;
  if (targetKey === 'frame-ball') {
    const p0Y = next.originPoint?.y ?? 0.819;
    if (pt.y >= 0.72 && frameTime <= impactTime + 0.04) {
      resolvedKey = 'origin';
    } else {
      const mids = [
        { key: 'mid1', obj: next.midPoint1 },
        { key: 'mid2', obj: next.midPoint2 },
        { key: 'mid3', obj: next.midPoint3 }
      ];
      const sameFrameHit = mids.find(m => m.obj?.pinned && Math.abs((m.obj.pinnedTime ?? -99) - frameTime) <= 0.022);
      if (sameFrameHit) {
        resolvedKey = sameFrameHit.key;
      } else {
        const firstUnpinned = mids.find(m => !m.obj?.pinned);
        if (firstUnpinned) {
          resolvedKey = firstUnpinned.key;
        } else {
          // 모두 고정된 상태라면 고도(y)가 가장 가까운 중간점 슬롯 선택
          const climbFrac = clamp((p0Y - pt.y) / Math.max(0.15, p0Y - (next.apexPoint?.y ?? 0.25)), 0, 1);
          resolvedKey = climbFrac < 0.42 ? 'mid1' : (climbFrac < 0.72 ? 'mid2' : 'mid3');
        }
      }
    }
  }

  let effectiveImpactTime = Number.isFinite(next.calibratedImpactTime) ? next.calibratedImpactTime : impactTime;
  const nowTs = Date.now();
  const pinRecord = {
    key: resolvedKey,
    x: pt.x,
    y: pt.y,
    pinned: true,
    pinnedTime: frameTime,
    pinnedFrame: frameNo,
    updatedAt: nowTs
  };

  if (resolvedKey === 'origin') {
    const oldOrigin = next.originPoint || { x: 0.592, y: 0.819 };
    const dxOrigin = pt.x - Number(oldOrigin.x ?? 0.592);
    const dyOrigin = pt.y - Number(oldOrigin.y ?? 0.819);

    next.originPoint = {
      ...pinRecord
    };
    prevStore.origin = { ...next.originPoint };

    // 시작점(공 위치)을 새로 지정할 때는 자동 검출 중간점 고정 상태를 초기화하여
    // 새로 찍은 공 위치에서부터 1px의 꺾임도 없이 매끄러운 단일 포물선이 뻗어나가도록 정렬
    delete prevStore.mid1;
    delete prevStore.mid2;
    delete prevStore.mid3;
    if (next.midPoint1) next.midPoint1 = { ...next.midPoint1, pinned: false };
    if (next.midPoint2) next.midPoint2 = { ...next.midPoint2, pinned: false };
    if (next.midPoint3) next.midPoint3 = { ...next.midPoint3, pinned: false };

    // 수동 고정되지 않은 최고점(APEX)·탄착지점(Landing)도 새 시작점 이동에 맞춰 자연스럽게 평행·비례 보정
    if (!next.manualApexPinned && !prevStore.apex?.pinned && next.apexPoint) {
      next.apexPoint = {
        ...next.apexPoint,
        x: Number(clamp(Number(next.apexPoint.x ?? 0.385) + dxOrigin * 0.65, 0.08, 0.92).toFixed(3)),
        y: Number(clamp(Number(next.apexPoint.y ?? 0.385) + dyOrigin * 0.25, 0.08, Math.min(0.62, pt.y - 0.16)).toFixed(3)),
        pinned: false
      };
    }
    if (!next.manualLandingPinned && !prevStore.landing?.pinned && next.landingPoint) {
      next.landingPoint = {
        ...next.landingPoint,
        x: Number(clamp(Number(next.landingPoint.x ?? 0.335) + dxOrigin * 0.45, 0.06, 0.94).toFixed(3)),
        y: Number(clamp(Number(next.landingPoint.y ?? 0.688), Math.max(0.48, (next.apexPoint?.y ?? 0.38) + 0.14), Math.max(0.52, pt.y - 0.08)).toFixed(3)),
        pinned: false
      };
    }

    const reg = computeRegularizedMidpoints(next.originPoint, next.apexPoint, 0.035, 0.54, {
      ...next,
      midPoint1: null,
      midPoint2: null,
      midPoint3: null,
      pinnedPointsStore: { ...prevStore, mid1: null, mid2: null, mid3: null }
    });
    next.midPoint1 = reg.midPoint1;
    next.midPoint2 = reg.midPoint2;
    next.midPoint3 = reg.midPoint3;
    next.midPoint4 = reg.midPoint4;
    next.trackedWaypoints = reg.waypoints;
  } else if (resolvedKey === 'mid1' || resolvedKey === 'mid2' || resolvedKey === 'mid3') {
    const idxMap = { mid1: 1, mid2: 2, mid3: 3 };
    const midIdx = idxMap[resolvedKey];

    // 만약 멈춘 프레임 시각(frameTime)이 기존 임팩트 시각보다 이전이거나 같다면, 실제 임팩트가 그 프레임 직전에 발생한 것으로 보정
    if (frameTime <= effectiveImpactTime + 0.018) {
      effectiveImpactTime = Number(Math.max(0.05, frameTime - 0.035 * midIdx).toFixed(3));
      next.calibratedImpactTime = effectiveImpactTime;
    }

    const dtFromImpact = Number(Math.max(0.022 * midIdx, frameTime - effectiveImpactTime).toFixed(3));
    const propMap = { mid1: 'midPoint1', mid2: 'midPoint2', mid3: 'midPoint3' };
    const targetProp = propMap[resolvedKey];

    next[targetProp] = {
      ...pinRecord,
      timeOffset: dtFromImpact
    };
    prevStore[resolvedKey] = { ...next[targetProp] };

    // 직전 작업까지 고정된 다른 중간점들의 핀(pinned, pinnedFrame, pinnedTime, x, y)은 절대 해제하지 않고 보존하되,
    // 최고점(APEX)과 탄착지점(Landing)이 고정된 모든 중간점의 궤적 흐름과 자연스럽게 이어지도록 업데이트
    const p0 = next.originPoint;
    const solvedFromClicked = solveApexFromClickedMidpoint(p0, pt, midIdx, 0.54);

    const pinnedMidsNow = [next.midPoint1, next.midPoint2, next.midPoint3].filter(m => m?.pinned);
    const highestPinned = pinnedMidsNow.reduce((top, m) => (!top || m.y < top.y ? m : top), pt);

    if (!next.manualApexPinned && !prevStore.apex?.pinned) {
      next.apexPoint = {
        x: solvedFromClicked.x,
        y: Math.min(solvedFromClicked.y, Number(clamp(highestPinned.y - 0.055, 0.07, 0.65).toFixed(3))),
        pinned: false
      };
      next.manualApexPinned = false;
    } else if (next.apexPoint.y >= highestPinned.y - 0.02) {
      // 수동 고정된 APEX보다 중간점이 더 높게 찍힌 경우 APEX 고도만 최소 여백 확보 (프레임·X좌표는 유지)
      next.apexPoint = {
        ...next.apexPoint,
        y: Number(clamp(highestPinned.y - 0.04, 0.06, 0.65).toFixed(3))
      };
    }

    if (!next.manualLandingPinned && !prevStore.landing?.pinned) {
      const cDx = next.apexPoint.x - p0.x;
      const dirSign = cDx <= 0 ? -1 : 1;
      const descentSpan = Math.max(0.065, Math.min(0.22, Math.abs(cDx) * 0.42));
      next.landingPoint = {
        x: Number(clamp(next.apexPoint.x + dirSign * descentSpan, 0.06, 0.94).toFixed(3)),
        y: Number(clamp(next.landingPoint?.y ?? 0.688, Math.max(0.54, next.apexPoint.y + 0.18), p0.y - 0.095).toFixed(3)),
        pinned: false
      };
    }

    // 고정된 중간점들을 모두 정확히 통과하면서 나머지 미고정 중간점들을 그 곡선 위에 매끄럽게 배치
    const reg = computeRegularizedMidpoints(p0, next.apexPoint, 0.035, 0.54, next);
    next.midPoint1 = reg.midPoint1;
    next.midPoint2 = reg.midPoint2;
    next.midPoint3 = reg.midPoint3;
    next.midPoint4 = reg.midPoint4;
    next.trackedWaypoints = reg.waypoints;

    // 만약 멈춘 프레임이 임팩트 후 시간 차이가 큰 프레임이라면 전체 비행 시간(flightDurationSec)도 그에 맞춰 자연스럽게 확보
    const maxMidOffset = Math.max(
      next.midPoint1?.timeOffset || 0.04,
      next.midPoint2?.timeOffset || 0.08,
      next.midPoint3?.timeOffset || 0.12
    );
    if (maxMidOffset > 0.35) {
      next.flightDurationSec = Number(clamp(Math.max(next.flightDurationSec || 2.25, maxMidOffset * 1.85), 1.6, 4.2).toFixed(2));
    }

    next.trajectoryMode = 'real-tail';
  } else if (resolvedKey === 'apex') {
    next.apexPoint = {
      ...pinRecord
    };
    next.manualApexPinned = true;
    prevStore.apex = { ...next.apexPoint };

    const p0 = next.originPoint;
    if (!next.manualLandingPinned && !prevStore.landing?.pinned) {
      const cDx = pt.x - p0.x;
      const dirSign = cDx <= 0 ? -1 : 1;
      next.landingPoint = {
        x: Number(clamp(pt.x + dirSign * Math.max(0.065, Math.abs(cDx) * 0.42), 0.06, 0.94).toFixed(3)),
        y: Number(clamp(next.landingPoint?.y ?? 0.688, pt.y + 0.18, p0.y - 0.095).toFixed(3)),
        pinned: false
      };
    }
    const reg = computeRegularizedMidpoints(p0, next.apexPoint, 0.035, 0.54, next);
    next.midPoint1 = reg.midPoint1;
    next.midPoint2 = reg.midPoint2;
    next.midPoint3 = reg.midPoint3;
    next.midPoint4 = reg.midPoint4;
    next.trackedWaypoints = reg.waypoints;
  } else if (resolvedKey === 'landing') {
    next.landingPoint = {
      ...pinRecord
    };
    next.manualLandingPinned = true;
    prevStore.landing = { ...next.landingPoint };

    if (!next.manualApexPinned && !prevStore.apex?.pinned && !next.midPoint1?.pinned && !next.midPoint2?.pinned && !next.midPoint3?.pinned) {
      const totalDx = pt.x - next.originPoint.x;
      const dirSign = totalDx <= 0 ? -1 : 1;
      const span = Math.max(0.12, Math.abs(totalDx));
      next.apexPoint = {
        ...next.apexPoint,
        x: Number(clamp(next.originPoint.x + dirSign * span * 0.62, 0.10, 0.90).toFixed(3)),
        y: Number(clamp(Math.min(next.apexPoint.y, pt.y - 0.18), 0.08, pt.y - 0.15).toFixed(3))
      };
    }
    const reg = computeRegularizedMidpoints(next.originPoint, next.apexPoint, 0.035, 0.54, next);
    next.midPoint1 = reg.midPoint1;
    next.midPoint2 = reg.midPoint2;
    next.midPoint3 = reg.midPoint3;
    next.midPoint4 = reg.midPoint4;
    next.trackedWaypoints = reg.waypoints;
  } else if (resolvedKey === 'roll') {
    next.rollEndPoint = {
      ...pinRecord
    };
    prevStore.roll = { ...next.rollEndPoint };
  }

  // 탄착 후 런(rollEndPoint)이 수동 고정되지 않은 경우 잔디 지면 위에서 탄착 진행 방향으로 자연스럽게 정렬
  if (!next.rollEndPoint?.pinned && !prevStore.roll?.pinned) {
    const rollDirX = clamp((next.landingPoint.x - next.apexPoint.x) * 0.22, -0.035, 0.035);
    next.rollEndPoint = {
      x: Number(clamp(next.landingPoint.x + rollDirX, 0.05, 0.95).toFixed(3)),
      y: Number(clamp(next.landingPoint.y - 0.005, 0.30, next.landingPoint.y).toFixed(3)),
      pinned: false
    };
  }

  // 작업 이력(pinnedHistory): 동일 키가 있으면 제거 후 가장 마지막(직전 작업)으로 추가
  const filteredHistory = prevHistory.filter(item => item && item.key !== resolvedKey);
  filteredHistory.push({ ...pinRecord });

  next.pinnedPointsStore = prevStore;
  next.pinnedHistory = filteredHistory;
  next.calibrationPreviewActive = true;
  next.lastPinnedKey = resolvedKey;
  next.lastPinnedFrame = frameNo;
  next.lastPinnedTime = frameTime;

  return recalculateMetricsFromGeometry(next);
}

/**
 * 영상에서 검출된 프레임별 실제 공 위치 변화(originPoint -> mid1 -> mid2 -> mid3 -> mid4) 및
 * 3D 원근 감속비(k_z), 초기 좌우 출발각(launchDirectionDeg), 스핀 곡률(sideCurveMeters)을 판독하여
 * 과장 없는 현실적인 APEX 최고점 높이(m), 캐리 거리(m), 런 거리(m), 발사 탄도(°), 7대 구질, 볼 스피드(m/s) 및
 * 화면상 둥근 정점(apexPoint)과 원거리 페어웨이 잔디 탄착지점(landingPoint)을 자동 산출합니다.
 */
export function estimateShotMetricsFromVideoTrack(originPoint, trackedWaypoints, fairwayAnchor, samples = []) {
  const p0 = originPoint || { x: 0.592, y: 0.819 };
  const m1 = trackedWaypoints?.midPoint1 || { x: p0.x - 0.084, y: p0.y - 0.206, timeOffset: 0.035 };
  const m2 = trackedWaypoints?.midPoint2 || { x: p0.x - 0.142, y: p0.y - 0.312, timeOffset: 0.070 };
  const m3 = trackedWaypoints?.midPoint3 || { x: p0.x - 0.193, y: p0.y - 0.378, timeOffset: 0.105 };
  const m4 = trackedWaypoints?.midPoint4 || null;
  const rawList = trackedWaypoints?.rawWaypoints?.length
    ? trackedWaypoints.rawWaypoints
    : (trackedWaypoints?.waypoints?.length ? trackedWaypoints.waypoints : [m1, m2, m3, ...(m4 ? [m4] : [])]);

  const isPortrait = Boolean(fairwayAnchor?.isPortrait || p0.x >= 0.53);
  const dt1 = Math.max(0.020, Number(m1.timeOffset || 0.035));
  const dt2 = Math.max(dt1 + 0.018, Number(m2.timeOffset || 0.070));
  const dt3 = Math.max(dt2 + 0.018, Number(m3.timeOffset || 0.105));

  const d01 = Math.hypot(m1.x - p0.x, m1.y - p0.y);
  const d12 = Math.hypot(m2.x - m1.x, m2.y - m1.y);

  // 1) 초기 각속도(vScreen0) 및 프레임 간 3D 원근 깊이 감속 계수(perspectiveKz) 산출
  const vScreen0 = d01 / dt1; // norm/sec
  const vScreen1 = d12 / Math.max(0.015, dt2 - dt1);
  const stepRatio = clamp(vScreen1 / Math.max(0.1, vScreen0), 0.32, 0.85);
  const perspectiveKz = Number(clamp(((1 / Math.sqrt(stepRatio)) - 1) / dt1, 14.0, 26.0).toFixed(2));

  // 임팩트 전후 클럽헤드 스피드 참조
  const maxClubSpeedMph = (samples || []).reduce((maxV, s) => Math.max(maxV, Number(s.clubSpeed || 0)), 0);
  const clubSpeedBonus = maxClubSpeedMph > 85 ? (maxClubSpeedMph - 96) * 0.12 : 0;

  // 2) 과장 없는 현실적인 골퍼 볼 스피드(ballSpeedMps, 일반적인 드라이버 56~63 m/s) 산출
  const rawBallSpeedMps = 51.2 + clamp(vScreen0, 2.2, 6.8) * 1.48 + (perspectiveKz - 18.0) * 0.22 + clubSpeedBonus;
  const ballSpeedMps = Number(clamp(rawBallSpeedMps, 42.0, 66.5).toFixed(1));

  // 3) 원근 투영 고도 상승률 기반 현실적인 발사 탄도(launchAngleDeg, 일반 11.5°~15.8°) 판독
  const sAt3 = (perspectiveKz * dt3) / (1 + perspectiveKz * dt3);
  const normClimbRate = (p0.y - m3.y) / Math.max(0.25, sAt3);
  const launchAngleDeg = Number(clamp(8.4 + normClimbRate * (isPortrait ? 9.4 : 8.6), 7.5, 20.5).toFixed(1));

  // 4) 산림 경계선(treeLineY) 아래의 실제 잔디 지면 Y 범위([minGrassY, maxGrassY]) 설정 (절대 산/나무에 떨어지지 않도록 보장)
  const lastTracked = rawList[rawList.length - 1] || m3;
  const minGrassY = fairwayAnchor?.minGrassY ?? (isPortrait ? 0.668 : 0.54);
  const maxGrassY = fairwayAnchor?.maxGrassY ?? Math.min(isPortrait ? 0.755 : 0.62, p0.y - 0.095);
  const baseFwY = fairwayAnchor
    ? clamp(fairwayAnchor.y, minGrassY, maxGrassY)
    : clamp(p0.y - (isPortrait ? 0.135 : 0.20), minGrassY, maxGrassY);

  // DTL 카메라에서 타석 공과 원거리 열린 페어웨이 소실점을 잇는 중립 직진 기울기
  const neutralVanishX = fairwayAnchor
    ? clamp(fairwayAnchor.x, 0.28, 0.56)
    : (isPortrait ? p0.x - 0.16 : p0.x - 0.06);
  const neutralSlopeX = (neutralVanishX - p0.x) / Math.max(0.12, p0.y - baseFwY);

  // 실제 검출된 공의 초기 상승 기울기(dx / dy_up)
  const actualSlope01 = (rawList[0].x - p0.x) / Math.max(0.04, p0.y - rawList[0].y);
  const actualSlopeAll = (lastTracked.x - p0.x) / Math.max(0.06, p0.y - lastTracked.y);

  // 중립 타깃 라인 대비 좌우 출발 편차 (음수 = 좌측 출발 Pull 계열, 양수 = 우측 출발 Push 계열)
  const slopeOffsetFromNeutral = actualSlopeAll - neutralSlopeX;
  const launchDirectionDeg = Number(clamp(slopeOffsetFromNeutral * 16.5, -15.0, 15.0).toFixed(1));

  // 3D 원근 축소 보정 후 순수 스핀 휨(curvature) + 타깃 라인 이탈량 결합
  const perspCorrectedSlope01 = actualSlope01 * 0.84;
  const spinCurvatureDelta = actualSlopeAll - perspCorrectedSlope01;
  const rawSideCurveM = slopeOffsetFromNeutral * 15.5 + spinCurvatureDelta * 22.0;
  const sideCurveMeters = Number(clamp(rawSideCurveM, -18.0, 18.0).toFixed(1));

  const classifiedShape = classifyShotShapeLabel(sideCurveMeters, launchDirectionDeg, 'auto');

  // 5) 과장 없는 현실적인 APEX 최고점 높이(apexMeters, 일반 21~27m) 및 지형 경사(오르막/평지/내리막) 반영 캐리·런 거리 산출
  const apexMeters = Number(
    clamp(14.2 + (ballSpeedMps - 45) * 0.42 + (launchAngleDeg - 10) * 1.05, 10.0, 33.5).toFixed(1)
  );

  const rawElevationDeltaM = Number(fairwayAnchor?.elevationDeltaMeters ?? 0.0);
  const rawTerrainSlopeType = fairwayAnchor?.terrainSlopeType || 'flat';
  const slopeInfo = classifyTerrainSlopeInfo(rawElevationDeltaM, 'auto', rawTerrainSlopeType);

  const speedRatio = ballSpeedMps / 60.0;
  const launchEfficiency = Math.cos(((launchAngleDeg - 13.2) * Math.PI) / 180 * 1.45);
  const baseFlatCarryMeters = Number(
    clamp(196.0 * Math.pow(speedRatio, 1.32) * launchEfficiency, 85.0, 248.0).toFixed(1)
  );
  // 오르막(+Δh)은 지면이 일찍 마주쳐 캐리가 감소하고, 내리막(-Δh)은 체공 시간이 길어져 캐리가 증가함
  const carryMeters = Number(
    clamp(baseFlatCarryMeters + slopeInfo.carryDeltaMeters, 72.0, 268.0).toFixed(1)
  );

  const landingSteepness = clamp(apexMeters / 25.0, 0.65, 1.45);
  const baseFlatRollMeters = Number(
    clamp((13.8 * speedRatio) / Math.pow(landingSteepness, 0.75), 3.5, 26.0).toFixed(1)
  );
  // 오르막 사면 탄착 시 런이 줄어들고, 내리막 사면 탄착 시 런이 증가함
  const rollMeters = Number(
    clamp(baseFlatRollMeters * slopeInfo.rollMultiplier, 2.2, 32.0).toFixed(1)
  );

  // 6) 물리적으로 원만하게 휘어지는 단일 포물선 정점(apexPoint) 및 경사 지면 탄착지점(landingPoint) 산출
  const heightNorm = clamp((apexMeters - 12) / 24, 0.20, 0.95);
  const landingY = clamp(baseFwY, minGrassY, maxGrassY);
  const apexY = clamp(
    landingY - (isPortrait ? (0.25 + heightNorm * 0.10) : (0.18 + heightNorm * 0.12)),
    0.12,
    Math.min(isPortrait ? 0.43 : 0.40, landingY - 0.16)
  );

  // 상승 구간 X 이동량과 하강 구간 X 이동량이 항상 동일 진행 부호를 유지하며 열린 잔디 회랑(fairwayAnchor.x)에 안착
  const rawClimbDx = (lastTracked.x - p0.x) * 1.26;
  const climbDirSign = rawClimbDx <= 0 ? -1 : 1;
  const climbSpanX = Math.max(0.11, Math.min(0.32, Math.abs(rawClimbDx)));
  const rawApexX = clamp(p0.x + climbDirSign * climbSpanX, 0.14, 0.86);

  const baseDescentSpan = Math.max(0.075, climbSpanX * 0.34 + Math.abs(sideCurveMeters) * 0.0042);
  const rawLandingX = clamp(rawApexX + climbDirSign * baseDescentSpan, 0.08, 0.92);

  let landingX = rawLandingX;
  if (fairwayAnchor && Number.isFinite(fairwayAnchor.x) && climbDirSign <= 0) {
    const curveOffsetX = clamp(sideCurveMeters * 0.0035, -0.06, 0.06);
    const targetGrassX = clamp(fairwayAnchor.x + curveOffsetX, 0.16, Math.min(0.54, p0.x - 0.14));
    landingX = clamp(rawLandingX * 0.30 + targetGrassX * 0.70, 0.12, Math.min(0.56, p0.x - 0.14));
  }

  const apexX = clamp(
    climbDirSign <= 0 && fairwayAnchor && Number.isFinite(fairwayAnchor.x)
      ? p0.x + (landingX - p0.x) * 0.58
      : rawApexX,
    0.14,
    0.86
  );

  const apexPoint = {
    x: Number(apexX.toFixed(3)),
    y: Number(apexY.toFixed(3))
  };

  const landingPoint = {
    x: Number(landingX.toFixed(3)),
    y: Number(landingY.toFixed(3))
  };

  // 정점(apexPoint)이 확정되면 중간점(midPoint1~4)을 동일 포물선 위에 정렬하여 M4->APEX 꺾임을 0으로 제거
  const regularized = computeRegularizedMidpoints(p0, apexPoint, dt1, 0.54, trackedWaypoints);

  // 탄착 후 런(rollEndPoint): 오르막은 경사면을 따라 위쪽으로 짧게 구르고, 평지·내리막은 잔디 지면 위에서 원근 방향으로 굴러가도록 설정
  const rollNorm = clamp(rollMeters / 22, 0.20, 1.35);
  const rollDirX = clamp((landingX - apexX) * 0.22, -0.032, 0.032);
  const rollStepY = slopeInfo.slopeType === 'uphill'
    ? (isPortrait ? 0.008 : 0.011) * rollNorm
    : (slopeInfo.slopeType === 'downhill' ? (isPortrait ? 0.004 : 0.006) * rollNorm : (isPortrait ? 0.005 : 0.008) * rollNorm);
  const rollMinY = slopeInfo.slopeType === 'uphill' ? Math.max(0.46, minGrassY - 0.010) : minGrassY;
  const rollEndPoint = {
    x: Number(clamp(landingX + rollDirX * rollNorm, 0.06, 0.94).toFixed(3)),
    y: Number(clamp(landingY - rollStepY, rollMinY, landingY - 0.002).toFixed(3))
  };

  // 지형 고도차에 따른 현실적인 슬로우 모션 체공 시간 (내리막은 체공 시간 증가, 오르막은 체공 시간 감소)
  const flightDurationSec = Number(clamp(2.45 + (carryMeters / 220) * 0.45 - slopeInfo.elevationDeltaMeters * 0.015, 2.05, 3.35).toFixed(2));
  const rollDurationSec = Number(clamp(0.38 + (rollMeters / 20) * 0.18, 0.25, 0.72).toFixed(2));
  const backspinRpm = Math.round(clamp(2420 + (launchAngleDeg - 12.5) * 110 - sideCurveMeters * 28, 1800, 7200));

  return {
    carryMeters,
    rollMeters,
    baseFlatCarryMeters,
    baseFlatRollMeters,
    apexMeters,
    launchAngleDeg,
    launchDirectionDeg,
    detectedLaunchDirectionDeg: launchDirectionDeg,
    ballSpeedMps,
    backspinRpm,
    sideCurveMeters,
    detectedSideCurveMeters: sideCurveMeters,
    shotShapeType: 'auto',
    detectedShotShape: classifiedShape.code,
    terrainSlopeMode: 'auto',
    detectedTerrainSlope: slopeInfo.slopeType,
    elevationDeltaMeters: slopeInfo.elevationDeltaMeters,
    detectedElevationDeltaMeters: slopeInfo.elevationDeltaMeters,
    flightDurationSec,
    rollDurationSec,
    perspectiveKz,
    midPoint1: regularized.midPoint1,
    midPoint2: regularized.midPoint2,
    midPoint3: regularized.midPoint3,
    midPoint4: regularized.midPoint4,
    trackedWaypoints: regularized.waypoints,
    apexPoint,
    landingPoint,
    rollEndPoint
  };
}

/**
 * 캔버스 위에서 출발점·중간점·APEX·탄착지점이 수동 보정되었을 때,
 * 수동 지정(pinned: true)된 공 위치를 보존하면서 나머지 점들을 하나의 유연한 포물선으로 연결하고
 * APEX 높이(m), 캐리 거리(m), 런 거리(m), 발사 탄도(°), 7구질 및 지형 고도차를 자동 재판독합니다.
 */
export function recalculateMetricsFromGeometry(opts) {
  const p0 = opts.originPoint || { x: 0.592, y: 0.819 };
  const pApex = opts.apexPoint || { x: 0.385, y: 0.385 };
  const pLand = opts.landingPoint || { x: 0.335, y: 0.688 };
  const pRoll = opts.rollEndPoint || { x: 0.312, y: 0.682 };
  const isPortrait = Boolean(opts.fairwayAnchor?.isPortrait || p0.x >= 0.53);

  // 수동 고정된 중간점(pinned: true)은 그대로 유지하고 미고정 중간점만 유연 곡선 위에 배치
  const baseStepSec = opts.midPoint1?.timeOffset || 0.035;
  const reg = computeRegularizedMidpoints(p0, pApex, baseStepSec, 0.54, opts);
  const m3 = reg.midPoint3;

  const screenApexSpan = clamp(pLand.y - pApex.y, 0.06, 0.52);
  const apexMeters = Number(clamp(screenApexSpan * (isPortrait ? 82.0 : 95.0), 8.0, 48.0).toFixed(1));

  const climbSpan = clamp(p0.y - m3.y, 0.08, 0.48);
  const launchAngleDeg = Number(clamp(7.0 + climbSpan * (isPortrait ? 17.5 : 19.0), 6.0, 26.0).toFixed(1));

  // 탄착 지점 수동 이동 시 평지 기준선 대비 오르막(+m)/내리막(-m) 고도차 반영
  const flatRefY = isPortrait ? 0.682 : 0.575;
  const elevationDeltaMeters = opts.manualLandingPinned
    ? Number(clamp((flatRefY - pLand.y) * 145.0, -22.0, 20.0).toFixed(1))
    : Number(opts.elevationDeltaMeters ?? 0.0);
  const slopeInfo = classifyTerrainSlopeInfo(elevationDeltaMeters, opts.manualLandingPinned ? 'auto' : (opts.terrainSlopeMode || 'auto'), opts.detectedTerrainSlope || 'flat');

  const depthSpan = clamp(p0.y - pLand.y, 0.08, 0.45);
  const carryMeters = Number(clamp(158 + depthSpan * (isPortrait ? 260 : 240) + (apexMeters - 24) * 1.1 + slopeInfo.carryDeltaMeters * 0.45, 70, 285).toFixed(1));

  const rollSpan = Math.hypot(pRoll.x - pLand.x, pRoll.y - pLand.y);
  const rollMeters = Number(clamp(rollSpan * (isPortrait ? 580 : 480), 0, 42).toFixed(1));

  const neutralVanishX = isPortrait ? p0.x - 0.16 : p0.x - 0.06;
  const neutralSlopeX = (neutralVanishX - p0.x) / Math.max(0.12, p0.y - pLand.y);
  const actualSlopeX = (pApex.x - p0.x) / Math.max(0.12, p0.y - pApex.y);
  const launchDirectionDeg = Number(clamp((actualSlopeX - neutralSlopeX) * 15.0, -15, 15).toFixed(1));
  const sideCurveMeters = Number(clamp((pLand.x - pApex.x) * 62.0, -22, 22).toFixed(1));

  return {
    ...opts,
    midPoint1: reg.midPoint1,
    midPoint2: reg.midPoint2,
    midPoint3: reg.midPoint3,
    midPoint4: reg.midPoint4,
    trackedWaypoints: reg.waypoints,
    apexMeters,
    launchAngleDeg,
    launchDirectionDeg,
    carryMeters,
    rollMeters,
    sideCurveMeters,
    elevationDeltaMeters: slopeInfo.elevationDeltaMeters,
    autoReadoutSource: 'canvas-calibrated'
  };
}

export function autoCalibrateShotTracerFromVideo(samples, keyMoments, opts = {}) {
  const momentsMap = Object.fromEntries((keyMoments || []).map(m => [m.key, m.time]));
  const addrTime = momentsMap.address ?? 0.45;
  const impTime = momentsMap.impact ?? 1.75;

  let addrSample = samples?.[0];
  let impSample = samples?.[0];
  let finishSample = samples?.length ? samples[samples.length - 1] : null;
  if (samples?.length) {
    addrSample = samples.reduce((best, s) =>
      Math.abs(s.time - addrTime) < Math.abs(best.time - addrTime) ? s : best
    , samples[0]);
    impSample = samples.reduce((best, s) =>
      Math.abs(s.time - impTime) < Math.abs(best.time - impTime) ? s : best
    , samples[0]);
  }

  // 1단계: 어드레스 프레임 이미지에서 골프채 끝 헤드 앞쪽 초기 공 후보 검출
  const initialFrameDetection = detectBallAndFairwayFromAddressFrame(
    addrSample?.frameCanvas || impSample?.frameCanvas,
    addrSample,
    'right',
    [impSample, finishSample].filter(Boolean)
  );

  let fallbackOrigin;
  if (initialFrameDetection?.originPoint) {
    fallbackOrigin = initialFrameDetection.originPoint;
  } else if (addrSample?.ballPoint && Number.isFinite(addrSample.ballPoint.x)) {
    fallbackOrigin = {
      x: Number(clamp(addrSample.ballPoint.x, 0.18, 0.84).toFixed(3)),
      y: Number(clamp(addrSample.ballPoint.y, 0.56, 0.92).toFixed(3))
    };
  } else {
    const rawOriginX = clamp(
      (addrSample?.clubHead?.x ?? impSample?.clubHead?.x ?? 0.574) + 0.016,
      0.18,
      0.84
    );
    const rawOriginY = clamp(
      Math.max(addrSample?.clubHead?.y ?? 0.819, 0.64),
      0.58,
      0.92
    );
    fallbackOrigin = { x: Number(rawOriginX.toFixed(3)), y: Number(rawOriginY.toFixed(3)) };
  }

  // 2단계: [4단계 정밀 티 볼 & 스텝-클리프 동기화 엔진]으로 클럽 헤드/티 마커를 배제한 순수 골프공 좌표 및 단일 프레임 임팩트 시각 확정
  const exactSync = detectExactTeeBallAndImpactFromFrames(samples, keyMoments, fallbackOrigin);
  const originPoint = (exactSync && exactSync.ballPresenceScore >= 28 && exactSync.originPoint)
    ? exactSync.originPoint
    : fallbackOrigin;

  // 확정된 실제 티 볼 좌표(originPoint) 및 다중 프레임(어드레스·임팩트·피니시) 장애물 회피를 적용해 지형 경사(오르막/평지/내리막) 및 잔디 지면(fairwayAnchor) 확정
  const refinedGroundDetection = detectBallAndFairwayFromAddressFrame(
    addrSample?.frameCanvas || impSample?.frameCanvas,
    addrSample,
    'right',
    [impSample, finishSample].filter(Boolean),
    originPoint
  );
  const frameDetection = refinedGroundDetection || initialFrameDetection;
  const fairwayAnchor = frameDetection?.fairwayAnchor || opts.fairwayAnchor || null;

  const exactImpactTime = exactSync?.impactTime ?? detectVisualBallLaunchImpactTime(samples, keyMoments, originPoint);
  const trackedResult = detectRealFlyingBallWaypoints(
    samples,
    keyMoments,
    originPoint,
    addrSample,
    exactSync?.confident ? exactSync.impactTime : exactImpactTime
  );

  const resolvedImpactTime = Number(
    (exactSync?.confident
      ? exactSync.impactTime
      : (trackedResult?.trueImpactTime ?? exactImpactTime ?? impTime)
    ).toFixed(3)
  );

  // 검출된 실제 타격 프레임(resolvedImpactTime)에 맞춰 7단계 스윙 시퀀스 전체 타임스탬프를 역전 없이 재동기화
  reconcileKeyMomentsWithExactImpact(keyMoments, resolvedImpactTime, exactSync?.burstStart ?? null, samples);

  const fallbackApex = {
    x: Number(clamp(originPoint.x - 0.24, 0.14, 0.86).toFixed(3)),
    y: Number(clamp(originPoint.y - 0.427, 0.14, 0.52).toFixed(3))
  };
  const fallbackReg = computeRegularizedMidpoints(originPoint, fallbackApex, 0.035, 0.54);

  const midPoint1 = trackedResult?.midPoint1 || fallbackReg.midPoint1;
  const midPoint2 = trackedResult?.midPoint2 || fallbackReg.midPoint2;
  const midPoint3 = trackedResult?.midPoint3 || fallbackReg.midPoint3;
  const midPoint4 = trackedResult?.midPoint4 || fallbackReg.midPoint4;

  const trackedWaypoints = trackedResult?.waypoints?.length
    ? trackedResult.waypoints
    : fallbackReg.waypoints;

  // 3단계: 검출된 다중 프레임 공 위치 변화 및 지형 경사로부터 APEX 높이(m), 캐리(m), 런(m), 탄도(°), 7구질, 볼 스피드(m/s) 자동 판독 및 등록
  const autoMetrics = estimateShotMetricsFromVideoTrack(
    originPoint,
    {
      midPoint1,
      midPoint2,
      midPoint3,
      midPoint4,
      waypoints: trackedWaypoints,
      rawWaypoints: trackedResult?.rawWaypoints || trackedWaypoints
    },
    fairwayAnchor,
    samples
  );

  return {
    ...opts,
    ...autoMetrics,
    originPoint,
    calibratedImpactTime: resolvedImpactTime,
    burstStart: exactSync?.burstStart ?? null,
    cliffScore: exactSync?.cliffScore ?? 0,
    detectedFrameCount: trackedResult?.detectedCount ?? trackedWaypoints.length,
    hasRealBallTrack: Boolean(trackedResult && trackedResult.detectedCount >= 2),
    rawTrackedWaypointsCount: Number(trackedResult?.detectedCount || 0),
    ballDirectlyDetected: Boolean((exactSync && exactSync.ballPresenceScore >= 28) || frameDetection?.ballDirectlyDetected),
    ballConfidenceScore: Number(Math.max(exactSync?.ballPresenceScore || 0, frameDetection?.ballConfidenceScore || 0).toFixed(1)),
    fairwayDirectlyDetected: Boolean(frameDetection?.fairwayDirectlyDetected),
    fairwayWeight: Number(frameDetection?.fairwayWeight || 0),
    autoReadoutSource: 'video-auto',
    fairwayAnchor,
    manualApexPinned: false,
    manualLandingPinned: false,
    calibrationPreviewActive: false,
    autoReanchor: true
  };
}

/**
 * 사용자가 구질·지형 경사·캐리·런·APEX 높이·탄도·좌우 휘어짐을 직접 수정하거나 슬라이더를 조작했을 때
 * 화면상 중간점(midPoint1~4), 최고점(apexPoint), 원거리 페어웨이 탄착지점(landingPoint), 최종 정지점(rollEndPoint)이
 * 직각 꺾임 없는 하나의 매끄러운 물리적 포물선 아크를 이루도록 동기화합니다.
 */
export function syncShotGeometryFromMetrics(opts) {
  const origin = opts.originPoint || { x: 0.592, y: 0.819 };
  const carryM = clamp(Number(opts.carryMeters ?? 198.5), 40, 340);
  const rollM = clamp(Number(opts.rollMeters ?? 13.5), 0, 65);
  const apexM = clamp(Number(opts.apexMeters ?? 24.5), 5, 60);
  const launchDeg = clamp(Number(opts.launchAngleDeg ?? 13.6), 4, 34);
  const sideM = clamp(Number(opts.sideCurveMeters ?? -5.2), -35, 35);
  const launchDirDeg = clamp(Number(opts.launchDirectionDeg ?? -4.2), -20, 20);

  const fwAnchor = opts.fairwayAnchor || null;
  const isPortrait = Boolean(fwAnchor?.isPortrait || origin.x >= 0.53);

  // 지형 경사(오르막 / 평지 / 내리막) 및 수동 경사 변경에 따른 탄착 고도(Y) 보정
  const detElev = Number(opts.detectedElevationDeltaMeters ?? fwAnchor?.elevationDeltaMeters ?? 0);
  const detSlope = opts.detectedTerrainSlope || fwAnchor?.terrainSlopeType || 'flat';
  const slopeInfo = classifyTerrainSlopeInfo(opts.elevationDeltaMeters ?? detElev, opts.terrainSlopeMode || 'auto', detSlope);
  const manualElevShift = (opts.terrainSlopeMode && opts.terrainSlopeMode !== 'auto')
    ? (slopeInfo.elevationDeltaMeters - detElev)
    : 0;

  let minGrassY = fwAnchor?.minGrassY ?? (isPortrait ? 0.660 : 0.535);
  let maxGrassY = fwAnchor?.maxGrassY ?? Math.min(isPortrait ? 0.755 : 0.625, origin.y - 0.085);
  if (slopeInfo.slopeType === 'uphill') {
    minGrassY = Math.min(minGrassY, isPortrait ? 0.505 : 0.450);
  } else if (slopeInfo.slopeType === 'downhill') {
    maxGrassY = Math.max(maxGrassY, Math.min(isPortrait ? 0.758 : 0.635, origin.y - 0.075));
  }

  const distNorm = clamp((carryM - 80) / 180, 0.15, 1.05);
  const elevYShift = clamp(-manualElevShift * 0.0052, -0.14, 0.08);
  const baseFwY = fwAnchor
    ? clamp(fwAnchor.y + elevYShift - (distNorm - 0.65) * 0.020, minGrassY, maxGrassY)
    : clamp(origin.y - (isPortrait ? (0.125 + 0.025 * distNorm) : (0.18 + 0.05 * distNorm)) + elevYShift, minGrassY, maxGrassY);
  const naturalLandingY = clamp(baseFwY, minGrassY, maxGrassY);

  const heightNorm = clamp(((apexM - 8) / 28) * 0.78 + ((launchDeg - 8) / 18) * 0.22, 0.12, 1.0);
  const apexRiseSpan = isPortrait ? (0.24 + 0.11 * heightNorm) : (0.18 + 0.14 * heightNorm);
  const naturalApexY = clamp(naturalLandingY - apexRiseSpan, 0.08, Math.min(isPortrait ? 0.44 : 0.40, naturalLandingY - 0.16));

  // 7대 구질 및 좌우 휘어짐에 따른 단조 수평 진행(origin.x -> apexX -> landingX) 산출
  const shapeInfo = classifyShotShapeLabel(sideM, launchDirDeg, opts.shotShapeType || 'auto');
  const isRightArch =
    shapeInfo.code === 'fade' ||
    shapeInfo.code === 'slice' ||
    shapeInfo.code === 'push' ||
    (opts.shotShapeType === 'auto' && sideM >= 2.2);

  let climbDx;
  let descDx;

  if (isRightArch) {
    if (shapeInfo.code === 'fade') {
      climbDx = clamp(0.065 + (sideM / 20) * 0.035 + (launchDirDeg / 15) * 0.025, 0.055, 0.145);
      descDx = clamp(0.062 + (sideM / 16) * 0.055, 0.055, 0.145);
    } else if (shapeInfo.code === 'push') {
      climbDx = clamp(0.082 + (launchDirDeg / 12) * 0.052, 0.068, 0.165);
      descDx = clamp(0.064 + (launchDirDeg / 12) * 0.038 + (sideM / 20) * 0.030, 0.055, 0.145);
    } else {
      climbDx = clamp(0.078 + (sideM / 20) * 0.045 + (launchDirDeg / 15) * 0.030, 0.065, 0.165);
      descDx = clamp(0.082 + (sideM / 16) * 0.065, 0.072, 0.165);
    }
  } else {
    if (shapeInfo.code === 'straight') {
      climbDx = clamp(-0.145 + (launchDirDeg / 15) * 0.042 + (sideM / 20) * 0.025, -0.21, -0.095);
      descDx = clamp(-0.082 + (sideM / 20) * 0.032, -0.13, -0.068);
    } else if (shapeInfo.code === 'pull') {
      climbDx = clamp(-0.195 + (launchDirDeg / 12) * 0.052, -0.28, -0.135);
      descDx = clamp(-0.092 + (launchDirDeg / 12) * 0.035 + (sideM / 20) * 0.030, -0.155, -0.075);
    } else if (shapeInfo.code === 'hook') {
      climbDx = clamp(-0.215 + (launchDirDeg / 15) * 0.042 + (sideM / 20) * 0.055, -0.30, -0.155);
      descDx = clamp(-0.118 + (sideM / 16) * 0.065, -0.185, -0.105);
    } else {
      climbDx = clamp(-0.185 + (launchDirDeg / 15) * 0.040 + (sideM / 20) * 0.045, -0.285, -0.125);
      descDx = clamp(-0.095 + (sideM / 16) * 0.052, -0.165, -0.082);
    }
  }

  let naturalApexX = clamp(origin.x + climbDx, 0.12, 0.88);
  let naturalLandingX = clamp(naturalApexX + descDx, 0.07, 0.93);
  if (!isRightArch && fwAnchor && Number.isFinite(fwAnchor.x)) {
    const curveOffsetX = clamp(sideM * 0.0035, -0.06, 0.06);
    const targetGrassX = clamp(fwAnchor.x + curveOffsetX, 0.16, Math.min(0.54, origin.x - 0.14));
    naturalLandingX = clamp(naturalLandingX * 0.35 + targetGrassX * 0.65, 0.10, Math.min(0.56, origin.x - 0.14));
    naturalApexX = clamp(origin.x + (naturalLandingX - origin.x) * 0.58, 0.12, 0.88);
  }

  const hasPinnedMid = Boolean(opts.midPoint1?.pinned || opts.midPoint2?.pinned || opts.midPoint3?.pinned);

  let apexX = (opts.manualApexPinned || hasPinnedMid) && opts.apexPoint ? opts.apexPoint.x : naturalApexX;
  let apexY = (opts.manualApexPinned || hasPinnedMid) && opts.apexPoint ? opts.apexPoint.y : naturalApexY;
  let landingX = opts.manualLandingPinned && opts.landingPoint ? opts.landingPoint.x : naturalLandingX;
  let landingY = opts.manualLandingPinned && opts.landingPoint ? opts.landingPoint.y : naturalLandingY;

  if (opts.manualLandingPinned && !opts.manualApexPinned && !hasPinnedMid) {
    const totalDx = landingX - origin.x;
    const dirSign = totalDx <= 0 ? -1 : 1;
    const span = Math.max(0.14, Math.abs(totalDx));
    apexX = clamp(origin.x + dirSign * span * 0.62, 0.12, 0.88);
  } else if ((opts.manualApexPinned || hasPinnedMid) && !opts.manualLandingPinned) {
    const cDx = apexX - origin.x;
    const dirSign = cDx <= 0 ? -1 : 1;
    landingX = clamp(apexX + dirSign * Math.max(0.075, Math.abs(cDx) * 0.42), 0.07, 0.93);
  }

  // 수동 고정된 중간점(pinned: true)은 유지하면서 나머지 중간점들을 포물선 위에 정렬
  const baseStepSec = opts.midPoint1?.timeOffset || 0.035;
  const reg = computeRegularizedMidpoints(origin, { x: apexX, y: apexY }, baseStepSec, 0.54, opts);

  const rollNorm = clamp(rollM / 22, 0, 1.35);
  const rollDirX = clamp((landingX - apexX) * 0.22, -0.035, 0.035);
  const rollStepY = slopeInfo.slopeType === 'uphill'
    ? (isPortrait ? 0.008 : 0.011) * rollNorm
    : (slopeInfo.slopeType === 'downhill' ? (isPortrait ? 0.004 : 0.006) * rollNorm : (isPortrait ? 0.005 : 0.008) * rollNorm);
  const rollMinY = slopeInfo.slopeType === 'uphill' ? Math.max(0.46, minGrassY - 0.010) : minGrassY;
  const rollEndX = opts.rollEndPoint?.pinned ? opts.rollEndPoint.x : clamp(landingX + rollDirX * rollNorm, 0.06, 0.94);
  const rollEndY = opts.rollEndPoint?.pinned ? opts.rollEndPoint.y : clamp(landingY - rollStepY, rollMinY, landingY);

  return {
    ...opts,
    elevationDeltaMeters: slopeInfo.elevationDeltaMeters,
    originPoint: { ...origin, x: Number(origin.x.toFixed(3)), y: Number(origin.y.toFixed(3)) },
    midPoint1: reg.midPoint1,
    midPoint2: reg.midPoint2,
    midPoint3: reg.midPoint3,
    midPoint4: reg.midPoint4,
    trackedWaypoints: reg.waypoints,
    apexPoint: { ...(opts.apexPoint || {}), x: Number(apexX.toFixed(3)), y: Number(apexY.toFixed(3)) },
    landingPoint: { ...(opts.landingPoint || {}), x: Number(landingX.toFixed(3)), y: Number(landingY.toFixed(3)) },
    rollEndPoint: { ...(opts.rollEndPoint || {}), x: Number(rollEndX.toFixed(3)), y: Number(rollEndY.toFixed(3)) }
  };
}

// ============================================================================
// 4. 유연 탄도 스플라인 및 이중 베지어 포물선(Flexible Ball-Path Spline) 생성기
// ============================================================================

/**
 * 출발점(P0) -> 중간점(M1~M4) -> 최고점(APEX) -> 탄착지점(Landing) 전 구간을
 * 사용자가 지정한 모든 공 위치를 정확히 통과하면서,
 * 출발 시점부터 APEX 도달 시점까지도 하강 구간(APEX -> 탄착)과 어울리게
 * 부드럽고 여유 있는 슬로우 모션으로 떠오르도록 탄도 샘플을 생성합니다.
 */
export function buildBallFlightCurveSamples(opts, impactTime, videoDuration) {
  const p0 = opts.originPoint || { x: 0.592, y: 0.819 };
  const pApex = opts.apexPoint || { x: 0.385, y: 0.385 };
  const pLand = opts.landingPoint || { x: 0.335, y: 0.688 };
  const pRoll = opts.rollEndPoint || { x: 0.312, y: 0.682 };
  const isRealTail = (opts.trajectoryMode || 'real-tail') === 'real-tail';

  const carryM = Math.max(10, Number(opts.carryMeters ?? 198.5));
  const rollM = Math.max(0, Number(opts.rollMeters ?? 13.5));
  const totalM = carryM + rollM;
  const apexM = Math.max(2, Number(opts.apexMeters ?? 24.5));

  const remainingSec = Math.max(1.10, (videoDuration || 3.6) - impactTime - 0.04);
  const rawFlightSec = clamp(Number(opts.flightDurationSec ?? 2.70), 1.40, 4.5);
  // 영상 길이에 여유가 있을 때 상승~하강 슬로우 모션이 충분히 여유 있게 표현되도록 최소 체공 시간 보장
  const desiredFlightSec = remainingSec >= 2.85
    ? Math.max(rawFlightSec, Math.min(3.05, remainingSec * 0.85))
    : rawFlightSec;
  const desiredRollSec = rollM > 0.2 ? clamp(Number(opts.rollDurationSec ?? 0.45), 0.18, 1.2) : 0;
  const totalDesired = desiredFlightSec + desiredRollSec;

  const flightSec = totalDesired > remainingSec
    ? Math.max(0.95, remainingSec * (rollM > 0.2 ? 0.86 : 0.96))
    : desiredFlightSec;
  const rollSec = totalDesired > remainingSec
    ? Math.max(0.12, remainingSec - flightSec)
    : desiredRollSec;

  const ctrlRatioClimb = 0.54;
  const ctrlRatioDesc = 0.46;
  const dxDesc = pLand.x - pApex.x;
  const xCtrlDesc = pApex.x + ctrlRatioDesc * dxDesc;

  // 수동 고정된 중간점(pinned: true)을 포함한 유연 중간점 정렬
  const baseStepSec = clamp(Number(opts.midPoint1?.timeOffset || 0.035), 0.022, 0.250);
  const regMids = computeRegularizedMidpoints(p0, pApex, baseStepSec, ctrlRatioClimb, opts);
  const m1 = regMids.midPoint1;
  const m2 = regMids.midPoint2;
  const m3 = regMids.midPoint3;
  const m4 = regMids.midPoint4;

  const pinnedList = [m1, m2, m3].filter(m => m?.pinned);
  const evalClimb = createFlexibleClimbInterpolator(p0, pinnedList, pApex, apexM, ctrlRatioClimb);

  const evalDescent = (xi) => {
    const om = 1 - xi;
    const x = om * om * pApex.x + 2 * xi * om * xCtrlDesc + xi * xi * pLand.x;
    const y = pApex.y + (pLand.y - pApex.y) * (xi * xi);
    return {
      x: clamp(x, 0.02, 0.98),
      y: clamp(y, 0.02, 0.96),
      heightMeters: apexM * Math.max(0, 1 - xi * xi)
    };
  };

  // DTL 원근 화면에서 출발점->APEX 상승 이동 거리가 APEX->탄착 하강 이동 거리보다 약 2배 길기 때문에,
  // 상승 구간에 전체 비행 시간의 58%를 배정하고 완만한 슬로우 모션 이징을 적용하여 하강 속도와 시각적 균형을 맞춤
  const climbRatio = 0.58;
  const apexTime = impactTime + flightSec * climbRatio;
  const carryTime = impactTime + flightSec;
  const rollEndTime = carryTime + rollSec;

  // 출발(w=0) -> APEX(w=1) 슬로우 모션 상승 진행률 함수 eta(w) 및 역함수 wForEta(eta)
  const climbEtaFromW = (w) => {
    const cw = clamp(w, 0, 1);
    return 0.78 * cw + 0.22 * Math.sin(cw * Math.PI * 0.5);
  };
  const climbWFromEta = (targetEta) => {
    const te = clamp(targetEta, 0, 1);
    let lo = 0;
    let hi = 1;
    for (let iter = 0; iter < 14; iter++) {
      const mid = (lo + hi) * 0.5;
      if (climbEtaFromW(mid) < te) lo = mid;
      else hi = mid;
    }
    return (lo + hi) * 0.5;
  };

  const climbSpanSec = Math.max(0.45, apexTime - impactTime);
  const eta1 = clamp(m1.eta ?? 0.28, 0.08, 0.42);
  const eta2 = clamp(m2.eta ?? 0.50, eta1 + 0.08, 0.68);
  const eta3 = clamp(m3.eta ?? 0.72, eta2 + 0.08, 0.86);
  const eta4 = clamp(m4.eta ?? 0.85, eta3 + 0.05, 0.94);

  const t1 = impactTime + climbSpanSec * climbWFromEta(eta1);
  const t2 = impactTime + climbSpanSec * climbWFromEta(eta2);
  const t3 = impactTime + climbSpanSec * climbWFromEta(eta3);
  const t4 = impactTime + climbSpanSec * climbWFromEta(eta4);

  const flightPoints = [];

  // 1) 상승 구간 (Origin -> Mid1 -> Mid2 -> Mid3 -> APEX):
  // 사용자가 지정한 중간점 좌표를 정확히 통과하면서, 출발부터 APEX까지 급발진 없이 하강과 어우러지는 슬로우 모션으로 상승
  const climbSteps = 56;
  const wSamples = new Set([
    0,
    climbWFromEta(eta1),
    climbWFromEta(eta2),
    climbWFromEta(eta3),
    climbWFromEta(eta4),
    1
  ]);
  for (let s = 0; s <= climbSteps; s++) {
    wSamples.add(s / climbSteps);
  }
  const sortedW = Array.from(wSamples).sort((a, b) => a - b);

  for (const w of sortedW) {
    const time = impactTime + climbSpanSec * w;
    const eta = climbEtaFromW(w);
    const pt = evalClimb(eta);
    const u = eta * 0.56;
    const shadowX = p0.x + (pLand.x - p0.x) * u;
    const shadowY = p0.y + (pLand.y - p0.y) * u;

    flightPoints.push({
      phase: 'flight',
      u,
      time,
      x: pt.x,
      y: pt.y,
      shadowX,
      shadowY,
      heightMeters: pt.heightMeters,
      distanceMeters: carryM * u
    });
  }

  // 2) 하강 구간 (APEX -> Landing, xi: 0 -> 1): 정점 수평 접선을 그대로 이어받아 원만하게 낙하
  const descentSteps = 46;
  for (let s = 1; s <= descentSteps; s++) {
    const w = s / descentSteps;
    const time = apexTime + (carryTime - apexTime) * w;
    const xi = 0.68 * w + 0.32 * Math.pow(w, 1.28);
    const pt = evalDescent(xi);
    const u = 0.56 + 0.44 * xi;
    const shadowX = p0.x + (pLand.x - p0.x) * u;
    const shadowY = p0.y + (pLand.y - p0.y) * u;

    flightPoints.push({
      phase: 'flight',
      u,
      time,
      x: pt.x,
      y: pt.y,
      shadowX,
      shadowY,
      heightMeters: pt.heightMeters,
      distanceMeters: carryM * u
    });
  }

  // 탄착 후 지면 바운스 및 런(Roll/Run) 구간 포인트 생성
  const rollPoints = [];
  const N_ROLL = 28;
  if (rollM > 0.1 && rollSec > 0.04) {
    for (let j = 0; j <= N_ROLL; j++) {
      const rFrac = j / N_ROLL;
      const ru = 1 - Math.pow(1 - rFrac, 1.85);
      const gx = pLand.x + (pRoll.x - pLand.x) * ru;
      const gy = pLand.y + (pRoll.y - pLand.y) * ru;

      let bounceOffsetPxNorm = 0;
      if (rFrac < 0.45) {
        bounceOffsetPxNorm = Math.sin((rFrac / 0.45) * Math.PI) * 0.014 * clamp(rollM / 18, 0.4, 1.4);
      } else if (rFrac < 0.75) {
        bounceOffsetPxNorm = Math.sin(((rFrac - 0.45) / 0.30) * Math.PI) * 0.005 * clamp(rollM / 18, 0.4, 1.4);
      }

      rollPoints.push({
        phase: 'roll',
        u: ru,
        time: carryTime + rFrac * rollSec,
        x: gx,
        y: gy - bounceOffsetPxNorm,
        shadowX: gx,
        shadowY: gy,
        heightMeters: bounceOffsetPxNorm * 70,
        distanceMeters: carryM + rollM * ru
      });
    }
  }

  return {
    trajectoryMode: isRealTail ? 'real-tail' : 'simulation',
    impactTime,
    tMid1: t1,
    tMid2: t2,
    tMid3: t3,
    tMid4: t4,
    apexTime,
    carryTime,
    rollEndTime,
    carryMeters: carryM,
    rollMeters: rollM,
    totalMeters: totalM,
    apexMeters: apexM,
    originPoint: p0,
    midPoint1: m1,
    midPoint2: m2,
    midPoint3: m3,
    midPoint4: m4,
    trackedWaypoints: regMids.waypoints,
    apexPoint: pApex,
    landingPoint: pLand,
    rollEndPoint: pRoll,
    flightPoints,
    rollPoints
  };
}

// ============================================================================
// 5. 후방(Down-the-Line) 드라이빙 레인지·챔피언십 홀 데모 배경 씬 합성기
// ============================================================================

export function drawSynthesizedDtlRangeScene(ctx, width, height, state, currentTime) {
  ctx.save();

  const horizonY = Math.round(height * 0.38);

  // 1) 상단 하늘(Clear Tour Sky) 그라데이션
  const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
  skyGrad.addColorStop(0, '#DBEAFE');
  skyGrad.addColorStop(0.65, '#EFF6FF');
  skyGrad.addColorStop(1, '#F8FAFC');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, horizonY);

  // 원거리 산 능선 및 클럽하우스 숲 실루엣
  ctx.fillStyle = '#CBD5E1';
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.lineTo(width * 0.18, horizonY - 22);
  ctx.lineTo(width * 0.42, horizonY - 10);
  ctx.lineTo(width * 0.68, horizonY - 26);
  ctx.lineTo(width * 0.88, horizonY - 14);
  ctx.lineTo(width, horizonY - 18);
  ctx.lineTo(width, horizonY);
  ctx.closePath();
  ctx.fill();

  // 2) 하단 페어웨이 및 러프 원근 잔디 지면
  const turfGrad = ctx.createLinearGradient(0, horizonY, 0, height);
  turfGrad.addColorStop(0, '#DCFCE7');
  turfGrad.addColorStop(0.35, '#ECFDF5');
  turfGrad.addColorStop(1, '#F0FDF4');
  ctx.fillStyle = turfGrad;
  ctx.fillRect(0, horizonY, width, height - horizonY);

  // 중앙 페어웨이 원근 사다리꼴 폴리곤
  ctx.fillStyle = 'rgba(16, 185, 129, 0.09)';
  ctx.beginPath();
  ctx.moveTo(width * 0.42, horizonY + 6);
  ctx.lineTo(width * 0.58, horizonY + 6);
  ctx.lineTo(width * 0.86, height);
  ctx.lineTo(width * 0.14, height);
  ctx.closePath();
  ctx.fill();

  // 3) 원근 거리 표지선 (100m, 150m, 200m, 250m 타깃 아크 및 거리 라벨)
  const distMarkers = [
    { meters: 100, yRatio: 0.63, halfW: 0.24 },
    { meters: 150, yRatio: 0.53, halfW: 0.18 },
    { meters: 200, yRatio: 0.46, halfW: 0.13 },
    { meters: 250, yRatio: 0.41, halfW: 0.09 }
  ];

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';

  for (const dm of distMarkers) {
    const py = height * dm.yRatio;
    const lx = width * (0.50 - dm.halfW);
    const rx = width * (0.50 + dm.halfW);

    ctx.strokeStyle = 'rgba(15, 23, 42, 0.14)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lx, py);
    ctx.lineTo(rx, py);
    ctx.stroke();
    ctx.setLineDash([]);

    // 우측 거리 표지판 배지
    ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.beginPath();
    ctx.roundRect(rx + 6, py - 9, 44, 18, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#475569';
    ctx.fillText(`${dm.meters}m`, rx + 28, py);
  }

  // 타깃 그린 및 핀 깃발 (원거리 중앙)
  const flagX = width * 0.50;
  const flagY = height * 0.415;
  ctx.fillStyle = 'rgba(5, 150, 105, 0.18)';
  ctx.beginPath();
  ctx.ellipse(flagX, flagY, width * 0.055, height * 0.014, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(flagX, flagY);
  ctx.lineTo(flagX, flagY - 22);
  ctx.stroke();

  ctx.fillStyle = '#DC2626';
  ctx.beginPath();
  ctx.moveTo(flagX, flagY - 22);
  ctx.lineTo(flagX + 11, flagY - 18);
  ctx.lineTo(flagX, flagY - 14);
  ctx.closePath();
  ctx.fill();

  // 4) 티잉 그라운드 매트 및 골퍼 후방(DTL) 실루엣 렌더링
  const stOpts = state.shotTracerOptions || DEFAULT_SHOT_TRACER_OPTIONS;
  const ballOrigin = stOpts.originPoint || { x: 0.46, y: 0.78 };
  const bx = ballOrigin.x * width;
  const by = ballOrigin.y * height;

  // 티 박스 잔디 패드
  ctx.fillStyle = 'rgba(15, 23, 42, 0.06)';
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx - width * 0.16, by - height * 0.04, width * 0.24, height * 0.11, 8);
  ctx.fill();
  ctx.stroke();

  // 골퍼 후방(DTL) 자세 및 클럽 스윙 모션 렌더링
  drawDtlGolferSilhouette(ctx, width, height, state, currentTime, bx, by);

  ctx.restore();
}

function drawDtlGolferSilhouette(ctx, width, height, state, currentTime, ballX, ballY) {
  const momentsMap = Object.fromEntries((state.keyMoments || []).map(m => [m.key, m.time]));
  const addrTime = momentsMap.address ?? 0.45;
  const topTime = momentsMap.top ?? 1.38;
  const impTime = momentsMap.impact ?? 1.72;
  const finTime = momentsMap.finish ?? 2.45;

  const isRightHanded = state.hand !== 'left';
  const sideSign = isRightHanded ? -1 : 1;

  // 골퍼 스탠스 중심 (공의 좌측(오른손잡이 기준)에 위치)
  const footX = ballX + sideSign * (width * 0.085);
  const footY = ballY + height * 0.025;
  const hipX = footX - sideSign * (width * 0.012);
  const hipY = footY - height * 0.16;
  const shoulderX = hipX + sideSign * (width * 0.018);
  const shoulderY = hipY - height * 0.14;
  const headX = shoulderX + sideSign * (width * 0.010);
  const headY = shoulderY - height * 0.048;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 다리 및 몸통 실루엣
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = Math.max(7, width * 0.011);
  ctx.beginPath();
  ctx.moveTo(footX - 8, footY);
  ctx.lineTo(hipX, hipY);
  ctx.lineTo(shoulderX, shoulderY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(footX + 10, footY + 4);
  ctx.lineTo(hipX + 6, hipY + 4);
  ctx.stroke();

  // 머리(골프 캡)
  ctx.fillStyle = '#0F172A';
  ctx.beginPath();
  ctx.arc(headX, headY, Math.max(11, width * 0.016), 0, Math.PI * 2);
  ctx.fill();

  // 시간에 따른 손(그립) 및 클럽 헤드 위치 보간
  let handX = shoulderX - sideSign * (width * 0.038);
  let handY = hipY - height * 0.02;
  let clubX = ballX;
  let clubY = ballY;

  if (currentTime <= addrTime) {
    clubX = ballX;
    clubY = ballY;
  } else if (currentTime <= topTime) {
    const u = clamp((currentTime - addrTime) / Math.max(0.1, topTime - addrTime), 0, 1);
    const ease = u * u * (3 - 2 * u);
    handX = (shoulderX - sideSign * width * 0.038) + sideSign * (width * 0.045) * ease;
    handY = (hipY - height * 0.02) - (height * 0.16) * ease;
    clubX = ballX + sideSign * (width * 0.11) * ease;
    clubY = ballY - (height * 0.38) * ease;
  } else if (currentTime <= impTime) {
    const u = clamp((currentTime - topTime) / Math.max(0.05, impTime - topTime), 0, 1);
    const ease = Math.pow(u, 1.6);
    handX = (shoulderX + sideSign * width * 0.007) - sideSign * (width * 0.045) * ease;
    handY = (hipY - height * 0.18) + (height * 0.16) * ease;
    clubX = (ballX + sideSign * width * 0.11) * (1 - ease) + ballX * ease;
    clubY = (ballY - height * 0.38) * (1 - ease) + ballY * ease;
  } else {
    const u = clamp((currentTime - impTime) / Math.max(0.1, finTime - impTime), 0, 1);
    const ease = 1 - Math.pow(1 - u, 2.2);
    handX = (shoulderX - sideSign * width * 0.038) + sideSign * (width * 0.025) * ease;
    handY = (hipY - height * 0.02) - (height * 0.17) * ease;
    clubX = ballX - sideSign * (width * 0.07) * Math.sin(ease * Math.PI * 0.85);
    clubY = ballY - (height * 0.37) * ease;
  }

  // 팔 드로잉
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = Math.max(5.5, width * 0.0085);
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY + 4);
  ctx.lineTo(handX, handY);
  ctx.stroke();

  // 샤프트 & 클럽 헤드
  ctx.strokeStyle = '#64748B';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(handX, handY);
  ctx.lineTo(clubX, clubY);
  ctx.stroke();

  ctx.fillStyle = '#0F172A';
  ctx.beginPath();
  ctx.ellipse(clubX, clubY, 7, 4.5, -0.35, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ============================================================================
// 6. 메인 샷 트레이서 오버레이 렌더러 (궤적 + APEX 말풍선 + 캐리/런 거리 + 탄도 HUD)
// ============================================================================

export function renderShotTracerOverlay(ctx, width, height, state, currentTime, overrideShotOptions = {}) {
  const stOpts = {
    ...DEFAULT_SHOT_TRACER_OPTIONS,
    ...(state.shotTracerOptions || {}),
    ...overrideShotOptions
  };

  const dur = Math.max(0.5, Number(state.duration || 3.2));
  const impMomentObj = (state.keyMoments || []).find(m => m.key === 'impact');
  const finMomentObj = (state.keyMoments || []).find(m => m.key === 'finish');
  const isManualLocked = Boolean(stOpts.manualImpactLocked) || (impMomentObj?.source === 'marked');

  let rawImpact = (impMomentObj?.source === 'marked')
    ? impMomentObj.time
    : (Boolean(stOpts.manualImpactLocked) && Number.isFinite(stOpts.calibratedImpactTime)
      ? stOpts.calibratedImpactTime
      : (Number.isFinite(stOpts.calibratedImpactTime)
        ? stOpts.calibratedImpactTime
        : (impMomentObj?.time ?? dur * 0.36)));

  // 사용자가 원터치 수동 고정(isManualLocked)하지 않은 자동 추정치인 경우, 긴 영상(>=4.2초)에서 피니시 이후(2.48초 초과)로 밀리는 현상 방어
  if (!isManualLocked) {
    const maxAllowedImpact = dur >= 4.2 ? Math.min(2.48, dur * 0.48) : Math.max(0.85, dur * 0.76);
    if (rawImpact > maxAllowedImpact) {
      rawImpact = dur >= 4.2 ? clamp(dur * 0.35, 1.45, 2.15) : clamp(dur * 0.42, 0.55, maxAllowedImpact);
    }
  }

  const impactTime = clamp(
    Number(rawImpact),
    0.08,
    Math.max(0.35, dur - (isManualLocked ? 0.12 : 0.30))
  );

  const curveData = buildBallFlightCurveSamples(stOpts, impactTime, state.duration || 3.2);
  const paletteObj = SHOT_TRACE_COLOR_PALETTE.find(c => c.hex === stOpts.traceColor) || {
    id: 'custom',
    labelKo: '사용자 색상',
    hex: stOpts.traceColor || '#DC2626',
    coreHex: '#FFFFFF',
    glowRgba: 'rgba(220, 38, 38, 0.50)'
  };

  ctx.save();

  const p0Px = {
    x: curveData.originPoint.x * width,
    y: curveData.originPoint.y * height
  };

  // 1) 임팩트 전(currentTime < impactTime): 티잉 그라운드 골프공 및 발사 대기 타깃 표시
  if (currentTime < impactTime) {
    drawTeeBallWaitingReticle(ctx, p0Px.x, p0Px.y, stOpts, paletteObj);
  }

  // 2) 현재 시간(currentTime)까지 진행된 비행(Flight) 샘플 및 런(Roll) 샘플 필터링 + 프레임 간 연속 선형 보간(Exact Tip)
  const visibleFlight = curveData.flightPoints.filter(pt => pt.time <= currentTime + 0.001);
  if (currentTime >= impactTime && currentTime < curveData.carryTime && curveData.flightPoints.length >= 2) {
    let pPrev = curveData.flightPoints[0];
    let pNext = curveData.flightPoints[curveData.flightPoints.length - 1];
    for (let i = 0; i < curveData.flightPoints.length - 1; i++) {
      if (curveData.flightPoints[i].time <= currentTime && curveData.flightPoints[i + 1].time >= currentTime) {
        pPrev = curveData.flightPoints[i];
        pNext = curveData.flightPoints[i + 1];
        break;
      }
    }
    const span = Math.max(1e-5, pNext.time - pPrev.time);
    const alpha = clamp((currentTime - pPrev.time) / span, 0, 1);
    if (alpha > 0.01) {
      const exactTip = {
        u: pPrev.u + (pNext.u - pPrev.u) * alpha,
        time: currentTime,
        x: pPrev.x + (pNext.x - pPrev.x) * alpha,
        y: pPrev.y + (pNext.y - pPrev.y) * alpha,
        shadowX: pPrev.shadowX + (pNext.shadowX - pPrev.shadowX) * alpha,
        shadowY: pPrev.shadowY + (pNext.shadowY - pPrev.shadowY) * alpha,
        distanceMeters: pPrev.distanceMeters + (pNext.distanceMeters - pPrev.distanceMeters) * alpha,
        heightMeters: pPrev.heightMeters + (pNext.heightMeters - pPrev.heightMeters) * alpha
      };
      if (visibleFlight.length === 0) {
        visibleFlight.push(curveData.flightPoints[0], exactTip);
      } else {
        visibleFlight.push(exactTip);
      }
    } else if (visibleFlight.length < 2 && curveData.flightPoints.length >= 4) {
      // 원터치로 공 출발 시점(currentTime === impactTime)에 정확히 맞춘 정지 프레임에서도
      // 티에서 공과 빨간 발사 궤적이 즉각 뻗어나가는 초기 구간을 표시하여 시각적 피드백 제공
      visibleFlight.length = 0;
      visibleFlight.push(...curveData.flightPoints.slice(0, 4));
    }
  }

  const visibleRoll = curveData.rollPoints.filter(pt => pt.time <= currentTime + 0.004);

  // 현재 공의 실시간 거리·고도 계산
  let liveDistanceM = 0;
  let liveHeightM = 0;
  let currentBallPos = p0Px;

  if (visibleRoll.length > 0) {
    const lastR = visibleRoll.at(-1);
    liveDistanceM = lastR.distanceMeters;
    liveHeightM = lastR.heightMeters;
    currentBallPos = { x: lastR.x * width, y: lastR.y * height };
  } else if (visibleFlight.length > 0) {
    const lastF = visibleFlight.at(-1);
    liveDistanceM = lastF.distanceMeters;
    liveHeightM = lastF.heightMeters;
    currentBallPos = { x: lastF.x * width, y: lastF.y * height };
  }

  // 3) 지면 그림자 투영선 (Ground Shadow Projection Line)
  if (stOpts.showGroundShadow && visibleFlight.length >= 2) {
    ctx.save();
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.24)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    visibleFlight.forEach((pt, idx) => {
      const sx = pt.shadowX * width;
      const sy = pt.shadowY * height;
      if (idx === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 스튜디오에서 일시정지(!state.playing) 상태로 타임라인을 탐색하거나 공 위치/궤도를 조정할 때는
  // 임팩트 이전 스윙 구간에서도 언제나 전체 예상 탄도 곡선과 조작 핸들을 함께 표시하여 실제 스윙 영상과 궤도를 한눈에 맞출 수 있게 함
  const isCalibratingOrPinnedPause = !overrideShotOptions.hideCalibrationPreview && (
    Boolean(stOpts.pinTargetMode) || !state.playing
  );

  // 4) 공이 맞아 날아가는 메인 궤적(Protracer Trajectory / Real-Tail Comet) 렌더링
  if (isCalibratingOrPinnedPause && curveData.flightPoints.length >= 2) {
    // 공 위치 지정/조정 중일 때는 멈춰 있는 프레임이 초반이더라도 출발점 -> 중간점 1~3 -> APEX -> 탄착지점 전체를
    // 하나의 유연한 탄도 곡선으로 끝까지 연결해 그려주어 전체 비행 경로 형태를 즉시 확인할 수 있게 함
    ctx.save();
    ctx.globalAlpha = visibleFlight.length >= curveData.flightPoints.length ? 1.0 : 0.78;
    drawProtracerFlightCurve(ctx, width, height, curveData.flightPoints, stOpts, paletteObj, curveData, curveData.carryTime);
    if (curveData.rollPoints.length >= 2) {
      drawRolloutCurve(ctx, width, height, curveData.rollPoints, stOpts, paletteObj);
    }
    ctx.restore();
  }

  if (visibleFlight.length >= 2) {
    drawProtracerFlightCurve(ctx, width, height, visibleFlight, stOpts, paletteObj, curveData, currentTime);
  }

  // 5) 탄착 후 지면 바운스 및 런(Roll) 궤적 렌더링
  if (visibleRoll.length >= 2) {
    drawRolloutCurve(ctx, width, height, visibleRoll, stOpts, paletteObj);
  }

  // 6) 현재 슬로우 모션으로 날아가거나 굴러가는 골프공 선두(Head) 렌더링
  if (currentTime >= impactTime) {
    const progressU = visibleFlight.length ? visibleFlight.at(-1).u : 0;
    const ballRadius = clamp(6.0 * (1 - 0.48 * progressU), 2.8, 6.2);
    const headColor = stOpts.traceColor === 'gradient' ? '#DC2626' : (stOpts.traceColor || paletteObj.hex || '#DC2626');

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.strokeStyle = headColor;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(currentBallPos.x, currentBallPos.y, ballRadius + 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(currentBallPos.x, currentBallPos.y, ballRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 7) 공이 가장 높이 떴을 때 말풍선(Callout Bubble)으로 APEX 최고점 높이(m) 표시 (부드러운 페이드인)
  if (stOpts.showApexBubble && (currentTime >= curveData.apexTime - 0.02 || isCalibratingOrPinnedPause)) {
    const apexFadeT = isCalibratingOrPinnedPause ? 1 : clamp((currentTime - (curveData.apexTime - 0.02)) / 0.25, 0, 1);
    const apexAlpha = 1 - Math.pow(1 - apexFadeT, 3);
    const apexPx = {
      x: curveData.apexPoint.x * width,
      y: curveData.apexPoint.y * height + (1 - apexAlpha) * 6
    };
    const apexShadowPx = {
      x: (curveData.originPoint.x + (curveData.landingPoint.x - curveData.originPoint.x) * 0.54) * width,
      y: (curveData.originPoint.y + (curveData.landingPoint.y - curveData.originPoint.y) * 0.54) * height
    };
    ctx.save();
    ctx.globalAlpha = apexAlpha;
    drawApexCalloutBubble(ctx, width, height, apexPx, apexShadowPx, curveData.apexMeters, paletteObj);
    ctx.restore();
  }

  // 8) 탄착지점까지의 캐리 거리(Carry, m) 및 런을 포함한 최종 거리(Total, m) 표시 (부드러운 페이드인)
  if (stOpts.showLandingMarker && (currentTime >= curveData.carryTime - 0.02 || isCalibratingOrPinnedPause)) {
    const landFadeT = isCalibratingOrPinnedPause ? 1 : clamp((currentTime - (curveData.carryTime - 0.02)) / 0.25, 0, 1);
    const landAlpha = 1 - Math.pow(1 - landFadeT, 3);
    const landPx = {
      x: curveData.landingPoint.x * width,
      y: curveData.landingPoint.y * height
    };
    const rollPx = {
      x: curveData.rollEndPoint.x * width,
      y: curveData.rollEndPoint.y * height
    };
    const isRollFinished = isCalibratingOrPinnedPause || currentTime >= curveData.rollEndTime - 0.03 || curveData.rollMeters <= 0.2;
    ctx.save();
    ctx.globalAlpha = landAlpha;
    drawLandingAndTotalDistanceMarkers(
      ctx,
      width,
      height,
      landPx,
      rollPx,
      curveData.carryMeters,
      curveData.rollMeters,
      curveData.totalMeters,
      isRollFinished,
      paletteObj
    );
    ctx.restore();
  }

  // 9) 수동 위치 지정 모드이거나 공 위치 핀 조정 직후 일시정지 상태일 때 앵커 포인트 가이드 핸들 표시
  if (isCalibratingOrPinnedPause) {
    drawInteractiveCalibrationHandles(ctx, width, height, curveData, stOpts.pinTargetMode, stOpts);
  }

  // 10) 동영상 프레임 내 탄도(Trajectory)·구질·비거리 방송용 HUD 오버레이
  if (stOpts.showTrajectoryHud) {
    drawShotTracerBroadcastHud(
      ctx,
      width,
      height,
      stOpts,
      curveData,
      currentTime,
      liveDistanceM,
      liveHeightM,
      paletteObj
    );
  }

  ctx.restore();
}

// ============================================================================
// 7. 세부 그래픽 컴포넌트: 프로트레이서 궤적 선, APEX 말풍선, 탄착/최종거리 배지, 탄도 HUD
// ============================================================================

function drawTeeBallWaitingReticle(ctx, x, y, stOpts, paletteObj) {
  const strokeColor = paletteObj.hex === 'gradient' ? '#DC2626' : paletteObj.hex;
  ctx.save();

  // 골프공 본체
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(x, y, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 타깃 에임 링
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.8;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(x, y, 13, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();
}

function getSegmentColor(u, stOpts, paletteObj) {
  if (stOpts.traceColor === 'gradient' || paletteObj.id === 'gradient') {
    if (u < 0.45) return '#DC2626'; // 초반 고속 발사: 레드
    if (u < 0.78) return '#D97706'; // 중반 APEX 정점: 앰버 골드
    return '#0284C7'; // 후반 하강 탄착: 스카이 블루
  }
  return stOpts.traceColor || paletteObj.hex || '#DC2626';
}

function drawProtracerFlightCurve(ctx, width, height, points, stOpts, paletteObj, curveData = null, currentTime = 0) {
  const baseWidth = clamp(Number(stOpts.lineWidth ?? 6), 2, 16);
  const glowIntensity = clamp(Number(stOpts.glowIntensity ?? 0.75), 0, 1);
  const style = stOpts.traceStyle || 'tube';
  const isRealTail = (stOpts.trajectoryMode || 'real-tail') !== 'simulation';
  const isBallFlying = curveData ? (currentTime >= curveData.impactTime && currentTime < curveData.carryTime) : false;
  const tipTime = points.length > 0 ? points[points.length - 1].time : currentTime;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (style === 'strobe-ball') {
    // 스트로보 골프공 다중 잔상 + 가이드 라인
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const u = p1.u;
      const segColor = getSegmentColor(u, stOpts, paletteObj);
      ctx.strokeStyle = segColor;
      ctx.globalAlpha = 0.42;
      ctx.lineWidth = Math.max(1.8, baseWidth * 0.45 * (1 - 0.45 * u));
      ctx.beginPath();
      ctx.moveTo(p0.x * width, p0.y * height);
      ctx.lineTo(p1.x * width, p1.y * height);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    for (let i = 0; i < points.length; i += 3) {
      const pt = points[i];
      const u = pt.u;
      const r = Math.max(2.4, baseWidth * 0.78 * (1 - 0.52 * u));
      const segColor = getSegmentColor(u, stOpts, paletteObj);
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = segColor;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(pt.x * width, pt.y * height, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // 원근 테이퍼링 + 실제 공 추종 혜성 꼬리(Comet-Tail) 밀착 효과
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const x0 = p0.x * width;
    const y0 = p0.y * height;
    const x1 = p1.x * width;
    const y1 = p1.y * height;

    const u = p1.u;
    const perspectiveTaper = 1.0 - 0.52 * Math.pow(u, 0.85);
    const originPinch = isRealTail ? (0.62 + 0.38 * clamp(u / 0.04, 0, 1)) : 1.0;

    // 공이 날아가는 중일 때 공 바로 뒤 꼬리 구간(최근 0.16초)에 혜성 추진력 강조
    const timeBehindTip = Math.max(0, tipTime - p1.time);
    const cometHeadBoost = (isRealTail && isBallFlying)
      ? (1.0 + 0.24 * Math.exp(-timeBehindTip / 0.085))
      : 1.0;

    const segWidth = Math.max(2.0, baseWidth * perspectiveTaper * originPinch * cometHeadBoost);
    const segColor = getSegmentColor(u, stOpts, paletteObj);

    // 1층: 외부 소프트 글로우 헤일로 (Outer Broadcast Halo)
    if (glowIntensity > 0.05) {
      const haloAlpha = clamp(0.28 * glowIntensity * cometHeadBoost, 0.04, 0.52);
      ctx.strokeStyle = segColor;
      ctx.globalAlpha = haloAlpha;
      ctx.lineWidth = segWidth * (style === 'beam' ? 2.5 : 2.0);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // 2층: 고채도 프로트레이서 본체 (Main Saturated Body)
    ctx.strokeStyle = segColor;
    ctx.globalAlpha = 0.96;
    ctx.lineWidth = segWidth;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    // 3층: 중심부 하이라이트 코어 선 (Inner Specular Core)
    if (style === 'tube' || style === 'beam') {
      ctx.strokeStyle = paletteObj.coreHex || '#FFFFFF';
      ctx.globalAlpha = style === 'beam' ? 0.88 : (0.52 * cometHeadBoost);
      ctx.lineWidth = Math.max(1.0, segWidth * 0.36);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawRolloutCurve(ctx, width, height, rollPoints, stOpts, paletteObj) {
  const baseWidth = clamp(Number(stOpts.lineWidth ?? 6), 2, 16);
  const strokeColor = stOpts.traceColor === 'gradient' ? '#0284C7' : (stOpts.traceColor || paletteObj.hex || '#DC2626');

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(2.2, baseWidth * 0.45);
  ctx.setLineDash([4, 3]);

  ctx.beginPath();
  rollPoints.forEach((pt, idx) => {
    const px = pt.x * width;
    const py = pt.y * height;
    if (idx === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * 공이 가장 높이 떴을 때(APEX) 궤적 정점에 말풍선(Speech Callout Bubble) 형태로 APEX 높이를 표시합니다.
 */
function drawApexCalloutBubble(ctx, width, height, apexPx, shadowPx, apexMeters, paletteObj) {
  const accentColor = paletteObj.hex === 'gradient' ? '#DC2626' : (paletteObj.hex === '#F8FAFC' ? '#0F172A' : paletteObj.hex);

  ctx.save();

  // 1) 정점에서 지면 그림자까지 수직 고도 점선 인디케이터 표시
  if (shadowPx && shadowPx.y > apexPx.y + 24) {
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.32)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(apexPx.x, apexPx.y + 6);
    ctx.lineTo(apexPx.x, Math.min(shadowPx.y, apexPx.y + height * 0.28));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 2) APEX 정점 포인트 링
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(apexPx.x, apexPx.y, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 3) 말풍선(Speech Bubble) 크기 및 위치 계산 (화면 상단 경계 밖으로 나가지 않도록 자동 보정)
  const labelTitle = 'APEX 최고점';
  const labelValue = `${apexMeters.toFixed(1)} m`;
  ctx.font = '700 13px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  const valWidth = ctx.measureText(labelValue).width;
  ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  const titleWidth = ctx.measureText(labelTitle).width;

  const bubbleW = Math.max(118, titleWidth + valWidth + 32);
  const bubbleH = 34;
  const tailH = 8;

  // 기본적으로 정점 바로 위에 말풍선 배치, 상단 여백이 부족하면 정점 아래에 배치
  const placeBelow = apexPx.y - bubbleH - tailH - 12 < 52;
  const bx = clamp(apexPx.x - bubbleW / 2, 12, width - bubbleW - 12);
  const by = placeBelow ? (apexPx.y + tailH + 8) : (apexPx.y - bubbleH - tailH - 8);
  const pointerX = clamp(apexPx.x, bx + 14, bx + bubbleW - 14);

  // 말풍선 본체 및 꼬리(Tail Pointer) 패스
  ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2.0;

  ctx.beginPath();
  ctx.roundRect(bx, by, bubbleW, bubbleH, 8);
  ctx.fill();
  ctx.stroke();

  // 말풍선 삼각형 꼬리
  ctx.beginPath();
  if (!placeBelow) {
    ctx.moveTo(pointerX - 7, by + bubbleH - 1);
    ctx.lineTo(pointerX, by + bubbleH + tailH);
    ctx.lineTo(pointerX + 7, by + bubbleH - 1);
  } else {
    ctx.moveTo(pointerX - 7, by + 1);
    ctx.lineTo(pointerX, by - tailH);
    ctx.lineTo(pointerX + 7, by + 1);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
  ctx.fill();
  ctx.strokeStyle = accentColor;
  ctx.stroke();

  // 좌측 컬러 포인트 바
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.roundRect(bx + 6, by + 7, 4, bubbleH - 14, 2);
  ctx.fill();

  // 말풍선 내부 텍스트 ('APEX 최고점   28.4 m')
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  ctx.fillStyle = '#475569';
  ctx.fillText(labelTitle, bx + 16, by + bubbleH / 2);

  ctx.textAlign = 'right';
  ctx.font = '800 13.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  ctx.fillStyle = '#0F172A';
  ctx.fillText(labelValue, bx + bubbleW - 12, by + bubbleH / 2);

  ctx.restore();
}

/**
 * 탄착지점(Carry) 마커 및 런(Roll) 포함 최종거리(Total) 말풍선 배지를 렌더링합니다.
 */
function drawLandingAndTotalDistanceMarkers(
  ctx,
  width,
  height,
  landPx,
  rollPx,
  carryMeters,
  rollMeters,
  totalMeters,
  isRollFinished,
  paletteObj
) {
  const accentColor = paletteObj.hex === 'gradient' ? '#DC2626' : (paletteObj.hex === '#F8FAFC' ? '#0F172A' : paletteObj.hex);

  ctx.save();

  // 1) 탄착지점(Carry Landing) 원근 타원 임팩트 링
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.ellipse(landPx.x, landPx.y, 12, 5, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(landPx.x, landPx.y, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // 2) 탄착지점 캐리(Carry) 거리 배지 (좌측 잔디 지면 레벨 배치)
  const carryText = `탄착(캐리) ${carryMeters.toFixed(1)} m`;
  ctx.font = '700 11.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  const cw = ctx.measureText(carryText).width + 20;
  const ch = 26;
  const minMarkerX = Math.min(landPx.x, isRollFinished ? rollPx.x : landPx.x);
  const maxMarkerY = Math.max(landPx.y, isRollFinished ? rollPx.y : landPx.y);
  const cbx = clamp(minMarkerX - cw - 12, 10, width - cw - 10);
  const cby = clamp(landPx.y - ch / 2, 54, height - ch - 48);

  // 리더 라인
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(landPx.x, landPx.y);
  ctx.lineTo(cbx + cw, cby + ch / 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect(cbx, cby, cw, ch, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#0F172A';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(carryText, cbx + cw / 2, cby + ch / 2);

  // 3) 런(Roll) 포함 최종 정지 지점(Total Distance) 말풍선 배지 (산림 쪽 위가 아닌 잔디 지면 아래쪽에 배치)
  if (isRollFinished) {
    ctx.fillStyle = '#0F172A';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(rollPx.x, rollPx.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const totalTitle = `최종 ${totalMeters.toFixed(1)} m`;
    const rollSub = `런 +${rollMeters.toFixed(1)} m`;
    ctx.font = '800 12.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
    const tw1 = ctx.measureText(totalTitle).width;
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
    const tw2 = ctx.measureText(rollSub).width;

    const tbw = Math.max(138, tw1 + tw2 + 28);
    const tbh = 30;
    const tbx = clamp(rollPx.x - tbw * 0.5, 10, width - tbw - 10);
    const tby = clamp(Math.max(maxMarkerY + 9, cby + ch + 5), 54, height - tbh - 14);

    // 리더 라인
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(rollPx.x, rollPx.y);
    ctx.lineTo(clamp(rollPx.x, tbx + 12, tbx + tbw - 12), tby);
    ctx.stroke();

    ctx.fillStyle = '#0F172A';
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(tbx, tby, tbw, tbh, 7);
    ctx.fill();
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = '800 12.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(totalTitle, tbx + 10, tby + tbh / 2);

    ctx.textAlign = 'right';
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
    ctx.fillStyle = '#FCD34D';
    ctx.fillText(rollSub, tbx + tbw - 10, tby + tbh / 2);
  }

  ctx.restore();
}

function drawInteractiveCalibrationHandles(ctx, width, height, curveData, activeTarget, stOpts = {}) {
  const isRealTail = (stOpts.trajectoryMode || 'real-tail') !== 'simulation';
  const store = stOpts.pinnedPointsStore || {};
  const mergePt = (curvePt, key) => {
    const saved = store[key];
    if (saved?.pinned && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      return { ...(curvePt || {}), ...saved, pinned: true };
    }
    return curvePt;
  };

  const handles = isRealTail
    ? [
        { key: 'origin', label: '1. 출발점(공)', shortLabel: '출발점', pt: mergePt(curveData.originPoint, 'origin'), color: '#059669' },
        { key: 'mid1', label: '2. 중간점 1', shortLabel: '중간점1', pt: mergePt(curveData.midPoint1, 'mid1'), color: '#EA580C' },
        { key: 'mid2', label: '3. 중간점 2', shortLabel: '중간점2', pt: mergePt(curveData.midPoint2, 'mid2'), color: '#D97706' },
        { key: 'mid3', label: '4. 중간점 3', shortLabel: '중간점3', pt: mergePt(curveData.midPoint3, 'mid3'), color: '#0D9488' },
        { key: 'apex', label: '5. 최고점(APEX)', shortLabel: '최고점', pt: mergePt(curveData.apexPoint, 'apex'), color: '#DC2626' },
        { key: 'landing', label: '6. 탄착지점(캐리)', shortLabel: '탄착지점', pt: mergePt(curveData.landingPoint, 'landing'), color: '#2563EB' },
        { key: 'roll', label: '7. 최종지점(런)', shortLabel: '최종런', pt: mergePt(curveData.rollEndPoint, 'roll'), color: '#7C3AED' }
      ]
    : [
        { key: 'origin', label: '1. 출발점(공)', shortLabel: '출발점', pt: mergePt(curveData.originPoint, 'origin'), color: '#059669' },
        { key: 'apex', label: '2. 최고점(APEX)', shortLabel: '최고점', pt: mergePt(curveData.apexPoint, 'apex'), color: '#DC2626' },
        { key: 'landing', label: '3. 탄착지점(캐리)', shortLabel: '탄착지점', pt: mergePt(curveData.landingPoint, 'landing'), color: '#2563EB' },
        { key: 'roll', label: '4. 최종지점(런)', shortLabel: '최종런', pt: mergePt(curveData.rollEndPoint, 'roll'), color: '#7C3AED' }
      ];

  const summary = getPinnedWorkSummaryForTarget(stOpts, activeTarget || stOpts.lastPinnedKey);
  const immediatePrevKey = summary.immediatePrevPin?.key || null;

  ctx.save();

  // 1) 직전 작업까지 지정된 지점들 사이의 연결 가이드 선 렌더링
  const pinnedHandles = handles.filter(h => h.pt && h.pt.pinned && Number.isFinite(h.pt.x) && Number.isFinite(h.pt.y));
  if (pinnedHandles.length >= 2) {
    ctx.save();
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.78)';
    ctx.lineWidth = 2.2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    pinnedHandles.forEach((h, idx) => {
      const hx = h.pt.x * width;
      const hy = h.pt.y * height;
      if (idx === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 2) 지점 버튼 활성화 중 마우스 호버 시: 직전 작업 지점에서 현재 마우스 커서까지 실시간 탄도 연결 가이드 선 표시
  if (activeTarget && summary.immediatePrevPin && stOpts.hoverNormPoint) {
    const prevX = summary.immediatePrevPin.x * width;
    const prevY = summary.immediatePrevPin.y * height;
    const curX = clamp(stOpts.hoverNormPoint.x, 0.01, 0.99) * width;
    const curY = clamp(stOpts.hoverNormPoint.y, 0.01, 0.99) * height;

    ctx.save();
    ctx.strokeStyle = '#2563EB';
    ctx.lineWidth = 2.2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(prevX, prevY);
    // 부드러운 곡선 프리뷰
    const midCtrlX = (prevX + curX) * 0.5;
    const midCtrlY = Math.min(prevY, curY) - Math.abs(curX - prevX) * 0.08;
    ctx.quadraticCurveTo(midCtrlX, midCtrlY, curX, curY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 마우스 커서 타깃 에임 및 예상 좌표 라벨
    ctx.strokeStyle = '#1D4ED8';
    ctx.fillStyle = 'rgba(37, 99, 235, 0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(curX, curY, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const hoverLabel = `새 위치 (${(stOpts.hoverNormPoint.x * 100).toFixed(1)}%, ${(stOpts.hoverNormPoint.y * 100).toFixed(1)}%)`;
    ctx.font = '700 10.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
    const hw = ctx.measureText(hoverLabel).width + 12;
    const hbx = clamp(curX + 12, 8, width - hw - 8);
    const hby = clamp(curY - 11, 8, height - 24);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.beginPath();
    ctx.roundRect(hbx, hby, hw, 20, 4);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(hoverLabel, hbx + 6, hby + 10);
    ctx.restore();
  }

  // 3) 각 지점 마커 및 지정된 프레임·위치 배지 렌더링
  for (const h of handles) {
    if (!h.pt) continue;
    const px = h.pt.x * width;
    const py = h.pt.y * height;
    const isActive = h.key === activeTarget || (activeTarget === 'frame-ball' && h.key === stOpts.lastPinnedKey);
    const isPinned = Boolean(h.pt.pinned);
    const isImmediatePrev = Boolean(immediatePrevKey && h.key === immediatePrevKey);

    // 직전 작업 지점 강조 외곽 링
    if (isImmediatePrev) {
      ctx.save();
      ctx.strokeStyle = '#1D4ED8';
      ctx.fillStyle = 'rgba(37, 99, 235, 0.15)';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([4, 2]);
      ctx.beginPath();
      ctx.arc(px, py, 14.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    ctx.strokeStyle = h.color;
    ctx.fillStyle = isActive ? h.color : (isImmediatePrev ? '#DBEAFE' : (isPinned ? '#FEF3C7' : '#FFFFFF'));
    ctx.lineWidth = isActive ? 3.2 : (isImmediatePrev ? 3.0 : (isPinned ? 2.6 : 1.8));
    ctx.beginPath();
    ctx.arc(px, py, isActive ? 9.5 : (isImmediatePrev ? 8.5 : (isPinned ? 7.5 : 5.8)), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const coordText = `X ${(h.pt.x * 100).toFixed(1)}%, Y ${(h.pt.y * 100).toFixed(1)}%`;
    const frameTimeText = h.pt.pinnedFrame
      ? `F${h.pt.pinnedFrame}${Number.isFinite(h.pt.pinnedTime) ? ` (${Number(h.pt.pinnedTime).toFixed(2)}s)` : ''}`
      : '프레임 미지정';

    if (isActive) {
      const activeDetail = isPinned && h.pt.pinnedFrame
        ? `${h.label} · 기존 ${frameTimeText} [${coordText}]`
        : `${h.label} · 클릭하여 현재 프레임 공 위치 지정`;
      ctx.font = '700 11px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
      const w = ctx.measureText(activeDetail).width + 16;
      const bx = clamp(px - w / 2, 8, width - w - 8);
      const by = clamp(py + 13, 8, height - 28);
      ctx.fillStyle = h.color;
      ctx.beginPath();
      ctx.roundRect(bx, by, w, 23, 5);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(activeDetail, bx + w / 2, by + 11.5);
    } else if (isPinned) {
      const prefix = isImmediatePrev ? '[직전 작업] ' : '';
      const line1 = `${prefix}${h.label} · ${frameTimeText}`;
      const line2 = `위치: ${coordText}`;
      ctx.font = '700 10.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
      const w1 = ctx.measureText(line1).width;
      ctx.font = '600 9.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
      const w2 = ctx.measureText(line2).width;
      const boxW = Math.max(w1, w2) + 14;
      const boxH = 32;
      const bx = clamp(px - boxW / 2, 6, width - boxW - 6);
      const by = clamp(py - boxH - 10, 6, height - boxH - 6);

      ctx.fillStyle = isImmediatePrev ? 'rgba(239, 246, 255, 0.96)' : 'rgba(255, 255, 255, 0.95)';
      ctx.strokeStyle = isImmediatePrev ? '#1D4ED8' : h.color;
      ctx.lineWidth = isImmediatePrev ? 2.0 : 1.5;
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 5);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '700 10.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
      ctx.fillStyle = isImmediatePrev ? '#1E3A8A' : '#0F172A';
      ctx.fillText(line1, bx + 7, by + 10);

      ctx.font = '600 9.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
      ctx.fillStyle = '#475569';
      ctx.fillText(line2, bx + 7, by + 22.5);
    }
  }

  // 4) 지점 버튼 클릭 활성화 시 캔버스 상단에 [직전 작업까지의 지정 프레임·위치 현황] 요약 배너 표시
  if (activeTarget) {
    const targetMetaObj = summary.targetMeta || summary.targetEntry;
    const targetLabel = targetMetaObj ? targetMetaObj.label : '현재 프레임 공 위치 자동 매칭';
    const prevPin = summary.immediatePrevPin || summary.immediatePrevEntry;
    const prevLine = prevPin
      ? `직전 작업 지점: ${prevPin.label} | 프레임 F${prevPin.pinnedFrame} (${Number(prevPin.pinnedTime || 0).toFixed(2)}s) | 위치 X ${(prevPin.x * 100).toFixed(1)}%, Y ${(prevPin.y * 100).toFixed(1)}%`
      : '직전 작업 지점: 아직 수동 지정된 이전 지점이 없습니다 (현재 멈춘 프레임에서 첫 공 위치를 클릭하세요)';

    const upToPins = summary.upToTargetPins || summary.upToPreviousEntries || [];
    const allPins = summary.allPinnedList || summary.userPinnedEntries || [];
    const chainItems = (upToPins.length > 0 ? upToPins : allPins)
      .map(p => `${p.shortLabel || p.label}(F${p.pinnedFrame}·${(p.x * 100).toFixed(0)}%,${(p.y * 100).toFixed(0)}%)`);
    const chainLine = chainItems.length > 0
      ? `누적 지정 경로(${chainItems.length}곳): ${chainItems.join(' → ')}`
      : `선택된 [${targetLabel}] 버튼을 누른 상태에서 영상 위 공을 클릭하면 현재 프레임과 위치가 실시간 저장됩니다.`;

    ctx.save();
    ctx.font = '700 11.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
    const tw1 = ctx.measureText(prevLine).width;
    ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
    const tw2 = ctx.measureText(chainLine).width;
    const bannerW = clamp(Math.max(tw1, tw2) + 24, 280, width - 28);
    const bannerH = 44;
    const bx = 14;
    const by = 54;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.strokeStyle = '#2563EB';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(bx, by, bannerW, bannerH, 7);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '700 11.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
    ctx.fillStyle = '#1E3A8A';
    ctx.fillText(prevLine, bx + 11, by + 14);

    ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText(chainLine, bx + 11, by + 31);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * 동영상 프레임 내부에 탄도(Launch Angle & Trajectory Classification), APEX 높이,
 * 캐리 거리(m), 런 포함 최종 거리(m), 측면 탄도 아크 미니 다이어그램을 함께 합성합니다.
 * 우측 하단 샷 정보 카드는 임팩트(impactTime) 이후에 부드러운 페이드인(Fade-In + Slide-Up) 애니메이션과 함께 표현됩니다.
 */
function drawShotTracerBroadcastHud(
  ctx,
  width,
  height,
  stOpts,
  curveData,
  currentTime,
  liveDistanceM,
  liveHeightM,
  paletteObj
) {
  // 임팩트 이전(어드레스~백스윙~다운스윙)에는 샷 정보 HUD를 숨기고, 임팩트 직후부터 페이드인으로 표현
  if (currentTime <= curveData.impactTime) {
    return;
  }

  const elapsedSinceImpact = Math.max(0, currentTime - curveData.impactTime);
  const fadeDurationSec = 0.48;
  const fadeProgress = clamp(elapsedSinceImpact / fadeDurationSec, 0, 1);
  // Cubic Ease-Out 페이드인 커브 (0 -> 1) 및 하단 슬라이드업(18px -> 0px) 오프셋
  const fadeAlpha = 1 - Math.pow(1 - fadeProgress, 3);
  const slideOffsetY = Math.round((1 - fadeAlpha) * 18);

  const pad = Math.max(12, Math.round(width * 0.018));
  const trajClass = classifyTrajectoryLabel(stOpts.launchAngleDeg, curveData.apexMeters);
  const shapeClass = classifyShotShapeLabel(
    stOpts.sideCurveMeters,
    stOpts.launchDirectionDeg ?? 0,
    stOpts.shotShapeType || 'auto'
  );
  const slopeClass = classifyTerrainSlopeInfo(
    stOpts.elevationDeltaMeters ?? 0,
    stOpts.terrainSlopeMode || 'auto',
    stOpts.detectedTerrainSlope || 'flat'
  );
  const speedMps = Number(stOpts.ballSpeedMps || 60.4);
  const speedMph = Math.round(speedMps * 2.23694);
  const accentColor = paletteObj.hex === 'gradient' ? '#DC2626' : (paletteObj.hex === '#F8FAFC' ? '#0F172A' : paletteObj.hex);

  ctx.save();
  ctx.globalAlpha = fadeAlpha;

  // 1) 상단 방송용 헤더 스트립 (탄도 · 지형 경사 · 구질 · 볼스피드 요약)
  const topBoxH = 42;
  const topBoxW = Math.min(width - pad * 2, 620);
  const topY = pad - Math.round((1 - fadeAlpha) * 8);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(pad, topY, topBoxW, topBoxH, 7);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.roundRect(pad, topY, 6, topBoxH, [7, 0, 0, 7]);
  ctx.fill();

  const cy = topY + topBoxH / 2;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = '800 13px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  ctx.fillStyle = '#0F172A';
  ctx.fillText(`탄도 ${Number(stOpts.launchAngleDeg).toFixed(1)}° (${trajClass.labelKo.split(' (')[0]})`, pad + 16, cy);

  ctx.textAlign = 'right';
  ctx.font = '600 11.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  ctx.fillStyle = '#334155';
  const topRightStr = `${slopeClass.shortKo}  |  ${shapeClass.labelKo}  |  ${speedMps.toFixed(1)}m/s (${speedMph}mph)`;
  ctx.fillText(topRightStr, pad + topBoxW - 14, cy);

  // 2) 우측 하단 Toptracer / TrackMan 스타일 종합 샷 데이터 & 측면 탄도 프로파일 카드 (임팩트 후 페이드인 + 슬라이드업)
  const isCompact = width < 560;
  const cardW = isCompact ? Math.min(width - pad * 2, 236) : 268;
  const cardH = isCompact ? 168 : 186;
  const cardX = width - cardW - pad;
  const cardY = height - cardH - pad + slideOffsetY;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 8);
  ctx.fill();
  ctx.stroke();

  // 카드 상단 타이틀 바
  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  ctx.roundRect(cardX + 1, cardY + 1, cardW - 2, 28, [7, 7, 0, 0]);
  ctx.fill();

  ctx.strokeStyle = '#E2E8F0';
  ctx.beginPath();
  ctx.moveTo(cardX, cardY + 29);
  ctx.lineTo(cardX + cardW, cardY + 29);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '700 11px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  ctx.fillStyle = '#0F172A';
  ctx.fillText('SHOT TRACER · 탄도 데이터', cardX + 12, cardY + 15);

  ctx.textAlign = 'right';
  ctx.font = '700 10.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  ctx.fillStyle = slopeClass.badgeColor;
  ctx.fillText(slopeClass.shortKo, cardX + cardW - 12, cardY + 15);

  // 4개 핵심 수치 그리드 (1: 탄착 캐리 거리 / 2: 런 포함 최종거리 / 3: APEX 최고높이 / 4: 발사 탄도)
  const displayCarry = curveData.carryMeters;
  const displayTotal = curveData.totalMeters;

  const colW = (cardW - 24) / 2;
  const row1Y = cardY + 42;
  const row2Y = cardY + 84;

  // (1,1) 탄착 캐리 거리 (m)
  ctx.textAlign = 'left';
  ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('탄착 거리 (CARRY)', cardX + 12, row1Y);
  ctx.font = '800 16px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  ctx.fillStyle = '#0F172A';
  ctx.fillText(`${displayCarry.toFixed(1)} m`, cardX + 12, row1Y + 18);

  // (1,2) 런 포함 최종 거리 (m)
  ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText(`최종 거리 (런 +${curveData.rollMeters.toFixed(1)}m)`, cardX + 12 + colW, row1Y);
  ctx.font = '800 16px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  ctx.fillStyle = accentColor;
  ctx.fillText(`${displayTotal.toFixed(1)} m`, cardX + 12 + colW, row1Y + 18);

  // (2,1) APEX 최고점 높이 (m)
  ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('최고점 높이 (APEX)', cardX + 12, row2Y);
  ctx.font = '800 14.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  ctx.fillStyle = '#0F172A';
  ctx.fillText(`${curveData.apexMeters.toFixed(1)} m`, cardX + 12, row2Y + 17);

  // (2,2) 발사 탄도 (Launch Angle)
  ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('발사 탄도 (LAUNCH)', cardX + 12 + colW, row2Y);
  ctx.font = '800 14.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  ctx.fillStyle = trajClass.badgeColor;
  ctx.fillText(`${Number(stOpts.launchAngleDeg).toFixed(1)}° (${shapeClass.shortKo})`, cardX + 12 + colW, row2Y + 17);

  // 3) 카드 하단: 측면 탄도 프로파일 미니 아크 다이어그램 (오르막/평지/내리막 경사 지면선 포함 시각화)
  const profX = cardX + 12;
  const profY = cardY + cardH - 52;
  const profW = cardW - 24;
  const profH = 40;

  ctx.fillStyle = '#F8FAFC';
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(profX, profY, profW, profH, 5);
  ctx.fill();
  ctx.stroke();

  const startGroundY = profY + profH - 10;
  const slopeVisualDeltaPx = clamp(-slopeClass.elevationDeltaMeters * 0.42, -7.5, 6.0);
  const endGroundY = startGroundY + slopeVisualDeltaPx;
  const startX = profX + 10;
  const endX = profX + profW - 14;
  const carryRatio = clamp(curveData.carryMeters / Math.max(1, curveData.totalMeters), 0.72, 0.98);
  const carryEndX = startX + (endX - startX) * carryRatio;
  const carryGroundY = startGroundY + slopeVisualDeltaPx * carryRatio;
  const peakX = startX + (carryEndX - startX) * 0.55;
  const peakHeightRatio = clamp(curveData.apexMeters / 42, 0.25, 0.92);
  const peakY = Math.min(startGroundY, carryGroundY) - (profH - 17) * peakHeightRatio;

  // 경사 지면 기준선 (오르막은 우상향, 내리막은 우하향, 평지는 수평)
  ctx.strokeStyle = slopeClass.slopeType === 'flat' ? '#CBD5E1' : slopeClass.badgeColor;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(startX, startGroundY);
  ctx.lineTo(endX, endGroundY);
  ctx.stroke();

  // 발사각 부채꼴 표시
  ctx.strokeStyle = trajClass.badgeColor;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(startX, startGroundY, 18, -clamp((stOpts.launchAngleDeg * Math.PI) / 180, 0.12, 0.65), 0);
  ctx.stroke();

  // 측면 탄도 캐리 아크 (발사 -> APEX -> 경사 탄착면)
  const ctrlY = 2 * peakY - 0.5 * (startGroundY + carryGroundY);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(startX, startGroundY);
  ctx.quadraticCurveTo(peakX, ctrlY, carryEndX, carryGroundY);
  ctx.stroke();

  // 측면 런(Roll) 점선 구간 (경사 지면을 따라 굴러감)
  if (curveData.rollMeters > 0.2) {
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(carryEndX, carryGroundY);
    ctx.lineTo(endX, endGroundY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 미니 탄도 다이어그램 라벨
  ctx.font = '600 9.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  ctx.fillStyle = '#475569';
  ctx.textAlign = 'left';
  ctx.fillText(`탄도 ${Number(stOpts.launchAngleDeg).toFixed(1)}°`, startX + 2, profY + 9);
  ctx.textAlign = 'center';
  ctx.fillText(`APEX ${curveData.apexMeters.toFixed(1)}m`, peakX, profY + 9);
  ctx.textAlign = 'right';
  ctx.fillText(`총 ${curveData.totalMeters.toFixed(0)}m`, endX, profY + 9);

  ctx.restore();
}
