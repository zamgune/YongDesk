import { NextResponse } from "next/server";

export type EconomicEvent = {
    date: string;
    time: string;
    country: "US" | "KR" | "CN" | "JP" | "EU";
    event: string;
    importance: "high" | "medium" | "low";
    description?: string;
};

// 2026 Economic Calendar - Major Events
// These are based on typical scheduling patterns
const ECONOMIC_EVENTS_2026: EconomicEvent[] = [
    // January 2026
    { date: "2026-01-03", time: "22:00", country: "US", event: "ISM 제조업 PMI", importance: "high", description: "미국 제조업 경기 지표" },
    { date: "2026-01-10", time: "22:30", country: "US", event: "비농업 고용지표", importance: "high", description: "미국 고용시장 핵심 지표" },
    { date: "2026-01-15", time: "22:30", country: "US", event: "소비자물가지수 (CPI)", importance: "high", description: "미국 인플레이션 핵심 지표" },
    { date: "2026-01-16", time: "10:00", country: "KR", event: "한국은행 금통위", importance: "high", description: "기준금리 결정" },
    { date: "2026-01-17", time: "11:00", country: "CN", event: "중국 GDP 발표", importance: "high", description: "중국 경제성장률" },
    { date: "2026-01-29", time: "04:00", country: "US", event: "FOMC 금리결정", importance: "high", description: "연준 기준금리 결정" },
    { date: "2026-01-30", time: "22:30", country: "US", event: "GDP 성장률 (속보)", importance: "high", description: "미국 경제성장률" },

    // February 2026
    { date: "2026-02-01", time: "10:00", country: "CN", event: "중국 제조업 PMI", importance: "high", description: "중국 제조업 경기" },
    { date: "2026-02-06", time: "22:30", country: "US", event: "비농업 고용지표", importance: "high", description: "미국 고용시장 핵심 지표" },
    { date: "2026-02-12", time: "22:30", country: "US", event: "소비자물가지수 (CPI)", importance: "high", description: "미국 인플레이션 핵심 지표" },
    { date: "2026-02-27", time: "10:00", country: "KR", event: "한국은행 금통위", importance: "high", description: "기준금리 결정" },

    // March 2026
    { date: "2026-03-01", time: "10:00", country: "CN", event: "중국 제조업 PMI", importance: "high", description: "중국 제조업 경기" },
    { date: "2026-03-06", time: "22:30", country: "US", event: "비농업 고용지표", importance: "high", description: "미국 고용시장 핵심 지표" },
    { date: "2026-03-11", time: "22:30", country: "US", event: "소비자물가지수 (CPI)", importance: "high", description: "미국 인플레이션 핵심 지표" },
    { date: "2026-03-18", time: "04:00", country: "US", event: "FOMC 금리결정", importance: "high", description: "연준 기준금리 결정 + 점도표" },
    { date: "2026-03-19", time: "12:00", country: "JP", event: "일본은행 금리결정", importance: "high", description: "BOJ 금리 결정" },

    // April 2026
    { date: "2026-04-01", time: "10:00", country: "CN", event: "중국 제조업 PMI", importance: "high", description: "중국 제조업 경기" },
    { date: "2026-04-03", time: "22:30", country: "US", event: "비농업 고용지표", importance: "high", description: "미국 고용시장 핵심 지표" },
    { date: "2026-04-10", time: "22:30", country: "US", event: "소비자물가지수 (CPI)", importance: "high", description: "미국 인플레이션 핵심 지표" },
    { date: "2026-04-17", time: "10:00", country: "CN", event: "중국 GDP 발표", importance: "high", description: "중국 경제성장률" },
    { date: "2026-04-24", time: "10:00", country: "KR", event: "한국은행 금통위", importance: "high", description: "기준금리 결정" },

    // May 2026
    { date: "2026-05-01", time: "10:00", country: "CN", event: "중국 제조업 PMI", importance: "high", description: "중국 제조업 경기" },
    { date: "2026-05-01", time: "22:30", country: "US", event: "비농업 고용지표", importance: "high", description: "미국 고용시장 핵심 지표" },
    { date: "2026-05-06", time: "04:00", country: "US", event: "FOMC 금리결정", importance: "high", description: "연준 기준금리 결정" },
    { date: "2026-05-13", time: "22:30", country: "US", event: "소비자물가지수 (CPI)", importance: "high", description: "미국 인플레이션 핵심 지표" },
    { date: "2026-05-28", time: "10:00", country: "KR", event: "한국은행 금통위", importance: "high", description: "기준금리 결정" },

    // June 2026
    { date: "2026-06-01", time: "10:00", country: "CN", event: "중국 제조업 PMI", importance: "high", description: "중국 제조업 경기" },
    { date: "2026-06-05", time: "22:30", country: "US", event: "비농업 고용지표", importance: "high", description: "미국 고용시장 핵심 지표" },
    { date: "2026-06-10", time: "22:30", country: "US", event: "소비자물가지수 (CPI)", importance: "high", description: "미국 인플레이션 핵심 지표" },
    { date: "2026-06-17", time: "04:00", country: "US", event: "FOMC 금리결정", importance: "high", description: "연준 기준금리 결정 + 점도표" },

    // July 2026
    { date: "2026-07-01", time: "10:00", country: "CN", event: "중국 제조업 PMI", importance: "high", description: "중국 제조업 경기" },
    { date: "2026-07-02", time: "22:30", country: "US", event: "비농업 고용지표", importance: "high", description: "미국 고용시장 핵심 지표" },
    { date: "2026-07-15", time: "22:30", country: "US", event: "소비자물가지수 (CPI)", importance: "high", description: "미국 인플레이션 핵심 지표" },
    { date: "2026-07-16", time: "10:00", country: "CN", event: "중국 GDP 발표", importance: "high", description: "중국 경제성장률" },
    { date: "2026-07-16", time: "10:00", country: "KR", event: "한국은행 금통위", importance: "high", description: "기준금리 결정" },
    { date: "2026-07-29", time: "04:00", country: "US", event: "FOMC 금리결정", importance: "high", description: "연준 기준금리 결정" },

    // August 2026
    { date: "2026-08-01", time: "10:00", country: "CN", event: "중국 제조업 PMI", importance: "high", description: "중국 제조업 경기" },
    { date: "2026-08-07", time: "22:30", country: "US", event: "비농업 고용지표", importance: "high", description: "미국 고용시장 핵심 지표" },
    { date: "2026-08-12", time: "22:30", country: "US", event: "소비자물가지수 (CPI)", importance: "high", description: "미국 인플레이션 핵심 지표" },
    { date: "2026-08-27", time: "10:00", country: "KR", event: "한국은행 금통위", importance: "high", description: "기준금리 결정" },
    { date: "2026-08-28", time: "00:00", country: "US", event: "잭슨홀 심포지엄", importance: "high", description: "연준 의장 연설" },

    // September 2026
    { date: "2026-09-01", time: "10:00", country: "CN", event: "중국 제조업 PMI", importance: "high", description: "중국 제조업 경기" },
    { date: "2026-09-04", time: "22:30", country: "US", event: "비농업 고용지표", importance: "high", description: "미국 고용시장 핵심 지표" },
    { date: "2026-09-11", time: "22:30", country: "US", event: "소비자물가지수 (CPI)", importance: "high", description: "미국 인플레이션 핵심 지표" },
    { date: "2026-09-16", time: "04:00", country: "US", event: "FOMC 금리결정", importance: "high", description: "연준 기준금리 결정 + 점도표" },

    // October 2026
    { date: "2026-10-01", time: "10:00", country: "CN", event: "중국 제조업 PMI", importance: "high", description: "중국 제조업 경기" },
    { date: "2026-10-02", time: "22:30", country: "US", event: "비농업 고용지표", importance: "high", description: "미국 고용시장 핵심 지표" },
    { date: "2026-10-13", time: "22:30", country: "US", event: "소비자물가지수 (CPI)", importance: "high", description: "미국 인플레이션 핵심 지표" },
    { date: "2026-10-16", time: "10:00", country: "CN", event: "중국 GDP 발표", importance: "high", description: "중국 경제성장률" },
    { date: "2026-10-16", time: "10:00", country: "KR", event: "한국은행 금통위", importance: "high", description: "기준금리 결정" },

    // November 2026
    { date: "2026-11-01", time: "10:00", country: "CN", event: "중국 제조업 PMI", importance: "high", description: "중국 제조업 경기" },
    { date: "2026-11-04", time: "04:00", country: "US", event: "FOMC 금리결정", importance: "high", description: "연준 기준금리 결정" },
    { date: "2026-11-06", time: "22:30", country: "US", event: "비농업 고용지표", importance: "high", description: "미국 고용시장 핵심 지표" },
    { date: "2026-11-12", time: "22:30", country: "US", event: "소비자물가지수 (CPI)", importance: "high", description: "미국 인플레이션 핵심 지표" },
    { date: "2026-11-26", time: "10:00", country: "KR", event: "한국은행 금통위", importance: "high", description: "기준금리 결정" },

    // December 2026
    { date: "2026-12-01", time: "10:00", country: "CN", event: "중국 제조업 PMI", importance: "high", description: "중국 제조업 경기" },
    { date: "2026-12-04", time: "22:30", country: "US", event: "비농업 고용지표", importance: "high", description: "미국 고용시장 핵심 지표" },
    { date: "2026-12-10", time: "22:30", country: "US", event: "소비자물가지수 (CPI)", importance: "high", description: "미국 인플레이션 핵심 지표" },
    { date: "2026-12-16", time: "04:00", country: "US", event: "FOMC 금리결정", importance: "high", description: "연준 기준금리 결정 + 점도표" },
];

function getUpcomingEvents(days: number = 14): EconomicEvent[] {
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    return ECONOMIC_EVENTS_2026.filter(event => {
        const eventDate = new Date(event.date);
        return eventDate >= now && eventDate <= cutoff;
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export async function GET(): Promise<Response> {
    const upcoming = getUpcomingEvents(14);

    return NextResponse.json({
        events: upcoming,
        lastUpdated: Date.now(),
        count: upcoming.length,
    });
}
