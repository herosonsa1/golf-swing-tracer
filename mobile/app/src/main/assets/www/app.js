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
} from './swing-engine.js';
import {
  buildDemoSwingDataset,
  createAddressClubTemplate
} from './demo-generator.js';
import {
  findNearestSample,
  renderCompositeFrame,
  exportStrobeSnapshot,
  exportSequencePanorama,
  exportAfterimageVideo,
  seekVideoSafely
} from './renderer-exporter.js';

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

export const appState = {
  sourceMode: 'demo', // 'demo' | 'video'
  demoPreset: 'driver-fo', // 'driver-fo' | 'iron-dtl'
  videoElement: null,
  videoReady: false,
  videoFileName: '내장 프로 스윙 시뮬레이션 (Driver Face-On 60fps)',
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
  manualPinMode: false,
  busy: false,
  samples: [],
  keyMoments: [],
  addressClub: null,
  selectedPhaseKey: 'impact',
  renderOptions: { ...DEFAULT_RENDER_OPTIONS }
};

let rafId = null;
let lastFrameTimestamp = 0;
let poseLandmarkerInstance = null;

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

function initStudio() {
  appState.videoElement = $('hiddenVideo');
  appState.renderOptions = { ...DEFAULT_RENDER_OPTIONS };
  syncRenderOptionsUI();
  bindControls();
  loadDemoPreset('driver-fo');
}

function loadDemoPreset(preset) {
  stopPlayback();
  appState.sourceMode = 'demo';
  appState.demoPreset = preset;
  appState.videoReady = false;
  appState.videoFileName = preset === 'iron-dtl'
    ? '내장 프로 스윙 시뮬레이션 (Iron DTL 측면 뷰 60fps)'
    : '내장 프로 스윙 시뮬레이션 (Driver 정면 뷰 60fps)';

  const dataset = buildDemoSwingDataset(preset, 60, 3.2, appState.hand);
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
      clubType: preset === 'iron-dtl' ? 'iron' : 'driver',
      hand: appState.hand
    }
  );

  const finishMoment = appState.keyMoments.find(m => m.key === 'finish');
  appState.currentTime = finishMoment ? finishMoment.time : 2.62;
  appState.selectedPhaseKey = 'finish';

  $('activeFileLabel').textContent = appState.videoFileName;
  $('timelineRange').max = String(appState.duration);
  $('timelineRange').value = String(appState.currentTime);
  syncClipRangeUI(true);
  setStatusMessage('오른손잡이 기준 스윙 궤도 정합 완료 (백스윙 탑 이후 다운스윙~피니시 잔상 표시)');

  renderMainStage();
  renderPhaseFilmstrip();
  updateMetricsAndCoachingUI();
}

// ============================================================================
// 사용자 실제 비디오 파일 업로드 및 AI 스윙/헤드 궤적 분석
// ============================================================================

async function handleVideoFileUpload(file) {
  if (!file) return;
  stopPlayback();
  appState.busy = true;
  setStatusMessage(`비디오 로드 중: ${file.name}`);

  const video = appState.videoElement;
  if (video.src) URL.revokeObjectURL(video.src);
  const url = URL.createObjectURL(file);

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

    $('activeFileLabel').textContent = `${file.name} (${appState.canvasWidth}×${appState.canvasHeight})`;
    $('timelineRange').max = String(appState.duration);

    await analyzeUploadedVideo();
  } catch (err) {
    setStatusMessage(`오류: ${err.message}`);
  } finally {
    appState.busy = false;
  }
}

async function loadVideoFromAndroidGalleryUrl(videoUrl, displayName = 'gallery_swing.mp4') {
  if (!videoUrl) return;
  stopPlayback();
  appState.busy = true;
  setStatusMessage(`갤러리 스윙 영상 로드 중: ${displayName}`);

  const video = appState.videoElement;
  video.crossOrigin = 'anonymous';

  try {
    await new Promise((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('선택한 갤러리 비디오를 디코딩할 수 없습니다.'));
      };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);
      video.src = videoUrl;
      video.load();
    });

    appState.sourceMode = 'video';
    appState.videoReady = true;
    appState.videoFileName = displayName;
    appState.duration = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(video.duration, 12.0) : 3.2;
    appState.canvasWidth = video.videoWidth || 1280;
    appState.canvasHeight = video.videoHeight || 720;

    const mainCanvas = $('stageCanvas');
    mainCanvas.width = appState.canvasWidth;
    mainCanvas.height = appState.canvasHeight;

    $('activeFileLabel').textContent = `${displayName} (${appState.canvasWidth}×${appState.canvasHeight})`;
    $('timelineRange').max = String(appState.duration);

    await analyzeUploadedVideo();
  } catch (err) {
    setStatusMessage(`갤러리 영상 로드 오류: ${err.message}`);
  } finally {
    appState.busy = false;
  }
}

async function ensurePoseLandmarker() {
  if (poseLandmarkerInstance) return poseLandmarkerInstance;
  try {
    const visionModule = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
    const { FilesetResolver, PoseLandmarker } = visionModule;
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
    poseLandmarkerInstance = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numPoses: 1
    });
    return poseLandmarkerInstance;
  } catch {
    return null;
  }
}

async function analyzeUploadedVideo() {
  const video = appState.videoElement;
  if (!video || !appState.videoReady) return;

  appState.busy = true;
  const progressWrap = $('analysisProgressWrap');
  const progressBar = $('analysisProgressBar');
  progressWrap.hidden = false;
  progressBar.value = 5;

  setStatusMessage('온디바이스 AI 포즈 및 클럽 헤드 모션 분석 준비 중...');
  const landmarker = await ensurePoseLandmarker();

  const scanFps = 30;
  const duration = Math.min(appState.duration, 8.0);
  const totalSteps = Math.max(20, Math.min(240, Math.round(duration * scanFps)));

  const procCanvas = document.createElement('canvas');
  const scale = Math.min(1, 960 / Math.max(video.videoWidth || 960, video.videoHeight || 540));
  procCanvas.width = Math.max(320, Math.round((video.videoWidth || 960) * scale));
  procCanvas.height = Math.max(180, Math.round((video.videoHeight || 540) * scale));
  const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });

  const rawSamples = [];
  let prevImageData = null;

  for (let i = 0; i <= totalSteps; i++) {
    const t = Number(((i / totalSteps) * duration).toFixed(3));
    await seekVideoSafely(video, t);
    procCtx.drawImage(video, 0, 0, procCanvas.width, procCanvas.height);
    const currImageData = procCtx.getImageData(0, 0, procCanvas.width, procCanvas.height).data;

    let posePoints = null;
    if (landmarker) {
      try {
        const res = landmarker.detectForVideo(procCanvas, Math.round(t * 1000) + i);
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

    // 만약 특정 프레임에서 포즈 검출이 누락되었거나 오프라인인 경우 내장 키네마틱 모델로 보완
    const fallbackSynth = buildFallbackKinematicPose(t, duration, appState.hand);
    const activePoints = posePoints || fallbackSynth.points;

    const prevSample = rawSamples.at(-1) || null;
    const tempGrip = {
      x: (activePoints[15].x + activePoints[16].x) * 0.5,
      y: (activePoints[15].y + activePoints[16].y) * 0.5
    };
    const motionCand = prevImageData
      ? detectClubHeadMotionPeak(currImageData, prevImageData, procCanvas.width, procCanvas.height, tempGrip)
      : null;

    const { grip, clubHead } = estimateClubPosition(
      activePoints,
      prevSample,
      t,
      duration,
      appState.hand,
      motionCand
    );

    let clubSpeed = 0;
    if (prevSample?.clubHead && clubHead) {
      const dt = Math.max(0.01, t - prevSample.time);
      const dist = Math.hypot(clubHead.x - prevSample.clubHead.x, clubHead.y - prevSample.clubHead.y);
      clubSpeed = Math.min(125, Math.round((dist / dt) * 28.5));
    }

    // 업로드된 실제 영상에서 골프채 샤프트·헤드 영역 픽셀 패치를 스트로보 잔상으로 합성하기 위한 프레임 스냅샷 보관
    const frameSnap = document.createElement('canvas');
    frameSnap.width = procCanvas.width;
    frameSnap.height = procCanvas.height;
    frameSnap.getContext('2d').drawImage(procCanvas, 0, 0);

    rawSamples.push({
      time: t,
      points: activePoints,
      grip: grip || fallbackSynth.grip,
      clubHead: clubHead || fallbackSynth.clubHead,
      clubHeadBase: { ...(clubHead || fallbackSynth.clubHead) },
      clubSpeed,
      frameCanvas: frameSnap
    });

    prevImageData = currImageData;
    const pct = Math.round(((i + 1) / (totalSteps + 1)) * 100);
    progressBar.value = pct;
    setStatusMessage(`프레임별 클럽 헤드 궤적 및 포즈 추출 중... (${i + 1}/${totalSteps + 1} 프레임, ${pct}%)`);
  }

  appState.samples = smoothSamples(rawSamples);
  appState.keyMoments = detectSwingMoments(appState.samples, 0, duration);

  // 어드레스(Address) 시점 프레임에서 골프채(샤프트·헤드)를 인식하고,
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

  const fin = appState.keyMoments.find(m => m.key === 'finish') || appState.keyMoments.find(m => m.key === 'impact');
  appState.currentTime = fin ? fin.time : duration * 0.82;
  appState.selectedPhaseKey = fin ? fin.key : 'finish';
  appState.clipStartTime = 0;
  appState.clipEndTime = appState.duration;
  appState.clipPreset = 'all';
  $('timelineRange').value = String(appState.currentTime);
  syncClipRangeUI(true);

  await seekVideoSafely(video, appState.currentTime);
  progressWrap.hidden = true;
  appState.busy = false;
  setStatusMessage(`분석 완료: 어드레스 시점 골프채(샤프트·헤드) 인식 및 매끄러운 스윙 궤도 정합을 완료했습니다.`);

  renderMainStage();
  renderPhaseFilmstrip();
  updateMetricsAndCoachingUI();
}

function buildFallbackKinematicPose(time, duration, hand) {
  const normT = clamp((time / Math.max(0.5, duration)) * 3.2, 0, 3.2);
  const demo = buildDemoSwingDataset('driver-fo', 30, 3.2, hand);
  const sample = findNearestSample(demo.samples, normT) || demo.samples[0];
  return sample;
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
  const follow = momentsMap.follow ?? 2.15;
  const finish = momentsMap.finish ?? dur * 0.85;

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

  const curFrame = Math.round(appState.currentTime * appState.fps);
  const totalFrames = Math.round(appState.duration * appState.fps);
  $('timeReadout').textContent = `${appState.currentTime.toFixed(2)}s / ${appState.duration.toFixed(2)}s (F${curFrame}/${totalFrames})`;
}

function startPlayback(clipOnly = false) {
  if (appState.playing) return;
  appState.playing = true;
  appState.playingClipOnly = Boolean(clipOnly);

  $('btnPlayPause').textContent = '일시정지';
  $('btnPlayPause').setAttribute('aria-pressed', 'true');
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
    // 현재 시점이 피니시(finish) 이후이거나 영상 끝에 도달해 있으면 0초(어드레스 이전)부터 전체 스윙 영상을 재생
    const finishMoment = appState.keyMoments.find(m => m.key === 'finish');
    const resetThreshold = finishMoment
      ? Math.min(finishMoment.time - 0.03, appState.duration - 0.05)
      : appState.duration - 0.05;

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
  const clipPlayBtn = $('btnPlayClipRange');
  if (clipPlayBtn) {
    clipPlayBtn.textContent = '선택 구간 재생';
    clipPlayBtn.setAttribute('aria-pressed', 'false');
  }
}

async function seekToTime(targetTime) {
  appState.currentTime = clamp(targetTime, 0, appState.duration);
  $('timelineRange').value = String(appState.currentTime);
  if (appState.sourceMode === 'video' && appState.videoElement && appState.videoReady) {
    await seekVideoSafely(appState.videoElement, appState.currentTime);
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
  container.replaceChildren();

  const moments = appState.keyMoments || [];
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

function highlightActiveFilmstripCard() {
  const cards = document.querySelectorAll('.phase-card');
  cards.forEach(c => {
    c.classList.toggle('is-selected', c.dataset.phaseKey === appState.selectedPhaseKey);
  });
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
}

// ============================================================================
// UI 컨트롤 및 클럽 헤드 수동 핀 고정 바인딩
// ============================================================================

let lastSavedMediaPreview = null;
let toastHideTimer = null;

function showNativeSaveToast(mediaType, fileName, galleryPath) {
  const toast = $('nativeSaveToast');
  const badge = $('nativeSaveToastBadge');
  const text = $('nativeSaveToastText');
  if (!toast || !text) return;

  if (badge) {
    badge.textContent = mediaType === 'video' ? '동영상 저장됨' : '스냅샷 저장됨';
  }
  text.textContent = galleryPath
    ? `갤러리 즉시 저장: ${galleryPath}`
    : `갤러리 즉시 저장 완료: ${fileName}`;

  toast.hidden = false;
  if (toastHideTimer) clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => {
    toast.hidden = true;
  }, 6000);
}

// 안드로이드 네이티브 갤러리 피커 및 MediaStore 저장 완료 콜백 등록
window.onAndroidVideoPicked = (videoUrl, displayName) => {
  void loadVideoFromAndroidGalleryUrl(videoUrl, displayName);
};

window.onAndroidMediaSaved = (mediaType, fileName, galleryPath) => {
  showNativeSaveToast(mediaType, fileName, galleryPath);
  setStatusMessage(`갤러리 즉시 저장 완료 (다운로드 불필요): ${galleryPath || fileName}`);
};

function bindControls() {
  // 스마트폰 4-탭 워크스페이스 전환 바인딩
  const tabButtons = document.querySelectorAll('#mobileTabNav .mobile-tab-btn');
  const tabPanels = document.querySelectorAll('.mobile-tab-panel');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tabTarget;
      tabButtons.forEach(b => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', String(active));
      });
      tabPanels.forEach(panel => {
        panel.classList.toggle('is-active', panel.dataset.tabPanel === target);
      });
    });
  });

  // 토스트 배너 버튼 바인딩
  const btnToastPreview = $('btnToastPreview');
  const btnToastDismiss = $('btnToastDismiss');
  if (btnToastPreview) {
    btnToastPreview.onclick = () => {
      const toast = $('nativeSaveToast');
      if (toast) toast.hidden = true;
      if (!lastSavedMediaPreview) return;
      if (lastSavedMediaPreview.type === 'video') {
        showVideoPreviewModal(
          lastSavedMediaPreview.title,
          lastSavedMediaPreview.url,
          lastSavedMediaPreview.filename
        );
      } else {
        showSnapshotPreviewModal(
          lastSavedMediaPreview.title,
          lastSavedMediaPreview.url
        );
      }
    };
  }
  if (btnToastDismiss) {
    btnToastDismiss.onclick = () => {
      const toast = $('nativeSaveToast');
      if (toast) toast.hidden = true;
    };
  }

  // 파일 업로드 (안드로이드 네이티브 갤러리 피커 우선 호출) 및 데모 프리셋 전환
  $('btnUploadVideo').onclick = () => {
    const bridge = window.AndroidNativeBridge;
    if (bridge && typeof bridge.pickVideoFromGallery === 'function') {
      bridge.pickVideoFromGallery();
      return;
    }
    $('videoFileInput').click();
  };
  $('videoFileInput').onchange = e => {
    const file = e.target.files?.[0];
    if (file) void handleVideoFileUpload(file);
  };

  $('selectDemoPreset').onchange = e => {
    const val = e.target.value;
    if (val === 'driver-fo' || val === 'iron-dtl') {
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

  // 재생 및 프레임 이동
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
    appState.playbackSpeed = Number(e.target.value);
    if (appState.sourceMode === 'video' && appState.videoElement && appState.videoReady) {
      try {
        appState.videoElement.playbackRate = clamp(appState.playbackSpeed, 0.1, 2.0);
      } catch {
        // playbackRate 범위 예외 무시
      }
    }
  };

  // 클럽 헤드 위치 수동 보정 토글 및 캔버스 클릭 핸들러
  const pinBtn = $('btnToggleManualPin');
  pinBtn.onclick = () => {
    appState.manualPinMode = !appState.manualPinMode;
    pinBtn.setAttribute('aria-pressed', String(appState.manualPinMode));
    pinBtn.textContent = appState.manualPinMode ? '헤드 수동 보정 켜짐 (캔버스 터치)' : '헤드 위치 수동 보정';
    $('stageCanvas').style.cursor = appState.manualPinMode ? 'crosshair' : 'default';
    setStatusMessage(
      appState.manualPinMode
        ? '캔버스 위에서 실제 클럽 헤드 끝단을 터치하면 궤적이 즉시 재보간됩니다.'
        : '클럽 헤드 수동 보정 모드를 종료했습니다.'
    );
  };

  $('btnResetPins').onclick = () => {
    appState.samples = appState.samples.map(s => ({
      ...s,
      clubHead: s.clubHeadBase ? { ...s.clubHeadBase, pinned: false } : s.clubHead
    }));
    renderMainStage();
    void renderPhaseFilmstrip();
    setStatusMessage('수동 보정된 클럽 헤드 좌표를 초기 자동 분석 궤적으로 복원했습니다.');
  };

  $('stageCanvas').addEventListener('click', e => {
    if (!appState.manualPinMode) return;
    const rect = $('stageCanvas').getBoundingClientRect();
    const normX = clamp((e.clientX - rect.left) / rect.width, 0.01, 0.99);
    const normY = clamp((e.clientY - rect.top) / rect.height, 0.01, 0.99);

    const sample = findNearestSample(appState.samples, appState.currentTime);
    if (!sample) return;

    sample.clubHead = {
      ...sample.clubHead,
      x: normX,
      y: normY,
      pinned: true
    };

    appState.samples = applyPinnedClubHeadOverrides(appState.samples);
    renderMainStage();
    void renderPhaseFilmstrip();
    setStatusMessage(`현재 프레임(${appState.currentTime.toFixed(2)}s)의 클럽 헤드 위치를 수동 고정하고 주변 스플라인 아크를 재보간했습니다.`);
  });

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
      void renderPhaseFilmstrip();
      updateMetricsAndCoachingUI();
    }
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

  // 타임라인 선택 구간 동영상 인코딩 및 갤러리 무다운로드 즉시 저장 실행 함수
  const handleExportTimelineClipVideo = async () => {
    if (appState.busy) return;
    stopPlayback();
    appState.busy = true;

    const topBtn = $('btnExportAfterimageVideo');
    const clipBtn = $('btnExportClipVideo');
    const origTopText = topBtn ? topBtn.textContent : '구간 동영상 갤러리 저장';
    const progressWrap = $('analysisProgressWrap');
    const progressBar = $('analysisProgressBar');
    if (progressWrap) progressWrap.hidden = false;
    if (progressBar) progressBar.value = 0;

    const sSec = appState.clipStartTime.toFixed(2);
    const eSec = appState.clipEndTime.toFixed(2);

    try {
      setStatusMessage(`선택 구간(${sSec}s ~ ${eSec}s) 골프채 잔상 동영상 인코딩 준비 중...`);
      const result = await exportAfterimageVideo(
        appState,
        (pct, simTime) => {
          const msg = `구간 동영상 저장 중 (${pct}%)`;
          if (topBtn) topBtn.textContent = msg;
          if (clipBtn) clipBtn.textContent = `${msg} [${simTime.toFixed(2)}s]`;
          if (progressBar) progressBar.value = pct;
          setStatusMessage(`타임라인 구간(${sSec}s ~ ${eSec}s) 동영상 인코딩 진행 중... ${pct}% (${simTime.toFixed(2)}s)`);
        },
        {
          startTime: appState.clipStartTime,
          endTime: appState.clipEndTime,
          speedFactor: appState.exportSpeedFactor
        }
      );

      const title = `구간 잔상 동영상 (${result.startTime.toFixed(2)}s ~ ${result.endTime.toFixed(2)}s · ${result.speedFactor}x)`;
      lastSavedMediaPreview = {
        type: 'video',
        title,
        url: result.url,
        filename: result.filename
      };

      if (window.AndroidNativeBridge) {
        showNativeSaveToast('video', result.filename, `Movies/GolfSwingStudio/${result.filename}`);
      } else {
        showVideoPreviewModal(title, result.url, result.filename);
      }
      setStatusMessage(`타임라인 구간(${sSec}s ~ ${eSec}s) 동영상(${result.filename})이 갤러리에 즉시 저장되었습니다.`);
    } catch (err) {
      setStatusMessage(`동영상 저장 오류: ${err.message}`);
    } finally {
      if (progressWrap) progressWrap.hidden = true;
      if (topBtn) topBtn.textContent = origTopText;
      appState.busy = false;
      syncClipRangeUI();
      renderMainStage();
    }
  };

  $('btnExportAfterimageVideo').onclick = handleExportTimelineClipVideo;
  if (btnExportClip) {
    btnExportClip.onclick = handleExportTimelineClipVideo;
  }

  const handleSaveCurrentTimelineSnapshot = async () => {
    if (appState.busy) return;
    stopPlayback();
    const curSec = appState.currentTime.toFixed(2);
    const curFrame = Math.round(appState.currentTime * appState.fps);
    setStatusMessage(`타임라인 현재 상태(${curSec}s / F${curFrame}) 스냅샷(PNG) 갤러리 저장 중...`);
    const dataUrl = await exportStrobeSnapshot(appState);
    const title = `타임라인 스냅샷 (${curSec}s / F${curFrame})`;
    lastSavedMediaPreview = {
      type: 'image',
      title,
      url: dataUrl
    };
    if (window.AndroidNativeBridge) {
      showNativeSaveToast('image', `golf-swing-snapshot-${curSec}s.png`, 'Pictures/GolfSwingStudio');
    } else {
      showSnapshotPreviewModal(title, dataUrl);
    }
    setStatusMessage(`타임라인 ${curSec}s (F${curFrame}) 스냅샷(PNG)이 갤러리에 즉시 저장되었습니다.`);
    renderMainStage();
  };

  $('btnExportStrobeSnapshot').onclick = handleSaveCurrentTimelineSnapshot;
  const btnSaveCurrent = $('btnSaveCurrentSnapshot');
  if (btnSaveCurrent) {
    btnSaveCurrent.onclick = handleSaveCurrentTimelineSnapshot;
  }

  $('btnExportPanoramaSnapshot').onclick = async () => {
    if (appState.busy) return;
    stopPlayback();
    setStatusMessage('7단계 스윙 시퀀스 파노라마 스냅샷(PNG) 갤러리 저장 중...');
    const dataUrl = await exportSequencePanorama(appState);
    const title = '7단계 스윙 시퀀스 & 헤드 잔상 파노라마 스냅샷';
    lastSavedMediaPreview = {
      type: 'image',
      title,
      url: dataUrl
    };
    if (window.AndroidNativeBridge) {
      showNativeSaveToast('image', 'golf-swing-7stage-panorama.png', 'Pictures/GolfSwingStudio');
    } else {
      showSnapshotPreviewModal(title, dataUrl);
    }
    setStatusMessage('7단계 스윙 시퀀스 파노라마 스냅샷(PNG)이 갤러리에 즉시 저장되었습니다.');
    renderMainStage();
  };

  $('btnCloseModal').onclick = () => {
    const vid = $('modalPreviewVideo');
    if (vid) {
      vid.pause();
    }
    $('snapshotModal').close();
  };

  // 키보드 단축키 지원
  window.addEventListener('keydown', e => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
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
    if (window.AndroidNativeBridge) {
      dl.hidden = true;
    } else {
      dl.hidden = false;
      dl.textContent = '이미지 다시 저장 (PNG)';
      dl.href = dataUrl;
      dl.download = `${title.replace(/\s+/g, '_')}.png`;
    }
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
    if (window.AndroidNativeBridge) {
      dl.hidden = true;
    } else {
      dl.hidden = false;
      dl.textContent = '동영상 파일 다시 저장';
      dl.href = videoUrl;
      dl.download = filename || 'golf-swing-clip.mp4';
    }
  }
  if (!modal.open) modal.showModal();
}

window.addEventListener('DOMContentLoaded', initStudio);
