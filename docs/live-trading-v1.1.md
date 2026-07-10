# YongStockDesk 1.1.0 Toss 실거래 운영 경계

1.1.0은 공개 배포나 다중 사용자가 아닌 단일 로컬 Mac의 Toss 국내·미국 주식 지정가 주문만 대상으로 한다. Upbit·Bithumb 실주문과 시장가는 지원하지 않는다.

## 기본 상태와 한도

- 실거래 정책은 앱 지원 폴더의 로컬 원장에 저장하며, 설치 ID와 선택한 Toss 계좌에 바인딩한다.
- 수동 실거래와 자동화 실거래는 모두 기본 OFF이며, 자동화는 수동과 별도 토글이다.
- 매수는 주문당 100,000 KRW, KST 일일 제출 누적 300,000 KRW를 넘지 못한다. 취소·거절·매도로 누적 한도가 복구되지 않는다.
- 미국 주문은 Toss의 유효한 USD/KRW 환율로 환산한다. 응답이 없거나 유효 기간 밖이면 제출하지 않는다.
- 매도는 지정가, 매도 가능 수량, 최종 확인을 통과할 때만 허용한다.

## 제출과 복구

주문 미리보기는 10분 후 만료된다. sidecar는 미리보기의 입력값·선택 계좌·잔고/매도 가능 수량·환율을 제출 직전에 다시 확인한다. SwiftUI는 broker를 직접 호출하지 않는다.

`payloadHash`와 `clientOrderId`를 포함한 시도를 `submission_pending`으로 영속화한 뒤에만 Toss POST를 시도한다. 상태는 `prepared`, `submission_pending`, `submitted`, `unknown`, `rejected`, `reconciled`로 남긴다.

- timeout, 429, 5xx, `request-in-progress`는 자동 POST 재시도 없이 `unknown`으로 기록한다.
- `unknown`이 하나라도 있으면 수동·자동화 제출을 잠그며 자동화 토글도 내린다.
- broker order ID가 있는 주문은 OPEN/상세 조회 동기화로 `reconciled` 처리한다.
- broker order ID가 없는 `unknown`은 추측 매칭하지 않는다. Toss 주문 이력과 `clientOrderId`를 운영자가 대조할 때까지 잠금이 유지된다.

## 활성화 순서

1. Toss API 키 검증, 허용 IP, 단일 BROKERAGE 계좌 선택을 완료한다.
2. 설정의 `Toss 실거래 운영`에서 `실거래 QA 승인`을 입력한다. token·계좌·005930 보유·AAPL 미체결의 읽기 전용 점검이 실제 API에서 성공해야 기록된다.
3. `실거래 수동 주문 해제`를 입력해 수동 토글을 켠다.
4. 주문서는 지정가와 예상금액, KRW 환산, 남은 한도, RiskCheck를 표시한다. 보이는 주문 요약을 정확히 입력해야 최종 제출할 수 있다.
5. 자동화는 수동 지정가 주문 5건, 앱 재시작 뒤 상태 재조정, 결과 불명 0건, kill switch·worker pause 차단 증거가 있어야 `자동화 실거래 해제`를 입력해 켤 수 있다.

## 실 API 인수 기록

코드·단위 테스트만으로 실제 제출 준비를 승인하지 않는다. 사용자 계좌에서 다음을 기록해야 한다.

- Toss 허용 IP, 선택 계좌, 005930/AAPL 읽기 전용 조회 성공
- 최소 규모의 수동 지정가 5건과 각 `clientOrderId`, Toss 주문·체결 이력, 앱 원장 대조
- 앱 재시작 후 OPEN/종료 주문 상태 재조정
- kill switch와 worker pause가 제출을 막는지 확인
- `unknown` 0건을 확인한 뒤에만 자동화 실거래를 별도 해제

테스트/번들 검증이 통과해도 이 인수 기록 전에는 수동 토글을 켜지 않는다. 자동화는 수동 인수와 별도 해제 전까지 paper-only다.
