// ============================================================================
// demo-generator.js
// 어드레스(Address) 시점 골프채 인식, 스윙 구간별 3D 클럽헤드 열림/닫힘(Face Open/Close) 투영,
// 실사형(Photorealistic) 3D 셰이딩 골프 클럽(샤프트·호젤·헤드) 렌더러 및 60fps 프로 스윙 시뮬레이터
// ============================================================================

import { clamp } from './swing-engine.js';

/**
 * 5차 다항식 스무스스텝 (양 끝단에서 1차·2차 도함수가 모두 0이 되어 가속도 불연속이 전혀 없음)
 */
function quinticStep(a, b, x) {
  const u = clamp((x - a) / Math.max(1e-5, b - a), 0, 1);
  return u * u * u * (u * (u * 6 - 15) + 10);
}

/**
 * 샤프트 축 방향 상대 위치 u (0.0 = 손/그립 끝단, 0.5 = 샤프트 중앙, 1.0 = 클럽헤드 중심)와
 * 사용자 설정 손 쪽 샤프트 투명도 `gripFade` (0.0 = 전체 표시 ~ 1.0 = 손 쪽 100% 투명·샤프트 중앙부터 헤드로 선명화)에 따른
 * 축 방향 알파 가중치(0.0 ~ 1.0)를 계산합니다.
 */
export function computeShaftAxialAlpha(u, gripFade = 1.0) {
  const gf = clamp(Number(gripFade ?? 0), 0, 1);
  if (gf <= 0.005) return 1.0;

  const uClamped = clamp(u, 0, 1);

  if (gf <= 0.50) {
    // 0% ~ 50% 구간: 손 끝단 투명도를 0% -> 100%(불투명도 1.0 -> 0.0)로 낮추며 헤드(u >= 0.90)로 갈수록 1.0으로 선명화
    const handOpacity = clamp(1.0 - (gf / 0.50), 0, 1);
    if (uClamped >= 0.90) return 1.0;
    const t = clamp(uClamped / 0.90, 0, 1);
    const smooth = t * t * (3 - 2 * t);
    return clamp(handOpacity + (1.0 - handOpacity) * smooth, 0, 1);
  }

  // 50% ~ 100% 구간: 손에 가까운 쪽은 100% 완전 투명(0.0)으로 보이지 않게 하고,
  // gripFade가 100%(1.0)일 때는 샤프트 중앙 부근(fadeStartU = 0.46)에서부터 서서히 보이기 시작해 헤드(0.92 ~ 1.0)로 갈수록 100% 선명해짐
  const fadeStartU = ((gf - 0.50) / 0.50) * 0.46;
  const fullOpaqueU = 0.92;
  if (uClamped <= fadeStartU) return 0.0;
  if (uClamped >= fullOpaqueU) return 1.0;

  const t = clamp((uClamped - fadeStartU) / Math.max(0.06, fullOpaqueU - fadeStartU), 0, 1);
  // 중앙 부근에서 부드럽게 피어나 헤드 쪽으로 갈수록 선명해지는 곡선
  return clamp(Math.pow(t, 1.35) * (0.35 + 0.65 * (t * (3 - 2 * t))), 0, 1);
}

/**
 * 로컬 샤프트 좌표계((0,0)=그립 끝단 -> (shaftLen, 0)=호젤/헤드 결합부)에서
 * 실제 투어 드라이버/아이언과 동일한 외형의 3D 셰이딩 그립·샤프트·호젤 슬리브·클럽 헤드를 렌더링합니다.
 *
 * 특히 `faceOpenDeg` (헤드 페이스 열림/닫힘 각도: +값=열림/Open, 0°=스퀘어/Square, -값=닫힘/Closed)에 따라
 * 클럽 헤드의 3D 회전 투영(밀링 페이스 노출 면적, 스코어라인 그루브, 카본 크라운 원근, 솔 웨이트 포트 턴오버)이
 * 실시간으로 변화하여 스윙 동작 중 헤드가 열리고 닫히는 물리적 움직임을 선명하게 보여줍니다.
 */
export function renderPhotorealisticClubGeometry(ctx, shaftLen, options = {}) {
  const {
    clubType = 'driver', // 'driver' | 'iron'
    hand = 'right',
    scale = 1.0,
    foreshorten = 1.0,   // 3D 스윙 플레인 원근 단축 비율 (각도에 따라 짧아 보이고 길어 보이는 비율: 0.45 ~ 1.10)
    faceOpenDeg = 0,     // +deg: 열림(Open, 백스윙/다운스윙 초반), 0: 스퀘어(Address/Impact), -deg: 닫힘(Closed, 릴리스/팔로우스루/피니시)
    shaftAngle = 1.57,
    headPrimary = '#0B1120',
    headSecondary = '#1E293B',
    isGhost = false,
    gripFade = 0
  } = options;

  // 오른손잡이 정면(driver) 기준:
  // 로컬 +X는 그립(0,0) -> 호젤/헤드(shaftLen,0) 방향이며,
  // dirSign 대칭 적용 후 로컬 +Y는 항상 '타깃/공을 치고 나가는 스윙 진행 방향(전면)', -Y는 '클럽 헤드 등판/후면'이 됩니다.
  const dirSign = clubType === 'iron'
    ? (hand === 'left' ? -1 : 1)
    : (hand === 'left' ? 1 : -1);

  // 샤프트 축 중심 3D 헤드 롤(Roll) 각도 (-68° ~ +68°)
  const rollRad = clamp(faceOpenDeg, -68, 68) * (Math.PI / 180);
  const sinR = Math.sin(rollRad); // +: Open(열림), 0: Square(스퀘어), -: Closed(닫힘)
  const cosR = Math.cos(rollRad);
  const gf = clamp(Number(gripFade ?? 0), 0, 1);

  ctx.save();
  ctx.scale(1, dirSign);

  // ==========================================================================
  // 1) 투어 벨벳 코드 러버 그립 (손 쪽 투명도 gripFade 반영: 100% 설정 시 완전 투명)
  // ==========================================================================
  const gripLen = shaftLen * 0.265;
  const buttHalfW = 3.3 * scale;
  const gripEndHalfW = 2.3 * scale;
  const gripAxialAlpha = computeShaftAxialAlpha(0.14, gf);

  if (gripAxialAlpha > 0.005) {
    ctx.save();
    ctx.globalAlpha *= (isGhost ? 0.62 : 1.0) * gripAxialAlpha;

    const gripGrad = ctx.createLinearGradient(0, -buttHalfW, 0, buttHalfW);
    gripGrad.addColorStop(0.0, '#09090B');
    gripGrad.addColorStop(0.28, '#27272A');
    gripGrad.addColorStop(0.48, '#52525B');
    gripGrad.addColorStop(0.75, '#18181B');
    gripGrad.addColorStop(1.0, '#09090B');

    ctx.fillStyle = gripGrad;
    ctx.beginPath();
    ctx.moveTo(-4.0 * scale, -buttHalfW);
    ctx.lineTo(gripLen, -gripEndHalfW);
    ctx.lineTo(gripLen, gripEndHalfW);
    ctx.lineTo(-4.0 * scale, buttHalfW);
    ctx.closePath();
    ctx.fill();

    if (!isGhost && gf < 0.25) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = Math.max(0.6, 0.65 * scale);
      const gripRings = 7;
      for (let r = 1; r < gripRings; r++) {
        const rx = (gripLen / gripRings) * r;
        const hw = buttHalfW + (gripEndHalfW - buttHalfW) * (r / gripRings);
        ctx.beginPath();
        ctx.moveTo(rx - 1.2 * scale, -hw * 0.85);
        ctx.lineTo(rx + 1.2 * scale, hw * 0.85);
        ctx.stroke();
      }

      ctx.fillStyle = '#F1F5F9';
      ctx.fillRect(-4.5 * scale, -buttHalfW * 0.9, 1.6 * scale, buttHalfW * 1.8);
      ctx.fillStyle = '#CBD5E1';
      ctx.fillRect(gripLen - 2.0 * scale, -gripEndHalfW, 2.0 * scale, gripEndHalfW * 2);
    }
    ctx.restore();
  }

  // ==========================================================================
  // 2) 실사 테이퍼드 그라파이트 / 크롬 스틸 샤프트 (손에 가까울수록 투명 -> 중앙부터 서서히 나타나 헤드로 갈수록 불투명)
  // ==========================================================================
  const headScale = scale * (0.94 + 0.12 * foreshorten);
  const headCenterOffset = 9.5 * headScale * (0.72 + 0.28 * foreshorten);
  const hoselEnd = Math.max(gripLen + 14 * scale, shaftLen - headCenterOffset);
  const ferruleLen = 10.5 * scale * (0.75 + 0.25 * foreshorten);
  const shaftEnd = Math.max(gripLen + 8 * scale, hoselEnd - ferruleLen);
  const tipHalfW = 1.42 * scale;

  if (isGhost || gf > 0.005) {
    const ghostShaftGrad = ctx.createLinearGradient(0, 0, shaftLen, 0);
    const stops = [0.0, 0.20, 0.35, 0.44, 0.50, 0.58, 0.68, 0.78, 0.88, 0.95, 1.0];
    for (const s of stops) {
      const a = computeShaftAxialAlpha(s, gf);
      const c = Math.round(230 + 25 * s);
      ghostShaftGrad.addColorStop(s, `rgba(${c}, ${Math.min(255, c + 4)}, 255, ${a.toFixed(3)})`);
    }

    ctx.fillStyle = ghostShaftGrad;
    ctx.beginPath();
    ctx.moveTo(gripLen, -gripEndHalfW * 0.95);
    ctx.lineTo(shaftEnd, -tipHalfW * 1.08);
    ctx.lineTo(shaftEnd, tipHalfW * 1.08);
    ctx.lineTo(gripLen, gripEndHalfW * 0.95);
    ctx.closePath();
    ctx.fill();
  } else {
    const shaftCylGrad = ctx.createLinearGradient(0, -gripEndHalfW, 0, gripEndHalfW);
    if (clubType === 'iron') {
      shaftCylGrad.addColorStop(0.0, '#1E293B');
      shaftCylGrad.addColorStop(0.22, '#94A3B8');
      shaftCylGrad.addColorStop(0.45, '#FFFFFF');
      shaftCylGrad.addColorStop(0.68, '#CBD5E1');
      shaftCylGrad.addColorStop(0.88, '#475569');
      shaftCylGrad.addColorStop(1.0, '#0F172A');
    } else {
      shaftCylGrad.addColorStop(0.0, '#0F172A');
      shaftCylGrad.addColorStop(0.24, '#64748B');
      shaftCylGrad.addColorStop(0.46, '#F8FAFC');
      shaftCylGrad.addColorStop(0.70, '#94A3B8');
      shaftCylGrad.addColorStop(1.0, '#0F172A');
    }

    ctx.fillStyle = shaftCylGrad;
    ctx.beginPath();
    ctx.moveTo(gripLen, -gripEndHalfW);
    ctx.lineTo(shaftEnd, -tipHalfW);
    ctx.lineTo(shaftEnd, tipHalfW);
    ctx.lineTo(gripLen, gripEndHalfW);
    ctx.closePath();
    ctx.fill();

    if (clubType === 'driver') {
      const bandStart = gripLen + (shaftEnd - gripLen) * 0.08;
      const bandLen = (shaftEnd - gripLen) * 0.22;
      const bandGrad = ctx.createLinearGradient(bandStart, 0, bandStart + bandLen, 0);
      bandGrad.addColorStop(0, 'rgba(15, 23, 42, 0.55)');
      bandGrad.addColorStop(0.5, 'rgba(30, 41, 59, 0.35)');
      bandGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
      ctx.fillStyle = bandGrad;
      ctx.beginPath();
      ctx.moveTo(bandStart, -gripEndHalfW * 0.92);
      ctx.lineTo(bandStart + bandLen, -gripEndHalfW * 0.80);
      ctx.lineTo(bandStart + bandLen, gripEndHalfW * 0.80);
      ctx.lineTo(bandStart, gripEndHalfW * 0.92);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = Math.max(0.8, 0.9 * scale);
      for (let st = 1; st <= 4; st++) {
        const sx = gripLen + (shaftEnd - gripLen) * (st * 0.18);
        const shw = gripEndHalfW + (tipHalfW - gripEndHalfW) * (st * 0.18);
        ctx.beginPath();
        ctx.moveTo(sx, -shw);
        ctx.lineTo(sx, shw);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.lineWidth = Math.max(0.9, 1.15 * scale);
    ctx.beginPath();
    ctx.moveTo(gripLen, -0.32 * scale);
    ctx.lineTo(shaftEnd, -0.18 * scale);
    ctx.stroke();
  }

  // ==========================================================================
  // 3) 페룰(Ferrule) & 어저스터블 호젤 슬리브(Adjustable Hosel Sleeve)
  // ==========================================================================
  ctx.fillStyle = '#090D16';
  ctx.beginPath();
  ctx.moveTo(shaftEnd, -tipHalfW * 1.15);
  ctx.lineTo(hoselEnd, -tipHalfW * 1.65);
  ctx.lineTo(hoselEnd, tipHalfW * 1.65);
  ctx.lineTo(shaftEnd, tipHalfW * 1.15);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(shaftEnd + 1.2 * scale, -tipHalfW * 1.22, 1.2 * scale, tipHalfW * 2.44);
  ctx.fillStyle = '#94A3B8';
  ctx.fillRect(shaftEnd + 3.6 * scale, -tipHalfW * 1.35, 2.4 * scale, tipHalfW * 2.70);

  // ==========================================================================
  // 4) 스윙 궤도 중심(shaftLen, 0)에 정렬된 3D 회전 투영 클럽 헤드
  //    - 열림(Open, faceOpenDeg > +10°): 토우가 들리며 밝은 은빛 밀링 타구면(그루브)이 정면으로 넓게 노출
  //    - 스퀘어(Square, |faceOpenDeg| <= 10°): 공을 향한 직선 리딩엣지(스퀘어 페이스)와 크라운 측면 실루엣
  //    - 닫힘(Closed, faceOpenDeg < -10°): 릴리스/팔로우스루 롤오버로 헤드가 샤프트 축 너머로 뒤집히며
  //      은빛 타구면은 뒤로 완전히 감춰지고 검은 카본 크라운·메탈릭 솔(바닥면)·텅스텐 웨이트가 노출
  // ==========================================================================
  ctx.save();
  ctx.translate(hoselEnd, 0);
  // 상단 line 54에서 ctx.scale(1, dirSign)이 이미 적용되어 있으므로,
  // 로컬 +Y는 항상 공/타깃(전면 리딩엣지) 방향이고 로컬 -Y는 클럽헤드 크라운 후면(Trailing) 방향입니다.

  // 헤드 중심에서 열림/닫힘에 따른 3D 라이각/롤 회전 변환
  const axialSpan = (20.5 + 5.5 * Math.abs(sinR)) * headScale * (0.72 + 0.28 * foreshorten);
  const closedRatio = clamp((-faceOpenDeg - 6) / 48, 0, 1); // 0(열림/스퀘어) ~ 1.0(릴리스/팔로우스루 완전 닫힘)

  if (clubType === 'iron') {
    // ------------------------------------------------------------------------
    // 단조 아이언 헤드 (3D Open / Square / Closed 투영 - 리딩엣지 샤프트 정렬 & 후방 머슬백)
    // ------------------------------------------------------------------------
    const toeX = axialSpan * 0.96;
    const toeY = sinR * 5.2 * headScale;
    const faceFrontY = (1.5 + Math.max(0, sinR) * 2.4 - closedRatio * 0.9) * headScale;
    const backDepthY = -(8.4 - Math.max(0, sinR) * 2.0 + closedRatio * 4.8) * headScale;

    // (a) 아이언 바디 & 머슬백 솔(Sole)
    const ironBodyGrad = ctx.createLinearGradient(0, backDepthY, toeX, faceFrontY);
    if (closedRatio > 0.25) {
      ironBodyGrad.addColorStop(0.0, '#1E293B');
      ironBodyGrad.addColorStop(0.45, '#64748B');
      ironBodyGrad.addColorStop(0.80, '#94A3B8');
      ironBodyGrad.addColorStop(1.0, '#334155');
    } else {
      ironBodyGrad.addColorStop(0.0, '#64748B');
      ironBodyGrad.addColorStop(0.45, '#E2E8F0');
      ironBodyGrad.addColorStop(0.82, '#F8FAFC');
      ironBodyGrad.addColorStop(1.0, '#475569');
    }

    ctx.fillStyle = ironBodyGrad;
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.05 * headScale;

    ctx.beginPath();
    ctx.moveTo(-1.5 * headScale, -1.8 * headScale);
    ctx.lineTo(1.0 * headScale, faceFrontY * 0.85);
    ctx.lineTo(toeX, faceFrontY + toeY * 0.35);
    ctx.quadraticCurveTo(
      toeX + 3.0 * headScale,
      (faceFrontY + backDepthY) * 0.5 + toeY * 0.4,
      toeX * 0.88,
      backDepthY + toeY * 0.30
    );
    ctx.lineTo(1.5 * headScale, backDepthY * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // (b) 열린 상태(Open) 또는 스퀘어(Square)일 때만 보이는 밝은 은빛 타구면(Clubface) & 그루브
    if (closedRatio < 0.32) {
      const faceThickY = clamp((2.4 + Math.max(0, sinR) * 6.2) * headScale * (1 - closedRatio * 2.2), 1.4 * headScale, 8.8 * headScale);
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 0.7 * headScale;

      ctx.beginPath();
      ctx.moveTo(1.2 * headScale, faceFrontY * 0.82);
      ctx.lineTo(toeX * 0.96, faceFrontY + toeY * 0.34);
      ctx.lineTo(toeX * 0.92, faceFrontY - faceThickY + toeY * 0.28);
      ctx.lineTo(1.5 * headScale, faceFrontY * 0.82 - faceThickY * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if (faceOpenDeg > -4) {
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = Math.max(0.55, 0.65 * headScale);
        const grooves = faceOpenDeg > 12 ? 6 : 4;
        for (let g = 1; g <= grooves; g++) {
          const u = g / (grooves + 1);
          const gx0 = (2.6 + u * (toeX * 0.82)) * 0.95;
          const gyTop = faceFrontY * (0.82 + 0.15 * u) + toeY * 0.30 * u;
          const gyBot = gyTop - faceThickY * (0.72 + 0.18 * u);
          ctx.beginPath();
          ctx.moveTo(gx0, gyTop - 0.35 * headScale);
          ctx.lineTo(gx0 - 0.7 * headScale, gyBot + 0.35 * headScale);
          ctx.stroke();
        }
      }
    } else {
      // (c) 닫힌 상태(Closed: 릴리스·팔로우스루·피니시): 돌아 나온 아이언 머슬백 등판과 텅스텐 웨이트 노출
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(2.4 * headScale, faceFrontY * 0.35);
      ctx.lineTo(toeX * 0.86, (faceFrontY + backDepthY) * 0.35 + toeY * 0.30);
      ctx.lineTo(toeX * 0.78, backDepthY * 0.82 + toeY * 0.25);
      ctx.lineTo(2.0 * headScale, backDepthY * 0.62);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 1.0 * headScale;
      ctx.beginPath();
      ctx.moveTo(3.0 * headScale, backDepthY * 0.35);
      ctx.lineTo(toeX * 0.80, backDepthY * 0.45 + toeY * 0.25);
      ctx.stroke();
    }
  } else {
    // ------------------------------------------------------------------------
    // 460cc 투어 티타늄·카본 드라이버 헤드 (3D Open / Square / Closed 투영)
    // - 리딩엣지(frontEdgeY)는 샤프트 축(y ≈ 0)에 정렬되어 스윙 진행 방향 앞으로 돌출되지 않으며,
    // - 460cc 크라운 바디(crownBackY < 0)는 스윙 진행 방향 뒤쪽(Trailing)으로 깊게 뻗어 실제 드라이버 형상을 재현합니다.
    // ------------------------------------------------------------------------
    const toeX = axialSpan;
    const rollShiftY = sinR * 4.2 * headScale;
    const frontEdgeY = (1.6 + Math.max(0, sinR) * 2.6 - closedRatio * 0.8) * headScale;
    const crownBackY = -(16.4 - Math.max(0, sinR) * 4.6 - closedRatio * 2.2) * headScale;

    // (a) 460cc 에어로다이내믹 카본 크라운 & 턴오버 솔 메인 바디
    const lightShift = Math.sin(shaftAngle) * 2.2 * headScale;
    const crownGrad = ctx.createRadialGradient(
      toeX * 0.48 + lightShift,
      (frontEdgeY + crownBackY) * 0.42 + rollShiftY * 0.25,
      1.8 * headScale,
      toeX * 0.45,
      (frontEdgeY + crownBackY) * 0.45,
      toeX * 0.88
    );

    if (closedRatio > 0.25) {
      crownGrad.addColorStop(0.0, '#334155');
      crownGrad.addColorStop(0.38, '#1E293B');
      crownGrad.addColorStop(0.75, '#0F172A');
      crownGrad.addColorStop(1.0, '#020617');
    } else {
      crownGrad.addColorStop(0.0, '#475569');
      crownGrad.addColorStop(0.35, headSecondary);
      crownGrad.addColorStop(0.75, headPrimary);
      crownGrad.addColorStop(1.0, '#020617');
    }

    ctx.fillStyle = crownGrad;
    ctx.strokeStyle = closedRatio > 0.25 ? '#475569' : '#64748B';
    ctx.lineWidth = 1.1 * headScale;

    ctx.beginPath();
    ctx.moveTo(-2.0 * headScale, -1.8 * headScale);
    ctx.lineTo(0.8 * headScale, frontEdgeY * 0.85);
    ctx.quadraticCurveTo(
      toeX * 0.55,
      frontEdgeY + rollShiftY * 0.35,
      toeX,
      frontEdgeY * 0.70 + rollShiftY * 0.48
    );
    ctx.bezierCurveTo(
      toeX + 3.6 * headScale,
      frontEdgeY * 0.15 + rollShiftY * 0.42,
      toeX + 3.0 * headScale,
      crownBackY * 0.75 + rollShiftY * 0.28,
      toeX * 0.76,
      crownBackY + rollShiftY * 0.20
    );
    ctx.bezierCurveTo(
      toeX * 0.32,
      crownBackY * 1.04,
      -1.6 * headScale,
      crownBackY * 0.52,
      -2.0 * headScale,
      -1.8 * headScale
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // (b) 카본 크라운 직조 패널 디테일
    ctx.save();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.beginPath();
    ctx.moveTo(2.2 * headScale, -1.2 * headScale);
    ctx.quadraticCurveTo(
      toeX * 0.52,
      crownBackY * 0.18 + rollShiftY * 0.20,
      toeX * 0.84,
      crownBackY * 0.48 + rollShiftY * 0.20
    );
    ctx.quadraticCurveTo(
      toeX * 0.45,
      crownBackY * 0.88,
      1.8 * headScale,
      crownBackY * 0.42
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // (c) 헤드 열림(Open) & 스퀘어(Square) 상태 vs 릴리스/팔로우스루 닫힘(Closed) 상태 분기 렌더링
    if (closedRatio < 0.28) {
      const faceBandY = clamp(
        (3.0 + Math.max(0, sinR) * 7.6) * headScale * (1 - closedRatio * 2.4),
        2.0 * headScale,
        10.8 * headScale
      );

      const faceGrad = ctx.createLinearGradient(0, frontEdgeY, toeX, frontEdgeY - faceBandY);
      faceGrad.addColorStop(0.0, '#E2E8F0');
      faceGrad.addColorStop(0.45, '#FFFFFF');
      faceGrad.addColorStop(0.82, '#CBD5E1');
      faceGrad.addColorStop(1.0, '#94A3B8');

      ctx.fillStyle = faceGrad;
      ctx.strokeStyle = '#1E293B';
      ctx.lineWidth = 0.8 * headScale;

      ctx.beginPath();
      ctx.moveTo(0.8 * headScale, frontEdgeY * 0.85);
      ctx.quadraticCurveTo(
        toeX * 0.55,
        frontEdgeY + rollShiftY * 0.35,
        toeX * 0.98,
        frontEdgeY * 0.70 + rollShiftY * 0.48
      );
      ctx.lineTo(toeX * 0.92, frontEdgeY * 0.70 + rollShiftY * 0.40 - faceBandY * 0.85);
      ctx.quadraticCurveTo(
        toeX * 0.50,
        frontEdgeY + rollShiftY * 0.28 - faceBandY,
        1.2 * headScale,
        frontEdgeY * 0.85 - faceBandY * 0.72
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if (faceOpenDeg > 8) {
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = Math.max(0.55, 0.65 * headScale);
        const grooveLines = 5;
        for (let g = 1; g <= grooveLines; g++) {
          const u = g / (grooveLines + 1);
          const gx = 1.8 + u * (toeX * 0.78);
          const gyFront = frontEdgeY * (0.85 - 0.08 * u) + rollShiftY * 0.32 * u;
          const gyBack = gyFront - faceBandY * 0.76;
          ctx.beginPath();
          ctx.moveTo(gx, gyFront - 0.35 * headScale);
          ctx.lineTo(gx - 0.55 * headScale, gyBack + 0.35 * headScale);
          ctx.stroke();
        }

        ctx.fillStyle = '#DC2626';
        ctx.beginPath();
        ctx.arc(
          toeX * 0.52,
          frontEdgeY * 0.80 + rollShiftY * 0.20 - faceBandY * 0.45,
          1.15 * headScale,
          0,
          Math.PI * 2
        );
        ctx.fill();
      } else if (Math.abs(faceOpenDeg) <= 8) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = Math.max(1.2, 1.45 * headScale);
        ctx.beginPath();
        ctx.moveTo(1.0 * headScale, frontEdgeY * 0.85);
        ctx.lineTo(toeX * 0.96, frontEdgeY * 0.72);
        ctx.stroke();

        ctx.fillStyle = '#F8FAFC';
        ctx.beginPath();
        ctx.arc(toeX * 0.45, frontEdgeY * 0.80 - faceBandY - 1.5 * headScale, 1.3 * headScale, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const solePlateAlpha = clamp(closedRatio * 1.15, 0.35, 0.96);
      ctx.save();
      ctx.globalAlpha *= solePlateAlpha;

      ctx.fillStyle = '#64748B';
      ctx.beginPath();
      ctx.moveTo(2.5 * headScale, frontEdgeY * 0.35);
      ctx.quadraticCurveTo(
        toeX * 0.52,
        frontEdgeY * 0.55 + rollShiftY * 0.35,
        toeX * 0.88,
        frontEdgeY * 0.20 + rollShiftY * 0.35
      );
      ctx.lineTo(toeX * 0.75, crownBackY * 0.48 + rollShiftY * 0.20);
      ctx.quadraticCurveTo(
        toeX * 0.40,
        crownBackY * 0.32,
        2.0 * headScale,
        -1.5 * headScale
      );
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#CBD5E1';
      ctx.beginPath();
      ctx.ellipse(
        toeX * 0.62,
        crownBackY * 0.58 + rollShiftY * 0.20,
        3.2 * headScale,
        1.8 * headScale,
        -0.25,
        0,
        Math.PI * 2
      );
      ctx.fill();

      ctx.fillStyle = '#F59E0B';
      ctx.beginPath();
      ctx.arc(
        toeX * 0.62,
        crownBackY * 0.58 + rollShiftY * 0.20,
        1.25 * headScale,
        0,
        Math.PI * 2
      );
      ctx.fill();

      ctx.strokeStyle = '#020617';
      ctx.lineWidth = Math.max(1.1, 1.3 * headScale);
      ctx.beginPath();
      ctx.moveTo(1.0 * headScale, frontEdgeY * 0.78);
      ctx.quadraticCurveTo(
        toeX * 0.55,
        frontEdgeY * 0.92 + rollShiftY * 0.35,
        toeX * 0.96,
        frontEdgeY * 0.62 + rollShiftY * 0.48
      );
      ctx.stroke();

      ctx.restore();
    }
  }

  ctx.restore();
  ctx.restore();
}

/**
 * 실제 업로드 영상의 어드레스(Address) 프레임(`addrFrameCanvas`)에서
 * 배경(골퍼의 손/바지/다리/양말/타석 매트/골프공)은 100% 투명하게 제거하고,
 * 오직 실제 골프채(샤프트와 헤드 중심)만 정밀 누끼(Cutout)로 추출한 투명 캔버스 스프라이트를 생성합니다.
 */
export function extractAddressClubCutoutSprite(addrFrameCanvas, grip, clubHead, options = {}) {
  if (!addrFrameCanvas || !grip || !clubHead) return null;

  const {
    clubType = 'driver',
    hand = 'right'
  } = options;

  try {
    const fw = addrFrameCanvas.width;
    const fh = addrFrameCanvas.height;
    if (!fw || !fh) return null;

    const fCtx = addrFrameCanvas.getContext('2d');
    const srcData = fCtx.getImageData(0, 0, fw, fh).data;

    const p0x = grip.x * fw;
    const p0y = grip.y * fh;
    const p1x = clubHead.x * fw;
    const p1y = clubHead.y * fh;
    const dx = p1x - p0x;
    const dy = p1y - p0y;
    const srcLen = Math.hypot(dx, dy);
    if (srcLen < 20) return null;

    // 샤프트 축 단위벡터(+u: 그립 -> 헤드) 및 수직 법선 단위벡터(+v)
    const ux = dx / srcLen;
    const uy = dy / srcLen;
    const vx = -uy;
    const vy = ux;

    // 바이리니어 픽셀 샘플러 (uNorm: 0=그립, 1=헤드 / vSrcPx: 수직 오프셋 픽셀)
    const sampleBilinear = (uNorm, vSrcPx) => {
      const sx = clamp(p0x + (uNorm * srcLen) * ux + vSrcPx * vx, 0, fw - 1.001);
      const sy = clamp(p0y + (uNorm * srcLen) * uy + vSrcPx * vy, 0, fh - 1.001);
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(fw - 1, x0 + 1);
      const y1 = Math.min(fh - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;

      const i00 = (y0 * fw + x0) * 4;
      const i10 = (y0 * fw + x1) * 4;
      const i01 = (y1 * fw + x0) * 4;
      const i11 = (y1 * fw + x1) * 4;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      return [
        srcData[i00] * w00 + srcData[i10] * w10 + srcData[i01] * w01 + srcData[i11] * w11,
        srcData[i00 + 1] * w00 + srcData[i10 + 1] * w10 + srcData[i01 + 1] * w01 + srcData[i11 + 1] * w11,
        srcData[i00 + 2] * w00 + srcData[i10 + 2] * w10 + srcData[i01 + 2] * w01 + srcData[i11 + 2] * w11
      ];
    };

    // 고해상도 로컬 클럽 스프라이트 규격 (u=0: 그립, u=L: 클럽헤드 중심, v=0: 샤프트 중심선)
    const L = 240;
    const headExtend = 24;
    const W = L + headExtend;
    const halfV = 36;
    const H = halfV * 2;
    const scaleToSrc = srcLen / L;

    // 1) 샤프트 구간별 서브픽셀 중심선(vPeakSrc) 및 실제 샤프트 색상 프로파일(민트/시안/실버 등) 추출
    const rawVPeak = new Float32Array(W);
    const rawShaftR = new Float32Array(W);
    const rawShaftG = new Float32Array(W);
    const rawShaftB = new Float32Array(W);

    for (let u = 0; u < W; u++) {
      const uNorm = u / L;
      let bestV = 0;
      let bestScore = -1e9;
      for (let vCand = -3.5; vCand <= 3.5; vCand += 0.5) {
        const [rC, gC, bC] = sampleBilinear(uNorm, vCand);
        const [rL, gL, bL] = sampleBilinear(uNorm, vCand - 4.2);
        const [rR, gR, bR] = sampleBilinear(uNorm, vCand + 4.2);
        const lumC = 0.299 * rC + 0.587 * gC + 0.114 * bC;
        const lumL = 0.299 * rL + 0.587 * gL + 0.114 * bL;
        const lumR = 0.299 * rR + 0.587 * gR + 0.114 * bR;
        const ridge = lumC - Math.max(lumL, lumR);
        const cyanBoost = Math.max(0, (gC - rC) * 0.75 + (bC - rC) * 0.55);
        const score = ridge + cyanBoost * 0.5 - Math.abs(vCand) * 2.5;
        if (score > bestScore) {
          bestScore = score;
          bestV = vCand;
        }
      }
      rawVPeak[u] = clamp(bestV, -2.2, 2.2);
      const [rP, gP, bP] = sampleBilinear(uNorm, rawVPeak[u]);
      rawShaftR[u] = rP;
      rawShaftG[u] = gP;
      rawShaftB[u] = bP;
    }

    // 축 방향 이동평균 스무딩으로 영상 압축 노이즈를 정제하면서 실제 샤프트의 고유 컬러 밴드(민트/실버 등) 보존
    const smoothVPeak = new Float32Array(W);
    const shaftR = new Float32Array(W);
    const shaftG = new Float32Array(W);
    const shaftB = new Float32Array(W);

    for (let u = 0; u < W; u++) {
      let sv = 0, sr = 0, sg = 0, sb = 0, cnt = 0;
      for (let k = -6; k <= 6; k++) {
        const idx = clamp(u + k, Math.round(L * 0.16), Math.round(L * 0.90));
        sv += rawVPeak[idx];
        sr += rawShaftR[idx];
        sg += rawShaftG[idx];
        sb += rawShaftB[idx];
        cnt++;
      }
      smoothVPeak[u] = sv / cnt;
      let rAvg = sr / cnt;
      let gAvg = sg / cnt;
      let bAvg = sb / cnt;
      const lumAvg = 0.299 * rAvg + 0.587 * gAvg + 0.114 * bAvg;
      if (lumAvg < 172) {
        const boost = 172 / Math.max(40, lumAvg);
        rAvg = Math.min(255, rAvg * boost);
        gAvg = Math.min(255, gAvg * boost);
        bAvg = Math.min(255, bAvg * boost);
      }
      shaftR[u] = rAvg;
      shaftG[u] = gAvg;
      shaftB[u] = bAvg;
    }

    // 2) 클럽헤드 주변 타석 매트 배경색(matRGB)과 실제 클럽헤드 코어/페이스 색상 추출
    const backSign = (hand === 'left' && clubType !== 'iron') ? -1 : 1;
    const matRGB = sampleBilinear(0.99, 15.5 * backSign);
    const matGreen = matRGB[1] - matRGB[2];

    let coreR = 0, coreG = 0, coreB = 0, coreCnt = 0;
    for (let uN = 0.94; uN <= 1.01; uN += 0.015) {
      for (let vB = 2.0; vB <= 6.5; vB += 1.5) {
        const [r, g, b] = sampleBilinear(uN, vB * backSign);
        const gClean = g > Math.max(r, b) ? (r + b) * 0.5 : g;
        coreR += r;
        coreG += gClean;
        coreB += b;
        coreCnt++;
      }
    }
    if (coreCnt > 0) {
      coreR /= coreCnt;
      coreG /= coreCnt;
      coreB /= coreCnt;
    } else {
      coreR = 115;
      coreG = 155;
      coreB = 180;
    }

    const [faceR, faceG, faceB] = sampleBilinear(0.97, 0.5 * backSign);

    // 3) 배경을 100% 투명(alpha=0)하게 비우고 손 위치(u=0, gx/gy)에서 빈틈 없이 즉시 실제 샤프트와 클럽헤드 픽셀만 합성
    const outBuffer = new Uint8ClampedArray(W * H * 4);
    const uShaftStart = 0; // 손(그립) 기준점(u=0)에서 투명 간격(Gap) 없이 즉시 샤프트 시작
    const uShaftEnd = Math.round(L * 0.945);
    const uHeadStart = Math.round(L * 0.895);
    const uHeadEnd = Math.round(L * 1.050);

    for (let u = uShaftStart; u <= uHeadEnd; u++) {
      const uNorm = u / L;
      const vAnchorBlend = clamp(uNorm / 0.14, 0, 1);
      const vCenter = (smoothVPeak[u] / scaleToSrc) * vAnchorBlend;
      const shaftHalfW = 3.25 - 0.55 * clamp(uNorm, 0, 1);
      const topFade = clamp((u + 2.0) / 2.5, 0.94, 1.0);

      const inShaftZone = u >= uShaftStart && u <= uShaftEnd;
      const inHeadZone = u >= uHeadStart && u <= uHeadEnd;
      const tHeadU = inHeadZone ? clamp((u - uHeadStart) / Math.max(1, uHeadEnd - uHeadStart), 0, 1) : 0;

      // 실제 클럽헤드 단면 윤곽 (볼 쪽 vMin은 칼같이 잘라 흰 골프공을 100% 배제하고, 등판 쪽 vMax는 실제 헤드 폭만큼 확보)
      const headVMin = -1.6 * Math.sin(Math.PI * tHeadU);
      const headVMax = 16.2 * Math.sin(Math.PI * Math.pow(tHeadU, 0.72)) + 2.4 * (1 - tHeadU);

      for (let row = 0; row < H; row++) {
        const v = row - halfV;
        const vBack = v * backSign;

        let rOut = 0, gOut = 0, bOut = 0, aOut = 0;

        // (A) 실제 샤프트 픽셀 추출 (배경 완전 투명, 손 위치 u=0에서 즉시 출발 및 고밀도 불투명도 보장)
        const distShaft = Math.abs(v - vCenter);
        if (inShaftZone && distShaft <= shaftHalfW) {
          const dRatio = distShaft / shaftHalfW;
          const uSampleNorm = clamp(uNorm, 0.16, 0.90);
          const [rLoc, gLoc, bLoc] = sampleBilinear(uSampleNorm, (v - vCenter) * scaleToSrc + smoothVPeak[Math.round(uSampleNorm * L)]);
          const cyl = 1.10 - 0.18 * dRatio * dRatio;
          rOut = clamp((shaftR[u] * 0.74 + rLoc * 0.26) * cyl, 0, 255);
          gOut = clamp((shaftG[u] * 0.74 + gLoc * 0.26) * cyl, 0, 255);
          bOut = clamp((shaftB[u] * 0.74 + bLoc * 0.26) * cyl, 0, 255);
          const edgeAlpha = dRatio <= 0.65 ? 1.0 : Math.pow(clamp((1.0 - dRatio) / 0.35, 0, 1), 1.15);
          aOut = topFade * edgeAlpha;
        }

        // (B) 실제 클럽헤드 픽셀 추출 (타석 매트 초록 잔디 및 전면 흰 골프공 100% 투명 제거)
        if (inHeadZone && vBack >= headVMin && vBack <= headVMax) {
          const [rRaw, gRaw, bRaw] = sampleBilinear(uNorm, v * scaleToSrc);
          const pxGreen = gRaw - bRaw;
          const greenDiff = matGreen - pxGreen;
          const rgbDist = Math.hypot(rRaw - matRGB[0], gRaw - matRGB[1], bRaw - matRGB[2]);
          const isMatLike = greenDiff < 11 && rgbDist < 22;

          // 타석 매트 초록빛 반사(Green Spill) 제거
          const rClean = rRaw;
          const gClean = gRaw > Math.max(rRaw, bRaw) + 3 ? (rRaw + bRaw) * 0.5 + 3 : gRaw;
          const bClean = bRaw;

          let rHead = rClean;
          let gHead = gClean;
          let bHead = bClean;

          if (vBack <= 1.6) {
            // 클럽페이스 리딩엣지 하이라이트 보존
            rHead = Math.max(rClean, faceR * 0.92, 185);
            gHead = Math.max(gClean, faceG * 0.92, 210);
            bHead = Math.max(bClean, faceB * 0.92, 220);
          } else if (isMatLike) {
            // 헤드 내부 가장자리에서 매트 색상이 섞인 픽셀은 실제 헤드 코어 색상으로 보정
            rHead = coreR * 0.85 + rClean * 0.15;
            gHead = coreG * 0.85 + gClean * 0.15;
            bHead = coreB * 0.85 + bClean * 0.15;
          }

          const dFront = vBack - headVMin;
          const dBack = headVMax - vBack;
          const dTop = tHeadU * 10;
          const dBot = (1 - tHeadU) * 10;
          const minEdgeDist = Math.min(dFront * 1.5, dBack * 0.65, dTop, dBot);
          let headAlpha = clamp(minEdgeDist / 1.15, 0, 1);
          if (isMatLike && vBack > headVMax * 0.78) {
            headAlpha *= 0.45;
          }

          if (headAlpha > aOut) {
            rOut = rHead;
            gOut = gHead;
            bOut = bHead;
            aOut = headAlpha;
          }
        }

        if (aOut > 0.01) {
          const outIdx = (row * W + u) * 4;
          outBuffer[outIdx] = Math.round(clamp(rOut, 0, 255));
          outBuffer[outIdx + 1] = Math.round(clamp(gOut, 0, 255));
          outBuffer[outIdx + 2] = Math.round(clamp(bOut, 0, 255));
          outBuffer[outIdx + 3] = Math.round(clamp(aOut * 255, 0, 255));
        }
      }
    }

    let cutoutCanvas = null;
    if (typeof document !== 'undefined') {
      cutoutCanvas = document.createElement('canvas');
      cutoutCanvas.width = W;
      cutoutCanvas.height = H;
      const cCtx = cutoutCanvas.getContext('2d');
      const imgDataObj = new ImageData(outBuffer, W, H);
      cCtx.putImageData(imgDataObj, 0, 0);
    }

    const midU = Math.round(L * 0.42);
    return {
      cutoutCanvas,
      cutoutBuffer: outBuffer,
      width: W,
      height: H,
      anchorX: 0,
      anchorY: halfV,
      shaftLenPx: L,
      shaftRGB: [Math.round(shaftR[midU]), Math.round(shaftG[midU]), Math.round(shaftB[midU])],
      headRGB: [Math.round(coreR), Math.round(coreG), Math.round(coreB)]
    };
  } catch {
    return null;
  }
}

/**
 * 어드레스(Address) 프레임에서 인식된 골프채의 기하 정보(그립 위치, 헤드 위치, 샤프트 길이, 어드레스 각도)와
 * 배경을 투명하게 제거한 실제 골프채 누끼 이미지(`cutoutSprite`)를 추출하여 반환합니다.
 */
export function createAddressClubTemplate(addrSample, canvasWidth = 1280, canvasHeight = 720, options = {}) {
  const {
    clubType = 'driver',
    hand = 'right'
  } = options;

  const grip = addrSample?.grip ? { ...addrSample.grip } : { x: 0.487, y: 0.534 };
  const clubHead = addrSample?.clubHead ? { ...addrSample.clubHead } : { x: 0.477, y: 0.785 };

  const dxNorm = clubHead.x - grip.x;
  const dyNorm = clubHead.y - grip.y;
  const shaftLengthNorm = Math.max(0.16, Math.hypot(dxNorm, dyNorm));
  const addressAngle = Math.atan2(dyNorm * canvasHeight, dxNorm * canvasWidth);
  const shaftLengthPx = Math.hypot(dxNorm * canvasWidth, dyNorm * canvasHeight);

  let headPrimary = '#0B1120';
  let headSecondary = '#1E293B';
  let cutoutSprite = null;

  const addrFrameCanvas = addrSample?.frameCanvas || null;
  if (addrFrameCanvas) {
    cutoutSprite = extractAddressClubCutoutSprite(addrFrameCanvas, grip, clubHead, { clubType, hand });
    if (cutoutSprite?.headRGB) {
      const [hr, hg, hb] = cutoutSprite.headRGB;
      headPrimary = `rgb(${Math.max(8, hr - 25)}, ${Math.max(10, hg - 25)}, ${Math.max(18, hb - 20)})`;
      headSecondary = `rgb(${Math.min(255, hr + 15)}, ${Math.min(255, hg + 15)}, ${Math.min(255, hb + 15)})`;
    }
  }

  const aspect = (canvasWidth && canvasHeight) ? (canvasWidth / canvasHeight) : (16 / 9);

  return {
    time: addrSample?.time ?? 0.45,
    grip,
    clubHead,
    shaftLengthNorm,
    shaftLengthPx,
    addressAngle,
    canvasWidth,
    canvasHeight,
    aspect,
    clubType,
    hand,
    headPrimary,
    headSecondary,
    cutoutSprite
  };
}

/**
 * Fritsch-Carlson 단조 3차 에르미트 보간기 (Monotone Cubic Hermite Spline - PCHIP)
 * 7단계 스윙 키프레임 구간 사이에서 오버슈트(Overshoot)나 위상 선행 없이
 * 신체 회전·팔 각도·샤프트 각도를 100% 동기화하여 보간합니다.
 */
export function pchipInterpolate(times, values, t) {
  const n = times.length;
  if (n === 0) return 0;
  if (n === 1 || t <= times[0]) return values[0];
  if (t >= times[n - 1]) return values[n - 1];

  const h = new Array(n - 1);
  const d = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = Math.max(1e-5, times[i + 1] - times[i]);
    d[i] = (values[i + 1] - values[i]) / h[i];
  }

  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }

  let seg = 0;
  while (seg < n - 2 && t > times[seg + 1]) {
    seg++;
  }

  const dt = h[seg];
  const u = clamp((t - times[seg]) / dt, 0, 1);
  const u2 = u * u;
  const u3 = u2 * u;

  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;

  return (
    h00 * values[seg] +
    h10 * dt * m[seg] +
    h01 * values[seg + 1] +
    h11 * dt * m[seg + 1]
  );
}

/**
 * 실제 어드레스 골프채 누끼 이미지(`cutoutSprite.cutoutCanvas`)에 손(그립, x=0)부터 클럽헤드(x=spriteL) 방향의
 * 축 방향 투명도 그라데이션(`gripFade`: 0.0 ~ 1.0)을 적용한 오프스크린 캔버스를 생성 및 캐싱합니다.
 */
function getGripFadedCutoutCanvas(cutoutSprite, gripFade = 1.0) {
  if (!cutoutSprite?.cutoutCanvas) return null;
  const gf = clamp(Number(gripFade ?? 0), 0, 1);
  if (gf <= 0.005) return cutoutSprite.cutoutCanvas;

  if (
    cutoutSprite._fadedCanvas &&
    Math.abs((cutoutSprite._lastGripFade ?? -1) - gf) < 0.002
  ) {
    return cutoutSprite._fadedCanvas;
  }

  const srcCanvas = cutoutSprite.cutoutCanvas;
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const spriteL = cutoutSprite.shaftLenPx || Math.round(w * 0.78);

  if (!cutoutSprite._fadedCanvas) {
    if (typeof document === 'undefined') return srcCanvas;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    cutoutSprite._fadedCanvas = c;
  }

  const dstCanvas = cutoutSprite._fadedCanvas;
  if (dstCanvas.width !== w) dstCanvas.width = w;
  if (dstCanvas.height !== h) dstCanvas.height = h;

  const fCtx = dstCanvas.getContext('2d');
  fCtx.save();
  fCtx.globalCompositeOperation = 'source-over';
  fCtx.clearRect(0, 0, w, h);
  fCtx.drawImage(srcCanvas, 0, 0);

  // 50% 이상 설정 시 손에 가까운 구간(0 ~ fadeStartU)은 100% 투명하게 완전히 지워 보이지 않게 처리
  if (gf > 0.50) {
    const fadeStartU = ((gf - 0.50) / 0.50) * 0.46;
    const clearW = Math.floor(fadeStartU * spriteL);
    if (clearW > 0) {
      fCtx.clearRect(0, 0, clearW, h);
    }
  }

  // 샤프트 중앙부터 서서히 나타나 헤드 쪽으로 갈수록 100% 불투명해지는 축 방향 마스크 적용
  fCtx.globalCompositeOperation = 'destination-in';
  const maskGrad = fCtx.createLinearGradient(0, 0, spriteL, 0);
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const a = computeShaftAxialAlpha(u, gf);
    maskGrad.addColorStop(u, `rgba(0, 0, 0, ${a.toFixed(4)})`);
  }
  fCtx.fillStyle = maskGrad;
  fCtx.fillRect(0, 0, w, h);
  fCtx.restore();

  cutoutSprite._lastGripFade = gf;
  return dstCanvas;
}

/**
 * 어드레스 영상에서 배경을 투명하게 따낸 실제 골프채(샤프트·헤드 중심) 스프라이트(`cutoutSprite.cutoutCanvas`)가
 * 존재할 경우 해당 실제 골프채 이미지를 스윙 궤도 각도·길이에 맞춰 변환하여 잔상 효과를 렌더링하고,
 * 데모 모드인 경우 실사형 3D 골프채 지오메트리를 렌더링합니다.
 */
export function drawRealisticGolfClub(ctx, gx, gy, hx, hy, options = {}) {
  const {
    alpha = 1.0,
    clubType = 'driver',
    hand = 'right',
    faceOpenDeg = 0,
    addressClub = null,
    isGhost = false,
    shutterSpreadRad = 0,
    refLengthPx = 0,
    gripFade = 0
  } = options;

  const dx = hx - gx;
  const dy = hy - gy;
  const shaftLen = Math.hypot(dx, dy);
  if (shaftLen < 4) return;

  const shaftAngle = Math.atan2(dy, dx);
  const canvasH = ctx.canvas?.height || 720;
  const baseRefPx = refLengthPx > 0 ? refLengthPx : (canvasH * 0.255);
  const scale = clamp(baseRefPx / 182, 0.22, 1.65);
  const foreshorten = clamp(shaftLen / Math.max(1, baseRefPx), 0.44, 1.15);

  const cutoutSprite = addressClub?.cutoutSprite;
  if (cutoutSprite?.cutoutCanvas) {
    // 실제 어드레스 영상에서 배경을 투명하게 따낸 실제 골프채(샤프트+헤드) 이미지에
    // 손 쪽 투명도(gripFade: 손 쪽 100% 투명 -> 중앙부터 서서히 나타나 헤드로 갈수록 선명)를 적용하여 렌더링
    const activeSpriteCanvas = getGripFadedCutoutCanvas(cutoutSprite, gripFade) || cutoutSprite.cutoutCanvas;
    const spriteL = cutoutSprite.shaftLenPx || 240;
    const anchorY = cutoutSprite.anchorY || 36;
    const scaleX = shaftLen / spriteL;
    // 스윙 중 헤드 열림(Open) / 스퀘어(Square) / 닫힘(Closed) 각도에 따른 폭 원근 반영
    const rollRad = clamp(faceOpenDeg, -68, 68) * (Math.PI / 180);
    const openCloseFactor = faceOpenDeg >= 0
      ? (1.0 + 0.14 * Math.sin(rollRad))
      : (0.82 + 0.18 * Math.cos(rollRad));
    const scaleY = clamp(scale / 1.05, 0.45, 1.45) * openCloseFactor;

    ctx.save();
    ctx.translate(gx, gy);

    if (isGhost && Math.abs(shutterSpreadRad) > 0.008) {
      const subSteps = [-0.75, 0];
      const subWeights = [0.28, 1.0];
      for (let s = 0; s < subSteps.length; s++) {
        ctx.save();
        ctx.globalAlpha = clamp(alpha * subWeights[s], 0.02, 1.0);
        ctx.rotate(shaftAngle + shutterSpreadRad * subSteps[s]);
        ctx.scale(scaleX, scaleY);
        ctx.drawImage(activeSpriteCanvas, 0, -anchorY);
        ctx.restore();
      }
      if (alpha > 0.48) {
        ctx.save();
        ctx.globalAlpha = clamp((alpha - 0.48) * 1.75, 0.01, 0.96);
        ctx.rotate(shaftAngle);
        ctx.scale(scaleX, scaleY);
        ctx.drawImage(activeSpriteCanvas, 0, -anchorY);
        ctx.restore();
      }
    } else {
      ctx.globalAlpha = clamp(alpha, 0.02, 1.0);
      ctx.rotate(shaftAngle);
      ctx.scale(scaleX, scaleY);
      ctx.drawImage(activeSpriteCanvas, 0, -anchorY);
      if (isGhost && alpha > 0.48) {
        ctx.globalAlpha = clamp((alpha - 0.48) * 1.75, 0.01, 0.96);
        ctx.drawImage(activeSpriteCanvas, 0, -anchorY);
      }
    }

    ctx.restore();
    return;
  }

  const geomOpts = {
    clubType: addressClub?.clubType || clubType,
    hand: addressClub?.hand || hand,
    scale,
    foreshorten,
    faceOpenDeg,
    shaftAngle,
    headPrimary: addressClub?.headPrimary || '#0B1120',
    headSecondary: addressClub?.headSecondary || '#1E293B',
    isGhost,
    gripFade
  };

  ctx.save();
  ctx.translate(gx, gy);

  if (isGhost && Math.abs(shutterSpreadRad) > 0.008) {
    const subSteps = [-0.75, 0];
    const subWeights = [0.26, 1.0];
    for (let s = 0; s < subSteps.length; s++) {
      ctx.save();
      ctx.globalAlpha = clamp(alpha * subWeights[s], 0.02, 1.0);
      ctx.rotate(shaftAngle + shutterSpreadRad * subSteps[s]);
      renderPhotorealisticClubGeometry(ctx, shaftLen, geomOpts);
      ctx.restore();
    }
    if (alpha > 0.52) {
      ctx.save();
      ctx.globalAlpha = clamp((alpha - 0.52) * 1.65, 0.01, 0.94);
      ctx.rotate(shaftAngle);
      renderPhotorealisticClubGeometry(ctx, shaftLen, geomOpts);
      ctx.restore();
    }
  } else {
    ctx.globalAlpha = clamp(alpha, 0.02, 1.0);
    ctx.rotate(shaftAngle);
    renderPhotorealisticClubGeometry(ctx, shaftLen, geomOpts);
    if (isGhost && alpha > 0.52) {
      ctx.globalAlpha = clamp((alpha - 0.52) * 1.65, 0.01, 0.94);
      renderPhotorealisticClubGeometry(ctx, shaftLen, geomOpts);
    }
  }

  ctx.restore();
}

/**
 * 시간 t (0 ~ duration)에 따른 골퍼의 33개 신체 관절 좌표,
 * 3D 경사 스윙 플레인 원근 단축(각도에 따라 짧아 보이고 길어 보이는 현상)이 반영된 스윙 궤도(그립 & 클럽 헤드),
 * 스윙 동작에 따른 클럽 헤드의 열림(백스윙) -> 스퀘어(임팩트) -> 닫힘(릴리스·팔로우스루·피니시) 각도(`faceOpenDeg`),
 * 그리고 클럽 헤드가 골퍼의 손/팔보다 절대 앞서 나가지 않고 물리적 관성 레깅(Lag)으로 뒤따르는 모션을 산출합니다.
 */
export function synthesizeGolferFrame(time, duration = 3.2, preset = 'driver-fo', hand = 'right') {
  const tAddr = 0.45;
  const tEarlyBack = 0.72;   // 초기 원피스 테이크어웨이 (헤드가 손의 이동을 관성으로 뒤따름)
  const tBack = 0.96;        // 테이크어웨이·백스윙
  const tTop = 1.45;         // 백스윙 탑
  const tDown = 1.62;        // 다운스윙 전환 (강한 손목 코킹 레깅 유지)
  const tDelivery = 1.71;    // 다운스윙 딜리버리 슬롯 P6 (임팩트 0.07초 전까지 샤프트가 수평으로 뒤따름)
  const tImpact = 1.78;      // 임팩트 (핸드퍼스트 스퀘어 타격)
  const tRelease = 1.91;     // 임팩트 직후 전완 롤오버(Release) 및 최대 신전 구간
  const tFollow = 2.08;      // 팔로우스루: 양팔이 지면과 정확히 수평(0°)이 되는 지점
  const tLateFollow = 2.34;  // 팔로우스루 상단: 클럽헤드가 머리 위(12시~11시)를 통과하는 지점
  const tFinish = 2.62;      // 피니시: 클럽헤드가 머리를 완전히 지나 목·어깨 뒤 좌측(8시 30분)까지 넘어간 지점

  const isDTL = preset === 'iron-dtl';
  const mirrorSign = hand === 'left' ? -1 : 1;
  const ASPECT = 16 / 9;

  const baseCenterX = isDTL ? 0.39 : 0.48;
  const baseShoulderY = 0.345;
  const baseHipY = 0.545;
  const ankleY = 0.81;

  const baseArmLenY = isDTL ? 0.156 : 0.184;
  const baseShaftLenY = isDTL ? 0.266 : 0.278;

  // 13개 정밀 생체역학 키프레임 타임스탬프 배열 (초기 테이크어웨이 및 다운스윙 딜리버리 P6 레깅 포함)
  const keyTimes = [
    0.0,
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
    duration
  ];

  const halfPi = Math.PI * 0.5;

  // 1) 그립(양손) 회전 각도 시퀀스
  const gripAngles = isDTL
    ? [
        1.04,  // 0.00s
        1.02,  // 0.45s (01 어드레스)
        1.32,  // 0.72s (초기 원피스 테이크어웨이)
        1.72,  // 0.96s (02 테이크어웨이)
        3.92,  // 1.45s (03 백스윙 탑)
        2.15,  // 1.62s (04 다운스윙 인사이드 슬롯)
        1.42,  // 1.71s (다운스윙 딜리버리 P6)
        0.96,  // 1.78s (05 임팩트 핸드퍼스트)
        0.48,  // 1.91s (릴리스 구간)
        0.00,  // 2.08s (06 팔로우스루: 양팔 지면 수평 0 rad!)
       -0.88,  // 2.34s (팔로우스루 상단)
       -1.92,  // 2.62s (07 피니시)
       -1.95   // 3.20s
      ]
    : [
        halfPi - mirrorSign * 0.025,         // 0.00s
        halfPi - mirrorSign * 0.025,         // 0.45s (01 어드레스: +88.6°)
        halfPi + mirrorSign * 0.36,          // 0.72s (초기 테이크어웨이: +110.6°)
        halfPi + mirrorSign * 0.98,          // 0.96s (02 테이크어웨이/백스윙: +146.1°)
        halfPi + mirrorSign * 2.66,          // 1.45s (03 백스윙 탑: +242.4° 머리/오른쪽 어깨 바로 위 포지션)
        halfPi + mirrorSign * 1.32,          // 1.62s (04 다운스윙 슬롯: +165.6°)
        halfPi + mirrorSign * 0.44,          // 1.71s (다운스윙 딜리버리 P6: +115.2°)
        halfPi - mirrorSign * 0.14,          // 1.78s (05 임팩트 핸드퍼스트: +82.0°)
        halfPi - mirrorSign * 0.86,          // 1.91s (릴리스 익스텐션)
        halfPi - mirrorSign * 1.22,          // 2.08s (06 팔로우스루)
        halfPi - mirrorSign * 1.95,          // 2.34s (팔로우스루 상단 폴딩)
        halfPi - mirrorSign * 2.32,          // 2.62s (07 피니시: 왼쪽 귀·어깨 옆 피니시 손 위치)
        halfPi - mirrorSign * 2.35           // 3.20s
      ];

  // 2) 클럽 샤프트 회전 각도 시퀀스 (피니시 시 헤드가 머리를 지나는 부분을 완전히 넘어서 목·어깨 뒤 좌측까지 회전)
  const shaftAngles = isDTL
    ? [
        1.10,  // 0.00s
        1.08,  // 0.45s (01 어드레스)
        1.30,  // 0.72s (초기 테이크어웨이: 손을 뒤따름)
        1.96,  // 0.96s (02 테이크어웨이)
        4.92,  // 1.45s (03 백스윙 탑)
        3.45,  // 1.62s (04 다운스윙: 강한 레깅으로 손을 뒤따름)
        2.18,  // 1.71s (딜리버리 P6: 임팩트 직전까지 뒤따름)
        1.08,  // 1.78s (05 임팩트 핸드퍼스트 타격)
        0.56,  // 1.91s (릴리스: 팔을 따라 뻗음)
        0.06,  // 2.08s (06 팔로우스루: 수평 연장선)
       -1.65,  // 2.34s (팔로우스루 상단: 머리 위 통과)
       -4.35,  // 2.62s (07 피니시: 머리를 넘어 등 뒤로 완전히 감김)
       -4.48   // 3.20s
      ]
    : [
        halfPi + mirrorSign * 0.015,         // 0.00s
        halfPi + mirrorSign * 0.010,         // 0.45s (01 어드레스: +90.6°)
        halfPi + mirrorSign * 0.78,          // 0.72s (초기 테이크어웨이: +134.7° 7시 30분 방향)
        halfPi + mirrorSign * 1.62,          // 0.96s (02 테이크어웨이/백스윙: +182.8° 9시 수평 테이크어웨이)
        halfPi + mirrorSign * 4.86,          // 1.45s (03 백스윙 탑: +368.5° 머리 뒤로 넘어와 우측 3시 15분 방향 코일링!)
        halfPi + mirrorSign * 3.36,          // 1.62s (04 다운스윙 전환: +282.5° 손(+165.6°) 뒤에서 강한 레깅 유지!)
        halfPi + mirrorSign * 1.62,          // 1.71s (다운스윙 딜리버리 P6: +182.8° 손(+115.2°)보다 67° 뒤에서 수평 진입!)
        halfPi + mirrorSign * 0.096,         // 1.78s (05 임팩트: +95.5° 핸드퍼스트(+82°) 뒤에서 공을 정확히 스퀘어 타격!)
        halfPi - mirrorSign * 0.78,          // 1.91s (릴리스: +45.9° 손을 뒤따르며 페이스 롤오버!)
        halfPi - mirrorSign * (halfPi - 0.06), // 2.08s (06 팔로우스루: +3.4° 수평 일직선 익스텐션!)
        halfPi - mirrorSign * 3.35,          // 2.34s (팔로우스루 상단: -102° 클럽헤드가 머리 정점 위를 지나는 구간!)
        halfPi - mirrorSign * 4.96,          // 2.62s (07 피니시: -194° 클럽헤드가 머리를 완전히 넘어서 목·어깨 뒤 좌측 8시 30분 위치에 도달!)
        halfPi - mirrorSign * 5.08           // 3.20s
      ];

  // 3) 3D 경사 스윙 플레인 원근 비율 및 팔로우스루·피니시 익스텐션:
  const shaftForeshortenSeries = isDTL
    ? [0.88, 0.88, 0.70, 0.56, 0.86, 0.62, 0.78, 0.96, 0.94, 0.88, 0.76, 0.74, 0.74]
    : [0.92, 0.92, 0.96, 1.00, 0.65, 0.74, 0.90, 1.00, 1.06, 1.08, 0.82, 0.80, 0.80];

  // 팔(어깨->그립) 회전 반경 비율
  const armForeshortenSeries = isDTL
    ? [0.96, 0.96, 0.92, 0.88, 0.84, 0.82, 0.90, 0.98, 1.00, 0.96, 0.78, 0.68, 0.68]
    : [0.92, 0.92, 0.92, 0.88, 0.72, 0.80, 0.88, 0.94, 0.68, 0.66, 0.55, 0.46, 0.46];

  // 4) 클럽 헤드 페이스 열림/스퀘어/닫힘 각도 (`faceOpenDeg`)
  const faceOpenSeries = [
    0,    // 0.00s
    0,    // 0.45s (Address: 0° Square)
    18,   // 0.72s (Early Takeaway: +18° Slightly Opening)
    38,   // 0.96s (Takeaway: +38° Open)
    54,   // 1.45s (Top: +54° Open)
    36,   // 1.62s (Downswing Transition: +36° Open)
    18,   // 1.71s (Delivery Slot P6: +18° Closing toward Impact)
    0,    // 1.78s (Impact: 0° Square!)
   -36,   // 1.91s (Release: -36° Closed Turnover!)
   -50,   // 2.08s (Follow-Through: -50° Closed!)
   -58,   // 2.34s (Late Follow-Through: -58° Closed)
   -64,   // 2.62s (Finish: -64° Closed)
   -64    // 3.20s
  ];

  const shoulderTurnSeries = [0, 0, 0.28, 0.62, 1.15, 0.58, 0.16, -0.24, -0.62, -0.95, -1.28, -1.48, -1.50];
  const hipTurnSeries      = [0, 0, 0.12, 0.30, 0.60, 0.05, -0.35, -0.68, -0.94, -1.12, -1.28, -1.38, -1.40];
  const hipShiftSeries     = isDTL
    ? [0, 0, -0.002, -0.005, -0.008, 0.004, 0.009, 0.012, 0.018, 0.022, 0.027, 0.030, 0.030]
    : [0, 0, -mirrorSign * 0.008, -mirrorSign * 0.018, -mirrorSign * 0.032, mirrorSign * 0.012, mirrorSign * 0.026, mirrorSign * 0.036, mirrorSign * 0.048, mirrorSign * 0.056, mirrorSign * 0.066, mirrorSign * 0.072, mirrorSign * 0.074];
  const hipDropSeries      = [0, 0, 0.002, 0.005, 0.010, 0.018, 0.008, -0.004, -0.010, -0.014, -0.019, -0.022, -0.022];
  const spineRiseSeries    = [0, 0, -0.002, -0.004, -0.008, -0.004, 0.000, 0.004, 0.011, 0.018, 0.028, 0.035, 0.036];
  const headTurnSeries     = [0, 0, -0.03, -0.08, -0.15, -0.08, -0.04, 0.0, 0.26, 0.55, 0.82, 1.0, 1.0];
  const heelLiftSeries     = [0, 0, 0.0, 0.0, 0.0, 0.05, 0.14, 0.25, 0.50, 0.72, 0.90, 1.0, 1.0];
  const kneeFlexSeries     = [0.035, 0.035, 0.039, 0.043, 0.050, 0.054, 0.038, 0.024, 0.018, 0.014, 0.010, 0.007, 0.007];

  const gripAngle        = pchipInterpolate(keyTimes, gripAngles, time);
  const shaftAngle       = pchipInterpolate(keyTimes, shaftAngles, time);
  const shaftForeshorten = pchipInterpolate(keyTimes, shaftForeshortenSeries, time);
  const armForeshorten   = pchipInterpolate(keyTimes, armForeshortenSeries, time);
  const faceOpenDeg      = Number(pchipInterpolate(keyTimes, faceOpenSeries, time).toFixed(1));
  const shoulderTurn     = pchipInterpolate(keyTimes, shoulderTurnSeries, time);
  const hipTurn          = pchipInterpolate(keyTimes, hipTurnSeries, time);
  const hipShiftX        = pchipInterpolate(keyTimes, hipShiftSeries, time);
  const hipDropY         = pchipInterpolate(keyTimes, hipDropSeries, time);
  const spineRise        = pchipInterpolate(keyTimes, spineRiseSeries, time);
  const headTurn         = pchipInterpolate(keyTimes, headTurnSeries, time);
  const trailHeelLift    = clamp(pchipInterpolate(keyTimes, heelLiftSeries, time), 0, 1);
  const kneeFlex         = pchipInterpolate(keyTimes, kneeFlexSeries, time);

  // 골퍼 신체 중심 및 상·하체 3D 코일링/릴리스 좌표 계산
  const hipCenterX = baseCenterX + hipShiftX;
  const hipCenterY = baseHipY + hipDropY;

  const upperSwayX = isDTL
    ? (hipShiftX * 0.65 - spineRise * 0.35)
    : (hipShiftX * 0.52);
  const shoulderCenterX = baseCenterX + upperSwayX;
  const shoulderCenterY = baseShoulderY + hipDropY * 0.8 - spineRise;

  const horizFollowFactor = Math.exp(-Math.pow((time - tFollow) / 0.18, 2));
  const downFactor = clamp(Math.sin(gripAngle), 0, 1);
  // 팔로우스루 시 상체 회전 및 타깃 방향 체중 이동과 함께 어깨 회전축에서 팔이 길게 뻗어 나가도록 보정
  const pivotX = isDTL
    ? 0.405
    : (baseCenterX + hipShiftX * 0.45 + mirrorSign * 0.018 * horizFollowFactor);
  const pivotY = shoulderCenterY + 0.022 * downFactor;

  const effArmLenY = baseArmLenY * armForeshorten;
  const effShaftLenY = baseShaftLenY * shaftForeshorten;

  const gripX = pivotX + Math.cos(gripAngle) * (effArmLenY / ASPECT);
  const gripY = pivotY + Math.sin(gripAngle) * effArmLenY;

  const headX = clamp(gripX + Math.cos(shaftAngle) * (effShaftLenY / ASPECT), 0.02, 0.98);
  const headY = clamp(gripY + Math.sin(shaftAngle) * effShaftLenY, 0.02, 0.97);

  const leadSideSign = isDTL ? -1 : mirrorSign;

  const shCos = Math.cos(shoulderTurn * 0.68);
  const shHalfW = isDTL ? (0.038 + Math.sin(shoulderTurn * 0.6) * 0.018) : (0.068 * shCos);
  const shTiltY = Math.sin(shoulderTurn * 0.58) * 0.024 * (1 - 0.85 * horizFollowFactor);

  const leadShoulder = {
    x: shoulderCenterX + leadSideSign * shHalfW,
    y: shoulderCenterY + shTiltY,
    z: 0,
    visibility: 0.98
  };
  const trailShoulder = {
    x: shoulderCenterX - leadSideSign * shHalfW,
    y: shoulderCenterY - shTiltY,
    z: 0,
    visibility: 0.98
  };

  const hipCos = Math.cos(hipTurn * 0.68);
  const hipHalfW = isDTL ? (0.034 + Math.sin(hipTurn * 0.5) * 0.012) : (0.054 * hipCos);
  const hipTiltY = Math.sin(hipTurn * 0.5) * 0.012;

  const leadHip = {
    x: hipCenterX + leadSideSign * hipHalfW,
    y: hipCenterY + hipTiltY,
    z: 0,
    visibility: 0.98
  };
  const trailHip = {
    x: hipCenterX - leadSideSign * hipHalfW,
    y: hipCenterY - hipTiltY,
    z: 0,
    visibility: 0.98
  };

  const computeElbow = (shoulder, wrist, bendDir = 1) => {
    const mx = (shoulder.x + wrist.x) * 0.5;
    const my = (shoulder.y + wrist.y) * 0.5;
    const dx = (wrist.x - shoulder.x) * ASPECT;
    const dy = wrist.y - shoulder.y;
    const dist = Math.hypot(dx, dy);
    const armLen = 0.21;
    const extMask = 1 - 0.92 * horizFollowFactor;
    const sag = Math.sqrt(Math.max(0.0001, Math.max(0, armLen * armLen * 0.25 - dist * dist * 0.23))) * bendDir * extMask;
    const nx = -dy / Math.max(1e-4, dist);
    const ny = dx / Math.max(1e-4, dist);
    return {
      x: mx + (nx * sag * 0.38) / ASPECT,
      y: my + ny * sag * 0.38 + 0.006 * extMask,
      z: 0,
      visibility: 0.96
    };
  };

  const leadWrist = { x: gripX + leadSideSign * 0.004, y: gripY, z: 0, visibility: 0.97 };
  const trailWrist = { x: gripX - leadSideSign * 0.004, y: gripY + 0.002 * (1 - horizFollowFactor), z: 0, visibility: 0.97 };
  const leadElbow = computeElbow(leadShoulder, leadWrist, time > tImpact ? 0.20 : -0.18);
  const trailElbow = computeElbow(trailShoulder, trailWrist, time < tImpact ? -0.48 : 0.24);

  const stanceHalfW = isDTL ? 0.030 : 0.082;
  const baseFootCenterX = isDTL ? 0.39 : 0.48;

  const leadAnkle = {
    x: baseFootCenterX + leadSideSign * stanceHalfW,
    y: ankleY,
    z: 0,
    visibility: 0.98
  };
  const trailAnkle = {
    x: baseFootCenterX - leadSideSign * stanceHalfW + leadSideSign * trailHeelLift * (isDTL ? 0.018 : 0.026),
    y: ankleY - trailHeelLift * 0.028,
    z: 0,
    visibility: 0.98
  };

  const backswingKneeIn = shoulderTurn > 0 ? Math.sin(clamp(shoulderTurn, 0, 1.2)) * 0.028 : 0;
  const leadKnee = {
    x: (leadHip.x + leadAnkle.x) * 0.5 + leadSideSign * (kneeFlex * 0.35 - backswingKneeIn),
    y: (leadHip.y + leadAnkle.y) * 0.5 + backswingKneeIn * 0.25,
    z: 0,
    visibility: 0.97
  };
  const trailKnee = {
    x: (trailHip.x + trailAnkle.x) * 0.5 + leadSideSign * (trailHeelLift * (isDTL ? 0.032 : 0.068) - kneeFlex * 0.35),
    y: (trailHip.y + trailAnkle.y) * 0.5 + trailHeelLift * 0.012,
    z: 0,
    visibility: 0.97
  };

  const headPos = {
    x: shoulderCenterX + leadSideSign * (headTurn * 0.014 - 0.008),
    y: shoulderCenterY - 0.080,
    z: 0,
    visibility: 0.99
  };

  const points = Array.from({ length: 33 }, () => ({ x: hipCenterX, y: hipCenterY, z: 0, visibility: 0.1 }));
  points[0] = headPos;
  points[11] = leadShoulder;
  points[12] = trailShoulder;
  points[13] = leadElbow;
  points[14] = trailElbow;
  points[15] = leadWrist;
  points[16] = trailWrist;
  points[19] = {
    x: leadWrist.x + Math.cos(shaftAngle) * (0.035 / ASPECT),
    y: leadWrist.y + Math.sin(shaftAngle) * 0.035,
    z: 0,
    visibility: 0.95
  };
  points[20] = {
    x: trailWrist.x + Math.cos(shaftAngle) * (0.035 / ASPECT),
    y: trailWrist.y + Math.sin(shaftAngle) * 0.035,
    z: 0,
    visibility: 0.95
  };
  points[23] = leadHip;
  points[24] = trailHip;
  points[25] = leadKnee;
  points[26] = trailKnee;
  points[27] = leadAnkle;
  points[28] = trailAnkle;
  points[29] = { x: leadAnkle.x + leadSideSign * 0.015, y: ankleY + 0.018, z: 0, visibility: 0.95 };
  points[30] = { x: trailAnkle.x - leadSideSign * 0.015, y: trailAnkle.y + 0.018, z: 0, visibility: 0.95 };
  points[31] = { x: leadAnkle.x + leadSideSign * 0.028, y: ankleY + 0.02, z: 0, visibility: 0.95 };
  points[32] = { x: trailAnkle.x - leadSideSign * 0.012, y: ankleY + 0.02, z: 0, visibility: 0.95 };

  // 어드레스 & 임팩트 공통 볼(티) 위치 산출
  const addrGripAngle = gripAngles[1];
  const addrShaftAngle = shaftAngles[1];
  const addrArmLen = baseArmLenY * armForeshortenSeries[1];
  const addrShaftLen = baseShaftLenY * shaftForeshortenSeries[1];
  const addrPivotX = isDTL ? 0.405 : baseCenterX;
  const addrPivotY = baseShoulderY + 0.022 * clamp(Math.sin(addrGripAngle), 0, 1);
  const addrGripX = addrPivotX + Math.cos(addrGripAngle) * (addrArmLen / ASPECT);
  const addrGripY = addrPivotY + Math.sin(addrGripAngle) * addrArmLen;
  const addrHeadX = addrGripX + Math.cos(addrShaftAngle) * (addrShaftLen / ASPECT);
  const addrHeadY = addrGripY + Math.sin(addrShaftAngle) * addrShaftLen;

  const teeBallX = isDTL ? addrHeadX + 0.010 : addrHeadX + mirrorSign * 0.011;
  const teeBallY = addrHeadY + 0.002;

  let ballPos = { x: teeBallX, y: teeBallY, teeX: teeBallX, teeY: teeBallY, flying: false, dtBall: 0 };
  if (time > tImpact) {
    const dtBall = time - tImpact;
    ballPos = {
      x: isDTL ? teeBallX + dtBall * 0.34 : teeBallX + mirrorSign * dtBall * 0.92,
      y: teeBallY - dtBall * 0.78 + 0.22 * dtBall * dtBall,
      teeX: teeBallX,
      teeY: teeBallY,
      flying: true,
      dtBall
    };
  }

  return {
    time,
    aspect: ASPECT,
    points,
    grip: { x: gripX, y: gripY },
    clubHead: {
      x: headX,
      y: headY,
      shaftAngle,
      faceOpenDeg,
      foreshorten: Number(shaftForeshorten.toFixed(3)),
      pinned: false
    },
    clubHeadBase: {
      x: headX,
      y: headY,
      shaftAngle,
      faceOpenDeg,
      foreshorten: Number(shaftForeshorten.toFixed(3))
    },
    ballPos,
    bodyMotion: {
      shoulderTurn,
      hipTurn,
      headTurn,
      trailHeelLift,
      hipShiftX
    }
  };
}

/**
 * 캔버스에 실제 골프 드라이빙 레인지/스튜디오 환경, 전신 회전·체중 이동·피벗이 살아있는 프로 골퍼 영상 프레임,
 * 타구 순간 디봇/티 스플래시 및 볼 궤적, 그리고 3D 페이스 회전이 반영된 실사 골프채를 함께 렌더링합니다.
 */
export function drawSynthesizedGolferScene(ctx, width, height, frameData, preset = 'driver-fo', addressClub = null, hand = 'right') {
  ctx.save();

  const isDTL = preset === 'iron-dtl';
  const mirrorSign = hand === 'left' ? -1 : 1;
  const leadSideSign = isDTL ? -1 : mirrorSign;
  const motion = frameData.bodyMotion || {
    shoulderTurn: 0,
    hipTurn: 0,
    headTurn: 0,
    trailHeelLift: 0,
    hipShiftX: 0
  };

  // ==========================================================================
  // 1) 투어 드라이빙 레인지 & 스튜디오 배경 (하늘, 원경 코스 실루엣, 페어웨이 잔디, 타석 매트)
  // ==========================================================================
  const horizonY = Math.round(height * 0.64);
  const turfY = Math.round(height * 0.77);

  const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
  skyGrad.addColorStop(0.0, '#E2E8F0');
  skyGrad.addColorStop(0.65, '#F1F5F9');
  skyGrad.addColorStop(1.0, '#F8FAFC');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, horizonY);

  // 원경 구름/언덕 및 수목 실루엣
  ctx.fillStyle = '#CBD5E1';
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.quadraticCurveTo(width * 0.22, horizonY - 26, width * 0.48, horizonY - 10);
  ctx.quadraticCurveTo(width * 0.76, horizonY - 32, width, horizonY - 8);
  ctx.lineTo(width, horizonY);
  ctx.closePath();
  ctx.fill();

  // 중경 페어웨이 잔디 (64% ~ 77%)
  const fairwayGrad = ctx.createLinearGradient(0, horizonY, 0, turfY);
  fairwayGrad.addColorStop(0.0, '#D5E2DA');
  fairwayGrad.addColorStop(1.0, '#C5D6CC');
  ctx.fillStyle = fairwayGrad;
  ctx.fillRect(0, horizonY, width, turfY - horizonY);

  // 페어웨이 잔디 깎기 줄무늬 & 타깃 거리 표지판
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  for (let stripe = 0; stripe < 5; stripe++) {
    const sy = horizonY + (turfY - horizonY) * (stripe / 5);
    const sh = (turfY - horizonY) / 10;
    ctx.fillRect(0, sy, width, sh);
  }

  // 전경 티박스 타석 잔디 매트 (77% ~ 100%)
  const matGrad = ctx.createLinearGradient(0, turfY, 0, height);
  matGrad.addColorStop(0.0, '#DCE5DF');
  matGrad.addColorStop(0.25, '#CFDBD3');
  matGrad.addColorStop(1.0, '#BFCFC5');
  ctx.fillStyle = matGrad;
  ctx.fillRect(0, turfY, width, height - turfY);

  ctx.strokeStyle = '#B2C4B9';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, turfY);
  ctx.lineTo(width, turfY);
  ctx.stroke();

  // 정밀 분석 그리드 (은은한 배경 기준선)
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.14)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const gx = (width / 4) * i;
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, turfY);
    ctx.stroke();
  }

  const p = frameData.points;
  const px = idx => p[idx].x * width;
  const py = idx => p[idx].y * height;

  // ==========================================================================
  // 2) 골퍼 및 클럽의 실시간 지면 그림자 (골퍼 체중 이동 및 클럽 위치에 연동)
  // ==========================================================================
  const footCenterX = (px(27) + px(28)) * 0.5 + motion.hipShiftX * width * 0.6;
  const shadowFootY = Math.max(py(27), py(28)) + 6;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
  ctx.beginPath();
  ctx.ellipse(footCenterX, shadowFootY, width * 0.105, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  // 클럽 헤드 지면 그림자
  const clubShadowX = frameData.clubHead.x * width;
  const clubDistGround = clamp(1 - Math.abs(0.81 - frameData.clubHead.y) * 1.8, 0.15, 0.85);
  ctx.fillStyle = `rgba(15, 23, 42, ${(0.16 * clubDistGround).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(clubShadowX, shadowFootY + 2, 18 * clubDistGround, 4.5 * clubDistGround, 0, 0, Math.PI * 2);
  ctx.fill();

  // 티(Rubber Tee) 렌더링
  if (frameData.ballPos?.teeX !== undefined) {
    const tx = frameData.ballPos.teeX * width;
    const ty = frameData.ballPos.teeY * height;
    ctx.fillStyle = '#F8FAFC';
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tx - 2.2, ty + 10);
    ctx.lineTo(tx + 2.2, ty + 10);
    ctx.lineTo(tx + 1.4, ty + 1);
    ctx.lineTo(tx - 1.4, ty + 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // ==========================================================================
  // 3) 프로 골퍼 전신 렌더링 (다리·무릎 주름·골프화 피벗·골반 벨트·상체 폴로셔츠·머리·모자)
  // ==========================================================================
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const legWidth = Math.max(14, width * 0.0175);

  // (a) 트레일 다리 (오른손잡이 기준 오른다리 — 피니시 시 무릎이 리드 다리 쪽으로 회전해 모임)
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = legWidth;
  ctx.beginPath();
  ctx.moveTo(px(24), py(24));
  ctx.lineTo(px(26), py(26));
  ctx.lineTo(px(28), py(28));
  ctx.stroke();

  // 트레일 다리 입체 하이라이트
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = legWidth * 0.38;
  ctx.beginPath();
  ctx.moveTo(px(24) - 2, py(24));
  ctx.lineTo(px(26) - 2, py(26));
  ctx.lineTo(px(28) - 2, py(28));
  ctx.stroke();

  // (b) 리드 다리 (오른손잡이 기준 왼다리 — 임팩트~피니시 시 단단하게 벽을 만듦)
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = legWidth * 1.05;
  ctx.beginPath();
  ctx.moveTo(px(23), py(23));
  ctx.lineTo(px(25), py(25));
  ctx.lineTo(px(27), py(27));
  ctx.stroke();

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = legWidth * 0.40;
  ctx.beginPath();
  ctx.moveTo(px(23) + leadSideSign * 2, py(23));
  ctx.lineTo(px(25) + leadSideSign * 2, py(25));
  ctx.lineTo(px(27) + leadSideSign * 2, py(27));
  ctx.stroke();

  // (c) 투어 골프화 (리드 발은 지면 밀착, 트레일 발은 팔로우스루~피니시 시 뒤꿈치가 들리며 발끝으로 서는 모션 표현)
  // 리드 골프화
  ctx.save();
  ctx.translate(px(27), py(27) + 4);
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.ellipse(leadSideSign * 3, 0, 16, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 골프화 새들 스트라이프
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(-5, -4, 8, 7);
  ctx.restore();

  // 트레일 골프화 (trailHeelLift 0 -> 1 에 따라 발끝을 축으로 최대 68° 세워짐)
  ctx.save();
  const toePivotX = px(28) + leadSideSign * 10 * motion.trailHeelLift;
  const toePivotY = py(27) + 4;
  ctx.translate(toePivotX, toePivotY);
  ctx.rotate(leadSideSign * motion.trailHeelLift * 1.15);
  ctx.fillStyle = '#F8FAFC';
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.ellipse(-leadSideSign * 6 * motion.trailHeelLift, -2 * motion.trailHeelLift, 15.5, 6.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#1E293B';
  ctx.fillRect(-4, -4, 7, 6.5);
  ctx.restore();

  // (d) 상체 토르소 (폴로 셔츠 — 어깨 회전과 골반 회전에 따라 가슴/등 입체 명암 및 셔츠 주름이 실시간 변화)
  const shMidX = (px(11) + px(12)) * 0.5;
  const shMidY = (py(11) + py(12)) * 0.5;
  const hipMidX = (px(23) + px(24)) * 0.5;
  const hipMidY = (py(23) + py(24)) * 0.5;

  // 회전 시에도 몸통 최소 두께가 유지되도록 외곽 보정
  const minTorsoHalfW = Math.max(18, width * 0.024);
  const shLeftX = Math.min(px(11), px(12), shMidX - minTorsoHalfW);
  const shRightX = Math.max(px(11), px(12), shMidX + minTorsoHalfW);
  const hipLeftX = Math.min(px(23), px(24), hipMidX - minTorsoHalfW * 0.82);
  const hipRightX = Math.max(px(23), px(24), hipMidX + minTorsoHalfW * 0.82);

  const torsoGrad = ctx.createLinearGradient(shLeftX, shMidY, shRightX, hipMidY);
  torsoGrad.addColorStop(0.0, '#1E293B');
  torsoGrad.addColorStop(0.45, '#334155');
  torsoGrad.addColorStop(1.0, '#0F172A');

  ctx.fillStyle = torsoGrad;
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(shLeftX, py(12));
  ctx.lineTo(shRightX, py(11));
  ctx.lineTo(hipRightX, py(23));
  ctx.lineTo(hipLeftX, py(24));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 상체 회전 중심선(폴로 셔츠 앞섶 플래킷 & 토르소 꼬임 주름선) — 상체 회전이 한눈에 보이게 표시
  const chestFrontOffsetX = -leadSideSign * Math.sin(motion.shoulderTurn * 0.65) * (minTorsoHalfW * 0.85);
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.45)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(shMidX + chestFrontOffsetX * 0.4, shMidY + 4);
  ctx.lineTo(shMidX + chestFrontOffsetX, shMidY + (hipMidY - shMidY) * 0.42);
  ctx.stroke();

  // 코일링 토크 사선 주름 (어깨와 골반의 회전차 X-Factor 시각화)
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(shMidX + chestFrontOffsetX * 0.7, shMidY + (hipMidY - shMidY) * 0.35);
  ctx.lineTo(hipMidX - leadSideSign * Math.sin(motion.hipTurn * 0.6) * 14, hipMidY - 6);
  ctx.stroke();

  // 골반 벨트 및 버클 (골반 회전에 따라 버클 위치가 타깃 방향으로 이동)
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(hipLeftX + 2, hipMidY);
  ctx.lineTo(hipRightX - 2, hipMidY);
  ctx.stroke();

  const buckleX = clamp(
    hipMidX - leadSideSign * Math.sin(motion.hipTurn * 0.65) * (minTorsoHalfW * 0.78),
    hipLeftX + 5,
    hipRightX - 5
  );
  ctx.fillStyle = '#F8FAFC';
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 1.2;
  ctx.fillRect(buckleX - 5, hipMidY - 3.5, 10, 7);
  ctx.strokeRect(buckleX - 5, hipMidY - 3.5, 10, 7);

  // (e) 머리 및 투어 골프 캡(모자 챙이 시선 방향 headTurn에 따라 타깃 쪽으로 회전)
  const headRadius = Math.max(15, width * 0.020);
  const hxHead = px(0);
  const hyHead = py(0);

  // 목
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = Math.max(8, width * 0.010);
  ctx.beginPath();
  ctx.moveTo(shMidX, shMidY);
  ctx.lineTo(hxHead, hyHead + headRadius * 0.5);
  ctx.stroke();

  // 얼굴/머리 구체
  ctx.fillStyle = '#E2E8F0';
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(hxHead, hyHead, headRadius * 0.88, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 골프 캡 크라운 & 바이저(모자 챙: 어드레스/임팩트 시 정면 하단, 피니시 시 타깃 방향으로 회전!)
  const visorDirX = isDTL
    ? 1.0
    : leadSideSign * clamp(0.15 + motion.headTurn * 0.95, -0.45, 1.05);
  const visorDirY = isDTL ? 0.15 : (0.55 - Math.abs(motion.headTurn) * 0.32);

  ctx.fillStyle = '#0F172A';
  ctx.beginPath();
  ctx.arc(hxHead, hyHead - 2, headRadius * 0.92, Math.PI * 0.95, Math.PI * 2.05);
  ctx.closePath();
  ctx.fill();

  // 모자 챙(Visor)
  ctx.fillStyle = '#1E293B';
  ctx.beginPath();
  ctx.moveTo(hxHead - headRadius * 0.55, hyHead - 1);
  ctx.quadraticCurveTo(
    hxHead + visorDirX * headRadius * 1.45,
    hyHead + visorDirY * headRadius * 0.95,
    hxHead + headRadius * 0.65,
    hyHead - 1
  );
  ctx.closePath();
  ctx.fill();

  // (f) 트레일 팔 & 리드 팔 (폴로 셔츠 소매 + 전완근 표현)
  const drawGolferArm = (shIdx, elIdx, wrIdx, armColor, sleeveColor, widthScale = 1.0) => {
    const sx = px(shIdx), sy = py(shIdx);
    const ex = px(elIdx), ey = py(elIdx);
    const wx = px(wrIdx), wy = py(wrIdx);

    // 전완 및 상완
    ctx.strokeStyle = armColor;
    ctx.lineWidth = Math.max(10, width * 0.0125) * widthScale;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.lineTo(wx, wy);
    ctx.stroke();

    // 폴로 셔츠 반소매 (어깨 -> 상완 55% 지점)
    ctx.strokeStyle = sleeveColor;
    ctx.lineWidth = Math.max(13, width * 0.0155) * widthScale;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + (ex - sx) * 0.55, sy + (ey - sy) * 0.55);
    ctx.stroke();
  };

  drawGolferArm(12, 14, 16, '#64748B', '#334155', 0.95);
  drawGolferArm(11, 13, 15, '#475569', '#1E293B', 1.04);

  // 골프 장갑(양손 파지 베이스) - 이 위로 잔상과 현재 골프채 및 전면 장갑이 일체감 있게 결합됨
  const gx = frameData.grip.x * width;
  const gy = frameData.grip.y * height;
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(gx, gy, 5.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // ==========================================================================
  // 5) 임팩트 순간 잔디/티 스플래시 파티클 및 골프공 비행 궤적(Ball Flight Tracer) 렌더링
  // ==========================================================================
  if (frameData.ballPos) {
    const { x, y, teeX, teeY, flying, dtBall } = frameData.ballPos;

    // 임팩트 직후(dtBall: 0 ~ 0.65s) 타구 지점 잔디/티 스플래시 및 볼 발사 궤적선 표시
    if (flying && teeX !== undefined && teeY !== undefined) {
      const startX = teeX * width;
      const startY = teeY * height;
      const currBallX = x * width;
      const currBallY = y * height;

      // 볼 비행 궤적 아크 (Shot Tracer)
      ctx.save();
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.55)';
      ctx.lineWidth = 2.6;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      const midT = dtBall * 0.5;
      const midX = (isDTL ? teeX + midT * 0.34 : teeX + mirrorSign * midT * 0.92) * width;
      const midY = (teeY - midT * 0.78 + 0.22 * midT * midT) * height;
      ctx.quadraticCurveTo(midX, midY - 12, currBallX, currBallY);
      ctx.stroke();
      ctx.restore();

      // 임팩트 직후 잔디/티 파편 효과
      if (dtBall < 0.45) {
        const splashAlpha = clamp(1 - dtBall / 0.45, 0, 1);
        ctx.fillStyle = `rgba(71, 85, 105, ${(splashAlpha * 0.65).toFixed(2)})`;
        for (let sp = 0; sp < 5; sp++) {
          const ang = -0.35 - sp * 0.22;
          const dist = (14 + sp * 9) * (dtBall * 3.2);
          const pxSplash = startX + mirrorSign * Math.cos(ang) * dist;
          const pySplash = startY + Math.sin(ang) * dist + 18 * dtBall * dtBall;
          ctx.beginPath();
          ctx.arc(pxSplash, pySplash, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    if (x >= -0.05 && x <= 1.05 && y >= -0.05 && y <= 1.05) {
      const bx = x * width;
      const by = y * height;
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(bx, by, 6.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * 프리셋 데모 스윙의 전체 프레임 샘플 배열과 7단계 키프레임을 즉시 생성합니다.
 */
export function buildDemoSwingDataset(preset = 'driver-fo', fps = 60, duration = 3.2, hand = 'right') {
  const rawSamples = [];
  const totalFrames = Math.round(duration * fps);

  for (let i = 0; i <= totalFrames; i++) {
    const time = Number((i / fps).toFixed(4));
    const frame = synthesizeGolferFrame(time, duration, preset, hand);
    rawSamples.push(frame);
  }

  for (let i = 0; i < rawSamples.length; i++) {
    if (i === 0) {
      rawSamples[i].clubSpeed = 0;
    } else {
      const prev = rawSamples[i - 1];
      const curr = rawSamples[i];
      const dt = Math.max(1 / fps, curr.time - prev.time);
      const dist = Math.hypot(curr.clubHead.x - prev.clubHead.x, curr.clubHead.y - prev.clubHead.y);
      rawSamples[i].clubSpeed = Math.min(122, Math.round((dist / dt) * 28.5));
    }
  }

  const keyMoments = [
    { key: 'address', labelKo: '어드레스', labelEn: 'Address', time: 0.45, source: 'auto' },
    { key: 'backswing', labelKo: '테이크어웨이·백스윙', labelEn: 'Takeaway', time: 0.96, source: 'auto' },
    { key: 'top', labelKo: '백스윙 탑', labelEn: 'Top of Swing', time: 1.45, source: 'auto' },
    { key: 'downswing', labelKo: '다운스윙 전환', labelEn: 'Downswing', time: 1.62, source: 'auto' },
    { key: 'impact', labelKo: '임팩트', labelEn: 'Impact', time: 1.78, source: 'auto' },
    { key: 'follow', labelKo: '팔로우스루', labelEn: 'Follow-Through', time: 2.08, source: 'auto' },
    { key: 'finish', labelKo: '피니시', labelEn: 'Finish', time: 2.62, source: 'auto' }
  ];

  return {
    samples: rawSamples,
    keyMoments,
    fps,
    duration,
    preset
  };
}
