// ============================================================================
// video-stabilizer.js
// 지면(티매트·페어웨이 경계)·배경 능선·스윙 골퍼 하체 스탠스 기준
// 2D 다중 패치 블록 매칭(Coarse-to-Fine SAD + Edge Gradient) 영상 흔들림 고정 엔진
// ============================================================================

import { clamp } from './swing-engine.js?v=20261019_06';

export const DEFAULT_STABILIZATION_OPTIONS = Object.freeze({
  enabled: true,
  // 'crop-matte': 위·아래 잘림을 허용하고 원본 배율(100%) 그대로 지면과 사람을 제자리에 고정 (사용자 요청 기본값)
  // 'auto-zoom': 위·아래 잘린 여백이 보이지 않도록 자동 미세 줌인 크롭
  // 'off': 흔들림 고정 해제 (원본 비디오)
  cropMode: 'crop-matte',
  strength: 1.0,
  referenceTime: 0.45,
  referenceFrame: 1,
  manualOffsetX: 0.0,
  manualOffsetY: 0.0,
  maxDetectedShiftX: 0.0,
  maxDetectedShiftY: 0.0,
  groundAnchorPoint: { x: 0.48, y: 0.78 },
  golferAnchorPoint: { x: 0.34, y: 0.72 },
  customKeyframes: []
});

const MAP_W = 120;
const MAP_H = 90;

/**
 * 비디오 프레임 ImageData로부터 고속 정합용 저해상도(120x90) 휘도(Luma) 및
 * 수평 지면/능선 경계(gradY), 수직 스탠스/기둥 경계(gradX) 특징 맵을 추출합니다.
 */
export function extractStabilizationFeatureMap(imageData, width, height) {
  const luma = new Float32Array(MAP_W * MAP_H);
  const gradX = new Float32Array(MAP_W * MAP_H);
  const gradY = new Float32Array(MAP_W * MAP_H);

  for (let my = 0; my < MAP_H; my++) {
    const sy = Math.min(height - 1, Math.floor(((my + 0.5) / MAP_H) * height));
    const rowOff = sy * width;
    const mapRow = my * MAP_W;
    for (let mx = 0; mx < MAP_W; mx++) {
      const sx = Math.min(width - 1, Math.floor(((mx + 0.5) / MAP_W) * width));
      const idx = (rowOff + sx) * 4;
      const r = imageData[idx];
      const g = imageData[idx + 1];
      const b = imageData[idx + 2];
      luma[mapRow + mx] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }

  for (let my = 1; my < MAP_H - 1; my++) {
    const row = my * MAP_W;
    const rowUp = (my - 1) * MAP_W;
    const rowDn = (my + 1) * MAP_W;
    for (let mx = 1; mx < MAP_W - 1; mx++) {
      const i = row + mx;
      gradX[i] = luma[i + 1] - luma[i - 1];
      gradY[i] = luma[rowDn + mx] - luma[rowUp + mx];
    }
  }

  return {
    mapW: MAP_W,
    mapH: MAP_H,
    luma,
    gradX,
    gradY
  };
}

/**
 * 기준 프레임(Reference Frame)의 지면·골퍼 스탠스·배경 지평선 영역과
 * 대상 프레임(Target Frame) 사이의 카메라 이동량(dx, dy, 정규화 비율)을
 * 2단계 Coarse-to-Fine 블록 매칭으로 산출합니다.
 * - 클럽과 팔이 빠르게 움직이는 상체 스윙 궤도 영역은 마스킹하여 제외하고,
 *   지면(티매트), 골퍼가 서 있는 하체/발 위치, 원경 산 능선/지평선을 기준으로 정합합니다.
 */
export function estimateCameraMotionBetweenMaps(
  refMap,
  targetMap,
  hintDx = 0,
  hintDy = 0,
  anchorOpts = {}
) {
  if (!refMap || !targetMap) return { dx: 0, dy: 0, confidence: 0 };

  const gPt = anchorOpts.groundAnchorPoint || { x: 0.50, y: 0.78 };
  const pPt = anchorOpts.golferAnchorPoint || { x: 0.34, y: 0.72 };

  // 3대 핵심 고정 영역(ROI):
  // 1) 지면 및 공 출발 티매트 영역 (수직/수평 카메라 틸트 감지의 핵심)
  // 2) 스윙한 사람이 서 있는 하체·발 스탠스 접지 영역
  // 3) 클럽 스윙 반경 바깥의 좌·우 원경 능선/지평선 영역
  const rois = [
    {
      // 지면·티매트 경계 영역
      x0: Math.round(clamp(gPt.x - 0.30, 0.08, 0.60) * MAP_W),
      x1: Math.round(clamp(gPt.x + 0.32, 0.35, 0.92) * MAP_W),
      y0: Math.round(clamp(gPt.y - 0.12, 0.52, 0.78) * MAP_H),
      y1: Math.round(clamp(gPt.y + 0.10, 0.68, 0.92) * MAP_H),
      weight: 1.45
    },
    {
      // 사람이 서 있는 하체(무릎~발목~접지면) 영역
      x0: Math.round(clamp(pPt.x - 0.14, 0.08, 0.65) * MAP_W),
      x1: Math.round(clamp(pPt.x + 0.14, 0.22, 0.85) * MAP_W),
      y0: Math.round(clamp(pPt.y - 0.10, 0.48, 0.75) * MAP_H),
      y1: Math.round(clamp(pPt.y + 0.12, 0.62, 0.90) * MAP_H),
      weight: 1.15
    },
    {
      // 우측 원경 산 능선·페어웨이 배경 영역 (스윙 궤도 외곽)
      x0: Math.round(0.56 * MAP_W),
      x1: Math.round(0.93 * MAP_W),
      y0: Math.round(0.20 * MAP_H),
      y1: Math.round(0.56 * MAP_H),
      weight: 1.25
    },
    {
      // 좌측 원경 능선·배경 영역
      x0: Math.round(0.05 * MAP_W),
      x1: Math.round(0.24 * MAP_W),
      y0: Math.round(0.20 * MAP_H),
      y1: Math.round(0.54 * MAP_H),
      weight: 0.95
    }
  ];

  const evalShiftCost = (shiftX, shiftY) => {
    let totalCost = 0;
    let totalWeight = 0;

    for (const roi of rois) {
      const rw = roi.weight;
      for (let ry = roi.y0; ry <= roi.y1; ry += 2) {
        const ty = ry + shiftY;
        if (ty < 2 || ty >= MAP_H - 2) continue;
        const rRow = ry * MAP_W;
        const tRow = ty * MAP_W;

        for (let rx = roi.x0; rx <= roi.x1; rx += 2) {
          const tx = rx + shiftX;
          if (tx < 2 || tx >= MAP_W - 2) continue;

          const rIdx = rRow + rx;
          const tIdx = tRow + tx;

          const dLuma = Math.abs(refMap.luma[rIdx] - targetMap.luma[tIdx]);
          const dGradY = Math.abs(refMap.gradY[rIdx] - targetMap.gradY[tIdx]);
          const dGradX = Math.abs(refMap.gradX[rIdx] - targetMap.gradX[tIdx]);

          // 수평 지면/능선 경계(gradY)에 높은 가중치를 부여하여 상하 카메라 틸트(높이 변화)를 정밀 포착
          const pixelCost = 0.28 * dLuma + 0.50 * dGradY + 0.22 * dGradX;
          totalCost += pixelCost * rw;
          totalWeight += rw;
        }
      }
    }

    if (totalWeight < 24) return Infinity;
    const hintPxX = hintDx * MAP_W;
    const hintPxY = hintDy * MAP_H;
    const regPenalty = 0.035 * Math.hypot(shiftX - hintPxX, shiftY - hintPxY);
    return totalCost / totalWeight + regPenalty;
  };

  // 1단계: Coarse 탐색 (수직 ±22칸 = 화면 높이의 약 ±24.5%, 수평 ±14칸 = 화면 폭의 약 ±11.7%)
  const maxSearchX = 14;
  const maxSearchY = 22;
  let bestShiftX = Math.round(clamp(hintDx * MAP_W, -maxSearchX, maxSearchX));
  let bestShiftY = Math.round(clamp(hintDy * MAP_H, -maxSearchY, maxSearchY));
  let minCost = evalShiftCost(bestShiftX, bestShiftY);

  for (let sy = -maxSearchY; sy <= maxSearchY; sy += 2) {
    for (let sx = -maxSearchX; sx <= maxSearchX; sx += 2) {
      const c = evalShiftCost(sx, sy);
      if (c < minCost) {
        minCost = c;
        bestShiftX = sx;
        bestShiftY = sy;
      }
    }
  }

  // 2단계: Fine 1픽셀 단위 정밀 탐색
  let fineX = bestShiftX;
  let fineY = bestShiftY;
  for (let sy = Math.max(-maxSearchY, bestShiftY - 2); sy <= Math.min(maxSearchY, bestShiftY + 2); sy++) {
    for (let sx = Math.max(-maxSearchX, bestShiftX - 2); sx <= Math.min(maxSearchX, bestShiftX + 2); sx++) {
      const c = evalShiftCost(sx, sy);
      if (c < minCost) {
        minCost = c;
        fineX = sx;
        fineY = sy;
      }
    }
  }

  // 3단계: 포물선 보간(Parabolic Sub-pixel Refinement)으로 소수점 단위 변위 산출
  const cLeft = evalShiftCost(fineX - 1, fineY);
  const cRight = evalShiftCost(fineX + 1, fineY);
  const denomX = cLeft - 2 * minCost + cRight;
  const subX = (Number.isFinite(denomX) && Math.abs(denomX) > 1e-4)
    ? clamp((cLeft - cRight) / (2 * denomX), -0.45, 0.45)
    : 0;

  const cUp = evalShiftCost(fineX, fineY - 1);
  const cDown = evalShiftCost(fineX, fineY + 1);
  const denomY = cUp - 2 * minCost + cDown;
  const subY = (Number.isFinite(denomY) && Math.abs(denomY) > 1e-4)
    ? clamp((cUp - cDown) / (2 * denomY), -0.45, 0.45)
    : 0;

  const finalDx = clamp((fineX + subX) / MAP_W, -0.22, 0.22);
  const finalDy = clamp((fineY + subY) / MAP_H, -0.26, 0.26);

  return {
    dx: Number(finalDx.toFixed(4)),
    dy: Number(finalDy.toFixed(4)),
    cost: minCost
  };
}

/**
 * 전체 프레임 샘플의 특징 맵 배열을 분석하여 기준 프레임(임팩트/어드레스) 대비
 * 각 프레임의 카메라 흔들림 및 상하 높이 변화(dx, dy)를 계산하고 시간축 스무딩을 적용합니다.
 */
export function buildVideoStabilizationProfile(featureMaps, times, refIndex = 0, anchorOpts = {}) {
  const n = featureMaps.length;
  if (n === 0) return [];

  const safeRefIdx = clamp(refIndex, 0, n - 1);
  const refMap = featureMaps[safeRefIdx];
  const rawShifts = new Array(n);
  rawShifts[safeRefIdx] = { dx: 0, dy: 0 };

  // 기준 프레임에서 앞으로(safeRefIdx -> 0) 및 뒤로(safeRefIdx -> n-1) 양방향 추적하여
  // 카메라가 공을 따라 위로 들리거나 흔들리는 연속 변위를 정밀 추적
  let prevDx = 0;
  let prevDy = 0;
  for (let i = safeRefIdx + 1; i < n; i++) {
    const direct = estimateCameraMotionBetweenMaps(refMap, featureMaps[i], prevDx, prevDy, anchorOpts);
    const step = estimateCameraMotionBetweenMaps(featureMaps[i - 1], featureMaps[i], 0, 0, anchorOpts);
    const accumDx = prevDx + step.dx;
    const accumDy = prevDy + step.dy;
    // 기준 프레임 직접 정합(드리프트 방지 65%) + 인접 프레임 누적(연속성 35%) 결합
    const blendedDx = clamp(direct.dx * 0.65 + accumDx * 0.35, -0.22, 0.22);
    const blendedDy = clamp(direct.dy * 0.65 + accumDy * 0.35, -0.26, 0.26);
    rawShifts[i] = { dx: blendedDx, dy: blendedDy };
    prevDx = blendedDx;
    prevDy = blendedDy;
  }

  prevDx = 0;
  prevDy = 0;
  for (let i = safeRefIdx - 1; i >= 0; i--) {
    const direct = estimateCameraMotionBetweenMaps(refMap, featureMaps[i], prevDx, prevDy, anchorOpts);
    const step = estimateCameraMotionBetweenMaps(featureMaps[i + 1], featureMaps[i], 0, 0, anchorOpts);
    const accumDx = prevDx + step.dx;
    const accumDy = prevDy + step.dy;
    const blendedDx = clamp(direct.dx * 0.65 + accumDx * 0.35, -0.22, 0.22);
    const blendedDy = clamp(direct.dy * 0.65 + accumDy * 0.35, -0.26, 0.26);
    rawShifts[i] = { dx: blendedDx, dy: blendedDy };
    prevDx = blendedDx;
    prevDy = blendedDy;
  }

  // 5-탭 가우시안 시간축 스무딩 (고주파 손떨림 제거 + 카메라 틸트 추세 보존, 기준 프레임은 0으로 고정)
  const kernel = [0.12, 0.22, 0.32, 0.22, 0.12];
  const smoothed = rawShifts.map(( item, idx) => {
    if (idx === safeRefIdx) {
      return { time: times[idx] ?? 0, dx: 0, dy: 0 };
    }
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let k = -2; k <= 2; k++) {
      const j = clamp(idx + k, 0, n - 1);
      const w = kernel[k + 2];
      sx += rawShifts[j].dx * w;
      sy += rawShifts[j].dy * w;
      sw += w;
    }
    return {
      time: times[idx] ?? 0,
      dx: Number((sx / sw).toFixed(4)),
      dy: Number((sy / sw).toFixed(4))
    };
  });

  // 기준 프레임의 오프셋이 정확히 (0, 0)이 되도록 재정규화
  const refShift = smoothed[safeRefIdx] || { dx: 0, dy: 0 };
  return smoothed.map(s => ({
    time: s.time,
    dx: Number((s.dx - refShift.dx).toFixed(4)),
    dy: Number((s.dy - refShift.dy).toFixed(4))
  }));
}

/**
 * 사용자가 특정 프레임에서 지면 기준점을 클릭했거나 공 출발점/중간점을 지정했을 때,
 * 기준 프레임과 현재 프레임의 지면 패치를 직접 정합하여 추가 수동 보정 키프레임을 반영합니다.
 */
export function computeEffectiveStabilizationOffset(samples, currentTime, stabOptions = {}) {
  if (!stabOptions || !stabOptions.enabled || stabOptions.cropMode === 'off') {
    return { dx: 0, dy: 0, active: false };
  }

  const strength = clamp(Number(stabOptions.strength ?? 1.0), 0, 1.25);
  let baseDx = 0;
  let baseDy = 0;

  if (Array.isArray(samples) && samples.length > 0) {
    // 현재 시각(currentTime) 전후 샘플의 stabOffset 선형 보간
    let prev = samples[0];
    let next = samples[samples.length - 1];
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].time <= currentTime) prev = samples[i];
      if (samples[i].time >= currentTime) {
        next = samples[i];
        break;
      }
    }
    const span = Math.max(1e-4, next.time - prev.time);
    const alpha = prev === next ? 0 : clamp((currentTime - prev.time) / span, 0, 1);
    const pOff = prev.stabOffset || { dx: 0, dy: 0 };
    const nOff = next.stabOffset || { dx: 0, dy: 0 };
    baseDx = pOff.dx + (nOff.dx - pOff.dx) * alpha;
    baseDy = pOff.dy + (nOff.dy - pOff.dy) * alpha;
  }

  // 사용자가 특정 프레임에서 직접 지정한 지면 고정 키프레임(customKeyframes) 보정치 합산
  let customDx = 0;
  let customDy = 0;
  const kfs = Array.isArray(stabOptions.customKeyframes) ? stabOptions.customKeyframes : [];
  if (kfs.length === 1) {
    const refT = Number(stabOptions.referenceTime ?? 0.45);
    const kf = kfs[0];
    const span = Math.abs(kf.time - refT);
    if (span > 0.02) {
      const ratio = clamp((currentTime - refT) / (kf.time - refT), 0, 1.25);
      customDx = kf.dx * ratio;
      customDy = kf.dy * ratio;
    } else {
      customDx = kf.dx;
      customDy = kf.dy;
    }
  } else if (kfs.length >= 2) {
    const sorted = [...kfs].sort((a, b) => a.time - b.time);
    if (currentTime <= sorted[0].time) {
      customDx = sorted[0].dx;
      customDy = sorted[0].dy;
    } else if (currentTime >= sorted[sorted.length - 1].time) {
      customDx = sorted[sorted.length - 1].dx;
      customDy = sorted[sorted.length - 1].dy;
    } else {
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        if (currentTime >= a.time && currentTime <= b.time) {
          const r = clamp((currentTime - a.time) / Math.max(1e-4, b.time - a.time), 0, 1);
          customDx = a.dx + (b.dx - a.dx) * r;
          customDy = a.dy + (b.dy - a.dy) * r;
          break;
        }
      }
    }
  }

  const totalDx = clamp(
    baseDx * strength + customDx + Number(stabOptions.manualOffsetX || 0),
    -0.28,
    0.28
  );
  const totalDy = clamp(
    baseDy * strength + customDy + Number(stabOptions.manualOffsetY || 0),
    -0.32,
    0.32
  );

  return {
    dx: Number(totalDx.toFixed(4)),
    dy: Number(totalDy.toFixed(4)),
    active: Math.abs(totalDx) > 0.0005 || Math.abs(totalDy) > 0.0005
  };
}

/**
 * 비디오 프레임을 캔버스에 그릴 때 카메라 흔들림/높이 변화의 역변환(-dx, -dy)을 적용하여,
 * 위·아래가 일부 잘리더라도 스윙한 사람과 지면(티매트)이 제자리에 고정(Stay)되도록 렌더링합니다.
 */
export function drawStabilizedVideoFrame(ctx, sourceDrawable, width, height, effOffset, stabOptions = {}) {
  if (!sourceDrawable) return;
  const cropMode = stabOptions?.cropMode || 'crop-matte';
  if (!stabOptions?.enabled || cropMode === 'off' || !effOffset?.active) {
    ctx.drawImage(sourceDrawable, 0, 0, width, height);
    return;
  }

  const shiftX = Math.round(-effOffset.dx * width);
  const shiftY = Math.round(-effOffset.dy * height);

  ctx.save();

  if (cropMode === 'auto-zoom') {
    // 위·아래 잘린 여백이 보이지 않도록 필요한 만큼만 자동 줌인하여 고정
    const reqScaleX = 1 + Math.abs(effOffset.dx) * 2.05;
    const reqScaleY = 1 + Math.abs(effOffset.dy) * 2.05;
    const zoomScale = clamp(Math.max(reqScaleX, reqScaleY, 1.02), 1.0, 1.32);
    const drawW = width * zoomScale;
    const drawH = height * zoomScale;
    const baseLeft = (width - drawW) * 0.5;
    const baseTop = (height - drawH) * 0.5;
    ctx.drawImage(
      sourceDrawable,
      Math.round(baseLeft + shiftX * zoomScale),
      Math.round(baseTop + shiftY * zoomScale),
      Math.round(drawW),
      Math.round(drawH)
    );
  } else {
    // 'crop-matte' (기본값): 원본 100% 배율을 유지한 채 위·아래/좌·우를 이동시켜 사람과 지면 높이를 100% 고정
    // 1) 이동으로 인해 드러나는 위·아래 가장자리 크롭 영역에 어두운 앰비언트 배경 채움
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 0.28;
    ctx.drawImage(sourceDrawable, 0, 0, width, height);
    ctx.globalAlpha = 1.0;

    // 2) 역변환(shiftX, shiftY)만큼 이동시켜 지면과 스윙한 사람의 위치를 기준 프레임 위치에 고정
    ctx.drawImage(sourceDrawable, shiftX, shiftY, width, height);

    // 3) 위·아래 잘림 경계선에 깔끔한 1px 가이드 라인 표시
    if (Math.abs(shiftY) >= 2) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = 1;
      const borderY = shiftY > 0 ? shiftY : height + shiftY;
      ctx.beginPath();
      ctx.moveTo(0, borderY);
      ctx.lineTo(width, borderY);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * 샘플 배열(samples) 전체에 대해 기준 프레임(referenceTime) 대비 카메라 흔들림 프로파일을 재계산하고,
 * 각 샘플의 frameCanvas를 지면과 스윙한 사람이 고정(Stay)된 이미지로 갱신합니다.
 */
export function recomputeSamplesStabilization(samples, stabOptions = {}, forceProfile = false) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { maxShiftX: 0, maxShiftY: 0, refIndex: 0 };
  }

  const refTime = Number(stabOptions.referenceTime ?? 0.45);
  let refIndex = 0;
  let minDiff = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const d = Math.abs((samples[i].time ?? 0) - refTime);
    if (d < minDiff) {
      minDiff = d;
      refIndex = i;
    }
  }

  const gPt = stabOptions.groundAnchorPoint || { x: 0.48, y: 0.78 };
  const pPt = stabOptions.golferAnchorPoint || { x: 0.44, y: 0.62 };
  const profileCacheKey = `${samples.length}_${refIndex}_${Number(gPt.x).toFixed(3)}_${Number(gPt.y).toFixed(3)}_${Number(pPt.x).toFixed(3)}_${Number(pPt.y).toFixed(3)}`;

  const hasMaps = samples.every(s => Boolean(s.stabMap));
  const hasCachedOffsets = !forceProfile && samples._stabProfileCacheKey === profileCacheKey && samples.every(s => Boolean(s.stabOffset));

  if (hasMaps && !hasCachedOffsets) {
    const maps = samples.map(s => s.stabMap);
    const times = samples.map(s => s.time ?? 0);
    const profile = buildVideoStabilizationProfile(maps, times, refIndex, {
      groundAnchorPoint: stabOptions.groundAnchorPoint,
      golferAnchorPoint: stabOptions.golferAnchorPoint
    });
    for (let i = 0; i < samples.length; i++) {
      samples[i].stabOffset = {
        dx: profile[i]?.dx ?? 0,
        dy: profile[i]?.dy ?? 0
      };
    }
    samples._stabProfileCacheKey = profileCacheKey;
  }

  let maxShiftX = 0;
  let maxShiftY = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const eff = computeEffectiveStabilizationOffset(samples, s.time ?? 0, stabOptions);
    s.effectiveStabOffset = eff;
    if (Math.abs(eff.dx) > maxShiftX) maxShiftX = Math.abs(eff.dx);
    if (Math.abs(eff.dy) > maxShiftY) maxShiftY = Math.abs(eff.dy);

    // 원본 프레임(rawFrameCanvas)이 보관되어 있으면 고정된 이미지를 frameCanvas에 즉시 베이크
    const srcCanvas = s.rawFrameCanvas;
    if (srcCanvas) {
      if (!s.frameCanvas) {
        s.frameCanvas = document.createElement('canvas');
        s.frameCanvas.width = srcCanvas.width;
        s.frameCanvas.height = srcCanvas.height;
      }
      const fCtx = s.frameCanvas.getContext('2d');
      fCtx.clearRect(0, 0, s.frameCanvas.width, s.frameCanvas.height);
      drawStabilizedVideoFrame(
        fCtx,
        srcCanvas,
        s.frameCanvas.width,
        s.frameCanvas.height,
        eff,
        stabOptions
      );
    }
  }

  return {
    maxShiftX: Number(maxShiftX.toFixed(4)),
    maxShiftY: Number(maxShiftY.toFixed(4)),
    refIndex,
    refTime: samples[refIndex]?.time ?? refTime
  };
}

/**
 * 비동기 프레임 양보(Yield)를 포함하여 메인 스레드 멈춤 없이 전체 샘플의 지면·사람 위치 고정을 재계산합니다.
 */
export async function recomputeSamplesStabilizationAsync(samples, stabOptions = {}, onProgressOrOpts = null, forceProfile = false) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { maxShiftX: 0, maxShiftY: 0, refIndex: 0 };
  }

  let onProgress = null;
  if (typeof onProgressOrOpts === 'function') {
    onProgress = onProgressOrOpts;
  } else if (onProgressOrOpts && typeof onProgressOrOpts === 'object') {
    if (typeof onProgressOrOpts.onProgress === 'function') {
      onProgress = onProgressOrOpts.onProgress;
    }
    if (onProgressOrOpts.forceProfileRecompute !== undefined || onProgressOrOpts.forceProfile !== undefined) {
      forceProfile = Boolean(onProgressOrOpts.forceProfileRecompute ?? onProgressOrOpts.forceProfile);
    }
  }

  const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));
  let lastYield = performance.now();

  const refTime = Number(stabOptions.referenceTime ?? 0.45);
  let refIndex = 0;
  let minDiff = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const d = Math.abs((samples[i].time ?? 0) - refTime);
    if (d < minDiff) {
      minDiff = d;
      refIndex = i;
    }
  }

  const gPt = stabOptions.groundAnchorPoint || { x: 0.48, y: 0.78 };
  const pPt = stabOptions.golferAnchorPoint || { x: 0.44, y: 0.62 };
  const profileCacheKey = `${samples.length}_${refIndex}_${Number(gPt.x).toFixed(3)}_${Number(gPt.y).toFixed(3)}_${Number(pPt.x).toFixed(3)}_${Number(pPt.y).toFixed(3)}`;

  const hasMaps = samples.every(s => Boolean(s.stabMap));
  const hasCachedOffsets = !forceProfile && samples._stabProfileCacheKey === profileCacheKey && samples.every(s => Boolean(s.stabOffset));

  if (hasMaps && !hasCachedOffsets) {
    const n = samples.length;
    const maps = samples.map(s => s.stabMap);
    const times = samples.map(s => s.time ?? 0);
    const safeRefIdx = clamp(refIndex, 0, n - 1);
    const refMap = maps[safeRefIdx];
    const rawShifts = new Array(n);
    rawShifts[safeRefIdx] = { dx: 0, dy: 0 };
    const anchorOpts = {
      groundAnchorPoint: stabOptions.groundAnchorPoint,
      golferAnchorPoint: stabOptions.golferAnchorPoint
    };

    let prevDx = 0;
    let prevDy = 0;
    let processedCount = 1;

    for (let i = safeRefIdx + 1; i < n; i++) {
      const direct = estimateCameraMotionBetweenMaps(refMap, maps[i], prevDx, prevDy, anchorOpts);
      const step = estimateCameraMotionBetweenMaps(maps[i - 1], maps[i], 0, 0, anchorOpts);
      const blendedDx = clamp(direct.dx * 0.65 + (prevDx + step.dx) * 0.35, -0.22, 0.22);
      const blendedDy = clamp(direct.dy * 0.65 + (prevDy + step.dy) * 0.35, -0.26, 0.26);
      rawShifts[i] = { dx: blendedDx, dy: blendedDy };
      prevDx = blendedDx;
      prevDy = blendedDy;
      processedCount++;
      if (performance.now() - lastYield > 32) {
        if (onProgress) onProgress(Math.round((processedCount / n) * 55), '카메라 흔들림 정합 프로파일 계산 중...');
        await yieldFrame();
        lastYield = performance.now();
      }
    }

    prevDx = 0;
    prevDy = 0;
    for (let i = safeRefIdx - 1; i >= 0; i--) {
      const direct = estimateCameraMotionBetweenMaps(refMap, maps[i], prevDx, prevDy, anchorOpts);
      const step = estimateCameraMotionBetweenMaps(maps[i + 1], maps[i], 0, 0, anchorOpts);
      const blendedDx = clamp(direct.dx * 0.65 + (prevDx + step.dx) * 0.35, -0.22, 0.22);
      const blendedDy = clamp(direct.dy * 0.65 + (prevDy + step.dy) * 0.35, -0.26, 0.26);
      rawShifts[i] = { dx: blendedDx, dy: blendedDy };
      prevDx = blendedDx;
      prevDy = blendedDy;
      processedCount++;
      if (performance.now() - lastYield > 32) {
        if (onProgress) onProgress(Math.round((processedCount / n) * 55));
        await yieldFrame();
        lastYield = performance.now();
      }
    }

    const kernel = [0.12, 0.22, 0.32, 0.22, 0.12];
    const smoothed = rawShifts.map((item, idx) => {
      if (idx === safeRefIdx) return { time: times[idx] ?? 0, dx: 0, dy: 0 };
      let sx = 0, sy = 0, sw = 0;
      for (let k = -2; k <= 2; k++) {
        const j = clamp(idx + k, 0, n - 1);
        const w = kernel[k + 2];
        sx += rawShifts[j].dx * w;
        sy += rawShifts[j].dy * w;
        sw += w;
      }
      return {
        time: times[idx] ?? 0,
        dx: Number((sx / sw).toFixed(4)),
        dy: Number((sy / sw).toFixed(4))
      };
    });
    const refShift = smoothed[safeRefIdx] || { dx: 0, dy: 0 };
    for (let i = 0; i < n; i++) {
      samples[i].stabOffset = {
        dx: Number(((smoothed[i]?.dx ?? 0) - refShift.dx).toFixed(4)),
        dy: Number(((smoothed[i]?.dy ?? 0) - refShift.dy).toFixed(4))
      };
    }
    samples._stabProfileCacheKey = profileCacheKey;
  }

  let maxShiftX = 0;
  let maxShiftY = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const eff = computeEffectiveStabilizationOffset(samples, s.time ?? 0, stabOptions);
    s.effectiveStabOffset = eff;
    if (Math.abs(eff.dx) > maxShiftX) maxShiftX = Math.abs(eff.dx);
    if (Math.abs(eff.dy) > maxShiftY) maxShiftY = Math.abs(eff.dy);

    const srcCanvas = s.rawFrameCanvas;
    if (srcCanvas) {
      if (!s.frameCanvas) {
        s.frameCanvas = document.createElement('canvas');
        s.frameCanvas.width = srcCanvas.width;
        s.frameCanvas.height = srcCanvas.height;
      }
      const fCtx = s.frameCanvas.getContext('2d');
      fCtx.clearRect(0, 0, s.frameCanvas.width, s.frameCanvas.height);
      drawStabilizedVideoFrame(
        fCtx,
        srcCanvas,
        s.frameCanvas.width,
        s.frameCanvas.height,
        eff,
        stabOptions
      );
    }

    if (performance.now() - lastYield > 32) {
      if (onProgress) onProgress(55 + Math.round(((i + 1) / samples.length) * 45));
      await yieldFrame();
      lastYield = performance.now();
    }
  }

  return {
    maxShiftX: Number(maxShiftX.toFixed(4)),
    maxShiftY: Number(maxShiftY.toFixed(4)),
    refIndex,
    refTime: samples[refIndex]?.time ?? refTime
  };
}

/**
 * 사용자가 공의 중간점(mid1~3, frame-ball)을 지정하거나 특정 프레임에서 지면을 고정할 때,
 * 기준 프레임(출발점 프레임)과 대상 프레임 사이의 지면·사람 스탠스 변위를 정밀 재측정하여 반환합니다.
 */
export function alignFrameToReferenceGround(samples, refTime, targetTime, stabOptions = {}) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  let refSample = samples[0];
  let targetSample = samples[0];
  let minRefD = Infinity;
  let minTgtD = Infinity;

  for (const s of samples) {
    const dr = Math.abs((s.time ?? 0) - refTime);
    if (dr < minRefD) {
      minRefD = dr;
      refSample = s;
    }
    const dt = Math.abs((s.time ?? 0) - targetTime);
    if (dt < minTgtD) {
      minTgtD = dt;
      targetSample = s;
    }
  }

  if (!refSample?.stabMap || !targetSample?.stabMap || refSample === targetSample) {
    return null;
  }

  const prevOff = targetSample.stabOffset || { dx: 0, dy: 0 };
  const refined = estimateCameraMotionBetweenMaps(
    refSample.stabMap,
    targetSample.stabMap,
    prevOff.dx,
    prevOff.dy,
    {
      groundAnchorPoint: stabOptions.groundAnchorPoint,
      golferAnchorPoint: stabOptions.golferAnchorPoint
    }
  );

  return {
    time: targetSample.time,
    dx: refined.dx,
    dy: refined.dy
  };
}

