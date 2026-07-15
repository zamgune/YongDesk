# 주식 신호 플레이북과 검증 계약

이 문서는 한국 장중 급락반전과 한국·미국 단기·스윙 분석을 하나의 점수로 합치지 않고, 독립된 플레이북으로 계산·검증하는 계약을 정의한다. 플레이북은 분석과 후보 검토용이며 `OrderIntent`, broker stop 또는 주문 제출을 만들지 않는다.

## 플레이북

| ID | 시장 | 보유 구간 | 핵심 구조 |
|---|---|---|---|
| `kr-intraday-crash-reversal` | 한국 | 정규장 장중 | 일간 ATR 대비 충격, 동일 시간대 RVOL, 확정 5분봉 반전 |
| `short-hold-trend` | 한국·미국 | 1~3일 | 일봉 위험 필터, 확정 1시간봉 돌파 또는 눌림 회복 |
| `swing-mean-reversion` | 한국·미국 | 2~8주 | `base-panic` 또는 `growth-reset`, 시장·섹터 안정화 |
| `swing-trend` | 한국·미국 | 2~8주 | 시장 breadth, 섹터 상대강도, 대장주 순위와 일봉 추세 |

코인과 장기 계획은 시간대·데이터 구조가 달라 이 계약으로 재분류하지 않는다.

## 게이트와 충돌

각 플레이북은 `data → market → sector → setup → trigger → liquidity → risk → reward` 순서로 근거를 반환한다.

- RSI, CCI, Stochastic과 Williams %R은 여러 개의 독립 투표가 아니라 한 setup 그룹의 보조 근거다.
- 캔들 패턴은 setup과 시장 조건이 먼저 성립한 뒤 확정 트리거로만 사용한다.
- 시장과 섹터가 모두 약하면 신규 진입을 차단하고, 하나만 약하면 경고한다.
- 시장 또는 섹터 데이터가 없으면 통과로 간주하지 않고 `unavailable`로 남긴다.
- 같은 보유 구간에서 두 플레이북이 동시에 준비되면 점수를 합치거나 자동 선택하지 않고 conflict를 반환한다.

## 손절과 청산

- 최초 손절은 구조 저점 또는 실패선과 ATR buffer로 계산한다.
- 구조 손절을 허용 ATR 범위 안으로 억지로 이동하지 않는다. 위험폭이 너무 좁거나 넓으면 진입을 보류한다.
- stop은 진입 뒤 손실 방향으로 넓히지 않는다.
- 평균회귀와 추세 플레이북은 익절 규칙을 공유하지 않는다.
- 추세 trail은 SMA50, N일 저가 또는 Chandelier 중 한 종류만 사용한다.
- 분석 가격선은 `isBrokerStopEligible=false`이며 주문으로 자동 변환하지 않는다.

## 검증 상태

`signalReliability`의 단일 점수 대신 플레이북별 `TradePlanCalibration`을 사용한다.

| 상태 | 의미 |
|---|---|
| `insufficient-data` | 고정된 OOS 결과가 없거나 최소 표본 미달 |
| `provisional` | OOS 표본은 있으나 데이터·비용·낙폭·집중도 승격 조건 일부 미달 |
| `calibrated` | 시장과 플레이북별 walk-forward 및 봉인 holdout 조건을 모두 통과 |

검증 결과에는 표본 수, 목표 선도달률, 비용 후 평균 R, 95% 신뢰구간, profit factor, 최대낙폭, 비용 모델과 검증 기간을 함께 기록한다. 한국과 미국 결과를 합쳐 승격하지 않는다.

## 실행 모델

- 신호는 확정봉까지만 계산하고 다음 정규장 봉 시가에 진입한다.
- gap 손절은 stop보다 불리한 시가에 체결하고, 같은 봉에서 stop과 target이 모두 닿으면 stop을 우선한다.
- 부분청산마다 수수료·세금·slippage를 반영한다.
- 종가 기반 trail은 다음 봉 시가에 실행한다.
- 장중 플레이북은 정규장 종료 시 잔여 포지션을 청산한다.
- 백테스트는 checksum이 있는 로컬 dataset만 읽고 실행 중 외부 시세를 조회하지 않는다.

백테스트 실행기는 `yarn backtest:stock-signals`로 호출하고 결정론적 단위 검증은 `yarn test:stock-backtest`로 실행한다. dataset은 `.cache/stock-analysis/backtests/datasets/<datasetId>` 아래에 고정하며 provider, 기간, 가격 조정, session 정책, 누락 봉 정책, point-in-time universe, 상장폐지 포함 여부와 checksum을 manifest에 기록한다. 기간 선언은 실제 봉의 최초 open/최종 close와 일치해야 하며, 각 종목의 유효기간·universe 편입 구간·상장폐지 상태에는 출처와 기록 시각이 있는 evidence가 필요하다.

승격 evidence는 `--stress-config <config.json> --promotion-spec <spec.json>`을 함께 지정해 생성한다. CLI는 base/stress config와 signals를 `.cache/stock-analysis/backtests` 아래에 canonical JSON으로 고정하고, `calibrations/evidence/<artifactId>/promotion.json`에 promotion artifact schema v2를 쓴다. runtime registry manifest도 v2지만 별도 계약이며, registry에는 성과 숫자를 복사하지 않고 승인한 artifact의 ID·content checksum·실파일 checksum·상대 경로만 기록한다. loader는 dataset/config/signals의 실파일과 canonical ID를 다시 확인하고 동일 엔진을 base/stress로 재실행해 전체 result가 artifact와 일치할 때만 runtime calibration을 만든다.

`selectedCandidateId`는 비용 모델을 제외한 전략 config와 canonical signals checksum에서 결정론적으로 파생한다. `baselineMaxDrawdown`과 후보군의 `candidatePValues`는 현재 외부 baseline/candidate run을 loader가 재실행해 산출하는 값이 아니라 승인자가 검토해 넣는 입력이므로, spec v2의 `reviewerInputSources`에 각각의 근거를 기록해야 한다. 두 값은 artifact checksum과 승인 record에 결박되지만 독립 원시 실행까지 machine-verified된 값으로 간주하지 않는다. 선택 후보 p-value가 Holm 5%를 통과해도 재실행 OOS bootstrap 95% 하한이 0보다 크지 않으면 승격하지 않는다.

기본·stress adverse slippage는 장중 10/30bp, 1~3일 단기와 스윙 5/15bp다. 후보는 플레이북·시장별 최대 12개로 사전 고정하고, 장중·단기의 마지막 6개월과 스윙의 마지막 2년을 holdout으로 격리한다.

## 승격 조건

- OOS/holdout 최소 표본은 장중 200/40, 단기 120/30, 스윙 80/20이다.
- 비용 후 평균 R의 block-bootstrap 95% 하한이 0보다 커야 한다.
- 목표 선도달률은 최종 종료 사유가 아니라 trade fill 중 target 체결 존재 여부로 계산해, 1R 부분청산 후 trail/time 종료도 목표 선도달로 센다.
- 기본 profit factor 1.15 이상, stress profit factor 1.0 이상이어야 한다.
- walk-forward fold의 70% 이상이 양의 기대값이어야 한다.
- 최고 수익 1% 제거 뒤에도 평균 R이 양수여야 한다.
- 단일 종목과 단일 연도의 양의 기여도가 각각 30% 이하여야 한다.
- 최대낙폭은 baseline보다 나빠지지 않아야 하고, 최대 12개 후보 비교에는 Holm 5% 보정을 적용한다.
- point-in-time universe 또는 상장폐지 이력이 없으면 다른 수치가 좋아도 `provisional`을 넘지 못한다.

## 런타임 전환

새 `tradeSignalSet`과 `signalEvents`는 기존 응답에 additive하게 제공한다. 기존 `signals`, `trendFollowing`, `breakoutRule`, `signalReliability`, `horizonPlans`는 호환 기간 동안 유지한다. 검증 전 플레이북은 shadow 결과로만 제공하며 현재 사용자 판단 화면을 자동 교체하지 않는다.

현재 runtime은 종목-섹터 ETF 상대강도와 curated 후보군의 50일 leader 순위를 workspace와 관심종목 감시에 연결하고, 기초 확정 일봉의 provenance·`asOf`·`dataAgeSeconds`를 검증한다. curated 후보군의 상승 비율은 선택편향이 있어 실제 시장 breadth로 승격하지 않는다. 대표성 있는 point-in-time 전체 종목 coverage 공급자가 연결될 때까지 market gate는 항상 `unavailable`이다. 외부 데이터가 96시간을 넘거나 provenance·커버리지·매핑이 불충분해도 해당 gate를 fail-closed로 유지한다.

승인 registry는 runtime storage root의 `backtests/calibrations/registry.json`에서 읽는다. 개발 기본값은 `.cache/stock-analysis`, macOS 앱은 `~/Library/Application Support/com.stockanalysis.mac/sidecar`이므로 CLI에서 생성한 evidence 전체를 승인 절차를 거쳐 앱 storage root로 함께 배치해야 한다. 결박된 단일 승인 record만 해당 시장·플레이북을 `calibrated`로 승격하며, 저장소에는 수익성이 검증된 dataset이나 승인 registry를 기본 제공하지 않으므로 설치 직후 결과는 계속 shadow다.
