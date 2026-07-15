# 데스크톱 실 API 인수 QA

이 문서는 로컬 결정론적 검증을 모두 통과한 YongStockDesk에 실제 Toss·Upbit·Bithumb 연결을 추가해 인수 확인하는 절차다. Toss OpenAPI 1.2.4의 일반 지정가와 `SINGLE/OCO/OTO` 조건주문 코드는 포함돼 있지만, 1.3.0-beta.1 일반 설치본은 `liveSubmissionMode=disabled`이므로 실제 제출·수정·취소 인수를 실행하지 않는다. 실제 계좌의 일반 QA는 조회만 수행하고 주문 인수는 향후 서명된 `local-qa` 패키지의 별도 승인 세션으로 분리한다.

## 완료 판정

| 판정 | 의미 |
|---|---|
| 로컬 기능 준비 완료 | 결정론적 게이트 통과, Toss·Upbit 실 조회 QA 통과, paper 경계 확인 |
| Toss 수동 실거래 인수 완료 | 로컬 기능 준비에 더해 허용 IP·선택 계좌·수동 지정가 5건·재시작 재조정·원장 대조 완료 |
| 코인 수동 실거래 인수 완료 | 거래소별 자동 readiness·이용 동의·수동 토글, `KRW-*` 지정가의 typed confirmation·거래소 주문 ID 대조와 결과 불명 재조정 증거 완료 |
| 코인 자동 실거래 인수 완료 | 같은 거래소의 확인된 수동 5건, 재시작 재조정, kill switch 증거, 결과 불명 0건 뒤 별도 자동 토글과 체결 반영 검증 완료 |
| 특정 API 미연결 | 해당 계좌 조회는 미검증이지만 API 없이 예제·Yahoo fallback·Upbit 공개 분석·paper 기능은 사용 가능 |
| 외부 배포 준비 완료 | 로컬 기능 준비에 더해 Developer ID, notarization, stapling, Gatekeeper와 실제 Intel Mac 검증까지 완료 |

API 키 연결은 선택 사항이다. 다만 `dataSource=toss` 실 시세나 실계좌 잔고·주문 가능 정보까지 인수하려면 해당 절의 QA가 필요하다. 실제 주문은 자동 readiness·이용 동의와 거래소별 토글을 완료한 별도 인수 세션에서만 수행한다.

## 1. 먼저 실행할 결정론적 게이트

저장소 루트에서 실행한다.

```bash
node --experimental-strip-types scripts/verify_desktop_readiness.mts --dry-run
node --experimental-strip-types scripts/verify_desktop_readiness.mts
```

기본 게이트는 다음 순서를 지키며 첫 실패에서 즉시 중단한다.

1. `yarn lint`
2. `yarn build`
3. `yarn test:local-engine`
4. `yarn test:market-workspace`
5. `yarn test:toss`
6. `yarn test:crypto-exchanges`
7. `yarn test:market-candles`
8. `yarn test:market-analysis-contract`
9. `yarn test:horizon-plans`
10. `yarn test:automation`
11. `yarn mac:build`
12. `yarn mac:test`

앱 번들과 arm64/x64 패키지까지 다시 만들 때만 다음을 실행한다. 오래 걸리고 기존 `dist/macos` 생성물을 교체하므로 실 API QA 직전 매번 실행할 필요는 없다.

```bash
INCLUDE_MAC_BUNDLE=1 node --experimental-strip-types scripts/verify_desktop_readiness.mts
```

이 모드는 `mac:package:all → mac:verify → mac:verify:launch`를 추가한다. 최종 요약이 `PASS`가 아니면 실 API QA 결과로 보완하지 말고 먼저 로컬 실패를 수정한다.

## 2. 인증정보 취급 원칙

- API 키는 앱의 `설정 → API 연결 관리` 입력란에만 붙여 넣는다. 터미널 명령, 문서, 이슈, 채팅 또는 스크린샷에 넣지 않는다.
- 입력란이 비워진 뒤에만 화면을 캡처한다.
- 연결 성공 후 앱이 `검증 완료`와 Keychain 저장 결과를 표시하는지 확인한다. 원문 client ID, secret, access token, JWT 또는 계좌번호를 다시 표시하면 안 된다.
- Toss 개발자 콘솔과 Upbit 콘솔에는 QA에 필요한 최소 조회 권한과 현재 공인 IP만 등록한다. 권한명이 바뀐 경우 콘솔의 최신 설명을 기준으로 하되 주문 제출 테스트는 하지 않는다.
- QA가 끝난 뒤 테스트용 키가 더 필요하지 않으면 앱의 `연결 삭제`를 실행하고 거래소 콘솔에서도 폐기한다.
- 키 노출이 의심되면 결과와 관계없이 즉시 키를 폐기·재발급하고 로그와 캡처를 삭제한다.

앱이 관리하는 sidecar는 임의 포트를 사용할 수 있다. 계약 응답을 직접 볼 필요가 있으면 `설정 → 엔진/로그`에 표시된 현재 포트를 사용한다. 아래 예시의 `<PORT>`만 바꾸며 인증정보는 URL이나 헤더에 넣지 않는다.

```bash
BASE_URL="http://127.0.0.1:<PORT>"
```

## 3. Toss 실 credential QA

### 연결 확인

1. Toss 개발자 콘솔의 허용 IP와 앱 `Toss 연결 진단`의 공인 IP가 일치하는지 확인한다.
2. `설정 → API 연결 관리 → Toss API 연결`에서 client ID와 secret을 입력하고 검증 저장한다.
3. `검증 완료`, 조회된 계좌 수, Keychain 저장 완료가 표시되는지 확인한다. 계좌가 여러 개면 자동거래 계좌를 명시적으로 선택한다.
4. `Toss 운영 준비 점검`을 실행한다. 계좌·보유·미체결·주문 가능 정보 조회 결과와 `주문 호출 없음`을 확인한다.
5. 연결만 완료된 상태에서는 수동/자동화 실거래 토글이 모두 OFF인지 확인한다.

### 005930 삼성전자

차트에서 `주식`을 선택하고 `005930.KS`를 분석한다. 연결된 Toss를 확실히 검증하려면 계약 응답의 `source=toss`를 사용한다.

```bash
curl --fail --silent --show-error \
  "$BASE_URL/api/local/analysis/workspace?symbol=005930.KS&assetClass=stock&source=toss" \
  | jq '{symbol,assetClass,market,currency,dataSource,quoteAt,generatedAt,stale,timeframes:{oneHour:.analyses.oneHour.timeframe,fourHour:.analyses.fourHour.timeframe,daily:.analyses.daily.timeframe},warnings,orderSubmissionAttempted}'
```

필수 기대값은 다음과 같다.

| 필드/화면 | 기대값 |
|---|---|
| `market` | `KOSPI` |
| `currency` | `KRW` |
| `dataSource` | `toss` |
| `analyses.oneHour.timeframe` | `1h` |
| `analyses.daily.timeframe` | `1d` |
| `analyses.fourHour` | `null`; 주식 6.5시간 정규장의 4시간봉 왜곡을 피하는 의도된 동작 |
| `quoteAt` | 최근 확정 봉의 ISO 시각이며 미래 시각이 아님 |
| `orderSubmissionAttempted` | 반드시 `false` |

단타 계획은 `일봉 위험 필터 · 1시간봉 진입`, 스윙 계획은 `일봉 방향 · 1시간봉 진입` 근거를 표시해야 한다. 손절·익절 값은 분석 조언이며 broker stop으로 실행할 수 있다는 표현이 없어야 한다.

### AAPL

같은 절차로 `AAPL`을 분석한다.

```bash
curl --fail --silent --show-error \
  "$BASE_URL/api/local/analysis/workspace?symbol=AAPL&assetClass=stock&source=toss" \
  | jq '{symbol,market,currency,dataSource,quoteAt,generatedAt,stale,timeframes:{oneHour:.analyses.oneHour.timeframe,daily:.analyses.daily.timeframe},warnings,orderSubmissionAttempted}'
```

`market=US`, `currency=USD`, `dataSource=toss`, `1h/1d`, `orderSubmissionAttempted=false`가 필수다. 삼성전자 가격에 USD가 붙거나 AAPL 가격에 KRW가 붙으면 즉시 실패다.

### 확정 봉과 부분 세션

- 정규장 진행 중인 1시간봉은 `isClosed=false` 상태로 공급될 수 있지만 분석 계산에서는 제외되어야 한다. 같은 봉이 닫히기 전 반복 새로고침으로 분석의 마지막 확정 봉이 움직이면 실패다.
- 한국장은 09:00~15:30, 미국장은 09:30~16:00 정규장이다. 1시간봉을 장 마감에 맞추므로 장 초반 30분은 부분 세션 봉으로 snapshot과 `warnings`에 남고 지표 계산에서는 제외되어야 한다. 이를 온전한 1시간봉으로 계산하거나 경고 없이 숨기면 실패다.
- `stale=true`이면 신규 진입을 확정 상태로 보여주지 않고 경고 또는 대기 상태를 보여야 한다. 주말·휴장으로 오래된 경우는 데이터 오류와 구분해 기록한다.

### 429와 Toss 토큰 갱신

운영 API에 의도적인 부하 테스트를 하지 않는다. `yarn test:toss`가 다음 계약을 결정론적으로 검증한다.

- 병렬 조회가 액세스 토큰 발급 하나를 공유한다.
- read-only GET의 429는 `Retry-After`/rate-limit 정보를 따라 제한 횟수만 재시도한다.
- 폐기된 토큰의 401은 캐시를 비우고 GET 한 번만 새 토큰으로 재시도한다.
- 주문 POST의 401/429는 자동 재시도하지 않는다.
- 조건주문 생성·수정·취소도 자동 재시도하지 않는다. 수정 성공 시 반환된 새 `conditionalOrderId`만 이후 조회·취소에 사용한다.

실 QA에서는 005930과 AAPL을 연속 조회하고 자연스러운 토큰 갱신 구간이 포함되면 재연결 없이 조회가 계속되는지만 확인한다. 429가 끝내 반환되면 오류가 사용자에게 보여야 하고 마지막 값을 새 실시간 값처럼 표시하면 안 된다. 대기 후 한 번 수동 재시도해 복구되지 않으면 Toss 실 API QA 실패로 판정한다.

## 4. Upbit 공개 캔들 QA

공개 캔들 분석에는 Upbit 키가 필요하지 않다. 키를 연결하기 전에 `코인`을 선택하고 `KRW-BTC`를 분석한다.

현재 데스크톱 분석 계약은 `KRW-*`만 지원한다. `BTC-ETH`나 `USDT-ETH` 요청은 400으로 거절돼야 하며 `KRW-ETH` 데이터로 조용히 바뀌면 실패다.

```bash
curl --fail --silent --show-error \
  "$BASE_URL/api/local/analysis/workspace?symbol=KRW-BTC&assetClass=crypto&source=upbit" \
  | jq '{requestedSymbol,symbol,assetClass,market,currency,dataSource,quoteAt,generatedAt,stale,timeframes:{oneHour:.analyses.oneHour.timeframe,fourHour:.analyses.fourHour.timeframe,daily:.analyses.daily.timeframe},warnings,horizons:[.horizonPlans[].horizon],orderSubmissionAttempted}'
```

| 필드/화면 | 기대값 |
|---|---|
| `requestedSymbol` | `KRW-BTC` |
| `assetClass`, `market` | `crypto`, `CRYPTO` |
| `currency` | `KRW` |
| `dataSource` | `upbit` |
| 1시간 분석 | `analyses.oneHour.timeframe=1h` |
| 4시간 분석 | `analyses.fourHour.timeframe=4h` |
| 일봉 분석 | `analyses.daily.timeframe=1d` |
| 계획 | `day`, `swing`, `long`; 스윙은 일봉 방향·4시간봉 진입·1시간봉 재확인 |
| `orderSubmissionAttempted` | 반드시 `false` |

검증할 동작은 다음과 같다.

- `quoteAt`은 `generatedAt`보다 늦지 않고 UI의 기준 시각과 일치한다.
- 1h, 4h, 1d 각각 형성 중인 마지막 봉을 분석에서 제외한다. 봉 마감 전 연속 새로고침에서 마지막 확정 분석 봉이 바뀌지 않아야 한다.
- Upbit는 24시간 연속 시장이므로 `부분 세션 봉` 경고가 없어야 한다.
- 4시간봉은 1시간봉 네 개를 클라이언트가 임의 합성한 값이 아니라 Upbit 240분 REST 캔들에 기반해야 한다.
- `stale=true`이면 horizon plan은 신규 진입 확정이 아니라 대기/차단 이유를 보여야 한다.
- 429가 발생하면 성공 데이터로 위장하거나 Yahoo/Toss로 조용히 바꾸지 않는다. 잠시 기다린 후 한 번 새로고침해도 실패하면 공개 캔들 QA 실패로 기록한다.

## 5. Upbit private credential QA

공개 캔들 QA와 별개다. 잔고·주문 가능 정보가 필요할 때만 진행한다.

1. Upbit에서 현재 공인 IP와 QA에 필요한 최소 권한의 API 키를 만든다.
2. `설정 → API 연결 관리 → 코인 거래소 연결`에서 `Upbit`를 선택하고 Access Key와 Secret Key를 검증 저장한다.
3. `검증 완료`, 자산 항목 수와 Keychain 저장 완료를 확인한다. 원문 키나 JWT가 다시 표시되면 실패다.
4. 시장을 `KRW-BTC`로 두고 `준비 점검`을 실행한다.
5. 아래 결과를 확인한다.

| 항목 | 기대값 |
|---|---|
| credential | `verified` |
| `readonlyChecks.accounts` | `true` |
| `readonlyChecks.orderChance` | `true` |
| `readonlyChecks.ticker` | `true` |
| `readonlyChecks.orderConstraints` | `true` |
| 호가 단위 | `/v1/orderbook/instruments` 기반 양수 `tick_size` |
| 최소 주문금액·수수료 | 비어 있지 않고 합리적인 양수/0 이상 값 |
| 현재가 | `fresh=true`, 미래 시각 허용 오차 5초 이내 |
| `orderSubmissionAttempted` | 반드시 `false` |

6. 주문 사전검증에는 현재가 근처의 지정가와 아주 작은 수량을 입력한다. 실제 잔고가 부족하거나 최소 주문금액보다 작아 `passed=false`가 나와도 차단 이유가 구체적이면 정상이다.
7. 사전검증 응답에 예상 금액, 잔고 종류, 호가 단위, 수수료, blocker 또는 통과 결과와 `orderSubmissionAttempted=false`가 있어야 한다.
8. Upbit 앱/웹의 주문·체결 내역에 새 주문이 생기지 않았는지 별도로 확인한다.

`accounts=true`인데 `orderChance=false`이면 키 자체 검증 성공과 private QA 완료를 혼동하지 않는다. Upbit 콘솔의 IP와 조회 권한을 확인하고, 필요한 최소 권한을 부여하지 않을 정책이라면 잔고 조회만 가능하다고 명시해 인계한다. 이 경우 공개 1h/4h/1d 분석에는 영향이 없다.

## 6. 관리형 모의주문과 조건주문 경계

Upbit 연결 전후와 Toss·Upbit 수동 토글 OFF 상태에서는 다음 조건이 유지되어야 한다.

- 앱 상단 또는 주문 인스펙터에 `LIVE LOCKED`가 보인다.
- 차트와 우측 `분석 / 주문 / 뉴스` 인스펙터가 함께 보이고 페이지 전체가 아니라 인스펙터 내용만 스크롤된다.
- 주문 인스펙터의 익절·손절 독립 토글 네 조합은 각각 일반 매수, 익절 자동 청산, 손절 자동 청산, 먼저 도달한 OCO 청산으로 동작한다.
- `분석값 채우기`는 익절·손절 가격만 복사하고 두 토글을 OFF로 유지한다.
- paper 주문 후 바뀌는 것은 로컬 paper account/state뿐이다.
- stale 시세에는 청산하지 않고, 첫 청산 뒤 반대 leg가 다시 체결되지 않으며, 앱 재시작 뒤 미완료 계획을 복구한다.
- Toss readiness, holdings, precheck와 Upbit readiness, precheck에서 `orderSubmissionAttempted=false`다.
- horizon plan의 stop에는 `isBrokerStopEligible=false`가 유지된다.
- 코인 주문 인스펙터는 Toss 실계좌 선택을 비활성화한다.
- 1.3.0-beta.1 일반 설치본은 Toss 조건주문을 포함한 Toss·Upbit·Bithumb submit·modify·cancel을 HTTP 423으로 차단한다.
- 브로커·거래소의 주문/체결 내역에 QA로 생성된 주문이 없다.

향후 서명된 `local-qa`에서 조건주문 인수를 시작할 때는 다음 계약을 먼저 확인한다.

1. 신규 매수+익절 또는 손절 1개는 OTO, 보유분 청산 1개는 SINGLE, 보유분 익절+손절은 OCO다. 신규 매수+익절+손절 3단 브래킷은 사전검증에서 차단한다.
2. OCO는 선택 계좌의 매도 가능 수량을 확인한 뒤에만 준비 완료가 된다. 국내 주식 손절 지정가는 트리거 한 호가 아래이며 급락 시 미체결 경고가 표시된다.
3. 조건주문 전체 입력 hash의 10분 미리보기와 화면 주문 요약의 typed confirmation이 일치해야 한다. 같은 `clientOrderId`는 다시 제출하지 않는다.
4. timeout·429·5xx·결과 불명은 자동 재시도하지 않고 실거래 전역 잠금을 유지한 채 조건주문과 발동된 일반 주문 ID를 각각 조회해 재조정한다.
5. 조건주문 수정이 반환한 새 `conditionalOrderId`로만 이후 상세 조회와 취소를 실행한다. 기존 ID를 다시 사용하면 실패다.

일반 지정가 수동 Toss 인수는 서명된 `local-qa` 패키지에서 다음을 모두 기록한 경우에만 진행한다.

1. API 등록 또는 계좌 선택 뒤 자동 readiness가 기록되고 `주식 실거래 위험을 확인했습니다` 이용 동의를 별도로 완료했는지 확인한다.
2. `실거래 수동 주문 해제` 뒤 최소 규모의 KR/US 지정가 주문을 총 5건 제출한다. 각 주문의 typed confirmation, `clientOrderId`, broker order ID, Toss 주문·체결 이력과 앱 감사 원장을 대조한다.
3. 앱을 재시작한 뒤 주문 상태 재조정을 실행해 OPEN·종료 주문을 다시 대조한다.
4. kill switch와 worker pause를 각각/동시에 켜 제출이 차단되는지 확인하고 차단 증거를 기록한다.
5. `unknown` 주문이 0건인지 확인한다. timeout, 429, 5xx, `request-in-progress`가 발생하면 자동 재시도하지 말고 실거래 토글을 끄고 Toss 이력과 수동 대조한다.

### Upbit·Bithumb 수동 인수

이 절은 **실제 주문을 허용한 별도 인수 세션에서만** 실행한다. 읽기 전용 QA에서는 아래 토글·제출 단계를 실행하지 않는다.

1. `Upbit → 계좌·주문가능 점검`과 일반 `주문 사전검증`이 `orderSubmissionAttempted=false`로 통과하는지 확인한다.
2. 자동 readiness 뒤 `코인 실거래 위험을 확인했습니다` 이용 동의를 기록한다. 주문 내역에는 새 항목이 없어야 한다.
3. 해당 거래소에서 `코인 실거래 수동 주문 해제`를 입력한다. 다른 거래소 토글과 자동매매·시장가는 열리지 않아야 한다.
4. 최소 규모의 `KRW-*` 지정가를 사전검증한다. 화면에 표시된 주문 요약을 정확히 입력한 뒤에만 단 한 번 제출한다. `clientOrderId`, Upbit 주문 UUID, 거래소 주문 내역을 대조한다.
5. 429·5xx·timeout·응답 불명은 자동 재시도하지 않는다. 수동 토글이 잠긴 것을 확인하고 `결과 불명 주문 재조정`이 Upbit `identifier` 또는 Bithumb `client_order_id` 조회만 호출하는지 기록한다. 조회로 확정하지 못하면 토글을 계속 OFF로 둔다.

## 7. 2026-07-11 실제 계좌 읽기 전용 기록

- Toss: 연결 1계좌, 보유 1종목, 미체결 0건. token/accounts/holdings/openOrders readiness 통과.
- Upbit: 연결 1계정, 보유 3자산, 미체결 0건. accounts/orderChance/ticker/orderConstraints readiness 통과. 일부 보유 자산은 KRW 시세 미지원으로 부분 표시.
- Bithumb: 미연결 상태와 연결 버튼 표시 확인.
- QA 전후 Toss·Upbit 미체결 건수는 모두 0건으로 동일했고 모든 조회 응답은 `orderSubmissionAttempted=false`였다.
- readiness 뒤에도 Toss·Upbit 이용 동의는 미완료, 수동/자동 토글은 모두 OFF, effective gate는 false였다.
- 이 기록에서는 주문 제출·주문 취소 endpoint를 호출하지 않았다.

`orderSubmissionAttempted=true`가 수동 인수에서 예상한 한 번의 제출에만 대응하는지 확인해야 한다. 토글 OFF·읽기 전용 QA에서 이 값이 true가 되거나 의도하지 않은 주문이 생기면 즉시 앱과 sidecar를 종료하고 키를 폐기한다.

## 7. 로그와 Keychain 마스킹

연결과 분석을 마친 뒤 `설정 → 엔진/로그`와 복사 가능한 운영 리포트를 확인한다.

다음 문자열 또는 원문 값이 없어야 한다.

- `client_secret`, `secretKey`, `access_token`
- `Authorization: Bearer ...`
- `eyJ`로 시작하는 JWT 전체
- Toss client ID/secret, Upbit Access/Secret Key 원문
- 전체 계좌번호

허용되는 정보는 broker/exchange 이름, `verified` 상태, 계좌 개수, 마스킹된 식별자, request ID, HTTP status, rate-limit 수치와 사용자가 이해할 수 있는 오류 설명이다. readiness 게이트 스크립트도 자식 프로세스 출력을 캡처해 알려진 환경변수 secret과 일반 credential/JWT 패턴을 마스킹하지만, 마스킹을 키 관리의 대체 수단으로 사용하지 않는다.

## 8. 실패 판정표

| 관찰 결과 | 판정 | 조치 |
|---|---|---|
| 결정론적 게이트 한 단계 실패 | 전체 인수 차단 | 첫 실패를 수정하고 처음부터 재실행 |
| Toss 401 | Toss QA 실패 | 키 상태 확인, 재발급, 저장 후 토큰 갱신 재검증 |
| Toss 403 또는 계좌 조회 거부 | Toss QA 실패 | 허용 IP, 계좌, 최소 조회 권한 확인 |
| Toss 429가 제한 재시도와 대기 후에도 지속 | Toss QA 보류 | 요청 빈도 중단, reset 시각 이후 1회 재검증 |
| Upbit 공개 429/5xx가 대기 후 지속 | 공개 코인 분석 QA 보류 | 자동 반복 금지, 거래소 상태 확인 후 재시도 |
| Upbit 잔고 성공, chance/constraints 실패 | private QA 실패 | IP/권한/시장 코드 확인; 공개 분석과 분리 기록 |
| `source`, `currency`, `timeframe` 불일치 | 릴리스 차단 | metadata 계약 수정; 화면 표시만 임시 보정하지 않음 |
| `quoteAt`이 미래이거나 형성 중 봉을 확정으로 사용 | 릴리스 차단 | close 판정과 시각대 수정 |
| 정상 거래 시간인데 `stale=true`가 지속 | 해당 공급자 QA 실패 | 시각대, pagination, rate limit과 공급자 응답 확인 |
| 휴장·주말이라 `stale=true`이며 UI가 대기로 표시 | 조건부 통과 | 휴장 사유와 재검증 예정 시각 기록 |
| 주식 부분 세션을 온전한 1h/4h로 표시 | 릴리스 차단 | 세션 경계와 warning 수정 |
| `orderSubmissionAttempted=true` 또는 실 주문 발생 | 치명적 실패 | 즉시 종료·키 폐기·주문 상태 확인·안전 경계 감사 |
| 로그/리포트에 secret, JWT, 전체 계좌번호 노출 | 치명적 실패 | 키 폐기, 로그 삭제, 마스킹 수정 후 전체 재검증 |
| Developer ID/notary/Intel 검증만 미완료 | 로컬 기능 사용 가능, 외부 배포 불가 | 아래 외부 배포 절차로 별도 진행 |

## 9. 인계 증거 양식

키·계좌번호·잔고 원문은 기록하지 않는다.

```text
검증 일시/시간대:
앱 version/build:
macOS/호스트 아키텍처:
readiness gate: PASS / 실패 단계
bundle gate: 실행 안 함 / PASS / 실패 단계
Toss 005930: source, currency, timeframe, quoteAt, stale, PASS/FAIL
Toss AAPL: source, currency, timeframe, quoteAt, stale, PASS/FAIL
Upbit public KRW-BTC: 1h/4h/1d, quoteAt, stale, PASS/FAIL
Upbit private: accounts/chance/ticker/constraints, PASS/FAIL/미실행
orderSubmissionAttempted: 모든 확인에서 false
브로커 주문·체결 내역: 신규 주문 없음
로그 마스킹: PASS/FAIL
휴장·429 등 조건부 메모:
검증자:
```

## 10. 외부 배포 조건

다음은 Toss·Upbit 연결 후 개인 Mac에서 사용하는 조건이 아니라, 다른 사용자에게 Gatekeeper 경고 없이 배포하기 위한 별도 조건이다.

- Developer ID Application 서명
- Apple notarization 성공
- DMG/app stapling과 `stapler validate`
- Gatekeeper 승인
- arm64 실제 Mac 설치·실행
- x64 DMG의 실제 Intel Mac 설치·실행

Apple Silicon의 Rosetta 성공은 실제 Intel 검증을 대체하지 않는다. 이 항목이 미완료여도 로컬 기능 QA는 완료할 수 있지만, 결과를 `외부 배포 준비 완료`로 표시하면 안 된다.
