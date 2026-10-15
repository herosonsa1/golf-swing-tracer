// ============================================================================
// renderer-exporter.js
// 실제 골프채(샤프트·호젤·클럽헤드·비디오 클럽 패치) 다중 노출 스트로보 잔상 렌더러,
// 잔상 동영상(WebM/MP4) 인코더, 단일 스트로보 스냅샷 및 7단계 시퀀스 파노라마 생성기
// ============================================================================

import {
  clamp,
  visible,
  CONNECTIONS,
  MOMENT_COLORS,
  KEY_MOMENTS,
  measurements,
  calculateTempo,
  interpolateCatmullRom
} from './swing-engine.js';
import {
  drawSynthesizedGolferScene,
  drawRealisticGolfClub,
  computeShaftAxialAlpha
} from './demo-generator.js';

/**
 * 시간 t가 스윙의 어느 구간(백스윙 / 다운스윙~임팩트 / 팔로우스루)에 속하는지 판별합니다.
 */
export function resolveSwingPhaseSegment(time, momentsMap) {
  const topTime = momentsMap?.top ?? 1.45;
  const impactTime = momentsMap?.impact ?? 1.78;
  if (time <= topTime + 0.01) return 'backswing';
  if (time <= impactTime + 0.04) return 'downswing';
  return 'follow';
}

export const SEGMENT_COLORS = {
  backswing: '#2563EB',
  downswing: '#DC2626',
  follow: '#0D9488'
};

/**
 * 샘플 배열에서 시간 t에 가장 가까운 샘플을 이진 탐색으로 찾습니다.
 */
export function findNearestSample(samples, time, maxTolerance = 0.25) {
  if (!samples || !samples.length) return null;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].time < time) lo = mid + 1;
    else hi = mid - 1;
  }
  const candidates = [samples[lo], samples[lo - 1]].filter(Boolean);
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time));
  return Math.abs(candidates[0].time - time) <= maxTolerance ? candidates[0] : candidates[0];
}

/**
 * 시간 time에 대해 샘플 배열에서 미래 프레임으로 튀지 않고 정확히 현재 시점(time)의
 * 그립·클럽 헤드·관절 좌표를 연속 보간(Sub-frame Interpolation)하여 반환합니다.
 */
export function interpolateSampleAtTime(samples, time) {
  if (!samples || !samples.length) return null;
  if (time <= samples[0].time) return samples[0];
  if (time >= samples.at(-1).time) return samples.at(-1);

  let lo = 0;
  let hi = samples.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].time <= time) lo = mid + 1;
    else hi = mid - 1;
  }

  const idx0 = clamp(lo - 1, 0, samples.length - 2);
  const s0 = samples[idx0];
  const s1 = samples[idx0 + 1];
  const ASPECT = clamp(s0.aspect || s1.aspect || (16 / 9), 0.55, 2.4);
  const dt = Math.max(1e-5, s1.time - s0.time);
  const u = clamp((time - s0.time) / dt, 0, 1);

  if (u < 1e-3) return s0;
  if (u > 1 - 1e-3) return s1;

  const gx = s0.grip.x + (s1.grip.x - s0.grip.x) * u;
  const gy = s0.grip.y + (s1.grip.y - s0.grip.y) * u;

  const dx0 = (s0.clubHead.x - s0.grip.x) * ASPECT;
  const dy0 = s0.clubHead.y - s0.grip.y;
  const dx1 = (s1.clubHead.x - s1.grip.x) * ASPECT;
  const dy1 = s1.clubHead.y - s1.grip.y;

  const len0 = Math.hypot(dx0, dy0);
  const len1 = Math.hypot(dx1, dy1);
  const interpLenY = len0 + (len1 - len0) * u;

  const hasUnwrapped0 = Number.isFinite(s0.clubHead.shaftAngle);
  const hasUnwrapped1 = Number.isFinite(s1.clubHead.shaftAngle);
  let interpAngle;
  if (hasUnwrapped0 && hasUnwrapped1) {
    interpAngle = s0.clubHead.shaftAngle + (s1.clubHead.shaftAngle - s0.clubHead.shaftAngle) * u;
  } else {
    const ang0 = Math.atan2(dy0, dx0);
    let ang1 = Math.atan2(dy1, dx1);
    while (ang1 - ang0 > Math.PI) ang1 -= Math.PI * 2;
    while (ang1 - ang0 < -Math.PI) ang1 += Math.PI * 2;
    interpAngle = ang0 + (ang1 - ang0) * u;
  }

  const hx = gx + Math.cos(interpAngle) * (interpLenY / ASPECT);
  const hy = gy + Math.sin(interpAngle) * interpLenY;
  const face0 = s0.clubHead.faceOpenDeg ?? 0;
  const face1 = s1.clubHead.faceOpenDeg ?? 0;
  const interpFaceOpen = face0 + (face1 - face0) * u;
  const fs0 = s0.clubHead.foreshorten ?? 1.0;
  const fs1 = s1.clubHead.foreshorten ?? 1.0;
  const interpForeshorten = Number((fs0 + (fs1 - fs0) * u).toFixed(3));

  const interpPoints = s0.points && s1.points
    ? s0.points.map((p0, idx) => {
        const p1 = s1.points[idx] || p0;
        return {
          x: p0.x + (p1.x - p0.x) * u,
          y: p0.y + (p1.y - p0.y) * u,
          z: (p0.z ?? 0) + ((p1.z ?? 0) - (p0.z ?? 0)) * u,
          visibility: p0.visibility ?? 0.95
        };
      })
    : s0.points;

  const interpMotion = s0.bodyMotion && s1.bodyMotion
    ? {
        shoulderTurn: s0.bodyMotion.shoulderTurn + (s1.bodyMotion.shoulderTurn - s0.bodyMotion.shoulderTurn) * u,
        hipTurn: s0.bodyMotion.hipTurn + (s1.bodyMotion.hipTurn - s0.bodyMotion.hipTurn) * u,
        headTurn: s0.bodyMotion.headTurn + (s1.bodyMotion.headTurn - s0.bodyMotion.headTurn) * u,
        trailHeelLift: s0.bodyMotion.trailHeelLift + (s1.bodyMotion.trailHeelLift - s0.bodyMotion.trailHeelLift) * u,
        hipShiftX: s0.bodyMotion.hipShiftX + (s1.bodyMotion.hipShiftX - s0.bodyMotion.hipShiftX) * u
      }
    : s0.bodyMotion;

  return {
    ...s0,
    aspect: ASPECT,
    time,
    points: interpPoints,
    grip: { x: gx, y: gy },
    clubHead: {
      x: hx,
      y: hy,
      shaftAngle: interpAngle,
      faceOpenDeg: interpFaceOpen,
      foreshorten: interpForeshorten,
      pinned: false
    },
    clubSpeed: Math.round((s0.clubSpeed ?? 0) * (1 - u) + (s1.clubSpeed ?? 0) * u),
    bodyMotion: interpMotion
  };
}

/**
 * 스윙 구간 샘플 배열(strokeSamples)에서 고정된 호 길이 이정표(Fixed Arc Milestones)마다 잔상 클럽을 생성합니다.
 *
 * 핵심 개선 사항:
 * 1) 연속 언래핑된 샤프트 각도(Unwrapped Shaft Angle)를 사용하여 +-180° 경계 불연속을 제거하고,
 * 2) 어떤 프레임에서도 현재 골프채 각도(currAngle)보다 진행 방향 앞쪽에 위치한 잔상이 생성되지 않도록
 *    시간·거리·각도 3중 후방 추종 필터(Strict Trailing Filter)를 적용합니다.
 */
export function buildUniformArcStrobeClubs(
  strokeSamples,
  strobeStep = 2,
  currentSample = null,
  isBackswingPhase = false,
  hand = 'right',
  isDTL = false,
  impactTime = null
) {
  if (!strokeSamples || strokeSamples.length < 2) return [];

  const ASPECT = clamp(
    currentSample?.aspect || strokeSamples[0]?.aspect || (16 / 9),
    0.55,
    2.4
  );

  // 16:9 등방성 화면 공간에서 누적 호 길이(cumArc) 산출
  const cumArc = [0];
  let impactArc = null;

  for (let i = 1; i < strokeSamples.length; i++) {
    const p0 = strokeSamples[i - 1];
    const p1 = strokeSamples[i];
    const dhx = (p1.clubHead.x - p0.clubHead.x) * ASPECT;
    const dhy = p1.clubHead.y - p0.clubHead.y;
    const dgx = (p1.grip.x - p0.grip.x) * ASPECT;
    const dgy = p1.grip.y - p0.grip.y;
    const stepArc = Math.hypot(dhx, dhy) + Math.hypot(dgx, dgy) * 0.30;
    const nextArc = cumArc[i - 1] + stepArc;
    cumArc.push(nextArc);

    if (
      impactTime !== null &&
      impactArc === null &&
      p0.time <= impactTime &&
      p1.time >= impactTime
    ) {
      const uImp = p1.time > p0.time ? clamp((impactTime - p0.time) / (p1.time - p0.time), 0, 1) : 0;
      impactArc = cumArc[i - 1] + stepArc * uImp;
    }
  }

  const totalArc = cumArc.at(-1) || 0;
  if (totalArc < 0.024) return [];

  // 사용자가 설정한 스트로보 밀도(1~8)에 따른 고정 호 간격(deltaArc)
  const deltaArc = clamp(0.030 * Math.max(1, Number(strobeStep || 2)), 0.026, 0.20);
  // 현재 휘두르고 있는 본체 클럽과 겹치거나 앞서 나가지 않도록 후방 이격 거리 확보
  const minClearance = Math.max(deltaArc * 0.48, 0.024);
  const maxAllowedArc = totalArc - minClearance;
  if (maxAllowedArc < 0) return [];

  // 현재 클럽 직후방(maxAllowedArc)에서 시작하여 궤도 꼬리(0) 방향으로 일정한 호 간격(deltaArc)마다 잔상을 배치함으로써,
  // 잔상 지속 시간(궤도 길이)을 늘릴 때 기존 잔상이 흔들리지 않고 꼬리 쪽으로 잔상 궤도가 자연스럽게 길어지도록 구성
  const targetArcs = [];
  for (let a = maxAllowedArc; a >= -1e-5; a -= deltaArc) {
    targetArcs.unshift(Math.max(0, a));
  }

  const uniformClubs = [];
  let segIdx = 0;
  const dirSign = (hand === 'left' && !isDTL) ? -1 : 1;
  const currAngle = currentSample?.clubHead?.shaftAngle;
  // 최소 후방 각도 이격치 (~4.9° = 0.085 rad): 피니시 헤드 위치까지 촘촘히 뒤따르되 현재 골프채 앞으로는 절대 넘지 않도록 보장
  const minAngularLagRad = 0.085;

  for (const targetArc of targetArcs) {
    while (segIdx < cumArc.length - 2 && cumArc[segIdx + 1] < targetArc) {
      segIdx++;
    }

    const a0 = cumArc[segIdx];
    const a1 = cumArc[segIdx + 1];
    const u = a1 > a0 ? clamp((targetArc - a0) / (a1 - a0), 0, 1) : 0;

    const s0 = strokeSamples[segIdx];
    const s1 = strokeSamples[segIdx + 1];

    const gx = s0.grip.x + (s1.grip.x - s0.grip.x) * u;
    const gy = s0.grip.y + (s1.grip.y - s0.grip.y) * u;

    const dx0 = (s0.clubHead.x - s0.grip.x) * ASPECT;
    const dy0 = s0.clubHead.y - s0.grip.y;
    const dx1 = (s1.clubHead.x - s1.grip.x) * ASPECT;
    const dy1 = s1.clubHead.y - s1.grip.y;

    const len0 = Math.hypot(dx0, dy0);
    const len1 = Math.hypot(dx1, dy1);
    const interpLenY = len0 + (len1 - len0) * u;

    const hasUnwrapped0 = Number.isFinite(s0.clubHead.shaftAngle);
    const hasUnwrapped1 = Number.isFinite(s1.clubHead.shaftAngle);
    let ang0, ang1;
    if (hasUnwrapped0 && hasUnwrapped1) {
      ang0 = s0.clubHead.shaftAngle;
      ang1 = s1.clubHead.shaftAngle;
    } else {
      ang0 = Math.atan2(dy0, dx0);
      ang1 = Math.atan2(dy1, dx1);
      while (ang1 - ang0 > Math.PI) ang1 -= Math.PI * 2;
      while (ang1 - ang0 < -Math.PI) ang1 += Math.PI * 2;
    }
    const interpAngle = ang0 + (ang1 - ang0) * u;

    // 순간 회전 각속도에 비례하는 카메라 셔터 모션 블러 각도 산출
    const dtSeg = Math.max(0.008, s1.time - s0.time);
    const angVel = (ang1 - ang0) / dtSeg;
    const shutterSpreadRad = clamp(angVel * 0.0040, -0.075, 0.075);

    const hx = gx + Math.cos(interpAngle) * (interpLenY / ASPECT);
    const hy = gy + Math.sin(interpAngle) * interpLenY;
    const interpTime = s0.time + (s1.time - s0.time) * u;
    const face0 = s0.clubHead.faceOpenDeg ?? 0;
    const face1 = s1.clubHead.faceOpenDeg ?? 0;
    const interpFaceOpen = face0 + (face1 - face0) * u;
    const fs0 = s0.clubHead.foreshorten ?? 1.0;
    const fs1 = s1.clubHead.foreshorten ?? 1.0;
    const interpForeshorten = Number((fs0 + (fs1 - fs0) * u).toFixed(3));

    // 1) 시간적 후방 검증: 현재 프레임 시간보다 항상 과거(최소 14ms 이전)여야 함
    if (currentSample && interpTime >= currentSample.time - 0.014) continue;

    // 2) 공간적 후방 이격 검증: 현재 본체 클럽 헤드와 겹치지 않도록 최소 이격 거리 보장
    if (currentSample?.clubHead) {
      const distToCurr = Math.hypot(
        (hx - currentSample.clubHead.x) * ASPECT,
        hy - currentSample.clubHead.y
      );
      if (distToCurr < Math.max(deltaArc * 0.44, 0.022)) continue;
    }

    // 3) 기하학적 회전 각도 후방 추종(Strict Angular Trailing) 검증:
    if (Number.isFinite(currAngle)) {
      const angleDiff = interpAngle - currAngle;
      if (isBackswingPhase) {
        if (angleDiff * dirSign > -minAngularLagRad) continue;
      } else {
        if (-angleDiff * dirSign > -minAngularLagRad) continue;
      }
    }

      uniformClubs.push({
      time: interpTime,
      rawArc: targetArc,
      progress: maxAllowedArc > 1e-4 ? clamp(targetArc / maxAllowedArc, 0, 1) : 1,
      grip: { x: gx, y: gy },
      clubHead: {
        x: hx,
        y: hy,
        shaftAngle: interpAngle,
        faceOpenDeg: interpFaceOpen,
        foreshorten: interpForeshorten,
        shutterSpreadRad
      }
    });
  }

  // 실제 골프 샤프트 위치와 가장 가까운 잔상(배열 마지막)은 근접도(progress)가 1.0이 되고,
  // 실제 샤프트에서 멀어질수록(배열 앞쪽 꼬리 방향) 근접도가 0.0으로 연속 감소하도록 정규화
  const count = uniformClubs.length;
  if (count === 1) {
    const only = uniformClubs[0];
    const angLag = Number.isFinite(currAngle) ? Math.abs(only.clubHead.shaftAngle - currAngle) : minAngularLagRad;
    only.progress = clamp(1.0 - (angLag - minAngularLagRad) / 1.25, 0.72, 1.0);
  } else if (count >= 2) {
    const maxArcInList = Math.max(1e-4, uniformClubs[count - 1].rawArc);
    const minArcInList = count >= 3 ? uniformClubs[0].rawArc : 0;
    const arcSpan = Math.max(1e-4, maxArcInList - minArcInList);
    for (let i = 0; i < count; i++) {
      const normArc = clamp((uniformClubs[i].rawArc - minArcInList) / arcSpan, 0, 1);
      const normIdx = i / (count - 1);
      uniformClubs[i].progress = clamp(0.55 * normArc + 0.45 * normIdx, 0, 1);
    }
  }

  return uniformClubs;
}

/**
 * 골프채를 강하게 휘두를 때 샤프트에 조명이 반사되어 원형의 선이 흐릿하게 지나간 것처럼 보이는
 * `((` 모양의 다중 원호 빛반사 스트리크(Specular Shaft Glint Arcs)를 렌더링합니다.
 * - 1구간 (손을 조금 지나서): 그립에서 샤프트 길이의 약 25%~32% 지점에 작은 `((` 원형 빛반사 선 배치
 * - 2구간 (헤드 바로 앞쪽): 클럽헤드 바로 앞쪽 샤프트(약 75%~87% 지점)에 조금 더 큰 사이즈와 두께로 `((` 원형 빛반사 선 배치
 */
function renderShaftSpecularGlintArcs(ctx, width, height, pathSamples, currentSample, opts, isBackswingPhase, hand = 'right', isDTL = false) {
  const valid = (pathSamples || []).filter(s => s?.grip && s?.clubHead);
  if (valid.length < 2) return;

  const ASPECT = width / Math.max(1, height);
  const dirSign = (hand === 'left' && !isDTL) ? -1 : 1;

  // 각 샘플의 연속 언래핑된 샤프트 각도 및 픽셀 길이 계산
  const nodes = [];
  for (let i = 0; i < valid.length; i++) {
    const s = valid[i];
    const gx = s.grip.x;
    const gy = s.grip.y;
    const dxNorm = (s.clubHead.x - gx) * ASPECT;
    const dyNorm = s.clubHead.y - gy;
    const lenY = Math.hypot(dxNorm, dyNorm);
    let ang = Number.isFinite(s.clubHead.shaftAngle)
      ? s.clubHead.shaftAngle
      : Math.atan2(dyNorm, dxNorm);

    if (nodes.length > 0 && !Number.isFinite(s.clubHead.shaftAngle)) {
      const prevAng = nodes[nodes.length - 1].ang;
      while (ang - prevAng > Math.PI) ang -= Math.PI * 2;
      while (ang - prevAng < -Math.PI) ang += Math.PI * 2;
    }

    nodes.push({
      time: s.time,
      gx,
      gy,
      lenY,
      ang
    });
  }

  const lastNode = nodes[nodes.length - 1];
  const currAngle = Number.isFinite(currentSample?.clubHead?.shaftAngle)
    ? currentSample.clubHead.shaftAngle
    : lastNode.ang;

  // `((` 괄호 형태의 원호 느낌을 살리기 위해 현재 샤프트 직후방 일정 회전 각도 범위(약 45° ~ 95°)만 추출
  const dur = clamp(Number(opts.trailDurationSec ?? 1.80), 0.15, 2.20);
  const maxGlintSpanRad = clamp(0.72 + dur * 0.48, 0.75, 1.62);
  const minLeadClearanceRad = 0.045;

  const glintNodes = nodes.filter(n => {
    const diff = n.ang - currAngle;
    const lag = isBackswingPhase ? (-diff * dirSign) : (diff * dirSign);
    return lag >= minLeadClearanceRad && lag <= maxGlintSpanRad;
  });

  // 만약 필터링된 노드가 적으면 최근 노드 구간에서 보간할 수 있도록 시작점 보강
  if (glintNodes.length < 2) {
    const n0 = nodes[Math.max(0, nodes.length - 2)];
    const n1 = nodes[nodes.length - 1];
    if (Math.abs(n1.ang - n0.ang) < 0.04) return;
    glintNodes.length = 0;
    glintNodes.push(n0, n1);
  }

  // 누적 회전 호 길이 산출
  const cumArc = [0];
  for (let i = 1; i < glintNodes.length; i++) {
    const p0 = glintNodes[i - 1];
    const p1 = glintNodes[i];
    const dAng = Math.abs(p1.ang - p0.ang) * 0.25;
    const dGrip = Math.hypot((p1.gx - p0.gx) * ASPECT, p1.gy - p0.gy) * 0.45;
    cumArc.push(cumArc[i - 1] + Math.max(1e-4, dAng + dGrip));
  }

  const totalArc = cumArc[cumArc.length - 1] || 0;
  if (totalArc < 0.02) return;

  // 다각형 각짐이 전혀 없는 완벽한 원형 곡선을 위해 64단계 고밀도 극좌표 보간 수행
  const DENSE_STEPS = 64;
  const denseFrames = [];
  let seg = 0;
  for (let k = 0; k <= DENSE_STEPS; k++) {
    const targetArc = (k / DENSE_STEPS) * totalArc;
    while (seg < cumArc.length - 2 && cumArc[seg + 1] < targetArc) {
      seg++;
    }
    const a0 = cumArc[seg];
    const a1 = cumArc[seg + 1];
    const u = a1 > a0 ? clamp((targetArc - a0) / (a1 - a0), 0, 1) : 0;
    const n0 = glintNodes[seg];
    const n1 = glintNodes[seg + 1];

    denseFrames.push({
      uNorm: k / DENSE_STEPS, // 0.0(꼬리 끝단) -> 1.0(현재 샤프트 직후방)
      gx: n0.gx + (n1.gx - n0.gx) * u,
      gy: n0.gy + (n1.gy - n0.gy) * u,
      lenY: n0.lenY + (n1.lenY - n0.lenY) * u,
      ang: n0.ang + (n1.ang - n0.ang) * u
    });
  }

  // 그립 중심 궤적을 한 번 더 스무딩하여 동심 원호의 곡률을 매끄럽게 정돈
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 1; k < DENSE_STEPS; k++) {
      denseFrames[k].gx = (denseFrames[k - 1].gx + denseFrames[k].gx * 2 + denseFrames[k + 1].gx) * 0.25;
      denseFrames[k].gy = (denseFrames[k - 1].gy + denseFrames[k].gy * 2 + denseFrames[k + 1].gy) * 0.25;
    }
  }

  const ribbonW = clamp(Number(opts.ribbonWidth || 3), 2, 14);
  const widthScale = ribbonW / 4.0;
  const ghostOp = clamp(Number(opts.ghostOpacity ?? 0.85), 0.15, 1.0);
  const gripFade = clamp(Number(opts.gripFade ?? 0.50), 0.0, 1.0);

  // 손 쪽 샤프트 투명도(gripFade) 설정에 맞춰 제1구간(`((` 빛반사)의 반경 위치를
  // 손 바로 위(0.255~0.312)에서 샤프트 중앙이 서서히 나타나기 시작하는 지점(0.49~0.55)으로 연동 이동하고,
  // 축 방향 알파(computeShaftAxialAlpha)를 반영하여 투명한 손 영역에는 하얀 잔상 선이 남지 않도록 처리
  const innerR1 = 0.255 + 0.235 * gripFade;
  const innerR2 = 0.312 + 0.238 * gripFade;
  const innerAxial1 = clamp(0.42 + 0.58 * computeShaftAxialAlpha(innerR1, gripFade * 0.85), 0.18, 1.0);
  const innerAxial2 = clamp(0.45 + 0.55 * computeShaftAxialAlpha(innerR2, gripFade * 0.85), 0.22, 1.0);

  // 두 구간 정의:
  // 1) 손을 지나 샤프트가 보이기 시작하는 중앙부 -> 컴팩트한 `((` 이중 원형 빛반사 선
  // 2) 헤드 바로 앞쪽 (rFrac: 0.758, 0.814, 0.868) -> 조금 더 큰 사이즈·호 길이·두께의 선명한 `((` 원형 빛반사 선
  const glintStreaks = [
    // [구간 1] 손을 조금 지나 샤프트 중앙부 (`((` 모양)
    { rFrac: innerR1, uStart: 0.28, uEnd: 0.92, baseThick: 1.55 * widthScale, intensity: 0.76 * innerAxial1 },
    { rFrac: innerR2, uStart: 0.16, uEnd: 0.97, baseThick: 2.15 * widthScale, intensity: 0.92 * innerAxial2 },

    // [구간 2] 헤드 바로 앞쪽에 조금 더 큰 사이즈로 (`((` 모양, 100% 선명 영역)
    { rFrac: 0.758, uStart: 0.18, uEnd: 0.90, baseThick: 2.25 * widthScale, intensity: 0.76 },
    { rFrac: 0.814, uStart: 0.08, uEnd: 0.96, baseThick: 3.10 * widthScale, intensity: 0.96 },
    { rFrac: 0.868, uStart: 0.00, uEnd: 1.00, baseThick: 3.95 * widthScale, intensity: 1.12 }
  ];

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const streak of glintStreaks) {
    const pts = [];
    for (let k = 0; k <= DENSE_STEPS; k++) {
      const f = denseFrames[k];
      if (f.uNorm < streak.uStart - 0.01 || f.uNorm > streak.uEnd + 0.01) continue;
      const localU = clamp((f.uNorm - streak.uStart) / Math.max(0.05, streak.uEnd - streak.uStart), 0, 1);

      const rY = f.lenY * streak.rFrac;
      const px = (f.gx + Math.cos(f.ang) * (rY / ASPECT)) * width;
      const py = (f.gy + Math.sin(f.ang) * rY) * height;
      pts.push({ px, py, localU });
    }

    if (pts.length < 3) continue;

    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const uMid = (p0.localU + p1.localU) * 0.5;

      // 양 끝단(0.0, 1.0)은 뾰족하고 흐릿하게 사라지고, 실제 샤프트에 가까운 전면부(uMid ~ 0.68)가 가장 밝게 빛나는 초승달(`(`) 엔벨로프
      const crescent = Math.sin(Math.PI * Math.pow(uMid, 0.68));
      const nearShaftBoost = 0.30 + 0.70 * Math.pow(uMid, 0.55);
      const env = Math.pow(Math.max(0, crescent), 1.35) * nearShaftBoost;
      if (env < 0.015) continue;

      // 1층: 흐릿하게 번지는 빛반사 외곽 광채 (Soft Optical Blur Halo)
      const haloAlpha = clamp(0.18 * ghostOp * streak.intensity * env, 0.005, 0.34);
      ctx.strokeStyle = `rgba(226, 240, 255, ${haloAlpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(1.2, streak.baseThick * 3.5 * (0.22 + 0.78 * env));
      ctx.beginPath();
      ctx.moveTo(p0.px, p0.py);
      ctx.lineTo(p1.px, p1.py);
      ctx.stroke();

      // 2층: 부드러운 반사광 중간 결 (Diffused Specular Sheen)
      const midAlpha = clamp(0.42 * ghostOp * streak.intensity * env, 0.010, 0.64);
      ctx.strokeStyle = `rgba(248, 251, 255, ${midAlpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(0.8, streak.baseThick * 1.75 * (0.18 + 0.82 * env));
      ctx.beginPath();
      ctx.moveTo(p0.px, p0.py);
      ctx.lineTo(p1.px, p1.py);
      ctx.stroke();

      // 3층: 선명한 하이라이트 코어 원형 선 (Specular Core Highlight)
      const coreAlpha = clamp(0.84 * ghostOp * streak.intensity * Math.pow(env, 0.82), 0.015, 0.96);
      ctx.strokeStyle = `rgba(255, 255, 255, ${coreAlpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(0.5, streak.baseThick * 0.62 * (0.15 + 0.85 * env));
      ctx.beginPath();
      ctx.moveTo(p0.px, p0.py);
      ctx.lineTo(p1.px, p1.py);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * 어드레스 시점에 인식된 실제 골프채의 샤프트·헤드 다중 노출 잔상(Stroboscopic Address-Club Afterimage) 및
 * 선택적 궤적 가이드·스켈레톤·HUD를 캔버스 컨텍스트(ctx)에 렌더링합니다.
 * 어떤 경우에도 잔상이 현재 골프채 위치보다 앞서 표현되지 않고 반드시 뒤따르도록(Trailing) 보장합니다.
 */
export function renderSwingAfterimageOverlay(ctx, width, height, state, currentTime, overrideOptions = {}) {
  const samples = state.samples || [];
  if (!samples.length) return;

  const opts = {
    ...state.renderOptions,
    ...overrideOptions
  };

  const momentsMap = Object.fromEntries(
    (state.keyMoments || []).map(m => [m.key, m.time])
  );
  const addrTime = momentsMap.address ?? samples[0]?.time ?? 0.45;
  const topTime = momentsMap.top ?? 1.45;
  const impactTime = momentsMap.impact ?? 1.78;

  const addrSample = interpolateSampleAtTime(samples, addrTime) || findNearestSample(samples, addrTime);
  const currentSample = interpolateSampleAtTime(samples, currentTime) || findNearestSample(samples, currentTime);
  const isDTL = state.demoPreset === 'iron-dtl';
  const clubType = isDTL ? 'iron' : 'driver';
  const addressClub = state.addressClub || null;
  const gripFade = clamp(Number(opts.gripFade ?? 0.50), 0.0, 1.0);

  // 어드레스 기준 샤프트 픽셀 길이
  const refLengthPx = addressClub?.shaftLengthPx
    ? Math.max(addressClub.shaftLengthPx, height * 0.265)
    : height * (clubType === 'iron' ? 0.268 : 0.278);

  // 1) 백스윙 시(currentTime <= topTime): 어드레스 ~ 현재 시점까지만 백스윙 잔상 표시
  // 2) 다운스윙 이후(currentTime > topTime): 백스윙 탑(topTime) ~ 현재 시점(피니시 머리 통과 이후 포함)까지 잔상 표시
  // 3) 잔상 지속 시간(trailDurationSec) 슬라이더를 늘리거나 줄이면 기본('full') 및 'comet' 모드 모두에서
  //    즉각 잔상 궤도의 시간 폭과 회전 원호 길이(maxOrbitRad)가 비례하여 길어지거나 짧아지도록 연동
  const isBackswingPhase = currentTime <= topTime + 0.002;
  const dur = clamp(Number(opts.trailDurationSec ?? 1.80), 0.15, 2.20);
  const isAllSwingScope = opts.trailScope === 'all-swing';
  let strokeStart = addrTime;
  const strokeEnd = currentTime;

  if (isBackswingPhase) {
    strokeStart = isAllSwingScope
      ? addrTime
      : Math.max(addrTime, currentTime - dur);
  } else {
    strokeStart = isAllSwingScope
      ? topTime
      : Math.max(topTime, currentTime - dur);
  }

  // 잔상(Afterimage) 전용 후방 윈도우: 현재 골프채보다 최소 16ms 이전(trailEndTime) 및 회전 각도상 뒤쪽(Trailing)에 있는 샘플만 수집
  const trailLagSec = 0.016;
  const trailEndTime = Math.max(strokeStart, strokeEnd - trailLagSec);
  const dirSign = (state.hand === 'left' && !isDTL) ? -1 : 1;
  const currAngle = currentSample?.clubHead?.shaftAngle;

  // 잔상 지속 시간(trailDurationSec)에 비례하여 잔상 궤도의 최대 회전 원호 길이(maxOrbitRad)를 직접 제어
  const maxOrbitRad = isAllSwingScope
    ? Math.PI * 2.55
    : clamp(dur * 3.85, 0.45, Math.PI * 2.55);

  const isSampleStrictlyBehindCurrent = s => {
    if (!s?.clubHead || !Number.isFinite(currAngle)) return true;
    const diff = s.clubHead.shaftAngle - currAngle;
    if (isBackswingPhase) {
      const angularLag = -diff * dirSign;
      return angularLag >= 0.05 && angularLag <= maxOrbitRad;
    }
    const angularLag = diff * dirSign;
    return angularLag >= 0.05 && angularLag <= maxOrbitRad;
  };

  // 어드레스(01 어드레스)는 스윙이 시작되기 전의 정지 자세이므로 잔상이 생길 수 없음.
  const isAtOrBeforeAddress = currentTime <= addrTime + 0.025;

  const windowSamples = [];
  if (!isAtOrBeforeAddress && strokeEnd > strokeStart + trailLagSec) {
    // 슬라이더 조작 시 0.05초 단위로도 궤도 시작점이 매끄럽게 늘어나도록 strokeStart 보간 샘플을 선두에 추가
    const startSample = interpolateSampleAtTime(samples, strokeStart);
    if (startSample && isSampleStrictlyBehindCurrent(startSample)) {
      windowSamples.push(startSample);
    }

    for (const s of samples) {
      if (s.time >= strokeStart - 0.002 && s.time <= trailEndTime + 0.001 && isSampleStrictlyBehindCurrent(s)) {
        if (!windowSamples.length || Math.abs(windowSamples.at(-1).time - s.time) > 0.002) {
          windowSamples.push(s);
        }
      }
    }

    const tailSample = interpolateSampleAtTime(samples, trailEndTime);
    if (tailSample && isSampleStrictlyBehindCurrent(tailSample)) {
      if (!windowSamples.length || Math.abs(windowSamples.at(-1).time - tailSample.time) > 0.002) {
        windowSamples.push(tailSample);
      }
    }
  }

  // 궤도 가이드라인용 샘플 배열 (스윙 시작 후 strokeStart ~ 현재 클럽 위치까지만 연결)
  const pathSamples = isAtOrBeforeAddress ? [] : windowSamples.slice();
  if (!isAtOrBeforeAddress && currentSample && strokeEnd >= strokeStart) {
    pathSamples.push(currentSample);
  }

  ctx.save();

  // 1) 어드레스 기준 스윙 플레인(Shaft Plane) 가이드라인
  if (opts.showSwingPlane && addrSample?.grip && addrSample?.clubHead) {
    const gx = addrSample.grip.x * width;
    const gy = addrSample.grip.y * height;
    const hx = addrSample.clubHead.x * width;
    const hy = addrSample.clubHead.y * height;

    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.24)';
    const dx = hx - gx;
    const dy = hy - gy;
    ctx.beginPath();
    ctx.moveTo(hx + dx * 0.18, hy + dy * 0.18);
    ctx.lineTo(gx - dx * 2.1, gy - dy * 2.1);
    ctx.stroke();
    ctx.restore();
  }

  // 2) 고정 이정표 스트로보 다중 클럽 잔상 (손에 가까울수록 투명하고 샤프트 중앙부터 서서히 나타나 헤드 쪽으로 갈수록 선명해짐)
  if (!isAtOrBeforeAddress && opts.showStrobeGhosts && windowSamples.length >= 2) {
    const ghostOp = clamp(Number(opts.ghostOpacity ?? 0.85), 0.15, 1.0);

    // 임팩트(스퀘어 0°) 앵커 및 엄격한 후방 각도 필터가 적용된 스트로보 다중 클럽 잔상 생성
    const uniformStrobeClubs = buildUniformArcStrobeClubs(
      pathSamples,
      opts.strobeStep || 2,
      currentSample,
      isBackswingPhase,
      state.hand,
      isDTL,
      isBackswingPhase ? null : impactTime
    );

    // 실제 골프 샤프트 위치와 가까울수록(prox -> 1.0) 설정된 최대 불투명도(peakAlpha, 최대 100%)로 진하게 표현하고,
    // 실제 골프 샤프트에서 멀어질수록(prox -> 0.0) 꼬리 쪽으로 자연스럽게 페이드아웃(tailMinAlpha)되도록 감쇠 곡선 적용
    const isComet = opts.trailScope === 'comet';
    const peakAlpha = clamp(Math.pow(ghostOp, 0.55) * 1.06, 0.22, 1.0);
    const tailMinAlpha = isComet
      ? clamp(0.02 + 0.03 * ghostOp, 0.02, 0.05)
      : isAllSwingScope
        ? clamp(0.10 + 0.12 * ghostOp, 0.10, 0.22)
        : clamp(0.03 + 0.05 * ghostOp, 0.03, 0.08);
    const fadeGamma = isComet ? 2.25 : (isAllSwingScope ? 1.35 : 1.65);

    for (let i = 0; i < uniformStrobeClubs.length; i++) {
      const g = uniformStrobeClubs[i];
      const prox = clamp(g.progress ?? 0, 0, 1);
      const fadeWeight = Math.pow(prox, fadeGamma);
      const alpha = clamp(tailMinAlpha + (peakAlpha - tailMinAlpha) * fadeWeight, 0.03, 1.0);

      drawRealisticGolfClub(
        ctx,
        g.grip.x * width,
        g.grip.y * height,
        g.clubHead.x * width,
        g.clubHead.y * height,
        {
          alpha,
          clubType,
          hand: state.hand,
          faceOpenDeg: g.clubHead.faceOpenDeg ?? 0,
          addressClub,
          isGhost: true,
          shutterSpreadRad: 0,
          refLengthPx,
          gripFade
        }
      );
    }
  }

  // 2-B) 체크박스로 켜고 끌 수 있는 샤프트 빛반사 `((` 원형 궤적 효과 (손을 조금 지나서 + 헤드 바로 앞쪽에 조금 더 큰 사이즈)
  if (!isAtOrBeforeAddress && (opts.showShaftGlint ?? true) && pathSamples.length >= 2) {
    renderShaftSpecularGlintArcs(
      ctx,
      width,
      height,
      pathSamples,
      currentSample,
      opts,
      isBackswingPhase,
      state.hand,
      isDTL
    );
  }

  // (c) 현재 프레임의 골프채 본체 및 파지 장갑
  // 실제 영상(isVideoSource) 모드에서는 원본 비디오에 이미 골퍼의 손과 그립이 존재하므로,
  // 현재 프레임 클럽 오버레이에도 gripFade를 동일하게 적용하여 손 위가 하얗게 가려지지 않고 중앙→헤드로 선명하게 이어지도록 처리
  const isVideoSource = state.sourceMode === 'video' || state.sourceType === 'video';
  const shouldDrawCurrentClub =
    currentSample?.grip &&
    currentSample?.clubHead &&
    !(isVideoSource && isAtOrBeforeAddress);

  if (shouldDrawCurrentClub) {
    const cgx = currentSample.grip.x * width;
    const cgy = currentSample.grip.y * height;
    const chx = currentSample.clubHead.x * width;
    const chy = currentSample.clubHead.y * height;

    drawRealisticGolfClub(
      ctx,
      cgx,
      cgy,
      chx,
      chy,
      {
        alpha: 1.0,
        clubType,
        hand: state.hand,
        faceOpenDeg: currentSample.clubHead.faceOpenDeg ?? 0,
        addressClub,
        isGhost: isVideoSource,
        shutterSpreadRad: 0,
        refLengthPx,
        gripFade: isVideoSource ? gripFade : 0
      }
    );

    if (!isVideoSource) {
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = Math.max(1.5, height * 0.0028);
      ctx.beginPath();
      ctx.arc(cgx, cgy, Math.max(3.5, height * 0.0078), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // 3) 그립(손목) 경로 점선 트레일 (손 쪽 샤프트 투명도가 100%일 때는 손 주변이 완전히 투명하게 비워지도록 감쇠)
  const handPathVisibility = clamp(1.0 - gripFade * 0.95, 0, 1);
  if (opts.showHandPath && handPathVisibility > 0.02 && pathSamples.length >= 2) {
    ctx.save();
    ctx.lineCap = 'butt';
    const gripPts = pathSamples.filter(s => s.grip);
    if (gripPts.length >= 2) {
      const baseW = clamp(Number(opts.ribbonWidth || 3), 2, 14);
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = clamp(1.0 + (baseW - 2) * 0.18, 1.0, 3.2);
      for (let i = 1; i < gripPts.length; i++) {
        const p0 = gripPts[i - 1].grip;
        const p1 = gripPts[i].grip;
        const prox = i / (gripPts.length - 1);
        const segAlpha = clamp((0.03 + 0.42 * Math.pow(prox, 1.55)) * handPathVisibility, 0.01, 0.45);
        ctx.strokeStyle = `rgba(15, 23, 42, ${segAlpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(p0.x * width, p0.y * height);
        ctx.lineTo(p1.x * width, p1.y * height);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 4) 선택적 클럽 헤드 보조 컬러 궤적 선 (고밀도 극좌표 원호 보간으로 매끄럽게 연결하며 보조 궤적 선 두께가 즉시 반영됨)
  if (opts.showClubRibbon && pathSamples.length >= 2) {
    const rawHeadPoints = pathSamples
      .filter(s => s.clubHead)
      .map(s => ({
        x: s.clubHead.x * width,
        y: s.clubHead.y * height,
        time: s.time,
        speed: s.clubSpeed ?? 50,
        phase: resolveSwingPhaseSegment(s.time, momentsMap)
      }));

    const smoothPoints = interpolateCatmullRom(rawHeadPoints, 8);
    const totalPts = Math.max(1, smoothPoints.length - 1);
    const baseWidth = Number(opts.ribbonWidth || 3);

    for (let i = 1; i < smoothPoints.length; i++) {
      const p0 = smoothPoints[i - 1];
      const p1 = smoothPoints[i];
      const progress = opts.trailScope === 'all-swing'
        ? clamp(0.25 + 0.70 * (i / totalPts), 0.25, 0.95)
        : Math.pow(i / totalPts, 1.55);

      const segColor = SEGMENT_COLORS[p1.phase] || '#0F172A';

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineCap = 'round';
      ctx.strokeStyle = segColor;
      ctx.globalAlpha = clamp(progress * 0.65, 0.08, 0.72);
      ctx.lineWidth = baseWidth * (0.4 + 0.6 * progress);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 수동 보정 핀이 찍힌 프레임인 경우 헤드 위에 미세 타깃 표시
  if (currentSample?.clubHead?.pinned) {
    const chx = currentSample.clubHead.x * width;
    const chy = currentSample.clubHead.y * height;
    ctx.save();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(chx, chy, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 5) 관절 스켈레톤 및 각도 오버레이 (REA review.js drawPose 복원)
  if (opts.showSkeleton && currentSample?.points) {
    const pts = currentSample.points;
    ctx.save();
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';

    for (const [a, b] of CONNECTIONS) {
      if (!visible(pts[a], 0.4) || !visible(pts[b], 0.4)) continue;
      ctx.beginPath();
      ctx.moveTo(pts[a].x * width, pts[a].y * height);
      ctx.lineTo(pts[b].x * width, pts[b].y * height);
      ctx.stroke();
    }

    for (const idx of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const p = pts[idx];
      if (!visible(p, 0.4)) continue;
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(p.x * width, p.y * height, 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (opts.showAngles) {
      const m = measurements(pts, width, height, state.hand);
      const side = state.hand === 'right' ? 0 : 1;
      const jointLabels = [
        ['elbow', 13 + side],
        ['knee', 25 + side]
      ];
      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
      for (const [key, jIdx] of jointLabels) {
        if (!Number.isFinite(m[key]) || !visible(pts[jIdx], 0.4)) continue;
        const jx = pts[jIdx].x * width;
        const jy = pts[jIdx].y * height - 12;
        const text = `${Math.round(m[key])}°`;
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(jx - tw / 2 - 6, jy - 13, tw + 12, 18, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#0F172A';
        ctx.textAlign = 'center';
        ctx.fillText(text, jx, jy);
      }
    }
    ctx.restore();
  }

  // 6) 상단 HUD 데이터 마크
  if (opts.showHud !== false && currentSample) {
    const m = measurements(currentSample.points, width, height, state.hand);
    const tempoInfo = calculateTempo(momentsMap);
    const activePhase = findActiveMomentBadge(currentTime, state.keyMoments);

    ctx.save();
    const pad = Math.max(14, Math.round(width * 0.02));
    const boxH = 44;
    const boxW = Math.min(width - pad * 2, 585);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(pad, pad, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.font = '700 13px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
    ctx.fillStyle = '#0F172A';
    ctx.textBaseline = 'middle';
    const cy = pad + boxH / 2;

    const phaseText = activePhase ? `${activePhase.labelKo} (${activePhase.labelEn})` : '스윙 궤적 분석';
    ctx.fillText(phaseText, pad + 14, cy);

    const faceDeg = Math.round(currentSample.clubHead?.faceOpenDeg ?? 0);
    const faceStr = Math.abs(faceDeg) <= 4
      ? '헤드 스퀘어 0°'
      : (faceDeg > 0 ? `헤드 열림 +${faceDeg}°` : `헤드 닫힘 ${faceDeg}°`);
    const foreshortenPct = Math.round((currentSample.clubHead?.foreshorten ?? 1.0) * 100);
    const foreshortenStr = `3D 투영 길이 ${foreshortenPct}%`;

    ctx.font = '500 12px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
    ctx.fillStyle = '#475569';
    const tempoStr = tempoInfo ? `템포 ${tempoInfo.ratio.toFixed(1)}:1` : '템포 측정됨';
    const speedStr = currentSample.clubSpeed ? `${currentSample.clubSpeed} mph` : '';
    const summaryRight = [faceStr, foreshortenStr, tempoStr, speedStr].filter(Boolean).join('  |  ');

    ctx.textAlign = 'right';
    ctx.fillText(summaryRight, pad + boxW - 14, cy);
    ctx.restore();
  }

  ctx.restore();
}

function findActiveMomentBadge(time, keyMoments) {
  if (!keyMoments || !keyMoments.length) return null;
  let best = keyMoments[0];
  let minDiff = Math.abs(time - best.time);
  for (const m of keyMoments) {
    const d = Math.abs(time - m.time);
    if (d < minDiff) {
      minDiff = d;
      best = m;
    }
  }
  return best;
}

/**
 * 현재 시간(time)의 베이스 영상 프레임(실제 비디오 또는 프로 골퍼 스윙 영상 씬)과
 * 실제 골프채 다중 잔상 오버레이를 함께 캔버스에 그립니다.
 */
export function renderCompositeFrame(ctx, width, height, state, time, overrideOptions = {}) {
  ctx.clearRect(0, 0, width, height);
  const nearestSample = findNearestSample(state.samples, time) || state.samples[0];
  let effectiveTime = time;

  if (state.sourceMode === 'video' && state.videoElement && state.videoReady) {
    const video = state.videoElement;
    const isVideoSynced =
      video.readyState >= 2 &&
      !video.seeking &&
      Math.abs(video.currentTime - time) <= 0.085;

    if (isVideoSynced) {
      ctx.drawImage(video, 0, 0, width, height);
      effectiveTime = time;
    } else if (nearestSample?.frameCanvas) {
      // 비동기 시크 중이거나 초저속(0.1x) 재생 중일 때도 사전 디코딩된 실제 비디오 프레임을 끊김 없이 즉시 렌더링
      ctx.drawImage(nearestSample.frameCanvas, 0, 0, width, height);
      effectiveTime = time;
    } else {
      ctx.drawImage(video, 0, 0, width, height);
      effectiveTime = time;
    }
  } else {
    const interpSample = interpolateSampleAtTime(state.samples, time) || nearestSample;
    if (interpSample) {
      drawSynthesizedGolferScene(ctx, width, height, interpSample, state.demoPreset, state.addressClub, state.hand);
    }
  }

  renderSwingAfterimageOverlay(ctx, width, height, state, effectiveTime, overrideOptions);
}

// ============================================================================
// 스냅샷 1: 타임라인 현재 상태 및 단일 스트로보 다중 잔상 스냅샷 저장
// ============================================================================

export async function exportStrobeSnapshot(state, overrideOptions = {}) {
  const width = state.canvasWidth || 1280;
  const height = state.canvasHeight || 720;
  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;
  const ctx = offscreen.getContext('2d');

  const momentsMap = Object.fromEntries((state.keyMoments || []).map(m => [m.key, m.time]));
  const baseTime = Number.isFinite(state.currentTime)
    ? state.currentTime
    : (momentsMap.finish ?? momentsMap.impact ?? 1.78);

  if (state.sourceMode === 'video' && state.videoElement && state.videoReady) {
    await seekVideoSafely(state.videoElement, baseTime);
  }

  // 사용자가 타임라인을 조정해 맞춘 현재 시점(baseTime)과 잔상 설정(불투명도·지속시간·간격 등)을 그대로 렌더링하여 저장
  renderCompositeFrame(ctx, width, height, state, baseTime, {
    ...state.renderOptions,
    ...overrideOptions
  });

  const timeTag = `${baseTime.toFixed(2).replace('.', '_')}s`;
  const dataUrl = offscreen.toDataURL('image/png');
  triggerDownload(dataUrl, `golf-swing-snapshot-${timeTag}-${Date.now()}.png`);
  return dataUrl;
}

// ============================================================================
// 스냅샷 2: 7단계 스윙 시퀀스 파노라마 스냅샷
// ============================================================================

export async function exportSequencePanorama(state) {
  const cellW = 340;
  const cellH = 440;
  const gap = 12;
  const pad = 24;
  const headerH = 68;
  const footerH = 74;

  const moments = state.keyMoments?.length ? state.keyMoments : KEY_MOMENTS.map(([key, labelKo, labelEn], i) => ({
    key, labelKo, labelEn, time: i * 0.45
  }));

  const count = moments.length;
  const totalW = pad * 2 + cellW * count + gap * (count - 1);
  const totalH = headerH + cellH + footerH + pad;

  const panorama = document.createElement('canvas');
  panorama.width = totalW;
  panorama.height = totalH;
  const ctx = panorama.getContext('2d');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, totalW, totalH);

  const momentsMap = Object.fromEntries(moments.map(m => [m.key, m.time]));
  const tempoInfo = calculateTempo(momentsMap);
  ctx.fillStyle = '#0F172A';
  ctx.font = '700 20px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('GOLF SWING 7-STAGE SEQUENCE & REAL CLUB AFTERIMAGE PANORAMA', pad, 36);

  ctx.fillStyle = '#475569';
  ctx.font = '500 14px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
  ctx.textAlign = 'right';
  const rightMeta = tempoInfo
    ? `백스윙 ${tempoInfo.backswingSec.toFixed(2)}s · 다운스윙 ${tempoInfo.downswingSec.toFixed(2)}s · 스윙 템포 ${tempoInfo.ratio.toFixed(2)} : 1`
    : '실제 클럽 샤프트·헤드 다중 잔상 및 7단계 스윙 시퀀스 리포트';
  ctx.fillText(rightMeta, totalW - pad, 36);
  ctx.textAlign = 'left';

  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, headerH - 10);
  ctx.lineTo(totalW - pad, headerH - 10);
  ctx.stroke();

  const srcW = state.canvasWidth || 960;
  const srcH = state.canvasHeight || 540;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = srcW;
  tempCanvas.height = srcH;
  const tempCtx = tempCanvas.getContext('2d');

  for (let i = 0; i < count; i++) {
    const m = moments[i];
    const x = pad + i * (cellW + gap);
    const y = headerH;

    if (state.sourceMode === 'video' && state.videoElement && state.videoReady) {
      await seekVideoSafely(state.videoElement, m.time);
    }

    renderCompositeFrame(tempCtx, srcW, srcH, state, m.time, {
      ...state.renderOptions,
      trailScope: state.renderOptions?.trailScope ?? 'full',
      showStrobeGhosts: state.renderOptions?.showStrobeGhosts ?? true,
      strobeStep: state.renderOptions?.strobeStep ?? 2,
      ghostOpacity: state.renderOptions?.ghostOpacity ?? 0.85,
      gripFade: state.renderOptions?.gripFade ?? 0.50,
      showSkeleton: state.renderOptions?.showSkeleton ?? false,
      showAngles: false,
      showHud: false
    });

    const sampleAtM = interpolateSampleAtTime(state.samples, m.time) || findNearestSample(state.samples, m.time);
    const focusX = sampleAtM?.clubHead
      ? clamp(0.46 * 0.55 + sampleAtM.clubHead.x * 0.45, 0.35, 0.62)
      : 0.46;

    const cropAspect = cellW / cellH;
    const srcAspect = srcW / srcH;
    let sx = 0, sy = 0, sw = srcW, sh = srcH;
    if (srcAspect > cropAspect) {
      sw = srcH * cropAspect;
      sx = clamp(focusX * srcW - sw * 0.5, 0, srcW - sw);
    } else {
      sh = srcW / cropAspect;
      sy = (srcH - sh) * 0.5;
    }

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, cellW, cellH, 6);
    ctx.clip();
    ctx.drawImage(tempCanvas, sx, sy, sw, sh, x, y, cellW, cellH);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.fillRect(x, y, cellW, 38);
    ctx.fillStyle = MOMENT_COLORS[m.key] || '#0F172A';
    ctx.fillRect(x, y, 5, 38);

    ctx.fillStyle = '#0F172A';
    ctx.font = '700 13px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
    ctx.fillText(`0${i + 1}  ${m.labelKo} (${m.labelEn})`, x + 14, y + 20);

    ctx.fillStyle = '#64748B';
    ctx.font = '500 12px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${m.time.toFixed(2)}s`, x + cellW - 12, y + 20);
    ctx.textAlign = 'left';
    ctx.restore();

    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, cellW, cellH, 6);
    ctx.stroke();

    const sample = findNearestSample(state.samples, m.time);
    const meas = measurements(sample?.points, srcW, srcH, state.hand);
    const fy = y + cellH + 12;

    ctx.fillStyle = '#F8FAFC';
    ctx.strokeStyle = '#E2E8F0';
    ctx.beginPath();
    ctx.roundRect(x, fy, cellW, footerH - 18, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#334155';
    ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
    const eVal = Number.isFinite(meas.elbow) ? `${Math.round(meas.elbow)}°` : '—';
    const lVal = Number.isFinite(meas.lean) ? `${Math.round(meas.lean)}°` : '—';
    const kVal = Number.isFinite(meas.knee) ? `${Math.round(meas.knee)}°` : '—';
    const spdVal = sample?.clubSpeed ? `${sample.clubSpeed} mph` : '—';

    ctx.fillText(`리드암 ${eVal}   |   척추각 ${lVal}   |   무릎 ${kVal}`, x + 12, fy + 20);
    ctx.fillStyle = '#64748B';
    ctx.font = '500 11.5px -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif';
    ctx.fillText(`추정 클럽 헤드 스피드: ${spdVal}`, x + 12, fy + 40);
  }

  const dataUrl = panorama.toDataURL('image/png');
  triggerDownload(dataUrl, `golf-swing-7stage-panorama-${Date.now()}.png`);
  return dataUrl;
}

// ============================================================================
// 동영상 내보내기: 타임라인 설정 구간(시작~종료) 다중 잔상 동영상 렌더링 및 다운로드 (MP4 / WebM)
// ============================================================================

export async function exportAfterimageVideo(state, onProgress = () => {}, clipOptions = {}) {
  const width = state.canvasWidth || 1280;
  const height = state.canvasHeight || 720;
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = width;
  exportCanvas.height = height;
  const ctx = exportCanvas.getContext('2d');

  const fps = 30;
  const totalDuration = Math.max(0.2, Number(state.duration || 3.2));
  const rawStart = Number(clipOptions.startTime ?? state.clipStartTime ?? 0);
  const rawEnd = Number(clipOptions.endTime ?? state.clipEndTime ?? totalDuration);

  const startTime = clamp(Math.min(rawStart, rawEnd), 0, Math.max(0, totalDuration - 0.08));
  const endTime = clamp(Math.max(rawStart, rawEnd), startTime + 0.08, totalDuration);
  const clipSpanSec = Math.max(0.08, endTime - startTime);
  const speedFactor = clamp(Number(clipOptions.speedFactor ?? state.exportSpeedFactor ?? 0.5), 0.1, 2.0);
  const totalSteps = Math.max(12, Math.round((clipSpanSec / speedFactor) * fps));

  const mimeCandidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  const mimeType = mimeCandidates.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';

  const stream = exportCanvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 6_500_000 } : undefined);
  const chunks = [];
  recorder.ondataavailable = e => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise(resolve => {
    recorder.onstop = resolve;
  });

  recorder.start(100);

  for (let step = 0; step <= totalSteps; step++) {
    const simTime = clamp(startTime + (step / totalSteps) * clipSpanSec, startTime, endTime);
    if (state.sourceMode === 'video' && state.videoElement && state.videoReady) {
      await seekVideoSafely(state.videoElement, simTime);
    }

    renderCompositeFrame(ctx, width, height, state, simTime, {
      ...state.renderOptions,
      showHud: state.renderOptions?.showHud !== false
    });

    const videoTrack = stream.getVideoTracks?.()[0];
    if (videoTrack && typeof videoTrack.requestFrame === 'function') {
      try {
        videoTrack.requestFrame();
      } catch {
        // requestFrame 미지원 환경 무시
      }
    }

    onProgress(Math.round((step / totalSteps) * 100), simTime, startTime, endTime);
    await new Promise(r => setTimeout(r, 1000 / fps));
  }

  recorder.stop();
  await stopped;

  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
  const url = URL.createObjectURL(blob);
  const startTag = startTime.toFixed(2).replace('.', '_');
  const endTag = endTime.toFixed(2).replace('.', '_');
  const speedTag = `${speedFactor}x`.replace('.', '_');
  const filename = `golf-swing-clip-${startTag}s-to-${endTag}s-${speedTag}-${Date.now()}.${ext}`;
  triggerDownload(url, filename);
  return {
    url,
    filename,
    ext,
    mimeType: mimeType || 'video/webm',
    startTime,
    endTime,
    clipSpanSec,
    speedFactor
  };
}

export function seekVideoSafely(video, time) {
  return new Promise(resolve => {
    if (!video || Math.abs(video.currentTime - time) < 0.005) {
      resolve();
      return;
    }
    const onSeeked = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    const timer = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    }, 350);
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  });
}

export function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 200);
}
