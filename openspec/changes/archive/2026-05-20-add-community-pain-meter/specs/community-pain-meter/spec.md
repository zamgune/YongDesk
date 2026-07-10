## ADDED Requirements

### Requirement: Community pain score API
The system SHALL provide an API that returns a community-derived "곡소리" score for a requested symbol or market query.

#### Scenario: Successful community score response
- **WHEN** a user requests community pain for a supported symbol
- **THEN** the system returns a score from 0 to 100, a level label, confidence, source breakdown, scoring factors, and updated timestamp

#### Scenario: Unsupported or empty query
- **WHEN** a user requests community pain without a valid symbol or query
- **THEN** the system returns a user-safe 400 response explaining that a symbol or query is required

### Requirement: Source adapter gating
The system SHALL model each community source with an explicit policy status of `allowed`, `spike`, or `disabled`.

#### Scenario: Disabled source is requested
- **WHEN** a source is configured as `disabled`
- **THEN** the system does not fetch that source and reports it as skipped in the source breakdown

#### Scenario: Spike source is requested
- **WHEN** a source is configured as `spike`
- **THEN** the system only uses that source when explicitly enabled for feasibility testing

### Requirement: Paxnet stock discussion source
The system SHALL support Paxnet stock discussion as the primary Korean stock-specific source for v1.

#### Scenario: Paxnet posts are available
- **WHEN** the Paxnet adapter retrieves public discussion items for a Korean stock code
- **THEN** the system normalizes titles, timestamps, engagement counts, and available post text into common community items

#### Scenario: Paxnet fetch fails
- **WHEN** the Paxnet adapter cannot fetch or parse the requested source
- **THEN** the system continues scoring with available sources and records a source-level error without failing the whole response

### Requirement: Reddit source through official API
The system SHALL use Reddit through its official Data API path rather than scraping Reddit web pages.

#### Scenario: Reddit credentials are unavailable
- **WHEN** Reddit API credentials are not configured
- **THEN** the Reddit source is reported as skipped with configuration-required status

#### Scenario: Reddit rate limit metadata is received
- **WHEN** Reddit returns rate limit headers
- **THEN** the system records the remaining limit metadata for observability and avoids exceeding the allowed request rate

### Requirement: Optional broad-market Korean sources
The system SHALL allow broad-market Korean sources such as Bobaedream to contribute only as supplemental market fear signals.

#### Scenario: Bobaedream keyword posts are available
- **WHEN** Bobaedream posts match configured market fear keywords
- **THEN** the system includes them with lower source weight than stock-specific sources

#### Scenario: Supplemental source has no symbol match
- **WHEN** a supplemental source has broad market fear posts but no requested symbol match
- **THEN** the system labels the contribution as broad-market context rather than symbol-specific evidence

### Requirement: Excluded source handling
The system SHALL exclude Naver finance discussion boards, Clien, login-only pages, private APIs, and authenticated community content from v1 automated ingestion.

#### Scenario: Excluded source appears in configuration
- **WHEN** an excluded source is present in configuration
- **THEN** the system treats it as `disabled` and does not fetch it

### Requirement: Transparent scoring factors
The system SHALL break down the community pain score into interpretable factors.

#### Scenario: Pain keywords are detected
- **WHEN** normalized community items contain pain keywords or loss-confession patterns
- **THEN** the response includes factor scores and matched categories without requiring the UI to inspect raw source text

#### Scenario: Low evidence volume
- **WHEN** the system has too few usable community items
- **THEN** the response lowers confidence and explains that evidence volume is limited

### Requirement: Separate community and price signals
The system SHALL present community pain as a separate signal from the existing price-based pain meter.

#### Scenario: Home page displays both signals
- **WHEN** both price data and community data are available for a symbol
- **THEN** the UI shows community pain separately from price pain and does not merge them into one final trading score

### Requirement: Responsible retention and attribution
The system SHALL minimize retention of raw community text and identify source origins in score explanations.

#### Scenario: Score is cached
- **WHEN** a community pain response is cached
- **THEN** the cache stores score summaries, factor counts, and source metadata rather than long-lived raw post/comment bodies

#### Scenario: Evidence is shown to the user
- **WHEN** the UI shows example evidence behind a score
- **THEN** the system shows short, attributed snippets or normalized reasons rather than republishing full posts or comments
