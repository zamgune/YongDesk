import { NextResponse } from "next/server";

export type PresidentialAction = {
    title: string;
    url: string;
    category: string;
    date: string;
    highlightedKeywords: string[];
};

// Market-relevant keywords to highlight
const MARKET_KEYWORDS = [
    "tariff",
    "trade",
    "china",
    "import",
    "export",
    "sanction",
    "semiconductor",
    "oil",
    "energy",
    "tax",
    "economy",
    "federal reserve",
    "inflation",
    "interest rate",
    "treasury",
    "budget",
    "debt",
    "defense",
    "military",
    "national security",
    "critical minerals",
    "steel",
    "aluminum",
    "agriculture",
    "currency",
    "investment",
    "regulation",
    "deregulation",
    "infrastructure",
    "technology",
    "crypto",
    "digital",
    "bank",
    "financial",
    "medicare",
    "social security",
    "healthcare",
    "pharmaceutical",
    "drug",
    "russia",
    "ukraine",
    "iran",
    "north korea",
    "venezuela",
    "mexico",
    "canada",
    "eu",
    "european",
    "asia",
    "pacific",
    "nato",
    "wto",
];

// Category mapping based on URL patterns
const CATEGORY_MAP: Record<string, string> = {
    "executive-orders": "Executive Order",
    proclamations: "Proclamation",
    "presidential-memoranda": "Memorandum",
    "nominations-appointments": "Nomination",
};

function extractCategory(html: string, url: string): string {
    // Try to extract from the HTML context
    for (const [key, value] of Object.entries(CATEGORY_MAP)) {
        if (url.includes(key) || html.toLowerCase().includes(key)) {
            return value;
        }
    }
    return "Presidential Action";
}

function findKeywords(title: string): string[] {
    const titleLower = title.toLowerCase();
    return MARKET_KEYWORDS.filter((keyword) => titleLower.includes(keyword.toLowerCase()));
}

function extractDateFromUrl(url: string): string {
    // Extract date from URL pattern like /2026/01/
    const match = url.match(/\/(\d{4})\/(\d{2})\//);
    if (match) {
        const [, year, month] = match;
        return `${year}-${month}`;
    }
    return "";
}

export async function GET(): Promise<Response> {
    try {
        const response = await fetch("https://www.whitehouse.gov/presidential-actions/", {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            next: { revalidate: 3600 }, // Cache for 1 hour
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status}`);
        }

        const html = await response.text();

        // Parse the HTML to extract presidential actions
        // Looking for patterns like: <a href="https://www.whitehouse.gov/presidential-actions/...">Title</a>
        const actionRegex =
            /<a[^>]*href="(https:\/\/www\.whitehouse\.gov\/presidential-actions\/\d{4}\/\d{2}\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;

        const actions: PresidentialAction[] = [];
        const seenUrls = new Set<string>();
        let match;

        while ((match = actionRegex.exec(html)) !== null) {
            const [, url, title] = match;

            // Skip duplicates and category pages
            if (seenUrls.has(url)) continue;
            if (url.includes("/page/")) continue;

            seenUrls.add(url);

            const cleanTitle = title.trim();
            if (!cleanTitle) continue;

            // Extract category from the surrounding HTML context
            const contextStart = Math.max(0, match.index - 500);
            const contextEnd = Math.min(html.length, match.index + 500);
            const context = html.slice(contextStart, contextEnd);

            actions.push({
                title: cleanTitle,
                url,
                category: extractCategory(context, url),
                date: extractDateFromUrl(url),
                highlightedKeywords: findKeywords(cleanTitle),
            });
        }

        // Limit to 10 most recent actions
        const recentActions = actions.slice(0, 10);

        return NextResponse.json({
            actions: recentActions,
            lastUpdated: Date.now(),
            count: recentActions.length,
        });
    } catch (error) {
        console.error("Error fetching presidential actions:", error);
        return NextResponse.json(
            {
                actions: [],
                lastUpdated: Date.now(),
                count: 0,
                error: error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 }
        );
    }
}
