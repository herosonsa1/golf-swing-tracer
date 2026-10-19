# 작업 히스토리 (Work History)

본 문서는 프로젝트(`golf-swing-tracer`)의 연속성을 보장하기 위해 모든 구현 계획 및 결과 요약을 누적(Append)하여 지속 기록하는 핵심 문서입니다. **(절대 기존 내용을 덮어써서 날라가게 하지 말 것!)**

---

### [2026-10-15] Phase 1: REA 기반 골프 스윙 궤적 및 7단계 시퀀스 웹 스튜디오 초기 구축
* **REA(Reverse Engineer Anything) 기반 스윙 분석 엔진 설계 (`swing-engine.js`, `demo-generator.js`, `renderer-exporter.js`, `app.js`)**:
  - 7단계 스윙 시퀀스(`어드레스 Address`, `테이크어웨이 Takeaway`, `백스윙 탑 Top`, `다운스윙 Downswing`, `임팩트 Impact`, `팔로우스루 Follow-Through`, `피니시 Finish`) 자동 검출 및 생체역학 지표(스윙 템포 비율, 추정 클럽 헤드 스피드, 리드 팔꿈치·척추 전경·리드 무릎·손목 코킹 각도) 산출 알고리즘 구축.
  - 내장 프로 스윙 300fps 초고밀도 시뮬레이션 데이터셋(`driver-fo` 드라이버 정면 뷰 / `iron-dtl` 아이언 측면 뷰) 및 사용자 로컬 스윙 영상 업로드(MediaPipe Pose + 모션 벡터 하이브리드 분석) 파이프라인 구현.
  - 7단계 시퀀스 필름스트립, 구간별 AI 스윙 진단 리포트, 스트로보 잔상 스냅샷(PNG), 7단계 파노라마 스냅샷(PNG), 잔상 동영상 인코딩 기능을 갖춘 Crisp Light 테마 스튜디오 UI(`index.html`, `styles.css`) 구축.

---

### [2026-10-15] Phase 2: 어드레스 시점 실제 골프채(샤프트·헤드) 투명 배경 누끼 추출 및 다중 노출 잔상 정합
* **어드레스 골프채 투명 누끼 추출 (`detectAddressGolfClub`, `createAddressClubTemplate`)**:
  - 어드레스 상태 영상에서 배경을 완전히 투명하게 제거하고 실제 골프채(샤프트와 클럽 헤드 중심)만 정밀하게 따낸 오프스크린 캔버스(`cutoutCanvas`)를 생성하여 다중 노출 스트로보 잔상으로 합성하도록 구현.
* **원본 스윙 영상 손(그립) 위치 및 마지막 잔상 100% 일치 정합 (`regularizeSwingWithAddressClub`)**:
  - 원본 스윙 영상의 실제 손(그립) 위치와 마지막 잔상의 그립·샤프트 축이 오차 없이 일치하도록 스윙 궤도 정규화 및 마지막 샘플 직접 앵커링 적용.

---

### [2026-10-15] Phase 3: 잔상 불투명도 강화, 지속시간 궤도 확장, 타임라인 스냅샷, 머리 뒤 피니시 잔상 확장
* **잔상 불투명도 및 지속시간 궤도 개선 (`renderer-exporter.js`, `app.js`)**:
  - 잔상 불투명도 최대치를 `100%`(`1.0`)까지 확장하고 알파 커브를 보강하여 선명한 실물 골프채 잔상 표현.
  - 잔상 지속시간(`trailDurationSec`) 조절 시 백스윙 탑 한계를 넘어 설정된 시간만큼 실제 잔상 궤도 길이가 즉각 길어지거나 짧아지도록 개선.
* **현재 타임라인 스냅샷 저장 및 머리 뒤 피니시 궤적 확장 (`demo-generator.js`, `swing-engine.js`)**:
  - 타임라인바에서 원하는 프레임 상태로 멈춘 뒤 `현재 화면 스냅샷 저장` 버튼을 눌러 즉시 PNG로 저장하는 기능 추가.
  - 피니시 구간에서 클럽 헤드가 골퍼의 머리 뒤쪽을 완전히 돌아 넘어가는 궤적까지 잔상이 자연스럽게 이어지도록 키네마틱 모델 확장.

---

### [2026-10-15] Phase 4 ~ 6: 현재 샤프트 근접 페이드아웃, 팔각형 면 아티팩트 제거, 샤프트 빛반사 `((` 원형 궤적 추가
* **현재 샤프트 위치 기준 거리 비례 페이드아웃 (`renderer-exporter.js`)**:
  - 잔상이 스윙 영상의 현재 골프 샤프트 위치와 가까울수록 진하고 선명하게, 멀어질수록 부드럽게 페이드아웃되는 감쇠 곡선 적용.
* **팔각형 하얀 면(모션 블러 웨지 폴리곤) 완전 제거 (`renderer-exporter.js`)**:
  - 잔상 사이사이에 이어지던 반투명 웨지 폴리곤과 두꺼운 리본 면을 제거하여 순수 골프채 샤프트·헤드 잔상만 깔끔하게 남도록 수정.
* **보조 궤적·빛반사 선 두께 연동 및 샤프트 빛반사 `((` 원형 궤적 체크박스 추가 (`renderShaftSpecularGlintArcs`)**:
  - 골프채를 강하게 휘두를 때 나타나는 빛반사 `((` 원형 궤적 효과를 손을 조금 지난 샤프트 중반부와 헤드 바로 앞쪽(더 큰 사이즈)에 각각 렌더링하고, 체크박스(`chkShaftGlint`)로 자유롭게 켜고 끌 수 있도록 구현.

---

### [2026-10-15] Phase 7 ~ 9: 손(그립)→헤드 축 방향 투명도 슬라이더, 타임라인 구간 동영상 저장, 서비스 기본값 고정
* **손에 가까울수록 투명·헤드 쪽으로 갈수록 선명해지는 축 방향 투명도 조절 (`rangeGripFade`, `getGripFadedCutoutCanvas`)**:
  - 오프스크린 `destination-in` 알파 그라데이션 마스킹을 통해 손에 가까운 그립 쪽은 최대 100% 투명하게 비우고 샤프트 중앙부터 서서히 나타나 헤드 쪽에서 가장 선명해지는 `손 쪽 샤프트 투명도` 슬라이더 추가.
* **타임라인 구간(`CLIP 구간` 시작~종료) 설정 및 선택 구간 동영상 저장 (`clip-range-panel`, `exportAfterimageVideo`)**:
  - 시작~종료 듀얼 슬라이더, 빠른 구간 프리셋(전체, 스윙 전체, 백스윙, 다운스윙~임팩트, 다운스윙~피니시), 현재 위치 시작/종료점 지정, 선택 구간 재생 및 배속(`0.25x`, `0.5x`, `1.0x`) 동영상 저장 기능 구현.
* **서비스 재기동 시 기본 설정값 고정 (`DEFAULT_RENDER_OPTIONS`)**:
  - `잔상 지속 시간 1.80s`, `보조 궤적·빛반사 선 두께 3px`, `실제 골프채 잔상 밀도 2프레임 간격`, `골프채 잔상 선명도 85%`, `손 쪽 샤프트 투명도 50%`, `샤프트 빛반사 (( 원형 궤적 켜짐`, `관절 스켈레톤 해제` 상태를 영구 기본값으로 고정.

---

### [2026-10-15] Phase 10: REA 분석 기반 스마트폰 최적화 안드로이드 앱(`mobile/dist/golfSwing.apk`) 구축 및 검증
* **REA 정적 분석 및 안드로이드 프로젝트 아키텍처 설계**:
  - `rea:analyze_javascript_application` (`ev_58c0749331056d35c7024f444a0b0dc76e7477e3aafdb66ba89a1994b494a140`)으로 웹 서비스의 6개 핵심 파일(AST 노드 36,018개, Call-flow 1,758개, Data-flow 15,400개)을 분석하여 `mobile/` 폴더 내에 Kotlin + Jetpack + 내장 스튜디오 엔진(`assets/www/`) 하이브리드 아키텍처 구축.
* **안드로이드 로컬 갤러리 스윙 영상 선택 및 Range 스트리밍 (`MainActivity.kt`, `LocalWebAssetServer.kt`)**:
  - `갤러리 스윙 영상 선택` 버튼 클릭 시 안드로이드 네이티브 포토 피커(`ActivityResultContracts.PickVisualMedia.VideoOnly`) 및 갤러리 인텐트(`Intent.ACTION_PICK`)를 호출하여 스마트폰 갤러리에서 스윙 영상을 선택하고, `LocalWebAssetServer`의 HTTP `206 Partial Content` Range 스트리밍을 통해 프레임 단위 탐색 및 잔상 합성을 즉시 수행하도록 구현.
* **브라우저 다운로드 없는 스냅샷(PNG) 및 구간 동영상(MP4/WebM) 갤러리 즉시 저장 (`MediaStoreHelper.kt`, `NativeMp4Exporter.kt`)**:
  - 스냅샷 저장 시 다운로드 팝업 없이 `Dispatchers.IO` 백그라운드 스레드에서 `MediaStore.Images.Media` (`Pictures/GolfSwingStudio`)에 즉시 저장.
  - 타임라인 구간 동영상 저장 시 안드로이드 내장 하드웨어 H.264 인코더(`MediaCodec` + `MediaMuxer`) 및 `MediaStore.Video.Media` (`Movies/GolfSwingStudio`)를 통해 다운로드 없이 갤러리에 즉시 `.mp4` 동영상으로 저장하고 앱 내 토스트 배너(`#nativeSaveToast`) 및 미리보기를 제공.
* **스마트폰 전용 UI/UX 최적화 및 최종 APK 검증 (`mobile/dist/golfSwing.apk`)**:
  - 스마트폰 세로 화면에서 하단 설정 슬라이더를 조작할 때도 상단 스윙 캔버스와 타임라인이 항상 고정 표시되는 `sticky-stage-shell` 구조와 4-탭 모바일 워크스페이스(`[잔상·궤적 설정]`, `[구간·영상저장]`, `[7단계 시퀀스]`, `[측정·AI코칭]`) 적용.
  - Gradle `assembleDebug`로 [`mobile/dist/golfSwing.apk`](file:///c:/myWork/workspace/scratch/golf-swing-tracer/mobile/dist/golfSwing.apk) (`12,017,786 Bytes`) 생성 완료 및 REA JADX 엔진(`inspect_android_package`: `ev_7c606cdd10f546700f8cd3376fe1be7181a9c2168ab78c9e791126a42a348539`, `search_android_classes`: `ev_d9bad607e9b167a6c0f25acf18e82240f048ed5d28fc39a65ac5ca86c51bd0f6`)으로 패키지·권한·클래스 정적 검증 완료.
---

## 8. 스마트폰 갤러리 HEVC(H.265) + HDR10+ (10-bit) 세로 영상 하드웨어 디코딩 및 종횡비 보존 개선 (2026-10-16)
- **증상 및 대상 영상 스펙**:
  - 촬영 기기 및 파일 정보: `Galaxy S24+` | `/내장 저장공간/DCIM/Camera/20260911_194419.mp4`
  - 비디오 코덱 및 스펙: `HEVC (H.265 Main10)` + `HDR10+ (10-bit)` + `720x1280 (세로 HD)` + `AAC` + `30fps` + `0:02 (7.50MB)`
  - 문제 현상: 안드로이드 앱에서 로컬 갤러리 스윙 영상을 선택했을 때 `"선택된 비디오를 디코딩할 수 없습니다."` 메시지가 출력되며 분석으로 진행되지 않는 현상 발생.
- **근본 원인(Root Cause) 분석**:
  1. **WebView `shouldInterceptRequest`의 Byte-Range 랜덤 시크 부재**: 스마트폰 기본 카메라로 촬영한 MP4 파일은 녹화 종료 시점에 인덱스 테이블(`moov` atom)을 파일 맨 끝(EOF)에 기록합니다. 그러나 Android `WebViewClient.shouldInterceptRequest`는 단일 순차 `InputStream`만 반환하고 `HTTP 206 Partial Content` (Byte-Range 시크)를 지원하지 않아, WebView 내부 `<video>` 디멀티플렉서가 파일 끝의 `moov` atom을 읽지 못하고 즉시 `MEDIA_ERR_SRC_NOT_SUPPORTED` / `MEDIA_ERR_DECODE`를 발생시켰습니다.
  2. **WebView `<video>`의 10-bit `HDR10+` + `HEVC` 컬러 프로파일 디코딩 제약**: Galaxy S24+의 `HEVC Main10 + HDR10+` 스트림을 WebView 내부 `<video>` 엘리먼트 및 `CanvasRenderingContext2D.drawImage(video)`에 직접 연결할 경우 기기 WebView 버전에 따라 하드웨어 컬러 변환기가 실패합니다.
  3. **세로 영상(`720x1280`)의 16:9 캔버스 비율 왜곡**: `#stageCanvas`에 `aspect-ratio: 16 / 9`가 고정되어 있어 `720x1280` 세로 촬영 영상이 가로로 찌그러지는 문제가 있었습니다.
- **해결 아키텍처 및 구현 내역**:
  1. **안드로이드 OS 네이티브 하드웨어 디코더(`NativeVideoDecoder.kt`) 신규 구현**:
     - WebView `<video>` 디코더에 의존하지 않고, `Dispatchers.IO`에서 `FileInputStream(cachedVideoFile).fd` 파일 디스크립터 랜덤 액세스를 사용하는 Android OS 네이티브 `MediaMetadataRetriever`를 구동하도록 구현했습니다.
     - `METADATA_KEY_VIDEO_ROTATION` (90°/270° 회전 메타데이터)을 자동 반영하여 세로 영상(`720x1280` -> `406x720`) 및 가로 영상의 실제 표시 해상도를 정확히 산출합니다.
     - `HDR10+` 10-bit 하드웨어 비트맵(`Bitmap.Config.HARDWARE`, `RGBA_1010102`, `RGBA_F16`)을 표준 8-bit SDR `ARGB_8888` 소프트웨어 비트맵으로 안전하게 톤매핑·변환(`ensureSdrSoftwareBitmap`)하여 `cacheDir/decoded_frames/frame_XXX.jpg` 시퀀스로 고속 추출합니다.
  2. **`LocalWebAssetServer.kt` 및 `MainActivity.kt` 연동**:
     - 추출된 SDR 프레임 시퀀스를 `https://appassets.androidplatform.net/native-frame/frame_XXX.jpg` 경로로 무손실 서빙하고, 디코딩 진행률(`window.onAndroidVideoDecodeProgress`)과 완료 메타데이터(`window.onAndroidNativeVideoDecoded`)를 WebView로 즉시 전달합니다.
  3. **프레임 시퀀스 기반 직접 AI 포즈·클럽 궤적 분석 및 세로 영상 종횡비 유지 (`app.js`, `renderer-exporter.js`, `styles.css`)**:
     - `loadAndAnalyzeAndroidDecodedFrames()`를 통해 HTML5 `<video>` 태그 시크 없이 네이티브 하드웨어 디코딩된 `frameCanvas` 시퀀스에서 곧바로 MediaPipe Pose 33개 관절 및 클럽 헤드 궤적을 정밀 분석하고, 재생·타임라인 시크·스냅샷 저장·구간 동영상(MP4/WebM) 저장이 모두 `nearestSample.frameCanvas`를 기반으로 100% 동작하도록 개선했습니다.
     - `#stageCanvas`의 고정 `aspect-ratio: 16 / 9`를 제거하고 원본 비디오의 세로(`720x1280`) 및 가로(`1280x720`) 비율이 그대로 유지되도록 개선했습니다.
  4. **APK 리빌드 및 배포 갱신**:
     - `mobile/dist/golfSwing.apk` (약 12.06MB) 리빌드 및 검증 완료.
---

### [2026-10-16] Phase 11: 프로젝트 안티패턴 지식화(`AP-ANDROID-WEBVIEW-HEVC-HDR10-DECODE-FAIL`) 및 전체 수정 파일 요약
* **안티패턴 등록 (`.agents/anti_patterns.json`)**:
  - `AP-ANDROID-WEBVIEW-HEVC-HDR10-DECODE-FAIL`: Android WebView `shouldInterceptRequest` 단일 스트림 전달 시 스마트폰 `HEVC(H.265) + HDR10+ (10-bit)` 영상 디코딩 실패 및 세로 영상 비율 왜곡 패턴을 정의하고, `MediaMetadataRetriever(FileDescriptor)` + `HDR10+ to SDR ARGB_8888` 변환 + 원본 종횡비 보존 체크리스트를 영구 지식화.
* **수정 및 생성된 주요 파일 목록**:
  - [`mobile/app/src/main/java/com/example/golfswingstudio/NativeVideoDecoder.kt`](file:///c:/myWork/workspace/scratch/golf-swing-tracer/mobile/app/src/main/java/com/example/golfswingstudio/NativeVideoDecoder.kt): OS 하드웨어 코덱 기반 HEVC/HDR10+ 프레임 추출 및 SDR `ARGB_8888` 변환 엔진.
  - [`mobile/app/src/main/java/com/example/golfswingstudio/LocalWebAssetServer.kt`](file:///c:/myWork/workspace/scratch/golf-swing-tracer/mobile/app/src/main/java/com/example/golfswingstudio/LocalWebAssetServer.kt): `/native-frame/` 라우트를 통한 디코딩 프레임 시퀀스 서빙.
  - [`mobile/app/src/main/java/com/example/golfswingstudio/MainActivity.kt`](file:///c:/myWork/workspace/scratch/golf-swing-tracer/mobile/app/src/main/java/com/example/golfswingstudio/MainActivity.kt): 갤러리 영상 선택 시 `NativeVideoDecoder` 비동기 실행 및 WebView 진행률·완료 콜백 전달.
  - [`mobile/app/src/main/assets/www/app.js`](file:///c:/myWork/workspace/scratch/golf-swing-tracer/mobile/app/src/main/assets/www/app.js): `loadAndAnalyzeAndroidDecodedFrames` 파이프라인 및 `onAndroidVideoDecodeProgress` / `onAndroidNativeVideoDecoded` / `onAndroidVideoDecodeError` 핸들러 연동, 데모 복귀 시 `1280×720` 해상도 복원.
  - [`mobile/app/src/main/assets/www/renderer-exporter.js`](file:///c:/myWork/workspace/scratch/golf-swing-tracer/mobile/app/src/main/assets/www/renderer-exporter.js) & [`renderer-exporter.js`](file:///c:/myWork/workspace/scratch/golf-swing-tracer/renderer-exporter.js): `<video>` 태그 준비 상태와 무관하게 `nearestSample.frameCanvas`를 즉시 렌더링하도록 개선.
  - [`mobile/app/src/main/assets/www/styles.css`](file:///c:/myWork/workspace/scratch/golf-swing-tracer/mobile/app/src/main/assets/www/styles.css) & [`styles.css`](file:///c:/myWork/workspace/scratch/golf-swing-tracer/styles.css): `#stageCanvas`의 고정 16:9 비율 강제를 제거하여 `720×1280` 세로 스윙 영상 및 `1280×720` 가로 스윙 영상 모두 원본 비율을 유지하도록 개선.
  - [`mobile/dist/golfSwing.apk`](file:///c:/myWork/workspace/scratch/golf-swing-tracer/mobile/dist/golfSwing.apk): 최종 빌드 산출물 (`12,065,893 Bytes`).

---

## 9. 후방(Down-the-Line) 공 궤적 샷 트레이서(Shot Tracer) 엔진 구현 및 웹·안드로이드 앱 탑재 (2026-10-16)
- **웹 딥서치 및 REA 역공학 분석 (`analyze_javascript_application`)**:
  - 상용 골프 샷 트레이서 웹서비스 및 앱(`GolfBallTracer.com`, `ShotTracerApp.com`, `Toptracer`, `TrackMan`, `SmoothSwing`)을 딥서치하고, `GolfBallTracer` 프로덕션 JS 번들(4개 파일, 297,922 Bytes, AST 노드 91,659개)을 `rea:analyze_javascript_application` (`ev_59adc109c666574036b5eb3184a977914594d210837af62abb49dee53127a3e8`, 요약 `ev_e0ae8854c6f0f152c879a03f437e9fba2180a1dc87e2b0910999d8478a3cc0af`)으로 정밀 분석.
  - 상용 서비스의 3점 베지어 곡선 보간, 타임라인 프레임 동기화, `MediaRecorder` / `WebCodecs` MP4 합성 구조를 뛰어넘어 **4점 공기역학 탄도(출발점·APEX 최고점·탄착지점·런 종료점) + 말풍선 APEX 고도 표시 + 캐리/런/최종 거리(m) + 동영상 내 탄도 프로파일 다이어그램 합성**을 모두 지원하는 차세대 엔진(`shot-tracer-engine.js`) 설계.
- **핵심 구현 기능 (`shot-tracer-engine.js`, `renderer-exporter.js`, `app.js`, `index.html`, `styles.css`)**:
  1. **기존 측면 클럽 잔상 분석 모드와 독립된 듀얼 스튜디오 모드 스위처**:
     - 상단 헤더 및 모바일 5-탭 네비게이션에서 `[스윙 클럽 잔상 분석]` 모드와 `[후방 공 궤적 샷 트레이서]` 모드를 즉시 전환 가능하도록 구성.
     - 후방 공 궤적 모드에서도 선택적으로 클럽 샤프트·헤드 잔상을 함께 중첩 표시(`후방 영상에 클럽 샤프트·헤드 잔상 함께 표시` 체크박스)할 수 있도록 지원.
  2. **멀티 컬러 궤적 팔레트 및 4종 방송용 궤적 스타일**:
     - 기본값 **투어 레드(`#DC2626`)**를 비롯하여 프로 오렌지(`#EA580C`), 스카이 시안(`#0284C7`), 에메랄드 그린(`#16A34A`), 로열 골드(`#CA8A04`), 바이올렛(`#7C3AED`), TV 화이트(`#F8FAFC`), **속도 그라데이션(레드→앰버→시안)** 및 사용자 직접 색상 선택(`input[type="color"]`) 지원.
     - 4종 렌더링 스타일: `방송용 3D 코어 튜브 (Toptracer 스타일)`, `네온 레이저 빔`, `스트로보 골프공 잔상 궤적`, `플랫 리본 아크` 및 원근 테이퍼링(Perspective Tapering: 티박스는 굵고 원거리 탄착지점으로 갈수록 가늘어지는 원근감) 적용.
  3. **APEX 최고점 말풍선(Speech Callout Bubble) 및 수직 고도 점선**:
     - 공이 최고점(`t = apexTime`)을 통과하는 순간 말풍선 꼬리가 달린 고대비 카드(`APEX 최고점 | 28.4 m`)와 지면 투영 수직 점선 가이드를 자동 표시.
  4. **탄착지점(캐리 거리, m) 및 런(Roll) 포함 최종 거리(m) 표시**:
     - 공이 지면에 최초 탄착하는 시점(`landingTime`)에 타원형 타겟 링과 **`탄착(캐리) 232.5 m`** 배지를 표시.
     - 탄착 후 잔디 마찰 감속 2-바운스 런(Roll) 궤적이 점선으로 이어진 뒤 최종 정지 지점(`rollEndTime`)에 **`최종 251.0 m / 런 +18.5 m`** 말풍선 배지를 표시.
  5. **동영상 내 탄도(발사각·구질·볼스피드) 및 측면 탄도 프로파일 미니 아크 다이어그램 표기**:
     - 동영상 프레임 상단 배너 및 우측 하단 Toptracer 스타일 방송용 텔레메트리 카드에 **탄도 분류(`중고탄도 12.8° / APEX 28.4m`), 구질(`하이 드로우 -6.5m`), 볼 스피드(`71.5 m/s · 160 mph`), 캐리(`232.5 m`), 런(`+18.5 m`), 최종 거리(`251.0 m`)** 및 실시간 공 진행 위치가 연동되는 **측면 탄도 프로파일 미니 아크 다이어그램**을 합성.
  6. **업로드된 후방 영상 자동 보정 및 캔버스 4점 터치/클릭 수동 보정**:
     - 사용자가 후방(DTL) 스윙 영상을 업로드하면 어드레스·임팩트 클럽 헤드 좌표를 기반으로 공 출발점·APEX·탄착지점을 자동 정합(`autoCalibrateShotTracerFromVideo`)하며, `[1. 공 출발점]`, `[2. APEX 최고점]`, `[3. 탄착지점]`, `[4. 최종 런 위치]` 버튼을 눌러 화면 클릭/터치만으로 궤적 포인트를 정밀 보정 가능.
  7. **타임라인 구간(`CLIP 구간`) 동영상 저장 및 다운로드 (웹 & 안드로이드 앱)**:
     - 타임라인 시작~종료 구간(`CLIP 구간`)을 설정하여 저장하면, 공 비행 궤적·APEX 말풍선·탄착/최종 거리(m)·탄도 다이어그램이 모두 합성된 고화질 동영상(웹: MP4/WebM 다운로드, 안드로이드 앱: 다운로드 없이 `Movies/GolfSwingStudio` 갤러리 즉시 저장) 및 스냅샷(PNG)으로 저장.
  8. **안드로이드 APK 재빌드 및 배포 완료**:
     - [`mobile/dist/golfSwing.apk`](file:///c:/myWork/workspace/scratch/golf-swing-tracer/mobile/dist/golfSwing.apk) (`12,082,231 Bytes`) 빌드 및 배포 완료.

---

### [2026-10-16] Phase 12: 지면·골퍼 흔들림 고정(Stay Lock) 엔진, 작업 보관함(IndexedDB), 버전별 APK 자동 빌드 파이프라인 구축 (`v1.0 ~ v1.4`)
* **2D 다중 패치 블록 매칭 기반 영상 흔들림 고정 엔진 (`video-stabilizer.js`)**:
  - 지면(티매트·페어웨이 경계)·배경 능선·스윙 골퍼 하체 스탠스를 기준으로 Coarse-to-Fine SAD + Edge Gradient 2D 패치 매칭을 수행하여 촬영 중 손떨림을 보정하고, 원본 배율(100%) 그대로 지면과 사람을 제자리에 고정(`crop-matte` 및 `auto-zoom` 지원).
  - 캔버스에서 원하는 프레임의 지면을 직접 클릭해 기준 지면선에 고정하는 수동 키프레임(`customKeyframes`) 보정 기능 탑재.
* **프로젝트 작업 보관함 시스템 (`project-archive.js`, IndexedDB)**:
  - 스윙 클럽 잔상 분석 및 후방 공 궤적 작업 내역(원본 프레임 데이터, 수동 지정 핀 좌표, 탄도·거리 수치, 지면 고정 설정, 대표 썸네일)을 브라우저/앱 내부 IndexedDB에 영구 저장·덮어쓰기·목록 조회·편집장 즉시 복원·미리보기 재생할 수 있는 작업 보관함(`#savedArchiveModal`) 구현.
* **버전 자동 증가 및 누적 보존 빌드 스크립트 (`Build-GolfSwingApk.ps1`, `Build-GolfSwingApk.bat`, `mobile/version.properties`)**:
  - 빌드 실행 시마다 웹 에셋(`assets/www/`)을 자동 동기화하고 `versionCode`와 `versionName`을 자동 증가시키며, 이전 버전의 APK 파일을 삭제하지 않고 프로젝트 루트(`.\`)와 `mobile\` 폴더에 버전별 파일명으로 누적 보존하도록 구성.

---

### [2026-10-16] Phase 13: 0.5초 임계치 최상단(Top Layer) 처리 애니메이션 및 전 구간 멈춤 방지(Non-Blocking) 아키텍처 (`v1.5`)
* **최상단 처리 애니메이션 오버레이 (`#globalBusyOverlay`, `index.html`, `styles.css`, `app.js`)**:
  - 모든 사용자 작업(`runWithBusyOverlay`)이 `0.5초(500ms)` 이상 소요될 경우 HTML5 `popover="manual"` + `z-index: 2147483647` 최상단 레이어에 SVG `<animateTransform>` 듀얼 링 스피너, 실시간 경과 시간 카운터(`0.5s...`), 단계별 진행률 바를 표시하여 모달 창 위에서도 화면 멈춤 없이 진행 상태를 직관적으로 안내.
* **전 구간 비동기 프레임 양보 (`yieldToBrowserFrame`) 및 프로파일 캐싱 (`_stabProfileCacheKey`)**:
  - 동영상 분석, 흔들림 보정 재계산(`recomputeSamplesStabilizationAsync`), 고해상도 스냅샷·파노라마 합성, 보관함 직렬화 루프에서 `26~32ms` 주기로 브라우저 렌더링 프레임을 양보하여 UI Freeze 현상을 원천 차단.

---

### [2026-10-17] Phase 14: 공 위치 핀 실시간 프레임·좌표 영구 저장 및 미세 조정 버튼 클릭 시 타임라인 시점 자동 이동 (`v1.6 ~ v1.9`)
* **프레임별 공 위치 실시간 영구 저장 및 직전 작업 현황 패널 (`shot-tracer-engine.js`, `app.js`)**:
  - 프레임을 이동한 뒤 공 위치를 지정할 때마다 해당 지점의 프레임 번호(`pinnedFrame`), 시간(`pinnedTime`), 정규화 좌표(`x`, `y`)를 `pinnedPointsStore`, `pinnedHistory`, 탭 워크스페이스 및 `localStorage`(`golfSwing_realtimePinnedPoints_v1`)에 즉시 저장하고, 지점 버튼 활성화 시 직전 작업 지점의 프레임·좌표 정보를 캔버스 상단 배너와 실시간 현황 카드(`#shotPinRealtimeStatusBox`)에 표시.
* **캔버스 공 위치 미세 조정 버튼 클릭 시 영상 타임라인 자동 동기화 이동 (`resolvePinTargetTimelineTime`, `seekToTime`)**:
  - `[1. 출발점(공)]`, `[2. 중간점 1]`, `[3. 중간점 2]`, `[4. 중간점 3]`, `[5. 최고점(APEX)]`, `[6. 탄착지점]`, `[7. 최종 런]` 버튼을 클릭하면 해당 지점이 수동 지정된 프레임 시점(미지정 시 탄도 곡선 기준 예상 시점)으로 비디오와 타임라인 슬라이더가 즉시 자동 이동되어 사용자가 별도로 타임라인을 찾지 않고도 곧바로 공 위치를 클릭·보정할 수 있도록 개선.

---

### [2026-10-17] Phase 15: `"나만의골프스윙"` 2줄 타이틀 리브랜딩 및 맞춤형 카툰 일러스트 앱 아이콘·파비콘 적용 (`v1.10 ~ v1.11`)
* **앱 타이틀 `"나만의골프스윙"` 변경 및 `"나만의 / 골프스윙"` 2줄 타이포그래피 적용 (`index.html`, `styles.css`, `strings.xml`)**:
  - 웹 및 안드로이드 앱 타이틀을 `"나만의골프스윙"`으로 변경하고, 헤더 브랜드 영역에 `"나만의"`(상단 작은 글씨)와 `"골프스윙"`(하단 굵은 글씨) 두 줄 구조로 선명하게 표시.
* **카툰 일러스트 배경 + 꽉 차는 타이포그래피 앱 아이콘 및 파비콘 생성 (`Generate-AppBranding.ps1`, `app-icon.png`, `favicon.ico`)**:
  - 골프 스윙과 어울리는 부드럽고 은은한 만화풍 골프장 배경 위에 상단 `"나만의"`와 하단 좌우에 꽉 차는 가장 굵은 `"골프스윙"` 글씨가 뚜렷하게 대비되는 전용 아이콘(`app-icon.png`, Android `mipmap-mdpi~xxxhdpi` 및 Adaptive Icon)과 멀티 사이즈 `favicon.ico`를 제작·적용.
  - 빌드 산출물 APK 파일명을 `나만의골프스윙_v1.x.apk` 형식으로 리네임하고 버전 체계를 유지.

---

### [2026-10-17] Phase 16: 공 출발 시점 ~ APEX 최고점 도달 구간 슬로우 모션 탄도 밸런싱 (`v1.12`)
* **상승 구간 체공 시간 배분(`climbRatio = 0.58`) 및 슬로우 모션 이징 (`shot-tracer-engine.js`)**:
  - 후방(DTL) 원근 투영 특성상 화면에서 출발점→APEX 상승 이동 거리가 APEX→탄착 하강 거리보다 약 2배 길어 초반 상승이 너무 빠르게 보이던 문제를 해결하기 위해, 전체 비행 시간의 `58%`를 상승 구간에 배분하고 사인 감속 이징 함수(`climbEtaFromW`)와 여유 체공 시간 보장을 적용하여 출발부터 APEX 도달까지도 하강 구간과 조화롭게 슬로우 모션으로 표현되도록 개선.

---

### [2026-10-19] Phase 17: 상단 접이식 햄버거 메뉴 도입 및 핵심 버튼 외 부수 기능 숨김 UI 개편 (`v1.13 ~ v1.14`)
* **상단 접이식 메뉴(`#btnToggleTopMenu`, `#topMenuDropdownPanel`) 및 간결한 바깥 액션 바 (`index.html`, `styles.css`, `app.js`)**:
  - 모바일 화면에서 상단 메뉴가 겹치지 않도록 바깥 화면에는 꼭 필요한 핵심 버튼(`내 스윙 영상 열기`, `저장된 작업 조회`, `스윙 클럽 잔상 / 후방 공 궤적 모드 전환`, `재생/일시정지`, `공 위치 핀 지정`)만 노출.
  - 데모 프리셋 불러오기, 촬영 구도 수동 전환, 스트로보 스냅샷/7단계 파노라마/구간 동영상 저장, 현재 작업 보관함 저장, 세부 궤적·흔들림 고급 조절, 7단계 시퀀스 및 AI 코칭 리포트 등 부수적인 기능들은 상단 접이식 메뉴 팝업과 접이식 `<details class="collapsible-sub-menu">` 안에 체계적으로 수납.

---

### [2026-10-19] Phase 18: `내 스윙 영상 열기` 시 측면(Face-On) vs 후면(DTL) 자동 판별 및 모드 자동 전환 (`v1.15`)
* **다중 신호 융합 촬영 구도 자동 판별 엔진 (`classifySwingVideoCameraAngleAndMode` in `app.js`, `shot-tracer-engine.js`)**:
  - 스윙 동영상 업로드 시 ① 포즈 관절 기하학(토르소 대비 어깨 폭·발목 스탠스 폭·3D 깊이차·양측 손 스윙 아크 대칭성), ② 티박스 공·원거리 페어웨이·임팩트 직후 상승 공 궤적 검출 신뢰도, ③ 클럽 헤드 픽셀 모션 아크 분포 및 해상도·파일명 힌트를 종합 점수화하여 측면(정면 Face-On)인지 후면(후방 DTL)인지 자동 판별.
  - 판별 결과에 따라 `[스윙 클럽 잔상 분석]` 또는 `[후방 공 궤적]` 작업 모드로 자동 전환하여 즉시 분석·렌더링을 진행하고, 기존 탭의 이전 작업 워크스페이스는 안전하게 보존.

---

### [2026-10-19] Phase 19: 상단 메뉴 팝업 오픈 상태에서 스크롤 시 배경 영상 스크롤 차단 및 팝업 내부 스크롤 고정 (`v1.16`)
* **전용 스크롤 컨테이너(`#topMenuSectionsWrap`) 분리 및 캡처 단계 스크롤 라우팅 (`index.html`, `styles.css`, `app.js`)**:
  - 메뉴 팝업이 열린 상태에서 스크롤할 때 팝업 대신 뒤쪽 스윙 영상이 스크롤되던 문제(Scroll Chaining)를 해결하기 위해 `.top-menu-dropdown-panel` 내부에 `#topMenuSectionsWrap`(`overflow-y: auto; overscroll-behavior: contain;`)을 분리하고 각 섹션에 `flex-shrink: 0`을 부여.
  - 메뉴 오픈 시 `body.is-top-menu-open`으로 배경 스크롤을 잠그고, `window` 캡처 단계(`{ passive: false, capture: true }`)에서 `wheel` 및 `touchmove`(관성 스크롤 포함) 이벤트를 가로채어 뒤쪽 영상 스크롤을 100% 차단하면서 팝업 내부 리스트만 부드럽게 스크롤되도록 구현.

---

### [2026-10-19] Phase 20: 스마트폰 스윙 영상 무스크롤 전체 보기 자동 맞춤 및 전체화면 재생 기능 추가 (`v1.17`)
* **100% 기본 화면에서 스크롤 없는 영상 전체 맞춤 표시 (`setViewportZoom`, `ResizeObserver` in `app.js`, `styles.css`)**:
  - 스마트폰 앱에서 스윙 영상 내부에 스크롤바가 생기거나 하단 발·공 위치가 잘리지 않도록 `.stage-zoom-scroll`을 기본 `overflow: hidden`으로 설정하고, 100% 기본 배율일 때 뷰포트 가용 영역(`availW`, `availH`)과 영상 원본 종횡비(`aspect`)에 맞춘 정확한 `width`/`height` 픽셀 크기를 `#stageCanvas`에 부여하여 세로·가로 어떤 스윙 영상이든 한눈에 전체가 다 보이도록 개선.
* **몰입형 전체화면 재생 모드 (`#btnStageFullscreenOverlay`, `#btnFullscreenPlay`, `MainActivity.kt`)**:
  - 영상 우측 하단 플로팅 `전체화면 재생` 버튼 및 타임라인 바의 `전체화면 재생` 버튼을 클릭하면 Android 네이티브 몰입형 전체화면(`AndroidNativeBridge.setImmersiveFullscreen(true)`)과 연동되어 화면 전체에 꽉 차게 스윙 영상과 궤적을 자동 재생하며, 전체화면 전용 상·하단 컨트롤 바(배속 선택, 타임라인 슬라이더, 1프레임 이동, 임팩트 이동, 전체화면 종료)를 지원.

---

### [2026-10-19] Phase 21: 스윙 종료 후 공 궤적이 뒤늦게 시작되던 문제 해결 및 실제 타격(임팩트) 시점 3중 동기화 (`v1.18`)
* **근본 원인 규명 (`5.22초 / 156프레임` 영상에서 스윙 피니시 이후 `F116 / 3.83s`에 공이 출발하던 현상)**:
  1. 스윙은 전반부(`~2.6초`)에 끝나고 후반부(`2.6초~5.22초`)는 날아가는 공을 비추는 영상에서, 기존 `buildFallbackKinematicPose`가 `3.2초` 스윙을 전체 영상 길이(`5.22초`)에 선형 비례로 늘려 매핑하면서 임팩트가 `3.83초(F116)`로 밀렸음.
  2. 기존 `detectSwingMoments`가 단순히 손 위치가 가장 높은 단일 최솟값을 백스윙 탑으로 탐색하여, 스윙 피니시(`2.77s / F84`)에서 높이 올라간 손을 백스윙 탑으로 오인하고 그 이후인 `3.83s(F116)`를 임팩트로 잘못 판정했음.
* **3중 타격(임팩트) 시점 정밀 동기화 파이프라인 구현 (`swing-engine.js`, `shot-tracer-engine.js`, `app.js`)**:
  1. **실제 비디오 픽셀 모션 기반 스윙 타이밍 추출 (`computeFrameRegionalMotion` & `estimateSwingTimingFromVideoPixels`)**:
     - 프레임 간 골퍼 상체 영역 및 하단 타격 영역의 실제 픽셀 모션 에너지를 분석하여, 후반부 여백이 긴 영상에서도 실제 스윙이 일어나는 전반부의 타격 피크(`~1.75s`)와 스윙 종료 시점(`~2.60s`)을 정확히 추출하고 키네마틱 시간축을 동기화. 또한 Android WebView에서 MediaPipe GPU 초기화 실패 시 자동으로 CPU 모드로 폴백하도록 `ensurePoseLandmarker()` 보강.
  2. **[백스윙 탑(Peak 1) → 임팩트 골짜기(Valley) → 피니시(Peak 2)] 3단 연동 V-Valley Triad 검출기 (`detectSwingMoments`)**:
     - 피니시 정점을 백스윙 탑으로 착각하지 않도록 직전 `0.12s~0.65s` 내에 백스윙 탑이 존재하고 어드레스 높이로 급강하(임팩트 골짜기)한 뒤 직후 `0.14s~1.15s` 내에 다시 피니시 정점으로 치솟는 V자 골짜기(Impact Valley) Triad와 실제 영상 타격 모션 피크를 결합하여 백스윙 탑·임팩트·피니시를 동시에 정밀 확정.
  3. **티 위 골프공 이탈(Ball Disappearance on Tee) 시각 검출 (`detectVisualBallLaunchImpactTime`)**:
     - 어드레스 시 티(`originPoint`) 위에 있던 골프공이 클럽에 맞아 사라지는 바로 그 프레임 전환 시점을 검출해 `calibratedImpactTime`과 `keyMoments.impact`를 동기화하여, 클럽이 공을 타격하는 즉시 공 궤적이 지체 없이 출발하도록 구현.
* **최종 빌드 산출물**:
  - [`나만의골프스윙_v1.18.apk`](file:///c:/myWork/workspace/scratch/golf-swing-tracer/%EB%82%98%EB%A7%8C%EC%9D%98%EA%B3%A8%ED%94%84%EC%8A%A4%EC%9C%99_v1.18.apk) (`13,444,777 Bytes`, `versionCode 19`, `versionName 1.18`).

