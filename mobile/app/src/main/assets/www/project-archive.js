// ============================================================================
// project-archive.js
// 작업 내용 및 추출 결과물(동영상·스냅샷·궤적/핀/수치 편집 상태·원본 비디오 Blob)을
// IndexedDB에 영구 저장·조회·삭제하고, 언제든 편집장으로 다시 불러와 이어서 수정하는 모듈
// ============================================================================

import { clamp, calculateTempo } from './swing-engine.js';
import { classifyShotShapeLabel } from './shot-tracer-engine.js?v=20261017_03';

const DB_NAME = 'GolfSwingStudioArchiveDB';
const DB_VERSION = 1;
const STORE_NAME = 'savedProjects';

function openArchiveDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('현재 환경에서 IndexedDB 저장소를 사용할 수 없습니다.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
        store.createIndex('studioMode', 'studioMode', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('작업 보관함 데이터베이스를 열지 못했습니다.'));
  });
}

function deepCloneJson(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return { ...obj };
  }
}

/**
 * 캔버스 요소가 포함된 samples 배열에서 직렬화 가능한 데이터(포즈, 클럽헤드 수동 핀, 지면 고정 특징 맵 등)만 추출합니다.
 */
export function serializeSamplesForArchive(samples) {
  if (!Array.isArray(samples)) return [];
  return samples.map(s => ({
    time: s.time,
    points: deepCloneJson(s.points),
    grip: deepCloneJson(s.grip),
    clubHead: deepCloneJson(s.clubHead),
    clubHeadBase: deepCloneJson(s.clubHeadBase),
    clubSpeed: s.clubSpeed,
    ballPoint: deepCloneJson(s.ballPoint),
    stabOffset: deepCloneJson(s.stabOffset || { dx: 0, dy: 0 }),
    effectiveStabOffset: deepCloneJson(s.effectiveStabOffset || { dx: 0, dy: 0, active: false }),
    stabMap: s.stabMap
      ? {
          mapW: s.stabMap.mapW,
          mapH: s.stabMap.mapH,
          luma: new Float32Array(s.stabMap.luma),
          gradX: new Float32Array(s.stabMap.gradX),
          gradY: new Float32Array(s.stabMap.gradY)
        }
      : null
  }));
}

/**
 * 비동기 프레임 양보를 포함하여 대용량 비디오 샘플 배열 직렬화 시 화면 멈춤을 방지합니다.
 */
export async function serializeSamplesForArchiveAsync(samples, onProgress = null) {
  if (!Array.isArray(samples) || samples.length === 0) return [];
  const result = new Array(samples.length);
  let lastYield = performance.now();

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    result[i] = {
      time: s.time,
      points: deepCloneJson(s.points),
      grip: deepCloneJson(s.grip),
      clubHead: deepCloneJson(s.clubHead),
      clubHeadBase: deepCloneJson(s.clubHeadBase),
      clubSpeed: s.clubSpeed,
      ballPoint: deepCloneJson(s.ballPoint),
      stabOffset: deepCloneJson(s.stabOffset || { dx: 0, dy: 0 }),
      effectiveStabOffset: deepCloneJson(s.effectiveStabOffset || { dx: 0, dy: 0, active: false }),
      stabMap: s.stabMap
        ? {
            mapW: s.stabMap.mapW,
            mapH: s.stabMap.mapH,
            luma: new Float32Array(s.stabMap.luma),
            gradX: new Float32Array(s.stabMap.gradX),
            gradY: new Float32Array(s.stabMap.gradY)
          }
        : null
    };
    if (performance.now() - lastYield > 28) {
      if (onProgress) onProgress(Math.round(((i + 1) / samples.length) * 75));
      await new Promise(r => setTimeout(r, 0));
      lastYield = performance.now();
    }
  }
  return result;
}

/**
 * 메인 캔버스(#stageCanvas)로부터 보관함 목록 표시용 썸네일 DataURL(480x270)을 생성합니다.
 */
export function captureCanvasThumbnail(sourceCanvas, maxWidth = 480) {
  if (!sourceCanvas) return '';
  try {
    const sw = Math.max(1, sourceCanvas.width || 1280);
    const sh = Math.max(1, sourceCanvas.height || 720);
    const scale = Math.min(1, maxWidth / sw);
    const tw = Math.max(160, Math.round(sw * scale));
    const th = Math.max(90, Math.round(sh * scale));
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = tw;
    thumbCanvas.height = th;
    const ctx = thumbCanvas.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0, tw, th);
    return thumbCanvas.toDataURL('image/jpeg', 0.86);
  } catch {
    return '';
  }
}

/**
 * 현재 appState로부터 보관함 카드에 표시할 요약 측정 지표와 기본 작업 제목을 생성합니다.
 */
export function buildProjectSummaryAndTitle(appState, saveType = 'manual-project', customTitle = '') {
  const isShot = appState.studioMode === 'shot-tracer';
  const st = appState.shotTracerOptions || {};
  const shapeInfo = classifyShotShapeLabel(
    st.sideCurveMeters ?? -4.5,
    st.launchDirectionDeg ?? 0,
    st.shotShapeType || 'auto'
  );
  const carryM = Number(st.carryMeters ?? 198.5);
  const rollM = Number(st.rollMeters ?? 13.5);
  const totalM = Number((carryM + rollM).toFixed(1));
  const apexM = Number(st.apexMeters ?? 27.5);
  const launchDeg = Number(st.launchAngleDeg ?? 13.8);

  const momentsMap = Object.fromEntries((appState.keyMoments || []).map(m => [m.key, m.time]));
  const tempoInfo = calculateTempo(momentsMap);
  const tempoStr = tempoInfo ? `${tempoInfo.ratio.toFixed(2)} : 1` : '3.00 : 1';

  let maxSpeed = 0;
  for (const s of appState.samples || []) {
    if ((s.clubSpeed || 0) > maxSpeed) maxSpeed = s.clubSpeed;
  }

  const saveTypeLabelMap = {
    'manual-project': '편집 작업본',
    'video-export': '구간 동영상',
    'snapshot-strobe': '화면 스냅샷',
    'snapshot-panorama': '7단계 파노라마'
  };
  const saveBadge = saveTypeLabelMap[saveType] || '편집 작업본';

  const baseFileName = (appState.videoFileName || '스윙영상')
    .replace(/^내장\s*/, '')
    .replace(/\s*\(.*?\)\s*/g, '')
    .trim();

  const defaultTitle = isShot
    ? `${baseFileName} · ${shapeInfo.shortKo} ${totalM.toFixed(1)}m (${saveBadge})`
    : `${baseFileName} · 템포 ${tempoStr} (${saveBadge})`;

  return {
    title: (customTitle && customTitle.trim()) ? customTitle.trim() : defaultTitle,
    saveTypeLabel: saveBadge,
    summaryMetrics: {
      studioModeLabel: isShot ? '후방 공 궤적 (샷 트레이서)' : '스윙 클럽 잔상 분석',
      shotShapeLabel: shapeInfo.labelKo,
      shotShapeShort: shapeInfo.shortKo,
      carryMeters: Number(carryM.toFixed(1)),
      rollMeters: Number(rollM.toFixed(1)),
      totalMeters: totalM,
      apexMeters: Number(apexM.toFixed(1)),
      launchAngleDeg: Number(launchDeg.toFixed(1)),
      sideCurveMeters: Number(Number(st.sideCurveMeters ?? 0).toFixed(1)),
      tempoRatio: tempoStr,
      clubSpeedMph: maxSpeed || 105,
      clipRangeText: `${Number(appState.clipStartTime || 0).toFixed(2)}s ~ ${Number(appState.clipEndTime || appState.duration || 3.2).toFixed(2)}s`
    }
  };
}

/**
 * 현재 편집장의 작업 상태 및 생성된 미디어 결과물을 IndexedDB 보관함에 저장(신규 또는 덮어쓰기)합니다.
 */
export async function saveWorkRecordToArchive(appState, options = {}) {
  const {
    existingId = null,
    customTitle = '',
    saveType = 'manual-project',
    outputMediaType = 'project',
    outputBlob = null,
    outputDataUrl = '',
    outputFilename = '',
    stageCanvas = null,
    onProgress = null
  } = options;

  const nowIso = new Date().toISOString();
  const id = existingId || `work_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { title, saveTypeLabel, summaryMetrics } = buildProjectSummaryAndTitle(appState, saveType, customTitle);
  await new Promise(r => setTimeout(r, 0));
  const thumbnailDataUrl = captureCanvasThumbnail(stageCanvas) || outputDataUrl || '';

  const shotOptsCopy = deepCloneJson(appState.shotTracerOptions || {});
  shotOptsCopy.pinTargetMode = null;

  const stabOptsCopy = deepCloneJson(appState.stabilizationOptions || {});
  stabOptsCopy.groundPinMode = false;

  const serializedSamples = await serializeSamplesForArchiveAsync(appState.samples || [], onProgress);
  if (onProgress) onProgress(85);
  await new Promise(r => setTimeout(r, 0));

  const record = {
    id,
    title,
    saveType,
    saveTypeLabel,
    createdAt: options.createdAt || nowIso,
    updatedAt: nowIso,
    studioMode: appState.studioMode || 'afterimage',
    sourceMode: appState.sourceMode || 'demo',
    demoPreset: appState.demoPreset || 'driver-fo',
    videoFileName: appState.videoFileName || '',
    videoBlob: appState.sourceMode === 'video' ? (appState.uploadedVideoFile || null) : null,
    outputMediaType,
    outputBlob: outputBlob || null,
    outputDataUrl: outputDataUrl || '',
    outputFilename: outputFilename || '',
    thumbnailDataUrl,
    summaryMetrics,
    studioSnapshot: {
      hand: appState.hand || 'right',
      fps: appState.fps || 30,
      duration: appState.duration || 3.2,
      currentTime: clamp(Number(appState.currentTime || 0), 0, Number(appState.duration || 3.2)),
      clipStartTime: Number(appState.clipStartTime || 0),
      clipEndTime: Number(appState.clipEndTime || appState.duration || 3.2),
      clipPreset: appState.clipPreset || 'all',
      playbackSpeed: Number(appState.playbackSpeed || 0.5),
      exportSpeedFactor: Number(appState.exportSpeedFactor || 0.5),
      canvasWidth: appState.canvasWidth || 1280,
      canvasHeight: appState.canvasHeight || 720,
      selectedPhaseKey: appState.selectedPhaseKey || 'impact',
      keyMoments: deepCloneJson(appState.keyMoments || []),
      addressClub: deepCloneJson(appState.addressClub || null),
      renderOptions: deepCloneJson(appState.renderOptions || {}),
      stabilizationOptions: stabOptsCopy,
      shotTracerOptions: shotOptsCopy,
      serializedSamples
    }
  };

  const db = await openArchiveDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    if (existingId) {
      const getReq = store.get(existingId);
      getReq.onsuccess = () => {
        const prev = getReq.result;
        if (prev) {
          record.createdAt = prev.createdAt || nowIso;
          if (!record.videoBlob && prev.videoBlob) {
            record.videoBlob = prev.videoBlob;
          }
          if (!record.outputBlob && prev.outputBlob && outputMediaType === 'project') {
            record.outputBlob = prev.outputBlob;
            record.outputDataUrl = prev.outputDataUrl;
            record.outputFilename = prev.outputFilename;
            record.outputMediaType = prev.outputMediaType;
          }
        }
        store.put(record);
      };
    } else {
      store.put(record);
    }

    tx.oncomplete = () => {
      db.close();
      resolve(record);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('작업 내용을 저장하는 중 오류가 발생했습니다.'));
    };
  });
}

/**
 * 저장된 모든 작업 항목을 최신 수정순(updatedAt 내림차순)으로 조회합니다.
 */
export async function listArchivedWorkRecords() {
  const db = await openArchiveDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      const items = Array.isArray(req.result) ? req.result : [];
      items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      resolve(items);
    };
    req.onerror = () => {
      db.close();
      reject(req.error || new Error('저장된 작업 목록을 불러오지 못했습니다.'));
    };
  });
}

/**
 * 특정 ID의 저장된 작업 항목 1건을 상세 조회합니다.
 */
export async function getArchivedWorkRecordById(id) {
  if (!id) return null;
  const db = await openArchiveDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => {
      db.close();
      resolve(req.result || null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error || new Error('저장된 작업 항목을 찾을 수 없습니다.'));
    };
  });
}

/**
 * 저장된 작업 항목의 제목을 변경합니다.
 */
export async function renameArchivedWorkRecord(id, newTitle) {
  if (!id || !newTitle || !newTitle.trim()) return null;
  const db = await openArchiveDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    let updated = null;
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (item) {
        item.title = newTitle.trim();
        item.updatedAt = new Date().toISOString();
        updated = item;
        store.put(item);
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve(updated);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('작업 이름 변경에 실패했습니다.'));
    };
  });
}

/**
 * 특정 ID의 저장된 작업 항목을 삭제합니다.
 */
export async function deleteArchivedWorkRecord(id) {
  if (!id) return;
  const db = await openArchiveDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('저장된 작업 삭제 중 오류가 발생했습니다.'));
    };
  });
}

/**
 * 보관함의 전체 항목을 모두 삭제합니다.
 */
export async function clearAllArchivedWorkRecords() {
  const db = await openArchiveDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('보관함 전체 비우기 중 오류가 발생했습니다.'));
    };
  });
}
