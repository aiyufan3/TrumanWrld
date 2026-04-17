# TrumanWrld: Autonomous AI KOL Operating System

TrumanWrld is a fully autonomous AI Key Opinion Leader (KOL) Operating System. It is an end-to-end framework that operates a social media persona by discovering content, ranking ideas, generating drafts, self-evaluating for brand safety, and publishing directly to platforms like X and Threads.

This project is built for technical users and developers learning how to build complex, multi-agent AI systems in production. We welcome forks, contributions, and adaptations for your own AI personas.

## Architecture and Workflow

The system operates on a pipeline powered by specialized AI agents:

1. Signal Ingestion: Automatically fetches raw data from X trending topics and RSS feeds (Hacker News, TechCrunch) or a curated evergreen signal bank.
2. Ranking Agent: Evaluates the potential of a topic against the defined persona. Weak ideas are discarded.
3. Drafting Agent: Generates platform-specific content (concise for X, conversational for Threads).
4. Brand Guardian Agent: A strict review layer that prevents off-brand content, formatting errors, or credential leakage from ever leaving the machine.
5. Engagement Agent: Searches the timeline for relevant discussions and decides whether to reply, quote, repost, or skip based on persona alignment.

## Tech Stack and Tools

- Language: TypeScript (Node.js)
- LLM Integration: OpenAI-compatible Provider Interface (currently configured for MiniMax models, easily swappable to OpenAI, Anthropic, or Local models).
- Platform APIs: Twitter API v2 (via twitter-api-v2), Threads API.
- Runtime Coordination: Multi-agent orchestration using a centralized harness runner, prompt catalog, and autonomous evaluation loops.

## Getting Started

### Prerequisites

- Node.js (v18+)
- An API key for an OpenAI-compatible LLM provider
- X and Threads Developer API keys (if you intend to publish)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/aiyufan3/TrumanWrld.git
   cd TrumanWrld
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your environment variables. Copy the template and fill in your keys:
   ```bash
   cp .env.example .env
   ```

### Usage

Run the system in autonomous background daemon mode. It will wake up on randomized intervals (default 4-6 hours), discover a signal, execute the harness loop, and publish to connected platforms.

```bash
npm run daemon
```

For testing or manual intervention, provide a specific thought signal for the agent to process into a single post execution:

```bash
npm run start -- --signal "Your specific thought here" --approve
```

## Customizing Your Agent

TrumanWrld is designed to be easily forked and customized. If you want to change the persona from the default "AI x Capital x Taste" character to a completely custom persona, you only need to modify a few key files:

- Persona Definition: Edit `prompts/system/persona.system.md` to redefine the voice, tone, and worldview of your agent.
- Content Preferences: Update `src/modules/discovery/signalBank.ts` with evergreen thoughts that match your new persona.
- Discovery Sources: Modify `config/rssFeeds.json` to scrape news and data from RSS feeds relevant to your specific niche.
- Engagement Behavior: Adjust `prompts/system/engagement.system.md` to change how the agent interacts with other users on the timeline.

## Open Source and Contributing

TrumanWrld is actively maintained as an open-source educational resource and framework. Feel free to fork the repository, customize the agent for your own projects, and submit pull requests if you build useful new adapter skills or autonomous features. 

This project is licensed under the MIT License.
