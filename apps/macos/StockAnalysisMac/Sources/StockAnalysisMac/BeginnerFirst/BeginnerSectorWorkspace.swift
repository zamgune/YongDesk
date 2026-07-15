import Charts
import SwiftUI
import StockAnalysisMacCore

private enum BeginnerSectorPeriod: String, CaseIterable, Identifiable {
    case oneDay
    case oneWeek
    case oneMonth

    var id: String { rawValue }

    var title: String {
        switch self {
        case .oneDay: return "1일"
        case .oneWeek: return "1주"
        case .oneMonth: return "1개월"
        }
    }

    func value(_ values: SectorStrengthValues) -> Double? {
        switch self {
        case .oneDay: return values.oneDay
        case .oneWeek: return values.oneWeek
        case .oneMonth: return values.oneMonth
        }
    }
}

struct BeginnerSectorWorkspace: View {
    @EnvironmentObject private var model: AppModel
    @Binding var stockMarket: BeginnerStockMarket
    let onRefresh: (Bool) async -> Void
    let onSelect: (SectorStrengthItemView, BeginnerStockMarket) -> Void

    @AppStorage("beginner.sector-period") private var periodRawValue = BeginnerSectorPeriod.oneDay.rawValue

    private var period: BeginnerSectorPeriod {
        get { BeginnerSectorPeriod(rawValue: periodRawValue) ?? .oneDay }
        nonmutating set { periodRawValue = newValue.rawValue }
    }

    private var response: SectorStrengthResponseView? {
        guard model.sectorStrength?.market == stockMarket.session else { return nil }
        return model.sectorStrength
    }

    private var rankedSectors: [SectorStrengthItemView] {
        (response?.sectors ?? []).sorted {
            (period.value($0.excessReturns) ?? -Double.infinity) >
                (period.value($1.excessReturns) ?? -Double.infinity)
        }
    }

    private var maximumMagnitude: Double {
        max(0.001, rankedSectors.compactMap { period.value($0.excessReturns).map(abs) }.max() ?? 0)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header

                if let response {
                    summary(response)
                    heatmap
                    rankingChart
                    footnote(response)
                } else if model.isSectorStrengthLoading {
                    loadingState
                } else {
                    emptyState
                }
            }
            .padding(20)
        }
        .background(BeginnerPalette.background)
        .accessibilityIdentifier("beginner-sector-workspace")
        .task(id: stockMarket) {
            await onRefresh(false)
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text("섹터 강도")
                    .font(.system(size: 26, weight: .bold))
                Text("대표 ETF가 시장보다 얼마나 강하거나 약한지 비교합니다.")
                    .font(.caption)
                    .foregroundStyle(BeginnerPalette.muted)
            }

            Spacer()

            Picker("시장", selection: $stockMarket) {
                ForEach(BeginnerStockMarket.allCases) { market in
                    Text(market.title).tag(market)
                }
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .frame(width: 150)
            .accessibilityIdentifier("beginner-sector-market-picker")

            Picker(
                "기간",
                selection: Binding(
                    get: { period },
                    set: { period = $0 }
                )
            ) {
                ForEach(BeginnerSectorPeriod.allCases) { item in
                    Text(item.title).tag(item)
                }
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .frame(width: 190)
            .accessibilityIdentifier("beginner-sector-period-picker")

            Button {
                Task { await onRefresh(true) }
            } label: {
                if model.isSectorStrengthLoading {
                    ProgressView().controlSize(.small)
                } else {
                    Label("새로고침", systemImage: "arrow.clockwise")
                }
            }
            .buttonStyle(.bordered)
            .disabled(model.isSectorStrengthLoading)
            .accessibilityIdentifier("beginner-sector-refresh")
        }
    }

    private func summary(_ response: SectorStrengthResponseView) -> some View {
        HStack(spacing: 9) {
            BeginnerStatusBadge(
                response.marketState == "intraday" ? "장중 잠정" : "종가 기준",
                color: response.marketState == "intraday" ? BeginnerPalette.amber : BeginnerPalette.blue
            )
            if response.stale {
                BeginnerStatusBadge("이전 데이터", color: BeginnerPalette.red)
            }
            Text("기준 \(beginnerTimestamp(response.asOf))")
                .font(.caption)
                .foregroundStyle(BeginnerPalette.muted)
            Text("·")
                .foregroundStyle(BeginnerPalette.lineStrong)
            Text("벤치마크 \(response.benchmark.name) \(beginnerPercent(period.value(response.benchmark.returns)))")
                .font(.caption.weight(.semibold))
            Spacer()
            Text(model.sectorStrengthMessage)
                .font(.caption2)
                .foregroundStyle(response.errors.isEmpty ? BeginnerPalette.muted : BeginnerPalette.amber)
        }
    }

    private var heatmap: some View {
        BeginnerSurface {
            VStack(alignment: .leading, spacing: 13) {
                HStack {
                    Text("한눈에 보는 강약")
                        .font(.headline)
                    Spacer()
                    Text("시장 대비 초과수익률 기준")
                        .font(.caption2)
                        .foregroundStyle(BeginnerPalette.muted)
                }

                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 150), spacing: 10)],
                    spacing: 10
                ) {
                    ForEach(rankedSectors) { sector in
                        sectorTile(sector)
                    }
                }
            }
        }
    }

    private func sectorTile(_ sector: SectorStrengthItemView) -> some View {
        let excess = period.value(sector.excessReturns)
        let absolute = period.value(sector.returns)
        let color = strengthColor(excess)

        return Button {
            onSelect(sector, stockMarket)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(sector.name)
                        .font(.subheadline.weight(.bold))
                        .lineLimit(1)
                    Spacer()
                    Text(sector.symbol.replacingOccurrences(of: ".KS", with: ""))
                        .font(.caption2.monospaced())
                        .foregroundStyle(BeginnerPalette.muted)
                }
                Text(beginnerPercent(absolute))
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundStyle(color)
                Text("시장 대비 \(beginnerPercent(excess))")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(color)
            }
            .padding(13)
            .frame(maxWidth: .infinity, minHeight: 104, alignment: .topLeading)
            .background(color.opacity(tileOpacity(excess)), in: RoundedRectangle(cornerRadius: 11))
            .overlay {
                RoundedRectangle(cornerRadius: 11)
                    .stroke(color.opacity(0.35), lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 11))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(sector.name), 수익률 \(beginnerPercent(absolute)), 시장 대비 \(beginnerPercent(excess))")
        .accessibilityHint("대표 ETF 차트 열기")
        .accessibilityIdentifier("beginner-sector-tile-\(sector.id)")
    }

    private var rankingChart: some View {
        BeginnerSurface {
            VStack(alignment: .leading, spacing: 12) {
                Text("섹터 순위")
                    .font(.headline)
                Text("막대는 시장 대비 차이(%p)이며 0 오른쪽이 시장보다 강한 섹터입니다.")
                    .font(.caption2)
                    .foregroundStyle(BeginnerPalette.muted)

                Chart(rankedSectors) { sector in
                    if let excess = period.value(sector.excessReturns) {
                        BarMark(
                            x: .value("초과수익률", excess * 100),
                            y: .value("섹터", sector.name)
                        )
                        .foregroundStyle(strengthColor(excess))
                        .annotation(position: excess >= 0 ? .trailing : .leading) {
                            Text(excess.formatted(.number.precision(.fractionLength(2)).sign(strategy: .always())) + "%p")
                                .font(.system(size: 9, weight: .semibold, design: .rounded))
                                .foregroundStyle(BeginnerPalette.text)
                        }
                    }
                }
                .chartXScale(domain: chartDomain)
                .chartXAxis {
                    AxisMarks(position: .bottom) { value in
                        AxisGridLine().foregroundStyle(BeginnerPalette.line.opacity(0.65))
                        AxisTick().foregroundStyle(BeginnerPalette.lineStrong)
                        AxisValueLabel {
                            if let number = value.as(Double.self) {
                                Text("\(number, specifier: "%.1f")%p")
                            }
                        }
                    }
                }
                .chartYAxis {
                    AxisMarks { _ in
                        AxisValueLabel().foregroundStyle(BeginnerPalette.text)
                    }
                }
                .frame(height: max(280, CGFloat(rankedSectors.count) * 27))
                .accessibilityIdentifier("beginner-sector-ranking-chart")
            }
        }
    }

    private func footnote(_ response: SectorStrengthResponseView) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("1일은 장중 현재가와 전일 종가를 비교할 수 있으며, 1주·1개월은 확정 일봉 기준입니다.")
            Text("대표 ETF 비교이므로 전체 구성종목의 등가중 섹터 지수와는 결과가 다를 수 있습니다.")
            if !response.errors.isEmpty {
                Text("조회 제외: \(response.errors.map(\.symbol).joined(separator: ", "))")
                    .foregroundStyle(BeginnerPalette.amber)
            }
        }
        .font(.caption2)
        .foregroundStyle(BeginnerPalette.muted)
    }

    private var loadingState: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text("대표 ETF 시세를 비교하고 있습니다.")
                .font(.subheadline.weight(.semibold))
            Text("요청은 rate limit을 피하기 위해 나누어 처리합니다.")
                .font(.caption)
                .foregroundStyle(BeginnerPalette.muted)
        }
        .frame(maxWidth: .infinity, minHeight: 360)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "square.grid.3x3")
                .font(.system(size: 32))
                .foregroundStyle(BeginnerPalette.muted)
            Text(model.sectorStrengthMessage)
                .font(.subheadline.weight(.semibold))
            Button("다시 불러오기") {
                Task { await onRefresh(true) }
            }
            .buttonStyle(.borderedProminent)
            .tint(BeginnerPalette.green)
        }
        .frame(maxWidth: .infinity, minHeight: 360)
    }

    private var chartDomain: ClosedRange<Double> {
        let points = maximumMagnitude * 100
        let span = max(0.25, points * 1.25)
        return -span...span
    }

    private func strengthColor(_ value: Double?) -> Color {
        guard let value, abs(value) >= 0.001 else { return BeginnerPalette.muted }
        return value > 0 ? BeginnerPalette.green : BeginnerPalette.red
    }

    private func tileOpacity(_ value: Double?) -> Double {
        guard let value, abs(value) >= 0.001 else { return 0.10 }
        return 0.12 + min(abs(value) / maximumMagnitude, 1) * 0.36
    }
}
