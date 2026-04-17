# TrumanWrld

**TrumanWrld** is an autonomous AI Key Opinion Leader (KOL) Operating System. It orchestrates content discovery, semantic ranking, drafting, human/AI review, and publishing across Social Media platforms (X and Threads). Designed to simulate a high-signal "AI × Capital × Taste" persona, TrumanWrld operates entirely autonomously or with a human-in-the-loop to ensure brand safety and quality.

## 🚀 Features

- **Autonomous Background Daemon**: Post periodically (e.g. every 4-6 hours) without manual intervention.
- **Smart Signal Discovery**: Fetches trending topics natively from X API or curates insights from RSS feeds (Hacker News, TechCrunch, etc.).
- **Multi-Platform Publishing Support**: Ships native posts directly to X (via OAuth 1.0a) and Threads (via fixed tokens).
- **Engagement Agent**: Auto-replies to `@mentions`, and intelligently decides whether to retweet, quote, or reply to specific timeline topics.
- **Brand Guardian Check**: Hardcoded safety constraints prevent credential leakage, off-brand posts, and formatting errors before they ever leave the machine.

## 🛠️ Architecture

TrumanWrld operates on a multi-agent architectural pipeline:
1. **Signal Ingestion**: Reads a topic manually or automatically fetches one from X/RSS.
2. **Evaluation & Ranking**: A prompt-driven MiniMax model ranks the signal's viability out of 100 based on the TrumanWrld Persona constraints.
3. **Drafting**: Multi-platform variations are drafted simultaneously — one sharp tweet under 280 chars, and one conversational thread under 500 chars.
4. **Guardian Review**: Passes the drafts through strict safety rules testing before releasing.
5. **Publishing Adapter**: Pushes content out natively to X and Threads via API.

## 📦 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [MiniMax API Key](https://api.minimaxi.com) (or any OpenAI-compatible provider)
- (Optional) X Developer API keys
- (Optional) Threads Developer credentials

### Installation

1. **Clone the repo**
   ```bash
   git clone https://github.com/aiyufan3/TrumanWrld.git
   cd TrumanWrld
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   Copy `.env.example` to `.env` and configure your API tokens.
   ```bash
   cp .env.example .env
   ```

4. **Build the typescript source (Optional but recommended)**
   ```bash
   npm run build
   ```

## 🎮 Usage

### One-Shot Manual Mode
Generate a single post by explicitly supplying a thought signal.
\`\`\`bash
npm run start -- --signal "Agentic AI isn't an engineering challenge, it's a systems orchestration challenge." --approve
\`\`\`

### Autonomous Daemon Mode
Let TrumanWrld run in the background. It will automatically discover signals, draft, approve, and publish every 4-6 hours.
\`\`\`bash
npm run daemon
\`\`\`

## 🔒 Security

TrumanWrld contains a strict native `SecurityGuard` layer that parses internal system states and blocks the agent if it detects API keys, tokens, or credential-like materials leaking into standard LLM prompts or output payloads. See `src/modules/security` for more information.

## 📜 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
