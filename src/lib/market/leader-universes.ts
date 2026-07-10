export type LeaderMarket = "US" | "KOSPI" | "KOSDAQ";

export type LeaderSymbol = {
  symbol: string;
  name: string;
  sector?: string;
  themes?: string[];
};

export const LEADER_UNIVERSES: Record<LeaderMarket, LeaderSymbol[]> = {
  US: [
    { symbol: "NVDA", name: "NVIDIA", sector: "AI 반도체", themes: ["AI 반도체", "AI 인프라", "데이터센터"] },
    { symbol: "AAPL", name: "Apple", sector: "메가캡 플랫폼", themes: ["메가캡 플랫폼", "소비재"] },
    { symbol: "MSFT", name: "Microsoft", sector: "AI 소프트웨어", themes: ["AI 소프트웨어", "클라우드", "AI 인프라"] },
    { symbol: "AMZN", name: "Amazon", sector: "클라우드/커머스", themes: ["클라우드", "AI 인프라", "소비재"] },
    { symbol: "GOOGL", name: "Alphabet", sector: "AI 플랫폼", themes: ["AI 플랫폼", "클라우드", "AI 인프라"] },
    { symbol: "AVGO", name: "Broadcom", sector: "AI 반도체", themes: ["AI 반도체", "AI 인프라", "네트워크"] },
    { symbol: "META", name: "Meta", sector: "AI 플랫폼", themes: ["AI 플랫폼", "메가캡 플랫폼"] },
    { symbol: "TSLA", name: "Tesla", sector: "전기차", themes: ["전기차", "로봇", "자율주행"] },
    { symbol: "COST", name: "Costco", sector: "소비재", themes: ["소비재", "방어주"] },
    { symbol: "NFLX", name: "Netflix", sector: "미디어", themes: ["미디어", "소비재"] },
    { symbol: "AMD", name: "AMD", sector: "AI 반도체", themes: ["AI 반도체", "AI 인프라"] },
    { symbol: "ASML", name: "ASML", sector: "반도체 장비", themes: ["반도체 장비", "AI 반도체"] },
    { symbol: "AMAT", name: "Applied Materials", sector: "반도체 장비", themes: ["반도체 장비", "반도체 소부장"] },
    { symbol: "QCOM", name: "Qualcomm", sector: "통신 반도체", themes: ["통신 반도체", "모바일 반도체"] },
    { symbol: "INTU", name: "Intuit", sector: "소프트웨어", themes: ["소프트웨어", "AI 소프트웨어"] },
    { symbol: "BKNG", name: "Booking", sector: "여행/소비", themes: ["여행", "소비재"] },
    { symbol: "ADBE", name: "Adobe", sector: "소프트웨어", themes: ["소프트웨어", "AI 소프트웨어"] },
    { symbol: "TXN", name: "Texas Instruments", sector: "아날로그 반도체", themes: ["아날로그 반도체", "산업 반도체"] },
    { symbol: "MU", name: "Micron", sector: "메모리", themes: ["메모리", "HBM", "AI 반도체"] },
    { symbol: "SNDK", name: "SanDisk", sector: "메모리", themes: ["메모리", "스토리지"] },
    { symbol: "MRVL", name: "Marvell", sector: "AI 네트워크", themes: ["광통신", "AI 반도체", "네트워크"] },
    { symbol: "COHR", name: "Coherent", sector: "광통신", themes: ["광통신", "AI 인프라"] },
    { symbol: "LITE", name: "Lumentum", sector: "광통신", themes: ["광통신", "AI 인프라"] },
    { symbol: "ALAB", name: "Astera Labs", sector: "AI 인프라", themes: ["AI 인프라", "반도체 소부장"] },
    { symbol: "ARM", name: "Arm", sector: "AI 반도체", themes: ["AI 반도체", "모바일 반도체"] },
    { symbol: "DELL", name: "Dell", sector: "AI 서버", themes: ["AI 인프라", "서버"] },
    { symbol: "VRT", name: "Vertiv", sector: "전력 인프라", themes: ["전력 인프라", "AI 인프라", "데이터센터"] },
    { symbol: "ETN", name: "Eaton", sector: "전력 인프라", themes: ["전력 인프라", "AI 인프라"] },
    { symbol: "GEV", name: "GE Vernova", sector: "전력 인프라", themes: ["전력 인프라", "에너지"] },
    { symbol: "BE", name: "Bloom Energy", sector: "전력 인프라", themes: ["전력 인프라", "연료전지", "AI 인프라"] },
    { symbol: "OKLO", name: "Oklo", sector: "원전", themes: ["원전", "전력 인프라"] },
    { symbol: "IONQ", name: "IonQ", sector: "양자컴", themes: ["양자컴"] },
    { symbol: "RGTI", name: "Rigetti", sector: "양자컴", themes: ["양자컴"] },
    { symbol: "QUBT", name: "Quantum Computing", sector: "양자컴", themes: ["양자컴"] },
    { symbol: "IBM", name: "IBM", sector: "양자컴/AI", themes: ["양자컴", "AI 인프라"] },
    { symbol: "CRCL", name: "Circle", sector: "코인", themes: ["코인", "핀테크"] },
  ],
  KOSPI: [
    { symbol: "005930.KS", name: "삼성전자", sector: "반도체", themes: ["메모리", "AI 반도체", "코스피 대장주"] },
    { symbol: "000660.KS", name: "SK하이닉스", sector: "반도체", themes: ["메모리", "HBM", "AI 반도체", "코스피 대장주"] },
    { symbol: "373220.KS", name: "LG에너지솔루션", sector: "2차전지", themes: ["2차전지"] },
    { symbol: "207940.KS", name: "삼성바이오로직스", sector: "바이오", themes: ["바이오", "코스피 대장주"] },
    { symbol: "005380.KS", name: "현대차", sector: "자동차", themes: ["자동차", "로봇"] },
    { symbol: "000270.KS", name: "기아", sector: "자동차", themes: ["자동차"] },
    { symbol: "068270.KS", name: "셀트리온", sector: "바이오", themes: ["바이오"] },
    { symbol: "035420.KS", name: "NAVER", sector: "인터넷", themes: ["인터넷", "AI 소프트웨어"] },
    { symbol: "105560.KS", name: "KB금융", sector: "금융", themes: ["금융", "증권/금리"] },
    { symbol: "055550.KS", name: "신한지주", sector: "금융", themes: ["금융", "증권/금리"] },
    { symbol: "012330.KS", name: "현대모비스", sector: "자동차", themes: ["자동차", "로봇"] },
    { symbol: "005490.KS", name: "POSCO홀딩스", sector: "철강/소재", themes: ["철강", "2차전지 소재"] },
    { symbol: "051910.KS", name: "LG화학", sector: "화학/2차전지", themes: ["화학", "2차전지"] },
    { symbol: "066570.KS", name: "LG전자", sector: "가전/전장", themes: ["가전", "전장", "로봇", "코스피 대형주"] },
    { symbol: "035720.KS", name: "카카오", sector: "인터넷", themes: ["인터넷", "AI 소프트웨어"] },
    { symbol: "006400.KS", name: "삼성SDI", sector: "2차전지", themes: ["2차전지"] },
    { symbol: "012450.KS", name: "한화에어로스페이스", sector: "방산", themes: ["방산", "우주항공"] },
    { symbol: "042660.KS", name: "한화오션", sector: "조선", themes: ["조선", "방산"] },
    { symbol: "086790.KS", name: "하나금융지주", sector: "금융", themes: ["금융", "증권/금리"] },
    { symbol: "000810.KS", name: "삼성화재", sector: "보험", themes: ["보험", "금융"] },
    { symbol: "009150.KS", name: "삼성전기", sector: "기판/부품", themes: ["기판", "반도체 소부장", "AI 인프라"] },
    { symbol: "011070.KS", name: "LG이노텍", sector: "기판/부품", themes: ["기판", "반도체 소부장"] },
    { symbol: "010140.KS", name: "삼성중공업", sector: "조선", themes: ["조선"] },
    { symbol: "329180.KS", name: "HD현대중공업", sector: "조선", themes: ["조선", "방산"] },
    { symbol: "267260.KS", name: "HD현대일렉트릭", sector: "전력기기", themes: ["전력 인프라", "AI 인프라"] },
    { symbol: "298040.KS", name: "효성중공업", sector: "전력기기", themes: ["전력 인프라", "AI 인프라"] },
    { symbol: "010120.KS", name: "LS ELECTRIC", sector: "전력기기", themes: ["전력 인프라"] },
    { symbol: "042700.KS", name: "한미반도체", sector: "반도체 장비", themes: ["HBM", "반도체 장비", "AI 반도체"] },
    { symbol: "064350.KS", name: "현대로템", sector: "방산/로봇", themes: ["방산", "로봇"] },
    { symbol: "079550.KS", name: "LIG넥스원", sector: "방산", themes: ["방산"] },
  ],
  KOSDAQ: [
    { symbol: "247540.KQ", name: "에코프로비엠", sector: "2차전지", themes: ["2차전지"] },
    { symbol: "196170.KQ", name: "알테오젠", sector: "바이오", themes: ["바이오"] },
    { symbol: "277810.KQ", name: "레인보우로보틱스", sector: "로봇", themes: ["로봇"] },
    { symbol: "000250.KQ", name: "삼천당제약", sector: "바이오", themes: ["바이오"] },
    { symbol: "058470.KQ", name: "리노공업", sector: "반도체 부품", themes: ["반도체 소부장"] },
    { symbol: "028300.KQ", name: "HLB", sector: "바이오", themes: ["바이오"] },
    { symbol: "298380.KQ", name: "에이비엘바이오", sector: "바이오", themes: ["바이오"] },
    { symbol: "141080.KQ", name: "리가켐바이오", sector: "바이오", themes: ["바이오"] },
    { symbol: "086520.KQ", name: "에코프로", sector: "2차전지", themes: ["2차전지"] },
    { symbol: "214450.KQ", name: "파마리서치", sector: "바이오", themes: ["바이오"] },
    { symbol: "039030.KQ", name: "이오테크닉스", sector: "반도체 장비", themes: ["반도체 장비", "반도체 소부장"] },
    { symbol: "222800.KQ", name: "심텍", sector: "반도체 부품", themes: ["기판", "반도체 소부장"] },
    { symbol: "403870.KQ", name: "HPSP", sector: "반도체 장비", themes: ["반도체 장비", "반도체 소부장"] },
    { symbol: "357780.KQ", name: "솔브레인", sector: "반도체 소재", themes: ["반도체 소부장"] },
    { symbol: "067310.KQ", name: "하나마이크론", sector: "반도체 후공정", themes: ["반도체 소부장", "후공정"] },
    { symbol: "095340.KQ", name: "ISC", sector: "반도체 부품", themes: ["반도체 소부장"] },
  ],
};

export const getLeaderUniverse = (market: string) => {
  const normalized = market.toUpperCase();
  if (normalized === "KOSPI" || normalized === "KOSDAQ" || normalized === "US") {
    return {
      market: normalized as LeaderMarket,
      symbols: LEADER_UNIVERSES[normalized as LeaderMarket],
    };
  }

  return {
    market: "US" as const,
    symbols: LEADER_UNIVERSES.US,
  };
};
