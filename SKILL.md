# Workspace Skill: YongStockDesk Analysis

This workspace includes a specialized skill for market analysis and strategy implementation.

## Specialized Skill
The **Stock Analysis Specialist** skill is defined in [.agent/skills/stock-analysis/SKILL.md](.agent/skills/stock-analysis/SKILL.md).

### Key Features
- **Technical Analysis**: Expert-level implementation of HMA, RSI, MACD, etc.
- **Strategy Compliance**: Strictly follows the signal rules in [STRATEGY_V2.md](STRATEGY_V2.md).
- **Visualization**: Guidance on using the project's standard signal markers and themes.
- **Execution Safety**: Keeps signals and UI behind `OrderIntent`, `RiskCheck`, live gates, and the kill switch.

Before changing user-visible behavior, also read [docs/features.md](docs/features.md) and [docs/continuation-guide.md](docs/continuation-guide.md).
