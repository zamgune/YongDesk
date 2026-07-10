import Foundation

public enum AnalysisIndicators {
    public static func relativeStrengthIndex(closes: [Double], period: Int = 14) -> Double? {
        guard period > 0, closes.count > period else {
            return nil
        }

        var averageGain = 0.0
        var averageLoss = 0.0

        for index in 1...period {
            let change = closes[index] - closes[index - 1]
            if change >= 0 {
                averageGain += change
            } else {
                averageLoss += abs(change)
            }
        }

        averageGain /= Double(period)
        averageLoss /= Double(period)

        if closes.count > period + 1 {
            for index in (period + 1)..<closes.count {
                let change = closes[index] - closes[index - 1]
                let gain = max(change, 0)
                let loss = max(-change, 0)
                averageGain = ((averageGain * Double(period - 1)) + gain) / Double(period)
                averageLoss = ((averageLoss * Double(period - 1)) + loss) / Double(period)
            }
        }

        if averageLoss == 0 {
            return averageGain == 0 ? 50 : 100
        }

        let relativeStrength = averageGain / averageLoss
        let rsi = 100 - (100 / (1 + relativeStrength))
        return min(max(rsi, 0), 100)
    }
}
