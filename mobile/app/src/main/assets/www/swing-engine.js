// ============================================================================
// swing-engine.js
// REA 역공학(ev_6a95845d609415d61e82fcc946a0c6c7262cdc215f0427e9602b0a2315ed2970)을 통해
// 복원한 FreeGolfSwingAnalyzer의 기하학·템포·7단계 키프레임 검출 알고리즘과
// Shot Tracer / ShaShot 스타일의 클럽 헤드 궤적 추정 및 Catmull-Rom Spline 보간 엔진
// ============================================================================

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const visible = (p, minVis = 0.55) =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 1) >= minVis;

// 7대 핵심 스윙 구간 정의 (REA keyframes.js 복원)
export const KEY_MOMENTS = [
  ['address', '어드레스', 'Address'],
  ['backswing', '테이크어웨이 / 백스윙', 'Backswing'],
  ['top', '백스윙 탑', 'Top'],
  ['downswing', '다운스윙', 'Downswing'],
  ['impact', '임팩트', 'Impact'],
  ['follow', '팔로우스루', 'Follow-through'],
  ['finish', '피니시', 'Finish']
];

export const MOMENT_COLORS = {
  address: '#15803D',
  backswing: '#2563EB',
  top: '#4F46E5',
  downswing: '#D97706',
  impact: '#DC2626',
  follow: '#0D9488',
  finish: '#0F172A'
};

export const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28]
];

export const MEASUREMENTS = [
  ['elbow', '리드 팔꿈치 각도'],
  ['trailElbow', '트레일 팔꿈치 각도'],
  ['lean', '척추 전경 각도'],
  ['knee', '리드 무릎 각도'],
  ['wrist', '코킹(손목) 각도'],
  ['shoulderLine', '어깨 회전 기울기'],
  ['hipLine', '골반 수평 기울기']
];

// 픽셀 좌표 기반 3점 각도 계산 (종횡비 왜곡 방지 — REA analysis.js 복원)
export function angle(a, b, c, width, height) {
  if (![a, b, c].every(p => visible(p, 0.45))) return null;
  const u = [(a.x - b.x) * width, (a.y - b.y) * height];
  const v = [(c.x - b.x) * width, (c.y - b.y) * height];
  const norm = Math.hypot(...u) * Math.hypot(...v);
  if (norm < 1e-8) return null;
  return Math.acos(clamp((u[0] * v[0] + u[1] * v[1]) / norm, -1, 1)) * (180 / Math.PI);
}

// 관절 각도 및 신체 정렬 측정 (REA analysis.js 복원)
export function measurements(points, width, height, hand = 'right') {
  const empty = Object.fromEntries(MEASUREMENTS.map(([key]) => [key, null]));
  if (!points || !width || !height) return empty;

  const side = hand === 'right' ? 0 : 1; // 오른손잡이는 좌측(11,13,15,23,25,27)이 리드 사이드
  const elbow = angle(points[11 + side], points[13 + side], points[15 + side], width, height);
  const trailElbow = angle(points[12 - side], points[14 - side], points[16 - side], width, height);
  const knee = angle(points[23 + side], points[25 + side], points[27 + side], width, height);
  const trailKnee = angle(points[24 - side], points[26 - side], points[28 - side], width, height);
  const wrist = angle(points[13 + side], points[15 + side], points[19 + side] || points[15 + side], width, height);

  let lean = null;
  if ([11, 12, 23, 24].every(i => visible(points[i], 0.45))) {
    const dx = ((points[11].x + points[12].x) - (points[23].x + points[24].x)) * width / 2;
    const dy = ((points[23].y + points[24].y) - (points[11].y + points[12].y)) * height / 2;
    if (Math.hypot(dx, dy) > 1e-8) {
      lean = Math.atan2(Math.abs(dx), dy) * (180 / Math.PI);
    }
  }

  const lineSlope = (idxA, idxB) => {
    if (![points[idxA], points[idxB]].every(p => visible(p, 0.45))) return null;
    const dx = (points[idxB].x - points[idxA].x) * width;
    const dy = (points[idxB].y - points[idxA].y) * height;
    return Math.hypot(dx, dy) < 1e-8 ? null : Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI);
  };

  return {
    elbow,
    trailElbow,
    knee,
    trailKnee,
    lean,
    wrist,
    shoulderLine: lineSlope(11, 12),
    hipLine: lineSlope(23, 24)
  };
}

// 백스윙 : 다운스윙 템포 비율 계산 (REA analysis.js 복원)
export function calculateTempo(marks) {
  const { address, top, impact } = marks || {};
  if (![address, top, impact].every(Number.isFinite) || !(address < top && top < impact)) {
    return null;
  }
  const backswingSec = top - address;
  const downswingSec = impact - top;
  if (downswingSec <= 0.01) return null;
  return {
    ratio: backswingSec / downswingSec,
    backswingSec,
    downswingSec
  };
}

// 3-샘플 중앙값 필터링으로 포즈 및 클럽 헤드 떨림 제거 (REA analysis.js smoothSamples 복원 및 확장)
export function smoothSamples(samples) {
  if (!samples || samples.length < 3) return samples || [];
  return samples.map((sample, i) => {
    const prev = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(samples.length - 1, i + 1)];

    const smoothedPoints = sample.points?.map((p, j) => {
      if (!visible(p, 0.3)) return p;
      const neighbors = [prev?.points?.[j], p, next?.points?.[j]].filter(n => visible(n, 0.3));
      if (neighbors.length < 3) return p;
      const med = key => neighbors.map(n => n[key]).sort((a, b) => a - b)[1];
      return { ...p, x: med('x'), y: med('y') };
    }) ?? null;

    let smoothedClubHead = sample.clubHead;
    if (sample.clubHead && !sample.clubHead.pinned && prev?.clubHead && next?.clubHead) {
      const medX = [prev.clubHead.x, sample.clubHead.x, next.clubHead.x].sort((a, b) => a - b)[1];
      const medY = [prev.clubHead.y, sample.clubHead.y, next.clubHead.y].sort((a, b) => a - b)[1];
      smoothedClubHead = { ...sample.clubHead, x: medX, y: medY };
    }

    return {
      ...sample,
      points: smoothedPoints,
      clubHead: smoothedClubHead
    };
  });
}

// ============================================================================
// 클럽 헤드(Club Head) 위치 추정 및 하이브리드 모션 추적기
// ============================================================================

/**
 * 신체 관절(어깨, 팔꿈치, 양손 손목)과 이전 프레임 모션 정보를 바탕으로
 * 그립 중심점(grip)과 클럽 헤드 끝단 좌표(clubHead)를 산출합니다.
 */
export function estimateClubPosition(points, prevSample, time, duration, hand = 'right', motionCandidate = null) {
  if (!points) return { grip: null, clubHead: null };

  const leadWrist = points[hand === 'right' ? 15 : 16];
  const trailWrist = points[hand === 'right' ? 16 : 15];
  const leadElbow = points[hand === 'right' ? 13 : 14];
  const trailElbow = points[hand === 'right' ? 14 : 13];
  const leadShoulder = points[hand === 'right' ? 11 : 12];
  const trailShoulder = points[hand === 'right' ? 12 : 11];
  const leadHip = points[hand === 'right' ? 23 : 24];
  const trailHip = points[hand === 'right' ? 24 : 23];

  const hasLeadW = visible(leadWrist, 0.35);
  const hasTrailW = visible(trailWrist, 0.35);
  if (!hasLeadW && !hasTrailW) return { grip: null, clubHead: null };

  // 그립 중심점 (양손 손목 중점)
  const gripX = hasLeadW && hasTrailW ? (leadWrist.x + trailWrist.x) * 0.5 : (hasLeadW ? leadWrist.x : trailWrist.x);
  const gripY = hasLeadW && hasTrailW ? (leadWrist.y + trailWrist.y) * 0.5 : (hasLeadW ? leadWrist.y : trailWrist.y);
  const grip = { x: gripX, y: gripY };

  // 토르소 스케일 산출 (클럽 샤프트 길이 비례 상수)
  const shoulderY = (visible(leadShoulder, 0.3) && visible(trailShoulder, 0.3))
    ? (leadShoulder.y + trailShoulder.y) * 0.5
    : (leadShoulder?.y ?? 0.32);
  const hipY = (visible(leadHip, 0.3) && visible(trailHip, 0.3))
    ? (leadHip.y + trailHip.y) * 0.5
    : (leadHip?.y ?? 0.54);
  const torsoLen = Math.max(0.14, Math.abs(hipY - shoulderY));
  const shaftLength = torsoLen * 1.48; // 표준 드라이버/아이언 시각적 샤프트 비율

  // 팔뚝 벡터 (팔꿈치 -> 그립)
  const elbowX = (visible(leadElbow, 0.3) && visible(trailElbow, 0.3))
    ? (leadElbow.x + trailElbow.x) * 0.5
    : (leadElbow?.x ?? gripX);
  const elbowY = (visible(leadElbow, 0.3) && visible(trailElbow, 0.3))
    ? (leadElbow.y + trailElbow.y) * 0.5
    : (leadElbow?.y ?? (gripY - torsoLen * 0.5));

  let forearmAngle = Math.atan2(gripY - elbowY, gripX - elbowX);

  // 손목 상대 높이(yRel): 어드레스 시 양수(~0.2), 백스윙 탑/피니시 시 음수(~ -0.8)
  const yRel = (gripY - hipY) / torsoLen;

  // 이전 프레임 대비 그립 속도 벡터를 통해 백스윙 vs 다운스윙/팔로우스루 진행 방향 판별
  let vx = 0;
  let vy = 0;
  if (prevSample?.grip && time > prevSample.time) {
    const dt = Math.max(0.008, time - prevSample.time);
    vx = (gripX - prevSample.grip.x) / dt;
    vy = (gripY - prevSample.grip.y) / dt;
  }

  // 손목 코킹(Wrist Hinge) 및 릴리스 물리 각도 보정
  // 어드레스에서는 팔뚝 연장선보다 약간 앞쪽 바닥을 향하고,
  // 백스윙 탑에서는 코킹으로 인해 머리 뒤/수평 방향으로 꺾이며,
  // 다운스윙~임팩트에서는 원심력(Lag -> Release)으로 빠르게 펴집니다.
  const dirSign = hand === 'right' ? 1 : -1;
  let cockingOffset = 0;

  if (yRel < -0.25) {
    // 상단 구간 (탑 또는 피니시): 손목 코킹 최대화
    const topFactor = clamp((-yRel - 0.25) / 0.7, 0, 1);
    if (vy < -0.05) {
      // 백스윙 상승 중 -> 탑
      cockingOffset = -dirSign * topFactor * 1.35;
    } else if (vy > 0.08) {
      // 다운스윙 하강 초기 (Lag 유지)
      cockingOffset = -dirSign * topFactor * 1.55;
    } else {
      // 탑 정점 또는 피니시 홀드
      cockingOffset = -dirSign * topFactor * 1.42;
    }
  } else {
    // 하단 구간 (어드레스 / 테이크어웨이 / 임팩트)
    cockingOffset = dirSign * 0.14;
  }

  const shaftAngle = forearmAngle + cockingOffset;
  let headX = clamp(gripX + Math.cos(shaftAngle) * shaftLength, 0.02, 0.98);
  let headY = clamp(gripY + Math.sin(shaftAngle) * shaftLength, 0.02, 0.98);

  // 만약 프레임 차분(Optical Motion Peak)에서 그립 반경 shaftLength 부근에 강한 클럽 헤드 모션이 잡혔다면 가중 블렌딩
  if (motionCandidate && Number.isFinite(motionCandidate.x) && Number.isFinite(motionCandidate.y)) {
    const distFromGrip = Math.hypot(motionCandidate.x - gripX, motionCandidate.y - gripY);
    const distFromEst = Math.hypot(motionCandidate.x - headX, motionCandidate.y - headY);
    if (distFromGrip >= shaftLength * 0.55 && distFromGrip <= shaftLength * 1.45 && distFromEst <= shaftLength * 0.65) {
      const weight = clamp(motionCandidate.confidence ?? 0.45, 0.2, 0.65);
      headX = headX * (1 - weight) + motionCandidate.x * weight;
      headY = headY * (1 - weight) + motionCandidate.y * weight;
    }
  }

  return {
    grip,
    clubHead: {
      x: headX,
      y: headY,
      shaftAngle,
      pinned: false
    }
  };
}

/**
 * 두 인접 프레임의 ImageData 차분(Motion Energy)에서 그립 주변 샤프트 반경 링 내부의
 * 가장 빠른 이동 점(클럽 헤드 후보)을 검출합니다.
 */
export function detectClubHeadMotionPeak(currData, prevData, width, height, grip, torsoLen = 0.22) {
  if (!currData || !prevData || !grip) return null;
  const minR = torsoLen * 0.7 * Math.min(width, height);
  const maxR = torsoLen * 1.85 * Math.min(width, height);
  const gx = grip.x * width;
  const gy = grip.y * height;

  const step = 4;
  let sumX = 0;
  let sumY = 0;
  let sumWeight = 0;
  let maxDiff = 0;

  const startX = Math.max(step, Math.floor(gx - maxR));
  const endX = Math.min(width - step, Math.ceil(gx + maxR));
  const startY = Math.max(step, Math.floor(gy - maxR));
  const endY = Math.min(height - step, Math.ceil(gy + maxR));

  for (let y = startY; y < endY; y += step) {
    for (let x = startX; x < endX; x += step) {
      const dist = Math.hypot(x - gx, y - gy);
      if (dist < minR || dist > maxR) continue;

      const idx = (y * width + x) * 4;
      const diff =
        Math.abs(currData[idx] - prevData[idx]) +
        Math.abs(currData[idx + 1] - prevData[idx + 1]) +
        Math.abs(currData[idx + 2] - prevData[idx + 2]);

      if (diff > 75) {
        const w = (diff - 75) * (dist / maxR);
        sumX += x * w;
        sumY += y * w;
        sumWeight += w;
        if (diff > maxDiff) maxDiff = diff;
      }
    }
  }

  if (sumWeight < 250) return null;
  return {
    x: (sumX / sumWeight) / width,
    y: (sumY / sumWeight) / height,
    confidence: clamp((maxDiff - 75) / 300, 0.2, 0.65)
  };
}

/**
 * 어드레스(Address) 프레임 이미지에서 그립(양손)으로부터 발 아래 타석 매트(볼 위치)로 뻗은
 * 실제 골프채 샤프트 직선 에지 및 볼 뒤 클럽 헤드 끝단을 정밀 인식합니다.
 */
export function detectAddressGolfClub(imageData, width, height, grip, torsoLen = 0.22, hand = 'right', points = null) {
  const dirSign = hand === 'left' ? -1 : 1;

  // 발목·발끝 랜드마크(27, 28, 29, 30, 31, 32) 및 골반(23, 24)으로부터 골퍼의 양발 접지선 및 후방(DTL)/정면(FO) 뷰 판별
  let ankleY = clamp(grip.y + Math.max(0.16, torsoLen * 0.95), 0.54, 0.87);
  let footCenterX = grip.x - dirSign * 0.08;
  let footForwardX = grip.x - dirSign * 0.04;
  let hipCenterX = grip.x - dirSign * 0.08;
  let isDTLStance = false;

  if (Array.isArray(points)) {
    const footPts = [27, 28, 29, 30, 31, 32]
      .map(idx => points[idx])
      .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 1) > 0.22);
    if (footPts.length) {
      const footYs = footPts.map(p => p.y);
      const footXs = footPts.map(p => p.x);
      ankleY = clamp(Math.max(...footYs), 0.50, 0.88);
      footCenterX = footXs.reduce((a, b) => a + b, 0) / footXs.length;
      footForwardX = dirSign > 0 ? Math.max(...footXs) : Math.min(...footXs);
    }
    const lHip = points[23];
    const rHip = points[24];
    if (lHip && rHip && Number.isFinite(lHip.x) && Number.isFinite(rHip.x)) {
      hipCenterX = (lHip.x + rHip.x) * 0.5;
    }
    const lSh = points[11];
    const rSh = points[12];
    const shSpanX = (lSh && rSh && Number.isFinite(lSh.x) && Number.isFinite(rSh.x))
      ? Math.abs(lSh.x - rSh.x)
      : 0.16;

    // 후방(DTL) 스탠스: 양손(grip.x)이 골반·발 중심보다 앞쪽(오른손잡이 기준 우측)으로 뻗어 있거나 어깨 좌우 폭이 좁은 측면 정렬
    if ((grip.x - hipCenterX) * dirSign > 0.030 || (grip.x - footCenterX) * dirSign > 0.030 || shSpanX < 0.135) {
      isDTLStance = true;
    }
  }

  const defaultHeadY = isDTLStance
    ? clamp(Math.max(grip.y + 0.105, ankleY - 0.01), 0.62, 0.88)
    : clamp(ankleY + 0.135, grip.y + 0.25, 0.91);
  const defaultHeadX = isDTLStance
    ? clamp(grip.x + dirSign * 0.18, 0.15, 0.85)
    : clamp(grip.x - dirSign * 0.016, 0.05, 0.95);
  const defaultLen = Math.hypot(defaultHeadX - grip.x, defaultHeadY - grip.y);
  const defaultAngle = Math.atan2(defaultHeadY - grip.y, defaultHeadX - grip.x);
  const fallbackHead = {
    x: defaultHeadX,
    y: defaultHeadY,
    shaftAngle: defaultAngle,
    pinned: false
  };
  const fallbackBall = {
    x: clamp(defaultHeadX + dirSign * 0.016, 0.06, 0.94),
    y: clamp(defaultHeadY - 0.003, 0.06, 0.94)
  };

  if (!imageData || !width || !height || !grip) {
    return { grip, clubHead: fallbackHead, ballPoint: fallbackBall, shaftLengthNorm: defaultLen, isDTL: isDTLStance };
  }

  const gx = grip.x * width;
  const gy = grip.y * height;

  // 1) 후방(DTL) 타석 매트 전방 영역 탐색:
  //    골퍼의 흰색 골프화(신발)는 발 위치(x <= footForwardX + 0.04)에 있고 면적이 넓으므로,
  //    반드시 양손/발끝 앞쪽 타석 매트 영역에서 주변 4방향이 초록색 잔디 매트(Green Turf)로 둘러싸인
  //    컴팩트한 클럽헤드 + 골프공 클러스터 및 그립에서 이어지는 사선 샤프트 라인을 탐색합니다.
  const dtlXMinNorm = dirSign > 0
    ? clamp(Math.max(0.43, grip.x + 0.07, footForwardX + 0.07), 0.40, 0.72)
    : clamp(Math.min(0.22, grip.x - 0.28), 0.12, 0.45);
  const dtlXMaxNorm = dirSign > 0
    ? clamp(Math.max(dtlXMinNorm + 0.12, grip.x + 0.28), 0.52, 0.80)
    : clamp(Math.min(0.57, grip.x - 0.07, footForwardX - 0.07), 0.28, 0.60);
  const dtlYMinNorm = clamp(Math.min(grip.y + 0.04, ankleY - 0.07), 0.62, 0.82);
  const dtlYMaxNorm = clamp(Math.max(ankleY + 0.035, grip.y + 0.16), dtlYMinNorm + 0.06, 0.88);

  const ringDistX = Math.max(6, Math.round(width * 0.025));
  const ringDistY = Math.max(6, Math.round(height * 0.015));

  let bestDtlScore = -1;
  let dtlPeakXNorm = null;
  let dtlPeakYNorm = null;

  const dtlX0 = Math.max(ringDistX + 2, Math.floor(width * dtlXMinNorm));
  const dtlX1 = Math.min(width - ringDistX - 2, Math.ceil(width * dtlXMaxNorm));
  const dtlY0 = Math.max(ringDistY + 2, Math.floor(height * dtlYMinNorm));
  const dtlY1 = Math.min(height - ringDistY - 2, Math.ceil(height * dtlYMaxNorm));

  for (let y = dtlY0; y <= dtlY1; y += 2) {
    for (let x = dtlX0; x <= dtlX1; x += 2) {
      const idx = (y * width + x) * 4;
      const r = imageData[idx];
      const g = imageData[idx + 1];
      const b = imageData[idx + 2];
      const lum = (r + g + b) / 3;
      if (lum < 180) continue;

      const chroma = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
      if (chroma > 42) continue;

      // 상하좌우 외곽 링 픽셀이 흰색 운동화나 넓은 흰색 벽/카드가 아닌 타석 매트(어두운 녹색/잔디)인지 검증
      const idxL = (y * width + (x - ringDistX)) * 4;
      const idxR = (y * width + (x + ringDistX)) * 4;
      const idxU = ((y - ringDistY) * width + x) * 4;
      const idxD = ((y + ringDistY) * width + x) * 4;

      const bgR = (imageData[idxL] + imageData[idxR] + imageData[idxU] + imageData[idxD]) * 0.25;
      const bgG = (imageData[idxL + 1] + imageData[idxR + 1] + imageData[idxU + 1] + imageData[idxD + 1]) * 0.25;
      const bgB = (imageData[idxL + 2] + imageData[idxR + 2] + imageData[idxU + 2] + imageData[idxD + 2]) * 0.25;
      const bgLum = (bgR + bgG + bgB) / 3;
      if (bgLum > 168) continue;

      const localContrast = lum - bgLum;
      if (localContrast < 28) continue;

      const greenExcess = Math.max(0, (bgG - bgR) + (bgG - bgB));
      if (greenExcess < 10 && !isDTLStance) continue;

      // 그립(gx, gy)에서 후보점(x, y)까지 이어지는 사선 샤프트 에지 연속성 점수 합산
      let shaftContrastSum = 0;
      let shaftValid = 0;
      const dxRay = x - gx;
      const dyRay = y - gy;
      const rayLen = Math.hypot(dxRay, dyRay);
      if (rayLen > 20) {
        const nx = -dyRay / rayLen;
        const ny = dxRay / rayLen;
        for (let s = 3; s <= 9; s++) {
          const u = s / 11;
          const sx = Math.round(gx + dxRay * u);
          const sy = Math.round(gy + dyRay * u);
          const lx = Math.round(sx + nx * 2.5);
          const ly = Math.round(sy + ny * 2.5);
          const rx = Math.round(sx - nx * 2.5);
          const ry = Math.round(sy - ny * 2.5);
          if (lx < 2 || lx >= width - 2 || rx < 2 || rx >= width - 2 || ly < 2 || ly >= height - 2 || ry < 2 || ry >= height - 2) {
            continue;
          }
          const ic = (sy * width + sx) * 4;
          const il = (ly * width + lx) * 4;
          const ir = (ry * width + rx) * 4;
          const lc = (imageData[ic] + imageData[ic + 1] + imageData[ic + 2]) / 3;
          const ll = (imageData[il] + imageData[il + 1] + imageData[il + 2]) / 3;
          const lr = (imageData[ir] + imageData[ir + 1] + imageData[ir + 2]) / 3;
          shaftContrastSum += Math.abs(lc - ll) + Math.abs(lc - lr);
          shaftValid++;
        }
      }
      const shaftBonus = shaftValid > 0 ? (shaftContrastSum / shaftValid) * 0.85 : 0;
      const score = (lum - chroma) + localContrast * 0.85 + greenExcess * 0.75 + shaftBonus;

      if (score > bestDtlScore) {
        bestDtlScore = score;
        dtlPeakXNorm = x / width;
        dtlPeakYNorm = y / height;
      }
    }
  }

  let detectedHeadX = null;
  let detectedHeadY = null;
  let detectedBallX = null;
  let detectedBallY = null;

  if (bestDtlScore > 225 && dtlPeakXNorm !== null && dtlPeakYNorm !== null && (isDTLStance || bestDtlScore > 275)) {
    isDTLStance = true;
    // 피크 주변의 밝은 클럽헤드+골프공 클러스터에서 중심(클럽헤드)과 전방 끝단(헤드 앞쪽 실제 공 위치)을 정밀 분리
    const radX = Math.max(4, Math.round(width * 0.022));
    const radY = Math.max(4, Math.round(height * 0.016));
    const cxPx = Math.round(dtlPeakXNorm * width);
    const cyPx = Math.round(dtlPeakYNorm * height);

    let sumX = 0;
    let sumY = 0;
    let sumW = 0;
    let minClusterX = dtlPeakXNorm;
    let maxClusterX = dtlPeakXNorm;

    for (let yy = Math.max(2, cyPx - radY); yy <= Math.min(height - 3, cyPx + radY); yy++) {
      for (let xx = Math.max(2, cxPx - radX); xx <= Math.min(width - 3, cxPx + radX); xx++) {
        const idx = (yy * width + xx) * 4;
        const r = imageData[idx];
        const g = imageData[idx + 1];
        const b = imageData[idx + 2];
        const lum = (r + g + b) / 3;
        const chroma = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
        if (lum >= 182 && chroma <= 42) {
          const nx = xx / width;
          const ny = yy / height;
          const w = lum - 175;
          sumX += nx * w;
          sumY += ny * w;
          sumW += w;
          if (nx < minClusterX) minClusterX = nx;
          if (nx > maxClusterX) maxClusterX = nx;
        }
      }
    }

    const centroidX = sumW > 0 ? sumX / sumW : dtlPeakXNorm;
    const centroidY = sumW > 0 ? sumY / sumW : dtlPeakYNorm;
    const clusterSpanX = maxClusterX - minClusterX;
    const frontEdgeX = dirSign > 0 ? maxClusterX : minClusterX;

    if (clusterSpanX >= 0.010) {
      // 흰색/실버 드라이버 헤드 + 공이 함께 잡힌 경우: 샤프트 끝 헤드는 클러스터 안쪽 중심에, 실제 공은 헤드 바로 앞쪽에 위치
      detectedHeadX = clamp(centroidX - dirSign * 0.003, 0.04, 0.96);
      detectedHeadY = clamp(centroidY, 0.04, 0.95);
      detectedBallX = clamp(
        dirSign > 0
          ? Math.max(detectedHeadX + 0.015, frontEdgeX + 0.004)
          : Math.min(detectedHeadX - 0.015, frontEdgeX - 0.004),
        0.04,
        0.96
      );
      detectedBallY = clamp(detectedHeadY - 0.003, 0.04, 0.95);
    } else {
      // 어두운 색 클럽헤드 앞에 흰색 골프공만 단독으로 밝게 잡힌 경우: 클러스터 중심이 곧 공 위치이며 헤드는 그 바로 안쪽
      detectedBallX = clamp(centroidX + dirSign * 0.003, 0.04, 0.96);
      detectedBallY = clamp(centroidY, 0.04, 0.95);
      detectedHeadX = clamp(detectedBallX - dirSign * 0.015, 0.04, 0.96);
      detectedHeadY = clamp(detectedBallY + 0.002, 0.04, 0.95);
    }
  }

  // 2) 정면(Face-On) 뷰일 때 양발 접지선 아래 타석 매트 영역([ankleY + 0.065, ankleY + 0.175])에서 골프공 및 클럽헤드 탐색
  if (detectedHeadX === null || detectedHeadY === null) {
    if (!isDTLStance) {
      const roiY0 = Math.max(4, Math.floor(height * clamp(ankleY + 0.065, 0.54, 0.86)));
      const roiY1 = Math.min(height - 6, Math.ceil(height * clamp(ankleY + 0.175, 0.64, 0.93)));
      const roiX0 = Math.max(6, Math.floor(width * clamp(grip.x - 0.075, 0.04, 0.90)));
      const roiX1 = Math.min(width - 6, Math.ceil(width * clamp(grip.x + 0.055, 0.08, 0.95)));

      let bestBallScore = -1;
      let ballXNorm = null;
      let ballYNorm = null;

      for (let y = roiY0; y <= roiY1; y += 2) {
        for (let x = roiX0; x <= roiX1; x += 2) {
          const idx = (y * width + x) * 4;
          const r = imageData[idx];
          const g = imageData[idx + 1];
          const b = imageData[idx + 2];
          const lum = (r + g + b) / 3;
          if (lum < 175) continue;

          const chroma = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
          const achr = lum - chroma * 1.2;
          if (achr < 155) continue;

          const ringDist = 7;
          if (x - ringDist < 2 || x + ringDist >= width - 2 || y - ringDist < 2 || y + ringDist >= height - 2) continue;
          const idxL = (y * width + (x - ringDist)) * 4;
          const idxR = (y * width + (x + ringDist)) * 4;
          const idxU = ((y - ringDist) * width + x) * 4;
          const idxD = ((y + ringDist) * width + x) * 4;
          const bgLum = (
            imageData[idxL] + imageData[idxL + 1] + imageData[idxL + 2] +
            imageData[idxR] + imageData[idxR + 1] + imageData[idxR + 2] +
            imageData[idxU] + imageData[idxU + 1] + imageData[idxU + 2] +
            imageData[idxD] + imageData[idxD + 1] + imageData[idxD + 2]
          ) / 12;

          const localContrast = lum - bgLum;
          if (localContrast < 28) continue;

          const score = achr + localContrast * 0.65;
          if (score > bestBallScore) {
            bestBallScore = score;
            ballXNorm = x / width;
            ballYNorm = y / height;
          }
        }
      }

      if (bestBallScore > 185 && ballXNorm !== null && ballYNorm !== null) {
        detectedBallX = clamp(ballXNorm, 0.04, 0.96);
        detectedBallY = clamp(ballYNorm, 0.04, 0.95);
        detectedHeadX = clamp(ballXNorm - dirSign * 0.013, 0.04, 0.96);
        detectedHeadY = clamp(ballYNorm - 0.003, 0.04, 0.95);
      }
    }
  }

  // 3) 폴백: 샤프트 선적분 탐색
  if (detectedHeadX === null || detectedHeadY === null) {
    const minAngle = isDTLStance ? 0.52 : 0.88;
    const maxAngle = isDTLStance ? 1.18 : 1.92;
    const angleSteps = 36;

    const minLenNorm = isDTLStance ? 0.16 : clamp((ankleY - grip.y) + 0.085, 0.25, 0.36);
    const maxLenNorm = isDTLStance ? 0.28 : clamp((ankleY - grip.y) + 0.165, 0.30, 0.40);

    let bestScore = -1;
    let bestAngle = defaultAngle;
    let bestLenNorm = defaultLen;

    for (let aIdx = 0; aIdx <= angleSteps; aIdx++) {
      const theta = minAngle + (maxAngle - minAngle) * (aIdx / angleSteps);
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const nx = -sinT;
      const ny = cosT;

      for (let lStep = 0; lStep <= 4; lStep++) {
        const candLenNorm = minLenNorm + (maxLenNorm - minLenNorm) * (lStep / 4);
        const maxPx = candLenNorm * height;
        if (gy + sinT * maxPx >= height - 6) continue;

        let edgeSum = 0;
        let validSamples = 0;
        const numSamples = 18;

        for (let s = 10; s <= numSamples; s++) {
          const r = (s / numSamples) * maxPx;
          const sx = Math.round(gx + cosT * r);
          const sy = Math.round(gy + sinT * r);
          const lx = Math.round(sx + nx * 2.5);
          const ly = Math.round(sy + ny * 2.5);
          const rx = Math.round(sx - nx * 2.5);
          const ry = Math.round(sy - ny * 2.5);

          if (lx < 2 || lx >= width - 2 || rx < 2 || rx >= width - 2 || ly < 2 || ly >= height - 2 || ry < 2 || ry >= height - 2) {
            continue;
          }

          const idxC = (sy * width + sx) * 4;
          const idxL = (ly * width + lx) * 4;
          const idxR = (ry * width + rx) * 4;

          const lumC = imageData[idxC] * 0.3 + imageData[idxC + 1] * 0.59 + imageData[idxC + 2] * 0.11;
          const lumL = imageData[idxL] * 0.3 + imageData[idxL + 1] * 0.59 + imageData[idxL + 2] * 0.11;
          const lumR = imageData[idxR] * 0.3 + imageData[idxR + 1] * 0.59 + imageData[idxR + 2] * 0.11;

          const lineContrast = Math.abs(lumC - lumL) + Math.abs(lumC - lumR);
          edgeSum += lineContrast;
          validSamples++;
        }

        if (validSamples < 6) continue;
        const targetTheta = isDTLStance ? 0.78 : 1.62;
        const priorWeight = 1.0 - 0.18 * Math.abs(theta - targetTheta);
        const score = (edgeSum / validSamples) * priorWeight;

        if (score > bestScore) {
          bestScore = score;
          bestAngle = theta;
          bestLenNorm = candLenNorm;
        }
      }
    }

    detectedHeadX = clamp(grip.x + Math.cos(bestAngle) * bestLenNorm, 0.04, 0.96);
    detectedHeadY = clamp(grip.y + Math.sin(bestAngle) * bestLenNorm, 0.04, 0.95);
    detectedBallX = clamp(detectedHeadX + dirSign * 0.016, 0.04, 0.96);
    detectedBallY = clamp(detectedHeadY - 0.003, 0.04, 0.95);
  }

  // 4) 2-Point 실제 샤프트 브라이트 릿지(Ridge) 직선 정밀 피팅:
  let bestTopX = grip.x;
  let bestRidgeScore = -1e9;
  const sideStepPx = Math.max(3, Math.round(width * 0.0068));

  for (let offsetX = -0.035; offsetX <= 0.048; offsetX += 0.0015) {
    const candTopX = clamp(grip.x + offsetX, 0.04, 0.96);
    let ridgeSum = 0;
    let ridgeHits = 0;

    for (let u = 0.34; u <= 0.94; u += 0.025) {
      const ny = grip.y + (detectedHeadY - grip.y) * u;
      const nx = candTopX + (detectedHeadX - candTopX) * u;
      const px = Math.round(nx * width);
      const py = Math.round(ny * height);
      if (px - sideStepPx < 1 || px + sideStepPx >= width - 1 || py < 1 || py >= height - 1) continue;

      const idxC = (py * width + px) * 4;
      const idxL = (py * width + (px - sideStepPx)) * 4;
      const idxR = (py * width + (px + sideStepPx)) * 4;

      const rC = imageData[idxC];
      const gC = imageData[idxC + 1];
      const bC = imageData[idxC + 2];
      const lumC = 0.299 * rC + 0.587 * gC + 0.114 * bC;
      const lumL = 0.299 * imageData[idxL] + 0.587 * imageData[idxL + 1] + 0.114 * imageData[idxL + 2];
      const lumR = 0.299 * imageData[idxR] + 0.587 * imageData[idxR + 1] + 0.114 * imageData[idxR + 2];

      const ridge = lumC - Math.max(lumL, lumR);
      const cyanMetal = Math.max(0, (gC - rC) * 0.75 + (bC - rC) * 0.55);
      if (ridge > 5) {
        ridgeSum += ridge + cyanMetal * 0.45;
        ridgeHits++;
      } else {
        ridgeSum -= 6;
      }
    }

    const totalScore = ridgeSum + ridgeHits * 11 - Math.abs(offsetX) * 60;
    if (totalScore > bestRidgeScore) {
      bestRidgeScore = totalScore;
      bestTopX = candTopX;
    }
  }

  const refinedGrip = {
    x: clamp(bestTopX, 0.04, 0.96),
    y: clamp(grip.y, 0.04, 0.95)
  };
  const finalAngle = Math.atan2(detectedHeadY - refinedGrip.y, detectedHeadX - refinedGrip.x);
  const finalLenNorm = Math.hypot(detectedHeadX - refinedGrip.x, detectedHeadY - refinedGrip.y);

  // 골프채 끝 헤드 바로 앞쪽의 실제 공 위치 확정
  const finalBallPoint = {
    x: Number(clamp(detectedBallX ?? (detectedHeadX + dirSign * 0.016), 0.04, 0.96).toFixed(4)),
    y: Number(clamp(detectedBallY ?? (detectedHeadY - 0.003), 0.04, 0.95).toFixed(4))
  };

  return {
    grip: refinedGrip,
    clubHead: {
      x: detectedHeadX,
      y: detectedHeadY,
      shaftAngle: finalAngle,
      pinned: false
    },
    ballPoint: finalBallPoint,
    shaftLengthNorm: finalLenNorm,
    isDTL: isDTLStance
  };
}

/**
 * 어드레스(Address) 시점에 인식된 골프채(그립·헤드·샤프트 길이·어드레스 각도)를 기준으로,
 * 스윙 전체 구간의 그립 및 클럽 헤드 궤적을 7단계 키프레임(팔로우스루 시 양팔 지면 수평 포함) 및
 * 실제 비디오 손목 위치에 맞춰 위상 선행 없이 매끄럽게 정합합니다.
 */
export function regularizeSwingWithAddressClub(samples, keyMoments, addressClub, hand = 'right') {
  if (!samples || !samples.length || !addressClub) return samples;

  const ASPECT = clamp(addressClub.aspect || (16 / 9), 0.55, 2.4);
  const momentsMap = Object.fromEntries((keyMoments || []).map(m => [m.key, m.time]));
  const startT = samples[0]?.time ?? 0;
  const endT = samples.at(-1)?.time ?? 3.2;

  const tAddr = momentsMap.address ?? 0.45;
  const tTop = momentsMap.top ?? (tAddr + 1.0);
  const tBack = momentsMap.backswing ?? (tAddr + (tTop - tAddr) * 0.52);
  const tEarlyBack = tAddr + (tBack - tAddr) * 0.53;
  const tImpact = momentsMap.impact ?? (tTop + 0.33);
  const tDown = momentsMap.downswing ?? (tTop + (tImpact - tTop) * 0.52);
  const tDelivery = tDown + (tImpact - tDown) * 0.56;
  const tFinish = momentsMap.finish ?? Math.min(endT, tImpact + 0.84);
  const tFollow = momentsMap.follow ?? (tImpact + (tFinish - tImpact) * 0.36);
  const tRelease = tImpact + (tFollow - tImpact) * 0.43;
  const tLateFollow = tFollow + (tFinish - tFollow) * 0.48;

  const addrSample = samples.reduce(
    (best, s) => (Math.abs((s.time ?? 0) - tAddr) < Math.abs((best.time ?? 0) - tAddr) ? s : best),
    samples[0]
  );
  const addrRawPoints = addrSample?.rawPoints || addrSample?.points;
  const addrGrip = addressClub.grip || addrSample?.rawGrip || addrSample?.grip || { x: 0.47, y: 0.49 };
  const addrHead = addressClub.clubHead || addrSample?.clubHead || { x: 0.44, y: 0.83 };
  const dxPxNorm = (addrHead.x - addrGrip.x) * ASPECT;
  const dyPxNorm = addrHead.y - addrGrip.y;
  const addrShaftAngle = Math.atan2(dyPxNorm, dxPxNorm);
  const isDTL = addrShaftAngle < 1.32;

  const addrForeshorten = isDTL ? 0.90 : 0.92;
  // 어드레스에서 인식된 실제 그립~헤드 거리(addrDistNorm)를 보존하여 어드레스·임팩트 시 타석 매트 볼 위치까지 100% 도달하도록 보장
  const addrDistNorm = clamp(Math.hypot(dxPxNorm, dyPxNorm), isDTL ? 0.11 : 0.25, 0.42);
  const baseShaftLenY = clamp(
    addrDistNorm / addrForeshorten,
    isDTL ? 0.13 : 0.278,
    0.345
  );

  const dirSign = hand === 'left' ? -1 : 1;
  const halfPi = Math.PI * 0.5;
  const exactAddrShaftAngle = isDTL
    ? clamp(addrShaftAngle, 0.45, 1.32)
    : clamp(addrShaftAngle, halfPi - 0.28, halfPi + 0.36);

  // 어드레스 프레임의 실제 어깨 중심과 그립(손) 사이의 거리로부터 골퍼의 기준 팔 길이(baseArmLenY) 산출
  let measuredArmLenY = isDTL ? 0.162 : 0.184;
  if (addrRawPoints?.[11] && addrRawPoints?.[12]) {
    const shX = (addrRawPoints[11].x + addrRawPoints[12].x) * 0.5;
    const shY = (addrRawPoints[11].y + addrRawPoints[12].y) * 0.5;
    const rawArmDist = Math.hypot((addrGrip.x - shX) * ASPECT, addrGrip.y - shY);
    if (rawArmDist > 0.11) {
      measuredArmLenY = rawArmDist / (isDTL ? 0.96 : 0.94);
    }
  }
  const baseArmLenY = clamp(measuredArmLenY, isDTL ? 0.155 : 0.172, 0.202);
  const addrGripAngle = isDTL ? 1.02 : (halfPi - dirSign * 0.025);
  const addrArmLen = baseArmLenY * (isDTL ? 0.96 : 0.94);

  const basePivotX = addrGrip.x - Math.cos(addrGripAngle) * (addrArmLen / ASPECT);
  const basePivotY = addrGrip.y - Math.sin(addrGripAngle) * addrArmLen;

  const keyTimes = [
    startT,
    tAddr,
    tEarlyBack,
    tBack,
    tTop,
    tDown,
    tDelivery,
    tImpact,
    tRelease,
    tFollow,
    tLateFollow,
    tFinish,
    endT
  ];

  const gripAngles = isDTL
    ? [1.04, 1.02, 1.32, 1.72, 3.92, 2.15, 1.42, 0.96, 0.48, 0.00, -0.88, -1.92, -1.95]
    : [
        addrGripAngle,
        addrGripAngle,              // 01 어드레스 (실제 어드레스 손 위치 100% 일치)
        halfPi + dirSign * 0.34,    // 초기 원피스 테이크어웨이 (7시 30분 클럽 출발)
        halfPi + dirSign * 0.95,    // 02 테이크어웨이 / 백스윙 (허리~명치 높이 실제 손 위치)
        halfPi + dirSign * 2.66,    // 03 백스윙 탑 (머리/오른쪽 어깨 바로 위 포지션)
        halfPi + dirSign * 1.28,    // 04 다운스윙 인사이드 슬롯
        halfPi + dirSign * 0.42,    // 다운스윙 딜리버리 P6
        halfPi - dirSign * 0.12,    // 05 임팩트 핸드퍼스트 (실제 임팩트 손 위치)
        halfPi - dirSign * 0.86,    // 릴리스 익스텐션 (원본 영상의 실제 손 높이와 일치)
        halfPi - dirSign * 1.22,    // 06 팔로우스루 (원본 영상의 뻗어진 실제 손 위치와 일치)
        halfPi - dirSign * 1.95,    // 팔로우스루 상단 폴딩 (손이 왼쪽 어깨/귀 옆으로 상승)
        halfPi - dirSign * 2.32,    // 07 피니시 (왼쪽 귀·어깨 옆 피니시 손 위치)
        halfPi - dirSign * 2.35
      ];

  const shaftAngles = isDTL
    ? [exactAddrShaftAngle, exactAddrShaftAngle, 1.30, 1.96, 4.92, 3.45, 2.18, exactAddrShaftAngle, 0.56, 0.06, -1.65, -4.35, -4.48]
    : [
        exactAddrShaftAngle,
        exactAddrShaftAngle,                // 01 어드레스 (실제 골프채 샤프트·헤드 각도와 100% 일치)
        halfPi + dirSign * 0.78,            // 초기 테이크어웨이 (+134.7° 7시 30분 방향)
        halfPi + dirSign * 1.62,            // 02 테이크어웨이 / 백스윙 (+182.8° 9시 수평 테이크어웨이)
        halfPi + dirSign * 4.86,            // 03 백스윙 탑 (+368.5° 머리 뒤로 넘어와 우측 3시 15분 방향 코일링)
        halfPi + dirSign * 3.36,            // 04 다운스윙 (강한 레깅 유지 - 절대 앞서지 않음)
        halfPi + dirSign * 1.62,            // 다운스윙 딜리버리 P6 (샤프트 수평 레깅)
        exactAddrShaftAngle + dirSign * 0.04, // 05 임팩트 (핸드퍼스트 뒤에서 실제 볼 위치 스퀘어 타격)
        halfPi - dirSign * 0.78,            // 릴리스 턴오버 (실제 손 위치에서 시원하게 뻗음)
        halfPi - dirSign * (halfPi - 0.06), // 06 팔로우스루 (실제 손 위치에서 지면 수평 방향으로 샤프트 전체 길이만큼 연장)
        halfPi - dirSign * 3.35,            // 팔로우스루 상단: 클럽헤드가 머리 위(12시~11시)를 통과하는 구간
        halfPi - dirSign * 4.96,            // 07 피니시: 클럽헤드가 머리를 완전히 넘어서 목·어깨 뒤 좌측(8시 30분) 헤드 위치까지 도달!
        halfPi - dirSign * 5.08
      ];

  // 백스윙 탑(0.65)에서는 머리 뒤로 넘어간 클럽 헤드가 우측 어깨 너머에 자연스럽게 위치하고,
  // 임팩트(1.00) -> 릴리스(1.06) -> 팔로우스루(1.08)에서는 샤프트 전체 길이만큼 연장되며,
  // 피니시(0.80)에서도 머리를 지나 넘어간 클럽헤드 위치까지 샤프트와 헤드가 명확하게 표현됨
  const shaftForeshortenSeries = isDTL
    ? [0.90, 0.90, 0.74, 0.62, 0.86, 0.66, 0.80, 0.98, 0.96, 0.92, 0.76, 0.74, 0.74]
    : [0.92, 0.92, 0.96, 0.98, 0.65, 0.72, 0.88, 1.00, 1.06, 1.08, 0.82, 0.80, 0.80];

  // 정면(Face-On) 3D 스윙 아크 투영을 반영하여 릴리스(0.68)·팔로우스루(0.66) 시
  // 가상의 팔이 벽면 밖으로 과도하게 밀려나지 않고 원본 스윙 영상의 실제 손 위치(nx ≈ 0.580, ny ≈ 0.372)에 정확히 도달하도록 설정
  const armForeshortenSeries = isDTL
    ? [0.96, 0.96, 0.92, 0.88, 0.84, 0.82, 0.90, 0.98, 1.02, 1.04, 0.78, 0.68, 0.68]
    : [0.94, 0.94, 0.92, 0.88, 0.72, 0.80, 0.88, 0.94, 0.68, 0.66, 0.55, 0.46, 0.46];

  // 구간별 리드/트레일 팔꿈치 굽힘 계수(k): k=0.032일 때 약 173° 완전 신전, k=0.38일 때 약 105° 폴딩
  const leadElbowBendSeries = [0.040, 0.038, 0.042, 0.048, 0.115, 0.075, 0.048, 0.035, 0.032, 0.032, 0.160, 0.340, 0.350];
  const trailElbowBendSeries = [0.055, 0.052, 0.085, 0.180, 0.380, 0.280, 0.160, 0.065, 0.035, 0.034, 0.140, 0.320, 0.330];

  const faceOpenSeries = [0, 0, 18, 38, 54, 36, 18, 0, -36, -50, -58, -64, -64];

  const pchip = (times, values, t) => {
    const n = times.length;
    if (t <= times[0]) return values[0];
    if (t >= times[n - 1]) return values[n - 1];
    const h = [];
    const d = [];
    for (let i = 0; i < n - 1; i++) {
      const dt = Math.max(1e-4, times[i + 1] - times[i]);
      h.push(dt);
      d.push((values[i + 1] - values[i]) / dt);
    }
    const m = new Array(n);
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0;
      else {
        const w1 = 2 * h[i] + h[i - 1];
        const w2 = h[i] + 2 * h[i - 1];
        m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
      }
    }
    let seg = 0;
    while (seg < n - 2 && t > times[seg + 1]) seg++;
    const dt = h[seg];
    const u = clamp((t - times[seg]) / dt, 0, 1);
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * values[seg] +
      (u3 - 2 * u2 + u) * dt * m[seg] +
      (-2 * u3 + 3 * u2) * values[seg + 1] +
      (u3 - u2) * dt * m[seg + 1]
    );
  };

  const solveAnatomicalElbow = (shoulder, wrist, bendK) => {
    const mx = (shoulder.x + wrist.x) * 0.5;
    const my = (shoulder.y + wrist.y) * 0.5;
    const dx = (wrist.x - shoulder.x) * ASPECT;
    const dy = wrist.y - shoulder.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-4) {
      return { x: mx, y: my, z: 0, visibility: 0.96 };
    }
    // 팔꿈치가 항상 중력/몸통 안쪽(아래쪽, ny >= 0)으로 자연스럽게 살짝 굽도록 법선 방향 선택
    let nx = -dy / dist;
    let ny = dx / dist;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const offset = dist * bendK;
    return {
      x: clamp(mx + (nx * offset) / ASPECT, 0.03, 0.97),
      y: clamp(my + ny * offset, 0.03, 0.96),
      z: 0,
      visibility: 0.96
    };
  };

  // 백스윙 구간(tAddr ~ tTop)에서 골퍼의 실제 손 높이·이동 진행률을 반영하여
  // 어드레스·테이크어웨이/백스윙·백스윙 탑의 타이밍이 실제 영상과 어긋나지 않도록 동기화
  const topSample = samples.reduce(
    (best, s) => (Math.abs((s.time ?? 0) - tTop) < Math.abs((best.time ?? 0) - tTop) ? s : best),
    samples[0]
  );
  const topRawGrip = topSample?.rawGrip || topSample?.grip;
  const addrGripY = (addrSample?.rawGrip || addrSample?.grip)?.y ?? addrGrip.y;
  const addrGripX = (addrSample?.rawGrip || addrSample?.grip)?.x ?? addrGrip.x;
  const topGripY = Math.min(addrGripY - 0.14, topRawGrip?.y ?? (addrGripY - 0.24));
  const backGripSpanY = Math.max(0.12, addrGripY - topGripY);

  let prevEffBackTime = tAddr;

  return samples.map(s => {
    const time = s.time;
    const rawGrip = s.rawGrip || (s.grip ? { ...s.grip } : null);
    const rawPoints = s.rawPoints || (Array.isArray(s.points) ? s.points.map(p => (p ? { ...p } : p)) : null);
    let evalTime = time;

    if (time > tAddr && time < tTop && rawGrip && Number.isFinite(rawGrip.y)) {
      const obsRise = clamp((addrGripY - rawGrip.y) / backGripSpanY, 0, 1);
      const obsShift = clamp(((addrGripX - rawGrip.x) * dirSign) / 0.075, 0, 1);
      let blendedTime;
      if (obsRise <= 0.28) {
        const uSub = clamp((obsRise / 0.28) * 0.68 + obsShift * 0.32, 0, 1);
        const obsTime = tAddr + uSub * (tBack - tAddr);
        blendedTime = Math.max(time, obsTime * 0.65 + time * 0.35);
      } else {
        const uSub = clamp((obsRise - 0.28) / 0.72, 0, 1);
        const obsTime = tBack + uSub * (tTop - tBack);
        blendedTime = obsTime * 0.75 + time * 0.25;
      }
      evalTime = clamp(Math.max(prevEffBackTime, blendedTime), tAddr, tTop - 1e-4);
      prevEffBackTime = evalTime;
    } else if (time >= tTop) {
      prevEffBackTime = tTop;
    }

    const gripAngle = pchip(keyTimes, gripAngles, evalTime);
    const shaftAngle = pchip(keyTimes, shaftAngles, evalTime);
    const shaftForeshorten = pchip(keyTimes, shaftForeshortenSeries, evalTime);
    const armForeshorten = pchip(keyTimes, armForeshortenSeries, evalTime);
    const leadBendK = pchip(keyTimes, leadElbowBendSeries, evalTime);
    const trailBendK = pchip(keyTimes, trailElbowBendSeries, evalTime);
    const faceOpenDeg = Number(pchip(keyTimes, faceOpenSeries, evalTime).toFixed(1));

    const effArmLenY = baseArmLenY * armForeshorten;
    const upperEffLenY = baseShaftLenY * shaftForeshorten;
    // 지면(6시 방향, exactAddrShaftAngle 부근)을 향하는 어드레스 및 임팩트 구간에서는
    // 타석 매트 위의 실제 볼·클럽헤드 거리(addrDistNorm)까지 정확히 도달하도록 보간
    const groundReach = Math.pow(Math.max(0, Math.cos(shaftAngle - exactAddrShaftAngle)), 2);
    const effShaftLenY = upperEffLenY + Math.max(0, addrDistNorm - upperEffLenY) * groundReach;

    // 매 프레임 실제 골퍼의 양 어깨 중점(rawPoints[11], rawPoints[12])을 반영하여 상체 회전축이 벽면 쪽으로 밀리지 않도록 정합
    let curPivotX = basePivotX;
    let curPivotY = basePivotY;
    if (rawPoints?.[11] && rawPoints?.[12] && visible(rawPoints[11], 0.35) && visible(rawPoints[12], 0.35)) {
      const shMidX = (rawPoints[11].x + rawPoints[12].x) * 0.5;
      const shMidY = (rawPoints[11].y + rawPoints[12].y) * 0.5;
      curPivotX = basePivotX * 0.45 + shMidX * 0.55;
      curPivotY = basePivotY * 0.45 + shMidY * 0.55;
    }

    const modelGx = curPivotX + Math.cos(gripAngle) * (effArmLenY / ASPECT);
    const modelGy = curPivotY + Math.sin(gripAngle) * effArmLenY;

    // 1) 어드레스(time <= tAddr): 실제 인식된 어드레스 손 위치(addrGrip)와 100% 일치
    // 2) 스윙 구간(time > tAddr):
    //    - 테이크어웨이/백스윙 ~ 탑(time <= tDown): 실제 감지된 손 위치(rawGrip)를 높은 비중(68%)으로 추종
    //    - 다운스윙 ~ 임팩트 ~ 팔로우스루 ~ 피니시(time > tDown): 정합된 실제 팔 도달 궤적(modelGx, modelGy)을 기준으로 하되,
    //      MediaPipe가 감지한 실제 손 위치(rawGrip)가 유효 범위 내에 있을 때 적응형으로 블렌딩하여 원본 영상의 손 위치와 일치시킴
    let gx = modelGx;
    let gy = modelGy;
    if (time <= tAddr + 0.005) {
      gx = addrGrip.x;
      gy = addrGrip.y;
    } else if (rawGrip && Number.isFinite(rawGrip.x) && Number.isFinite(rawGrip.y)) {
      if (time <= tDown) {
        const isValidBackGrip = rawGrip.y <= addrGripY + 0.05 && rawGrip.y >= 0.12 && Math.abs(rawGrip.x - curPivotX) <= 0.24;
        if (isValidBackGrip) {
          const startRamp = clamp((time - tAddr) / 0.06, 0, 1);
          const phaseTaper = time <= tTop
            ? 1.0
            : clamp(1.0 - (time - tTop) / Math.max(0.05, tDown - tTop), 0, 1);
          const w = 0.68 * startRamp * phaseTaper;
          gx = rawGrip.x * w + modelGx * (1 - w);
          gy = rawGrip.y * w + modelGy * (1 - w);
        }
      } else {
        const distToModel = Math.hypot((rawGrip.x - modelGx) * ASPECT, rawGrip.y - modelGy);
        const distFromPivot = Math.hypot((rawGrip.x - curPivotX) * ASPECT, rawGrip.y - curPivotY);
        if (distToModel <= 0.075 && distFromPivot >= 0.095) {
          const w = 0.52 * (1.0 - distToModel / 0.075);
          gx = rawGrip.x * w + modelGx * (1 - w);
          gy = rawGrip.y * w + modelGy * (1 - w);
        }
      }
    }

    const hx = time <= tAddr + 0.005
      ? addrHead.x
      : clamp(gx + Math.cos(shaftAngle) * (effShaftLenY / ASPECT), 0.02, 0.98);
    const hy = time <= tAddr + 0.005
      ? addrHead.y
      : clamp(gy + Math.sin(shaftAngle) * effShaftLenY, 0.02, 0.97);

    // 스켈레톤의 양팔(팔꿈치 13·14, 손목 15·16, 손끝 19·20)도 원본 영상과 일치된 손 위치(gx, gy)에 맞춰 동기화
    let updatedPoints = rawPoints ? rawPoints.map(p => (p ? { ...p } : p)) : s.points;
    if (Array.isArray(updatedPoints) && updatedPoints.length >= 21 && updatedPoints[11] && updatedPoints[12]) {
      const isRight = hand !== 'left';
      const leadShIdx = isRight ? 11 : 12;
      const trailShIdx = isRight ? 12 : 11;
      const leadElIdx = isRight ? 13 : 14;
      const trailElIdx = isRight ? 14 : 13;
      const leadWrIdx = isRight ? 15 : 16;
      const trailWrIdx = isRight ? 16 : 15;
      const leadHandIdx = isRight ? 19 : 20;
      const trailHandIdx = isRight ? 20 : 19;

      const leadWrist = {
        x: clamp(gx + dirSign * 0.002, 0.02, 0.98),
        y: clamp(gy - 0.001, 0.02, 0.97),
        z: 0,
        visibility: 0.98
      };
      const trailWrist = {
        x: clamp(gx - dirSign * 0.002, 0.02, 0.98),
        y: clamp(gy + 0.001, 0.02, 0.97),
        z: 0,
        visibility: 0.98
      };

      updatedPoints[leadWrIdx] = leadWrist;
      updatedPoints[trailWrIdx] = trailWrist;
      updatedPoints[leadElIdx] = solveAnatomicalElbow(updatedPoints[leadShIdx], leadWrist, leadBendK);
      updatedPoints[trailElIdx] = solveAnatomicalElbow(updatedPoints[trailShIdx], trailWrist, trailBendK);

      const handOffsetX = Math.cos(shaftAngle) * (0.012 / ASPECT);
      const handOffsetY = Math.sin(shaftAngle) * 0.012;
      updatedPoints[leadHandIdx] = {
        x: clamp(leadWrist.x + handOffsetX, 0.02, 0.98),
        y: clamp(leadWrist.y + handOffsetY, 0.02, 0.97),
        z: 0,
        visibility: 0.96
      };
      updatedPoints[trailHandIdx] = {
        x: clamp(trailWrist.x + handOffsetX, 0.02, 0.98),
        y: clamp(trailWrist.y + handOffsetY, 0.02, 0.97),
        z: 0,
        visibility: 0.96
      };
    }

    return {
      ...s,
      aspect: ASPECT,
      rawGrip,
      rawPoints,
      points: updatedPoints,
      grip: { x: gx, y: gy },
      clubHead: {
        x: hx,
        y: hy,
        shaftAngle,
        faceOpenDeg,
        foreshorten: Number(shaftForeshorten.toFixed(3)),
        pinned: false
      },
      clubHeadBase: {
        x: hx,
        y: hy,
        shaftAngle,
        faceOpenDeg,
        foreshorten: Number(shaftForeshorten.toFixed(3))
      }
    };
  });
}

/**
 * 사용자가 수동으로 고정(pin)한 클럽 헤드 키프레임이 있을 경우,
 * 주변 프레임들의 클럽 헤드 좌표를 부드럽게 가중 보정합니다.
 */
export function applyPinnedClubHeadOverrides(samples) {
  const pinnedIndices = samples
    .map((s, idx) => (s.clubHead?.pinned ? idx : -1))
    .filter(idx => idx >= 0);

  if (!pinnedIndices.length) return samples;

  // 고정점 기준 가우시안 오프셋 전파
  const deltas = pinnedIndices.map(idx => {
    const s = samples[idx];
    const base = s.clubHeadBase || s.clubHead;
    return {
      time: s.time,
      dx: s.clubHead.x - base.x,
      dy: s.clubHead.y - base.y
    };
  });

  return samples.map(s => {
    if (!s.clubHead) return s;
    if (s.clubHead.pinned) return s;
    const base = s.clubHeadBase || s.clubHead;
    let offsetX = 0;
    let offsetY = 0;
    let weightSum = 0;
    for (const d of deltas) {
      const dt = Math.abs(s.time - d.time);
      if (dt > 0.35) continue;
      const w = Math.exp(-(dt * dt) / (2 * 0.08 * 0.08));
      offsetX += d.dx * w;
      offsetY += d.dy * w;
      weightSum += w;
    }
    if (weightSum > 1e-4) {
      return {
        ...s,
        clubHead: {
          ...base,
          x: clamp(base.x + offsetX / Math.max(1, weightSum), 0.01, 0.99),
          y: clamp(base.y + offsetY / Math.max(1, weightSum), 0.01, 0.99),
          pinned: false
        }
      };
    }
    return s;
  });
}

// ============================================================================
// Catmull-Rom Spline 곡선 보간기 (끊김 없는 프로 중계형 클럽 헤드 아크 생성)
// ============================================================================

export function interpolateCatmullRom(points, subdivisions = 6) {
  if (!points || points.length < 2) return points || [];
  if (points.length === 2) return points;

  const result = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    for (let step = 0; step < subdivisions; step++) {
      const t = step / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;

      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      );
      const time = p1.time + (p2.time - p1.time) * t;
      const speed = (p1.speed ?? 0) * (1 - t) + (p2.speed ?? 0) * t;
      const phase = t < 0.5 ? p1.phase : p2.phase;

      result.push({ x, y, time, speed, phase });
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

// ============================================================================
// 7단계 스윙 시퀀스 자동 검출기 (REA keyframes.js suggestKeyMoments 복원 및 고도화)
// ============================================================================

function trackedHandsMetric(sample) {
  const p = sample.points;
  if (!p) return null;
  const shoulders = [11, 12].filter(i => visible(p[i], 0.35));
  const hips = [23, 24].filter(i => visible(p[i], 0.35));
  const wrists = [15, 16].filter(i => visible(p[i], 0.3));
  if (!shoulders.length || !hips.length || !wrists.length) return null;

  const mean = (indices, axis) => indices.reduce((s, i) => s + p[i][axis], 0) / indices.length;
  const hipY = mean(hips, 'y');
  const shoulderY = mean(shoulders, 'y');
  const torso = Math.max(0.08, hipY - shoulderY);
  const wristY = mean(wrists, 'y');
  const wristX = mean(wrists, 'x');

  return {
    time: sample.time,
    y: (wristY - hipY) / torso, // 낮을수록(음수) 손이 높이 올라감
    x: wristX,
    wristY,
    clubY: sample.clubHead?.y ?? wristY,
    clubX: sample.clubHead?.x ?? wristX,
    clubSpeed: sample.clubSpeed ?? 0,
    videoMotion: sample.videoMotion ?? 0,
    strikeMotion: sample.strikeMotion ?? 0,
    videoTimingHint: sample.videoTimingHint || null,
    torso,
    observed: true
  };
}

export function detectSwingMoments(samples, start = 0, end = Infinity) {
  const validSamples = (samples || []).filter(s => s.time >= start && s.time <= end);
  const fallback = () => {
    const sTime = validSamples[0]?.time ?? 0;
    const eTime = validSamples.at(-1)?.time ?? 3.0;
    const dur = Math.max(0.5, eTime - sTime);
    const hint = validSamples.find(s => s.videoTimingHint)?.videoTimingHint || null;
    if (hint && Number.isFinite(hint.impactTime)) {
      const addrT = clamp(hint.addressTime ?? (sTime + 0.42), sTime, eTime - 1.2);
      const topT = clamp(hint.topTime ?? (addrT + 0.88), addrT + 0.35, eTime - 0.7);
      const impT = clamp(hint.impactTime, topT + 0.16, eTime - 0.45);
      const finT = clamp(hint.finishTime ?? (impT + 0.72), impT + 0.35, eTime);
      const times = [
        addrT,
        addrT + (topT - addrT) * 0.48,
        topT,
        topT + (impT - topT) * 0.52,
        impT,
        impT + (finT - impT) * 0.38,
        finT
      ];
      return KEY_MOMENTS.map(([key, labelKo, labelEn], i) => ({
        key,
        labelKo,
        labelEn,
        time: Number(times[i].toFixed(3)),
        source: 'sampled'
      }));
    }
    const activeSpan = Math.min(dur, 2.75);
    return KEY_MOMENTS.map(([key, labelKo, labelEn], i) => ({
      key,
      labelKo,
      labelEn,
      time: Number((sTime + (activeSpan * i) / (KEY_MOMENTS.length - 1)).toFixed(3)),
      source: 'sampled'
    }));
  };

  if (validSamples.length < 10) return fallback();

  const metrics = validSamples.map(trackedHandsMetric).filter(Boolean);
  if (metrics.length < 10) return fallback();

  // 3-포인트 중앙값 스무딩 (수직 y 및 수평 x)
  const ySmooth = metrics.map((m, i) => {
    if (i === 0 || i === metrics.length - 1) return m.y;
    return [metrics[i - 1].y, m.y, metrics[i + 1].y].sort((a, b) => a - b)[1];
  });
  const xSmooth = metrics.map((m, i) => {
    if (i === 0 || i === metrics.length - 1) return m.x;
    return [metrics[i - 1].x, m.x, metrics[i + 1].x].sort((a, b) => a - b)[1];
  });

  const avgDt = Math.max(0.015, (metrics.at(-1).time - metrics[0].time) / Math.max(1, metrics.length - 1));
  const totalTimeSpan = Math.max(0.5, metrics.at(-1).time - metrics[0].time);

  // 어드레스 기준 저점(addrBaselineY) 및 전체 스윙 수직 진폭(totalSpread) 산출
  const earlySlice = ySmooth.slice(0, Math.max(4, Math.floor(ySmooth.length * 0.48))).slice().sort((a, b) => a - b);
  const overallSorted = ySmooth.slice().sort((a, b) => a - b);
  const addrBaselineY = earlySlice.length
    ? earlySlice[Math.min(earlySlice.length - 1, Math.floor(earlySlice.length * 0.82))]
    : overallSorted[Math.min(overallSorted.length - 1, Math.floor(overallSorted.length * 0.82))];
  const globalMinY = overallSorted[0] ?? -0.6;
  const totalSpread = Math.max(0.14, addrBaselineY - globalMinY);

  // 1) [백스윙 탑(Peak 1) -> 임팩트 골짜기(Valley) -> 피니시(Peak 2)] 3단 연동(Triad) 탐색:
  // 실제 골프 스윙에서는 피니시(Peak 2)에서 손이 백스윙 탑(Peak 1)보다 더 높이 올라가는 경우가 많으므로,
  // 단순히 전체 구간 최솟값을 백스윙 탑으로 잡으면 피니시를 백스윙 탑으로 오인하여 임팩트가 스윙 종료 한참 뒤로 밀리게 됩니다.
  // 따라서 반드시 ① 직전 0.14s~0.65s 내에 높은 백스윙 탑이 있고, ② 현재 프레임에서 손이 어드레스 높이로 급강하(임팩트 골짜기)한 뒤,
  // ③ 직후 0.15s~1.15s 내에 다시 높은 팔로우스루·피니시 정점으로 치솟는 V자 골짜기(Impact Valley)를 찾아 백스윙 탑·임팩트·피니시를 동시에 확정합니다.
  let bestTriadScore = -Infinity;
  let bestTopCand = -1;
  let bestImpCand = -1;
  let bestFinCand = -1;

  const maxStrikeMotion = Math.max(1e-4, ...metrics.map(m => m.strikeMotion || 0));
  const hintObj = metrics.find(m => m.videoTimingHint)?.videoTimingHint || null;

  const impSearchStart = Math.max(3, Math.floor(metrics.length * 0.12));
  let impSearchEnd = Math.min(metrics.length - 4, Math.floor(metrics.length * 0.72));
  if (hintObj && Number.isFinite(hintObj.finishTime)) {
    const finBoundIdx = metrics.findIndex(m => m.time >= hintObj.finishTime - 0.08);
    if (finBoundIdx > impSearchStart + 4) {
      impSearchEnd = Math.min(impSearchEnd, finBoundIdx);
    }
  }

  for (let impCand = impSearchStart; impCand <= impSearchEnd; impCand++) {
    const tImp = metrics[impCand].time;
    const yImp = ySmooth[impCand];

    // 임팩트 시점에는 손이 낮은 위치(골반/어드레스 높이 근처)에 있어야 함
    if (yImp < globalMinY + totalSpread * 0.35) continue;

    // (a) 임팩트 직전 0.12s ~ 0.65s 구간에서 백스윙 탑(topCand: ySmooth 최소) 탐색
    let topCand = -1;
    let yTopMin = Infinity;
    for (let k = impCand - 2; k >= 1; k--) {
      const dtBack = tImp - metrics[k].time;
      if (dtBack < 0.11) continue;
      if (dtBack > 0.66) break;
      if (ySmooth[k] < yTopMin) {
        yTopMin = ySmooth[k];
        topCand = k;
      }
    }
    if (topCand < 0) continue;

    // (b) 임팩트 직후 0.14s ~ 1.15s 구간에서 팔로우스루·피니시 정점(finCand: ySmooth 최소) 탐색
    let finCand = -1;
    let yFinMin = Infinity;
    for (let k = impCand + 2; k < metrics.length; k++) {
      const dtFoll = metrics[k].time - tImp;
      if (dtFoll < 0.13) continue;
      if (dtFoll > 1.18) break;
      if (ySmooth[k] < yFinMin) {
        yFinMin = ySmooth[k];
        finCand = k;
      }
    }
    if (finCand < 0) continue;

    const dropFromTop = yImp - yTopMin;   // 다운스윙 하강 폭
    const riseToFinish = yImp - yFinMin;  // 임팩트 직후 피니시 상승 폭
    if (dropFromTop < totalSpread * 0.18 || riseToFinish < totalSpread * 0.22) continue;

    const dtDown = Math.max(0.11, tImp - metrics[topCand].time);
    const dtUp = Math.max(0.13, metrics[finCand].time - tImp);

    // 양방향 V자 대칭 깊이(조화평균): 백스윙 탑 하강과 피니시 상승이 모두 뚜렷할 때만 높은 점수 부여
    const valleyHarmonic = (2 * dropFromTop * riseToFinish) / Math.max(0.05, dropFromTop + riseToFinish);
    const downSpeed = dropFromTop / dtDown;
    const upSpeed = riseToFinish / dtUp;

    // 임팩트 전후 클럽/손목 순간 속도 피크 및 실제 영상 타격 영역 픽셀 모션 에너지
    let localPeakClubSpeed = 0;
    let localPeakWristSpeed = 0;
    let localStrikeRatio = 0;
    for (let mIdx = Math.max(topCand, impCand - 2); mIdx <= Math.min(finCand, impCand + 1); mIdx++) {
      localPeakClubSpeed = Math.max(localPeakClubSpeed, metrics[mIdx].clubSpeed ?? 0);
      localStrikeRatio = Math.max(localStrikeRatio, (metrics[mIdx].strikeMotion ?? 0) / maxStrikeMotion);
      const pPrev = metrics[Math.max(0, mIdx - 1)];
      const pNext = metrics[Math.min(metrics.length - 1, mIdx + 1)];
      const dtLocal = Math.max(0.015, pNext.time - pPrev.time);
      const wSpd = Math.hypot(pNext.x - pPrev.x, pNext.y - pPrev.y) / dtLocal;
      localPeakWristSpeed = Math.max(localPeakWristSpeed, wSpd);
    }

    // 실제 골프 다운스윙 소요 시간(0.16s ~ 0.46s) 보너스
    const downTempoBonus = (dtDown >= 0.15 && dtDown <= 0.48)
      ? totalSpread * 0.36
      : (dtDown > 0.55 ? -totalSpread * 0.25 : 0);

    // 임팩트 순간 손 높이가 어드레스 베이스라인에 가까울수록 가산점
    const lowHandBonus = (1.0 - clamp(Math.abs(addrBaselineY - yImp) / totalSpread, 0, 1)) * totalSpread * 0.42;

    // 실제 영상 픽셀 모션 기반 타격 시점 정합 보너스
    const videoStrikeBonus = localStrikeRatio * totalSpread * 0.48 +
      (hintObj && Number.isFinite(hintObj.impactTime)
        ? Math.max(0, 1.0 - Math.abs(tImp - hintObj.impactTime) / 0.42) * totalSpread * 0.62
        : 0);

    // 스윙 종료 후 팔을 내리는 동작보다 영상 전반~중반의 실제 본 스윙을 우선하도록 시간 가중치 부여
    const timeRatio = (tImp - metrics[0].time) / totalTimeSpan;
    const earlySwingBias = -Math.max(0, timeRatio - 0.25) * totalSpread * 0.45;

    const triadScore =
      valleyHarmonic * 2.35 +
      (dropFromTop + riseToFinish) * 0.65 +
      (downSpeed * 0.12 + upSpeed * 0.09) +
      (localPeakClubSpeed / 120) * totalSpread * 0.30 +
      Math.min(1.5, localPeakWristSpeed * 0.15) * totalSpread +
      downTempoBonus +
      lowHandBonus +
      videoStrikeBonus +
      earlySwingBias;

    if (triadScore > bestTriadScore) {
      bestTriadScore = triadScore;
      bestTopCand = topCand;
      bestImpCand = impCand;
      bestFinCand = finCand;
    }
  }

  // 만약 Triad 조건을 만족하는 구간을 못 찾은 예외 영상의 경우, 전반부(10% ~ 52%) 내에서 백스윙 탑을 탐색
  let rawTopIdx = bestTopCand;
  if (rawTopIdx < 0) {
    rawTopIdx = Math.floor(metrics.length * 0.32);
    let minTopY = Infinity;
    const searchTopStart = Math.max(2, Math.floor(metrics.length * 0.08));
    const searchTopEnd = Math.min(metrics.length - 6, Math.floor(metrics.length * 0.52));
    for (let i = searchTopStart; i <= searchTopEnd; i++) {
      if (ySmooth[i] < minTopY) {
        minTopY = ySmooth[i];
        rawTopIdx = i;
      }
    }
  }

  const minTopY = ySmooth[rawTopIdx];
  const addrHeightSpread = Math.max(0.12, addrBaselineY - minTopY);

  // 백스윙 탑 평탄부(minTopY + 6% 이내)에서 다운스윙 하강이 시작되기 직전의 정점(topIdx) 확정
  let topIdx = rawTopIdx;
  const maxTopPlateauIdx = bestImpCand > rawTopIdx
    ? Math.max(rawTopIdx, bestImpCand - 3)
    : Math.min(metrics.length - 5, rawTopIdx + 5);
  const plateauLimit = minTopY + addrHeightSpread * 0.06;
  for (let i = rawTopIdx; i <= Math.min(maxTopPlateauIdx, rawTopIdx + 5); i++) {
    if (ySmooth[i] <= plateauLimit) {
      topIdx = i;
    } else {
      break;
    }
  }

  // 2) 어드레스(address) 탐색:
  const lowHandXs = [];
  for (let i = 0; i < Math.max(2, topIdx - 2); i++) {
    if (ySmooth[i] >= addrBaselineY - addrHeightSpread * 0.08) {
      lowHandXs.push(xSmooth[i]);
    }
  }
  lowHandXs.sort((a, b) => a - b);
  const addrBaseX = lowHandXs.length
    ? lowHandXs[Math.floor(lowHandXs.length * 0.5)]
    : xSmooth[0];

  let maxHorizShift = 0.04;
  for (let i = 0; i <= topIdx; i++) {
    const shift = Math.abs(xSmooth[i] - addrBaseX);
    if (shift > maxHorizShift) maxHorizShift = shift;
  }

  let wristStartIdx = -1;
  for (let i = Math.max(1, topIdx - 3); i >= 0; i--) {
    const prev = metrics[Math.max(0, i - 1)];
    const next = metrics[Math.min(metrics.length - 1, i + 1)];
    const dt = Math.max(0.01, next.time - prev.time);
    const wristSpeed = Math.hypot(next.x - prev.x, next.y - prev.y) / dt;
    const vertRiseRatio = Math.max(0, addrBaselineY - ySmooth[i]) / addrHeightSpread;
    const horizShiftRatio = Math.abs(xSmooth[i] - addrBaseX) / maxHorizShift;
    const excursion2D = Math.hypot(horizShiftRatio * 0.85, vertRiseRatio);

    if (excursion2D <= 0.085 && wristSpeed <= 0.24) {
      wristStartIdx = i;
      break;
    }
  }

  let addrIdx = Math.max(0, Math.floor(topIdx * 0.25));
  if (wristStartIdx >= 0) {
    const lookbackStart = Math.max(0, wristStartIdx - 9);
    let bestIdx = wristStartIdx;
    let bestScore = Infinity;
    for (let k = wristStartIdx; k >= lookbackStart; k--) {
      const vertRiseRatio = Math.max(0, addrBaselineY - ySmooth[k]) / addrHeightSpread;
      const horizShiftRatio = Math.abs(xSmooth[k] - addrBaseX) / maxHorizShift;
      const excursion2D = Math.hypot(horizShiftRatio * 0.85, vertRiseRatio);
      if (excursion2D > 0.12) continue;
      const cSpeed = metrics[k].clubSpeed ?? 0;
      const score = cSpeed * 1.0 + excursion2D * 35 + (wristStartIdx - k) * 0.35;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = k;
      }
    }
    addrIdx = bestIdx;
  } else {
    let minAddrCost = Infinity;
    const maxSearchAddr = Math.max(1, Math.floor(topIdx * 0.55));
    for (let i = 0; i <= maxSearchAddr; i++) {
      const prev = metrics[Math.max(0, i - 1)];
      const next = metrics[Math.min(metrics.length - 1, i + 1)];
      const dt = Math.max(0.01, next.time - prev.time);
      const wristSpeed = Math.hypot(next.x - prev.x, next.y - prev.y) / dt;
      const vertRiseRatio = Math.max(0, addrBaselineY - ySmooth[i]) / addrHeightSpread;
      const horizShiftRatio = Math.abs(xSmooth[i] - addrBaseX) / maxHorizShift;
      const excursion2D = Math.hypot(horizShiftRatio * 0.85, vertRiseRatio);
      const cSpeed = metrics[i].clubSpeed ?? 0;
      const cost = excursion2D * 2.4 + wristSpeed * 0.35 + (cSpeed / 100) * 0.65 - (i / Math.max(1, topIdx)) * 0.10;
      if (cost < minAddrCost) {
        minAddrCost = cost;
        addrIdx = i;
      }
    }
  }

  // 3) 임팩트(impact) 정밀 확정:
  // 백스윙 탑(topIdx) 직후 ~ 피니시(bestFinCand) 이전의 다운스윙 골짜기 구간(최대 0.58초 이내)에서
  // 손과 클럽 헤드가 최저점을 통과하는 실제 타격 프레임(impIdx)을 확정합니다.
  let impWindowStart = topIdx + 2;
  let impWindowEnd = bestImpCand > topIdx
    ? Math.min(metrics.length - 3, bestImpCand + 2)
    : Math.min(metrics.length - 3, topIdx + Math.max(4, Math.round(0.55 / avgDt)));
  if (bestFinCand > topIdx + 3) {
    impWindowEnd = Math.min(impWindowEnd, bestFinCand - 2);
  }

  let wristLowIdx = bestImpCand > topIdx ? bestImpCand : impWindowStart;
  let maxImpMetric = -Infinity;
  for (let i = impWindowStart; i <= impWindowEnd; i++) {
    const dtFromTop = metrics[i].time - metrics[topIdx].time;
    if (dtFromTop > 0.62) break;
    const combinedLow = ySmooth[i] * 0.72 + metrics[i].clubY * 0.28;
    if (combinedLow > maxImpMetric) {
      maxImpMetric = combinedLow;
      wristLowIdx = i;
    }
  }

  // 다음 프레임(wristLowIdx + 1)이 아직 팔로우스루로 크게 떠오르기 전이면서 클럽 스피드가 더 빠른 경우에만 +1 프레임 보정
  let impIdx = wristLowIdx;
  if (
    wristLowIdx + 1 <= impWindowEnd &&
    ySmooth[wristLowIdx] - ySmooth[wristLowIdx + 1] <= addrHeightSpread * 0.08 &&
    (metrics[wristLowIdx + 1].clubSpeed ?? 0) >= (metrics[wristLowIdx].clubSpeed ?? 0)
  ) {
    impIdx = wristLowIdx + 1;
  }
  impIdx = clamp(impIdx, topIdx + 2, metrics.length - 3);

  // 4) 피니시(finish) 탐색: 임팩트 직후(최대 1.35초 내) 손이 가장 높이 올라간 뒤 클럽이 목·어깨 뒤로 감기는 지점
  let peakFinIdx = bestFinCand > impIdx ? bestFinCand : Math.min(metrics.length - 1, impIdx + 4);
  let minFinY = Infinity;
  for (let i = impIdx + 2; i < metrics.length; i++) {
    if (metrics[i].time - metrics[impIdx].time > 1.35) break;
    if (ySmooth[i] < minFinY) {
      minFinY = ySmooth[i];
      peakFinIdx = i;
    }
  }
  const finishWrapFrames = Math.max(2, Math.round(0.24 / avgDt));
  let finIdx = peakFinIdx;
  const maxFinSearch = Math.min(metrics.length - 1, peakFinIdx + finishWrapFrames);
  for (let i = peakFinIdx + 1; i <= maxFinSearch; i++) {
    if (ySmooth[i] <= minFinY + addrHeightSpread * 0.24) {
      finIdx = i;
    }
  }

  // 5) 중간 구간(backswing, downswing, follow) 인덱스 산출:
  // 단순 시간 비율(55%) 대신 골퍼의 실제 손 높이 상승 진행률(어드레스 대비 28% 상승하는 초기 허리~명치 통과 시점)을
  // 어드레스에서 순방향 탐색하여, 손이 어깨 위로 올라가기 전의 정확한 테이크어웨이/백스윙 프레임을 포착합니다.
  const backStartY = ySmooth[addrIdx];
  const backEndY = ySmooth[topIdx];
  const targetBackY = backStartY - (backStartY - backEndY) * 0.28;
  let backIdx = Math.round(addrIdx + (topIdx - addrIdx) * 0.36);
  let foundBackCrossing = false;
  for (let i = addrIdx + 1; i < topIdx - 1; i++) {
    if (ySmooth[i] <= targetBackY) {
      backIdx = i;
      foundBackCrossing = true;
      break;
    }
  }
  if (!foundBackCrossing) {
    let minBackDiff = Infinity;
    for (let i = addrIdx + 1; i < topIdx; i++) {
      const diff = Math.abs(ySmooth[i] - targetBackY);
      if (diff < minBackDiff) {
        minBackDiff = diff;
        backIdx = i;
      }
    }
  }

  const downStartY = ySmooth[topIdx];
  const downEndY = ySmooth[impIdx];
  const targetDownY = downStartY + (downEndY - downStartY) * 0.46;
  let downIdx = Math.round(topIdx + (impIdx - topIdx) * 0.50);
  let minDownDiff = Infinity;
  for (let i = topIdx + 1; i < impIdx; i++) {
    const diff = Math.abs(ySmooth[i] - targetDownY);
    if (diff < minDownDiff) {
      minDownDiff = diff;
      downIdx = i;
    }
  }

  const follStartY = ySmooth[impIdx];
  const follEndY = ySmooth[finIdx];
  const targetFollY = follStartY - (follStartY - follEndY) * 0.52;
  let follIdx = Math.round(impIdx + (finIdx - impIdx) * 0.38);
  let minFollDiff = Infinity;
  for (let i = impIdx + 1; i < finIdx; i++) {
    const diff = Math.abs(ySmooth[i] - targetFollY);
    if (diff < minFollDiff) {
      minFollDiff = diff;
      follIdx = i;
    }
  }

  const rawIndices = [addrIdx, backIdx, topIdx, downIdx, impIdx, follIdx, finIdx];
  // 단조 증가 보장
  for (let i = 1; i < rawIndices.length; i++) {
    if (rawIndices[i] <= rawIndices[i - 1]) {
      rawIndices[i] = Math.min(metrics.length - 1, rawIndices[i - 1] + 1);
    }
  }

  return KEY_MOMENTS.map(([key, labelKo, labelEn], idx) => {
    const m = metrics[clamp(rawIndices[idx], 0, metrics.length - 1)];
    return {
      key,
      labelKo,
      labelEn,
      time: Number(m.time.toFixed(3)),
      source: 'estimated'
    };
  });
}

// ============================================================================
// 구간별 AI 코칭 및 스윙 플레인 진단 (REA coaching.js 복원 및 한국어화)
// ============================================================================

export function evaluateSwingPhase(phaseKey, currMeasure, addressMeasure, tempoInfo) {
  const items = [];
  if (!currMeasure) return items;

  const elbow = currMeasure.elbow;
  const trailElbow = currMeasure.trailElbow;
  const lean = currMeasure.lean;
  const knee = currMeasure.knee;
  const addrLean = addressMeasure?.lean ?? lean;
  const leanDelta = (Number.isFinite(lean) && Number.isFinite(addrLean)) ? Math.round(lean - addrLean) : null;

  switch (phaseKey) {
    case 'address':
      if (Number.isFinite(lean)) {
        const goodLean = lean >= 24 && lean <= 44;
        items.push({
          status: goodLean ? 'good' : 'warn',
          title: '어드레스 척추 전경각',
          detail: goodLean
            ? `척추 기울기가 ${Math.round(lean)}°로 안정적인 셋업 밸런스를 유지하고 있습니다.`
            : `척추 기울기가 ${Math.round(lean)}°입니다. 28°~40° 범위로 상체 숙임을 조절해 보세요.`
        });
      }
      if (Number.isFinite(knee)) {
        const goodKnee = knee >= 145 && knee <= 172;
        items.push({
          status: goodKnee ? 'good' : 'warn',
          title: '무릎 굽힘(Knee Flex)',
          detail: goodKnee
            ? `리드 무릎 각도가 ${Math.round(knee)}°로 하체 지지력이 견고합니다.`
            : `리드 무릎 각도가 ${Math.round(knee)}°입니다. 과도한 굽힘이나 펴짐을 피하세요.`
        });
      }
      break;

    case 'backswing':
      if (Number.isFinite(elbow)) {
        const straight = elbow >= 152;
        items.push({
          status: straight ? 'good' : 'warn',
          title: '테이크어웨이 리드 팔 펴짐',
          detail: straight
            ? `리드 팔꿈치 각도 ${Math.round(elbow)}°로 넓은 스윙 아크(Wide Arc)를 만들고 있습니다.`
            : `리드 팔꿈치가 일찍 굽혀졌습니다(${Math.round(elbow)}°). 아크를 넓게 가져가세요.`
        });
      }
      break;

    case 'top':
      if (Number.isFinite(elbow)) {
        const goodTop = elbow >= 142;
        items.push({
          status: goodTop ? 'good' : 'warn',
          title: '백스윙 탑 리드 암 유지',
          detail: goodTop
            ? `백스윙 정점에서 리드 팔 각도(${Math.round(elbow)}°)가 흔들림 없이 유지되었습니다.`
            : `백스윙 탑에서 리드 팔이 다소 많이 접혔습니다(${Math.round(elbow)}°). 오버스윙을 점검하세요.`
        });
      }
      if (Number.isFinite(trailElbow)) {
        const goodTrail = trailElbow >= 70 && trailElbow <= 115;
        items.push({
          status: goodTrail ? 'good' : 'warn',
          title: '트레일 팔꿈치 폴딩',
          detail: goodTrail
            ? `트레일 팔꿈치가 ${Math.round(trailElbow)}°로 이상적인 L자 서포트 포지션을 형성했습니다.`
            : `트레일 팔꿈치 각도가 ${Math.round(trailElbow)}°입니다. 플라잉 엘보를 주의하세요.`
        });
      }
      break;

    case 'downswing':
      if (leanDelta !== null) {
        const steady = Math.abs(leanDelta) <= 8;
        items.push({
          status: steady ? 'good' : 'warn',
          title: '다운스윙 척추각 유지',
          detail: steady
            ? `어드레스 대비 척추각 변화가 ${leanDelta >= 0 ? '+' : ''}${leanDelta}°로 배치기(Early Extension) 없이 진입합니다.`
            : `어드레스 대비 상체 각도가 ${leanDelta >= 0 ? '+' : ''}${leanDelta}° 변했습니다. 힙 힌지를 유지하세요.`
        });
      }
      break;

    case 'impact':
      if (Number.isFinite(elbow)) {
        const solidImpact = elbow >= 150;
        items.push({
          status: solidImpact ? 'good' : 'warn',
          title: '임팩트 리드 암 익스텐션',
          detail: solidImpact
            ? `임팩트 순간 리드 팔이 ${Math.round(elbow)}°로 견고하게 펴져 에너지 전달이 우수합니다.`
            : `임팩트 시 리드 팔꿈치가 당겨지는 치킨윙 경향(${Math.round(elbow)}°)이 관찰됩니다.`
        });
      }
      if (tempoInfo) {
        const goodTempo = tempoInfo.ratio >= 2.4 && tempoInfo.ratio <= 3.6;
        items.push({
          status: goodTempo ? 'good' : 'warn',
          title: '스윙 리듬 및 템포',
          detail: `백스윙 ${tempoInfo.backswingSec.toFixed(2)}s / 다운스윙 ${tempoInfo.downswingSec.toFixed(2)}s (${tempoInfo.ratio.toFixed(1)} : 1 비율)로 ${goodTempo ? '투어 프로 권장 템포(3:1)에 부합합니다.' : '리듬 편차가 있습니다.'}`
        });
      }
      break;

    case 'follow':
      if (Number.isFinite(elbow) && Number.isFinite(trailElbow)) {
        const released = elbow >= 145 && trailElbow >= 145;
        items.push({
          status: released ? 'good' : 'warn',
          title: '팔로우스루 양팔 릴리스',
          detail: released
            ? `임팩트 이후 양팔(${Math.round(elbow)}° / ${Math.round(trailElbow)}°)이 타깃 방향으로 시원하게 뻗어 나갑니다.`
            : `릴리스 구간에서 팔의 뻗음이 다소 제한되었습니다(${Math.round(elbow)}°).`
        });
      }
      break;

    case 'finish':
      if (Number.isFinite(knee)) {
        items.push({
          status: 'good',
          title: '피니시 밸런스 및 체중 이동',
          detail: `피니시 구간 리드 하체 지지각 ${Math.round(knee)}°로 안정적인 회전 마무리를 보여줍니다.`
        });
      }
      break;
  }

  if (!items.length) {
    items.push({
      status: 'good',
      title: '스윙 궤적 및 포즈 정상 추적',
      detail: '현재 구간의 클럽 헤드 궤적과 신체 관절 데이터가 정상적으로 분석되었습니다.'
    });
  }
  return items;
}
