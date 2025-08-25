# AI Chatbot with Web Search and Streaming

This project implements a responsive AI chatbot that integrates web search from **Perplexity AI**

## Features

*   **Multi-LLM Support:** OpenAI, Google Gemini, Anthropic Claude.
*   **Intelligent Web Search (RAG):** Perplexity AI (for OpenAI/Anthropic) and Google Search Grounding (for Gemini).
*   **Explicit Search Control:** Rule-based logic decides when to perform a web search.
*   **Centralized Caching:** Speeds up repeated search queries.
*   **Streaming Responses (SSE):** Real-time, character-by-character response display.
*   **Citation Streaming:** Displays sources and links for web-searched answers.
*   **Fast LLM Fallback:** Uses faster, cheaper LLMs for general knowledge.

## Setup and Installation

### Prerequisites

*   Node.js (v18+) and npm
*   API Keys from: OpenAI, Google Cloud (for Gemini), Anthropic, Perplexity AI

### 1. Clone the Repository

```bash
git clone <repository-url>
cd langchain-chatbot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the project root:

```env
# .env
OPENAI_API_KEY=sk-your-openai-api-key
GOOGLE_API_KEY=your-google-gemini-api-key
ANTHROPIC_API_KEY=sk-ant-api03-your-anthropic-api-key
PERPLEXITY_API_KEY=pplx-your-perplexity-api-key

PORT=3000
```
**Important:** Replace placeholders with your actual API keys.

### 4. Run the Backend Server

```bash
npm start
# Or for development with auto-restarts:
npm run dev
```
The server will start on `http://localhost:3000`.

## Usage with the `/chat` Endpoint

The backend exposes a single POST endpoint: `/chat`. This endpoint handles both the initial request and streams the AI's response using Server-Sent Events (SSE).

### Endpoint Details

*   **URL:** `http://localhost:3000/chat`
*   **Method:** `POST`
*   **`Content-Type`:** `application/json`
*   **Request Body (JSON):**
    *   `message` (string, **required**): The user's input query.
    *   `modelProvider` (string, optional): Which AI provider to use. Valid values: `"openai"`, `"google"`, `"anthropic"`. Defaults to `"openai"`.
    *   `modelName` (string, optional): Specific model ID or internal keyword. Defaults to `"gpt-4-turbo"`.
        *   **OpenAI:** `"gpt-4-turbo"`, `"gpt-3.5-turbo"`, `"openai_fast"` (internal keyword for `gpt-3.5-turbo`).
        *   **Google:** `"gemini-pro"`, `"gemini-pro-flash"`, `"google_fast"` (internal keyword for `gemini-pro-flash`).
        *   **Anthropic:** `"claude-3-sonnet-20240229"`, `"claude-3-haiku-20240307"`, `"anthropic_fast"` (internal keyword for `claude-3-haiku-20240307`).
    *   `forceSearch` (boolean, optional): If `true`, explicitly forces a web search regardless of `shouldSearchWeb` logic. Defaults to `false`.

### Response (Server-Sent Events - SSE)

The endpoint will stream events, each prefixed with `data: ` and terminated by `\n\n`. You'll need an SSE-compatible client (like `EventSource` in browsers or a custom `fetch` reader).

**Example Stream Events:**

*   `data: {"type": "metadata", "data": {"usedSearch": true, "searchTool": "perplexity_web_search", "searchSources": [{"url": "...", "title": "..."}], "isSearchSuccessful": true}}\n\n`
    *   (Sent first, indicates if search was used, which tool, and any sources.)
*   `data: {"type": "chunk", "data": "This is "}\n\n`
*   `data: {"type": "chunk", "data": "part of "}\n\n`
*   `data: {"type": "chunk", "data": "the AI's response."}\n\n`
    *   (Multiple `chunk` events will follow for the streamed text.)
*   `data: {"type": "error", "data": "An API error occurred."}\n\n`
    *   (Sent if an error occurs during processing.)
*   `data: {"type": "end"}\n\n`
    *   (Sent when the response is complete.)

### Example `fetch` Request (JavaScript / Frontend)

```javascript
async function sendChatMessage(message, modelProvider = 'openai', modelName = 'gpt-4-turbo') {
  const response = await fetch('http://localhost:3000/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, modelProvider, modelName }),
  });

  if (!response.body) {
    throw new Error('ReadableStream not supported by browser or server response.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulatedChunks = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    accumulatedChunks += decoder.decode(value, { stream: true });

    // Process SSE-like chunks
    const events = accumulatedChunks.split('\n\n');
    accumulatedChunks = events.pop(); // Keep incomplete event at the end

    for (const event of events) {
      if (event.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(event.substring(5)); // Remove 'data: '
          if (parsed.type === 'chunk') {
            console.log("Received AI text:", parsed.data);
            // Update UI with parsed.data
          } else if (parsed.type === 'metadata') {
            console.log("Received metadata:", parsed.data);
            // Update UI with search status, sources
          } else if (parsed.type === 'error') {
            console.error("Received error:", parsed.data);
            // Display error to user
          } else if (parsed.type === 'end') {
            console.log("Stream ended.");
            return;
          }
        } catch (parseError) {
          console.error('Error parsing SSE chunk:', parseError, 'Raw chunk:', event);
        }
      }
    }
  }
}

// Example usage:
sendChatMessage("What are the latest developments in AI in 2024?", "google", "gemini-pro");
// sendChatMessage("Explain quantum entanglement.", "openai", "gpt-3.5-turbo");
```
