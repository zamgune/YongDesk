"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./sentiment.module.css";

type SentimentData = {
    market: string;
    value: number;
    rating: string;
    timestamp: number;
    formula?: string;
};

type MarketIndicator = {
    name: string;
    value: number;
    change?: number;
    timestamp: number;
};

type TreasuryAuction = {
    securityType: string;
    securityTerm: string;
    auctionDate: string;
    highRate: number;
    bidToCover: number;
};

type PresidentialAction = {
    title: string;
    url: string;
    category: string;
    date: string;
    highlightedKeywords: string[];
};

type WhiteHouseResponse = {
    actions: PresidentialAction[];
    lastUpdated: number;
    count: number;
};

type EconomicEvent = {
    date: string;
    time: string;
    country: "US" | "KR" | "CN" | "JP" | "EU";
    event: string;
    importance: "high" | "medium" | "low";
    description?: string;
};

type CalendarResponse = {
    events: EconomicEvent[];
    lastUpdated: number;
    count: number;
};

type SentimentResponse = {
    fearGreed: {
        us: SentimentData | null;
        kr: SentimentData | null;
        crypto: SentimentData | null;
    };
    indicators: {
        vix: MarketIndicator | null;
        dxy: MarketIndicator | null;
        btcDominance: MarketIndicator | null;
        usdkrw: MarketIndicator | null;
        kosdaq: MarketIndicator | null;
    };
    treasury: TreasuryAuction[] | null;
};

const getGaugeColor = (value: number): string => {
    if (value <= 25) return "#d0454f";
    if (value <= 45) return "#e88c3a";
    if (value <= 55) return "#b8a038";
    if (value <= 75) return "#7ab83a";
    return "#1c9d6f";
};

const getGaugeLabel = (value: number): string => {
    if (value <= 20) return "극도의 공포";
    if (value <= 40) return "공포";
    if (value <= 60) return "중립";
    if (value <= 80) return "탐욕";
    return "극도의 탐욕";
};

function GaugeCard({
    title,
    data,
    emoji,
}: {
    title: string;
    data: SentimentData | null;
    emoji: string;
}) {
    if (!data) {
        return (
            <div className={styles.gaugeCard}>
                <div className={styles.gaugeHeader}>
                    <span className={styles.gaugeEmoji}>{emoji}</span>
                    <h3 className={styles.gaugeTitle}>{title}</h3>
                </div>
                <div className={styles.gaugeLoading}>데이터 없음</div>
            </div>
        );
    }

    const color = getGaugeColor(data.value);
    const rotation = (data.value / 100) * 180 - 90;

    return (
        <div className={styles.gaugeCard}>
            <div className={styles.gaugeHeader}>
                <span className={styles.gaugeEmoji}>{emoji}</span>
                <h3 className={styles.gaugeTitle}>{title}</h3>
            </div>
            <div className={styles.gaugeContainer}>
                <svg viewBox="0 0 200 120" className={styles.gaugeSvg}>
                    <path
                        d="M 20 100 A 80 80 0 0 1 180 100"
                        fill="none"
                        stroke="var(--bg-1)"
                        strokeWidth="16"
                        strokeLinecap="round"
                    />
                    <path
                        d="M 20 100 A 80 80 0 0 1 180 100"
                        fill="none"
                        stroke={color}
                        strokeWidth="16"
                        strokeLinecap="round"
                        strokeDasharray={`${(data.value / 100) * 251.2} 251.2`}
                    />
                    <g transform={`rotate(${rotation}, 100, 100)`}>
                        <line
                            x1="100"
                            y1="100"
                            x2="100"
                            y2="35"
                            stroke="var(--ink-0)"
                            strokeWidth="3"
                            strokeLinecap="round"
                        />
                        <circle cx="100" cy="100" r="8" fill="var(--ink-0)" />
                    </g>
                </svg>
                <div className={styles.gaugeValue} style={{ color }}>
                    {data.value}
                </div>
                <div className={styles.gaugeRating}>{getGaugeLabel(data.value)}</div>
            </div>
            {data.formula && <div className={styles.gaugeFormula}>{data.formula}</div>}
        </div>
    );
}

function IndicatorCard({
    title,
    indicator,
    emoji,
    suffix = "",
}: {
    title: string;
    indicator: MarketIndicator | null;
    emoji: string;
    suffix?: string;
}) {
    if (!indicator) {
        return (
            <div className={styles.indicatorCard}>
                <span className={styles.gaugeEmoji}>{emoji}</span>
                <span className={styles.indicatorTitle}>{title}</span>
                <span className={styles.indicatorValue}>—</span>
            </div>
        );
    }

    const changeColor =
        indicator.change && indicator.change > 0
            ? "#1c9d6f"
            : indicator.change && indicator.change < 0
                ? "#d0454f"
                : "var(--ink-2)";

    return (
        <div className={styles.indicatorCard}>
            <span className={styles.gaugeEmoji}>{emoji}</span>
            <span className={styles.indicatorTitle}>{title}</span>
            <span className={styles.indicatorValue}>
                {indicator.value.toFixed(2)}
                {suffix}
            </span>
            {indicator.change !== undefined && (
                <span className={styles.indicatorChange} style={{ color: changeColor }}>
                    {indicator.change > 0 ? "+" : ""}
                    {indicator.change.toFixed(2)}%
                </span>
            )}
        </div>
    );
}

function getCategoryClass(category: string): string {
    const lower = category.toLowerCase();
    if (lower.includes("executive")) return styles.executive;
    if (lower.includes("proclamation")) return styles.proclamation;
    if (lower.includes("memorandum")) return styles.memorandum;
    if (lower.includes("nomination")) return styles.nomination;
    return "";
}

function getCategoryKorean(category: string): string {
    const lower = category.toLowerCase();
    if (lower.includes("executive")) return "행정명령";
    if (lower.includes("proclamation")) return "선언문";
    if (lower.includes("memorandum")) return "각서";
    if (lower.includes("nomination")) return "인사지명";
    return "발표";
}

const KEYWORD_TRANSLATIONS: Record<string, string> = {
    tariff: "관세",
    trade: "무역",
    china: "중국",
    import: "수입",
    export: "수출",
    sanction: "제재",
    semiconductor: "반도체",
    oil: "석유",
    energy: "에너지",
    tax: "세금",
    economy: "경제",
    "federal reserve": "연준",
    inflation: "인플레이션",
    "interest rate": "금리",
    treasury: "국채",
    budget: "예산",
    debt: "부채",
    defense: "국방",
    military: "군사",
    "national security": "안보",
    "critical minerals": "핵심광물",
    steel: "철강",
    aluminum: "알루미늄",
    agriculture: "농업",
    currency: "통화",
    investment: "투자",
    regulation: "규제",
    deregulation: "규제완화",
    infrastructure: "인프라",
    technology: "기술",
    crypto: "암호화폐",
    digital: "디지털",
    bank: "은행",
    financial: "금융",
    russia: "러시아",
    ukraine: "우크라이나",
    iran: "이란",
    "north korea": "북한",
    venezuela: "베네수엘라",
    mexico: "멕시코",
    canada: "캐나다",
    eu: "유럽연합",
    european: "유럽",
    asia: "아시아",
    pacific: "태평양",
    nato: "나토",
    wto: "WTO",
};

export default function SentimentPage() {
    const [data, setData] = useState<SentimentResponse | null>(null);
    const [whiteHouse, setWhiteHouse] = useState<WhiteHouseResponse | null>(null);
    const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"stock" | "crypto" | "news">("stock");

    useEffect(() => {
        async function fetchData() {
            try {
                const [sentimentRes, whiteHouseRes, calendarRes] = await Promise.all([
                    fetch("/api/market/sentiment"),
                    fetch("/api/whitehouse"),
                    fetch("/api/calendar"),
                ]);

                if (sentimentRes.ok) {
                    const sentimentData = await sentimentRes.json();
                    setData(sentimentData);
                }

                if (whiteHouseRes.ok) {
                    const whiteHouseData = await whiteHouseRes.json();
                    setWhiteHouse(whiteHouseData);
                }

                if (calendarRes.ok) {
                    const calendarData = await calendarRes.json();
                    setCalendar(calendarData);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : "Unknown error");
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    return (
        <div className={styles.page}>
            <main className={styles.shell}>
                <header className={styles.header}>
                    <div className={styles.titleBlock}>
                        <h1 className={styles.title}>시장 심리 지표</h1>
                        <p className={styles.subtitle}>
                            주식 및 암호화폐 시장의 공포탐욕지수와 주요 지표
                        </p>
                    </div>
                    <Link href="/" className={styles.backLink}>
                        ← 차트로 돌아가기
                    </Link>
                </header>

                {/* Tabs */}
                <div className={styles.tabs}>
                    <button
                        className={`${styles.tab} ${activeTab === "stock" ? styles.tabActive : ""}`}
                        onClick={() => setActiveTab("stock")}
                    >
                        📈 주식시장
                    </button>
                    <button
                        className={`${styles.tab} ${activeTab === "crypto" ? styles.tabActive : ""}`}
                        onClick={() => setActiveTab("crypto")}
                    >
                        ₿ 암호화폐
                    </button>
                    <button
                        className={`${styles.tab} ${activeTab === "news" ? styles.tabActive : ""}`}
                        onClick={() => setActiveTab("news")}
                    >
                        🏛️ 뉴스
                    </button>
                </div>

                {loading && <p className={styles.status}>로딩 중...</p>}
                {error && <p className={styles.status}>오류: {error}</p>}

                {data && activeTab === "stock" && (
                    <>
                        {/* Fear & Greed */}
                        <section>
                            <h2 className={styles.sectionTitle}>공포탐욕지수</h2>
                            <div className={styles.gaugeGrid}>
                                <GaugeCard title="미국 (S&P 500)" data={data.fearGreed.us} emoji="🇺🇸" />
                                <GaugeCard title="한국 (KOSPI)" data={data.fearGreed.kr} emoji="🇰🇷" />
                            </div>
                        </section>

                        {/* US Market Indicators */}
                        <section>
                            <h2 className={styles.sectionTitle}>미국 시장 지표</h2>
                            <div className={styles.indicatorGrid}>
                                <IndicatorCard
                                    title="VIX (공포지수)"
                                    indicator={data.indicators.vix}
                                    emoji="📉"
                                />
                                <IndicatorCard
                                    title="달러 인덱스"
                                    indicator={data.indicators.dxy}
                                    emoji="💵"
                                />
                            </div>
                        </section>

                        {/* Korean Market Indicators */}
                        <section>
                            <h2 className={styles.sectionTitle}>한국 시장 지표</h2>
                            <div className={styles.indicatorGrid}>
                                <IndicatorCard
                                    title="원/달러 환율"
                                    indicator={data.indicators.usdkrw}
                                    emoji="🇰🇷"
                                    suffix="원"
                                />
                                <IndicatorCard
                                    title="KOSPI/KOSDAQ 비율"
                                    indicator={data.indicators.kosdaq}
                                    emoji="📊"
                                />
                            </div>
                            <p className={styles.indicatorNote}>
                                비율이 높으면 KOSPI(대형주) 강세, 낮으면 KOSDAQ(성장주) 강세.
                                변화율은 오늘의 상대 강도 차이.
                            </p>
                        </section>

                        {/* Treasury Auctions */}
                        <section>
                            <h2 className={styles.sectionTitle}>미국채 입찰 결과</h2>
                            {data.treasury && data.treasury.length > 0 ? (
                                <div className={styles.treasuryTable}>
                                    <div className={styles.treasuryHeader}>
                                        <span>종류</span>
                                        <span>만기</span>
                                        <span>입찰일</span>
                                        <span>금리</span>
                                        <span>응찰률</span>
                                    </div>
                                    {data.treasury.map((t, i) => (
                                        <div key={i} className={styles.treasuryRow}>
                                            <span>{t.securityType}</span>
                                            <span>{t.securityTerm}</span>
                                            <span>{t.auctionDate}</span>
                                            <span>{typeof t.highRate === "number" && !isNaN(t.highRate) ? `${t.highRate.toFixed(3)}%` : "—"}</span>
                                            <span>{typeof t.bidToCover === "number" && !isNaN(t.bidToCover) ? `${t.bidToCover.toFixed(2)}x` : "—"}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className={styles.status}>데이터 없음</p>
                            )}
                        </section>

                        <section className={styles.infoCard}>
                            <h2>지표 해석 가이드</h2>
                            <ul>
                                <li>
                                    <strong>공포탐욕지수 0~25:</strong> 극도의 공포 - 매수 기회
                                </li>
                                <li>
                                    <strong>공포탐욕지수 75~100:</strong> 극도의 탐욕 - 과열 경고
                                </li>
                                <li>
                                    <strong>VIX 20 이상:</strong> 시장 불안 증가
                                </li>
                                <li>
                                    <strong>달러인덱스 상승:</strong> 위험자산 약세 가능성
                                </li>
                                <li>
                                    <strong>원/달러 환율 상승:</strong> 외국인 자금 이탈, 위험회피 심리
                                </li>
                                <li>
                                    <strong>KOSPI/KOSDAQ 비율 3.0 이상:</strong> 대형주(KOSPI) 강세
                                </li>
                                <li>
                                    <strong>KOSPI/KOSDAQ 비율 2.8 이하:</strong> 성장주(KOSDAQ) 강세
                                </li>
                            </ul>
                        </section>
                    </>
                )}

                {data && activeTab === "crypto" && (
                    <>
                        {/* Crypto Fear & Greed */}
                        <section>
                            <h2 className={styles.sectionTitle}>암호화폐 공포탐욕지수</h2>
                            <div className={styles.gaugeGridSingle}>
                                <GaugeCard
                                    title="Crypto Fear & Greed"
                                    data={data.fearGreed.crypto}
                                    emoji="₿"
                                />
                            </div>
                        </section>

                        {/* BTC Dominance */}
                        <section>
                            <h2 className={styles.sectionTitle}>비트코인 점유율</h2>
                            <div className={styles.indicatorGrid}>
                                <IndicatorCard
                                    title="BTC Dominance"
                                    indicator={data.indicators.btcDominance}
                                    emoji="🪙"
                                    suffix="%"
                                />
                            </div>
                            <p className={styles.indicatorNote}>
                                비트코인이 전체 암호화폐 시가총액에서 차지하는 비율.
                                높으면 안전자산 선호, 낮으면 알트코인 강세.
                            </p>
                        </section>
                    </>
                )}

                {activeTab === "news" && (
                    <>
                        {/* White House Actions */}
                        <section>
                            <h2 className={styles.sectionTitle}>🏛️ 백악관 발표</h2>
                            {whiteHouse && whiteHouse.actions.length > 0 ? (
                                <>
                                    <div className={styles.actionsContainer}>
                                        {whiteHouse.actions.map((action, i) => (
                                            <div key={i} className={styles.actionItem}>
                                                <div className={styles.actionHeader}>
                                                    <span className={`${styles.actionCategory} ${getCategoryClass(action.category)}`}>
                                                        {getCategoryKorean(action.category)}
                                                    </span>
                                                    {action.date && (
                                                        <span className={styles.actionDate}>{action.date}</span>
                                                    )}
                                                </div>
                                                <a
                                                    href={action.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className={styles.actionLink}
                                                >
                                                    {action.title}
                                                </a>
                                                {action.highlightedKeywords.length > 0 && (
                                                    <div className={styles.actionKeywords}>
                                                        {action.highlightedKeywords.map((kw, j) => (
                                                            <span key={j} className={styles.keyword}>
                                                                {KEYWORD_TRANSLATIONS[kw.toLowerCase()] || kw}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <p className={styles.actionSource}>
                                        출처:
                                        <a href="https://www.whitehouse.gov/presidential-actions/" target="_blank" rel="noopener noreferrer">
                                            whitehouse.gov
                                        </a>
                                    </p>
                                </>
                            ) : (
                                <div className={styles.actionsContainer}>
                                    <p className={styles.actionEmpty}>데이터 없음</p>
                                </div>
                            )}
                        </section>

                        {/* Economic Calendar */}
                        <section>
                            <h2 className={styles.sectionTitle}>📅 경제 일정 (2주)</h2>
                            {calendar && calendar.events.length > 0 ? (
                                <div className={styles.calendarContainer}>
                                    {calendar.events.map((event, i) => {
                                        const eventDate = new Date(event.date);
                                        const today = new Date();
                                        const isToday = eventDate.toDateString() === today.toDateString();
                                        const isTomorrow = eventDate.toDateString() === new Date(today.getTime() + 86400000).toDateString();

                                        const countryFlags: Record<string, string> = {
                                            US: "🇺🇸",
                                            KR: "🇰🇷",
                                            CN: "🇨🇳",
                                            JP: "🇯🇵",
                                            EU: "🇪🇺",
                                        };

                                        const dayLabel = isToday ? "오늘" : isTomorrow ? "내일" :
                                            `${eventDate.getMonth() + 1}/${eventDate.getDate()}`;

                                        return (
                                            <div key={i} className={`${styles.calendarItem} ${isToday ? styles.calendarToday : ""}`}>
                                                <div className={styles.calendarDate}>
                                                    <span className={styles.calendarDay}>{dayLabel}</span>
                                                    <span className={styles.calendarTime}>{event.time}</span>
                                                </div>
                                                <div className={styles.calendarContent}>
                                                    <div className={styles.calendarHeader}>
                                                        <span className={styles.calendarFlag}>{countryFlags[event.country]}</span>
                                                        <span className={styles.calendarEvent}>{event.event}</span>
                                                    </div>
                                                    {event.description && (
                                                        <span className={styles.calendarDesc}>{event.description}</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className={styles.actionsContainer}>
                                    <p className={styles.actionEmpty}>예정된 일정 없음</p>
                                </div>
                            )}
                        </section>
                    </>
                )}
            </main>
        </div>
    );
}
