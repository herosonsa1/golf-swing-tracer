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
